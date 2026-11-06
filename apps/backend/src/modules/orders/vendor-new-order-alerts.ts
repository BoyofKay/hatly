import { EntityManager } from 'typeorm';
import type { StaffAlertsService } from '../notifications/staff-alerts.service';

/**
 * Tells the staff of each vendor branch in an order that a new order arrived (only their own branch's part; never customer data),
 * in the caller's transaction. The event key is per (order, branch), so calling it twice never notifies twice.
 *
 * R2 (decision register 2026-11-06): for an InstaPay / Vodafone Cash (MANUAL_TRANSFER) order this is NOT called when the order is
 * placed — only once Operations mark the payment PAID — because the vendor must not see the order before the money is verified.
 */
export async function notifyVendorsOfNewOrder(
  manager: EntityManager,
  staffAlerts: StaffAlertsService,
  order: { id: string; orderNumber?: string | null },
): Promise<void> {
  const parts: Array<{ vendor_branch_id: string; status: string }> = await manager.query(
    `SELECT DISTINCT vendor_branch_id, status FROM order_vendor_segments
      WHERE order_id = $1 AND group_type = 'CATALOG' AND vendor_branch_id IS NOT NULL AND status <> 'CANCELLED'`,
    [order.id],
  );
  for (const part of parts) {
    await staffAlerts.alert(manager, {
      eventKey: `order:${order.id}:new:${part.vendor_branch_id}`,
      category: 'VENDOR_NEW_ORDER',
      // A branch on automatic acceptance has already accepted it; the others must accept it.
      requiredAction: part.status === 'PENDING' ? 'ACCEPT_ORDER' : undefined,
      recipients: await staffAlerts.vendorRecipients(manager, part.vendor_branch_id),
      orderId: order.id,
      orderNumber: order.orderNumber ?? null,
      vendorBranchId: part.vendor_branch_id,
    } as Parameters<StaffAlertsService['alert']>[1]);
  }
}
