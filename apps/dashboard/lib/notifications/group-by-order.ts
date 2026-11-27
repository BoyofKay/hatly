/**
 * Owner request 2026-11-27: one entry per ORDER instead of one per event. Notifications of the same order are folded into a group
 * (newest first inside, groups ordered by their newest notification); notifications with no order stay on their own.
 */
export interface GroupableAlert { id: string; orderId: string | null; orderNumber: string | null; isRead: boolean; createdAt: string; severity?: string }

export interface AlertGroup<T extends GroupableAlert> {
  key: string;
  orderId: string | null;
  orderNumber: string | null;
  items: T[]; // newest first
  latest: T;
  unread: number;
  critical: boolean;
}

export function groupByOrder<T extends GroupableAlert>(alerts: T[]): AlertGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const a of alerts) {
    const key = a.orderId ? `o:${a.orderId}` : a.orderNumber ? `n:${a.orderNumber}` : `a:${a.id}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const sorted = [...items].sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
      return {
        key,
        orderId: sorted[0].orderId,
        orderNumber: sorted.find((x) => x.orderNumber)?.orderNumber ?? null,
        items: sorted,
        latest: sorted[0],
        unread: sorted.filter((x) => !x.isRead).length,
        critical: sorted.some((x) => !x.isRead && x.severity === 'CRITICAL'),
      };
    })
    .sort((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt));
}

/** Unread notifications per order id — the count shown on an order's row (Home board, Orders). */
export function unreadByOrder(alerts: GroupableAlert[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of alerts) if (!a.isRead && a.orderId) m.set(a.orderId, (m.get(a.orderId) ?? 0) + 1);
  return m;
}
