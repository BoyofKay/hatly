import { EntityManager } from 'typeorm';
import type { StaffAlertsService } from '../notifications/staff-alerts.service';
import { Permission } from '../permissions/permission.enum';

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
  const parts: Array<{ vendor_branch_id: string; status: string; acceptance_mode: string }> = await manager.query(
    `SELECT DISTINCT s.vendor_branch_id, s.status, b.acceptance_mode FROM order_vendor_segments s JOIN vendor_branches b ON b.id = s.vendor_branch_id
      WHERE s.order_id = $1 AND s.group_type = 'CATALOG' AND s.vendor_branch_id IS NOT NULL AND s.status <> 'CANCELLED'`,
    [order.id],
  );
  for (const part of parts) {
    const hatlyAccepts = part.acceptance_mode === 'HATLY';
    if (hatlyAccepts && part.status === 'PENDING') {
      // R12: Hatly Operations accept or reject this branch's orders — they are the ones asked to act.
      await staffAlerts.alert(manager, {
        eventKey: `order:${order.id}:accept-for:${part.vendor_branch_id}`,
        category: 'OPS_ACCEPT_FOR_VENDOR',
        requiredAction: 'ACCEPT_ORDER',
        recipients: await staffAlerts.recipientsHolding(manager, [Permission.MANAGE_ORDER_FULFILMENT]),
        orderId: order.id,
        orderNumber: order.orderNumber ?? null,
        vendorBranchId: part.vendor_branch_id,
      } as Parameters<StaffAlertsService['alert']>[1]);
    }
    await staffAlerts.alert(manager, {
      eventKey: `order:${order.id}:new:${part.vendor_branch_id}`,
      category: 'VENDOR_NEW_ORDER',
      // A branch on automatic acceptance has already accepted it; on HATLY acceptance Hatly decides; otherwise the vendor must accept it.
      requiredAction: part.status === 'PENDING' && !hatlyAccepts ? 'ACCEPT_ORDER' : undefined,
      recipients: await staffAlerts.vendorRecipients(manager, part.vendor_branch_id),
      orderId: order.id,
      orderNumber: order.orderNumber ?? null,
      vendorBranchId: part.vendor_branch_id,
    } as Parameters<StaffAlertsService['alert']>[1]);
  }
}
