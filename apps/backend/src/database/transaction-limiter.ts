import { AsyncLocalStorage } from 'async_hooks';
import { DataSource } from 'typeorm';

/**
 * Pool-deadlock guard (M5 Batch 3).
 *
 * A database transaction holds one pooled connection for its whole duration. Application code running inside it frequently
 * reads other data through the normal repositories, which checks a SECOND connection out of the same pool. When as many
 * transactions are open as the pool has connections, every one of them waits for a connection that only another one of them can
 * release: the pool deadlocks, every request (reads included) stalls, and node-postgres waits forever by default. It was seen as
 * the intermittent 90 s hang of ten parallel checkouts against the default pool of ten.
 *
 * The invariant that makes this impossible: never let ALL connections be held by transactions. This limiter caps the number of
 * simultaneously open application transactions at `pool size - 1`, so at least one connection is always available for the reads
 * made inside them; those reads wait on nothing, finish, and release it. Extra transactions simply queue (FIFO) until a slot is
 * free — back-pressure instead of a stall. A transaction opened from inside another one (same async context) reuses its parent's
 * slot, so nesting can never make a request wait for itself.
 */
export class TransactionLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly context = new AsyncLocalStorage<true>();

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('TransactionLimiter limit must be an integer >= 1.');
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work(); // nested: already holds a slot
    await this.acquire();
    try {
      return await this.context.run(true, work);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve)); // the slot is handed over directly by release()
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next(); // hand the slot to the next waiter: `active` stays the same
    else this.active -= 1;
  }
}

/** Largest number of simultaneously open transactions a pool of `poolMax` connections can safely serve. */
export const safeTransactionLimit = (poolMax: number): number => Math.max(1, poolMax - 1);

/**
 * Routes every `dataSource.transaction(...)` / `manager.transaction(...)` through the limiter. (`DataSource.transaction`
 * delegates to the default manager, so wrapping the manager covers both entry points.)
 */
export function limitConcurrentTransactions(dataSource: DataSource, limiter: TransactionLimiter): DataSource {
  const manager = dataSource.manager;
  const original = manager.transaction.bind(manager) as (...args: unknown[]) => Promise<unknown>;
  (manager as unknown as { transaction: (...args: unknown[]) => Promise<unknown> }).transaction = (...args: unknown[]) =>
    limiter.run(() => original(...args));
  return dataSource;
}
