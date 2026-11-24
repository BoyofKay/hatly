import type { OpsAlertCategory } from '../api/ops-alerts';

/** English / Arabic names of each Operations alert, the action it asks for, and how it ended. */
export const OPS_CATEGORY: Record<OpsAlertCategory, [string, string]> = {
  NEW_ORDER: ['New order', 'طلب جديد'],
  ACCEPTANCE_OVERDUE: ['Store has not accepted', 'المتجر لم يقبل الطلب'],
  PREPARATION_LATE: ['Preparation is late', 'التحضير متأخر'],
  DRIVER_ACK_OVERDUE: ['Driver has not acknowledged', 'السائق لم يؤكد الاستلام'],
  NO_DRIVER: ['Needs a driver', 'يحتاج سائقًا'],
  DRIVER_NOT_RESPONDING: ['Driver not responding', 'السائق لا يستجيب'],
  ASSIGNMENT_ERROR: ['Driver assignment failed', 'فشل إسناد السائق'],
  FAILED_DELIVERY: ['Delivery failed', 'فشل التوصيل'],
  DRIVER_LONG_SHIFT: ['Long driver shift', 'وردية طويلة'],
  DRIVER_CASH_EXPOSURE: ['Driver cash exposure', 'تجاوز حد النقدية'],
  DRIVER_OFFLINE: ['Driver offline — order may not have reached them', 'المندوب غير متصل — قد لا يكون الطلب وصله'],
};

export const OPS_ACTION: Record<OpsAlertCategory, [string, string]> = {
  NEW_ORDER: ['Make sure the store accepts it', 'تأكد أن المتجر يقبله'],
  ACCEPTANCE_OVERDUE: ['Call the store', 'اتصل بالمتجر'],
  PREPARATION_LATE: ['Check with the store', 'تابع مع المتجر'],
  DRIVER_ACK_OVERDUE: ['Contact the driver', 'تواصل مع السائق'],
  NO_DRIVER: ['Assign a driver', 'أسند سائقًا'],
  DRIVER_NOT_RESPONDING: ['Contact or replace the driver', 'تواصل مع السائق أو استبدله'],
  ASSIGNMENT_ERROR: ['Assign a driver', 'أسند سائقًا'],
  FAILED_DELIVERY: ['Decide what happens next', 'قرّر الخطوة التالية'],
  DRIVER_LONG_SHIFT: ['Review driver duty hours', 'راجع ساعات عمل المندوب'],
  DRIVER_CASH_EXPOSURE: ['Review outstanding cash', 'راجع النقدية المستحقة'],
  DRIVER_OFFLINE: ['Call the driver, or reassign the order', 'اتصل بالمندوب أو أعد إسناد الطلب'],
};

/** DRIVER_OFFLINE detail: "OFFLINE|<last seen ISO>" (switched offline) or "SILENT|<last seen ISO>" (app not heard from). */
export function driverOfflineDetail(detail: string | null | undefined, now: number, locale: 'en' | 'ar'): string | null {
  if (!detail) return null;
  const [reason, seen] = detail.split('|');
  const why = reason === 'OFFLINE' ? (locale === 'ar' ? 'أغلق المندوب حالة الاتصال' : 'driver switched to offline') : locale === 'ar' ? 'تطبيق المندوب لا يستجيب' : 'driver app not heard from';
  const last = seen ? (locale === 'ar' ? `آخر اتصال منذ ${age(seen, now, locale)}` : `last seen ${age(seen, now, locale)} ago`) : locale === 'ar' ? 'لم يُسجَّل اتصال' : 'never seen';
  return `${why} · ${last}`;
}

export const OPS_RESOLUTION: Record<string, [string, string]> = {
  SHIFT_ENDED: ['Shift ended', 'انتهت الوردية'],
  CASH_EXPOSURE_CLEARED: ['Cash exposure cleared', 'انخفضت النقدية المستحقة'],
  STORE_RESPONDED: ['Store responded', 'استجاب المتجر'],
  ORDER_ENDED: ['Order ended', 'انتهى الطلب'],
  PREPARATION_DONE: ['Preparation done', 'اكتمل التحضير'],
  DISPATCH_ALERT_CLOSED: ['Dispatch alert closed', 'أُغلق تنبيه الإسناد'],
  DRIVER_ACKNOWLEDGED: ['Driver acknowledged', 'أكد السائق'],
  DRIVER_ASSIGNED: ['Driver assigned', 'أُسند سائق'],
  FAILED_DELIVERY_HANDLED: ['Failed delivery handled', 'عولج التوصيل الفاشل'],
  DRIVER_RECONNECTED: ['Driver back online', 'عاد المندوب للاتصال'],
  DRIVER_REASSIGNED: ['Order moved to another driver', 'نُقل الطلب لمندوب آخر'],
  DRIVER_RELEASED: ['Order released from the driver', 'سُحب الطلب من المندوب'],
};

/** "3 min" / "2 h" / "1 d", in the page's language. */
export function age(iso: string, now: number, locale: 'en' | 'ar'): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 60) return locale === 'ar' ? `${m} د` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === 'ar' ? `${h} س` : `${h} h`;
  return locale === 'ar' ? `${Math.floor(h / 24)} يوم` : `${Math.floor(h / 24)} d`;
}
