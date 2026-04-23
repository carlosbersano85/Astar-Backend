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
type MercadoPagoSubscriptionMode = 'checkout' | 'preapproval';

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

interface PayPalOrderResponse {
  id: string;
  status: string;
  links?: Array<{ href: string; rel: string }>;
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { value: string; currency_code: string };
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount: { value: string; currency_code: string };
      }>;
    };
  }>;
}

interface MercadoPagoCreatePreferenceResponse {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
}

interface MercadoPagoPaymentResponse {
  id: number;
  status?: string;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string;
}

interface MercadoPagoPreapprovalResponse {
  id: string;
  init_point?: string;
  status?: string;
  external_reference?: string;
  reason?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number;
    currency_id?: string;
  };
}

interface ExtraSessionPricing {
  subscriberAmount: string;
  nonSubscriberAmount: string;
  appliedAmount: string;
  isSubscriber: boolean;
  currency: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  // ─── Extra Session Pricing ────────────────────────────────────────────────

  async getPayPalExtraSessionPricing(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can buy extra sessions.');
    }

    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    return {
      subscriberAmount: pricing.subscriberAmount,
      nonSubscriberAmount: pricing.nonSubscriberAmount,
      amount: pricing.appliedAmount,
      isSubscriber: pricing.isSubscriber,
      currency: pricing.currency,
    };
  }

  async getMercadoPagoExtraSessionPricing(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can buy extra sessions.');
    }

    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    return {
      subscriberAmount: pricing.subscriberAmount,
      nonSubscriberAmount: pricing.nonSubscriberAmount,
      amount: pricing.appliedAmount,
      isSubscriber: pricing.isSubscriber,
      currency: pricing.currency,
    };
  }

  // ─── Extra Session: Create Order (Orders API v2) ──────────────────────────

  async createPayPalExtraSessionOrder(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can buy extra sessions.');
    }

    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    const frontendBaseUrl = this.getFrontendBaseUrl();
    const tier = pricing.isSubscriber ? 'subscriber' : 'standard';

    const payload = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: pricing.currency,
            value: pricing.appliedAmount,
          },
          custom_id: `${userId}:extra-session:${tier}`,
          description: 'Sesion privada adicional',
        },
      ],
      application_context: {
        brand_name: 'Astar',
        user_action: 'PAY_NOW',
        return_url: `${frontendBaseUrl}/portal/purchase?paypal=success&product=extra-session`,
        cancel_url: `${frontendBaseUrl}/portal/purchase?paypal=cancel&product=extra-session`,
        shipping_preference: 'NO_SHIPPING',
      },
    };

    const data = await this.payPalRequest<PayPalOrderResponse>('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const approvalUrl = data.links?.find((l) => l.rel === 'approve')?.href;
    if (!approvalUrl) {
      throw new BadGatewayException('PayPal did not return an approval URL for extra session checkout.');
    }

    // NOTE: We do NOT save this order ID to the user record.
    // Extra sessions are one-time purchases and must not overwrite
    // the user's real subscriptionId used by webhook handling.
    return {
      orderId: data.id,
      approvalUrl,
      subscriberAmount: pricing.subscriberAmount,
      nonSubscriberAmount: pricing.nonSubscriberAmount,
      amount: pricing.appliedAmount,
      isSubscriber: pricing.isSubscriber,
      currency: pricing.currency,
    };
  }

  async createMercadoPagoExtraSessionPreference(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can buy extra sessions.');
    }

    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    const frontendBaseUrl = this.getFrontendBaseUrl();
    const tier = pricing.isSubscriber ? 'subscriber' : 'standard';
    const backUrls = this.getMercadoPagoBackUrls(frontendBaseUrl);
    const webhookUrl = this.getMercadoPagoWebhookUrl();

    const payload: Record<string, unknown> = {
      items: [
        {
          title: 'Sesion privada adicional',
          quantity: 1,
          currency_id: pricing.currency,
          unit_price: Number(pricing.appliedAmount),
        },
      ],
      external_reference: `${userId}:extra-session:${tier}`,
      payer: {
        email: user.email,
        name: user.name,
      },
      back_urls: backUrls,
    };

    if (webhookUrl) {
      payload.notification_url = webhookUrl;
    }

    const data = await this.mercadoPagoRequest<MercadoPagoCreatePreferenceResponse>(
      '/checkout/preferences',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );

    const checkoutUrl = data.init_point || data.sandbox_init_point;
    if (!checkoutUrl) {
      throw new BadGatewayException('Mercado Pago did not return a checkout URL for extra session checkout.');
    }

    return {
      preferenceId: data.id,
      checkoutUrl,
      subscriberAmount: pricing.subscriberAmount,
      nonSubscriberAmount: pricing.nonSubscriberAmount,
      amount: pricing.appliedAmount,
      isSubscriber: pricing.isSubscriber,
      currency: pricing.currency,
    };
  }

  // ─── Extra Session: Confirm & Capture Order ───────────────────────────────

  async confirmPayPalExtraSessionOrder(userId: string, orderId: string) {
    if (!orderId?.trim()) {
      throw new BadRequestException('orderId is required.');
    }

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm extra session purchases.');
    }

    // Step 1: fetch the order to check its current status
    const details = await this.payPalRequest<PayPalOrderResponse>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      { method: 'GET' },
    );

    const orderStatus = (details.status ?? '').toUpperCase();
    this.logger.debug(`PayPal order ${orderId} status: ${orderStatus}`);

    // Already captured — idempotent path, still create DB record if missing
    if (orderStatus === 'COMPLETED') {
      return this.handleCompletedOrder(details, userId, orderId, user);
    }

    // Terminal states — user must start a new checkout
    if (orderStatus === 'VOIDED' || orderStatus === 'EXPIRED') {
      throw new BadRequestException(
        'EXPIRED_CHECKOUT: Este pago ha expirado o fue cancelado en PayPal. Por favor inicia un nuevo pago.',
      );
    }

    if (orderStatus !== 'APPROVED') {
      throw new BadRequestException(
        `El pago aun no fue aprobado (estado: ${orderStatus || 'UNKNOWN'}). Por favor reintenta en unos segundos.`,
      );
    }

    // Verify the order belongs to this user via custom_id
    const unit = details.purchase_units?.[0];
    const customInfo = this.parseExtraSessionCustomId(unit?.custom_id);
    if (customInfo && customInfo.userId !== userId) {
      throw new ForbiddenException('This extra session order does not belong to the current user.');
    }

    // Step 2: capture the payment
    const capture = await this.payPalRequest<PayPalOrderResponse>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: 'POST', body: JSON.stringify({}) },
    );

    const captureStatus = (capture.status ?? '').toUpperCase();
    this.logger.debug(`PayPal order ${orderId} capture status: ${captureStatus}`);

    if (captureStatus !== 'COMPLETED') {
      throw new BadRequestException(
        `La captura del pago no se completó (estado: ${captureStatus}). Por favor contacta soporte.`,
      );
    }

    return this.handleCompletedOrder(capture, userId, orderId, user);
  }

  async confirmMercadoPagoExtraSessionPayment(userId: string, paymentId: string) {
    if (!paymentId?.trim()) {
      throw new BadRequestException('paymentId is required.');
    }

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm extra session purchases.');
    }

    const payment = await this.mercadoPagoRequest<MercadoPagoPaymentResponse>(
      `/v1/payments/${encodeURIComponent(paymentId)}`,
      { method: 'GET' },
    );

    const status = (payment.status ?? '').toLowerCase();
    this.logger.debug(`Mercado Pago payment ${paymentId} status: ${status}`);

    if (status === 'cancelled' || status === 'rejected') {
      throw new BadRequestException(
        'EXPIRED_CHECKOUT: Este pago fue cancelado o rechazado en Mercado Pago. Por favor inicia un nuevo pago.',
      );
    }

    if (status !== 'approved') {
      throw new BadRequestException(
        `El pago aun no fue aprobado en Mercado Pago (estado: ${status || 'unknown'}). Por favor reintenta en unos segundos.`,
      );
    }

    const customInfo = this.parseExtraSessionCustomId(payment.external_reference);
    if (customInfo && customInfo.userId !== userId) {
      throw new ForbiddenException('This Mercado Pago payment does not belong to the current user.');
    }

    const amount = Number.isFinite(payment.transaction_amount)
      ? Number(payment.transaction_amount).toFixed(2)
      : this.getExtraSessionPricingForUser(user.subscriptionStatus).appliedAmount;

    const currency = payment.currency_id?.toUpperCase() || this.getExtraSessionCurrency();
    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    const orderType = customInfo?.tier === 'subscriber' ? 'extra_session_subscriber' : 'extra_session_standard';
    const tier = customInfo?.tier ?? (pricing.isSubscriber ? 'subscriber' : 'standard');

    const { created } = await this.createOrderAndAdminNotification({
      userId,
      orderType,
      amount,
      method: 'mercado_pago',
      clientName: user.name,
      checkoutReference: String(payment.id),
    });

    return { ok: true, paymentId: String(payment.id), created, amount, currency, tier };
  }

  private async handleCompletedOrder(
    orderData: PayPalOrderResponse,
    userId: string,
    orderId: string,
    user: { subscriptionStatus?: string; name: string },
  ) {
    const unit = orderData.purchase_units?.[0];
    const capture = unit?.payments?.captures?.[0];

    const amount = capture?.amount?.value ?? unit?.amount?.value ?? '0';
    const currency = capture?.amount?.currency_code ?? unit?.amount?.currency_code ?? 'USD';
    const customInfo = this.parseExtraSessionCustomId(unit?.custom_id);

    const pricing = this.getExtraSessionPricingForUser(user.subscriptionStatus);
    const orderType = customInfo?.tier === 'subscriber' ? 'extra_session_subscriber' : 'extra_session_standard';
    const tier = customInfo?.tier ?? (pricing.isSubscriber ? 'subscriber' : 'standard');

    const { created } = await this.createOrderAndAdminNotification({
      userId,
      orderType,
      amount,
      method: 'paypal',
      clientName: user.name,
      checkoutReference: orderId,
    });

    return { ok: true, orderId, created, amount, currency, tier };
  }

  // ─── Regular Subscriptions ────────────────────────────────────────────────

  async createPayPalSubscription(userId: string, plan: SubscriptionPlan, billing: BillingCycle) {
    this.assertPlan(plan);
    this.assertBilling(billing);

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can subscribe.');
    }

    if (this.isBillingTestMode()) {
      const subscriptionId = this.buildTestSubscriptionId('paypal', userId, plan, billing);
      const approvalUrl = this.buildTestApprovalUrl('paypal', subscriptionId);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionId,
          subscriptionPlan: plan,
          subscriptionBilling: billing,
          subscriptionProvider: 'paypal',
        },
      });

      return { subscriptionId, approvalUrl, simulated: true };
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
        subscriptionId: data.id,
        subscriptionPlan: plan,
        subscriptionBilling: billing,
        subscriptionProvider: 'paypal',
      },
    });

    return { subscriptionId: data.id, approvalUrl };
  }

  async confirmPayPalSubscription(userId: string, subscriptionId: string) {
    if (!subscriptionId?.trim()) {
      throw new BadRequestException('subscriptionId is required.');
    }

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm subscriptions.');
    }
    const subscriptionUser = user as {
      subscriptionId?: string | null;
      subscriptionPlan?: SubscriptionPlan | null;
      subscriptionBilling?: BillingCycle | null;
      subscriptionProvider?: string | null;
      subscriptionStatus: string;
    };

    if (this.isBillingTestMode()) {
      const customInfo = this.parseCustomId(subscriptionId);
      if (customInfo && customInfo.userId !== userId) {
        throw new ForbiddenException('This PayPal subscription does not belong to the current user.');
      }

      const finalPlan = customInfo?.plan ?? subscriptionUser.subscriptionPlan ?? null;
      const finalBilling = customInfo?.billing ?? subscriptionUser.subscriptionBilling ?? null;
      if (!finalPlan || !finalBilling) {
        throw new BadRequestException('No se pudo determinar plan/billing para esta suscripción de PayPal.');
      }

      const subscriptionStatus: AppSubscriptionStatus = 'active';
      const previouslyActive =
        subscriptionUser.subscriptionStatus === 'active' &&
        subscriptionUser.subscriptionId === subscriptionId &&
        subscriptionUser.subscriptionProvider === 'paypal';

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionStatus,
          subscriptionId,
          subscriptionPlan: finalPlan,
          subscriptionBilling: finalBilling,
          subscriptionProvider: 'paypal',
        },
      });

      if (!previouslyActive) {
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
        subscriptionId,
        paypalStatus: 'ACTIVE',
        subscriptionStatus,
        plan: finalPlan,
        billing: finalBilling,
        simulated: true,
      };
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

    const finalPlan = customInfo?.plan ?? subscriptionUser.subscriptionPlan ?? null;
    const finalBilling = customInfo?.billing ?? subscriptionUser.subscriptionBilling ?? null;
    if (!finalPlan || !finalBilling) {
      throw new BadRequestException('No se pudo determinar plan/billing para esta suscripción de PayPal.');
    }

    const previouslyActive =
      subscriptionUser.subscriptionStatus === 'active' &&
      subscriptionUser.subscriptionId === subscriptionId &&
      subscriptionUser.subscriptionProvider === 'paypal';

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus,
        subscriptionId,
        subscriptionPlan: finalPlan,
        subscriptionBilling: finalBilling,
        subscriptionProvider: 'paypal',
      },
    });

    if (subscriptionStatus === 'active' && !previouslyActive) {
      await this.prisma.order.create({
        data: {
          userId,
          type: finalBilling,
          amount: this.getPlanAmount(finalPlan, finalBilling),
          method: 'paypal',
        },
      });
    }

    return { subscriptionId: data.id, paypalStatus, subscriptionStatus, plan: finalPlan, billing: finalBilling };
  }

  async cancelPayPalSubscription(userId: string, reason?: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can cancel subscriptions.');
    }
    const subscriptionUser = user as {
      subscriptionId?: string | null;
      subscriptionProvider?: string | null;
      subscriptionBilling?: BillingCycle | null;
    };

    const subscriptionId = subscriptionUser.subscriptionId;
    if (!subscriptionId) {
      throw new BadRequestException('No PayPal subscription found for this user.');
    }

    if (subscriptionUser.subscriptionProvider && subscriptionUser.subscriptionProvider !== 'paypal') {
      throw new BadRequestException('This user does not have an active PayPal subscription.');
    }

    if (!this.isBillingTestMode()) {
      await this.payPalRequest<void>(
        `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: reason?.trim() || 'Cancelled by subscriber from customer portal.' }),
        },
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: 'cancelled',
        subscriptionId: null,
        subscriptionPlan: null,
        subscriptionBilling: null,
        subscriptionProvider: null,
      },
    });

    return { ok: true };
  }

  async createMercadoPagoSubscription(userId: string, plan: SubscriptionPlan, billing: BillingCycle) {
    this.assertPlan(plan);
    this.assertBilling(billing);

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can subscribe.');
    }

    if (this.isBillingTestMode()) {
      const subscriptionId = this.buildTestSubscriptionId('mercado_pago', userId, plan, billing);
      const approvalUrl = this.buildTestApprovalUrl('mercado_pago', subscriptionId);
      const amount = this.getPlanAmount(plan, billing);
      const currency = this.getMercadoPagoSubscriptionCurrency();

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionId,
          subscriptionPlan: plan,
          subscriptionBilling: billing,
          subscriptionProvider: 'mercado_pago',
        },
      });

      return { subscriptionId, approvalUrl, amount, currency, simulated: true };
    }

    const frontendBaseUrl = this.getFrontendBaseUrl();
    const amount = Number(this.getPlanAmount(plan, billing));
    const currency = this.getMercadoPagoSubscriptionCurrency();
    const mode = this.getMercadoPagoSubscriptionMode();
    const backUrls = this.getMercadoPagoSubscriptionBackUrls(frontendBaseUrl);

    if (mode === 'preapproval') {
      return this.createMercadoPagoPreapprovalSubscription(userId, user, plan, billing, amount, currency, backUrls);
    }

    return this.createMercadoPagoCheckoutSubscription(userId, user, plan, billing, amount, currency, backUrls);
  }

  private async createMercadoPagoCheckoutSubscription(
    userId: string,
    user: { email: string; name: string },
    plan: SubscriptionPlan,
    billing: BillingCycle,
    amount: number,
    currency: string,
    backUrls: { success: string; failure: string; pending: string },
  ) {

    const payload: Record<string, unknown> = {
      items: [
        {
          title: `Suscripcion Astar ${plan} ${billing}`,
          quantity: 1,
          currency_id: currency,
          unit_price: amount,
        },
      ],
      payment_methods: {
        installments: 1,
        default_installments: 1,
      },
      external_reference: `${userId}:${plan}:${billing}`,
      payer: {
        email: user.email,
        name: user.name,
      },
      back_urls: backUrls,
    };

    const webhookUrl = this.getMercadoPagoWebhookUrl();
    if (webhookUrl) {
      payload.notification_url = webhookUrl;
    }

    const data = await this.mercadoPagoRequest<MercadoPagoCreatePreferenceResponse>('/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionId: data.id,
        subscriptionPlan: plan,
        subscriptionBilling: billing,
        subscriptionProvider: 'mercado_pago',
      },
    });

    const approvalUrl = data.init_point || data.sandbox_init_point;
    if (!approvalUrl) {
      throw new BadGatewayException('Mercado Pago did not return an approval URL for subscription checkout.');
    }

    return {
      subscriptionId: data.id,
      approvalUrl,
      amount: amount.toFixed(2),
      currency,
    };
  }

  private async createMercadoPagoPreapprovalSubscription(
    userId: string,
    user: { email: string; name: string },
    plan: SubscriptionPlan,
    billing: BillingCycle,
    amount: number,
    currency: string,
    backUrls: { success: string; failure: string; pending: string },
  ) {
    const parsedBackUrl = this.parseAbsoluteUrl(backUrls.success, 'MERCADOPAGO_SUBSCRIPTION_BACK_URL');
    if (parsedBackUrl.hostname === 'localhost' || parsedBackUrl.hostname === '127.0.0.1') {
      throw new BadRequestException(
        'MERCADOPAGO_SUBSCRIPTION_BACK_URL must be a public URL when using preapproval mode.',
      );
    }

    const autoRecurring =
      billing === 'annual'
        ? {
            // Annual charges once per year in preapproval mode.
            frequency: 1,
            frequency_type: 'years',
            transaction_amount: amount,
            currency_id: currency,
          }
        : {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: amount,
            currency_id: currency,
          };

    const payload: Record<string, unknown> = {
      reason: `Astar ${plan} ${billing}`,
      external_reference: `${userId}:${plan}:${billing}`,
      payer_email: user.email,
      back_url: backUrls.success,
      auto_recurring: autoRecurring,
      status: 'pending',
    };

    const webhookUrl = this.getMercadoPagoWebhookUrl();
    if (webhookUrl) {
      payload.notification_url = webhookUrl;
    }

    const data = await this.mercadoPagoRequest<MercadoPagoPreapprovalResponse>('/preapproval', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionId: data.id,
        subscriptionPlan: plan,
        subscriptionBilling: billing,
        subscriptionProvider: 'mercado_pago',
      },
    });

    const approvalUrl = data.init_point;
    if (!approvalUrl) {
      throw new BadGatewayException('Mercado Pago did not return an approval URL for subscription checkout.');
    }

    return {
      subscriptionId: data.id,
      approvalUrl,
      amount: amount.toFixed(2),
      currency,
    };
  }

  async confirmMercadoPagoSubscription(userId: string, subscriptionId: string) {
    if (!subscriptionId?.trim()) {
      throw new BadRequestException('subscriptionId is required.');
    }

    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm subscriptions.');
    }

    if (this.isBillingTestMode()) {
      const subscriptionUser = user as {
        subscriptionPlan?: SubscriptionPlan | null;
        subscriptionBilling?: BillingCycle | null;
      };

      const customInfo = this.parseCustomId(subscriptionId);
      if (customInfo && customInfo.userId !== userId) {
        throw new ForbiddenException('This Mercado Pago subscription does not belong to the current user.');
      }

      const finalPlan = customInfo?.plan ?? subscriptionUser.subscriptionPlan ?? null;
      const finalBilling = customInfo?.billing ?? subscriptionUser.subscriptionBilling ?? null;
      if (!finalPlan || !finalBilling) {
        throw new BadRequestException('No se pudo determinar plan/billing para esta suscripción de Mercado Pago.');
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          subscriptionStatus: 'active',
          subscriptionId,
          subscriptionPlan: finalPlan,
          subscriptionBilling: finalBilling,
          subscriptionProvider: 'mercado_pago',
        },
      });

      await this.createRecurringSubscriptionOrderIfNeeded(userId, 'mercado_pago', finalPlan, finalBilling);

      return {
        subscriptionId,
        mercadoPagoStatus: 'approved',
        subscriptionStatus: 'active',
        plan: finalPlan,
        billing: finalBilling,
        simulated: true,
      };
    }

    const mode = this.getMercadoPagoSubscriptionMode();
    if (mode === 'preapproval') {
      return this.confirmMercadoPagoPreapprovalSubscription(userId, subscriptionId);
    }

    return this.confirmMercadoPagoCheckoutSubscription(userId, subscriptionId);
  }

  private async confirmMercadoPagoCheckoutSubscription(userId: string, subscriptionId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm subscriptions.');
    }
    const subscriptionUser = user as {
      subscriptionPlan?: SubscriptionPlan | null;
      subscriptionBilling?: BillingCycle | null;
    };

    const payment = await this.mercadoPagoRequest<MercadoPagoPaymentResponse>(
      `/v1/payments/${encodeURIComponent(subscriptionId)}`,
      { method: 'GET' },
    );

    const status = (payment.status ?? '').toLowerCase();
    if (status === 'cancelled' || status === 'rejected') {
      throw new BadRequestException(
        'EXPIRED_CHECKOUT: Este pago fue cancelado o rechazado en Mercado Pago. Por favor inicia un nuevo pago.',
      );
    }

    if (status !== 'approved') {
      throw new BadRequestException(
        `El pago aun no fue aprobado en Mercado Pago (estado: ${status || 'unknown'}). Por favor reintenta en unos segundos.`,
      );
    }

    const subscriptionStatus = this.mapMercadoPagoStatusToSubscriptionStatus(status);
    const customInfo = this.parseCustomId(payment.external_reference);

    if (customInfo && customInfo.userId !== userId) {
      throw new ForbiddenException('This Mercado Pago subscription does not belong to the current user.');
    }

    const finalPlan = customInfo?.plan ?? subscriptionUser.subscriptionPlan ?? null;
    const finalBilling = customInfo?.billing ?? subscriptionUser.subscriptionBilling ?? null;
    if (!finalPlan || !finalBilling) {
      throw new BadRequestException('No se pudo determinar plan/billing para esta suscripción de Mercado Pago.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus,
        subscriptionId: String(payment.id),
        subscriptionPlan: finalPlan,
        subscriptionBilling: finalBilling,
        subscriptionProvider: 'mercado_pago',
      },
    });

    if (subscriptionStatus === 'active' && finalPlan && finalBilling) {
      await this.prisma.order.create({
        data: {
          userId,
          type: finalBilling,
          amount: this.getPlanAmount(finalPlan, finalBilling),
          method: 'mercado_pago',
        },
      });
    }

    return {
      subscriptionId: String(payment.id),
      mercadoPagoStatus: status,
      subscriptionStatus,
      plan: finalPlan,
      billing: finalBilling,
    };
  }

  private async confirmMercadoPagoPreapprovalSubscription(userId: string, subscriptionId: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can confirm subscriptions.');
    }
    const subscriptionUser = user as {
      subscriptionPlan?: SubscriptionPlan | null;
      subscriptionBilling?: BillingCycle | null;
    };

    const data = await this.mercadoPagoRequest<MercadoPagoPreapprovalResponse>(
      `/preapproval/${encodeURIComponent(subscriptionId)}`,
      { method: 'GET' },
    );

    const status = (data.status ?? '').toLowerCase();
    const subscriptionStatus = this.mapMercadoPagoStatusToSubscriptionStatus(status);
    const customInfo = this.parseCustomId(data.external_reference);

    if (customInfo && customInfo.userId !== userId) {
      throw new ForbiddenException('This Mercado Pago subscription does not belong to the current user.');
    }

    const finalPlan = customInfo?.plan ?? subscriptionUser.subscriptionPlan ?? null;
    const finalBilling = customInfo?.billing ?? subscriptionUser.subscriptionBilling ?? null;
    if (!finalPlan || !finalBilling) {
      throw new BadRequestException('No se pudo determinar plan/billing para esta suscripción de Mercado Pago.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus,
        subscriptionId: data.id,
        subscriptionPlan: finalPlan,
        subscriptionBilling: finalBilling,
        subscriptionProvider: 'mercado_pago',
      },
    });

    if (subscriptionStatus === 'active') {
      await this.prisma.order.create({
        data: {
          userId,
          type: finalBilling,
          amount: this.getPlanAmount(finalPlan, finalBilling),
          method: 'mercado_pago',
        },
      });
    }

    return {
      subscriptionId: data.id,
      mercadoPagoStatus: status,
      subscriptionStatus,
      plan: finalPlan,
      billing: finalBilling,
    };
  }

  async cancelMercadoPagoSubscription(userId: string, subscriptionId: string, reason?: string) {
    const user = await this.usersService.findById(userId);
    if (!user || user.role !== 'client') {
      throw new ForbiddenException('Only client users can cancel subscriptions.');
    }

    const mode = this.getMercadoPagoSubscriptionMode();
    if (mode === 'preapproval') {
      await this.mercadoPagoRequest<MercadoPagoPreapprovalResponse>(
        `/preapproval/${encodeURIComponent(subscriptionId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'cancelled',
            reason: reason?.trim() || 'Cancelled by subscriber from customer portal.',
          }),
        },
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: 'cancelled' },
    });

    return { ok: true };
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  async handlePayPalWebhook(
    headers: Record<string, string | string[] | undefined>,
    event: Record<string, unknown>,
  ) {
    if (!this.isBillingTestMode()) {
      await this.verifyWebhookSignature(headers, event);
    }

    const eventType = String(event.event_type ?? '');
    const resource = this.asRecord(event.resource);
    const subscriptionId = this.getSubscriptionIdFromEvent(resource);

    if (!subscriptionId) {
      this.logger.warn(`Webhook ignored: missing subscription id for event ${eventType}`);
      return { received: true, ignored: true, reason: 'missing-subscription-id' };
    }

    const user = await this.prisma.user.findFirst({
      where: { subscriptionId, subscriptionProvider: 'paypal' } as any,
    });
    if (!user) {
      this.logger.warn(`Webhook ignored: no user linked to subscription ${subscriptionId} (${eventType})`);
      return { received: true, ignored: true, reason: 'subscription-not-linked' };
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
      eventType === 'BILLING.SUBSCRIPTION.RE-ACTIVATED' ||
      eventType === 'PAYMENT.SALE.COMPLETED'
    ) {
      if (eventType === 'PAYMENT.SALE.COMPLETED') {
        await this.createRecurringSubscriptionOrderIfNeeded(
          user.id,
          'paypal',
          (user as { subscriptionPlan?: string | null }).subscriptionPlan,
          (user as { subscriptionBilling?: string | null }).subscriptionBilling,
        );
      }

      await this.prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: 'active' } });
      return { received: true, processed: true };
    }

    if (
      eventType === 'BILLING.SUBSCRIPTION.CANCELLED' ||
      eventType === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
      eventType === 'BILLING.SUBSCRIPTION.EXPIRED'
    ) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: 'cancelled',
          subscriptionId: null,
          subscriptionPlan: null,
          subscriptionBilling: null,
          subscriptionProvider: null,
        },
      });
      return {
        received: true,
        processed: true,
      };
    }

    if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      await this.prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: 'inactive' } });
      return { received: true, processed: true };
    }

    return { received: true, ignored: true, reason: 'unsupported-event' };
  }

  async handleMercadoPagoWebhook(event: Record<string, unknown>) {
    const topic = String(event.topic ?? event.type ?? event.action ?? '').toLowerCase();
    const resource = this.asRecord(event.data ?? event.resource ?? {});
    const id = String(resource.id ?? event.id ?? '').trim();

    if (!id) {
      return { received: true, ignored: true, reason: 'missing-id' };
    }

    if (topic.includes('payment')) {
      const payment = await this.mercadoPagoRequest<MercadoPagoPaymentResponse>(
        `/v1/payments/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );

      const customInfo = this.parseCustomId(payment.external_reference);
      if (!customInfo) {
        return { received: true, ignored: true, reason: 'missing-external-reference' };
      }

      const user = await this.prisma.user.findFirst({ where: { id: customInfo.userId } });
      if (!user) {
        return { received: true, ignored: true, reason: 'subscription-not-linked' };
      }

      const status = (payment.status ?? '').toLowerCase();
      if (status === 'approved' || status === 'authorized') {
        await this.createRecurringSubscriptionOrderIfNeeded(
          user.id,
          'mercado_pago',
          customInfo.plan,
          customInfo.billing,
        );

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'active',
            subscriptionId: String(payment.id),
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return { received: true, processed: true, status };
      }

      if (status === 'cancelled' || status === 'rejected' || status === 'refunded' || status === 'charged_back') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'cancelled',
            subscriptionId: String(payment.id),
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return {
          received: true,
          processed: true,
          status,
        };
      }

      if (status === 'in_process' || status === 'pending') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'inactive',
            subscriptionId: String(payment.id),
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return { received: true, processed: true, status };
      }

      return { received: true, ignored: true, reason: 'unsupported-payment-status', status };
    }

    if (topic.includes('preapproval')) {
      const preapproval = await this.mercadoPagoRequest<MercadoPagoPreapprovalResponse>(
        `/preapproval/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );

      const customInfo = this.parseCustomId(preapproval.external_reference);
      if (!customInfo) {
        return { received: true, ignored: true, reason: 'missing-external-reference' };
      }

      const user = await this.prisma.user.findFirst({ where: { id: customInfo.userId } });
      if (!user) {
        return { received: true, ignored: true, reason: 'subscription-not-linked' };
      }

      const status = (preapproval.status ?? '').toLowerCase();
      if (status === 'authorized' || status === 'active') {
        await this.createRecurringSubscriptionOrderIfNeeded(
          user.id,
          'mercado_pago',
          customInfo.plan,
          customInfo.billing,
        );

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'active',
            subscriptionId: preapproval.id,
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return { received: true, processed: true, status };
      }

      if (status === 'cancelled' || status === 'paused' || status === 'expired') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'cancelled',
            subscriptionId: preapproval.id,
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return {
          received: true,
          processed: true,
          status,
        };
      }

      if (status === 'pending') {
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            subscriptionStatus: 'inactive',
            subscriptionId: preapproval.id,
            subscriptionPlan: customInfo.plan,
            subscriptionBilling: customInfo.billing,
            subscriptionProvider: 'mercado_pago',
          },
        });
        return { received: true, processed: true, status };
      }

      return { received: true, ignored: true, reason: 'unsupported-preapproval-status', status };
    }

    return { received: true, ignored: true, reason: 'unsupported-topic', topic };
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private getPayPalBaseUrl() {
    return process.env.PAYPAL_ENV === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  private getMercadoPagoBaseUrl() {
    return 'https://api.mercadopago.com';
  }

  private isBillingTestMode() {
    return process.env.BILLING_TEST_MODE?.trim().toLowerCase() === 'true';
  }

  private buildTestSubscriptionId(
    provider: 'paypal' | 'mercado_pago',
    userId: string,
    plan: SubscriptionPlan,
    billing: BillingCycle,
  ) {
    return `${userId}:${plan}:${billing}:${provider}:test`;
  }

  private buildTestApprovalUrl(provider: 'paypal' | 'mercado_pago', subscriptionId: string) {
    const frontendBaseUrl = this.getFrontendBaseUrl();
    const encodedSubscriptionId = encodeURIComponent(subscriptionId);
    if (provider === 'paypal') {
      return `${frontendBaseUrl}/subscribe/paypal/success?subscription_id=${encodedSubscriptionId}&simulated=1`;
    }

    return `${frontendBaseUrl}/subscribe/mercado-pago/success?preapproval_id=${encodedSubscriptionId}&simulated=1`;
  }

  private getExtraSessionPricingForUser(subscriptionStatus?: string): ExtraSessionPricing {
    const subscriberAmount = this.getRequiredPriceEnv('PAYPAL_EXTRA_SESSION_PRICE_SUBSCRIBER');
    const nonSubscriberAmount = this.getRequiredPriceEnv('PAYPAL_EXTRA_SESSION_PRICE_NON_SUBSCRIBER');
    const isSubscriber = subscriptionStatus === 'active';

    return {
      subscriberAmount,
      nonSubscriberAmount,
      appliedAmount: isSubscriber ? subscriberAmount : nonSubscriberAmount,
      isSubscriber,
      currency: this.getExtraSessionCurrency(),
    };
  }

  private getRequiredPriceEnv(
    variableName: 'PAYPAL_EXTRA_SESSION_PRICE_SUBSCRIBER' | 'PAYPAL_EXTRA_SESSION_PRICE_NON_SUBSCRIBER',
  ) {
    const value = process.env[variableName]?.trim();
    if (!value) {
      throw new InternalServerErrorException(`Missing ${variableName} environment variable.`);
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new InternalServerErrorException(`${variableName} must be a positive number.`);
    }

    return numeric.toFixed(2);
  }

  private getExtraSessionCurrency() {
    return process.env.PAYPAL_EXTRA_SESSION_CURRENCY?.trim().toUpperCase() || 'USD';
  }

  private getMercadoPagoSubscriptionCurrency() {
    const configured =
      process.env.MERCADOPAGO_SUBSCRIPTION_CURRENCY?.trim().toUpperCase() ||
      process.env.MERCADOPAGO_CURRENCY?.trim().toUpperCase();

    return configured || this.getExtraSessionCurrency();
  }

  private parseExtraSessionCustomId(customId?: string): { userId: string; tier: 'subscriber' | 'standard' } | null {
    if (!customId) return null;
    const [userId, product, tier] = customId.split(':');
    if (!userId || product !== 'extra-session' || (tier !== 'subscriber' && tier !== 'standard')) {
      return null;
    }
    return { userId, tier };
  }

  private async createRecurringSubscriptionOrderIfNeeded(
    userId: string,
    method: 'paypal' | 'mercado_pago',
    planRaw?: string | null,
    billingRaw?: string | null,
  ) {
    if (!planRaw || !billingRaw || !this.isPlan(planRaw) || !this.isBilling(billingRaw)) {
      return;
    }

    const amount = this.getPlanAmount(planRaw, billingRaw);
    const duplicateWindowStart = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const existingOrder = await this.prisma.order.findFirst({
      where: {
        userId,
        type: billingRaw,
        amount,
        method,
        createdAt: { gte: duplicateWindowStart },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOrder) {
      return;
    }

    await this.prisma.order.create({
      data: {
        userId,
        type: billingRaw,
        amount,
        method,
      },
    });
  }

  private async createOrderAndAdminNotification(input: {
    userId: string;
    orderType: string;
    amount: string;
    method: string;
    clientName: string;
    checkoutReference?: string;
  }) {
    const adminUsers = await this.prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const duplicateWindowStart = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const existingOrder = await tx.order.findFirst({
        where: {
          userId: input.userId,
          type: input.orderType,
          amount: input.amount,
          method: input.method,
          createdAt: { gte: duplicateWindowStart },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingOrder) {
        return { created: false, orderId: existingOrder.id };
      }

      const order = await tx.order.create({
        data: {
          userId: input.userId,
          type: input.orderType,
          amount: input.amount,
          method: input.method,
        },
      });

      if (adminUsers.length > 0) {
        const checkoutSuffix = input.checkoutReference ? ` - ${input.checkoutReference}` : '';
        await tx.notification.createMany({
          data: adminUsers.map((admin) => ({
            userId: admin.id,
            title: 'Nuevo pedido',
            body: `${input.orderType} - ${input.amount} - ${input.clientName}${checkoutSuffix}`,
            category: 'order',
            read: false,
          })),
        });
      }

      return { created: true, orderId: order.id };
    });
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getFrontendBaseUrl() {
    const value = process.env.FRONTEND_URL?.trim();
    if (!value) {
      throw new InternalServerErrorException('Missing FRONTEND_URL environment variable.');
    }
    return value.replace(/\/$/, '');
  }

  private getMercadoPagoBackUrls(frontendBaseUrl: string) {
    const success = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_BACK_URL_SUCCESS,
      `${frontendBaseUrl}/portal/purchase?mp=success&product=extra-session`,
      'MERCADOPAGO_BACK_URL_SUCCESS',
    );
    const failure = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_BACK_URL_FAILURE,
      `${frontendBaseUrl}/portal/purchase?mp=failure&product=extra-session`,
      'MERCADOPAGO_BACK_URL_FAILURE',
    );
    const pending = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_BACK_URL_PENDING,
      `${frontendBaseUrl}/portal/purchase?mp=pending&product=extra-session`,
      'MERCADOPAGO_BACK_URL_PENDING',
    );

    return { success, failure, pending };
  }

  private getMercadoPagoSubscriptionBackUrls(frontendBaseUrl: string) {
    const success = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_SUBSCRIPTION_BACK_URL,
      `${frontendBaseUrl}/subscribe/mercado-pago/success`,
      'MERCADOPAGO_SUBSCRIPTION_BACK_URL',
    );
    const failure = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_SUBSCRIPTION_BACK_URL,
      `${frontendBaseUrl}/subscribe/mercado-pago/cancel`,
      'MERCADOPAGO_SUBSCRIPTION_BACK_URL',
    );
    const pending = this.toAbsoluteUrl(
      process.env.MERCADOPAGO_SUBSCRIPTION_BACK_URL,
      `${frontendBaseUrl}/subscribe/mercado-pago/success?mp=pending`,
      'MERCADOPAGO_SUBSCRIPTION_BACK_URL',
    );
    return { success, failure, pending };
  }

  private getMercadoPagoSubscriptionMode(): MercadoPagoSubscriptionMode {
    const value = process.env.MERCADOPAGO_SUBSCRIPTION_MODE?.trim().toLowerCase();
    if (!value || value === 'checkout') {
      return 'checkout';
    }

    if (value === 'preapproval') {
      return 'preapproval';
    }

    throw new InternalServerErrorException(
      'Invalid MERCADOPAGO_SUBSCRIPTION_MODE. Use checkout or preapproval.',
    );
  }

  private getMercadoPagoWebhookUrl(): string | undefined {
    const configured = process.env.MERCADOPAGO_WEBHOOK_URL?.trim();
    if (!configured) {
      return undefined;
    }

    return this.toAbsoluteUrl(configured, configured, 'MERCADOPAGO_WEBHOOK_URL');
  }

  private toAbsoluteUrl(value: string | undefined, fallback: string, envName: string): string {
    const candidate = value?.trim() || fallback;
    const parsed = this.parseAbsoluteUrl(candidate, envName);
    return parsed.toString().replace(/\/$/, '');
  }

  private parseAbsoluteUrl(candidate: string, envName: string): URL {
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
      return parsed;
    } catch {
      throw new InternalServerErrorException(
        `Invalid ${envName}. Expected an absolute http(s) URL, got: ${candidate}`,
      );
    }
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
      essentials: { monthly: '19', annual: '180' },
      portal: { monthly: '39', annual: '348' },
      depth: { monthly: '79', annual: '708' },
    };
    return amountMap[plan][billing];
  }

  private mapPayPalStatusToSubscriptionStatus(status: string): AppSubscriptionStatus {
    if (status === 'ACTIVE') return 'active';
    if (status === 'CANCELLED' || status === 'SUSPENDED' || status === 'EXPIRED') return 'cancelled';
    return 'inactive';
  }

  private mapMercadoPagoStatusToSubscriptionStatus(status: string): AppSubscriptionStatus {
    if (status === 'approved') return 'active';
    if (status === 'authorized') return 'active';
    if (status === 'cancelled' || status === 'paused' || status === 'expired') return 'cancelled';
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

  private async mercadoPagoRequest<T>(path: string, init: RequestInit): Promise<T> {
    const token = this.getMercadoPagoAccessToken();
    const response = await fetch(`${this.getMercadoPagoBaseUrl()}${path}`, {
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
      throw new BadGatewayException(`Mercado Pago request failed (${response.status}): ${details}`);
    }

    return payload as T;
  }

  private getMercadoPagoAccessToken() {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
    if (!token) {
      throw new InternalServerErrorException('Missing MERCADOPAGO_ACCESS_TOKEN environment variable.');
    }
    return token;
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
      { method: 'POST', body: JSON.stringify(payload) },
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