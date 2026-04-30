import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingCycle, PaymentsService, SubscriptionPlan } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('paypal/service/pricing')
  @UseGuards(JwtAuthGuard)
  async getServicePricing(@CurrentUser() user: { id: string }, @Query('serviceId') serviceId?: string) {
    return this.paymentsService.getPayPalServicePricing(user.id, serviceId);
  }

  @Post('paypal/service/create')
  @UseGuards(JwtAuthGuard)
  async createPayPalServiceOrder(@CurrentUser() user: { id: string }, @Body() body: { serviceId?: string }) {
    return this.paymentsService.createPayPalServiceOrder(user.id, body.serviceId?.trim() || undefined);
  }

  @Post('paypal/service/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayPalServiceOrder(
    @CurrentUser() user: { id: string },
    @Body() body: { orderId?: string; subscriptionId?: string; serviceId?: string },
  ) {
    const checkoutId = body.subscriptionId?.trim() || body.orderId?.trim() || '';
    return this.paymentsService.confirmPayPalServiceOrder(user.id, checkoutId);
  }

  @Get('mercado-pago/service/pricing')
  @UseGuards(JwtAuthGuard)
  async getMercadoPagoServicePricing(@CurrentUser() user: { id: string }, @Query('serviceId') serviceId?: string) {
    return this.paymentsService.getMercadoPagoServicePricing(user.id, serviceId);
  }

  @Post('mercado-pago/service/create')
  @UseGuards(JwtAuthGuard)
  async createMercadoPagoServicePreference(@CurrentUser() user: { id: string }, @Body() body: { serviceId?: string }) {
    return this.paymentsService.createMercadoPagoServicePreference(user.id, body.serviceId?.trim() || undefined);
  }

  @Post('mercado-pago/service/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoServicePayment(
    @CurrentUser() user: { id: string },
    @Body() body: { paymentId?: string; collectionId?: string; serviceId?: string },
  ) {
    const checkoutId = body.paymentId?.trim() || body.collectionId?.trim() || '';
    return this.paymentsService.confirmMercadoPagoServicePayment(user.id, checkoutId);
  }

  @Get('mercado-pago/service/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoServicePaymentFromQuery(
    @CurrentUser() user: { id: string },
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    const checkoutId = paymentId?.trim() || collectionId?.trim() || '';
    return this.paymentsService.confirmMercadoPagoServicePayment(user.id, checkoutId);
  }

  @Get('paypal/service/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayPalServiceOrderFromQuery(
    @CurrentUser() user: { id: string },
    @Query('subscription_id') subscriptionIdFromPayPal?: string,
    @Query('subscriptionId') subscriptionId?: string,
    @Query('orderId') orderId?: string,
    @Query('token') token?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    const checkoutId =
      subscriptionIdFromPayPal?.trim() ||
      subscriptionId?.trim() ||
      orderId?.trim() ||
      token?.trim() ||
      '';

    return this.paymentsService.confirmPayPalServiceOrder(user.id, checkoutId);
  }

  @Post('paypal/subscription/create')
  @UseGuards(JwtAuthGuard)
  async createPayPalSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { plan: SubscriptionPlan; billing: BillingCycle },
  ) {
    return this.paymentsService.createPayPalSubscription(user.id, body.plan, body.billing);
  }

  @Post('paypal/subscription/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayPalSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { subscriptionId: string },
  ) {
    return this.paymentsService.confirmPayPalSubscription(user.id, body.subscriptionId);
  }

  @Post('paypal/subscription/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelPayPalSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { reason?: string },
  ) {
    return this.paymentsService.cancelPayPalSubscription(user.id, body.reason);
  }

  @Post('mercado-pago/subscription/create')
  @UseGuards(JwtAuthGuard)
  async createMercadoPagoSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { plan: SubscriptionPlan; billing: BillingCycle },
  ) {
    return this.paymentsService.createMercadoPagoSubscription(user.id, body.plan, body.billing);
  }

  @Post('mercado-pago/subscription/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { subscriptionId?: string; preapprovalId?: string; paymentId?: string; collectionId?: string },
  ) {
    const checkoutId =
      body.paymentId?.trim() ||
      body.collectionId?.trim() ||
      body.subscriptionId?.trim() ||
      body.preapprovalId?.trim() ||
      '';
    return this.paymentsService.confirmMercadoPagoSubscription(user.id, checkoutId);
  }

  @Get('mercado-pago/subscription/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoSubscriptionFromQuery(
    @CurrentUser() user: { id: string },
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
    @Query('preapproval_id') preapprovalId?: string,
    @Query('subscription_id') subscriptionId?: string,
  ) {
    const checkoutId =
      paymentId?.trim() ||
      collectionId?.trim() ||
      preapprovalId?.trim() ||
      subscriptionId?.trim() ||
      '';
    return this.paymentsService.confirmMercadoPagoSubscription(user.id, checkoutId);
  }

  @Post('mercado-pago/subscription/cancel')
  @UseGuards(JwtAuthGuard)
  async cancelMercadoPagoSubscription(
    @CurrentUser() user: { id: string },
    @Body() body: { subscriptionId?: string; preapprovalId?: string; reason?: string },
  ) {
    const checkoutId = body.subscriptionId?.trim() || body.preapprovalId?.trim() || '';
    return this.paymentsService.cancelMercadoPagoSubscription(user.id, checkoutId, body.reason);
  }

  @Post('paypal/webhook')
  async handlePayPalWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() event: Record<string, unknown>,
  ) {
    return this.paymentsService.handlePayPalWebhook(headers, event);
  }

  @Post('mercado-pago/webhook')
  async handleMercadoPagoWebhook(@Body() event: Record<string, unknown>) {
    return this.paymentsService.handleMercadoPagoWebhook(event);
  }
}
