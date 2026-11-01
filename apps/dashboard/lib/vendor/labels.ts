/** Bilingual wording for the Vendor area: statuses, payment methods and fulfilment, each as an English/Arabic pair. */
export const SEGMENT_STATUS: Record<string, [string, string]> = {
  PENDING: ['Waiting for you', 'بانتظارك'],
  CONFIRMED: ['Accepted', 'تم القبول'],
  PREPARING: ['Preparing', 'قيد التحضير'],
  READY_FOR_PICKUP: ['Ready for pickup', 'جاهز للاستلام'],
  PICKED_UP: ['Picked up', 'تم الاستلام من الفرع'],
  CANCELLED: ['Cancelled', 'ملغى'],
};
export const PAYMENT_METHOD: Record<string, [string, string]> = {
  COD: ['Cash on delivery', 'الدفع عند الاستلام'],
  WALLET: ['Wallet', 'المحفظة'],
  MANUAL_TRANSFER: ['Bank/wallet transfer', 'تحويل'],
  CARD: ['Card', 'بطاقة'],
};
export const FULFILLMENT: Record<string, [string, string]> = {
  DELIVERY: ['Delivery', 'توصيل'],
  PICKUP: ['Pickup', 'استلام من الفرع'],
};
export const pick = (m: Record<string, [string, string]>, key: string, t: (en: string, ar: string) => string): string => (m[key] ? t(m[key][0], m[key][1]) : key);

export const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-blue-50 text-blue-800 ring-blue-200',
  PREPARING: 'bg-blue-50 text-blue-800 ring-blue-200',
  READY_FOR_PICKUP: 'bg-green-50 text-green-800 ring-green-200',
  PICKED_UP: 'bg-gray-100 text-gray-700 ring-gray-200',
  CANCELLED: 'bg-red-50 text-red-800 ring-red-200',
};
