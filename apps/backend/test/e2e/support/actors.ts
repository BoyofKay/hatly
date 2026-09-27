/**
 * Actor and data factories (Group 8, phase 2). Everything is created through the PUBLIC HTTP API
 * exactly as the real apps/dashboard would, with two documented exceptions that mirror how
 * production itself is bootstrapped (there is no HTTP route that creates these):
 *   1. SUPER_ADMIN / ADMIN users (production: `src/scripts/bootstrap-admin.ts` writes the row directly).
 *   2. Direct DB reads for assertions and a few time-travel helpers (see `db*` helpers) — never to
 *      make a business action succeed.
 * Every factory logs the actor in over real HTTP and returns a working bearer token.
 */
import * as bcrypt from 'bcrypt';
import { Role } from '../../../src/common/enums/role.enum';
import { Permission } from '../../../src/modules/permissions/permission.enum';
import { User } from '../../../src/modules/users/entities/user.entity';
import { World } from './world';

export const DEFAULT_PASSWORD = 'E2e-Passw0rd!';

export interface Actor {
  id: string;
  phone: string;
  fullName: string;
  role: Role;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let phoneCounter = 0;
/** Unique, valid Egyptian mobile numbers in E.164 (+20 10 xxxx xxxx). */
export function nextPhone(): string {
  phoneCounter += 1;
  return `+20101${String(Date.now() % 10000).padStart(4, '0')}${String(phoneCounter).padStart(3, '0')}`.slice(0, 13);
}

export function decodeJwt(token: string): { sub: string; role: Role; phone: string; exp: number; iat: number; jti?: string } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

export function expectData<T = any>(res: { status: number; body: any }, status = 200): T {
  if (res.status !== status) {
    throw new Error(`Expected HTTP ${status} but got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data as T;
}

/**
 * A confirmed quote is required for a DELIVERY order (production-readiness slice). Fetches one for exactly the body about to
 * be submitted to `POST /orders` and attaches its `quoteToken` — the same round trip the real app always makes. Used by
 * every spec's own local order-creation helper instead of posting straight to `/orders`, so a test asserting some OTHER
 * rejection (bad address, disabled multi-vendor, insufficient stock, a flash-sale limit…) still sees THAT rejection: the
 * quote either mints a token that matches (and the real check re-validates everything again for real), or itself reports no
 * token (blocked/PICKUP-irrelevant), in which case `quoteToken` is simply omitted and the order call fails exactly as before.
 */
export async function withQuoteToken(
  world: World,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const quote = await world.api('post', '/checkout/quote', { token, body });
  const quoteToken = quote.status === 201 ? quote.body.data.quoteToken : undefined;
  return quoteToken ? { ...body, quoteToken } : body;
}

export class Scenario {
  private superAdminActor?: Actor;
  constructor(readonly world: World) {}

  // ---------- staff bootstrap (documented exception #1) ----------

  async insertStaffUser(role: Role.SUPER_ADMIN | Role.ADMIN, fullName: string): Promise<Actor> {
    const phone = nextPhone();
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 4);
    const user = await this.world.ds
      .getRepository(User)
      .save({ phone, fullName, role, passwordHash, isPhoneVerified: true, isActive: true });
    return this.login('/auth/password/login', { id: user.id, phone, fullName, role });
  }

  async superAdmin(): Promise<Actor> {
    if (!this.superAdminActor) this.superAdminActor = await this.insertStaffUser(Role.SUPER_ADMIN, 'E2E Super Admin');
    return this.superAdminActor;
  }

  /** ADMIN with exactly the given permissions, granted over HTTP by the SUPER_ADMIN (as in production). */
  async admin(permissions: Permission[], fullName = 'E2E Admin'): Promise<Actor> {
    const superAdmin = await this.superAdmin();
    const admin = await this.insertStaffUser(Role.ADMIN, fullName);
    for (const permission of permissions) {
      expectData(
        await this.world.api('post', `/admin/users/${admin.id}/permissions`, { token: superAdmin.accessToken, body: { permission } }),
        201,
      );
    }
    return admin;
  }

  // ---------- logins ----------

  async login(path: string, identity: { id?: string; phone: string; fullName: string; role: Role }, password = DEFAULT_PASSWORD): Promise<Actor> {
    const tokens = expectData<{ accessToken: string; refreshToken: string }>(
      await this.world.api('post', path, { body: { phone: identity.phone, password } }),
    );
    return {
      id: identity.id ?? decodeJwt(tokens.accessToken).sub,
      phone: identity.phone,
      fullName: identity.fullName,
      role: identity.role,
      password,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // ---------- customers ----------

  /** Customer registered through the real password-registration endpoint (no OTP needed). */
  async customer(fullName = 'E2E Customer'): Promise<Actor> {
    const phone = nextPhone();
    const tokens = expectData<{ accessToken: string; refreshToken: string }>(
      await this.world.api('post', '/auth/customer/password/register', { body: { phone, fullName, password: DEFAULT_PASSWORD } }),
    );
    return {
      id: decodeJwt(tokens.accessToken).sub,
      phone,
      fullName,
      role: Role.CUSTOMER,
      password: DEFAULT_PASSWORD,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // ---------- business configuration & geography (over HTTP as SUPER_ADMIN) ----------

  async setConfig(key: string, value: unknown): Promise<void> {
    const superAdmin = await this.superAdmin();
    expectData(await this.world.api('put', `/admin/business-config/${key}`, { token: superAdmin.accessToken, body: { value } }));
  }

  /** Registered-vendor delivery pricing. Defaults: 10 EGP / 100 m, 15 EGP minimum, 5 EGP per extra vendor. */
  async configureDeliveryPricing(p: { per100mMinor?: number; minimumMinor?: number; additionalVendorMinor?: number } = {}): Promise<void> {
    await this.setConfig('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', p.per100mMinor ?? 1000);
    await this.setConfig('REGISTERED_VENDOR_MINIMUM_DELIVERY_FEE_MINOR', p.minimumMinor ?? 1500);
    await this.setConfig('REGISTERED_VENDOR_ADDITIONAL_VENDOR_FEE_MINOR', p.additionalVendorMinor ?? 500);
  }

  async serviceArea(p: { name?: string; lat?: number; lng?: number; radiusMeters?: number } = {}): Promise<{ id: string; lat: number; lng: number }> {
    const superAdmin = await this.superAdmin();
    const lat = p.lat ?? 30.42;
    const lng = p.lng ?? 31.56;
    const area = expectData(
      await this.world.api('post', '/admin/service-areas', {
        token: superAdmin.accessToken,
        body: { name: p.name ?? `Area ${nextPhone()}`, centerLatitude: lat, centerLongitude: lng, radiusMeters: p.radiusMeters ?? 20000 },
      }),
      201,
    );
    return { id: area.id, lat, lng };
  }

  // ---------- vendors ----------

  /**
   * A fully operational vendor: vendor + branch (in a service area, delivery+pickup enabled, active),
   * a VENDOR_MANAGER staff account with a working session, and one product category.
   */
  async vendor(p: { name?: string; serviceAreaId: string; lat: number; lng: number; commissionBasisPoints?: number }): Promise<VendorFixture> {
    const superAdmin = await this.superAdmin();
    const token = superAdmin.accessToken;
    const name = p.name ?? `Vendor ${nextPhone()}`;
    const vendor = expectData(await this.world.api('post', '/admin/vendors', { token, body: { name } }), 201);
    const branch = expectData(
      await this.world.api('post', '/admin/vendor-branches', {
        token,
        body: {
          vendorId: vendor.id,
          name: `${name} Main`,
          address: '1 Test Street',
          latitude: p.lat,
          longitude: p.lng,
          serviceAreaId: p.serviceAreaId,
          deliveryEnabled: true,
          pickupEnabled: true,
          ...(p.commissionBasisPoints !== undefined ? { commissionRateBasisPoints: p.commissionBasisPoints } : {}),
        },
      }),
      201,
    );
    expectData(await this.world.api('patch', `/admin/vendors/${vendor.id}/activate`, { token }));
    expectData(await this.world.api('patch', `/admin/vendor-branches/${branch.id}/activate`, { token }));

    const staffPhone = nextPhone();
    const staff = expectData(
      await this.world.api('post', '/admin/vendor-staff', {
        token,
        body: { phone: staffPhone, fullName: `${name} Manager`, vendorBranchId: branch.id, password: DEFAULT_PASSWORD, role: Role.VENDOR_MANAGER },
      }),
      201,
    );
    const manager = await this.login('/auth/password/login', { id: staff.userId ?? staff.id, phone: staffPhone, fullName: `${name} Manager`, role: Role.VENDOR_MANAGER });
    const category = expectData(
      await this.world.api('post', '/admin/product-categories', { token, body: { vendorBranchId: branch.id, name: 'Main' } }),
      201,
    );
    return { vendorId: vendor.id, branchId: branch.id, categoryId: category.id, manager, lat: p.lat, lng: p.lng, name };
  }

  /** Creates an active marketplace sector and assigns the branch to it (needed for marketplace listing). */
  async sector(name = 'Restaurants'): Promise<{ id: string }> {
    const superAdmin = await this.superAdmin();
    const slug = `sector-${nextPhone().slice(-6)}-${Math.floor(Math.random() * 1e6)}`;
    const sector = expectData(await this.world.api('post', '/admin/sectors', { token: superAdmin.accessToken, body: { name, slug } }), 201);
    return { id: sector.id };
  }

  async assignSector(vendor: VendorFixture, sectorId: string): Promise<void> {
    const superAdmin = await this.superAdmin();
    expectData(await this.world.api('patch', `/admin/vendor-branches/${vendor.branchId}/sector`, { token: superAdmin.accessToken, body: { marketplaceSectorId: sectorId } }));
  }

  async product(
    vendor: VendorFixture,
    p: { name?: string; priceMinor?: number; pricingUnit?: 'PIECE' | 'WEIGHT'; inventoryMode?: 'OPEN' | 'TRACKED'; quantity?: number } = {},
  ): Promise<{ id: string; priceMinor: number }> {
    const superAdmin = await this.superAdmin();
    const priceMinor = p.priceMinor ?? 10000;
    const product = expectData(
      await this.world.api('post', '/admin/products', {
        token: superAdmin.accessToken,
        body: {
          vendorBranchId: vendor.branchId,
          categoryId: vendor.categoryId,
          name: p.name ?? `Product ${nextPhone()}`,
          priceMinor,
          pricingUnit: p.pricingUnit ?? 'PIECE',
          ...(p.inventoryMode ? { inventoryMode: p.inventoryMode } : {}),
          ...(p.quantity !== undefined ? { quantity: p.quantity } : {}),
        },
      }),
      201,
    );
    expectData(await this.world.api('patch', `/admin/products/${product.id}/activate`, { token: superAdmin.accessToken }));
    return { id: product.id, priceMinor };
  }

  // ---------- customers' addresses ----------

  async address(customer: Actor, p: { lat: number; lng: number; label?: string }): Promise<{ id: string }> {
    const address = expectData(
      await this.world.api('post', '/addresses', {
        token: customer.accessToken,
        body: { label: p.label ?? 'Home', line1: '9 Customer Street', latitude: p.lat, longitude: p.lng },
      }),
      201,
    );
    return { id: address.id };
  }

  // ---------- drivers ----------

  private vehicleTypeId?: string;

  private async ensureVehicleType(): Promise<string> {
    if (this.vehicleTypeId) return this.vehicleTypeId;
    const superAdmin = await this.superAdmin();
    const vt = expectData(
      await this.world.api('post', '/admin/vehicle-types', { token: superAdmin.accessToken, body: { name: 'Motorbike', maxActiveDeliveries: 2 } }),
      201,
    );
    this.vehicleTypeId = vt.id as string;
    return this.vehicleTypeId;
  }

  /**
   * A dispatch-eligible driver: created by an admin over HTTP, logs in over HTTP, goes online and
   * reports a location over HTTP.
   *
   * DOCUMENTED SEAM (exception #3): there is no HTTP endpoint anywhere that sets a driver's
   * verificationStatus to APPROVED, assigns a vehicle type, or marks the driver available — the
   * dispatch engine requires all three. Operations do it directly in the database today (see the
   * Group 8 report, "driver onboarding gap"), so the factory does the same in one UPDATE.
   */
  async driver(p: { lat: number; lng: number; fullName?: string }): Promise<DriverFixture> {
    const superAdmin = await this.superAdmin();
    const phone = nextPhone();
    const fullName = p.fullName ?? `Driver ${phone}`;
    const created = expectData(
      await this.world.api('post', '/admin/drivers', { token: superAdmin.accessToken, body: { phone, fullName, password: DEFAULT_PASSWORD } }),
      201,
    );
    const actor = await this.login('/auth/driver/login', { phone, fullName, role: Role.DRIVER });
    const vehicleTypeId = await this.ensureVehicleType();
    // Verification goes through the real admin endpoint (Driver Core + Dispatch Foundation milestone) —
    // exercises it the same way every other Scenario fixture exercises the real API, rather than reaching
    // around it. vehicle_type_id/is_available have no dedicated admin endpoint (out of this milestone's
    // scope) and stay direct SQL, same as before.
    expectData(
      await this.world.api('patch', `/admin/drivers/${created.id}/verification`, {
        token: superAdmin.accessToken,
        body: { status: 'APPROVED' },
      }),
    );
    await this.world.ds.query(`UPDATE drivers SET vehicle_type_id = $2, is_available = true WHERE user_id = $1`, [
      actor.id,
      vehicleTypeId,
    ]);
    expectData(await this.world.api('patch', '/driver/online-status', { token: actor.accessToken, body: { isOnline: true } }));
    expectData(await this.world.api('patch', '/driver/location', { token: actor.accessToken, body: { latitude: p.lat, longitude: p.lng } }));
    const [row] = await this.world.ds.query(`SELECT id FROM drivers WHERE user_id = $1`, [actor.id]);
    const fixture: DriverFixture = { ...actor, driverId: row.id ?? created.id };
    this.drivers.push(fixture);
    return fixture;
  }

  /** Every driver this scenario created, so a test can resolve WHO the dispatcher actually picked. */
  readonly drivers: DriverFixture[] = [];

  /** The driver fixture that the delivery of `orderId` is assigned to (dispatch chooses the nearest eligible driver). */
  async driverAssignedTo(orderId: string): Promise<DriverFixture> {
    const [row] = await this.world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [orderId]);
    const fixture = this.drivers.find((d) => d.driverId === row?.driver_id);
    if (!fixture) throw new Error(`No delivery/driver fixture found for order ${orderId}`);
    return fixture;
  }

  // ---------- ordering ----------

  async addToCart(customer: Actor, productId: string, quantity = 1, extra: Record<string, unknown> = {}): Promise<any> {
    return expectData(await this.world.api('post', '/cart/items', { token: customer.accessToken, body: { productId, quantity, ...extra } }), 201);
  }

  async checkout(customer: Actor, at: { lat: number; lng: number }, paymentMethod = 'COD', extra: Record<string, unknown> = {}): Promise<any> {
    const body = {
      deliveryAddress: { line1: 'Checkout Street 1', latitude: at.lat, longitude: at.lng },
      paymentMethod,
      // Both electronic payment methods must say WHICH electronic method (PD-006); InstaPay by default in the journeys.
      ...(paymentMethod === 'MANUAL_TRANSFER' || paymentMethod === 'PAY_AT_DELIVERY' ? { electronicPaymentMethod: 'INSTAPAY' } : {}),
      ...extra,
    };
    return expectData(
      await this.world.api('post', '/orders', {
        token: customer.accessToken,
        body: await withQuoteToken(this.world, customer.accessToken, body),
      }),
      201,
    );
  }

  /** One-product, single-vendor COD order — the workhorse of the authorization/lifecycle journeys. */
  async simpleOrder(customer: Actor, vendor: VendorFixture, productId: string, at: { lat: number; lng: number }, quantity = 1): Promise<any> {
    await this.addToCart(customer, productId, quantity);
    return this.checkout(customer, at);
  }

  /** The vendor drives EVERY one of their segments of the order to READY_FOR_PICKUP via the real vendor endpoints. */
  async vendorPrepares(vendor: VendorFixture, orderId: string): Promise<void> {
    const view = expectData(await this.world.api('get', `/vendor/orders/${orderId}`, { token: vendor.manager.accessToken }));
    for (const segment of view.segments) {
      for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
        expectData(
          await this.world.api('patch', `/vendor/orders/segments/${segment.id}/status`, { token: vendor.manager.accessToken, body: { status } }),
        );
      }
    }
  }
}

export interface DriverFixture extends Actor {
  driverId: string;
}

export interface VendorFixture {
  vendorId: string;
  branchId: string;
  categoryId: string;
  manager: Actor;
  lat: number;
  lng: number;
  name: string;
}
