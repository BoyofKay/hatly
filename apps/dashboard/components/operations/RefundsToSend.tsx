'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefundToSend, VERIFY_MANUAL_PAYMENTS, listManualTransferRefunds, markRefundSent } from '../../lib/api/admin-operations';
import { apiErrorMessage } from '../../lib/api/errors';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { I18nProvider, useI18n } from '../../lib/i18n/i18n';
import { formatMinor } from '../../lib/money';

/**
 * Manual Transfer refunds recorded by a rejected vendor part and not yet sent. The ledger entry is the obligation; only "Mark as sent"
 * (after the money really went out) closes it — the customer-facing summary says "sent" only then.
 */
export function RefundsToSend() {
  return (
    <I18nProvider>
      <Section />
    </I18nProvider>
  );
}

function Section() {
  const { t, locale } = useI18n();
  const canMark = useAdminPermission(VERIFY_MANUAL_PAYMENTS);
  const [rows, setRows] = useState<RefundToSend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listManualTransferRefunds(false));
    } catch (err) {
      setError(apiErrorMessage(err, t('opRefundsLoadFailed')));
    }
  }, [t]);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mark(eventId: string) {
    if (busyId) return;
    setBusyId(eventId);
    setFlash(null);
    try {
      await markRefundSent(eventId, notes[eventId]?.trim() || undefined);
      setFlash({ ok: true, message: t('opRefundsMarked') });
    } catch (err) {
      setFlash({ ok: false, message: apiErrorMessage(err, t('opRefundsMarkFailed')) });
    } finally {
      await load();
      setBusyId(null);
    }
  }

  return (
    <section className="mt-8 rounded-xl border bg-white p-4 border-gray-200 shadow-sm" data-testid="refunds-to-send">
      <h2 className="font-semibold">{t('opRefundsToSendTitle')}</h2>
      <p className="text-sm text-gray-500">{t('opRefundsToSendHint')}</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {flash && (
        <p role={flash.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${flash.ok ? 'text-green-700' : 'text-red-600'}`}>
          {flash.message}
        </p>
      )}
      {rows && rows.length === 0 && <p className="mt-2 text-sm text-gray-500">{t('opRefundsNone')}</p>}
      {canMark === false && <p className="mt-2 text-xs text-gray-500">{t('opRefundsNoPermission')}</p>}
      {rows && rows.length > 0 && (
        <ul className="mt-2 divide-y text-sm">
          {rows.map((r) => (
            <li key={r.eventId} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`refund-${r.eventId}`}>
              <span>
                {t('opRefundsOrder')}{' '}
                {r.orderId ? (
                  <Link href={`/order-search/${r.orderId}`} className="font-medium text-hatly-orange hover:underline" dir="ltr">
                    {r.orderNumber ?? r.orderId.slice(0, 8)}
                  </Link>
                ) : (
                  '—'
                )}{' '}
                · {t('opRefundsAmount')}: <b>{formatMinor(r.amountMinor)}</b> · {t('opRefundsRecorded')}:{' '}
                {new Date(r.recordedAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}
              </span>
              {canMark === true && (
                <span className="flex items-center gap-2">
                  <input
                    value={notes[r.eventId] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.eventId]: e.target.value }))}
                    placeholder={t('opRefundsNote')}
                    maxLength={500}
                    className="w-56 rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                  />
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => mark(r.eventId)}
                    data-testid={`refund-mark-sent-${r.eventId}`}
                    className="rounded-lg border px-3 py-1 text-xs font-medium disabled:opacity-50 border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                  >
                    {t('opRefundsMarkSent')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
