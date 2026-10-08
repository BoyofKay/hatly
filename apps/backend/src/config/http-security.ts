import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * HTTP security building blocks (M5 Batch 1). Pure functions with no framework wiring so each rule is unit-testable;
 * `app.setup.ts` applies them. The project has no `helmet` dependency — the API only ever returns JSON (plus static image
 * files), so the small, fixed set of headers helmet would add for such a service is set here directly instead of adding a
 * dependency in a security-sensitive path.
 */

/** Global JSON/urlencoded body ceiling for every route except the image upload. */
export const DEFAULT_BODY_LIMIT = '100kb';
/** `POST /uploads` carries an image as base64 in JSON: 5 MiB of image ≈ 6.7 MB of base64, plus the envelope. */
export const UPLOAD_BODY_LIMIT = '8mb';

/**
 * CORS. Browsers are the only clients CORS applies to (the native apps send no Origin), and the only browser client is the
 * admin dashboard, so production/staging allows exactly the configured origins. When none are configured (development/test)
 * the previous open behaviour is kept so the local workflow is unchanged. Authentication is by bearer token in a header, never
 * cookies, so credentials are not enabled.
 */
export function buildCorsOptions(allowedOrigins: string[], strict: boolean): CorsOptions {
  const common: CorsOptions = {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
    maxAge: 600,
  };
  if (allowedOrigins.length === 0 && !strict) return { ...common, origin: '*' };
  // Exact-match allow list. An origin that is not on it (or a strict deployment with an empty list) gets NO CORS headers.
  return { ...common, origin: allowedOrigins };
}

export interface SecurityHeadersOptions {
  /** Send Strict-Transport-Security (only meaningful — and only sent — for deployed, TLS-terminated environments). */
  hsts: boolean;
  /** Paths served by this API's own static file route: they get their own caching headers, so no `no-store`. */
  staticPrefix?: string | null;
}

export function securityHeaders(options: SecurityHeadersOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    if (options.hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');

    const path = req.path ?? '';
    // The Swagger UI (development/explicitly enabled) needs inline scripts/styles, so the strict API policy is skipped for it.
    if (!path.startsWith('/docs')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    }
    // API responses (auth tokens, orders, addresses) must never be stored by a shared cache.
    if (!(options.staticPrefix && path.startsWith(options.staticPrefix))) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  };
}

/** `<uuid>.<ext>` — a name generated once per upload and never reused, so the bytes behind it can never change. */
const GENERATED_UPLOAD_NAME = /(^|[\\/])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/;

/**
 * Headers for files served from the uploads directory: never executable/embeddable, usable cross-origin as images.
 *
 * Caching (M5 Batch 4): an uploaded file's name is a random UUID that is never reused, so it is cacheable for a year and
 * "immutable" — mobile clients and any CDN never need to revalidate it. Other files (the seeded `marketplace/...` pack, whose
 * names are stable paths that a re-seed could replace) keep the one-day lifetime; Express still answers their revalidation with
 * a cheap 304 via ETag/Last-Modified.
 */
export function staticFileHeaders(res: { setHeader(name: string, value: string): unknown }, filePath?: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', filePath && GENERATED_UPLOAD_NAME.test(filePath) ? 'public, max-age=31536000, immutable' : 'public, max-age=86400');
}
