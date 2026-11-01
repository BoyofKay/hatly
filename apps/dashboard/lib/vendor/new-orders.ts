import type { VendorOrder } from '../api/vendor-orders';

/** Ids of the orders that appeared since `known` (the ids already seen by this browser session). Pure — the feed and its tests share it. */
export function findNewOrderIds(known: ReadonlySet<string>, orders: ReadonlyArray<Pick<VendorOrder, 'id'>>): string[] {
  return orders.filter((o) => !known.has(o.id)).map((o) => o.id);
}

/** Orders that still wait for THIS vendor to accept (at least one of its parts is PENDING) — the number the nav indicator shows. */
export function countAwaitingAcceptance(orders: ReadonlyArray<Pick<VendorOrder, 'segments'>>): number {
  return orders.filter((o) => o.segments.some((s) => s.status === 'PENDING')).length;
}

/** Tab title with the awaiting count in front, e.g. `(3) Hatly Vendor`; the plain title when nothing waits. */
export function titleWithCount(base: string, awaiting: number): string {
  return awaiting > 0 ? `(${awaiting}) ${base}` : base;
}
