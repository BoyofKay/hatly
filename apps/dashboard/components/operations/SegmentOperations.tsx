'use client';

import { useRef, useState } from 'react';
import { AdminOrderDetail, AdminSegmentHistoryEntry } from '../../lib/api/admin-failed-deliveries';
import { MANAGE_ORDER_FULFILMENT, SEGMENT_NEXT_ACTIONS, SegmentTarget, updateSegmentOnBehalf } from '../../lib/api/admin-operations';
import { apiErrorMessage } from '../../lib/api/errors';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { useI18n } from '../../lib/i18n/i18n';
import { MessageKey } from '../../lib/i18n/messages';

type Segment = AdminOrderDetail['segments'][number];

const ACTION_LABEL: Record<SegmentTarget, MessageKey> = {
  CONFIRMED: 'opSegActionAccept',
  PREPARING: 'opSegActionPreparing',
  READY_FOR_PICKUP: 'opSegActionReady',
  CANCELLED: 'opSegActionReject',
};

/**
 * One vendor part (segment) of an order: its status, the actions Hatly operations may take on the vendor's behalf (accept, start
 * preparing, mark ready, reject with a required reason) and its full history. Every action is the backend's own segment transition — the
 * page never computes money or state; it re-reads the order afterwards.
 */
/** The backend refuses every vendor-part change once the order left the vendor or ended (SEGMENT_LOCKED_ORDER_STATUSES); never offer one. */
const LOCKED_ORDER_STATUSES = ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'COLLECTED', 'CANCELLED', 'FAILED_DELIVERY'];

export function SegmentOperations({ segment, onChanged, orderStatus }: { segment: Segment; onChanged: () => Promise<void> | void; orderStatus?: string }) {
  const { t, locale } = useI18n();
  const canAct = useAdminPermission(MANAGE_ORDER_FULFILMENT);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [expectedReadyAt, setExpectedReadyAt] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const actions = orderStatus && LOCKED_ORDER_STATUSES.includes(orderStatus) ? [] : SEGMENT_NEXT_ACTIONS[segment.status] ?? [];
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB');

  async function run(status: SegmentTarget) {
    if (busyRef.current) return;
    if (status === 'CANCELLED' && !reason.trim()) {
      setFlash({ ok: false, message: t('opSegReasonRequired') });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFlash(null);
    try {
      await updateSegmentOnBehalf(segment.id, {
        status,
        ...(status === 'CANCELLED' ? { reason: reason.trim() } : {}),
        ...(status === 'PREPARING' && expectedReadyAt ? { expectedReadyAt: new Date(expectedReadyAt).toISOString() } : {}),
      });
      setFlash({ ok: true, message: t('opSegDone', { status: status.replace(/_/g, ' ') }) });
      setRejecting(false);
      setReason('');
    } catch (err) {
      setFlash({ ok: false, message: apiErrorMessage(err, t('opSegFailed')) });
    } finally {
      await onChanged(); // whoever won, the page shows the backend's truth
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded border bg-gray-50 p-2" data-testid={`segment-ops-${segment.id}`}>
      <p className="text-xs">
        <span className="font-medium">{segment.vendorName ?? segment.groupType}</span>
        {segment.branchName ? <span className="text-gray-500"> · {segment.branchName}</span> : null}
        <span className="ms-2 rounded bg-white px-1.5 py-0.5 text-gray-700" data-testid="segment-status">
          {segment.status.replace(/_/g, ' ')}
        </span>
      </p>
      {segment.rejectionReason && (
        <p className="mt-1 text-xs text-red-700" data-testid="segment-rejection-reason">
          {t('opSegReason')}: {segment.rejectionReason}
        </p>
      )}

      {actions.length === 0 ? (
        <p className="mt-1 text-xs text-gray-500">{t('opSegTerminal')}</p>
      ) : canAct === false ? (
        <p className="mt-1 text-xs text-gray-500">{t('opSegNoPermission')}</p>
      ) : (
        canAct === true && (
          <div className="mt-2 space-y-2">
            {actions.includes('PREPARING') && (
              <label className="block text-xs text-gray-600">
                {t('opSegExpectedReady')}
                <input
                  type="datetime-local"
                  value={expectedReadyAt}
                  onChange={(e) => setExpectedReadyAt(e.target.value)}
                  className="ms-2 rounded-lg border px-2 py-0.5 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              {actions
                .filter((a) => a !== 'CANCELLED')
                .map((a) => (
                  <button
                    key={a}
                    type="button"
                    data-testid={`segment-action-${a}`}
                    disabled={busy}
                    onClick={() => run(a)}
                    className="rounded-lg border bg-white px-3 py-1 text-xs font-medium disabled:opacity-50 border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                  >
                    {t(ACTION_LABEL[a])}
                  </button>
                ))}
              {actions.includes('CANCELLED') && !rejecting && (
                <button
                  type="button"
                  data-testid="segment-action-CANCELLED"
                  disabled={busy}
                  onClick={() => setRejecting(true)}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 disabled:opacity-50 border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                >
                  {t('opSegActionReject')}
                </button>
              )}
            </div>
            {rejecting && (
              <div className="rounded-xl border border-red-200 bg-white p-2" data-testid="segment-reject-form">
                <p className="text-xs font-medium">{t('opSegRejectTitle')}</p>
                <label className="mt-1 block text-xs text-gray-600">
                  {t('opSegRejectReason')}
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    data-testid="segment-reject-reason"
                    className="mt-1 w-full rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                  />
                </label>
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    data-testid="segment-reject-confirm"
                    disabled={busy}
                    onClick={() => run('CANCELLED')}
                    className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {t('opSegRejectConfirm')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="rounded-lg border px-3 py-1 text-xs border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
                    {t('opSegCancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {flash && (
        <p role={flash.ok ? 'status' : 'alert'} data-testid="segment-flash" className={`mt-1 text-xs ${flash.ok ? 'text-green-700' : 'text-red-600'}`}>
          {flash.message}
        </p>
      )}

      <SegmentHistory entries={segment.history ?? []} fmt={fmt} />
    </div>
  );
}

function SegmentHistory({ entries, fmt }: { entries: AdminSegmentHistoryEntry[]; fmt: (iso: string) => string }) {
  const { t } = useI18n();
  return (
    <div className="mt-2">
      <p className="text-xs font-medium uppercase text-gray-500">{t('opSegHistory')}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500">{t('opSegNoHistory')}</p>
      ) : (
        <ol className="mt-0.5 space-y-0.5 text-xs" data-testid="segment-history">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="font-medium">
                {e.fromStatus ? `${e.fromStatus.replace(/_/g, ' ')} → ` : ''}
                {e.toStatus.replace(/_/g, ' ')}
              </span>{' '}
              — {fmt(e.at)} ·{' '}
              {e.actorRole === 'SYSTEM' ? t('opSegBySystem') : t('opSegByRole', { name: e.actorName ?? e.actorRole })}
              {e.onBehalfOfVendor && <span className="ms-1 rounded bg-amber-100 px-1 text-amber-900">{t('opSegOnBehalf')}</span>}
              {e.reason && (
                <span className="ms-1 text-gray-600">
                  — {t('opSegReason')}: {e.reason}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
