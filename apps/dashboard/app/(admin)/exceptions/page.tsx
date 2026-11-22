'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Async, Badge, Button, Card, ConfirmDialog, DataTable, FilterBar, KpiCard, LabeledInput, LabeledSelect, LabeledTextarea, Modal, PageHeader, Pagination, StatusPill, Tabs, useDebounced, usePaging, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { getCurrentUser } from '../../../lib/auth/session';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { fetchAdminChanges } from '../../../lib/api/changes';
import { useChangeFeed } from '../../../lib/changes/use-change-feed';

const TABS = ['ACTIVE', 'ISOLATED', 'AWAITING_CUSTOMER', 'AWAITING_OPERATIONS', 'ESCALATED', 'RESOLVED'] as const;

/** What has to happen next (the server sends a stable code). */
const REQUIRED: Record<string, [string, string]> = {
  REVIEW_ISOLATED_CASE: ['Nothing was changed — speak to the customer again and decide', 'لم يتغيّر شيء — تواصل مع العميل مجددًا واتخذ القرار'],
  EXECUTE_CANCELLATION: ['Execute the cancellation the customer asked for', 'نفّذ الإلغاء الذي طلبه العميل'],
  DECIDE_ESCALATION: ['A supervisor must decide', 'يلزم قرار من مشرف'],
  CONTACT_CUSTOMER: ['Contact the customer and record the decision', 'اتصل بالعميل وسجّل القرار'],
  FOLLOW_UP_CUSTOMER: ['Waiting for the customer — follow up if no answer', 'بانتظار العميل — تابع إن لم يرد'],
  REVIEW: ['Review the case', 'راجع الحالة'],
};

/** Why "continue without the items" could not run by itself — the approved rules do not resolve these cases (PD-016). */
const ISOLATION: Record<string, [string, string]> = {
  ORDER_WOULD_BE_EMPTY: ['Removing the items would leave the order empty. The order has to be cancelled instead.', 'حذف المنتجات سيترك الطلب فارغًا. يجب إلغاء الطلب بدلًا من ذلك.'],
  SEGMENT_WOULD_BE_EMPTY: ["Removing the items would leave this vendor's part empty — that is a rejected part, which has its own rules.", 'حذف المنتجات سيترك جزء هذا المورد فارغًا — وهذا يُعد رفضًا للجزء وله قواعده الخاصة.'],
  DISCOUNT_RECALCULATION_NOT_DEFINED: ['This vendor part has an order-level discount or coupon, and no approved rule recalculates it when items leave. A supervisor must decide.', 'يحتوي جزء هذا المورد على خصم أو قسيمة على مستوى الطلب، ولا توجد قاعدة معتمدة لإعادة حسابه عند حذف منتجات. يلزم قرار من مشرف.'],
  ITEM_AMOUNT_UNKNOWN: ['The amount of an item is not known, so it is not guessed.', 'مبلغ أحد المنتجات غير معروف، لذلك لا يُخمَّن.'],
  SECOND_REFUND_ON_SEGMENT_REQUIRES_REVIEW: ['A refund was already recorded for this vendor part; a second reduction needs a person to review it.', 'سُجّل استرداد لهذا الجزء من قبل؛ التخفيض الثاني يحتاج إلى مراجعة بشرية.'],
  ORDER_NOT_EDITABLE: ['The order can no longer be changed.', 'لم يعد من الممكن تعديل الطلب.'],
};
const VENDOR_ACTION_REQUESTED: [string, string] = ['Vendor asked to act', 'طُلب إجراء من المورد'];
const CLOSED_BY_OPERATIONS: [string, string] = ['Closed by Operations', 'أغلقتها العمليات'];

const ACTIONS: Record<string, [string, string]> = {
  ITEMS_MARKED_UNAVAILABLE: ['Items marked unavailable', 'تم تحديد منتجات كغير متاحة'],
  CUSTOMER_DECISION_RECORDED: ['Customer answered in the app', 'أجاب العميل من التطبيق'],
  OPERATIONS_RECORDED_DECISION: ['Decision recorded by Operations', 'سجّلت العمليات القرار'],
  CANCELLATION_REQUESTED: ['Customer asked to cancel the order', 'طلب العميل إلغاء الطلب'],
  EXECUTION_ISOLATED: ['Could not be done automatically', 'تعذّر التنفيذ تلقائيًا'],
  ITEMS_REMOVED_ORDER_CONTINUES: ['Items removed — order continues', 'حُذفت المنتجات — يستمر الطلب'],
  RESOLVED_ORDER_CANCELLED: ['Order cancelled', 'أُلغي الطلب'],
  NOTE_ADDED: ['Note', 'ملاحظة'],
  VENDOR_ACTION_REQUESTED,
  CLOSED_BY_OPERATIONS,
  ESCALATED: ['Escalated', 'تم التصعيد'],
  ASSIGNED: ['Assigned', 'تم التعيين'],
  UNASSIGNED: ['Unassigned', 'أُلغي التعيين'],
};

/** `useSearchParams` (alert deep links) needs a Suspense boundary in a statically built page. */
export default function ExceptionsPage() {
  return (
    <Suspense fallback={null}>
      <ExceptionsQueue />
    </Suspense>
  );
}

function ExceptionsQueue() {
  const { t, num, money, dateTime } = useLang();
  const { can } = usePermissions();
  const [tab, setTab] = useState<string>('ACTIVE');
  const [q, setQ] = useState('');
  const [assigned, setAssigned] = useState('');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([tab, search, assigned]));
  const status = tab === 'ACTIVE' || tab === 'ISOLATED' ? undefined : tab;
  const list = useApi<any[]>('/admin/order-exceptions', { status, isolated: tab === 'ISOLATED' ? 'true' : undefined, q: search || undefined, assignedTo: assigned || undefined, page, limit });
  const summary = useApi<any>('/admin/order-exceptions/summary');
  const [openId, setOpenId] = useState<string | null>(null);
  // Live updates: the list and the counts reload when the change feed (D-72) reports a change in exceptions — not on a timer. If the feed is
  // unavailable the hook falls back to the previous 20 s refresh by itself.
  const feedMode = useChangeFeed((since) => fetchAdminChanges('exceptions', since), async () => { list.reload(); summary.reload(); });
  // A link from an alert opens that case directly.
  const wanted = useSearchParams().get('case');
  useEffect(() => { if (wanted && /^[0-9a-f-]{36}$/i.test(wanted)) setOpenId(wanted); }, [wanted]);
  // From an order (Control Tower → "Exceptions queue"): open that order's case once the list has it.
  const wantedOrder = useSearchParams().get('order');
  useEffect(() => {
    if (!wantedOrder || wanted) return;
    const hit = (list.data ?? []).find((x: any) => (x.orderId ?? x.order?.id) === wantedOrder);
    if (hit) setOpenId(hit.id);
  }, [wantedOrder, wanted, list.data]);
  const ageText = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} ${t('min', 'د')}` : s < 172800 ? `${Math.round(s / 3600)} ${t('h', 'س')}` : `${Math.round(s / 86400)} ${t('d', 'ي')}`);
  const sm = summary.data;

  return (
    <div>
      {feedMode === 'legacy' && <p className="mb-2 text-xs text-gray-500" data-testid="exceptions-refresh-mode">{t('Refreshing every 20 seconds.', 'يتم التحديث كل 20 ثانية.')}</p>}
      <PageHeader
        title={t('Order exceptions', 'استثناءات الطلبات')}
        subtitle={t('Cases that need a person. For an unavailable product the customer either continues without it or cancels the whole order; with no answer, call the customer and record what they decided — silence is never consent.', 'حالات تحتاج إلى شخص. عند عدم توفر منتج، إما يكمل العميل بدونه أو يلغي الطلب كاملًا؛ وعند عدم الرد اتصل بالعميل وسجّل قراره — الصمت لا يُعد موافقة.')}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-7">
        <KpiCard label={t('Open', 'مفتوحة')} value={num(sm?.open ?? 0)} />
        <KpiCard label={t('Awaiting customer', 'بانتظار العميل')} value={num(sm?.awaitingCustomer ?? 0)} />
        <KpiCard label={t('Awaiting Operations', 'بانتظار العمليات')} value={num(sm?.awaitingOperations ?? 0)} tone={sm?.awaitingOperations ? 'bad' : 'neutral'} />
        <KpiCard label={t('Escalated', 'مُصعَّدة')} value={num(sm?.escalated ?? 0)} tone={sm?.escalated ? 'bad' : 'neutral'} />
        <KpiCard label={t('Unassigned', 'غير معيّنة')} value={num(sm?.unassigned ?? 0)} />
        <KpiCard label={t('Needs a person (isolated)', 'تحتاج إلى شخص (معزولة)')} value={num(sm?.isolated ?? 0)} tone={sm?.isolated ? 'bad' : 'neutral'} />
        <KpiCard label={t('Oldest open', 'الأقدم مفتوحة')} value={sm?.open ? ageText(sm.oldestOpenSeconds) : '—'} />
      </div>
      <Tabs tabs={TABS.map((id) => ({ id, label: { ACTIVE: t('Active', 'النشطة'), ISOLATED: t('Needs review', 'تحتاج مراجعة'), AWAITING_CUSTOMER: t('Awaiting customer', 'بانتظار العميل'), AWAITING_OPERATIONS: t('Awaiting Operations', 'بانتظار العمليات'), ESCALATED: t('Escalated', 'مُصعَّدة'), RESOLVED: t('Closed', 'المغلقة') }[id] }))} value={tab} onChange={setTab} />
      <FilterBar onClear={() => { setQ(''); setAssigned(''); }}>
        <div className="w-60"><LabeledInput label={t('Order number or customer', 'رقم الطلب أو العميل')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-48"><LabeledSelect label={t('Assigned to', 'المسؤول')} value={assigned} onChange={(e) => setAssigned(e.target.value)}><option value="">{t('Anyone', 'أي شخص')}</option><option value="me">{t('Me', 'أنا')}</option><option value="none">{t('Nobody', 'لا أحد')}</option></LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No cases here', 'لا توجد حالات')} columns={[
          { key: 'age', header: t('Age', 'العمر'), cell: (r: any) => <span className={r.ageSeconds > 3600 && r.status !== 'RESOLVED' ? 'font-medium text-red-700' : ''}>{ageText(r.ageSeconds)}</span> },
          { key: 'o', header: t('Order', 'الطلب'), cell: (r: any) => <button className="font-medium text-hatly-orangeDark hover:underline" onClick={() => setOpenId(r.id)}>{r.order.orderNumber}</button> },
          { key: 'c', header: t('Customer', 'العميل'), cell: (r: any) => <bdi>{r.customer.name}</bdi> },
          { key: 'v', header: t('Vendor', 'المورد'), cell: (r: any) => <bdi>{r.vendor ?? '—'}</bdi> },
          { key: 'i', header: t('Items', 'المنتجات'), align: 'end', cell: (r: any) => num(r.itemCount) },
          { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <span className="flex flex-wrap items-center gap-1"><StatusPill status={r.status} />{r.priority === 'HIGH' && <Badge tone="red">{t('High', 'عالية')}</Badge>}{r.isolation && <Badge tone="amber" title={ISOLATION[r.isolation.code] ? t(...ISOLATION[r.isolation.code]) : r.isolation.code}>{t('Nothing changed — needs a person', 'لم يتغيّر شيء — تحتاج إلى شخص')}</Badge>}</span> },
          { key: 'who', header: t('Responsible', 'المسؤول'), cell: (r: any) => (r.responsible ? <bdi>{r.responsible.name ?? '—'}</bdi> : <span className="text-red-700">{t('Nobody yet', 'لا أحد بعد')}</span>) },
          { key: 'next', header: t('Next step', 'الخطوة التالية'), cell: (r: any) => (r.requiredAction ? <span className="text-xs text-gray-700">{t(...(REQUIRED[r.requiredAction] ?? REQUIRED.REVIEW))}</span> : '—') },
          { key: 'd', header: t('Customer decision', 'قرار العميل'), cell: (r: any) => (r.customerDecision ? (r.customerDecision === 'CONTINUE_WITHOUT' ? t('Continue without', 'الاستمرار بدونها') : t('Cancel order', 'إلغاء الطلب')) : '—') },
          { key: 'a', header: '', align: 'end', cell: (r: any) => <Button size="sm" onClick={() => setOpenId(r.id)}>{t('Open', 'فتح')}</Button> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      {openId && <CasePanel id={openId} canCancel={can('MANAGE_ORDER_ISSUES')} canAct={can('MANAGE_ORDER_FULFILMENT')} onClose={() => setOpenId(null)} onChanged={() => { list.reload(); summary.reload(); }} money={money} dateTime={dateTime} />}
    </div>
  );
}

function CasePanel({ id, canCancel, canAct, onClose, onChanged, money, dateTime }: { id: string; canCancel: boolean; canAct: boolean; onClose: () => void; onChanged: () => void; money: (n: number) => string; dateTime: (s: string) => string }) {
  const { t, locale } = useLang();
  const toast = useToast();
  const ex = useApi<any>(`/admin/order-exceptions/${id}`);
  const [decision, setDecision] = useState('CONTINUE_WITHOUT');
  const [channel, setChannel] = useState('PHONE');
  const [note, setNote] = useState('');
  const [freeNote, setFreeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const d = ex.data;
  const closed = d && (d.status === 'RESOLVED' || d.status === 'WITHDRAWN');
  const already = d?.customerDecision as string | null;

  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true); setError(null);
    try {
      const r: any = await send('post', `/admin/order-exceptions/${id}/${path}`, body);
      toast.push('success', ok);
      if (path === 'record-decision' && r?.isolated) setError(ISOLATION[r.isolated] ? t(...ISOLATION[r.isolated]) : r.isolated);
      setNote(''); setFreeNote('');
      ex.reload(); onChanged();
    } catch (e) { setError(apiErrorMessage(e, t('The action failed.', 'فشل الإجراء.'))); } finally { setBusy(false); setConfirmCancel(false); }
  };
  const submitDecision = () => {
    const effective = already ?? decision;
    const body = already ? { decision: effective } : { decision, channel, note };
    if (effective === 'CANCEL_ORDER') { setConfirmCancel(true); return; }
    void run('record-decision', body, t('Done.', 'تم.'));
  };
  const myId = getCurrentUser()?.sub;

  return (
    <Modal open wide title={d ? t(`Case — order ${d.orderNumber}`, `حالة — الطلب ${d.orderNumber}`) : t('Case', 'حالة')} onClose={onClose}>
      <Async state={ex} rows={4}>
        {d && (
          <div className="space-y-4 text-sm">
            {d.isolation && (
              <div role="alert" data-testid="case-isolation" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                <strong>{t('Nothing was changed on this order.', 'لم يتغيّر شيء في هذا الطلب.')}</strong>{' '}
                {ISOLATION[d.isolation.code] ? t(...ISOLATION[d.isolation.code]) : d.isolation.code}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div><span className="text-xs text-gray-500">{t('Responsible', 'المسؤول')}</span><p data-testid="case-responsible" className="font-medium">{d.responsible ? <bdi>{d.responsible.name ?? '—'}</bdi> : <span className="text-red-700">{t('Nobody yet — assign it', 'لا أحد بعد — عيّنها')}</span>}</p></div>
              <div><span className="text-xs text-gray-500">{t('Next step', 'الخطوة التالية')}</span><p data-testid="case-next-step" className="font-medium">{d.requiredAction ? t(...(REQUIRED[d.requiredAction] ?? REQUIRED.REVIEW)) : t('Closed', 'مغلقة')}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={d.status} />{d.priority === 'HIGH' && <Badge tone="red">{t('High priority', 'أولوية عالية')}</Badge>}
              <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${d.orderId}`}>{t('Open the order', 'فتح الطلب')}</Link>
              <span className="text-xs text-gray-500">{dateTime(d.createdAt)}</span>
            </div>
            <Card title={t('Unavailable items', 'المنتجات غير المتاحة')}>
              <ul className="divide-y divide-gray-100">{d.items.map((i: any) => <li key={i.orderItemId} className="flex justify-between py-1.5"><span><bdi>{i.productName ?? '—'}</bdi> × {i.quantity}</span><span className="tabular-nums">{i.removedAmountMinor != null ? <span className="text-green-700">{t('removed', 'حُذف')} {money(i.removedAmountMinor)}</span> : i.amountMinor != null ? money(i.amountMinor) : t('amount unknown', 'المبلغ غير معروف')}</span></li>)}</ul>
            </Card>

            {!closed && canAct && (
              <Card title={t('What the customer decided', 'قرار العميل')}>
                {already ? (
                  <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-blue-900">{t('The customer already answered in the app:', 'أجاب العميل بالفعل من التطبيق:')} <strong>{already === 'CONTINUE_WITHOUT' ? t('continue without the items', 'الاستمرار بدون المنتجات') : t('cancel the whole order', 'إلغاء الطلب كاملًا')}</strong>. {t('You can only carry that answer out.', 'يمكنك فقط تنفيذ هذا الجواب.')}</p>
                ) : (
                  <div className="mb-3 space-y-3">
                    <p className="text-gray-600">{t('No answer yet. Call the customer (see the customer page for the number), then record exactly what they said. You cannot decide for them.', 'لا يوجد جواب بعد. اتصل بالعميل (الرقم في صفحة العميل) ثم سجّل ما قاله بالضبط. لا يمكنك اتخاذ القرار نيابةً عنه.')}</p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <LabeledSelect label={t('Decision', 'القرار')} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="CONTINUE_WITHOUT">{t('Continue without the items', 'الاستمرار بدون المنتجات')}</option>{canCancel && <option value="CANCEL_ORDER">{t('Cancel the entire order', 'إلغاء الطلب كاملًا')}</option>}</LabeledSelect>
                      <LabeledSelect label={t('How you reached them', 'طريقة التواصل')} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="PHONE">{t('Phone call', 'مكالمة هاتفية')}</option><option value="WHATSAPP">WhatsApp</option></LabeledSelect>
                      <div className="sm:col-span-3"><LabeledTextarea label={t('Note of the conversation (required)', 'ملخص المحادثة (مطلوب)')} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
                    </div>
                    {!canCancel && <p className="text-xs text-gray-500">{t('Cancelling the whole order needs supervisor authority.', 'إلغاء الطلب كاملًا يحتاج صلاحية مشرف.')}</p>}
                  </div>
                )}
                <Button variant="primary" loading={busy} disabled={!already && note.trim().length < 5} onClick={submitDecision}>{already ? t('Carry out the customer’s answer', 'تنفيذ جواب العميل') : t('Record and carry out', 'تسجيل وتنفيذ')}</Button>
              </Card>
            )}

            {error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{error}</p>}

            {!closed && canAct && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1"><LabeledInput label={t('Internal note', 'ملاحظة داخلية')} maxLength={500} value={freeNote} onChange={(e) => setFreeNote(e.target.value)} /></div>
                <Button disabled={busy || !freeNote.trim()} onClick={() => run('notes', { note: freeNote }, t('Note added.', 'تمت إضافة الملاحظة.'))}>{t('Add note', 'إضافة ملاحظة')}</Button>
                <Button disabled={busy || d.status === 'ESCALATED'} onClick={() => run('escalate', { note: freeNote || undefined }, t('Escalated.', 'تم التصعيد.'))}>{t('Escalate', 'تصعيد')}</Button>
                {myId && d.assignedToUserId !== myId && <Button disabled={busy} onClick={() => run('assign', { assigneeUserId: myId }, t('Assigned to you.', 'عُيّنت لك.'))}>{t('Assign to me', 'تعيين لي')}</Button>}
                {d.segmentId && <Button disabled={busy || freeNote.trim().length < 5} onClick={() => run('request-vendor-action', { note: freeNote }, t('The vendor was asked.', 'تم إشعار المورد.'))}>{t('Ask the vendor to act (uses the note)', 'اطلب من المورد التنفيذ (يستخدم الملاحظة)')}</Button>}
                {['CANCELLED', 'DELIVERED', 'COLLECTED', 'FAILED_DELIVERY'].includes(d.orderStatus) && <Button disabled={busy || freeNote.trim().length < 5} onClick={() => run('resolve', { note: freeNote }, t('The case was closed.', 'تم إغلاق الحالة.'))}>{t('Close the case (uses the note)', 'إغلاق الحالة (تستخدم الملاحظة)')}</Button>}
              </div>
            )}

            <Card title={t('History', 'السجل')}>
              <ol className="space-y-2">
                {(d.events ?? []).map((e: any) => (
                  <li key={e.id} className="text-xs"><span className="font-medium">{ACTIONS[e.action] ? (locale === 'ar' ? ACTIONS[e.action][1] : ACTIONS[e.action][0]) : e.action}</span> <span className="text-gray-500">· {e.actorRole ?? t('system', 'النظام')} · {dateTime(e.createdAt)}</span>{e.metadata?.code && <span className="block text-amber-800">{ISOLATION[e.metadata.code] ? t(...ISOLATION[e.metadata.code]) : e.metadata.code}</span>}{e.note && <span className="block text-gray-700"><bdi>{e.note}</bdi></span>}</li>
                ))}
              </ol>
            </Card>
          </div>
        )}
      </Async>
      <ConfirmDialog open={confirmCancel} danger title={t('Cancel the entire order?', 'إلغاء الطلب كاملًا؟')} message={t('This runs the existing cancellation: the order is cancelled, money paid in advance is returned by the existing rules, and discounts are restored. It cannot be undone.', 'سينفَّذ الإلغاء المعتاد: يُلغى الطلب، وتُرد المبالغ المدفوعة مسبقًا حسب القواعد القائمة، وتُستعاد الخصومات. لا يمكن التراجع.')} confirmLabel={t('Cancel the order', 'إلغاء الطلب')} busy={busy} onConfirm={() => run('record-decision', already ? { decision: 'CANCEL_ORDER' } : { decision: 'CANCEL_ORDER', channel, note }, t('The order was cancelled.', 'تم إلغاء الطلب.'))} onClose={() => setConfirmCancel(false)} />
    </Modal>
  );
}
