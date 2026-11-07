'use client';

import { Badge } from '../ui';

type T = (en: string, ar: string) => string;

/**
 * How an order is being paid, in words an operator acts on: a coloured state (paid · transfer to verify · rejected · to collect) and the method
 * underneath. Display only — the payment's real status comes from the backend unchanged.
 */
export function paymentState(method: string, status: string | null, t: T): { text: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  if (status === 'PAID') return { text: t('Paid', 'مدفوع'), tone: 'green' };
  if (status === 'UNDER_REVIEW' || status === 'CUSTOMER_CLAIMED_TRANSFER') return { text: t('Transfer to verify', 'تحويل للتحقق'), tone: 'amber' };
  if (status === 'REJECTED') return { text: t('Transfer rejected', 'تحويل مرفوض'), tone: 'red' };
  if (method === 'COD' || method === 'PAY_AT_DELIVERY') return { text: t('Collect on delivery', 'يُحصّل عند التسليم'), tone: 'gray' };
  if (method === 'MANUAL_TRANSFER') return { text: t('Awaiting transfer', 'بانتظار التحويل'), tone: 'gray' };
  return { text: status ? status.replace(/_/g, ' ').toLowerCase() : '—', tone: 'gray' };
}

export const METHOD_WORDS: Record<string, [string, string]> = {
  COD: ['Cash on delivery', 'الدفع عند الاستلام'],
  PAY_AT_DELIVERY: ['Pay at delivery', 'الدفع عند التسليم'],
  MANUAL_TRANSFER: ['Bank / wallet transfer', 'تحويل بنكي / محفظة'],
  WALLET: ['Hatly wallet', 'محفظة هاتلي'],
  ELECTRONIC: ['Online payment', 'دفع إلكتروني'],
  ONLINE: ['Online payment', 'دفع إلكتروني'],
};
export const methodWords = (method: string, t: T) => (METHOD_WORDS[method] ? t(...METHOD_WORDS[method]) : method.replace(/_/g, ' '));

export function PaymentPill({ method, status, t }: { method: string; status: string | null; t: T }) {
  const s = paymentState(method, status, t);
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-testid="payment-pill">
      <Badge tone={s.tone}>{s.text}</Badge>
      <span className="text-[11px] text-gray-500">{methodWords(method, t)}</span>
    </span>
  );
}
