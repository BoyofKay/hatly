import { SettlementService } from './settlement.service';
import { FinancialEventType } from './financial-event-type.enum';

function buildQueryBuilder(rows: any[]) {
  const qb: any = {
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getMany: jest.fn(async () => rows),
  };
  return qb;
}

function buildHarness(opts: {
  previousVendorPeriod?: any;
  previousDriverPeriod?: any;
  commissionEvents?: any[];
  segments?: any[];
  driverEvents?: any[];
  earliestEventDate?: Date;
  vendorFrequency?: string;
  driverFrequency?: string;
  /**
   * M2 (audit G-13). Set alone: simulates a concurrent winner that ALREADY
   * committed before this call even reaches its pre-check — the pre-check
   * short-circuits, `.save()` is never attempted. Combined with
   * `simulateVendor/DriverPeriodRace`: simulates the winner's row only
   * becoming visible AFTER this call's own `.save()` loses the race (the
   * pre-check still sees nothing; the post-failure re-check does).
   */
  existingAtPeriodStart?: { vendorBranchId?: string; driverId?: string; periodStart: Date; [k: string]: any };
  /** M2 (audit G-13): simulate the DB's unique-index race-loser failure on save (Postgres 23505). */
  simulateVendorPeriodRace?: boolean;
  simulateDriverPeriodRace?: boolean;
}) {
  const savedVendorPeriods: any[] = [];
  const savedDriverPeriods: any[] = [];
  let vendorPeriodStartLookups = 0;
  let driverPeriodStartLookups = 0;

  // M2: `findOne` now serves TWO distinct queries — the pre-existing "most
  // recent CLOSED period" lookup, and the new exact-(id, periodStart)
  // idempotency pre-check/race-fallback — distinguished by which `where`
  // shape is passed, exactly as the real repository would distinguish them
  // by SQL. When a race is being simulated, the winner's row is only
  // "visible" from the SECOND periodStart-lookup onward (the post-failure
  // re-check) — the first (pre-check) genuinely sees nothing yet.
  const vendorPeriodsRepository = {
    // The per-vendor settlement term lookup: none configured in these tests, so the platform-wide frequency applies as before.
    manager: { query: jest.fn(async () => []) },
    findOne: jest.fn(async (query: any) => {
      if (query?.where?.status === 'CLOSED') return opts.previousVendorPeriod ?? null;
      if (opts.existingAtPeriodStart?.vendorBranchId && query?.where?.periodStart?.getTime() === opts.existingAtPeriodStart.periodStart.getTime()) {
        vendorPeriodStartLookups += 1;
        const visibleFromLookup = opts.simulateVendorPeriodRace ? 2 : 1;
        return vendorPeriodStartLookups >= visibleFromLookup ? opts.existingAtPeriodStart : null;
      }
      return null;
    }),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (p: any) => {
      if (opts.simulateVendorPeriodRace) {
        const e: any = new Error('duplicate key value violates unique constraint "idx_vendor_settlement_periods_branch_start_unique"');
        e.code = '23505';
        throw e;
      }
      savedVendorPeriods.push(p);
      return { id: 'vp-1', ...p };
    }),
  };
  const driverPeriodsRepository = {
    findOne: jest.fn(async (query: any) => {
      if (query?.where?.status === 'CLOSED') return opts.previousDriverPeriod ?? null;
      if (opts.existingAtPeriodStart?.driverId && query?.where?.periodStart?.getTime() === opts.existingAtPeriodStart.periodStart.getTime()) {
        driverPeriodStartLookups += 1;
        const visibleFromLookup = opts.simulateDriverPeriodRace ? 2 : 1;
        return driverPeriodStartLookups >= visibleFromLookup ? opts.existingAtPeriodStart : null;
      }
      return null;
    }),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (p: any) => {
      if (opts.simulateDriverPeriodRace) {
        const e: any = new Error('duplicate key value violates unique constraint "idx_driver_settlement_periods_driver_start_unique"');
        e.code = '23505';
        throw e;
      }
      savedDriverPeriods.push(p);
      return { id: 'dp-1', ...p };
    }),
  };
  const financialEventsRepository = {
    createQueryBuilder: jest.fn((alias: string) => {
      if (alias === 'e') {
        // Distinguish vendor-commission vs driver-events queries by
        // which fixture was provided — both tests set only one.
        return buildQueryBuilder(opts.commissionEvents ?? opts.driverEvents ?? []);
      }
      return buildQueryBuilder([]);
    }),
    findOne: jest.fn(async () => (opts.earliestEventDate ? { createdAt: opts.earliestEventDate } : null)),
  };
  const segmentsRepository = {
    createQueryBuilder: jest.fn(() => buildQueryBuilder(opts.segments ?? [])),
  };
  const businessConfigService = {
    getVendorSettlementFrequency: jest.fn(async () => opts.vendorFrequency ?? 'WEEKLY'),
    getDriverSettlementFrequency: jest.fn(async () => opts.driverFrequency ?? 'WEEKLY'),
  };

  const service = new SettlementService(
    vendorPeriodsRepository as any,
    driverPeriodsRepository as any,
    financialEventsRepository as any,
    segmentsRepository as any,
    businessConfigService as any,
  );
  return { service, savedVendorPeriods, savedDriverPeriods };
}

describe('SettlementService', () => {
  describe('closeVendorPeriod', () => {
    it('aggregates commission events and gross sales within the period, snapshotting the current frequency', async () => {
      const commissionEvents = [{ amountMinor: 100 }, { amountMinor: 50 }];
      const segments = [{ subtotalMinor: 1000 }, { subtotalMinor: 500 }];
      const { service, savedVendorPeriods } = buildHarness({
        commissionEvents,
        segments,
        earliestEventDate: new Date('2026-01-01'),
        vendorFrequency: 'MONTHLY',
      });

      const period = await service.closeVendorPeriod('branch-1', 'admin-1');

      expect(period.totalCommissionOwedMinor).toBe(150);
      expect(period.grossSalesMinor).toBe(1500);
      expect(period.frequency).toBe('MONTHLY');
      expect(period.status).toBe('CLOSED');
      expect(savedVendorPeriods).toHaveLength(1);
    });

    it("CONFIRMED: the new period's start is exactly the previous period's end — periods never overlap, no double-counting", async () => {
      const previousEnd = new Date('2026-01-08');
      const { service, savedVendorPeriods } = buildHarness({
        previousVendorPeriod: { periodEnd: previousEnd },
        commissionEvents: [],
        segments: [],
      });

      await service.closeVendorPeriod('branch-1', 'admin-1');

      expect(savedVendorPeriods[0].periodStart).toEqual(previousEnd);
    });

    it('throws rather than closing an empty period with no new activity since the last close', async () => {
      const { service } = buildHarness({
        previousVendorPeriod: { periodEnd: new Date(Date.now() + 100000) }, // in the future — periodStart >= periodEnd
        commissionEvents: [],
        segments: [],
      });

      await expect(service.closeVendorPeriod('branch-1', 'admin-1')).rejects.toThrow();
    });

    describe('concurrency safety (M2, audit G-13)', () => {
      it('idempotent pre-check: a period already committed at this exact periodStart is returned as-is, and nothing new is saved', async () => {
        const previousEnd = new Date('2026-01-08');
        const existing = { id: 'vp-existing', vendorBranchId: 'branch-1', periodStart: previousEnd, grossSalesMinor: 999 };
        const { service, savedVendorPeriods } = buildHarness({
          previousVendorPeriod: { periodEnd: previousEnd },
          commissionEvents: [],
          segments: [],
          existingAtPeriodStart: existing,
        });

        const period = await service.closeVendorPeriod('branch-1', 'admin-1');

        expect(period).toBe(existing); // the exact pre-existing row, not a fresh object
        expect(savedVendorPeriods).toHaveLength(0); // never attempted a duplicate insert
      });

      it('race-fallback: a concurrent close wins the unique-index race on save — the winning period is returned, not a raw DB error', async () => {
        const previousEnd = new Date('2026-01-08');
        const winner = { id: 'vp-winner', vendorBranchId: 'branch-1', periodStart: previousEnd, grossSalesMinor: 1500 };
        const { service, savedVendorPeriods } = buildHarness({
          previousVendorPeriod: { periodEnd: previousEnd },
          commissionEvents: [{ amountMinor: 100 }],
          segments: [{ subtotalMinor: 1500 }],
          existingAtPeriodStart: winner,
          simulateVendorPeriodRace: true,
        });

        const period = await service.closeVendorPeriod('branch-1', 'admin-1');

        expect(period).toBe(winner); // the OTHER call's committed row, not a duplicate
        expect(savedVendorPeriods).toHaveLength(0); // this call's own insert never actually landed
      });
    });
  });

  describe('closeDriverPeriod', () => {
    it('derives full earnings from rateSnapshot.baseAmountMinor — correct even at an exact 0% commission rate (division-by-zero-safe)', async () => {
      const driverEvents = [
        {
          type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
          amountMinor: 0, // 0% commission => 0 commission amount
          rateSnapshot: { commissionRateBasisPoints: 0, baseAmountMinor: 800 }, // but the real earning was still 800
        },
      ];
      const { service, savedDriverPeriods } = buildHarness({
        driverEvents,
        earliestEventDate: new Date('2026-01-01'),
      });

      const period = await service.closeDriverPeriod('driver-1', 'admin-1');

      expect(period.totalEarningsMinor).toBe(800); // correctly recovered despite 0% rate
      expect(period.totalCommissionOwedMinor).toBe(0);
      expect(savedDriverPeriods).toHaveLength(1);
    });

    it('nets earnings minus commission plus reimbursements', async () => {
      const driverEvents = [
        {
          type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
          amountMinor: 100,
          rateSnapshot: { commissionRateBasisPoints: 2000, baseAmountMinor: 500 },
        },
        { type: FinancialEventType.DRIVER_REIMBURSEMENT_OWED, amountMinor: 300 },
      ];
      const { service, savedDriverPeriods } = buildHarness({
        driverEvents,
        earliestEventDate: new Date('2026-01-01'),
      });

      const period = await service.closeDriverPeriod('driver-1', 'admin-1');

      // 500 (earnings) - 100 (commission) + 300 (reimbursement) = 700
      expect(period.netPayableMinor).toBe(700);
      expect(savedDriverPeriods[0].totalReimbursementsOwedMinor).toBe(300);
    });

    describe('concurrency safety (M2, audit G-13)', () => {
      it('idempotent pre-check: a period already committed at this exact periodStart is returned as-is, and nothing new is saved', async () => {
        const previousEnd = new Date('2026-01-08');
        const existing = { id: 'dp-existing', driverId: 'driver-1', periodStart: previousEnd, netPayableMinor: 999 };
        const { service, savedDriverPeriods } = buildHarness({
          previousDriverPeriod: { periodEnd: previousEnd },
          driverEvents: [],
          existingAtPeriodStart: existing,
        });

        const period = await service.closeDriverPeriod('driver-1', 'admin-1');

        expect(period).toBe(existing);
        expect(savedDriverPeriods).toHaveLength(0);
      });

      it('race-fallback: a concurrent close wins the unique-index race on save — the winning period is returned, not a raw DB error', async () => {
        const previousEnd = new Date('2026-01-08');
        const winner = { id: 'dp-winner', driverId: 'driver-1', periodStart: previousEnd, netPayableMinor: 700 };
        const { service, savedDriverPeriods } = buildHarness({
          previousDriverPeriod: { periodEnd: previousEnd },
          driverEvents: [
            { type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED, amountMinor: 100, rateSnapshot: { baseAmountMinor: 500 } },
          ],
          existingAtPeriodStart: winner,
          simulateDriverPeriodRace: true,
        });

        const period = await service.closeDriverPeriod('driver-1', 'admin-1');

        expect(period).toBe(winner);
        expect(savedDriverPeriods).toHaveLength(0);
      });
    });
  });
});
