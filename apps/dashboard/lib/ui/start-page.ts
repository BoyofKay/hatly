import type { NavGroup } from '../../components/shell/nav';

/**
 * Stage 5 (2026-11-14) — the start page follows what the person does (their permissions; no new role):
 * - operations (orders + fulfilment or assignment) → the Operations board (overview one tap away, remembered);
 * - reports → the overview;
 * - settlement desk (closes drivers' shifts) → "Drivers today";
 * - anyone else → the first page their menu shows (e.g. catalogue staff → Products), instead of an empty overview.
 */
export function startPageFor(p: { role: string | null; can: (...perms: string[]) => boolean }, nav: NavGroup[]): 'ops' | 'overview' | string {
  if (p.can('VIEW_ORDERS') && p.can('MANAGE_ORDER_FULFILMENT', 'ASSIGN_REASSIGN_ORDERS')) return 'ops';
  if (p.can('VIEW_REPORTS')) return 'overview';
  if (p.can('CLOSE_DRIVER_SETTLEMENTS')) return '/drivers-today';
  for (const g of nav) for (const i of g.items) {
    if (i.href === '/home' || i.more || (!i.superOnly && !i.perms?.length)) continue; // pages open to everyone are not anyone's work
    if (i.superOnly ? p.role === 'SUPER_ADMIN' : p.can(...(i.perms ?? []))) return i.href;
  }
  return 'overview';
}

