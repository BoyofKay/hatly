import { RequestContextService } from './request-context.service';
import { RequestContext } from './request-context.interface';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A plain class with zero knowledge of HTTP/Express — simulates a service several async layers below the controller. */
class DeepService {
  constructor(private readonly requestContextService: RequestContextService) {}

  async doWorkAfterSomeAwaits(): Promise<string | undefined> {
    await delay(1);
    await Promise.resolve();
    await delay(1);
    return this.requestContextService.getCorrelationId();
  }
}

describe('RequestContextService', () => {
  it('returns undefined outside any run() call', () => {
    const service = new RequestContextService();
    expect(service.get()).toBeUndefined();
    expect(service.getCorrelationId()).toBe('no-request-context');
  });

  it('makes the context available inside run()', () => {
    const service = new RequestContextService();
    const context: RequestContext = { correlationId: 'corr-1', method: 'GET', path: '/x' };

    service.run(context, () => {
      expect(service.get()).toEqual(context);
      expect(service.getCorrelationId()).toBe('corr-1');
    });
  });

  it('survives multiple await boundaries — a service several async hops below the entry point sees the correct id', async () => {
    const service = new RequestContextService();
    const deepService = new DeepService(service);

    const result = await service.run({ correlationId: 'deep-corr', method: 'POST', path: '/orders' }, () =>
      deepService.doWorkAfterSomeAwaits(),
    );

    expect(result).toBe('deep-corr');
  });

  it('CRITICAL: context does not leak from one call to the next — get() outside run() is undefined again after run() completes', () => {
    const service = new RequestContextService();

    service.run({ correlationId: 'leaked?', method: 'GET', path: '/a' }, () => {
      /* no-op */
    });

    expect(service.get()).toBeUndefined();
  });

  it('CRITICAL: concurrent overlapping requests never share or cross-contaminate correlation ids', async () => {
    const service = new RequestContextService();
    const observedForA: (string | undefined)[] = [];
    const observedForB: (string | undefined)[] = [];

    const runA = service.run({ correlationId: 'request-A', method: 'GET', path: '/a' }, async () => {
      observedForA.push(service.getCorrelationId());
      await delay(15); // A finishes LAST relative to B's individual hops below
      observedForA.push(service.getCorrelationId());
      await delay(1);
      observedForA.push(service.getCorrelationId());
    });

    const runB = service.run({ correlationId: 'request-B', method: 'POST', path: '/b' }, async () => {
      observedForB.push(service.getCorrelationId());
      await delay(1);
      observedForB.push(service.getCorrelationId());
      await delay(20); // B finishes LAST overall — deliberately interleaved with A's timers
      observedForB.push(service.getCorrelationId());
    });

    // Both continuations are genuinely in flight at the same time here,
    // with their timers interleaving (15ms/1ms for A vs 1ms/20ms for B),
    // not run one after the other.
    await Promise.all([runA, runB]);

    expect(observedForA).toEqual(['request-A', 'request-A', 'request-A']);
    expect(observedForB).toEqual(['request-B', 'request-B', 'request-B']);
  });

  it('CRITICAL: many concurrent requests each retain their own distinct id under heavy interleaving', async () => {
    const service = new RequestContextService();
    const CONCURRENCY = 25;

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        service.run({ correlationId: `req-${i}`, method: 'GET', path: `/item/${i}` }, async () => {
          // Randomized delays force genuinely unpredictable interleaving
          // across all 25 concurrent continuations.
          await delay(Math.random() * 5);
          const mid = service.getCorrelationId();
          await delay(Math.random() * 5);
          const end = service.getCorrelationId();
          return { expected: `req-${i}`, mid, end };
        }),
      ),
    );

    for (const { expected, mid, end } of results) {
      expect(mid).toBe(expected);
      expect(end).toBe(expected);
    }
  });
});
