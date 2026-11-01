import { randomInt, randomUUID } from 'crypto';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';
import { User } from '../../../src/modules/users/entities/user.entity';
import { Vendor } from '../../../src/modules/vendors/entities/vendor.entity';
import { VendorBranch } from '../../../src/modules/vendors/entities/vendor-branch.entity';
import { Order } from '../../../src/modules/orders/entities/order.entity';
import { OrderVendorSegment } from '../../../src/modules/orders/entities/order-vendor-segment.entity';
import { OrderItem } from '../../../src/modules/orders/entities/order-item.entity';
import { Payment } from '../../../src/modules/payments/entities/payment.entity';
import { Driver } from '../../../src/modules/delivery/entities/driver.entity';
import { Delivery } from '../../../src/modules/delivery/entities/delivery.entity';
import { Role } from '../../../src/common/enums/role.enum';
import { CartGroupType } from '../../../src/modules/cart/cart-group-type.enum';
import { PaymentStatus } from '../../../src/modules/payments/payment-status.enum';

type Target = new () => ObjectLiteral;

/**
 * Creates real rows in the dedicated integration database and remembers
 * every id so `dispose()` can delete exactly what this spec created —
 * newest first, so children go before their parents. (Ledger tables
 * such as wallet_transactions have no FK to users, so they are tracked
 * too rather than relying on cascades.)
 */
export class TestData {
  private readonly created: Array<{ table: string; id: string }> = [];

  constructor(private readonly dataSource: DataSource) {}

  get manager(): EntityManager {
    return this.dataSource.manager;
  }

  /** Persist and remember a row. Pass the transaction's manager to make a row part of a transaction. */
  async save<T extends ObjectLiteral>(target: Target, data: Partial<T>, manager: EntityManager = this.manager): Promise<T> {
    const saved = (await manager.save(target, manager.create(target, data as ObjectLiteral))) as unknown as T & { id: string };
    this.track(manager.getRepository(target).metadata.tableName, saved.id);
    return saved;
  }

  track(table: string, id: string): void {
    this.created.push({ table, id });
  }

  async dispose(): Promise<void> {
    for (const { table, id } of [...this.created].reverse()) {
      // rows the application itself writes next to a tracked row (segment history, dispatch attempts) go first
      if (table === 'order_vendor_segments') await this.dataSource.query('DELETE FROM order_vendor_segment_events WHERE segment_id = $1', [id]);
      // the stock ledger is written by a trigger whenever a tracked product's quantity changes; it is append-only in production (products are only ever soft-deleted)
      if (table === 'products') await this.dataSource.query('DELETE FROM stock_movements WHERE product_id = $1', [id]);
      if (table === 'orders') {
        await this.dataSource.query('DELETE FROM order_vendor_segment_events WHERE order_id = $1', [id]);
        await this.dataSource.query('DELETE FROM dispatch_attempts WHERE order_id = $1', [id]);
      }
      await this.dataSource.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
    }
    this.created.length = 0;
  }

  uniquePhone(): string {
    return `+2010${randomInt(10_000_000, 99_999_999)}`;
  }

  user(overrides: Partial<User> = {}): Promise<User> {
    return this.save<User>(User, {
      phone: this.uniquePhone(),
      fullName: 'Integration Test User',
      role: Role.CUSTOMER,
      ...overrides,
    });
  }

  async vendorBranch(): Promise<VendorBranch> {
    const vendor = await this.save<Vendor>(Vendor, { name: 'Integration Vendor', category: 'RESTAURANT' });
    return this.save<VendorBranch>(VendorBranch, {
      vendorId: vendor.id,
      name: 'Integration Branch',
      address: '1 Test St',
      latitude: 30.4,
      longitude: 31.5,
    });
  }

  async order(customerId: string, overrides: Partial<Order> = {}): Promise<Order> {
    // These fixtures insert directly (never through OrderCreationService/`nextOrderNumber`), so `order_number` needs its own
    // value here — real orders always get one from the shared sequence; this only has to satisfy the NOT NULL + UNIQUE columns.
    return this.save<Order>(Order, {
      customerId,
      orderNumber: `HT-TEST-${randomInt(1_000_000_000)}`,
      deliveryAddressSnapshot: { line1: '1 Test St', latitude: 30.4, longitude: 31.5 } as Order['deliveryAddressSnapshot'],
      subtotalMinor: 10_000,
      paymentMethod: 'COD',
      ...overrides,
    });
  }

  async segment(orderId: string, vendorBranchId: string): Promise<OrderVendorSegment> {
    return this.save<OrderVendorSegment>(OrderVendorSegment, {
      orderId,
      vendorBranchId,
      groupType: CartGroupType.CATALOG,
    });
  }

  async item(orderVendorSegmentId: string, overrides: Partial<OrderItem> = {}): Promise<OrderItem> {
    return this.save<OrderItem>(OrderItem, { orderVendorSegmentId, quantity: 1, ...overrides });
  }

  async payment(orderId: string, overrides: Partial<Payment> = {}): Promise<Payment> {
    return this.save<Payment>(Payment, { orderId, method: 'MANUAL_TRANSFER', status: PaymentStatus.PENDING, ...overrides });
  }

  async driver(userId: string, overrides: Partial<Driver> = {}): Promise<Driver> {
    return this.save<Driver>(Driver, { userId, ...overrides });
  }

  async delivery(orderId: string, driverId: string | null = null): Promise<Delivery> {
    return this.save<Delivery>(Delivery, { orderId, driverId });
  }

  newId(): string {
    return randomUUID();
  }
}
