'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AccountDeletionRequestItem,
  completeAccountDeletionRequest,
  listAccountDeletionRequests,
  rejectAccountDeletionRequest,
} from '../../../lib/api/account-deletion';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, Tabs, useToast } from '../../../components/ui';

/**
 * SUPER_ADMIN review of "I can't sign in" deletion requests from the public /account-deletion page. The backend enforces SUPER_ADMIN; this page only
 * explains the procedure. VERIFY FIRST: call the number, or have the person send a WhatsApp message FROM that number to Hatly's official number, and
 * confirm they asked for deletion. Never ask for their password. Then complete with the method used. Deleting is permanent, so it is confirmed first.
 */
type Status = AccountDeletionRequestItem['status'];
type Method = NonNullable<AccountDeletionRequestItem['verificationMethod']>;
type Reason = NonNullable<AccountDeletionRequestItem['rejectionReason']>;

const METHODS: Array<[Method, string, string]> = [
  ['CALLBACK_TO_ACCOUNT_PHONE', 'I called this number and the person confirmed', 'اتصلت بهذا الرقم وأكّد الشخص'],
  ['WHATSAPP_FROM_ACCOUNT_PHONE', 'The person confirmed by WhatsApp FROM this number', 'أكّد الشخص عبر واتساب من هذا الرقم'],
];
const REASONS: Array<[Reason, string, string]> = [
  ['COULD_NOT_VERIFY', 'Could not verify', 'تعذّر التحقق'],
  ['WITHDRAWN_BY_REQUESTER', 'Withdrawn by the requester', 'سحبه مقدّم الطلب'],
  ['NO_ACCOUNT_FOR_NUMBER', 'No account for this number', 'لا يوجد حساب لهذا الرقم'],
  ['DUPLICATE', 'Duplicate', 'مكرر'],
];
const STATUS_LABEL: Record<Status, [string, string]> = { PENDING: ['Pending', 'قيد الانتظار'], COMPLETED: ['Completed', 'مكتمل'], REJECTED: ['Rejected', 'مرفوض'] };

export default function AccountDeletionRequestsPage() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [status, setStatus] = useState<Status>('PENDING');
  const [rows, setRows] = useState<AccountDeletionRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<Record<string, Method>>({});
  const [reason, setReason] = useState<Record<string, Reason>>({});
  const [confirm, setConfirm] = useState<AccountDeletionRequestItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await listAccountDeletionRequests(status));
    } catch (e) {
      setRows([]);
      setError(apiErrorMessage(e, t('Could not load deletion requests (SUPER_ADMIN only).', 'تعذّر تحميل طلبات الحذف (للمدير العام فقط).')));
    }
  }, [status, t]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function complete() {
    const row = confirm;
    const m = row && method[row.id];
    if (!row || !m || busyId) return;
    setBusyId(row.id);
    setActionError(null);
    try {
      await completeAccountDeletionRequest(row.id, m);
      toast.push('success', t('Account deleted; the request is completed and its phone number masked.', 'تم حذف الحساب؛ اكتمل الطلب وتم إخفاء رقم الهاتف.'));
      setConfirm(null);
      await load();
    } catch (e) {
      setActionError(apiErrorMessage(e, t('Could not complete the request.', 'تعذّر إكمال الطلب.')));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: AccountDeletionRequestItem) {
    const r = reason[row.id];
    if (!r || busyId) return;
    setBusyId(row.id);
    setError(null);
    try {
      await rejectAccountDeletionRequest(row.id, r);
      toast.push('success', t('Request rejected; nothing was deleted.', 'تم رفض الطلب؛ لم يُحذف شيء.'));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not reject the request.', 'تعذّر رفض الطلب.')));
    } finally {
      setBusyId(null);
    }
  }

  const selectCls = 'min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-2 text-sm shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 sm:min-h-0 sm:py-1.5';

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('Account deletion requests', 'طلبات حذف الحسابات')} />
      <div data-testid="adr-procedure" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-medium">{t('Verify before you delete', 'تحقّق قبل الحذف')}</p>
        <p className="mt-1">{t('Requests come from the public deletion page, from people who cannot sign in. Call the number, or have the person message Hatly on WhatsApp from that number, and confirm the request. Never ask for a password. An order in progress or a non-zero wallet blocks deletion (settle it first; the request stays pending).', 'تأتي الطلبات من صفحة الحذف العامة من أشخاص لا يستطيعون تسجيل الدخول. اتصل بالرقم أو اطلب من الشخص مراسلة هاتلي على واتساب من نفس الرقم وأكّد الطلب. لا تطلب كلمة مرور أبدًا. وجود طلب قيد التنفيذ أو رصيد محفظة غير صفري يمنع الحذف (سوِّه أولًا؛ يبقى الطلب معلقًا).')}</p>
      </div>
      <div className="mb-4"><Tabs value={status} onChange={(id) => setStatus(id as Status)} tabs={(['PENDING', 'COMPLETED', 'REJECTED'] as Status[]).map((s) => ({ id: s, label: t(STATUS_LABEL[s][0], STATUS_LABEL[s][1]) }))} /></div>

      {error && <div data-testid="adr-error" role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {rows === null ? (
        <div className="space-y-3" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : rows.length === 0 ? (
        error ? <ErrorState message={error} onRetry={load} /> : <Card><div data-testid="adr-empty"><EmptyState title={t(`No ${STATUS_LABEL[status][0].toLowerCase()} requests.`, `لا توجد طلبات ${STATUS_LABEL[status][1]}.`)} /></div></Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="adr-table">
          {rows.map((row) => (
            <li key={row.id} className="min-w-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-base font-semibold" dir="ltr">{row.phone}</p>
                  <p className="text-xs text-gray-500">{t('Requested', 'طُلب')} {dateTime(row.createdAt)}</p>
                </div>
                <Badge tone={row.status === 'PENDING' ? 'amber' : row.status === 'COMPLETED' ? 'green' : 'gray'}>{t(STATUS_LABEL[row.status][0], STATUS_LABEL[row.status][1])}</Badge>
              </div>
              {row.status === 'PENDING' ? (
                <div className="mt-3 space-y-3">
                  <div className="space-y-2">
                    <select className={selectCls} value={method[row.id] ?? ''} onChange={(e) => setMethod({ ...method, [row.id]: e.target.value as Method })} aria-label={t('Verification method', 'طريقة التحقق')}>
                      <option value="">{t('How was it verified?', 'كيف تم التحقق؟')}</option>
                      {METHODS.map(([v, en, ar]) => <option key={v} value={v}>{t(en, ar)}</option>)}
                    </select>
                    <Button variant="danger" className="min-h-[44px] w-full" disabled={!method[row.id] || busyId !== null} onClick={() => { setActionError(null); setConfirm(row); }}>{t('Delete account', 'حذف الحساب')}</Button>
                  </div>
                  <div className="space-y-2 border-t border-gray-100 pt-3">
                    <select className={selectCls} value={reason[row.id] ?? ''} onChange={(e) => setReason({ ...reason, [row.id]: e.target.value as Reason })} aria-label={t('Rejection reason', 'سبب الرفض')}>
                      <option value="">{t('Reject because…', 'ارفض لأن…')}</option>
                      {REASONS.map(([v, en, ar]) => <option key={v} value={v}>{t(en, ar)}</option>)}
                    </select>
                    <Button className="min-h-[44px] w-full" disabled={!reason[row.id] || busyId !== null} loading={busyId === row.id} onClick={() => void reject(row)}>{t('Reject', 'رفض')}</Button>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-600">
                  {(() => { const v = row.verificationMethod ? METHODS.find((m) => m[0] === row.verificationMethod) : REASONS.find((r) => r[0] === row.rejectionReason); return v ? t(v[1], v[2]) : '—'; })()}
                  {row.resolvedAt && <span className="text-gray-400"> · {dateTime(row.resolvedAt)}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={t('Delete this customer account?', 'حذف حساب هذا العميل؟')}
        message={confirm ? t(`Delete the customer account for ${confirm.phone}? This cannot be undone.`, `حذف حساب العميل صاحب الرقم ${confirm.phone}؟ لا يمكن التراجع.`) : ''}
        confirmLabel={t('Delete account', 'حذف الحساب')}
        danger
        busy={busyId !== null}
        error={actionError}
        onConfirm={() => void complete()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
