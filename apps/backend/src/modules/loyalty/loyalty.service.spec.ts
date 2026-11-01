import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyTransactionType } from './loyalty-transaction-type.enum';
import { Order } from '../orders/entities/order.entity';
import { OrderVendorSegment } from '../orders/entities/order-vendor-segment.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { WalletService } from '../wallet/wallet.service';
import { LoyaltyPointsTransaction } from './entities/loyalty-points-transaction.entity';

function buildHarness() {
  const store = new Map<string, any>();
  const repository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
      store.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => [...store.values()].filter((t) => t.customerId === opts.where.customerId),
  };
  // CRITICAL REGRESSION FIX (Loyalty Earning, Chunk C): LoyaltyService's
  // constructor now also requires BusinessConfigService — without this
  // stub, every existing Chunk A test below would throw at
  // construction time.
  const businessConfigService = { getLoyaltyPointsPerEgp: jest.fn(async () => 1) };
  const dataSource = { transaction: async (cb: any) => cb({} as any) };
  const walletService = { recordTransaction: jest.fn(async () => undefined), getBalance: jest.fn(async () => 0) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const service = new LoyaltyService(repository as any, businessConfigService as any, dataSource as any, walletService as any, requestContextService as any);
  return { service, store };
}

/** Fake-repository key match that understands TypeORM's In([...]) operator (conversions look up the namespaced AND the legacy raw key). */
const keyMatches = (stored: unknown, wanted: any): boolean =>
  wanted && typeof wanted === 'object' && Array.isArray(wanted.value) ? wanted.value.includes(stored) : stored === wanted;

describe('LoyaltyService (Loyalty Ledger Foundation)', () => {
  it('creates a positive loyalty transaction (earning)', async () => {
    const { service, store } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      pointsDelta: 500,
      type: LoyaltyTransactionType.EARNING,
      orderId: 'order-1',
    });
    expect(tx.pointsDelta).toBe(500);
    expect(tx.type).toBe(LoyaltyTransactionType.EARNING);
    expect(store.size).toBe(1);
  });

  it('creates a negative loyalty transaction (reversal)', async () => {
    const { service } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      pointsDelta: -500,
      type: LoyaltyTransactionType.EARNING_REVERSED,
      orderId: 'order-1',
    });
    expect(tx.pointsDelta).toBe(-500);
  });

  it('CRITICAL: balance is correctly calculated from multiple transactions (positive and negative)', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({ customerId: 'customer-1', pointsDelta: 500, type: LoyaltyTransactionType.EARNING });
    await service.recordTransaction({ customerId: 'customer-1', pointsDelta: 200, type: LoyaltyTransactionType.EARNING });
    await service.recordTransaction({
      customerId: 'customer-1',
      pointsDelta: -300,
      type: LoyaltyTransactionType.REDEMPTION,
    });
    const balance = await service.getBalance('customer-1');
    expect(balance).toBe(400); // 500 + 200 - 300
  });

  it('CRITICAL: a customer with no transactions returns a balance of 0', async () => {
    const { service } = buildHarness();
    const balance = await service.getBalance('customer-with-no-history');
    expect(balance).toBe(0);
  });

  it('orderId is nullable — an ADMIN_ADJUSTMENT with no Order is accepted', async () => {
    const { service } = buildHarness();
    const tx = await service.recordTransaction({
      customerId: 'customer-1',
      pointsDelta: 100,
      type: LoyaltyTransactionType.ADMIN_ADJUSTMENT,
      reason: 'Goodwill gesture',
      createdByUserId: 'admin-1',
    });
    expect(tx.orderId).toBeNull();
  });

  it('CRITICAL: ADMIN_ADJUSTMENT requires a reason', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({ customerId: 'customer-1', pointsDelta: 100, type: LoyaltyTransactionType.ADMIN_ADJUSTMENT }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a zero pointsDelta — not a meaningful ledger entry', async () => {
    const { service } = buildHarness();
    await expect(
      service.recordTransaction({ customerId: 'customer-1', pointsDelta: 0, type: LoyaltyTransactionType.EARNING }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: no update or delete method is exposed by the service — the ledger is append-only at the business layer', () => {
    const proto = Object.getOwnPropertyNames(LoyaltyService.prototype);
    expect(proto).not.toContain('update');
    expect(proto).not.toContain('updateTransaction');
    expect(proto).not.toContain('delete');
    expect(proto).not.toContain('deleteTransaction');
    expect(proto).not.toContain('remove');
  });

  it('CRITICAL: multiple customers remain fully isolated — one customer\u2019s transactions never affect another\u2019s balance', async () => {
    const { service } = buildHarness();
    await service.recordTransaction({ customerId: 'customer-A', pointsDelta: 1000, type: LoyaltyTransactionType.EARNING });
    await service.recordTransaction({ customerId: 'customer-B', pointsDelta: 50, type: LoyaltyTransactionType.EARNING });

    expect(await service.getBalance('customer-A')).toBe(1000);
    expect(await service.getBalance('customer-B')).toBe(50);
  });
});

describe('LoyaltyService.awardOrderEarning (Loyalty Earning, Chunk C)', () => {
  function makeSegment(overrides: Partial<any> = {}) {
    return {
      id: 'segment-1',
      orderId: 'order-1',
      groupType: 'CATALOG',
      status: 'CONFIRMED',
      offerDiscountAmountMinor: null,
      ...overrides,
    };
  }

  function makeItem(overrides: Partial<any> = {}) {
    return {
      id: 'item-1',
      orderVendorSegmentId: 'segment-1',
      pricingUnitSnapshot: 'PIECE',
      unitPriceMinor: 1000,
      quantity: 1,
      offerDiscountAmountMinor: null,
      finalAmountMinor: null,
      estimatedAmountMinor: null,
      ...overrides,
    };
  }

  function buildEarningHarness(params: { order?: any; segments?: any[]; items?: any[]; pointsPerEgp?: number }) {
    const store = new Map<string, any>();
    const repository = {
      create: (data: any) => ({ ...data }),
      save: async (entity: any) => {
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        store.set(withId.id, withId);
        return withId;
      },
      find: async (opts: any) => [...store.values()].filter((t) => t.customerId === opts.where.customerId),
    };
    const businessConfigService = { getLoyaltyPointsPerEgp: jest.fn(async () => params.pointsPerEgp ?? 1) };
    const dataSource = { transaction: async (cb: any) => cb({} as any) };
  const walletService = { recordTransaction: jest.fn(async () => undefined), getBalance: jest.fn(async () => 0) };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const service = new LoyaltyService(repository as any, businessConfigService as any, dataSource as any, walletService as any, requestContextService as any);

    const order = params.order ?? { id: 'order-1', customerId: 'customer-1' };
    // The default segment's `orderId` must track whichever `order` this
    // call actually uses (its own default is 'order-1', which only
    // matched a caller that also left `order` at its own default) — a
    // test that supplies a custom `order` without also overriding
    // `segments` would otherwise silently earn nothing (no segment
    // matches the queried orderId), the exact mismatch that made
    // "EARNING transaction references the correct Order and customer"
    // and "different Orders for the same customer earn independently"
    // fail with an empty `store`.
    const segments = params.segments ?? [makeSegment({ orderId: order.id })];
    const items = params.items ?? [makeItem()];

    const manager = {
      findOne: async (EntityClass: any, opts: any) => {
        if (EntityClass === Order) return opts.where.id === order.id ? order : null;
        throw new Error('unhandled findOne');
      },
      find: async (EntityClass: any, opts: any) => {
        if (EntityClass === OrderVendorSegment) return segments.filter((s) => s.orderId === opts.where.orderId);
        throw new Error('unhandled find');
      },
      createQueryBuilder: (EntityClass: any, _alias: string) => {
        if (EntityClass !== OrderItem) throw new Error('unhandled createQueryBuilder');
        let segmentIds: string[] = [];
        const qb: any = {
          where: (_sql: string, p: any) => {
            segmentIds = p.segmentIds;
            return qb;
          },
          getMany: async () => items.filter((i) => segmentIds.includes(i.orderVendorSegmentId)),
        };
        return qb;
      },
      // CRITICAL: LoyaltyService.recordTransaction (called by
      // awardOrderEarning, always WITH a manager) does
      // `manager.getRepository(LoyaltyPointsTransaction)` whenever a
      // manager is passed — this must route to the SAME fake
      // `repository`/`store` above, not a second, disconnected one, so
      // every assertion against `store` in this describe block
      // observes the actual write awardOrderEarning made.
      getRepository: (EntityClass: any) => {
        if (EntityClass !== LoyaltyPointsTransaction) throw new Error(`unhandled getRepository ${EntityClass.name}`);
        return repository;
      },
    };

    return { service, manager, store, order };
  }

  it('an eligible DELIVERED order earns points at 1 point per 1 EGP', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 10000, quantity: 1 })], // 100.00 EGP
    });
    await service.awardOrderEarning(manager as any, order.id);
    const tx = [...store.values()][0];
    expect(tx.pointsDelta).toBe(100);
    expect(tx.type).toBe('EARNING');
  });

  it('CRITICAL: fractional EGP does not create fractional points (12550 minor = 125.50 EGP -> 125 points)', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 12550, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(125);
  });

  it('delivery fee, additional-vendor fee, and Hatly Service fee are never read — only OrderItem/OrderVendorSegment feed the calculation', async () => {
    // Structural proof: the harness's `order` object below carries a
    // large deliveryFeeMinor-shaped field that would inflate the
    // result if it were ever read; the earned points still reflect
    // ONLY the item's own value, confirming those fields are never
    // touched by the calculation.
    const { service, manager, store, order } = buildEarningHarness({
      order: { id: 'order-1', customerId: 'customer-1', deliveryFeeMinor: 999999, hatlyServiceFeeMinor: 999999 },
      items: [makeItem({ unitPriceMinor: 5000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(50);
  });

  it('CRITICAL: product discount (Subtotal Discount, segment-level) reduces eligible spending correctly', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      segments: [makeSegment({ offerDiscountAmountMinor: 1000 })], // 10 EGP discount
      items: [makeItem({ unitPriceMinor: 10000, quantity: 1 })], // 100 EGP - 10 EGP = 90 EGP
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(90);
  });

  it('CRITICAL: Flash Sale uses the final selling price (offerDiscountAmountMinor already reflects the special price)', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 3000, quantity: 2, offerDiscountAmountMinor: 2000 })], // 6000 - 2000 = 4000 minor = 40 EGP
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(40);
  });

  it('CRITICAL: weighted products use the final order value (finalAmountMinor), never current price/inventory', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ pricingUnitSnapshot: 'WEIGHT', unitPriceMinor: null, quantity: 1, finalAmountMinor: 8500 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(85);
  });

  it('weighted product falls back to estimatedAmountMinor when finalAmountMinor is not yet set', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ pricingUnitSnapshot: 'WEIGHT', unitPriceMinor: null, quantity: 1, estimatedAmountMinor: 4200 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(42);
  });

  it('multiple products aggregate correctly within one segment', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [
        makeItem({ id: 'i1', unitPriceMinor: 5000, quantity: 1 }),
        makeItem({ id: 'i2', unitPriceMinor: 3000, quantity: 2 }),
      ],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(110); // 50 + 60
  });

  it('CRITICAL: a multi-vendor order aggregates eligible value across all CATALOG segments', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      segments: [makeSegment({ id: 'seg-A' }), makeSegment({ id: 'seg-B' })],
      items: [
        makeItem({ id: 'iA', orderVendorSegmentId: 'seg-A', unitPriceMinor: 10000, quantity: 1 }),
        makeItem({ id: 'iB', orderVendorSegmentId: 'seg-B', unitPriceMinor: 5000, quantity: 1 }),
      ],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(150);
  });

  it('CRITICAL: a cancelled segment contributes zero eligible value', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      segments: [makeSegment({ id: 'seg-A' }), makeSegment({ id: 'seg-B', status: 'CANCELLED' })],
      items: [
        makeItem({ id: 'iA', orderVendorSegmentId: 'seg-A', unitPriceMinor: 10000, quantity: 1 }),
        makeItem({ id: 'iB', orderVendorSegmentId: 'seg-B', unitPriceMinor: 99999, quantity: 1 }),
      ],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect([...store.values()][0].pointsDelta).toBe(100); // only seg-A counts
  });

  it('an AD_HOC_SERVICE segment is excluded entirely', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      segments: [makeSegment({ groupType: 'AD_HOC_SERVICE' })],
      items: [makeItem({ unitPriceMinor: 10000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect(store.size).toBe(0);
  });

  it('CRITICAL: zero eligible amount creates no transaction', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 0, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect(store.size).toBe(0);
  });

  it('CRITICAL: the same Order cannot earn twice — the second attempt hits the simulated DB unique-constraint violation and is swallowed as a benign no-op', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 10000, quantity: 1 })],
    });
    // First call succeeds normally.
    await service.awardOrderEarning(manager as any, order.id);
    expect(store.size).toBe(1);

    // Simulate the DB partial-unique-index rejecting a second EARNING
    // row for the same order (Postgres error code 23505).
    const repositoryOnManager = { create: (d: any) => d, save: async () => { const e: any = new Error('duplicate'); e.code = '23505'; throw e; } };
    (manager as any).getRepository = () => repositoryOnManager;

    await expect(service.awardOrderEarning(manager as any, order.id)).resolves.toBeUndefined();
    expect(store.size).toBe(1); // still exactly one — idempotent
  });

  it('different Orders for the same customer earn independently', async () => {
    const { service, manager: manager1, store: store1 } = buildEarningHarness({
      order: { id: 'order-1', customerId: 'customer-1' },
      items: [makeItem({ unitPriceMinor: 5000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager1 as any, 'order-1');

    const { manager: manager2, store: store2 } = buildEarningHarness({
      order: { id: 'order-2', customerId: 'customer-1' },
      items: [makeItem({ unitPriceMinor: 7000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager2 as any, 'order-2');

    expect([...store1.values()][0].orderId).toBe('order-1');
    expect([...store2.values()][0].orderId).toBe('order-2');
  });

  it('EARNING transaction references the correct Order and customer', async () => {
    const { service, manager, store, order } = buildEarningHarness({
      order: { id: 'order-xyz', customerId: 'customer-abc' },
      items: [makeItem({ unitPriceMinor: 5000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    const tx = [...store.values()][0];
    expect(tx.orderId).toBe('order-xyz');
    expect(tx.customerId).toBe('customer-abc');
    expect(tx.createdByUserId).toBeNull(); // system-generated, no human actor
  });

  it('existing Loyalty balance correctly increases after earning', async () => {
    const { service, manager, order } = buildEarningHarness({
      items: [makeItem({ unitPriceMinor: 20000, quantity: 1 })],
    });
    await service.awardOrderEarning(manager as any, order.id);
    expect(await service.getBalance('customer-1')).toBe(200);
  });

  it('an order with no CATALOG segments at all creates no transaction', async () => {
    const { service, manager, store, order } = buildEarningHarness({ segments: [], items: [] });
    await service.awardOrderEarning(manager as any, order.id);
    expect(store.size).toBe(0);
  });
});

describe('LoyaltyService.reverseEarningForRefund (consolidated customer-commerce milestone)', () => {
  function buildReversalHarness(params: { order?: any; earningRow?: any; priorReversals?: any[] }) {
    const order = params.order ?? { id: 'order-1', totalMinor: 10000 };
    const store = new Map<string, any>();
    if (params.earningRow) store.set(params.earningRow.id, params.earningRow);
    for (const r of params.priorReversals ?? []) store.set(r.id, r);

    const repository = {
      create: (data: any) => ({ ...data }),
      save: async (entity: any) => {
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        store.set(withId.id, withId);
        return withId;
      },
    };
    const businessConfigService = {};
    const dataSource = {};
    const walletService = {};
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
    const service = new LoyaltyService(repository as any, businessConfigService as any, dataSource as any, walletService as any, requestContextService as any);

    const manager = {
      findOne: async (EntityClass: any, opts: any) => {
        if (EntityClass === Order) return opts.where.id === order.id ? order : null;
        if (EntityClass === LoyaltyPointsTransaction) {
          return [...store.values()].find((t) => t.orderId === opts.where.orderId && t.type === opts.where.type) ?? null;
        }
        throw new Error('unhandled findOne');
      },
      find: async (EntityClass: any, opts: any) => {
        if (EntityClass === LoyaltyPointsTransaction) {
          return [...store.values()].filter((t) => t.orderId === opts.where.orderId && t.type === opts.where.type);
        }
        throw new Error('unhandled find');
      },
      getRepository: () => repository,
    };
    return { service, manager, store };
  }

  const earningRow = (overrides: Partial<any> = {}) => ({
    id: 'earning-1',
    customerId: 'customer-1',
    orderId: 'order-1',
    pointsDelta: 100,
    type: LoyaltyTransactionType.EARNING,
    ...overrides,
  });

  it('a full refund (100% of order total) reverses the FULL amount originally earned', async () => {
    const { service, manager, store } = buildReversalHarness({ earningRow: earningRow() });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 10000, idempotencyKey: 'k1' });
    const reversal = [...store.values()].find((t) => t.type === LoyaltyTransactionType.EARNING_REVERSED);
    expect(reversal.pointsDelta).toBe(-100);
  });

  it('a 50% partial refund reverses proportionally (50 of 100 points)', async () => {
    const { service, manager, store } = buildReversalHarness({ earningRow: earningRow() });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'k1' });
    const reversal = [...store.values()].find((t) => t.type === LoyaltyTransactionType.EARNING_REVERSED);
    expect(reversal.pointsDelta).toBe(-50);
  });

  it('NEVER over-reverses: a refund larger than the order total is capped at the full originally-earned amount', async () => {
    const { service, manager, store } = buildReversalHarness({ earningRow: earningRow() });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 999999, idempotencyKey: 'k1' });
    const reversal = [...store.values()].find((t) => t.type === LoyaltyTransactionType.EARNING_REVERSED);
    expect(reversal.pointsDelta).toBe(-100); // never more than what was actually earned
  });

  it('CRITICAL: an order that never earned anything (e.g. refunded before DELIVERED) is a safe no-op — never fabricates a reversal', async () => {
    const { service, manager, store } = buildReversalHarness({});
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'k1' });
    expect(store.size).toBe(0);
  });

  it('NEVER reverses more than remains: a second partial refund only reverses what is left after a prior reversal', async () => {
    const { service, manager, store } = buildReversalHarness({
      earningRow: earningRow(),
      priorReversals: [{ id: 'rev-1', customerId: 'customer-1', orderId: 'order-1', pointsDelta: -60, type: LoyaltyTransactionType.EARNING_REVERSED }],
    });
    // A further 50% refund would compute floor(100 * 0.5) = 50, but only 40 remains reversible (100 - 60 already reversed).
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'k2' });
    const newReversal = [...store.values()].find((t) => t.id !== 'rev-1' && t.type === LoyaltyTransactionType.EARNING_REVERSED);
    expect(newReversal.pointsDelta).toBe(-40); // capped at what remains, not the naive 50
  });

  it('is a no-op once everything already earned has been reversed', async () => {
    const { service, manager, store } = buildReversalHarness({
      earningRow: earningRow(),
      priorReversals: [{ id: 'rev-1', customerId: 'customer-1', orderId: 'order-1', pointsDelta: -100, type: LoyaltyTransactionType.EARNING_REVERSED }],
    });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'k2' });
    expect(store.size).toBe(2); // only the seeded earning row + the original prior reversal — nothing new added
  });

  it('is idempotent: a retried call with the SAME idempotencyKey never double-reverses', async () => {
    const { service, manager, store } = buildReversalHarness({ earningRow: earningRow() });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'same-key' });
    // Simulate the real unique-index rejection a genuine retry would hit (same idempotencyKey already used).
    const originalSave = manager.getRepository().save;
    manager.getRepository().save = async (entity: any) => {
      if (entity.idempotencyKey && [...store.values()].some((t) => t.idempotencyKey === entity.idempotencyKey)) {
        const e: any = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      }
      return originalSave(entity);
    };
    await expect(
      service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 5000, idempotencyKey: 'same-key' }),
    ).resolves.toBeUndefined(); // benign no-op, never throws
    expect([...store.values()].filter((t) => t.type === LoyaltyTransactionType.EARNING_REVERSED)).toHaveLength(1);
  });

  it('a zero or negative refund amount is a safe no-op', async () => {
    const { service, manager, store } = buildReversalHarness({ earningRow: earningRow() });
    await service.reverseEarningForRefund(manager as any, { orderId: 'order-1', refundedAmountMinor: 0, idempotencyKey: 'k1' });
    expect(store.size).toBe(1); // only the seeded earning row
  });
});

describe('LoyaltyService.convertPointsToWallet (Points -> Wallet Conversion, Chunk D)', () => {
  function buildConversionHarness(params: { existingPoints?: number; pointsPerEgp?: number; existingWalletTx?: any } = {}) {
    const loyaltyStore = new Map<string, any>();
    const walletStore = new Map<string, any>();
    let idSeq = 0;

    if (params.existingPoints) {
      const id = `seed-${idSeq++}`;
      loyaltyStore.set(id, { id, customerId: 'customer-1', pointsDelta: params.existingPoints, type: 'EARNING' });
    }

    const repository = {
      create: (data: any) => ({ ...data }),
      save: async (entity: any) => {
        // Mirrors the REAL DB's own unique constraint on
        // `loyalty_points_transactions.idempotency_key` (see
        // LoyaltyPointsTransaction's own migration) — without this, a
        // retried convertPointsToWallet() call would insert a SECOND
        // loyalty REDEMPTION row here (this fake `dataSource.
        // transaction` has no real rollback) before the wallet write
        // below ever gets a chance to raise its own matching
        // constraint, silently breaking the "only ONE redemption/
        // credit pair exists" idempotency guarantee this harness must
        // actually prove, not just assume.
        if (
          entity.idempotencyKey &&
          [...loyaltyStore.values()].some((t) => t.idempotencyKey === entity.idempotencyKey)
        ) {
          const e: any = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        loyaltyStore.set(withId.id, withId);
        return withId;
      },
      find: async (opts: any) => [...loyaltyStore.values()].filter((t) => t.customerId === opts.where.customerId),
      findOne: async (opts: any) =>
        [...loyaltyStore.values()].find(
          (t) => keyMatches(t.idempotencyKey, opts.where.idempotencyKey) && (opts.where.customerId === undefined || t.customerId === opts.where.customerId),
        ) ?? null,
    };
    const businessConfigService = { getLoyaltyPointsPerEgp: jest.fn(async () => 1), getLoyaltyWalletConversionPointsPerEgp: jest.fn(async () => params.pointsPerEgp ?? 100) };

    const walletRepository = {
      create: (data: any) => ({ ...data }),
      save: async (entity: any) => {
        if ([...walletStore.values()].some((w) => w.idempotencyKey === entity.idempotencyKey)) {
          const e: any = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        walletStore.set(withId.id, withId);
        return withId;
      },
      find: async (opts: any) => [...walletStore.values()].filter((t) => t.customerId === opts.where.customerId),
    };

    const manager = {
      findOne: async (EntityClass: any, opts: any) => {
        if (EntityClass.name === 'User') return { id: opts.where.id };
        return null;
      },
      find: async (_EntityClass: any, opts: any) => [...loyaltyStore.values()].filter((t) => t.customerId === opts.where.customerId),
      getRepository: (EntityClass: any) => {
        if (EntityClass === LoyaltyPointsTransaction) return repository;
        return walletRepository;
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
    const walletService = new WalletService(walletRepository as any, requestContextService as any);

    const service = new LoyaltyService(repository as any, businessConfigService as any, dataSource as any, walletService as any, requestContextService as any);
    return { service, loyaltyStore, walletStore };
  }

  it('APPROVED V1 EXAMPLE: 500 points converts to 5 EGP (500 minor units) — the minimum conversion', async () => {
    const { service } = buildConversionHarness({ existingPoints: 600 });
    const result = await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    expect(result.walletCreditMinor).toBe(500);
    expect(result.convertedPoints).toBe(500);
  });

  it('1000 points converts to 10 EGP (1000 minor units)', async () => {
    const { service } = buildConversionHarness({ existingPoints: 1000 });
    const result = await service.convertPointsToWallet('customer-1', 1000, 'idem-1');
    expect(result.walletCreditMinor).toBe(1000);
  });

  it('APPROVED V1 RULE: a non-multiple-of-100 amount is rejected outright — never silently forfeits the remainder', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 1000 });
    await expect(service.convertPointsToWallet('customer-1', 550, 'idem-1')).rejects.toMatchObject({
      response: { details: { code: 'INVALID_CONVERSION_MULTIPLE', multipleOf: 100 } },
    });
    expect([...loyaltyStore.values()].filter((t) => t.type === 'REDEMPTION')).toEqual([]);
    expect(walletStore.size).toBe(0);
  });

  it('CRITICAL: less than the minimum (500) is rejected — even a valid multiple of 100', async () => {
    const { service } = buildConversionHarness({ existingPoints: 500 });
    await expect(service.convertPointsToWallet('customer-1', 400, 'idem-1')).rejects.toMatchObject({
      response: { details: { code: 'BELOW_MINIMUM_CONVERSION', minimum: 500 } },
    });
  });

  it('zero points is rejected', async () => {
    const { service } = buildConversionHarness({ existingPoints: 500 });
    await expect(service.convertPointsToWallet('customer-1', 0, 'idem-1')).rejects.toThrow(BadRequestException);
  });

  it('negative points is rejected', async () => {
    const { service } = buildConversionHarness({ existingPoints: 500 });
    await expect(service.convertPointsToWallet('customer-1', -100, 'idem-1')).rejects.toThrow(BadRequestException);
  });

  it('non-integer points is rejected', async () => {
    const { service } = buildConversionHarness({ existingPoints: 500 });
    await expect(service.convertPointsToWallet('customer-1', 100.5, 'idem-1')).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: insufficient points is rejected, no ledger row created', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 50 });
    await expect(service.convertPointsToWallet('customer-1', 500, 'idem-1')).rejects.toMatchObject({
      response: { details: { code: 'INSUFFICIENT_POINTS' } },
    });
    expect(loyaltyStore.size).toBe(1); // only the seed row, nothing new
    expect(walletStore.size).toBe(0);
  });

  it('successful conversion creates a Loyalty REDEMPTION transaction', async () => {
    const { service, loyaltyStore } = buildConversionHarness({ existingPoints: 500 });
    await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    const redemption = [...loyaltyStore.values()].find((t) => t.type === 'REDEMPTION');
    expect(redemption).toBeTruthy();
    expect(redemption.pointsDelta).toBe(-500);
  });

  it('successful conversion creates a Wallet LOYALTY_REDEMPTION transaction', async () => {
    const { service, walletStore } = buildConversionHarness({ existingPoints: 500 });
    await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    const credit = [...walletStore.values()][0];
    expect(credit.type).toBe('LOYALTY_REDEMPTION');
    expect(credit.amountDeltaMinor).toBe(500);
  });

  it('CRITICAL: both ledger writes reference the same idempotencyKey', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 500 });
    await service.convertPointsToWallet('customer-1', 500, 'shared-key');
    const redemption = [...loyaltyStore.values()].find((t) => t.type === 'REDEMPTION');
    const credit = [...walletStore.values()][0];
    // the client's key, namespaced to the customer (it can never equal a system key such as `order-refund:<id>:cancel`)
    expect(redemption.idempotencyKey).toBe('loyalty-convert:customer-1:shared-key');
    expect(credit.idempotencyKey).toBe(redemption.idempotencyKey);
  });

  it("SECURITY: a client key equal to a SYSTEM ledger key cannot pre-occupy it — the stored key is namespaced to the customer", async () => {
    const { service, walletStore } = buildConversionHarness({ existingPoints: 500 });
    await service.convertPointsToWallet('customer-1', 500, 'order-refund:victim-order:cancel');
    expect([...walletStore.values()].map((w) => w.idempotencyKey)).toEqual(['loyalty-convert:customer-1:order-refund:victim-order:cancel']);
  });

  it('a retry of a conversion stored BEFORE namespacing (raw key) is still recognised as a replay — no second conversion across the deploy', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 1000 });
    loyaltyStore.set('legacy', { id: 'legacy', customerId: 'customer-1', pointsDelta: -500, type: 'REDEMPTION', idempotencyKey: 'legacy-key' });
    const result = await service.convertPointsToWallet('customer-1', 500, 'legacy-key');
    expect(result.convertedPoints).toBe(500);
    expect([...loyaltyStore.values()].filter((t) => t.type === 'REDEMPTION')).toHaveLength(1);
    expect(walletStore.size).toBe(0);
  });

  it("the same key used by ANOTHER customer is independent: this caller's conversion happens under its own namespaced key, the other row is untouched (Group 8 regression, now impossible by construction)", async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 500 });
    loyaltyStore.set('other-redemption', { id: 'other-redemption', customerId: 'customer-2', pointsDelta: -300, type: 'REDEMPTION', idempotencyKey: 'loyalty-convert:customer-2:idem-x' });

    const result = await service.convertPointsToWallet('customer-1', 500, 'idem-x');

    expect(result.convertedPoints).toBe(500); // its OWN conversion — never customer-2's amounts
    const mine = [...loyaltyStore.values()].filter((t) => t.customerId === 'customer-1' && t.type === 'REDEMPTION');
    expect(mine.map((t) => t.idempotencyKey)).toEqual(['loyalty-convert:customer-1:idem-x']);
    expect(loyaltyStore.get('other-redemption').pointsDelta).toBe(-300);
    expect(walletStore.size).toBe(1);
  });

  it('CRITICAL: duplicate idempotency key cannot double-convert — the second call returns the existing result instead of creating new rows', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 500 });
    const first = await service.convertPointsToWallet('customer-1', 500, 'dup-key');
    const second = await service.convertPointsToWallet('customer-1', 500, 'dup-key');
    expect(second.convertedPoints).toBe(first.convertedPoints);
    expect(second.walletCreditMinor).toBe(first.walletCreditMinor);
    // Only ONE redemption/credit pair exists, not two.
    expect([...loyaltyStore.values()].filter((t) => t.type === 'REDEMPTION')).toHaveLength(1);
    expect(walletStore.size).toBe(1);
  });

  it('conversion rate snapshot is preserved in the reason text of both rows', async () => {
    const { service, loyaltyStore, walletStore } = buildConversionHarness({ existingPoints: 500 });
    await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    const redemption = [...loyaltyStore.values()].find((t) => t.type === 'REDEMPTION');
    const credit = [...walletStore.values()][0];
    expect(redemption.reason).toContain('100 points = 100 minor units');
    expect(credit.reason).toContain('100 points = 100 minor units');
  });

  it('current Loyalty balance is correct after conversion', async () => {
    const { service } = buildConversionHarness({ existingPoints: 600 });
    const result = await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    expect(result.pointsBalance).toBe(100);
  });

  it('current Wallet balance is correct after conversion', async () => {
    const { service } = buildConversionHarness({ existingPoints: 600 });
    const result = await service.convertPointsToWallet('customer-1', 500, 'idem-1');
    expect(result.walletBalance).toBe(500);
  });

  it('no reverse Wallet -> Points operation exists on the service', () => {
    const proto = Object.getOwnPropertyNames(LoyaltyService.prototype);
    expect(proto).not.toContain('convertWalletToPoints');
    expect(proto).not.toContain('reverseConversion');
  });
});

describe('LoyaltyService.convertPointsToWallet — structured business-event logging (Group 4)', () => {
  // A self-contained harness whose fake repositories correctly simulate
  // BOTH tables' independent idempotencyKey unique constraints (unlike
  // buildConversionHarness above, whose loyalty-side mock has a known,
  // separately-tracked pre-existing gap here) — this keeps these
  // logging-focused tests decoupled from that unrelated issue.
  function buildLoggingHarness() {
    const loyaltyStore = new Map<string, any>();
    loyaltyStore.set('seed', { id: 'seed', customerId: 'customer-1', pointsDelta: 500, type: 'EARNING' });
    const walletStore = new Map<string, any>();

    const repository = {
      create: (d: any) => ({ ...d }),
      save: async (entity: any) => {
        if ([...loyaltyStore.values()].some((t) => t.idempotencyKey && t.idempotencyKey === entity.idempotencyKey)) {
          const e: any = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        loyaltyStore.set(withId.id, withId);
        return withId;
      },
      find: async (opts: any) => [...loyaltyStore.values()].filter((t) => t.customerId === opts.where.customerId),
      findOne: async (opts: any) =>
        [...loyaltyStore.values()].find(
          (t) => keyMatches(t.idempotencyKey, opts.where.idempotencyKey) && (opts.where.customerId === undefined || t.customerId === opts.where.customerId),
        ) ?? null,
    };
    const walletRepository = {
      create: (d: any) => ({ ...d }),
      save: async (entity: any) => {
        if ([...walletStore.values()].some((w) => w.idempotencyKey === entity.idempotencyKey)) {
          const e: any = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
        walletStore.set(withId.id, withId);
        return withId;
      },
      find: async (opts: any) => [...walletStore.values()].filter((t) => t.customerId === opts.where.customerId),
    };
    const businessConfigService = { getLoyaltyWalletConversionPointsPerEgp: jest.fn(async () => 100) };
    const manager = {
      // Distinguishes the User row-lock read from the NEW in-lock idempotency re-check
      // (LoyaltyPointsTransaction) — a single unconditional stub here would make the re-check always
      // find a "match" and short-circuit every conversion as an already-committed no-op.
      findOne: async (EntityClass: any, opts: any) => {
        if (EntityClass === LoyaltyPointsTransaction) {
          return [...loyaltyStore.values()].find((t) => keyMatches(t.idempotencyKey, opts.where.idempotencyKey) && t.customerId === opts.where.customerId) ?? null;
        }
        return { id: 'customer-1' };
      },
      find: async (_EntityClass: any, opts: any) => [...loyaltyStore.values()].filter((t) => t.customerId === opts.where.customerId),
      getRepository: (EntityClass: any) => (EntityClass === LoyaltyPointsTransaction ? repository : walletRepository),
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-loyalty') };
    const walletService = new WalletService(walletRepository as any, requestContextService as any);
    const service = new LoyaltyService(repository as any, businessConfigService as any, dataSource as any, walletService as any, requestContextService as any);
    return { service };
  }

  it('E: a successful conversion logs loyalty.redemption and wallet.credit with the integer minor-unit amount, post-commit', async () => {
    const { service } = buildLoggingHarness();
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.convertPointsToWallet('customer-1', 500, 'idem-log-1');

    const events = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(events.find((e) => e.event === 'loyalty.redemption')).toEqual({
      event: 'loyalty.redemption',
      correlationId: 'corr-loyalty',
      customerId: 'customer-1',
      pointsRedeemed: 500,
      walletCreditMinor: 500,
      idempotencyKey: 'loyalty-convert:customer-1:idem-log-1',
    });
    const creditEvent = events.find((e) => e.event === 'wallet.credit');
    expect(creditEvent).toMatchObject({ customerId: 'customer-1', amountDeltaMinor: 500, type: 'LOYALTY_REDEMPTION' });
    expect(Number.isInteger(creditEvent.amountDeltaMinor)).toBe(true);
  });

  it('F: a genuine duplicate/retry logs loyalty.redemption_duplicate at WARN instead of a second loyalty.redemption', async () => {
    const { service } = buildLoggingHarness();
    await service.convertPointsToWallet('customer-1', 500, 'idem-log-2');
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

    await service.convertPointsToWallet('customer-1', 500, 'idem-log-2');

    expect(logSpy.mock.calls.some((call) => (call[0] as string).includes('loyalty.redemption"'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({ event: 'loyalty.redemption_duplicate', correlationId: 'corr-loyalty', customerId: 'customer-1', idempotencyKey: 'loyalty-convert:customer-1:idem-log-2' });
  });
});
