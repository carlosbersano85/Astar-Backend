import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingCycle, PaymentsService, SubscriptionPlan } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('paypal/extra-session/pricing')
  @UseGuards(JwtAuthGuard)
  async getExtraSessionPricing(@CurrentUser() user: { id: string }) {
    return this.paymentsService.getPayPalExtraSessionPricing(user.id);
  }

  @Post('paypal/extra-session/create')
  @UseGuards(JwtAuthGuard)
  async createPayPalExtraSessionOrder(@CurrentUser() user: { id: string }) {
    return this.paymentsService.createPayPalExtraSessionOrder(user.id);
  }

  @Post('paypal/extra-session/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayPalExtraSessionOrder(
    @CurrentUser() user: { id: string },
    @Body() body: { orderId?: string; subscriptionId?: string },
  ) {
    const checkoutId = body.subscriptionId?.trim() || body.orderId?.trim() || '';
    return this.paymentsService.confirmPayPalExtraSessionOrder(user.id, checkoutId);
  }

  @Get('mercado-pago/extra-session/pricing')
  @UseGuards(JwtAuthGuard)
  async getMercadoPagoExtraSessionPricing(@CurrentUser() user: { id: string }) {
    return this.paymentsService.getMercadoPagoExtraSessionPricing(user.id);
  }

  @Post('mercado-pago/extra-session/create')
  @UseGuards(JwtAuthGuard)
  async createMercadoPagoExtraSessionPreference(@CurrentUser() user: { id: string }) {
    return this.paymentsService.createMercadoPagoExtraSessionPreference(user.id);
  }

  @Post('mercado-pago/extra-session/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoExtraSessionPayment(
    @CurrentUser() user: { id: string },
    @Body() body: { paymentId?: string; collectionId?: string },
  ) {
    const checkoutId = body.paymentId?.trim() || body.collectionId?.trim() || '';
    return this.paymentsService.confirmMercadoPagoExtraSessionPayment(user.id, checkoutId);
  }

  @Get('mercado-pago/extra-session/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmMercadoPagoExtraSessionPaymentFromQuery(
    @CurrentUser() user: { id: string },
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
  ) {
    const checkoutId = paymentId?.trim() || collectionId?.trim() || '';
    return this.paymentsService.confirmMercadoPagoExtraSessionPayment(user.id, checkoutId);
  }

  @Get('paypal/extra-session/confirm')
  @UseGuards(JwtAuthGuard)
  async confirmPayPalExtraSessionOrderFromQuery(
    @CurrentUser() user: { id: string },
    @Query('subscription_id') subscriptionIdFromPayPal?: string,
    @Query('subscriptionId') subscriptionId?: string,
    @Query('orderId') orderId?: string,
    @Query('token') token?: string,
  ) {
    const checkoutId =
      subscriptionIdFromPayPal?.trim() ||
      subscriptionId?.trim() ||
      orderId?.trim() ||
      token?.trim() ||
      '';

    return this.paymentsService.confirmPayPalExtraSessionOrder(user.id, checkoutId);
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
