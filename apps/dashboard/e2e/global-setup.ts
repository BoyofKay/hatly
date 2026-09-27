import { mkdirSync, writeFileSync } from 'fs';
import axios from 'axios';
import type { FullConfig } from '@playwright/test';
import {
  API_BASE_URL,
  DASHBOARD_BASE_URL,
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_PASSWORD,
  VENDOR_A_PHONE,
  VENDOR_A_PASSWORD,
  VENDOR_A_BRANCH_ID,
  VENDOR_A_FULL_NAME,
  VENDOR_A_PRODUCT_ID,
  VENDOR_B_PHONE,
  VENDOR_B_PASSWORD,
  VENDOR_B_BRANCH_ID,
  VENDOR_B_FULL_NAME,
  VENDOR_B_WEIGHT_PRODUCT_ID,
  STORAGE_STATE_DIR,
  VENDOR_A_STORAGE_STATE,
  VENDOR_B_STORAGE_STATE,
  FIXTURE_FILE,
  Fixtures,
  FixtureOrder,
} from './env';

const api = axios.create({ baseURL: API_BASE_URL, validateStatus: () => true });

async function loginPassword(phone: string, password: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  const res = await api.post('/auth/password/login', { phone, password });
  return res.status === 200 ? res.data.data : null;
}

/** Idempotent: creates the Vendor Manager fixture if it doesn't exist yet, reuses it otherwise. */
async function ensureVendorManager(superAdminToken: string, phone: string, fullName: string, vendorBranchId: string, password: string) {
  const res = await api.post(
    '/admin/vendor-staff',
    { phone, fullName, vendorBranchId, password, role: 'VENDOR_MANAGER' },
    { headers: { Authorization: `Bearer ${superAdminToken}` } },
  );
  if (res.status === 201) {
    console.log(`[global-setup] Created Vendor Manager fixture: ${phone} (${fullName}).`);
  } else if (res.status === 409 && res.data?.error?.details?.code === 'PHONE_ALREADY_REGISTERED') {
    console.log(`[global-setup] Vendor Manager fixture already exists: ${phone} — reusing.`);
  } else {
    throw new Error(
      `[global-setup] Failed to provision Vendor Manager fixture ${phone}: HTTP ${res.status} ${JSON.stringify(res.data)}. ` +
        `See e2e/README.md — this usually means the SUPER_ADMIN dev credential documented there is stale.`,
    );
  }
}

function storageStateFor(accessToken: string, refreshToken: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: DASHBOARD_BASE_URL,
        localStorage: [
          { name: 'hatly_dashboard_token', value: accessToken },
          { name: 'hatly_dashboard_refresh_token', value: refreshToken },
        ],
      },
    ],
  };
}

/**
 * Registers exactly ONE throwaway customer for the whole fixture run. `customer/password/register`
 * is throttled (5/60s) — registering a fresh customer PER fixture order (4 of them) burned through
 * that budget and made global-setup itself flaky depending on how much manual/API traffic had
 * already hit this same dev backend. One registration, reused for every fixture order below (a
 * cart is cleared/consumed once its order is placed, so the same customer can safely place several
 * independent orders back to back), is both faster and immune to that throttle entirely.
 */
async function registerFixtureCustomer() {
  // Same shape as apps/backend/test/e2e/support/actors.ts's own `nextPhone()` — a valid Egyptian
  // mobile number (+20 10 xxxx xxxx), unique per run via the current timestamp.
  const phone = `+20101${String(Date.now() % 10000).padStart(4, '0')}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`.slice(0, 13);
  const password = 'Playwright-Dev-1!';
  // Registration itself returns a working session (no separate /auth/customer/password/login round
  // trip needed) — reusing the STAFF `loginPassword()` helper here would silently fail: it calls
  // `/auth/password/login`, which correctly rejects a CUSTOMER-role phone number.
  const register = await api.post('/auth/customer/password/register', { phone, fullName: 'Playwright Customer', password });
  if (register.status !== 201 && register.status !== 200) {
    throw new Error(`[global-setup] Failed to register the fixture customer: HTTP ${register.status} ${JSON.stringify(register.data)}`);
  }
  const { accessToken } = register.data.data;
  return axios.create({ baseURL: API_BASE_URL, headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true });
}

/**
 * Places one fresh order, from the shared fixture customer, against a single product on the given
 * branch — deterministic and immune to leftover state from a previous run (a fixture order must be
 * brand new so its segment status starts at PENDING every time, exactly what the Vendor
 * order-detail tests need). Real cart → real checkout quote → real order creation, over real HTTP,
 * exactly what the Customer app itself does.
 */
async function placeFixtureOrder(
  customerApi: ReturnType<typeof axios.create>,
  productId: string,
  branchId: string,
  cartItem: { quantity: number; requestedWeightGrams?: number },
): Promise<FixtureOrder> {
  const cartAdd = await customerApi.post('/cart/items', { productId, ...cartItem });
  if (cartAdd.status !== 201 && cartAdd.status !== 200) {
    throw new Error(`[global-setup] Failed to add the fixture product ${productId} to cart: HTTP ${cartAdd.status} ${JSON.stringify(cartAdd.data)}`);
  }

  const deliveryAddress = { line1: 'Playwright Test Street 1', latitude: 30.4181, longitude: 31.5622 };
  const quote = await customerApi.post('/checkout/quote', { deliveryAddress, paymentMethod: 'COD' });
  const quoteToken = quote.data?.data?.quoteToken;
  if (quote.status !== 201 || !quoteToken) {
    throw new Error(`[global-setup] Failed to obtain a checkout quote for the fixture order: HTTP ${quote.status} ${JSON.stringify(quote.data)}`);
  }

  const order = await customerApi.post('/orders', { deliveryAddress, paymentMethod: 'COD', quoteToken });
  if (order.status !== 201) {
    throw new Error(`[global-setup] Failed to place the fixture order: HTTP ${order.status} ${JSON.stringify(order.data)}`);
  }
  const created = order.data.data;
  const segment = created.segments.find((s: any) => s.vendorBranchId === branchId);
  if (!segment) throw new Error(`[global-setup] The fixture order has no segment for the expected branch ${branchId}.`);
  return { orderId: created.id, segmentId: segment.id, itemId: segment.items[0].id, orderNumber: created.orderNumber };
}

/**
 * Runs once before the whole Playwright suite. Provisions everything the Vendor Dashboard specs
 * need through the REAL backend HTTP API (no direct database writes, no shortcuts) — the exact
 * same primitives `seed-dev-marketplace.ts`/`bootstrap-admin.ts` document as this repository's own
 * accepted dev-fixture mechanisms. See e2e/README.md for the one-time manual step this still
 * requires (a known SUPER_ADMIN dev password) and why it can't be fully self-bootstrapping.
 */
export default async function globalSetup(_config: FullConfig) {
  mkdirSync(STORAGE_STATE_DIR, { recursive: true });

  const superAdmin = await loginPassword(SUPER_ADMIN_PHONE, SUPER_ADMIN_PASSWORD);
  if (!superAdmin) {
    throw new Error(
      `[global-setup] Could not log in as the dev SUPER_ADMIN (${SUPER_ADMIN_PHONE}) against ${API_BASE_URL}. ` +
        'See e2e/README.md — the fixture accounts below cannot be provisioned without this.',
    );
  }

  await ensureVendorManager(superAdmin.accessToken, VENDOR_A_PHONE, VENDOR_A_FULL_NAME, VENDOR_A_BRANCH_ID, VENDOR_A_PASSWORD);
  await ensureVendorManager(superAdmin.accessToken, VENDOR_B_PHONE, VENDOR_B_FULL_NAME, VENDOR_B_BRANCH_ID, VENDOR_B_PASSWORD);

  const vendorA = await loginPassword(VENDOR_A_PHONE, VENDOR_A_PASSWORD);
  const vendorB = await loginPassword(VENDOR_B_PHONE, VENDOR_B_PASSWORD);
  if (!vendorA || !vendorB) throw new Error('[global-setup] A Vendor Manager fixture account exists but could not log in.');

  writeFileSync(VENDOR_A_STORAGE_STATE, JSON.stringify(storageStateFor(vendorA.accessToken, vendorA.refreshToken), null, 2));
  writeFileSync(VENDOR_B_STORAGE_STATE, JSON.stringify(storageStateFor(vendorB.accessToken, vendorB.refreshToken), null, 2));

  const customerApi = await registerFixtureCustomer();
  const vendorAOrders = [
    await placeFixtureOrder(customerApi, VENDOR_A_PRODUCT_ID, VENDOR_A_BRANCH_ID, { quantity: 2 }),
    await placeFixtureOrder(customerApi, VENDOR_A_PRODUCT_ID, VENDOR_A_BRANCH_ID, { quantity: 1 }),
    await placeFixtureOrder(customerApi, VENDOR_A_PRODUCT_ID, VENDOR_A_BRANCH_ID, { quantity: 3 }),
  ];
  const vendorBOrder = await placeFixtureOrder(customerApi, VENDOR_B_WEIGHT_PRODUCT_ID, VENDOR_B_BRANCH_ID, { quantity: 1, requestedWeightGrams: 1000 });
  writeFileSync(FIXTURE_FILE, JSON.stringify({ vendorAOrders, vendorBOrder } satisfies Fixtures, null, 2));
  console.log(`[global-setup] ${vendorAOrders.length} fixture orders ready for Vendor A: ${vendorAOrders.map((o) => o.orderNumber).join(', ')}.`);
  console.log(`[global-setup] Fixture order ${vendorBOrder.orderNumber} (${vendorBOrder.orderId}) ready for Vendor B.`);
}
