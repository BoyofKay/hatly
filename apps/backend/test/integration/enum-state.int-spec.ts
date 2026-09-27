import { DataSource, ObjectLiteral } from 'typeorm';
import { TestData } from './support/test-data';
import { Role } from '../../src/common/enums/role.enum';
import { OrderStatus } from '../../src/modules/orders/order-status.enum';
import { OrderVendorSegmentStatus } from '../../src/modules/orders/order-vendor-segment-status.enum';
import { PaymentStatus } from '../../src/modules/payments/payment-status.enum';
import { WalletTransactionType } from '../../src/modules/wallet/wallet-transaction-type.enum';
import { LoyaltyTransactionType } from '../../src/modules/loyalty/loyalty-transaction-type.enum';
import { OfferMechanism } from '../../src/modules/offers/offer-mechanism.enum';
import { DiscountType } from '../../src/modules/offers/discount-type.enum';
import { FailedDeliveryOutcome } from '../../src/modules/failed-delivery-resolution/failed-delivery-outcome.enum';
import { DriverCashRemainderStatus } from '../../src/modules/driver-cash-remainder/driver-cash-remainder-status.enum';
import { FinancialEventDirection, FinancialEventType } from '../../src/modules/finance/financial-event-type.enum';
import { CartStatus } from '../../src/modules/cart/entities/cart.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Order } from '../../src/modules/orders/entities/order.entity';
import { OrderVendorSegment } from '../../src/modules/orders/entities/order-vendor-segment.entity';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import { Cart } from '../../src/modules/cart/entities/cart.entity';
import { WalletTransaction } from '../../src/modules/wallet/entities/wallet-transaction.entity';
import { LoyaltyPointsTransaction } from '../../src/modules/loyalty/entities/loyalty-points-transaction.entity';
import { FinancialEvent } from '../../src/modules/finance/entities/financial-event.entity';
import { FailedDeliveryResolution } from '../../src/modules/failed-delivery-resolution/entities/failed-delivery-resolution.entity';
import { DriverCashRemainder } from '../../src/modules/driver-cash-remainder/entities/driver-cash-remainder.entity';
import { Offer } from '../../src/modules/offers/entities/offer.entity';
import { Driver } from '../../src/modules/delivery/entities/driver.entity';

/**
 * Real PostgreSQL enum / state serialization. Two kinds of storage exist
 * in this schema: native PostgreSQL ENUM types (users.role, orders.status,
 * carts.status) and varchar columns guarded by CHECK constraints. Either
 * can silently disagree with the TypeScript enum that feeds it — and unit
 * tests never notice, because nothing in them talks to a real column.
 */
describe('Real PostgreSQL enum / state round-trips', () => {
  let ds: DataSource;
  let data: TestData;

  beforeAll(async () => {
    const { AppDataSource } = await import('../../src/database/data-source');
    ds = AppDataSource;
    if (!ds.isInitialized) await ds.initialize();
    data = new TestData(ds);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('every native PostgreSQL enum column declares exactly the values PostgreSQL knows (no TypeScript-only or database-only labels)', async () => {
    const problems: string[] = [];
    for (const meta of ds.entityMetadatas) {
      for (const col of meta.columns.filter((c) => c.type === 'enum')) {
        const enumName = col.enumName ?? `${meta.tableName}_${col.databaseName}_enum`;
        const rows = await ds.query(
          'SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1',
          [enumName],
        );
        const dbValues = rows.map((r: { enumlabel: string }) => r.enumlabel).sort();
        const tsValues = [...(col.enum ?? [])].map(String).sort();
        if (JSON.stringify(dbValues) !== JSON.stringify(tsValues)) {
          problems.push(`${meta.targetName}.${col.propertyName}: TypeScript=[${tsValues}] PostgreSQL=[${dbValues}]`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // ---- table-driven persist → reload for every state/type the domain stores -----------------------------------

  async function roundTrip<T extends ObjectLiteral>(
    entity: new () => T,
    prop: string,
    values: string[],
    make: (value: string) => Promise<T>,
  ): Promise<void> {
    for (const value of values) {
      const saved = (await make(value)) as T & { id: string };
      const reloaded = (await ds.getRepository(entity).findOneByOrFail({ id: saved.id } as never)) as Record<string, unknown>;
      expect({ prop, value: reloaded[prop] }).toEqual({ prop, value });
    }
  }
  const all = (e: object) => Object.values(e) as string[];

  it('User.role (native enum)', async () => {
    await roundTrip(User, 'role', all(Role), (v) => data.user({ role: v as Role }));
  });

  it('Order.status (native enum) — including FAILED_DELIVERY, which the state machine writes', async () => {
    const customer = await data.user();
    await roundTrip(Order, 'status', all(OrderStatus), (v) => data.order(customer.id, { status: v as OrderStatus }));
    expect(all(OrderStatus)).toContain('FAILED_DELIVERY');
  });

  it('Cart.status (native enum)', async () => {
    await roundTrip(Cart, 'status', [CartStatus.ORDERED], async (v) => {
      const customer = await data.user();
      return data.save<Cart>(Cart, { customerId: customer.id, status: v as CartStatus });
    });
    const customer = await data.user();
    const active = await data.save<Cart>(Cart, { customerId: customer.id, status: CartStatus.ACTIVE });
    expect((await ds.getRepository(Cart).findOneByOrFail({ id: active.id })).status).toBe('ACTIVE');
  });

  it('OrderVendorSegment.status', async () => {
    const customer = await data.user();
    const branch = await data.vendorBranch();
    const order = await data.order(customer.id);
    await roundTrip(OrderVendorSegment, 'status', all(OrderVendorSegmentStatus), async (v) => {
      const seg = await data.segment(order.id, branch.id);
      seg.status = v as OrderVendorSegmentStatus;
      return ds.getRepository(OrderVendorSegment).save(seg);
    });
  });

  it('Payment.status', async () => {
    const customer = await data.user();
    const order = await data.order(customer.id);
    await roundTrip(Payment, 'status', all(PaymentStatus), (v) => data.payment(order.id, { status: v as PaymentStatus }));
  });

  it('Driver.verificationStatus', async () => {
    await roundTrip(Driver, 'verificationStatus', ['PENDING', 'APPROVED', 'REJECTED'], async (v) => {
      const u = await data.user({ role: Role.DRIVER });
      return data.driver(u.id, { verificationStatus: v as Driver['verificationStatus'] });
    });
  });

  it('WalletTransaction.type — every TypeScript value is accepted by the CHECK constraint', async () => {
    const customer = await data.user();
    await roundTrip(WalletTransaction, 'type', all(WalletTransactionType), (v) =>
      data.save<WalletTransaction>(WalletTransaction, {
        customerId: customer.id,
        amountDeltaMinor: 100,
        type: v as WalletTransactionType,
        reason: 'enum',
        idempotencyKey: `enum-${customer.id}-${v}`,
      }),
    );
  });

  it('LoyaltyPointsTransaction.type — every TypeScript value is accepted by the CHECK constraint', async () => {
    const customer = await data.user();
    await roundTrip(LoyaltyPointsTransaction, 'type', all(LoyaltyTransactionType), (v) =>
      data.save<LoyaltyPointsTransaction>(LoyaltyPointsTransaction, {
        customerId: customer.id,
        pointsDelta: 10,
        type: v as LoyaltyTransactionType,
        reason: 'enum',
        idempotencyKey: `enum-${customer.id}-${v}`,
      }),
    );
  });

  it('FinancialEvent.type and .direction — every value fits its column (length, constraints) and reloads unchanged', async () => {
    let i = 0;
    await roundTrip(FinancialEvent, 'type', all(FinancialEventType), (v) =>
      data.save<FinancialEvent>(FinancialEvent, {
        type: v as FinancialEventType,
        direction: FinancialEventDirection.INFORMATIONAL,
        idempotencyKey: `enum-type-${data.newId()}-${i++}`,
      }),
    );
    await roundTrip(FinancialEvent, 'direction', all(FinancialEventDirection), (v) =>
      data.save<FinancialEvent>(FinancialEvent, {
        type: FinancialEventType.FAILED_DELIVERY_RECORDED,
        direction: v as FinancialEventDirection,
        idempotencyKey: `enum-dir-${data.newId()}-${i++}`,
      }),
    );
  });

  it('FailedDeliveryResolution.outcome (with its refund-amount CHECK)', async () => {
    const admin = await data.user({ role: Role.ADMIN });
    await roundTrip(FailedDeliveryResolution, 'outcome', all(FailedDeliveryOutcome), async (v) => {
      const customer = await data.user();
      const order = await data.order(customer.id, { status: OrderStatus.FAILED_DELIVERY });
      return data.save<FailedDeliveryResolution>(FailedDeliveryResolution, {
        orderId: order.id,
        outcome: v as FailedDeliveryOutcome,
        refundAmountMinor: v === FailedDeliveryOutcome.REFUND_CUSTOMER ? 5_000 : null,
        resolvedByUserId: admin.id,
        resolvedAt: new Date(),
      });
    });
  });

  it('DriverCashRemainder.status', async () => {
    await roundTrip(DriverCashRemainder, 'status', all(DriverCashRemainderStatus), async (v) => {
      const customer = await data.user();
      const driverUser = await data.user({ role: Role.DRIVER });
      const driver = await data.driver(driverUser.id);
      const order = await data.order(customer.id);
      const delivery = await data.delivery(order.id, driver.id);
      return data.save<DriverCashRemainder>(DriverCashRemainder, {
        orderId: order.id,
        deliveryId: delivery.id,
        driverId: driver.id,
        customerId: customer.id,
        remainderAmountMinor: 2_500,
        status: v as DriverCashRemainderStatus,
        submittedAt: new Date(),
      });
    });
  });

  it('Offer.mechanism / discountType (with the mechanism-fields CHECK)', async () => {
    const branch = await data.vendorBranch();
    const window = { startAt: new Date('2030-01-01T00:00:00Z'), endAt: new Date('2030-02-01T00:00:00Z') };
    await roundTrip(Offer, 'mechanism', all(OfferMechanism), (v) =>
      data.save<Offer>(Offer, {
        vendorBranchId: branch.id,
        name: `enum-${v}`,
        ...window,
        mechanism: v as OfferMechanism,
        ...(v === OfferMechanism.FLASH_SALE
          ? { specialPriceMinor: 900 }
          : { discountType: DiscountType.PERCENTAGE, discountValue: 1_000 }),
      }),
    );
    await roundTrip(Offer, 'discountType', all(DiscountType), (v) =>
      data.save<Offer>(Offer, {
        vendorBranchId: branch.id,
        name: `enum-dt-${v}`,
        ...window,
        mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
        discountType: v as DiscountType,
        discountValue: v === DiscountType.PERCENTAGE ? 1_000 : 500,
      }),
    );
  });

  it('PostgreSQL REJECTS a value outside the enum/CHECK set (the database, not just TypeScript, guards state)', async () => {
    const customer = await data.user();
    await expect(
      ds.query('INSERT INTO orders (customer_id, delivery_address_snapshot, subtotal_minor, payment_method, status) VALUES ($1, $2, 1, $3, $4)', [
        customer.id, '{}', 'COD', 'NOT_A_STATUS',
      ]),
    ).rejects.toMatchObject({ code: '22P02' }); // invalid_text_representation (enum)
    await expect(
      ds.query(
        'INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key) VALUES ($1, 100, $2, $3)',
        [customer.id, 'NOT_A_TYPE', `bad-${customer.id}`],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
