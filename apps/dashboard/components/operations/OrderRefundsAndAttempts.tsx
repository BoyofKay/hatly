'use client';

import { AdminOrderDetail } from '../../lib/api/admin-failed-deliveries';
import { useI18n } from '../../lib/i18n/i18n';
import { MessageKey } from '../../lib/i18n/messages';
import { formatMinor } from '../../lib/money';

/** What has been given back on the order, from the real ledgers (a transfer refund is never shown as sent until operations marked it). */
export function RefundSummaryCard({ summary }: { summary: NonNullable<AdminOrderDetail['refundSummary']> }) {
  const { t, locale } = useI18n();
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB');
  return (
    <div className="rounded-xl border bg-white p-4 text-sm border-gray-200 shadow-sm" data-testid="order-refunds">
      <h2 className="font-medium">{t('opRefundTitle')}</h2>
      {summary.totalRefundMinor === 0 && summary.pendingRefundMinor === 0 ? (
        <p className="mt-1 text-gray-500">{t('opRefundNone')}</p>
      ) : (
        <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
          <dt className="text-gray-500">{t('opRefundWallet')}</dt>
          <dd>{formatMinor(summary.walletRefundedMinor)}</dd>
          <dt className="text-gray-500">{t('opRefundTransferRecorded')}</dt>
          <dd>{formatMinor(summary.transferRefundRecordedMinor)}</dd>
          <dt className="text-gray-500">{t('opRefundTransferSent')}</dt>
          <dd>{formatMinor(summary.transferRefundSentMinor)}</dd>
          {summary.pendingRefundMinor > 0 && (
            <>
              <dt className="text-gray-500">{t('opRefundPending')}</dt>
              <dd>{formatMinor(summary.pendingRefundMinor)}</dd>
            </>
          )}
          <dt className="font-medium">{t('opRefundTotal')}</dt>
          <dd className="font-medium">{formatMinor(summary.totalRefundMinor)}</dd>
        </dl>
      )}
      {summary.transferRefunds.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {summary.transferRefunds.map((r) => (
            <li key={r.id}>
              {formatMinor(r.amountMinor)} — {fmt(r.recordedAt)} ·{' '}
              <span className={r.sentAt ? 'text-green-700' : 'text-amber-800'}>
                {r.sentAt ? t('opRefundSentAt', { date: fmt(r.sentAt) }) : t('opRefundNotSent')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DispatchAttemptsList({ attempts }: { attempts: NonNullable<AdminOrderDetail['dispatchAttempts']> }) {
  const { t, locale } = useI18n();
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB');
  return (
    <div className="mt-3">
      <h3 className="text-xs font-medium uppercase text-gray-500">{t('opAttemptsTitle')}</h3>
      {attempts.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">{t('opAttemptsNone')}</p>
      ) : (
        <ul className="mt-1 space-y-0.5" data-testid="od-attempts">
          {attempts.map((a, i) => (
            <li key={`${a.at}-${i}`}>
              {t(`opOutcome_${a.outcome}` as MessageKey)} — {fmt(a.at)}
              {a.detail && <span className="ms-1 text-gray-500">({a.detail})</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
