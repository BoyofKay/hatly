import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import axios from 'axios';
import { API_BASE_URL, STORAGE_STATE_DIR, TOKENS_FILE } from './env';

/**
 * Fixtures for the Hatly Service pricing specs — real HTTP against the real backend, like `global-setup.ts`: a throwaway customer
 * (registered through the public endpoint), a real Hatly Service cart and a real order (UNPRICED, COD). Needs the same dev
 * prerequisites as the app itself: an active delivery zone (`npm run seed:dev-delivery-zones`) and
 * `HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER` (PD-009) set in the dev database (the Hatly Service charge fails closed without either).
 */
const api = axios.create({ baseURL: API_BASE_URL, validateStatus: () => true });

export interface PendingHatlyOrder {
  orderId: string;
  orderNumber: string;
  itemIds: string[];
  deliveryFeeMinor: number;
}

// PD-009 (amended): Hatly Service is served and priced by the address's ACTIVE delivery zone (zone fee × multiplier); the pin is
// kept on purpose — it plays no part in the price. The zone is taken from the backend's own active-zone list at run time.
const ADDRESS = { line1: 'Playwright Hatly Service Street 1', latitude: 30.4181, longitude: 31.5622 };

async function activeZoneId(customer: CustomerApi): Promise<string> {
  const res = await customer.get('/delivery-zones');
  const zone = res.status === 200 ? (res.data.data as Array<{ id: string }>)[0] : undefined;
  if (!zone) throw new Error(`No active delivery zone in the dev database (GET /delivery-zones → HTTP ${res.status}). Run "npm run seed:dev-delivery-zones".`);
  return zone.id;
}

function phone() {
  return `+20101${String(Date.now() % 10000).padStart(4, '0')}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`.slice(0, 13);
}

const CUSTOMER_FILE = `${STORAGE_STATE_DIR}/hatly-service-customer.json`;
const CUSTOMER_REUSE_MS = 10 * 60 * 1000;

const bearer = (accessToken: string) => axios.create({ baseURL: API_BASE_URL, headers: { Authorization: `Bearer ${accessToken}` }, validateStatus: () => true });

/**
 * One throwaway customer for the whole run. `customer/password/register` is throttled (5/60s) and Playwright restarts its worker
 * after a failing test (re-running `beforeAll`), so the session is kept in a small file and reused for 10 minutes instead of
 * registering again each time — the same reason `global-setup.ts` registers exactly one customer.
 */
export async function registerCustomerApi() {
  if (existsSync(CUSTOMER_FILE) && Date.now() - statSync(CUSTOMER_FILE).mtimeMs < CUSTOMER_REUSE_MS) {
    const { accessToken } = JSON.parse(readFileSync(CUSTOMER_FILE, 'utf8'));
    const api = bearer(accessToken);
    if ((await api.get('/cart')).status === 200) return api;
  }
  const res = await axios.post(`${API_BASE_URL}/auth/customer/password/register`, { phone: phone(), fullName: 'Playwright Hatly Customer', password: 'Playwright-Dev-1!' }, { validateStatus: () => true });
  if (res.status !== 201 && res.status !== 200) throw new Error(`Could not register the fixture customer: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  const { accessToken } = res.data.data;
  writeFileSync(CUSTOMER_FILE, JSON.stringify({ accessToken }));
  return bearer(accessToken);
}

export type CustomerApi = Awaited<ReturnType<typeof registerCustomerApi>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One real UNPRICED Hatly Service order with `descriptions.length` requests. Order creation is rate limited (10/min per client) and
 * the same dev backend also serves global-setup and manual traffic, so a 429 is waited out and the whole attempt repeated from an
 * emptied cart (a failed attempt leaves its items in the cart).
 */
export async function placePendingHatlyOrder(customer: CustomerApi, descriptions: string[]): Promise<PendingHatlyOrder> {
  for (let attempt = 1; ; attempt++) {
    await customer.delete('/cart');
    const result = await tryPlacePendingHatlyOrder(customer, descriptions);
    if (result !== 'THROTTLED') return result;
    if (attempt >= 6) throw new Error('Hatly Service order creation stayed throttled (HTTP 429) for over a minute.');
    await sleep(12_000);
  }
}

async function tryPlacePendingHatlyOrder(customer: CustomerApi, descriptions: string[]): Promise<PendingHatlyOrder | 'THROTTLED'> {
  const fail = (what: string, res: { status: number; data: unknown }) => new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  const first = await customer.post('/cart/adhoc-items', {
    adHocPlaceName: 'Playwright Corner Pharmacy',
    adHocServiceType: 'BUY_FROM_PLACE',
    // PD-012: a route has two ends; both are chosen here so the fixture does not depend on any configured default.
    pickupLatitude: 30.3,
    pickupLongitude: 31.45,
    pickupLabel: 'Playwright Corner Pharmacy',
    destinationLatitude: 30.31,
    destinationLongitude: 31.46,
    destinationLabel: 'Playwright drop-off',
    freeTextDescription: descriptions[0],
    quantity: 1,
  });
  if (first.status === 429) return 'THROTTLED';
  if (first.status !== 201) throw fail('Could not add the Hatly Service request', first);
  if (descriptions.length > 1) {
    const cart = await customer.get('/cart');
    const groupId = cart.data.data.groups[0].id;
    for (const freeTextDescription of descriptions.slice(1)) {
      const more = await customer.post('/cart/adhoc-items', { cartVendorGroupId: groupId, freeTextDescription, quantity: 1 });
      if (more.status === 429) return 'THROTTLED';
      if (more.status !== 201) throw fail('Could not add another Hatly Service request', more);
    }
  }
  const body = { deliveryAddress: { ...ADDRESS, deliveryZoneId: await activeZoneId(customer) }, paymentMethod: 'COD' };
  const quote = await customer.post('/checkout/quote', body);
  if (quote.status === 429) return 'THROTTLED';
  if (quote.status !== 201 || !quote.data.data.quoteToken) throw fail('Hatly Service quote failed', quote);
  const order = await customer.post('/orders', { ...body, quoteToken: quote.data.data.quoteToken });
  if (order.status === 429) return 'THROTTLED';
  if (order.status !== 201) throw fail('Hatly Service order failed', order);
  const created = order.data.data;
  return {
    orderId: created.id,
    orderNumber: created.orderNumber,
    itemIds: created.segments[0].items.map((i: any) => i.id),
    deliveryFeeMinor: Number(created.deliveryFeeMinor),
  };
}

/** The SUPER_ADMIN session `global-setup.ts` already persisted — used only to read/confirm out-of-band, never in the browser. */
function adminToken(): string {
  return JSON.parse(readFileSync(TOKENS_FILE, 'utf8')).superAdmin as string;
}

const adminApi = () => axios.create({ baseURL: API_BASE_URL, headers: { Authorization: `Bearer ${adminToken()}` }, validateStatus: () => true });

export async function adminOrderDetail(orderId: string) {
  const res = await adminApi().get(`/admin/orders/${orderId}`);
  if (res.status !== 200) throw new Error(`Admin order detail failed: HTTP ${res.status}`);
  return res.data.data;
}

/** Confirms a price straight through the API (what another admin would do while this admin's page is open). */
export async function confirmPriceViaApi(itemId: string, amountMinor: number) {
  return adminApi().post(`/admin/orders/items/${itemId}/confirm-price`, { amountMinor });
}

export const formatMinorForTest = (minor: number) => (minor / 100).toFixed(2);
