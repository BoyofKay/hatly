'use client';

import { useState } from 'react';
import { Async, Badge, Button, Card, ConfirmDialog, DataTable, KpiCard, LabeledInput, LabeledSelect, LabeledTextarea, Modal, Tabs, useToast } from '../ui';
import { newKey, send, useApi } from '../../lib/ui/api';
import { apiErrorCode, apiErrorMessage } from '../../lib/api/errors';
import { parseEgpToMinor } from '../../lib/money';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';

const ADJ_REASONS: Array<[string, string, string]> = [['GOODWILL', 'Goodwill', 'لفتة حسن نية'], ['SERVICE_FAILURE', 'Service failure', 'إخفاق في الخدمة'], ['PAYMENT_CORRECTION', 'Payment correction', 'تصحيح دفع'], ['PROMOTION_CORRECTION', 'Promotion correction', 'تصحيح ترويج'], ['OTHER', 'Other', 'أخرى']];

export function CustomerExtras({ customerId }: { customerId: string }) {
  const { t, locale, money, num, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [tab, setTab] = useState('wallet');
  const summary = useApi<any>(`/admin/customers/${customerId}/summary`);
  const notes = useApi<any[]>(`/admin/customers/${customerId}/notes`);
  const wallet = useApi<any>(tab === 'wallet' && can('VIEW_FINANCIALS') ? `/admin/customers/${customerId}/wallet` : null);
  const loyalty = useApi<any>(tab === 'loyalty' ? `/admin/customers/${customerId}/loyalty` : null);
  const addresses = useApi<any[]>(tab === 'addresses' ? `/admin/customers/${customerId}/addresses` : null);
  const ratings = useApi<any[]>(tab === 'ratings' ? `/admin/customers/${customerId}/ratings` : null);
  const coupons = useApi<any[]>(tab === 'coupons' ? `/admin/customers/${customerId}/coupons` : null);
  const s = summary.data;
  const [note, setNote] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [sign, setSign] = useState<'+' | '-'>('+');
  const [reasonCode, setReasonCode] = useState('GOODWILL');
  const [adjNote, setAdjNote] = useState('');
  const [adjKey, setAdjKey] = useState(newKey());
  const [adjBusy, setAdjBusy] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const addNote = async () => { try { await send('post', `/admin/customers/${customerId}/notes`, { body: note }); setNote(''); notes.reload(); summary.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not add the note.', 'تعذّر إضافة الملاحظة.'))); } };
  const toggleBlock = async (reason: string) => {
    setBlockBusy(true); setBlockError(null);
    try { await send('post', `/admin/customers/${customerId}/${s.isActive ? 'block' : 'unblock'}`, { reason }); toast.push('success', s.isActive ? t('Customer blocked.', 'تم حظر العميل.') : t('Customer unblocked.', 'تم رفع الحظر.')); setBlockOpen(false); summary.reload(); }
    catch (e) { setBlockError(apiErrorMessage(e, t('Action failed.', 'فشل الإجراء.'))); } finally { setBlockBusy(false); }
  };
  const reveal = async (field: string) => {
    try { const r = await send<any>('post', `/admin/customers/${customerId}/reveal`, { field }); setRevealed((x) => ({ ...x, [field]: r.value ?? '—' })); setTimeout(() => setRevealed((x) => { const c = { ...x }; delete c[field]; return c; }), 60_000); }
    catch (e) { toast.push('error', apiErrorMessage(e, t('Could not reveal.', 'تعذّر الكشف.'))); }
  };
  const adjust = async () => {
    const p = parseEgpToMinor(amount);
    if (!p.ok) { setAdjError(t('Enter a valid amount.', 'أدخل مبلغًا صحيحًا.')); return; }
    setAdjBusy(true); setAdjError(null);
    try {
      const r = await send<any>('post', `/admin/customers/${customerId}/wallet/adjustments`, { amountMinor: sign === '-' ? -p.minor : p.minor, reasonCode, note: adjNote || undefined }, { 'Idempotency-Key': adjKey });
      toast.push('success', r.requiresApproval ? t('Submitted — waiting for a second admin to approve.', 'أُرسل — بانتظار موافقة مسؤول آخر.') : t('Adjustment applied to the wallet ledger.', 'طُبِّق التعديل على سجل المحفظة.'));
      setAdjOpen(false); setAmount(''); setAdjNote(''); setAdjKey(newKey()); wallet.reload(); summary.reload();
    } catch (e) { setAdjError(apiErrorCode(e) === 'INSUFFICIENT_WALLET_BALANCE' ? t('This would take the wallet below zero.', 'سيجعل هذا رصيد المحفظة سالبًا.') : apiErrorMessage(e, t('The adjustment failed.', 'فشل التعديل.'))); }
    finally { setAdjBusy(false); }
  };

  const tabs = [...(can('VIEW_FINANCIALS') ? [{ id: 'wallet', label: t('Wallet', 'المحفظة') }] : []), { id: 'loyalty', label: t('Loyalty', 'الولاء') }, { id: 'addresses', label: t('Addresses', 'العناوين') }, { id: 'ratings', label: t('Ratings', 'التقييمات') }, { id: 'coupons', label: t('Coupons used', 'القسائم المستخدمة') }];

  return (
    <div className="mt-4 max-w-6xl space-y-4" data-testid="customer-extras">
      <Async state={summary} rows={2}>
        {s && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard label={t('Orders', 'الطلبات')} value={num(s.orders)} />
              <KpiCard label={t('Delivered', 'المسلّمة')} value={num(s.delivered)} />
              <KpiCard label={t('Loyalty points', 'نقاط الولاء')} value={num(s.loyaltyPoints)} />
              {s.walletBalanceMinor !== undefined ? <KpiCard label={t('Wallet', 'المحفظة')} value={money(s.walletBalanceMinor)} /> : <KpiCard label={t('Notes', 'الملاحظات')} value={num(s.notes)} />}
            </div>
            <Card title={t('Account', 'الحساب')} actions={<span className="flex items-center gap-2">{s.isActive ? <Badge tone="green">{t('Active', 'نشط')}</Badge> : <Badge tone="red">{t('Blocked', 'محظور')}</Badge>}{can('MANAGE_CUSTOMERS') && <Button size="sm" variant={s.isActive ? 'danger' : 'primary'} onClick={() => { setBlockError(null); setBlockOpen(true); }}>{s.isActive ? t('Block…', 'حظر…') : t('Unblock…', 'رفع الحظر…')}</Button>}</span>}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {can('VIEW_CUSTOMER_PII') ? (['PHONE', 'EMAIL', 'ADDRESS'] as const).map((f) => <span key={f} className="flex items-center gap-1">{revealed[f] ? <span className="rounded bg-yellow-50 px-2 py-1 text-xs"><bdi>{revealed[f]}</bdi></span> : <Button size="sm" onClick={() => reveal(f)}>{t(`Reveal ${f.toLowerCase()}`, `كشف ${f === 'PHONE' ? 'الهاتف' : f === 'EMAIL' ? 'البريد' : 'العنوان'}`)}</Button>}</span>) : <span className="text-xs text-gray-500">{t('Personal details are masked for your role.', 'التفاصيل الشخصية مقنَّعة لدورك.')}</span>}
              </div>
              {can('VIEW_CUSTOMER_PII') && <p className="mt-2 text-[11px] text-gray-400">{t('Each reveal is recorded in the audit log and hides again after 60 seconds.', 'يُسجَّل كل كشف في سجل التدقيق ويُخفى بعد 60 ثانية.')}</p>}
            </Card>
          </>
        )}
      </Async>
      <Tabs tabs={tabs} value={tabs.some((x) => x.id === tab) ? tab : tabs[0].id} onChange={setTab} />
      {tab === 'wallet' && can('VIEW_FINANCIALS') && (
        <Card title={t('Wallet ledger', 'سجل المحفظة')} pad={false} actions={can('MANAGE_CUSTOMER_WALLET') ? <Button size="sm" variant="primary" onClick={() => { setAdjError(null); setAdjOpen(true); }}>{t('Adjust wallet…', 'تعديل المحفظة…')}</Button> : undefined}>
          <DataTable rows={wallet.data?.items} rowKey={(r: any) => r.id} loading={wallet.loading} error={wallet.error} status={wallet.status} emptyTitle={t('No wallet activity', 'لا نشاط في المحفظة')} emptyHint=" " columns={[
            { key: 'at', header: t('Time', 'الوقت'), cell: (r: any) => dateTime(r.createdAt) }, { key: 't', header: t('Type', 'النوع'), cell: (r: any) => r.type.replace(/_/g, ' ') }, { key: 'r', header: t('Reason', 'السبب'), cell: (r: any) => <bdi>{r.reason ?? r.orderNumber ?? '—'}</bdi> }, { key: 'a', header: t('Amount', 'المبلغ'), align: 'end', cell: (r: any) => money(r.amountMinor) },
          ]} />
        </Card>
      )}
      {tab === 'loyalty' && <Card title={t('Loyalty points ledger', 'سجل نقاط الولاء')} pad={false}><DataTable rows={loyalty.data?.items} rowKey={(r: any) => r.id} loading={loyalty.loading} error={loyalty.error} emptyTitle={t('No points activity', 'لا نشاط نقاط')} emptyHint=" " columns={[{ key: 'at', header: t('Time', 'الوقت'), cell: (r: any) => dateTime(r.createdAt) }, { key: 't', header: t('Type', 'النوع'), cell: (r: any) => r.type }, { key: 'p', header: t('Points', 'النقاط'), align: 'end', cell: (r: any) => num(r.points) }]} /></Card>}
      {tab === 'addresses' && <Card title={t('Addresses', 'العناوين')} pad={false}><DataTable rows={addresses.data} rowKey={(r: any) => r.id} loading={addresses.loading} error={addresses.error} emptyTitle={t('No addresses', 'لا عناوين')} emptyHint=" " columns={[{ key: 'l', header: t('Label', 'التسمية'), cell: (r: any) => <bdi>{r.label ?? '—'}</bdi> }, { key: 'a', header: t('Address', 'العنوان'), cell: (r: any) => (r.masked ? <span className="text-gray-400">••••••••</span> : <bdi>{r.line1}</bdi>) }, { key: 'c', header: t('City', 'المدينة'), cell: (r: any) => <bdi>{[r.city, r.governorate].filter(Boolean).join(', ') || '—'}</bdi> }, { key: 'd', header: '', cell: (r: any) => (r.isDefault ? <Badge>{t('Default', 'افتراضي')}</Badge> : null) }]} /></Card>}
      {tab === 'ratings' && <Card title={t('Ratings given', 'التقييمات المقدّمة')} pad={false}><DataTable rows={ratings.data} rowKey={(r: any) => `${r.target}${r.id}`} loading={ratings.loading} error={ratings.error} emptyTitle={t('No ratings', 'لا تقييمات')} emptyHint=" " columns={[{ key: 'tg', header: t('For', 'عن'), cell: (r: any) => r.target }, { key: 's', header: t('Stars', 'النجوم'), cell: (r: any) => '★'.repeat(r.stars) }, { key: 'c', header: t('Comment', 'التعليق'), cell: (r: any) => <bdi>{r.comment ?? '—'}</bdi> }, { key: 'h', header: '', cell: (r: any) => (r.hidden ? <Badge tone="red">{t('Hidden', 'مخفي')}</Badge> : null) }]} /></Card>}
      {tab === 'coupons' && <Card title={t('Offers and coupons used', 'العروض والقسائم المستخدمة')} pad={false}><DataTable rows={coupons.data} rowKey={(r: any) => r.id} loading={coupons.loading} error={coupons.error} emptyTitle={t('None used', 'لا استخدامات')} emptyHint=" " columns={[{ key: 'o', header: t('Offer', 'العرض'), cell: (r: any) => <bdi>{r.offerName}{r.couponCode ? ` · ${r.couponCode}` : ''}</bdi> }, { key: 'n', header: t('Order', 'الطلب'), cell: (r: any) => <bdi>{r.orderNumber ?? '—'}</bdi> }, { key: 'd', header: t('Discount', 'الخصم'), align: 'end', cell: (r: any) => money(r.discountMinor) }, { key: 'r', header: '', cell: (r: any) => (r.reversed ? <Badge tone="amber">{t('Reversed', 'معكوس')}</Badge> : null) }]} /></Card>}
      <Card title={t('Staff notes (never edited)', 'ملاحظات الموظفين (لا تُعدَّل)')}>
        {can('MANAGE_CUSTOMERS') && <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end"><div className="flex-1"><LabeledTextarea label={t('Add a note', 'إضافة ملاحظة')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} /></div><Button variant="primary" disabled={!note.trim()} onClick={addNote}>{t('Add', 'إضافة')}</Button></div>}
        <Async state={notes} empty={notes.data && notes.data.length === 0} emptyTitle={t('No notes', 'لا ملاحظات')} rows={1}><ul className="space-y-2">{(notes.data ?? []).map((n) => <li key={n.id} className="rounded-lg bg-amber-50 px-3 py-2 text-sm"><p className="whitespace-pre-wrap"><bdi>{n.body}</bdi></p><p className="mt-1 text-xs text-gray-500"><bdi>{n.authorName}</bdi> · {dateTime(n.createdAt)}</p></li>)}</ul></Async>
      </Card>
      <ConfirmDialog open={blockOpen} title={s?.isActive ? t('Block this customer?', 'حظر هذا العميل؟') : t('Unblock this customer?', 'رفع الحظر عن هذا العميل؟')} message={s?.isActive ? t('They will not be able to sign in or place orders, and their session ends. This is reversible and audited.', 'لن يتمكن من تسجيل الدخول أو الطلب، وتنتهي جلسته. الإجراء قابل للتراجع ومُدقَّق.') : t('They will be able to sign in and order again.', 'سيتمكن من تسجيل الدخول والطلب مجددًا.')} confirmLabel={s?.isActive ? t('Block', 'حظر') : t('Unblock', 'رفع الحظر')} danger={Boolean(s?.isActive)} reasonLabel={t('Reason (required)', 'السبب (مطلوب)')} reasonMin={5} busy={blockBusy} error={blockError} onConfirm={toggleBlock} onClose={() => setBlockOpen(false)} />
      <Modal open={adjOpen} title={t('Adjust the customer wallet', 'تعديل محفظة العميل')} onClose={() => !adjBusy && setAdjOpen(false)} footer={<><Button onClick={() => setAdjOpen(false)} disabled={adjBusy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={adjBusy} onClick={adjust}>{t('Submit', 'إرسال')}</Button></>}>
        <p className="text-xs text-gray-600">{t('Small adjustments apply immediately through the wallet ledger. Larger ones wait for a second admin with approval authority. A debit can never take the wallet below zero.', 'التعديلات الصغيرة تُطبَّق فورًا عبر سجل المحفظة. الأكبر تنتظر موافقة مسؤول آخر مخوّل. لا يمكن أن يجعل الخصم المحفظة سالبة.')}</p>
        <div className="grid grid-cols-3 gap-3"><LabeledSelect label={t('Direction', 'الاتجاه')} value={sign} onChange={(e) => setSign(e.target.value as '+' | '-')}><option value="+">{t('Credit (+)', 'إضافة (+)')}</option><option value="-">{t('Debit (−)', 'خصم (−)')}</option></LabeledSelect><div className="col-span-2"><LabeledInput label={t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div></div>
        <LabeledSelect label={t('Reason', 'السبب')} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>{ADJ_REASONS.map(([k, en, ar]) => <option key={k} value={k}>{locale === 'ar' ? ar : en}</option>)}</LabeledSelect>
        <LabeledInput label={t('Note (optional)', 'ملاحظة (اختياري)')} value={adjNote} onChange={(e) => setAdjNote(e.target.value)} maxLength={300} />
        {adjError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{adjError}</p>}
      </Modal>
    </div>
  );
}
