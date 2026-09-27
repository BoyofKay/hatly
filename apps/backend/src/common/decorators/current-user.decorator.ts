import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  role: string;
  phone?: string;
}

/**
 * Pulls the authenticated user (attached by JwtAuthGuard/JwtStrategy) off
 * the request. Never trust any user identity fields sent in the request
 * body — this decorator is the only source of truth for "who is calling".
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
