import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PortalService } from './portal.service';

@Controller('portal')
@UseGuards(JwtAuthGuard)
export class PortalController {
  constructor(private portalService: PortalService) {}

  @Get('me')
  async getProfile(@CurrentUser() user: { id: string }) {
    return this.portalService.getProfile(user.id);
  }

  @Get('questions')
  async getMyQuestions(@CurrentUser() user: { id: string }) {
    return this.portalService.getMyQuestions(user.id);
  }

  @Post('questions')
  async submitQuestion(@CurrentUser() user: { id: string }, @Body() body: { question: string }) {
    return this.portalService.createQuestion(user.id, body.question?.trim() ?? '');
  }

  @Get('orders')
  async getMyOrders(@CurrentUser() user: { id: string }) {
    return this.portalService.getMyOrders(user.id);
  }

  @Get('reports')
  async getReports(@CurrentUser() user: { id: string }) {
    return this.portalService.getReports(user.id);
  }

  @Get('reports/:type')
  async getReportByType(@CurrentUser() user: { id: string }, @Param('type') type: string) {
    return this.portalService.getReportByType(user.id, type);
  }

  @Get('messages')
  async getMessages(@CurrentUser() user: { id: string }) {
    return this.portalService.getMessages(user.id);
  }

  @Get('notifications')
  async getNotifications(@CurrentUser() user: { id: string }) {
    return this.portalService.getNotifications(user.id);
  }

  @Patch('notifications/:id/read')
  async markNotificationRead(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.portalService.markNotificationRead(user.id, id);
  }

  @Post('notifications/read-all')
  async markAllNotificationsRead(@CurrentUser() user: { id: string }) {
    return this.portalService.markAllNotificationsRead(user.id);
  }

  @Get('subscription-status')
  async getSubscriptionStatus(@CurrentUser() user: { id: string }) {
    return this.portalService.getSubscriptionStatus(user.id);
  }

  @Get('access-status')
  async getAccessStatus(@CurrentUser() user: { id: string }) {
    return this.portalService.getAccessStatus(user.id);
  }
}
