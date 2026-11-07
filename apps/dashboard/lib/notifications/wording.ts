import type { StaffAlert } from '../api/staff-notifications';

/** Staff notification wording (the server stores codes only) and where each one leads. Shared by the bell and the Notification Center. */
export type Pair = [string, string];

export const CATEGORY: Record<string, Pair> = {
  EXCEPTION_NEW: ['New order exception', 'استثناء جديد في طلب'],
  EXCEPTION_ASSIGNED: ['An exception was assigned to you', 'عُيّنت لك حالة'],
  EXCEPTION_ESCALATED: ['Exception escalated', 'حالة مُصعَّدة'],
  EXCEPTION_ACTION_REQUIRED: ['The customer asked to cancel the order', 'طلب العميل إلغاء الطلب'],
  EXCEPTION_ISOLATED: ['A case needs a person — nothing was changed', 'حالة تحتاج إلى شخص — لم يتغيّر شيء'],
  VENDOR_ITEMS_REMOVED: ['Items were taken off an order', 'حُذفت منتجات من طلب'],
  VENDOR_ORDER_CANCELLED: ['An order was cancelled — stop preparing it', 'أُلغي طلب — توقف عن تجهيزه'],
  VENDOR_ACTION_REQUESTED: ['Hatly operations need your action', 'العمليات تطلب منك إجراءً'],
  VENDOR_NEW_ORDER: ['New order', 'طلب جديد'],
  VENDOR_PART_CANCELLED: ['An order was cancelled — stop preparing it', 'أُلغي طلب — توقف عن تجهيزه'],
  OPS_DISPATCH_NEEDED: ['An order needs a driver', 'طلب يحتاج إلى سائق'],
  OPS_TRANSFER_TO_VERIFY: ['A transfer is waiting for verification', 'تحويل بانتظار التحقق'],
  OPS_FAILED_DELIVERY: ['A delivery failed', 'فشل توصيل طلب'],
  OPS_CANCELLED_AFTER_ASSIGNMENT: ['An order was cancelled after a driver was assigned', 'أُلغي طلب بعد إسناده لسائق'],
  OPS_BRANCH_CHANGE_REQUEST: ['A store asks for a change', 'متجر يطلب تغييرًا'],
  VENDOR_BRANCH_CHANGE_DECIDED: ['Hatly decided on your store request', 'قرّرت هاتلي بشأن طلب متجرك'],
  OPS_PRODUCT_REVIEW: ['A product change needs review', 'تغيير منتج يحتاج مراجعة'],
  VENDOR_PRODUCT_REVIEW_DECIDED: ['Hatly reviewed your product change', 'راجعت هاتلي تغيير منتجك'],
};

export const ACTION: Record<string, Pair> = {
  REVIEW_NEW_CASE: ['Review the case', 'راجع الحالة'],
  EXECUTE_CANCELLATION: ['Execute the cancellation', 'نفّذ الإلغاء'],
  REVIEW_ISOLATED_CASE: ['Speak to the customer again and decide', 'تواصل مع العميل مجددًا واتخذ القرار'],
  DECIDE_ESCALATION: ['A supervisor must decide', 'يلزم قرار من مشرف'],
  PREPARE_WITHOUT_ITEMS: ['Prepare the rest of the order', 'جهّز باقي الطلب'],
  STOP_PREPARING: ['Stop preparing this order', 'توقف عن تجهيز هذا الطلب'],
  VENDOR_ACTION: ['Open the order', 'افتح الطلب'],
  ACCEPT_ORDER: ['Accept the order', 'اقبل الطلب'],
  ASSIGN_DRIVER: ['Assign a driver', 'أسند سائقًا'],
  VERIFY_TRANSFER: ['Verify the transfer', 'تحقّق من التحويل'],
  RESOLVE_FAILED_DELIVERY: ['Resolve the failed delivery', 'عالج التوصيل الفاشل'],
  CONTACT_DRIVER: ['Tell the driver to stop; decide on any trip compensation', 'أبلغ السائق بالتوقف وقرّر أي تعويض عن المشوار'],
  REVIEW_BRANCH_REQUEST: ['Approve or reject the request', 'وافق على الطلب أو ارفضه'],
  REVIEW_PRODUCT_REQUEST: ['Approve or reject the product change', 'وافق على تغيير المنتج أو ارفضه'],
};

/** Dispatch-alert reasons carried in an OPS_DISPATCH_NEEDED note. */
const REASON: Record<string, Pair> = {
  AUTO_ASSIGN_DISABLED: ['Automatic assignment is off', 'الإسناد التلقائي مُعطّل'],
  NO_ELIGIBLE_DRIVER: ['No eligible driver is available', 'لا يوجد سائق مؤهل متاح'],
  ASSIGNMENT_ERROR: ['Automatic assignment failed', 'فشل الإسناد التلقائي'],
  DRIVER_NOT_RESPONDING: ['The driver did not respond', 'لم يستجب السائق'],
  ACKNOWLEDGEMENT_OVERDUE: ['The driver has not acknowledged the order', 'لم يؤكد السائق استلام الطلب'],
};

export const words = (m: Record<string, Pair>, key: string | null | undefined, locale: 'en' | 'ar'): string => (key && m[key] ? m[key][locale === 'ar' ? 1 : 0] : key ?? '');
export const noteText = (a: StaffAlert, locale: 'en' | 'ar'): string | null => (a.note ? (a.category === 'OPS_DISPATCH_NEEDED' && REASON[a.note] ? words(REASON, a.note, locale) : a.note) : null);

/**
 * Where an Operations notification leads: the page that holds the action when this admin may open it, otherwise the order (the inbox itself
 * needs the order-viewing permission, so the order is always reachable). `can` is the shell's permission check.
 */
export function adminHref(a: StaffAlert, can: (...perms: string[]) => boolean): string | null {
  if (a.exceptionId) return `/exceptions?case=${a.exceptionId}`;
  if (a.category === 'OPS_FAILED_DELIVERY' && can('MANAGE_ORDER_ISSUES')) return '/failed-deliveries';
  if (a.category === 'OPS_BRANCH_CHANGE_REQUEST' && can('MANAGE_VENDORS')) return '/branch-requests';
  if (a.category === 'OPS_PRODUCT_REVIEW' && (can('MANAGE_CATALOG') || can('CATALOG_VIEW'))) return '/product-requests';
  if (a.category === 'OPS_TRANSFER_TO_VERIFY' && can('VERIFY_MANUAL_PAYMENTS')) return '/manual-transfer';
  return a.orderId ? `/order-management?order=${a.orderId}` : null;
}

/** A vendor notification always leads to the vendor's own order (the server only returns their branches' rows). */
export const vendorHref = (a: StaffAlert): string => (a.orderId ? `/orders/${a.orderId}` : a.category === 'VENDOR_BRANCH_CHANGE_DECIDED' ? '/my-branches' : a.category === 'VENDOR_PRODUCT_REVIEW_DECIDED' ? '/products' : '/notifications');
