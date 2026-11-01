'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, LabeledInput, LabeledSelect, LabeledTextarea, Modal, useToast } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { apiErrorMessage } from '../../lib/api/errors';
import { cairoNowLocal, cairoToIso } from '../../lib/ui/cairo-time';
import { cancelClosure, createClosure, getClosures, type Closure, type ClosureKind, type ClosureScope, type ClosureStatus, type ClosuresView } from '../../lib/api/vendor-operations';

const STATUS_TONE: Record<ClosureStatus, 'blue' | 'amber' | 'gray' | 'red'> = { ACTIVE: 'red', SCHEDULED: 'amber', ENDED: 'gray', CANCELLED: 'gray' };

/**
 * Closures and holidays of ONE branch: a temporary closure or a holiday with a reason and an explicit end. While one is active customers see the
 * branch closed and checkout refuses it; at the end time it reopens by itself — the manual open/closed switch is never changed by a closure. There is
 * no holiday calendar and no open-ended closure: a person schedules each one. A manager (or an Admin) schedules and cancels; others can read.
 */
export function BranchClosures({ scope, branchId, onChanged }: { scope: ClosureScope; branchId: string; onChanged?: () => void }) {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [view, setView] = useState<ClosuresView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ClosureKind>('TEMPORARY');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Closure | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setView(await getClosures(scope, branchId)); setError(null); } catch (e) { setError(apiErrorMessage(e, t('Could not load the closures.', 'تعذّر تحميل الإغلاقات.'))); }
  }, [scope, branchId, t]);
  useEffect(() => { void load(); }, [load]);

  function openForm() {
    setKind('TEMPORARY'); setStarts(cairoNowLocal(0)); setEnds(cairoNowLocal(3)); setReason(''); setFormError(null); setOpen(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const startsAt = cairoToIso(starts);
    const endsAt = cairoToIso(ends);
    if (!startsAt || !endsAt) return setFormError(t('Choose a start and an end.', 'اختر البداية والنهاية.'));
    setSaving(true);
    setFormError(null);
    try {
      await createClosure(scope, branchId, { kind, startsAt, endsAt, reason: reason.trim() });
      setOpen(false);
      toast.push('success', t('Closure scheduled.', 'تمت جدولة الإغلاق.'));
      await load();
      onChanged?.();
    } catch (err) {
      setFormError(apiErrorMessage(err, t('The closure was refused.', 'تم رفض الإغلاق.')));
    } finally { setSaving(false); }
  }
  async function confirmCancel() {
    if (!cancelling || busy) return;
    setBusy(true);
    try {
      await cancelClosure(scope, branchId, cancelling.id);
      toast.push('success', t('Closure cancelled.', 'تم إلغاء الإغلاق.'));
      setCancelling(null);
      await load();
      onChanged?.();
    } catch (err) {
      toast.push('error', apiErrorMessage(err, t('The closure could not be cancelled.', 'تعذّر إلغاء الإغلاق.')));
    } finally { setBusy(false); }
  }

  const kindLabel = (k: ClosureKind) => (k === 'HOLIDAY' ? t('Holiday', 'إجازة') : t('Temporary closure', 'إغلاق مؤقت'));
  const statusLabel: Record<ClosureStatus, string> = { ACTIVE: t('Closed now', 'مغلق الآن'), SCHEDULED: t('Scheduled', 'مجدول'), ENDED: t('Ended', 'انتهى'), CANCELLED: t('Cancelled', 'ملغى') };

  return (
    <Card
      title={t('Closures and holidays', 'الإغلاقات والإجازات')}
      actions={view?.canManage ? <Button size="sm" variant="primary" className="min-h-[36px]" onClick={openForm} data-testid={`closure-new-${branchId}`}>{t('Schedule a closure', 'جدولة إغلاق')}</Button> : undefined}
    >
      <div data-testid={`closures-${branchId}`}>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!view && !error && <p className="text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
        {view && (
          <>
            {view.current.active ? (
              <p role="status" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <b>{t('Closed to customers', 'مغلق أمام العملاء')}</b> — {kindLabel(view.current.active.kind)}: <bdi>{view.current.active.reason}</bdi>. {t('Reopens on its own at', 'يُعاد فتحه تلقائيًا في')} {dateTime(view.current.active.endsAt)}.
              </p>
            ) : view.current.next ? (
              <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('Next closure', 'الإغلاق القادم')}: {kindLabel(view.current.next.kind)} — {dateTime(view.current.next.startsAt)} → {dateTime(view.current.next.endsAt)} (<bdi>{view.current.next.reason}</bdi>)</p>
            ) : (
              <p className="mb-3 text-sm text-gray-500">{t('No closure is scheduled. Weekly hours and the open/closed switch decide as usual.', 'لا يوجد إغلاق مجدول. تسري المواعيد الأسبوعية ومفتاح الفتح والإغلاق كالمعتاد.')}</p>
            )}
            {view.closures.length > 0 && (
              <ul className="divide-y divide-gray-100">
                {view.closures.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[c.status]}>{statusLabel[c.status]}</Badge><span className="font-medium">{kindLabel(c.kind)}</span></p>
                      <p className="mt-0.5 text-xs text-gray-600">{dateTime(c.startsAt)} → {dateTime(c.endsAt)} · <bdi>{c.reason}</bdi></p>
                      <p className="text-xs text-gray-400">{t('Set by', 'بواسطة')} <bdi>{c.createdBy}</bdi>{c.cancelledAt ? ` · ${t('cancelled by', 'أُلغي بواسطة')} ${c.cancelledBy ?? ''}` : ''}</p>
                    </div>
                    {view.canManage && (c.status === 'SCHEDULED' || c.status === 'ACTIVE') && <Button size="sm" className="min-h-[36px]" onClick={() => setCancelling(c)}>{t('Cancel', 'إلغاء')}</Button>}
                  </li>
                ))}
              </ul>
            )}
            {!view.canManage && <p className="mt-2 text-xs text-gray-500">{t('Only a branch manager can schedule or cancel a closure.', 'يجدول مدير الفرع وحده الإغلاق أو يلغيه.')}</p>}
          </>
        )}
      </div>

      <Modal open={open} title={t('Schedule a closure', 'جدولة إغلاق')} onClose={() => !saving && setOpen(false)}
        footer={<><Button onClick={() => setOpen(false)} disabled={saving}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form={`closure-form-${branchId}`} loading={saving}>{t('Schedule', 'جدولة')}</Button></>}>
        <form id={`closure-form-${branchId}`} onSubmit={save} className="space-y-3">
          <LabeledSelect label={t('Kind', 'النوع')} value={kind} onChange={(e) => setKind(e.target.value as ClosureKind)}>
            <option value="TEMPORARY">{t('Temporary closure', 'إغلاق مؤقت')}</option>
            <option value="HOLIDAY">{t('Holiday', 'إجازة')}</option>
          </LabeledSelect>
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput label={t('From (Cairo time)', 'من (بتوقيت القاهرة)')} type="datetime-local" required value={starts} onChange={(e) => setStarts(e.target.value)} />
            <LabeledInput label={t('Reopens at (Cairo time)', 'يُعاد الفتح في (بتوقيت القاهرة)')} type="datetime-local" required value={ends} onChange={(e) => setEnds(e.target.value)} />
          </div>
          <LabeledTextarea label={t('Reason', 'السبب')} required rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} hint={t('Required. It is kept in the audit history.', 'مطلوب. يُحفظ في سجل المراجعة.')} />
          <p className="text-xs text-gray-500">{t('While the closure is active customers see the branch as closed and cannot place orders with it. It reopens by itself at the end time; the open/closed switch is not changed.', 'خلال الإغلاق يرى العملاء الفرع مغلقًا ولا يستطيعون الطلب منه. يُعاد فتحه تلقائيًا عند وقت النهاية؛ ولا يتغير مفتاح الفتح والإغلاق.')}</p>
          {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog open={!!cancelling} title={t('Cancel this closure?', 'إلغاء هذا الإغلاق؟')} message={cancelling ? (cancelling.status === 'ACTIVE' ? t('The branch will be open to customers again right away (subject to its open/closed switch).', 'سيُفتح الفرع للعملاء فورًا (وفق مفتاح الفتح والإغلاق).') : t('The scheduled closure will not happen.', 'لن يتم الإغلاق المجدول.')) : ''} confirmLabel={t('Cancel closure', 'إلغاء الإغلاق')} danger busy={busy} onConfirm={() => void confirmCancel()} onClose={() => setCancelling(null)} />
    </Card>
  );
}
