import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Browser (dashboard) sessions. The API keeps its bearer-token contract for the mobile apps; the dashboard instead holds its session in
 * HttpOnly cookies the page's JavaScript can never read, so a script injected into the dashboard cannot steal a token.
 *
 *   hatly_at   the access JWT          HttpOnly, SameSite=Strict, Secure on deployed (TLS) environments, path = the API prefix
 *   hatly_rt   the refresh JWT         same, but path-scoped to /auth/dashboard so it is only ever sent to refresh/logout
 *   hatly_sid  a random session id     same; it binds the CSRF token (below) to THIS browser session
 *
 * CSRF (cookies are sent automatically, so a cross-site page could otherwise make the browser act as the admin):
 *   - SameSite=Strict keeps the cookies off cross-site requests in the first place (dashboard and API must share a registrable domain);
 *   - every unsafe cookie-authenticated request must carry `X-CSRF-Token` = HMAC(server secret, hatly_sid). The token is returned in the
 *     JSON of login / me / refresh — never in a cookie — so another origin can neither read nor guess it;
 *   - refresh and logout are the two calls that must work when the CSRF token was lost (a new tab, an expired access cookie): they require a
 *     custom header (`X-Requested-With: hatly-dashboard`, which forces a CORS preflight that other origins fail) instead;
 *   - an `Origin` header, when present, must be an allowed dashboard origin.
 */
export const DASHBOARD_COOKIE = { access: 'hatly_at', refresh: 'hatly_rt', session: 'hatly_sid' } as const;
export const CSRF_HEADER = 'x-csrf-token';
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'hatly-dashboard';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || name in out) continue; // first one wins; never let a duplicate override
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export function newSessionId(): string {
  return randomBytes(24).toString('base64url');
}

export function csrfTokenFor(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url');
}

export function isCsrfTokenValid(presented: string | undefined, sessionId: string | undefined, secret: string): boolean {
  if (!presented || !sessionId) return false;
  const expected = Buffer.from(csrfTokenFor(sessionId, secret));
  const got = Buffer.from(presented);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/**
 * A browser `Origin` is acceptable when it is one of the configured dashboard origins. With none configured (development/test only —
 * a strict deployment refuses to boot without a list) any origin is accepted, exactly like the dev CORS policy; an absent Origin
 * (same-origin form posts, non-browser clients) is left to the token / custom-header checks.
 */
export function isOriginAllowed(origin: string | undefined, allowed: string[], strict: boolean): boolean {
  if (!origin) return true;
  if (allowed.length === 0) return !strict;
  return allowed.includes(origin);
}

export interface CookieOptionsInput {
  secure: boolean;
  path: string;
  maxAgeSeconds: number;
}

/** Set-Cookie value for an HttpOnly, SameSite=Strict cookie. */
export function serializeCookie(name: string, value: string, o: CookieOptionsInput): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path}`, `Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`, 'HttpOnly', 'SameSite=Strict'];
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, o: { secure: boolean; path: string }): string {
  return serializeCookie(name, '', { ...o, maxAgeSeconds: 0 });
}
