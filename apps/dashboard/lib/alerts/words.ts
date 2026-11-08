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
};

export const OPS_RESOLUTION: Record<string, [string, string]> = {
  STORE_RESPONDED: ['Store responded', 'استجاب المتجر'],
  ORDER_ENDED: ['Order ended', 'انتهى الطلب'],
  PREPARATION_DONE: ['Preparation done', 'اكتمل التحضير'],
  DISPATCH_ALERT_CLOSED: ['Dispatch alert closed', 'أُغلق تنبيه الإسناد'],
  DRIVER_ACKNOWLEDGED: ['Driver acknowledged', 'أكد السائق'],
  DRIVER_ASSIGNED: ['Driver assigned', 'أُسند سائق'],
  FAILED_DELIVERY_HANDLED: ['Failed delivery handled', 'عولج التوصيل الفاشل'],
};

/** "3 min" / "2 h" / "1 d", in the page's language. */
export function age(iso: string, now: number, locale: 'en' | 'ar'): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 60) return locale === 'ar' ? `${m} د` : `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return locale === 'ar' ? `${h} س` : `${h} h`;
  return locale === 'ar' ? `${Math.floor(h / 24)} يوم` : `${Math.floor(h / 24)} d`;
}
