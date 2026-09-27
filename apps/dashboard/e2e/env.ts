/**
 * Sales Release Candidate hardening milestone — Playwright environment.
 *
 * Everything here is read from environment variables with dev-only DEFAULTS that match the
 * `hatly_dev` fixture state this repository's own conventions already establish (see
 * `apps/backend/src/scripts/bootstrap-admin.ts` and `seed-dev-marketplace.ts`). No production
 * credential is ever hardcoded — these defaults are dev-only and documented in `e2e/README.md`.
 */
export const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export const DASHBOARD_BASE_URL = process.env.PLAYWRIGHT_DASHBOARD_BASE_URL ?? 'http://localhost:3002';
export const DASHBOARD_PORT = process.env.PLAYWRIGHT_DASHBOARD_PORT ?? '3002';

/**
 * A SUPER_ADMIN session is needed once, by global-setup only, to (idempotently) provision the
 * Vendor Manager fixture accounts below through the real `POST /admin/vendor-staff` endpoint —
 * never to log in through the browser itself, and never referenced by any spec file directly.
 * See e2e/README.md for exactly how this dev account's password was set.
 */
export const SUPER_ADMIN_PHONE = process.env.PLAYWRIGHT_SUPER_ADMIN_PHONE ?? '+201099999999';
export const SUPER_ADMIN_PASSWORD = process.env.PLAYWRIGHT_SUPER_ADMIN_PASSWORD ?? 'Playwright-Dev-1!';

/** Vendor Manager fixture — "Beit El Sharkia Restaurant" (seeded by seed-dev-marketplace.ts). */
export const VENDOR_A_PHONE = process.env.PLAYWRIGHT_VENDOR_A_PHONE ?? '+201098765432';
export const VENDOR_A_PASSWORD = process.env.PLAYWRIGHT_VENDOR_A_PASSWORD ?? 'Playwright-Dev-1!';
export const VENDOR_A_BRANCH_ID = process.env.PLAYWRIGHT_VENDOR_A_BRANCH_ID ?? '80f1a42a-cea0-4c42-b69f-35f4b83f6ae4';
export const VENDOR_A_FULL_NAME = 'Playwright Vendor Manager (Restaurant)';

/** A SECOND, unrelated Vendor Manager fixture — "Belbeis Supermarket" — used only for the order-isolation test. */
export const VENDOR_B_PHONE = process.env.PLAYWRIGHT_VENDOR_B_PHONE ?? '+201098765433';
export const VENDOR_B_PASSWORD = process.env.PLAYWRIGHT_VENDOR_B_PASSWORD ?? 'Playwright-Dev-1!';
export const VENDOR_B_BRANCH_ID = process.env.PLAYWRIGHT_VENDOR_B_BRANCH_ID ?? '50a0a6ab-3487-4472-9e03-3ba647217e08';
export const VENDOR_B_FULL_NAME = 'Playwright Vendor Manager (Supermarket)';

/** A throwaway product on Vendor A's branch with no required options — safe for a one-line cart/order. */
export const VENDOR_A_PRODUCT_ID = process.env.PLAYWRIGHT_VENDOR_A_PRODUCT_ID ?? '06a54b93-4787-4ca2-94e6-63ad88a687df';

/** A WEIGHT-priced product on Vendor B's branch — needed for the "Record Weight" browser tests. */
export const VENDOR_B_WEIGHT_PRODUCT_ID = process.env.PLAYWRIGHT_VENDOR_B_WEIGHT_PRODUCT_ID ?? '19de1190-efd6-497f-b59a-b3fa410ea759';

export const STORAGE_STATE_DIR = 'e2e/.auth';
export const VENDOR_A_STORAGE_STATE = `${STORAGE_STATE_DIR}/vendor-a.json`;
export const VENDOR_B_STORAGE_STATE = `${STORAGE_STATE_DIR}/vendor-b.json`;
export const FIXTURE_FILE = `${STORAGE_STATE_DIR}/fixtures.json`;

export interface FixtureOrder {
  orderId: string;
  segmentId: string;
  itemId: string;
  orderNumber: string;
}

export interface Fixtures {
  /**
   * Several INDEPENDENT fresh orders against Vendor A's branch — each spec that MUTATES a segment's
   * status consumes its own, so tests never fight over which one is still at PENDING.
   * [0] = basic open/confirm test, [1] = double/rapid-click protection, [2] = isolation/invalid-id tests (never mutated).
   */
  vendorAOrders: FixtureOrder[];
  /** A fresh order against Vendor B's branch, with a WEIGHT-priced item — for the "Record Weight" tests. */
  vendorBOrder: FixtureOrder;
}
