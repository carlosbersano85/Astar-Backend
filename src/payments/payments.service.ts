import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

export type SubscriptionPlan = 'essentials' | 'portal' | 'depth';
export type BillingCycle = 'monthly' | 'annual';

type AppSubscriptionStatus = 'active' | 'inactive' | 'cancelled';

interface PayPalCreateSubscriptionResponse {
  id: string;
  links?: Array<{ href: string; rel: string }>;
}

interface PayPalGetSubscriptionResponse {
  id: string;
  status: string;
  custom_id?: string;
}

interface PayPalVerifyWebhookResponse {
  verification_status?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async handlePayPalWebhook(
    headers: Record<string, string | string[] | undefined>,
    event: Record<string, unknown>,
  ) {
    await this.verifyWebhookSignature(headers, event);

    const eventType = String(event.event_type ?? '');
    const resource = this.asRecord(event.resource);
    const subscriptionId = this.getSubscriptionIdFromEvent(resource);

    if (!subscriptionId) {
      this.logger.warn(`Webhook ignored: missing subscription id for event ${eventType}`);
      return { received: true, ignored: true, reason: 'missing-subscription-id' };
    }

    const user = await this.prisma.user.findFirst({ where: { paypalSubscriptionId: subscriptionId } });
    if (!user) {
      this.logger.warn(`Webhook ignored: no user linked to subscription ${subscriptionId} (${eventType})`);
      return { received: true, ignored: true, reason: 'subscription-not-linked' };
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
      eventType === 'BILLING.SUBSCRIPTION.RE-ACTIVATED' ||
      eventType === 'PAYMENT.SALE.COMPLETED'
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'active' },
      });
      return { received: true, processed: true };
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'cancelled' },
      });
      return { received: true, processed: true };
    }

    if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { subscriptionStatus: 'inactive' },
      });
      return { received: true, processed: true };
    }

    return { received: true, ignored: true, reason: 'unsupported-event' };
  }

  async createPayPalSubscription(userId: string, plan: SubscriptionPlan, billing: BillingCycle) {
    this.assertPlan(plan);
    this.assertBilling(billing);

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can subscribe.');
    }

    const planId = this.getPayPalPlanId(plan, billing);
    const frontendBaseUrl = this.getFrontendBaseUrl();

    const payload = {
      plan_id: planId,
      custom_id: `${userId}:${plan}:${billing}`,
      application_context: {
        brand_name: 'Astar',
        user_action: 'SUBSCRIBE_NOW',
        return_url: `${frontendBaseUrl}/subscribe/paypal/success`,
        cancel_url: `${frontendBaseUrl}/subscribe/paypal/cancel`,
        shipping_preference: 'NO_SHIPPING',
      },
    };

    const data = await this.payPalRequest<PayPalCreateSubscriptionResponse>('/v1/billing/subscriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const approvalUrl = data.links?.find((link) => link.rel === 'approve')?.href;
    if (!approvalUrl) {
      throw new BadGatewayException('PayPal did not return an approval URL.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        paypalSubscriptionId: data.id,
        paypalPlan: plan,
        paypalBillingCycle: billing,
      },
    });

    return {
      subscriptionId: data.id,
      approvalUrl,
    };
  }

  async confirmPayPalSubscription(userId: string, subscriptionId: string) {
    if (!subscriptionId?.trim()) {
      throw new BadRequestException('subscriptionId is required.');
    }

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm subscriptions.');
    }

    const data = await this.payPalRequest<PayPalGetSubscriptionResponse>(
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { method: 'GET' },
    );

    const paypalStatus = (data.status ?? '').toUpperCase();
    const subscriptionStatus = this.mapPayPalStatusToSubscriptionStatus(paypalStatus);

    const customInfo = this.parseCustomId(data.custom_id);
    if (customInfo && customInfo.userId !== userId) {
      throw new ForbiddenException('This PayPal subscription does not belong to the current user.');
    }

    const finalPlan = customInfo?.plan ?? (user.paypalPlan as SubscriptionPlan | null) ?? null;
    const finalBilling = customInfo?.billing ?? (user.paypalBillingCycle as BillingCycle | null) ?? null;
    const previouslyActive = user.subscriptionStatus === 'active' && user.paypalSubscriptionId === subscriptionId;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus,
        paypalSubscriptionId: subscriptionId,
        paypalPlan: finalPlan,
        paypalBillingCycle: finalBilling,
      },
    });

    if (subscriptionStatus === 'active' && !previouslyActive && finalPlan && finalBilling) {
      await this.prisma.order.create({
        data: {
          userId,
          type: finalBilling,
          amount: this.getPlanAmount(finalPlan, finalBilling),
          method: 'paypal',
        },
      });
    }

    return {
      subscriptionId: data.id,
      paypalStatus,
      subscriptionStatus,
      plan: finalPlan,
      billing: finalBilling,
    };
  }

  async cancelPayPalSubscription(userId: string, reason?: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can cancel subscriptions.');
    }

    const subscriptionId = user.paypalSubscriptionId;
    if (!subscriptionId) {
      throw new BadRequestException('No PayPal subscription found for this user.');
    }

    await this.payPalRequest<void>(
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      {
        method: 'POST',
        body: JSON.stringify({ reason: reason?.trim() || 'Cancelled by subscriber from customer portal.' }),
      },
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: 'cancelled' },
    });

    return { ok: true };
  }

  private getPayPalBaseUrl() {
    return process.env.PAYPAL_ENV === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  private getFrontendBaseUrl() {
    const value = process.env.FRONTEND_URL?.trim();
    if (!value) {
      throw new InternalServerErrorException('Missing FRONTEND_URL environment variable.');
    }
    return value.replace(/\/$/, '');
  }

  private getPayPalPlanId(plan: SubscriptionPlan, billing: BillingCycle) {
    const planMap: Record<SubscriptionPlan, Record<BillingCycle, string | undefined>> = {
      essentials: {
        monthly: process.env.PAYPAL_PLAN_ID_ESSENTIALS_MONTHLY,
        annual: process.env.PAYPAL_PLAN_ID_ESSENTIALS_ANNUAL,
      },
      portal: {
        monthly: process.env.PAYPAL_PLAN_ID_PORTAL_MONTHLY,
        annual: process.env.PAYPAL_PLAN_ID_PORTAL_ANNUAL,
      },
      depth: {
        monthly: process.env.PAYPAL_PLAN_ID_DEPTH_MONTHLY,
        annual: process.env.PAYPAL_PLAN_ID_DEPTH_ANNUAL,
      },
    };

    const planId = planMap[plan][billing]?.trim();
    if (!planId) {
      throw new InternalServerErrorException(`Missing PayPal plan ID for ${plan} ${billing}.`);
    }
    return planId;
  }

  private getPlanAmount(plan: SubscriptionPlan, billing: BillingCycle) {
    const amountMap: Record<SubscriptionPlan, Record<BillingCycle, string>> = {
      essentials: { monthly: '19', annual: '15' },
      portal: { monthly: '39', annual: '29' },
      depth: { monthly: '79', annual: '59' },
    };
    return amountMap[plan][billing];
  }

  private mapPayPalStatusToSubscriptionStatus(status: string): AppSubscriptionStatus {
    if (status === 'ACTIVE') return 'active';
    if (status === 'CANCELLED' || status === 'SUSPENDED' || status === 'EXPIRED') return 'cancelled';
    return 'inactive';
  }

  private parseCustomId(customId?: string): { userId: string; plan: SubscriptionPlan; billing: BillingCycle } | null {
    if (!customId) return null;
    const [userId, plan, billing] = customId.split(':');
    if (!userId || !this.isPlan(plan) || !this.isBilling(billing)) return null;
    return { userId, plan, billing };
  }

  private assertPlan(plan: string): asserts plan is SubscriptionPlan {
    if (!this.isPlan(plan)) {
      throw new BadRequestException('Invalid plan. Use essentials, portal or depth.');
    }
  }

  private assertBilling(billing: string): asserts billing is BillingCycle {
    if (!this.isBilling(billing)) {
      throw new BadRequestException('Invalid billing cycle. Use monthly or annual.');
    }
  }

  private isPlan(value: string): value is SubscriptionPlan {
    return value === 'essentials' || value === 'portal' || value === 'depth';
  }

  private isBilling(value: string): value is BillingCycle {
    return value === 'monthly' || value === 'annual';
  }

  private async payPalRequest<T>(path: string, init: RequestInit): Promise<T> {
    const token = await this.getPayPalAccessToken();
    const response = await fetch(`${this.getPayPalBaseUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const raw = await response.text();
    const payload = raw ? this.safeJson(raw) : null;

    if (!response.ok) {
      const details = payload && typeof payload === 'object' ? JSON.stringify(payload) : raw;
      throw new BadGatewayException(`PayPal request failed (${response.status}): ${details}`);
    }

    return payload as T;
  }

  private async getPayPalAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET.');
    }

    const response = await fetch(`${this.getPayPalBaseUrl()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const raw = await response.text();
    const payload = raw ? this.safeJson(raw) : null;

    if (!response.ok || !payload || typeof payload !== 'object' || !('access_token' in payload)) {
      throw new BadGatewayException(`Failed to authenticate with PayPal (${response.status}).`);
    }

    return String(payload.access_token);
  }

  private async verifyWebhookSignature(
    headers: Record<string, string | string[] | undefined>,
    event: Record<string, unknown>,
  ) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
    if (!webhookId) {
      throw new InternalServerErrorException('Missing PAYPAL_WEBHOOK_ID.');
    }

    const authAlgo = this.getHeader(headers, 'paypal-auth-algo');
    const certUrl = this.getHeader(headers, 'paypal-cert-url');
    const transmissionId = this.getHeader(headers, 'paypal-transmission-id');
    const transmissionSig = this.getHeader(headers, 'paypal-transmission-sig');
    const transmissionTime = this.getHeader(headers, 'paypal-transmission-time');

    if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
      throw new BadRequestException('Missing PayPal webhook verification headers.');
    }

    const payload = {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: event,
    };

    const verification = await this.payPalRequest<PayPalVerifyWebhookResponse>(
      '/v1/notifications/verify-webhook-signature',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (verification.verification_status !== 'SUCCESS') {
      throw new ForbiddenException('Invalid PayPal webhook signature.');
    }
  }

  private getHeader(headers: Record<string, string | string[] | undefined>, key: string) {
    const value = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(value)) return value[0] ?? '';
    return value ?? '';
  }

  private getSubscriptionIdFromEvent(resource: Record<string, unknown>) {
    const directId = resource.id;
    if (typeof directId === 'string' && directId.trim()) return directId;

    const billingAgreementId = resource.billing_agreement_id;
    if (typeof billingAgreementId === 'string' && billingAgreementId.trim()) return billingAgreementId;

    const supplementary = this.asRecord(resource.supplementary_data);
    const relatedIds = this.asRecord(supplementary.related_ids);
    const nested = relatedIds.subscription_id;
    if (typeof nested === 'string' && nested.trim()) return nested;

    return '';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private safeJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
