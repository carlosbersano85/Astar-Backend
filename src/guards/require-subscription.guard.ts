import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RequireSubscriptionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get user from database with subscription info
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    // Check if subscription is active
    if (dbUser.subscriptionStatus === 'active') {
      request.user.canAccessAstro = true;
      return true;
    }

    // Free users cannot access
    throw new ForbiddenException('This feature requires an active subscription. Please upgrade to continue.');
  }
}
