/** Bilingual wording for the Admin area: order, payment, fulfilment and financial-event codes, each as an English/Arabic pair. */
export type Pair = [string, string];

export const ORDER_STATUS: Record<string, Pair> = {
  PENDING: ['Pending', 'قيد الانتظار'],
  CONFIRMED: ['Confirmed', 'مؤكد'],
  PREPARING: ['Preparing', 'قيد التحضير'],
  READY_FOR_PICKUP: ['Ready for pickup', 'جاهز للاستلام'],
  ASSIGNED_TO_DRIVER: ['Assigned to driver', 'مُسند لمندوب'],
  PICKED_UP: ['Picked up', 'تم الاستلام'],
  ON_THE_WAY: ['On the way', 'في الطريق'],
  DELIVERED: ['Delivered', 'تم التسليم'],
  CANCELLED: ['Cancelled', 'ملغى'],
  FAILED_DELIVERY: ['Failed delivery', 'توصيل فاشل'],
  COLLECTED: ['Collected', 'تم الاستلام من الفرع'],
};

export const PAYMENT_STATUS: Record<string, Pair> = {
  PENDING: ['Pending', 'قيد الانتظار'],
  CUSTOMER_CLAIMED_TRANSFER: ['Transfer claimed', 'العميل أبلغ بالتحويل'],
  UNDER_REVIEW: ['Under review', 'قيد المراجعة'],
  PAID: ['Paid', 'مدفوع'],
  REJECTED: ['Rejected', 'مرفوض'],
};

export const PAYMENT_METHOD: Record<string, Pair> = {
  COD: ['Cash on delivery', 'الدفع عند الاستلام'],
  ONLINE: ['Online', 'أونلاين'],
  MANUAL_TRANSFER: ['Manual transfer', 'تحويل يدوي'],
  PAY_AT_DELIVERY: ['Pay at delivery', 'الدفع عند التسليم'],
  WALLET: ['Wallet', 'المحفظة'],
};

export const FULFILLMENT: Record<string, Pair> = {
  DELIVERY: ['Delivery', 'توصيل'],
  PICKUP: ['Pickup', 'استلام من الفرع'],
};

/** Financial event types (backend `FinancialEventType`) — names only; the ledger's amounts and directions come from the backend unchanged. */
export const FINANCIAL_EVENT_TYPE: Record<string, Pair> = {
  VENDOR_COMMISSION_RECOGNIZED: ['Vendor commission recognized', 'عمولة مورد معترف بها'],
  DRIVER_COMMISSION_RECOGNIZED: ['Driver commission recognized', 'عمولة سائق معترف بها'],
  DRIVER_REIMBURSEMENT_OWED: ['Driver reimbursement owed', 'تعويض مستحق للسائق'],
  HATLY_SERVICE_CHARGE_RECOGNIZED: ['Hatly service charge recognized', 'رسوم خدمة هاتلي معترف بها'],
  CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED: ['Cancellation with prior expense', 'إلغاء بعد مصروف سابق'],
  FAILED_DELIVERY_RECORDED: ['Failed delivery recorded', 'توصيل فاشل مسجل'],
  MANUAL_TRANSFER_REFUND_RECORDED: ['Manual transfer refund recorded', 'استرداد تحويل يدوي مسجل'],
  EMPLOYEE_LOAN_ISSUED: ['Employee loan issued', 'سلفة موظف صادرة'],
  EMPLOYEE_LOAN_REPAYMENT_RECORDED: ['Employee loan repayment', 'سداد سلفة موظف'],
  HATLY_FUNDED_OFFER_DISCOUNT_RECORDED: ['Hatly-funded discount recorded', 'خصم ممول من هاتلي مسجل'],
  HATLY_FUNDED_OFFER_DISCOUNT_RESTORED: ['Hatly-funded discount restored', 'خصم ممول من هاتلي مسترد'],
};

export const FINANCIAL_DIRECTION: Record<string, Pair> = {
  RECEIVABLE: ['Receivable', 'مستحق لهاتلي'],
  PAYABLE: ['Payable', 'مستحق على هاتلي'],
  INFORMATIONAL: ['Informational', 'للعلم فقط'],
};

type T = (en: string, ar: string) => string;
/** Localized label for a known code; unknown codes are shown as-is (never hidden). */
export const label = (m: Record<string, Pair>, key: string | null | undefined, t: T): string => (key ? (m[key] ? t(m[key][0], m[key][1]) : key) : '—');
