import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingCycle, PaymentsService, SubscriptionPlan } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

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

  @Post('paypal/webhook')
  async handlePayPalWebhook(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() event: Record<string, unknown>,
  ) {
    return this.paymentsService.handlePayPalWebhook(headers, event);
  }
}
