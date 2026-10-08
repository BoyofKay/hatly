import { TransactionLimiter, limitConcurrentTransactions, safeTransactionLimit } from './transaction-limiter';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('TransactionLimiter', () => {
  it('never lets more than `limit` pieces of work run at once, and runs every one of them', async () => {
    const limiter = new TransactionLimiter(3);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          await tick();
          running -= 1;
          done.push(i);
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(done).toHaveLength(20);
    expect(limiter.activeCount).toBe(0);
    expect(limiter.queuedCount).toBe(0);
  });

  it('queues first-in-first-out', async () => {
    const limiter = new TransactionLimiter(1);
    const order: number[] = [];
    const gates: Array<() => void> = [];
    const jobs = [0, 1, 2, 3].map((i) =>
      limiter.run(async () => {
        order.push(i);
        if (i === 0) await new Promise<void>((r) => gates.push(r));
      }),
    );
    await tick();
    expect(order).toEqual([0]); // the rest are queued behind the first
    expect(limiter.queuedCount).toBe(3);
    gates[0]();
    await Promise.all(jobs);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('releases the slot when the work throws (a failing transaction can never leak a slot)', async () => {
    const limiter = new TransactionLimiter(1);
    await expect(limiter.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(limiter.activeCount).toBe(0);
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('a nested run (same async context) reuses its parent slot — a request can never wait on itself, even at limit 1', async () => {
    const limiter = new TransactionLimiter(1);
    const result = await limiter.run(async () => {
      const inner = await limiter.run(async () => limiter.run(async () => 'deep'));
      expect(limiter.activeCount).toBe(1);
      return inner;
    });
    expect(result).toBe('deep');
    expect(limiter.activeCount).toBe(0);
  });

  it('a nested run does not leak the parent slot to unrelated work', async () => {
    const limiter = new TransactionLimiter(1);
    let unrelatedStarted = false;
    // Released explicitly (not by a wall-clock timer, which a loaded machine can fire before the check below runs).
    let openGate!: () => void;
    const gate = new Promise<void>((r) => (openGate = r));
    const parent = limiter.run(async () => { await gate; });
    const unrelated = limiter.run(async () => { unrelatedStarted = true; });
    await tick();
    expect(unrelatedStarted).toBe(false); // still queued behind the parent: only the parent's OWN async context is exempt
    openGate();
    await Promise.all([parent, unrelated]);
    expect(unrelatedStarted).toBe(true);
  });

  it('rejects an invalid limit', () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(() => new TransactionLimiter(bad)).toThrow();
  });

  it('safeTransactionLimit always leaves one connection free for reads made inside a transaction', () => {
    expect(safeTransactionLimit(10)).toBe(9);
    expect(safeTransactionLimit(2)).toBe(1);
    expect(safeTransactionLimit(1)).toBe(1);
  });
});

describe('limitConcurrentTransactions', () => {
  it('routes both manager.transaction and dataSource.transaction (which delegates to it) through the limiter', async () => {
    let running = 0;
    let peak = 0;
    const manager: any = {
      transaction: async (cb: (m: unknown) => Promise<unknown>) => {
        running += 1;
        peak = Math.max(peak, running);
        try {
          await tick();
          return await cb({});
        } finally {
          running -= 1;
        }
      },
    };
    const dataSource: any = { manager, transaction: (...args: unknown[]) => manager.transaction(...args) };
    limitConcurrentTransactions(dataSource, new TransactionLimiter(2));

    await Promise.all([
      ...Array.from({ length: 6 }, () => dataSource.transaction(async () => 1)),
      ...Array.from({ length: 6 }, () => manager.transaction(async () => 2)),
    ]);
    expect(peak).toBe(2);
  });

  it('passes through the isolation-level overload and returns the callback result', async () => {
    const seen: unknown[][] = [];
    const manager: any = { transaction: async (...args: unknown[]) => { seen.push(args); return (args[args.length - 1] as () => unknown)(); } };
    limitConcurrentTransactions({ manager } as any, new TransactionLimiter(1));
    await expect(manager.transaction('REPEATABLE READ', async () => 'v')).resolves.toBe('v');
    expect(seen[0][0]).toBe('REPEATABLE READ');
  });
});
