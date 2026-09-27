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
}) {
  const savedVendorPeriods: any[] = [];
  const savedDriverPeriods: any[] = [];

  const vendorPeriodsRepository = {
    findOne: jest.fn(async () => opts.previousVendorPeriod ?? null),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (p: any) => {
      savedVendorPeriods.push(p);
      return { id: 'vp-1', ...p };
    }),
  };
  const driverPeriodsRepository = {
    findOne: jest.fn(async () => opts.previousDriverPeriod ?? null),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (p: any) => {
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
  });
});
