import { reanchorPreparationTiming } from './order-preparation-timing';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';

function harness(segments: any[]) {
  const store = new Map(segments.map((s) => [s.id, { ...s }]));
  const manager: any = {
    find: async (_Entity: any, opts: any) => [...store.values()].filter((s) => s.orderId === opts.where.orderId),
    save: async (_Entity: any, entity: any) => {
      store.set(entity.id, entity);
      return entity;
    },
  };
  return { manager, store };
}

const OLD = new Date('2026-01-01T09:00:00Z'); // stamped at order creation
const APPROVED = new Date('2026-01-01T09:20:00Z'); // 20 minutes of payment review later

describe('reanchorPreparationTiming', () => {
  it('re-stamps expectedReadyAt to start from the given moment, not from the old (creation-time) estimate', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: 15, expectedReadyAt: OLD },
    ]);
    await reanchorPreparationTiming(manager, 'o1', APPROVED);
    expect(store.get('s1')!.expectedReadyAt).toEqual(new Date(APPROVED.getTime() + 15 * 60_000));
  });

  it('every active segment moves together, each by its OWN preparation time', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: 10, expectedReadyAt: OLD },
      { id: 's2', orderId: 'o1', status: OrderVendorSegmentStatus.CONFIRMED, preparationEstimateMinutes: 25, expectedReadyAt: OLD },
    ]);
    await reanchorPreparationTiming(manager, 'o1', APPROVED);
    expect(store.get('s1')!.expectedReadyAt).toEqual(new Date(APPROVED.getTime() + 10 * 60_000));
    expect(store.get('s2')!.expectedReadyAt).toEqual(new Date(APPROVED.getTime() + 25 * 60_000));
  });

  it('a CANCELLED segment is left untouched — never revived', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.CANCELLED, preparationEstimateMinutes: 15, expectedReadyAt: OLD },
    ]);
    await reanchorPreparationTiming(manager, 'o1', APPROVED);
    expect(store.get('s1')!.expectedReadyAt).toEqual(OLD);
  });

  it('a segment whose branch never configured a preparation time stays null — never invented', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: null, expectedReadyAt: null },
    ]);
    await reanchorPreparationTiming(manager, 'o1', APPROVED);
    expect(store.get('s1')!.expectedReadyAt).toBeNull();
  });

  it('only touches segments belonging to the given order', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: 15, expectedReadyAt: OLD },
      { id: 's2', orderId: 'o2', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: 15, expectedReadyAt: OLD },
    ]);
    await reanchorPreparationTiming(manager, 'o1', APPROVED);
    expect(store.get('s1')!.expectedReadyAt).not.toEqual(OLD);
    expect(store.get('s2')!.expectedReadyAt).toEqual(OLD);
  });

  it('defaults `from` to now when omitted', async () => {
    const { manager, store } = harness([
      { id: 's1', orderId: 'o1', status: OrderVendorSegmentStatus.PENDING, preparationEstimateMinutes: 15, expectedReadyAt: OLD },
    ]);
    const before = Date.now();
    await reanchorPreparationTiming(manager, 'o1');
    const readyAt = store.get('s1')!.expectedReadyAt as Date;
    expect(readyAt.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
  });
});
