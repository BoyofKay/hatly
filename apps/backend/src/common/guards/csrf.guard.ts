import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_MODE_KEY } from '../decorators/csrf-mfa.decorators';
import { CSRF_HEADER, DASHBOARD_COOKIE, REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE, isCsrfTokenValid, isOriginAllowed, parseCookies } from '../../modules/auth/dashboard-session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global CSRF defence for COOKIE sessions (see dashboard-session.ts). It only ever bites a request that is authenticated by the browser's
 * cookies: a request with a bearer `Authorization` header (the mobile apps, scripts) or with no session cookie at all is untouched, so no
 * existing client changes. It runs for @Public routes too — refresh/logout are public yet cookie-driven.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(req.method)) return true;
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) return true;
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies[DASHBOARD_COOKIE.access] && !cookies[DASHBOARD_COOKIE.refresh]) return true;

    const strict = this.config.get<boolean>('http.strict') ?? false;
    const allowed = this.config.get<string[]>('http.corsAllowedOrigins') ?? [];
    if (!isOriginAllowed(req.headers.origin, allowed, strict)) this.refuse('CSRF_ORIGIN_REJECTED');

    const mode = this.reflector.getAllAndOverride<'custom-header' | 'skip' | undefined>(CSRF_MODE_KEY, [context.getHandler(), context.getClass()]);
    if (mode === 'skip') return true;
    if (mode === 'custom-header') {
      if (req.headers[REQUESTED_WITH_HEADER] !== REQUESTED_WITH_VALUE) this.refuse('CSRF_HEADER_REQUIRED');
      return true;
    }
    const secret = this.config.get<string>('auth.accessSecret') ?? '';
    if (!isCsrfTokenValid(req.headers[CSRF_HEADER] as string | undefined, cookies[DASHBOARD_COOKIE.session], secret)) this.refuse('CSRF_TOKEN_INVALID');
    return true;
  }

  private refuse(code: string): never {
    throw new ForbiddenException({ message: 'The request could not be verified. Reload the page and try again.', details: { code } });
  }
}
