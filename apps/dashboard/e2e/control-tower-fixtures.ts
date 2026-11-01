import { readFileSync } from 'fs';
import axios, { AxiosInstance } from 'axios';
import { API_BASE_URL, TOKENS_FILE, VENDOR_A_PRODUCT_ID } from './env';
import { registerCustomerApi } from './hatly-service-fixtures';

/**
 * Control Tower fixtures — real HTTP against the real dev backend, using only the product's own operations: a customer places
 * a delivery order, the Vendor A manager prepares it (which triggers the existing automatic dispatch), test drivers are
 * created/approved by the SUPER_ADMIN and go online through the driver API, a driver can hand an order back (the existing
 * driver release). Nothing is written to the database directly. Automatic dispatch may pick ANY eligible dev driver, so tests
 * read who was assigned instead of assuming it.
 */
const api = (token: string): AxiosInstance =>
  axios.create({ baseURL: API_BASE_URL, headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
const tokenFor = (who: 'superAdmin' | 'vendorA' | 'vendorB') => JSON.parse(readFileSync(TOKENS_FILE, 'utf8'))[who] as string;

export const adminApi = () => api(tokenFor('superAdmin'));
export const vendorApi = () => api(tokenFor('vendorA'));

function must<T = any>(res: { status: number; data: any }, what: string, ok = [200, 201]): T {
  if (!ok.includes(res.status)) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  return res.data?.data;
}

// Belbeis center — inside the dev service area of Vendor A's branch (the same point the fixture orders deliver to).
const BELBEIS = { latitude: 30.4181, longitude: 31.5622 };

export interface TestDriver {
  id: string;
  fullName: string;
  api: AxiosInstance;
}

/** A dispatch-eligible driver created the real way: admin creates + approves, driver logs in, goes online, reports location. */
export async function createOnlineDriver(label: string): Promise<TestDriver> {
  const stamp = `${Date.now()}`.slice(-8);
  const phone = `+2010${stamp}`;
  const fullName = `PW Tower ${label} ${stamp}`;
  const password = 'Playwright-Dev-1!';
  const created = must(await adminApi().post('/admin/drivers', { phone, fullName, password }), 'create driver');
  must(await adminApi().patch(`/admin/drivers/${created.id}/verification`, { status: 'APPROVED' }), 'approve driver');
  const login = must(await axios.post(`${API_BASE_URL}/auth/driver/login`, { phone, password }, { validateStatus: () => true }), 'driver login');
  const driverApi = api(login.accessToken);
  must(await driverApi.patch('/driver/online-status', { isOnline: true }), 'driver online');
  must(await driverApi.patch('/driver/location', BELBEIS), 'driver location');
  return { id: created.id, fullName, api: driverApi };
}

export async function takeOffline(driver: TestDriver) {
  await driver.api.patch('/driver/online-status', { isOnline: false });
}

/** Places a COD delivery order of Vendor A's product and has the vendor prepare it to READY_FOR_PICKUP (→ automatic dispatch). */
export async function placeReadyOrder(): Promise<{ orderId: string; orderNumber: string; segmentId: string }> {
  const customer = await registerCustomerApi();
  await customer.delete('/cart');
  must(await customer.post('/cart/items', { productId: VENDOR_A_PRODUCT_ID, quantity: 1 }), 'add to cart');
  const deliveryAddress = { line1: 'Playwright Control Tower Street 1', latitude: BELBEIS.latitude, longitude: BELBEIS.longitude };
  const quote = must(await customer.post('/checkout/quote', { deliveryAddress, paymentMethod: 'COD' }), 'quote');
  const order = must(await customer.post('/orders', { deliveryAddress, paymentMethod: 'COD', quoteToken: quote.quoteToken }), 'place order');
  const segmentId = order.segments[0].id;
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    must(await vendorApi().patch(`/vendor/orders/segments/${segmentId}/status`, { status }), `vendor → ${status}`);
  }
  return { orderId: order.id, orderNumber: order.orderNumber, segmentId };
}

export async function orderDetail(orderId: string) {
  return must(await adminApi().get(`/admin/orders/${orderId}`), 'admin order detail');
}

/** The admin API reassigns the order to `driverId` (what ANOTHER admin does while this one has the page open). */
export async function reassignViaApi(orderId: string, driverId: string) {
  return adminApi().post(`/admin/orders/${orderId}/reassign-driver`, { driverId });
}

/** Makes sure `driver` is the one on the order (reassigning to them through the API if automatic dispatch picked someone else). */
export async function ensureAssignedTo(orderId: string, driver: TestDriver) {
  const detail = await orderDetail(orderId);
  if (detail.status === 'READY_FOR_PICKUP') must(await adminApi().post(`/admin/orders/${orderId}/assign-driver`, { driverId: driver.id }), 'assign');
  else if (detail.driver?.id !== driver.id) must(await reassignViaApi(orderId, driver.id), 'reassign');
}

/** The assigned test driver hands the order back (the existing driver release: ASSIGNED_TO_DRIVER → READY_FOR_PICKUP). */
export async function releaseByDriver(orderId: string, driver: TestDriver) {
  const deliveries = must<any[]>(await driver.api.get('/driver/deliveries'), 'driver deliveries');
  const delivery = deliveries.find((d) => d.orderId === orderId);
  if (!delivery) throw new Error(`Driver ${driver.fullName} has no delivery for order ${orderId}`);
  must(await driver.api.patch(`/driver/deliveries/${delivery.id}/status`, { status: 'READY_FOR_PICKUP' }), 'driver release');
}

/**
 * Cleanup: an assigned order is handed back by the ADMIN (the existing ASSIGNED_TO_DRIVER → READY_FOR_PICKUP admin
 * transition — which, unlike a driver's hand-back, never triggers the U3 redispatch), then the vendor cancels it (with the reason the API requires), so no test
 * order is left in operation and its driver is free again (the state machine frees whoever held it).
 */
export async function cancelTestOrder(order: { orderId: string; segmentId: string }) {
  const detail = await orderDetail(order.orderId);
  // Already over (the test itself cancelled / completed it): nothing to clean up.
  if (['CANCELLED', 'DELIVERED', 'COLLECTED', 'FAILED_DELIVERY'].includes(detail.status)) return;
  if (detail.status === 'ASSIGNED_TO_DRIVER') {
    must(await adminApi().patch(`/orders/${order.orderId}/status`, { status: 'READY_FOR_PICKUP' }), 'admin hand-back for cleanup');
  }
  // The API REQUIRES a reason for a vendor cancellation (400 without one). The first version of this helper sent none and ignored the
  // answer, so no fixture order was ever cancelled: they piled up at READY_FOR_PICKUP and automatic dispatch later handed them to the
  // next run's test drivers (intermittent DRIVER_UNAVAILABLE / NO_AVAILABLE_DRIVER). The answer is now checked.
  const res = await vendorApi().patch(`/vendor/orders/segments/${order.segmentId}/status`, { status: 'CANCELLED', reason: 'Playwright fixture cleanup' });
  const after = (await orderDetail(order.orderId)).status as string;
  const cancellable = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'].includes(detail.status);
  if (cancellable && after !== 'CANCELLED') throw new Error(`cleanup: the vendor could not cancel test order ${order.orderId} (was ${detail.status}, now ${after}): HTTP ${res.status} ${JSON.stringify(res.data)}`);
}

/**
 * Runs `fn` with AUTOMATIC_DISPATCH_ENABLED set to `enabled`, restoring the dev backend's previous value afterwards, always.
 * Needed since U3: with automatic dispatch on, a driver's hand-back is redispatched at once, so a test of the MANUAL
 * waiting/assignment flow pins it off for its own duration.
 */
export async function withAutomaticDispatch<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const previous = must<{ value: unknown }>(await adminApi().get('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED'), 'read dispatch switch').value;
  must(await adminApi().put('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED', { value: enabled }), 'set dispatch switch');
  try {
    return await fn();
  } finally {
    if (previous !== null && previous !== undefined) {
      must(await adminApi().put('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED', { value: previous }), 'restore dispatch switch');
    }
  }
}

/**
 * Pins Automatic Dispatch for the length of a test that assigns drivers by hand and returns the function that puts the previous setting back.
 * With it ON, the dev database's many ready orders keep claiming every online driver in the background, so a driver the test just picked can be
 * "busy" a moment later — the backend then (correctly) refuses the manual assignment. The backend's availability rule is untouched.
 */
export async function pinAutomaticDispatch(enabled: boolean): Promise<() => Promise<void>> {
  const previous = must<{ value: unknown }>(await adminApi().get('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED'), 'read dispatch switch').value;
  must(await adminApi().put('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED', { value: enabled }), 'set dispatch switch');
  return async () => {
    if (previous !== null && previous !== undefined) must(await adminApi().put('/admin/business-config/AUTOMATIC_DISPATCH_ENABLED', { value: previous }), 'restore dispatch switch');
  };
}

/** A placed COD order of Vendor A's product that nobody has accepted yet (vendor part PENDING) — what a vendor sees as a brand-new order. */
export async function placeNewOrder(): Promise<{ orderId: string; orderNumber: string; segmentId: string }> {
  const customer = await registerCustomerApi();
  await customer.delete('/cart');
  must(await customer.post('/cart/items', { productId: VENDOR_A_PRODUCT_ID, quantity: 1 }), 'add to cart');
  const deliveryAddress = { line1: 'Playwright Operations Street 1', latitude: BELBEIS.latitude, longitude: BELBEIS.longitude };
  const quote = must(await customer.post('/checkout/quote', { deliveryAddress, paymentMethod: 'COD' }), 'quote');
  const order = must(await customer.post('/orders', { deliveryAddress, paymentMethod: 'COD', quoteToken: quote.quoteToken }), 'place order');
  return { orderId: order.id, orderNumber: order.orderNumber, segmentId: order.segments[0].id };
}
