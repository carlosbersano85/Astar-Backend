import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{ user?: { id?: string } }>();
  const user = request.user;

  if (!user || typeof user.id !== 'string' || user.id.trim() === '') {
    throw new UnauthorizedException('User not authenticated');
  }

  return user;
});
