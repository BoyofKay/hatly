/** @type {import('next').NextConfig} */
const nextConfig = {
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
