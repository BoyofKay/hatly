/** Order exceptions (PD-016): the vocabulary shared by the vendor, customer and admin sides. Mirrors the CHECK constraints of migration 1700007000000. */

export const EXCEPTION_TYPES = ['ITEM_UNAVAILABLE', 'VENDOR_NO_RESPONSE', 'DELAYED_PREPARATION', 'CUSTOMER_CONTACT', 'VENDOR_CONTACT', 'PAYMENT_ISSUE', 'SUPERVISOR_REVIEW', 'OTHER'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const EXCEPTION_STATUSES = ['OPEN', 'AWAITING_CUSTOMER', 'AWAITING_OPERATIONS', 'ESCALATED', 'RESOLVED', 'WITHDRAWN'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];
export const CLOSED_EXCEPTION_STATUSES: ExceptionStatus[] = ['RESOLVED', 'WITHDRAWN'];

export type CustomerDecision = 'CONTINUE_WITHOUT' | 'CANCEL_ORDER';
export const CUSTOMER_DECISIONS: CustomerDecision[] = ['CONTINUE_WITHOUT', 'CANCEL_ORDER'];
export type DecisionChannel = 'APP' | 'PHONE' | 'WHATSAPP';
/** Channels an Operations employee may record: the customer was reached outside the app. */
export const OPERATIONS_DECISION_CHANNELS: DecisionChannel[] = ['PHONE', 'WHATSAPP'];

/** Order statuses in which an item can still be taken off the order (before a driver has the goods). */
export const ITEM_REMOVAL_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER'];

/**
 * Why "continue without the item(s)" could not be executed automatically. Each is a case the approved rules (PD-002…PD-004, C4) do not
 * resolve, so it is ISOLATED for a person instead of inventing a calculation.
 */
export type IsolationCode =
  | 'ORDER_WOULD_BE_EMPTY'
  | 'SEGMENT_WOULD_BE_EMPTY'
  | 'DISCOUNT_RECALCULATION_NOT_DEFINED'
  | 'ITEM_AMOUNT_UNKNOWN'
  | 'SECOND_REFUND_ON_SEGMENT_REQUIRES_REVIEW'
  | 'ORDER_NOT_EDITABLE';

export interface ExceptionEventView {
  id: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ExceptionItemView {
  orderItemId: string;
  productName: string | null;
  quantity: number;
  amountMinor: number | null;
  removedAmountMinor: number | null;
}

export interface ExceptionView {
  id: string;
  orderId: string;
  orderNumber: string;
  /** Status of the order the case is about (an order that is over can have its case closed by Operations). */
  orderStatus: string;
  segmentId: string | null;
  type: ExceptionType;
  status: ExceptionStatus;
  priority: 'NORMAL' | 'HIGH';
  summary: string | null;
  openedByRole: string | null;
  assignedToUserId: string | null;
  customerDecision: CustomerDecision | null;
  decisionChannel: DecisionChannel | null;
  decisionNote: string | null;
  decidedAt: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** Set while a financially isolated case waits for a person: why nothing was changed. */
  isolation: { code: string; message: string | null; at: string | null } | null;
  /** The employee responsible for the case (null = nobody yet). */
  responsible: { userId: string; name: string | null } | null;
  /** What has to happen next, as a stable code plus English text (the dashboard localizes from the code). */
  requiredAction: RequiredActionCode | null;
  requiredActionText: string | null;
  items: ExceptionItemView[];
  events?: ExceptionEventView[];
}

export type RequiredActionCode = 'REVIEW_ISOLATED_CASE' | 'EXECUTE_CANCELLATION' | 'DECIDE_ESCALATION' | 'CONTACT_CUSTOMER' | 'FOLLOW_UP_CUSTOMER' | 'REVIEW';

export const REQUIRED_ACTION_TEXT: Record<RequiredActionCode, string> = {
  REVIEW_ISOLATED_CASE: 'Nothing was changed: the rules do not define the money for this case. Speak to the customer again and record a new decision, or cancel the order.',
  EXECUTE_CANCELLATION: 'The customer asked to cancel the whole order. Execute the cancellation.',
  DECIDE_ESCALATION: 'Escalated: a supervisor must decide.',
  CONTACT_CUSTOMER: 'Contact the customer and record what they decided.',
  FOLLOW_UP_CUSTOMER: 'Waiting for the customer. If there is no answer, contact them and record their decision.',
  REVIEW: 'Review the case.',
};

/** The next step of an open case, derived from its state — never stored, so it cannot go stale. */
export function requiredActionFor(e: { status: ExceptionStatus; type: ExceptionType; customerDecision: string | null; isolationCode: string | null }): RequiredActionCode | null {
  if (CLOSED_EXCEPTION_STATUSES.includes(e.status)) return null;
  if (e.isolationCode) return 'REVIEW_ISOLATED_CASE';
  if (e.status === 'ESCALATED') return 'DECIDE_ESCALATION';
  if (e.status === 'AWAITING_OPERATIONS') return e.customerDecision === 'CANCEL_ORDER' ? 'EXECUTE_CANCELLATION' : 'CONTACT_CUSTOMER';
  if (e.status === 'AWAITING_CUSTOMER') return 'FOLLOW_UP_CUSTOMER';
  return 'REVIEW';
}
