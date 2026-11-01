/** @type {import('next').NextConfig} */
/**
 * Security headers. The session token lives in localStorage (see lib/api/client.ts — moving it to httpOnly cookies is a separate
 * architecture change), so reducing what injected script can do matters: the CSP limits where script, frames, forms and network
 * calls may go, and the dashboard can never be framed (clickjacking). `unsafe-inline` for scripts/styles is what Next.js' own inline
 * bootstrap needs without per-request nonces; `unsafe-eval` is added for the dev server only.
 */
const apiOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1').origin;
  } catch {
    return '';
  }
})();
const isDev = process.env.NODE_ENV !== 'production';
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Product / vendor images come from the API's own media (and a CDN over HTTPS when one is configured).
  `img-src 'self' data: blob: https: ${apiOrigin}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isDev ? ' ws:' : ''}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // The dashboard does not use `next/image`, so the built-in image optimizer (`/_next/image`) has no job here. It is switched off
  // because it is the attack surface behind several Next.js 14 advisories (image-optimizer DoS, disk-cache growth and an AVIF
  // remote-code-execution issue) that are only fixed in Next 15.5+, which this project has not migrated to yet.
  // If `next/image` is ever adopted, remove this and migrate Next first.
  images: { unoptimized: true },
  // Overridable build/serve folder so a separately-built dashboard (e.g. the Remote Sales one, built against the public API
  // URL — see docs/REMOTE_SALES.md) never shares `.next` with the local dev server / Playwright. Default unchanged.
  distDir: process.env.HATLY_DASHBOARD_DIST_DIR || '.next',
};

module.exports = nextConfig;
