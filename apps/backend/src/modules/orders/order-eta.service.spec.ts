import { OrderEtaService } from './order-eta.service';
import { OrderStatus } from './order-status.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';

const svc = (buffer: number | null = null) => new OrderEtaService({ getEtaRangeBufferMinutes: async () => buffer } as any);
const NOW = new Date('2026-01-01T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const base = { status: OrderStatus.PENDING, fulfillmentType: FulfillmentType.DELIVERY, estimatedTravelSeconds: 600 };

describe('OrderEtaService — derived, operational, never fabricated', () => {
  it('delivery = the slowest active vendor\'s readiness + the frozen travel time', async () => {
    const r = await svc().compute({ ...base, segments: [{ status: 'PENDING', expectedReadyAt: at(10) }, { status: 'CONFIRMED', expectedReadyAt: at(30) }] }, NOW);
    expect(r).toMatchObject({ state: 'ESTIMATED', estimatedAt: at(40).toISOString(), estimatedUntil: at(40).toISOString(), delayed: false });
  });

  it('a configured buffer widens the range only — no buffer, no invented range', async () => {
    const r = await svc(15).compute({ ...base, segments: [{ status: 'PENDING', expectedReadyAt: at(10) }] }, NOW);
    expect(r.estimatedAt).toBe(at(20).toISOString());
    expect(r.estimatedUntil).toBe(at(35).toISOString());
  });

  it('pickup has no travel time', async () => {
    const r = await svc().compute({ ...base, fulfillmentType: FulfillmentType.PICKUP, estimatedTravelSeconds: null, segments: [{ status: 'PENDING', expectedReadyAt: at(12) }] }, NOW);
    expect(r).toMatchObject({ state: 'ESTIMATED', estimatedAt: at(12).toISOString() });
  });

  it('cancelled segments are ignored; if none is left there is no ETA', async () => {
    expect((await svc().compute({ ...base, segments: [{ status: 'CANCELLED', expectedReadyAt: at(500) }, { status: 'PENDING', expectedReadyAt: at(5) }] }, NOW)).estimatedAt).toBe(at(15).toISOString());
    expect(await svc().compute({ ...base, segments: [{ status: 'CANCELLED', expectedReadyAt: at(5) }] }, NOW)).toMatchObject({ state: 'UNAVAILABLE', reason: 'NO_ACTIVE_VENDORS' });
  });

  it('any missing ingredient → UNAVAILABLE with a reason, never a default number', async () => {
    expect(await svc().compute({ ...base, segments: [{ status: 'PENDING', expectedReadyAt: at(5) }, { status: 'PENDING', expectedReadyAt: null }] }, NOW)).toMatchObject({ state: 'UNAVAILABLE', reason: 'PREPARATION_TIME_NOT_CONFIGURED', estimatedAt: null });
    for (const travel of [null, undefined, 0, -5]) {
      expect(await svc().compute({ ...base, estimatedTravelSeconds: travel, segments: [{ status: 'PENDING', expectedReadyAt: at(5) }] }, NOW)).toMatchObject({ state: 'UNAVAILABLE', reason: 'TRAVEL_TIME_UNAVAILABLE' });
    }
  });

  it('a vendor that is already READY is ready NOW — a long stale estimate does not push the ETA out', async () => {
    const r = await svc().compute({ ...base, segments: [{ status: 'READY_FOR_PICKUP', expectedReadyAt: at(-2) }, { status: 'READY_FOR_PICKUP', expectedReadyAt: at(60) }] }, NOW);
    expect(r.estimatedAt).toBe(at(10).toISOString()); // min(60, now)=now → now + 10 min travel
  });

  it('after pickup the clock starts at the pickup time', async () => {
    const r = await svc().compute({ ...base, status: OrderStatus.ON_THE_WAY, pickedUpAt: at(-5), segments: [{ status: 'PICKED_UP', expectedReadyAt: null }] }, NOW);
    expect(r.estimatedAt).toBe(at(5).toISOString());
  });

  it('an estimate already in the past is flagged delayed — delays are shown, they never cancel or reprice', async () => {
    const r = await svc().compute({ ...base, segments: [{ status: 'PENDING', expectedReadyAt: at(-60) }] }, NOW);
    expect(r).toMatchObject({ state: 'ESTIMATED', delayed: true });
  });

  it('CANCELLED / DELIVERED / FAILED_DELIVERY have a terminal state and no time', async () => {
    for (const [status, state] of [[OrderStatus.CANCELLED, 'CANCELLED'], [OrderStatus.DELIVERED, 'COMPLETED'], [OrderStatus.FAILED_DELIVERY, 'COMPLETED']] as const) {
      expect(await svc().compute({ ...base, status, segments: [{ status: 'PENDING', expectedReadyAt: at(5) }] }, NOW)).toEqual({ state, reason: undefined, estimatedAt: null, estimatedUntil: null, delayed: false });
    }
  });
});

describe('OrderEtaService — a pending Manual Transfer never implies preparation has started', () => {
  it('paymentBlocksFulfilment reports UNAVAILABLE/PAYMENT_NOT_APPROVED — even with segments that already have a real, ESTIMATE-worthy expectedReadyAt', async () => {
    const r = await svc().compute(
      { ...base, paymentBlocksFulfilment: true, segments: [{ status: 'PENDING', expectedReadyAt: at(10) }] },
      NOW,
    );
    expect(r).toEqual({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED', estimatedAt: null, estimatedUntil: null, delayed: false });
  });

  it('takes priority over every other reason (no active vendors, no preparation time, no travel time)', async () => {
    const noVendors = await svc().compute({ ...base, paymentBlocksFulfilment: true, segments: [] }, NOW);
    expect(noVendors.reason).toBe('PAYMENT_NOT_APPROVED');
    const noPrep = await svc().compute({ ...base, paymentBlocksFulfilment: true, segments: [{ status: 'PENDING', expectedReadyAt: null }] }, NOW);
    expect(noPrep.reason).toBe('PAYMENT_NOT_APPROVED');
  });

  it('false (or omitted) never affects the ordinary computation — COD/PAY_AT_DELIVERY/WALLET/an approved transfer', async () => {
    const withFlagFalse = await svc().compute({ ...base, paymentBlocksFulfilment: false, segments: [{ status: 'PENDING', expectedReadyAt: at(10) }] }, NOW);
    const withoutFlag = await svc().compute({ ...base, segments: [{ status: 'PENDING', expectedReadyAt: at(10) }] }, NOW);
    expect(withFlagFalse.state).toBe('ESTIMATED');
    expect(withFlagFalse).toEqual(withoutFlag);
  });

  it('a terminal order (cancelled/delivered/failed) reports its own terminal state regardless of the flag', async () => {
    const cancelled = await svc().compute({ ...base, status: OrderStatus.CANCELLED, paymentBlocksFulfilment: true, segments: [] }, NOW);
    expect(cancelled.state).toBe('CANCELLED');
  });
});
