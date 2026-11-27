'use client';

import { useMemo, useState } from 'react';
import { Badge, Button, ErrorState, LabeledInput, LabeledSelect, Modal, PageHeader, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { parseEgpToMinor } from '../../../lib/money';

type Promo = {
  id: string; name: string; nameAr: string | null; kind: 'CODE' | 'AUTOMATIC'; code: string | null; target: 'ITEMS' | 'DELIVERY_FEE';
  discountType: 'PERCENTAGE' | 'FIXED' | 'FIXED_FEE'; discountValue: number; maxDiscountMinor: number | null; minSubtotalMinor: number | null;
  scopeType: 'ALL' | 'SECTORS' | 'BRANCHES'; scopeIds: string[]; startsAt: string; endsAt: string; isActive: boolean; perCustomerLimit: number | null;
  totalUsesLimit: number | null; budgetCapMinor: number | null; newCustomersOnly: boolean; stackable: boolean; feeBearer: 'HATLY' | 'DRIVER';
  usesCount: number; discountGivenMinor: number; budgetLeftMinor: number | null; state: 'RUNNING' | 'SCHEDULED' | 'ENDED' | 'PAUSED';
};

const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const egp = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toFixed(2));
const blank = () => ({
  name: '', nameAr: '', kind: 'CODE', code: '', target: 'ITEMS', discountType: 'PERCENTAGE', discountValue: '10', maxDiscount: '', minSubtotal: '',
  scopeType: 'ALL', scopeIds: [] as string[], startsAt: toLocal(new Date().toISOString()), endsAt: toLocal(new Date(Date.now() + 7 * 86_400_000).toISOString()),
  perCustomerLimit: '1', totalUsesLimit: '', budgetCap: '', newCustomersOnly: false, stackable: false, feeBearer: 'HATLY',
});

/**
 * Promotions (owner decision 2026-11-27): Hatly-wide or per-store promo CODES and automatic CAMPAIGNS, on the order's items or on its
 * delivery fee — with dates, % / amount off / set fee, minimum spend, maximum discount, per-customer, total and budget limits, new
 * customers only, whether it combines with other promotions and store offers, and who pays a delivery-fee discount. Monitoring: uses,
 * discount given, budget left, and every order that used it. The server enforces every rule; store coupons stay under Offers.
 */
export default function PromotionsPage() {
  const { t, money, dateTime } = useLang();
  const toast = useToast();
  const list = useApi<Promo[]>('/admin/promotions', undefined, { refreshInterval: 30_000 });
  const sectors = useApi<any[]>('/admin/sectors');
  const branches = useApi<any[]>('/admin/branch-directory', { limit: 100 });
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [usesOf, setUsesOf] = useState<Promo | null>(null);
  const uses = useApi<any[]>(usesOf ? `/admin/promotions/${usesOf.id}/redemptions` : null);
  const set = (k: string, v: unknown) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const open = (p?: Promo) => {
    setErr(null);
    setEditing(p ?? null);
    setForm(p ? {
      name: p.name, nameAr: p.nameAr ?? '', kind: p.kind, code: p.code ?? '', target: p.target, discountType: p.discountType,
      discountValue: p.discountType === 'PERCENTAGE' ? String(p.discountValue) : egp(p.discountValue), maxDiscount: egp(p.maxDiscountMinor), minSubtotal: egp(p.minSubtotalMinor),
      scopeType: p.scopeType, scopeIds: p.scopeIds, startsAt: toLocal(p.startsAt), endsAt: toLocal(p.endsAt), perCustomerLimit: p.perCustomerLimit ? String(p.perCustomerLimit) : '',
      totalUsesLimit: p.totalUsesLimit ? String(p.totalUsesLimit) : '', budgetCap: egp(p.budgetCapMinor), newCustomersOnly: p.newCustomersOnly, stackable: p.stackable, feeBearer: p.feeBearer,
    } : blank());
  };

  const save = async () => {
    if (!form) return;
    const minor = (v: string) => { if (!v.trim()) return null; const r = parseEgpToMinor(v); if (!r.ok) throw new Error(t(`"${v}" is not an amount in EGP.`, `«${v}» ليس مبلغًا بالجنيه.`)); return r.minor; };
    setBusy(true); setErr(null);
    try {
      const body = {
        name: form.name, nameAr: form.nameAr || null, kind: form.kind, code: form.kind === 'CODE' ? form.code : null, target: form.target,
        discountType: form.discountType, discountValue: form.discountType === 'PERCENTAGE' ? Number(form.discountValue) : minor(form.discountValue) ?? 0,
        maxDiscountMinor: minor(form.maxDiscount), minSubtotalMinor: minor(form.minSubtotal), scopeType: form.scopeType, scopeIds: form.scopeIds,
        startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(),
        perCustomerLimit: form.perCustomerLimit ? Number(form.perCustomerLimit) : null, totalUsesLimit: form.totalUsesLimit ? Number(form.totalUsesLimit) : null,
        budgetCapMinor: minor(form.budgetCap), newCustomersOnly: form.newCustomersOnly, stackable: form.stackable, feeBearer: form.feeBearer,
      };
      if (editing) await send('put', `/admin/promotions/${editing.id}`, body); else await send('post', '/admin/promotions', body);
      toast.push('success', t('Promotion saved.', 'تم حفظ العرض الترويجي.'));
      setForm(null); list.reload();
    } catch (e) { setErr(e instanceof Error && !(e as any).response ? e.message : apiErrorMessage(e, t('Could not save.', 'تعذّر الحفظ.'))); }
    finally { setBusy(false); }
  };
  const toggle = async (p: Promo) => {
    try { await send('patch', `/admin/promotions/${p.id}/active`, { active: !p.isActive }); list.reload(); }
    catch (e) { toast.push('error', apiErrorMessage(e, t('Could not change it.', 'تعذّر التغيير.'))); }
  };

  const stateLabel: Record<Promo['state'], [string, string, 'green' | 'gray' | 'orange' | 'red']> = {
    RUNNING: ['Running', 'سارٍ', 'green'], SCHEDULED: ['Scheduled', 'مجدول', 'orange'], ENDED: ['Ended', 'انتهى', 'gray'], PAUSED: ['Paused', 'موقوف', 'red'],
  };
  const value = (p: Promo) => p.discountType === 'PERCENTAGE' ? `${p.discountValue}%` : p.discountType === 'FIXED' ? money(p.discountValue) : t(`fee = ${money(p.discountValue)}`, `الرسوم = ${money(p.discountValue)}`);
  const scopeOptions = useMemo(() => (form?.scopeType === 'SECTORS' ? (sectors.data ?? []).map((s: any) => ({ id: s.id, label: s.nameAr ? `${s.name} / ${s.nameAr}` : s.name })) : (branches.data ?? []).map((b: any) => ({ id: b.id, label: `${b.vendorName} — ${b.name}` }))), [form?.scopeType, sectors.data, branches.data]);

  return (
    <div className="max-w-6xl space-y-4" data-testid="promotions-page">
      <PageHeader title={t('Promotions', 'العروض الترويجية')}
        subtitle={t('Promo codes and automatic campaigns, Hatly-wide or for chosen sectors / stores, on items or on the delivery fee. Store coupons stay under Offers.', 'أكواد خصم وحملات تلقائية، لكل هتلي أو لأقسام / متاجر محددة، على المنتجات أو رسوم التوصيل. كوبونات المتاجر تبقى في «العروض».')}
        actions={<Button variant="primary" onClick={() => open()} data-testid="promo-new">{t('New promotion', 'عرض ترويجي جديد')}</Button>} />
      {list.error && <ErrorState message={list.error} status={list.status} onRetry={list.reload} />}
      <ul className="space-y-2">
        {(list.data ?? []).map((p) => {
          const [en, ar, tone] = stateLabel[p.state];
          return (
            <li key={p.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" data-testid={`promo-${p.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <bdi className="font-semibold">{p.name}</bdi>
                {p.code ? <span dir="ltr" className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">{p.code}</span> : <Badge tone="orange">{t('Automatic', 'تلقائي')}</Badge>}
                <Badge tone={tone}>{t(en, ar)}</Badge>
                <span className="text-sm text-gray-700">{value(p)} {p.target === 'ITEMS' ? t('off items', 'على المنتجات') : t('off delivery', 'على التوصيل')}</span>
                {p.target === 'DELIVERY_FEE' && <span className="text-xs text-gray-500">{p.feeBearer === 'HATLY' ? t('Hatly pays', 'هتلي تتحمل') : t('driver bears', 'المندوب يتحمل')}</span>}
                <span className="ms-auto flex gap-2">
                  <Button size="sm" onClick={() => setUsesOf(p)}>{t('Uses', 'الاستخدامات')}</Button>
                  <Button size="sm" onClick={() => open(p)}>{t('Edit', 'تعديل')}</Button>
                  <Button size="sm" onClick={() => void toggle(p)}>{p.isActive ? t('Pause', 'إيقاف') : t('Resume', 'تشغيل')}</Button>
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600">
                {dateTime(p.startsAt)} → {dateTime(p.endsAt)} · {t('used', 'استُخدم')} {p.usesCount}{p.totalUsesLimit ? `/${p.totalUsesLimit}` : ''} · {t('discount given', 'الخصم الممنوح')} {money(p.discountGivenMinor)}
                {p.budgetCapMinor != null && <> · {t('budget left', 'المتبقي من الميزانية')} {money(p.budgetLeftMinor)}</>}
                {p.minSubtotalMinor != null && <> · {t('min', 'حد أدنى')} {money(p.minSubtotalMinor)}</>}
                {p.maxDiscountMinor != null && <> · {t('max', 'حد أقصى')} {money(p.maxDiscountMinor)}</>}
                {p.perCustomerLimit != null && <> · {t(`${p.perCustomerLimit} per customer`, `${p.perCustomerLimit} لكل عميل`)}</>}
                {p.newCustomersOnly && <> · {t('new customers', 'عملاء جدد')}</>}
                {' · '}{p.stackable ? t('combines with others', 'يجتمع مع غيره') : t('not combinable', 'لا يجتمع مع غيره')}
                {p.scopeType !== 'ALL' && <> · {t(`${p.scopeIds.length} ${p.scopeType === 'SECTORS' ? 'sector(s)' : 'store(s)'}`, `${p.scopeIds.length} ${p.scopeType === 'SECTORS' ? 'قسم' : 'متجر'}`)}</>}
              </p>
            </li>
          );
        })}
        {list.data && list.data.length === 0 && <li className="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">{t('No promotions yet.', 'لا توجد عروض ترويجية بعد.')}</li>}
      </ul>

      <Modal open={Boolean(form)} wide title={editing ? t('Edit promotion', 'تعديل العرض') : t('New promotion', 'عرض ترويجي جديد')} onClose={() => !busy && setForm(null)}
        footer={<><Button onClick={() => setForm(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={() => void save()} data-testid="promo-save">{t('Save', 'حفظ')}</Button></>}>
        {form && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledInput label={t('Name (EN)', 'الاسم (EN)')} value={form.name} onChange={(e) => set('name', e.target.value)} />
            <LabeledInput label={t('Name (AR)', 'الاسم (AR)')} dir="rtl" value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
            <LabeledSelect label={t('Type', 'النوع')} value={form.kind} onChange={(e) => set('kind', e.target.value)} disabled={Boolean(editing && editing.usesCount > 0)}>
              <option value="CODE">{t('Promo code (customer enters it)', 'كود خصم (يكتبه العميل)')}</option>
              <option value="AUTOMATIC">{t('Automatic campaign (no code)', 'حملة تلقائية (بدون كود)')}</option>
            </LabeledSelect>
            {form.kind === 'CODE' ? <LabeledInput label={t('Code', 'الكود')} dir="ltr" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="WELCOME50" disabled={Boolean(editing && editing.usesCount > 0)} /> : <span />}
            <LabeledSelect label={t('Discount on', 'الخصم على')} value={form.target} onChange={(e) => { set('target', e.target.value); if (e.target.value === 'ITEMS' && form.discountType === 'FIXED_FEE') set('discountType', 'PERCENTAGE'); }} disabled={Boolean(editing && editing.usesCount > 0)}>
              <option value="ITEMS">{t('The order items', 'منتجات الطلب')}</option>
              <option value="DELIVERY_FEE">{t('The delivery fee', 'رسوم التوصيل')}</option>
            </LabeledSelect>
            <LabeledSelect label={t('Discount', 'الخصم')} value={form.discountType} onChange={(e) => set('discountType', e.target.value)}>
              <option value="PERCENTAGE">{t('Percentage %', 'نسبة %')}</option>
              <option value="FIXED">{t('Amount off (EGP)', 'مبلغ ثابت (ج.م)')}</option>
              {form.target === 'DELIVERY_FEE' && <option value="FIXED_FEE">{t('Set the delivery fee to (EGP)', 'اجعل رسوم التوصيل (ج.م)')}</option>}
            </LabeledSelect>
            <LabeledInput label={form.discountType === 'PERCENTAGE' ? t('Percent (1–100)', 'النسبة (1–100)') : t('Amount (EGP)', 'المبلغ (ج.م)')} inputMode="decimal" value={form.discountValue} onChange={(e) => set('discountValue', e.target.value)} />
            <LabeledInput label={t('Maximum discount (EGP, optional)', 'أقصى خصم (ج.م، اختياري)')} inputMode="decimal" value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />
            <LabeledInput label={t('Minimum spend on items (EGP, optional)', 'حد أدنى للمشتريات (ج.م، اختياري)')} inputMode="decimal" value={form.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value)} />
            {form.target === 'DELIVERY_FEE' && (
              <LabeledSelect label={t('Who pays the fee discount', 'من يتحمل خصم التوصيل')} value={form.feeBearer} onChange={(e) => set('feeBearer', e.target.value)}>
                <option value="HATLY">{t('Hatly — driver still earns on the full fee', 'هتلي — المندوب يحتسب على الرسوم كاملة')}</option>
                <option value="DRIVER">{t('Driver — earns on the reduced fee', 'المندوب — يحتسب على الرسوم بعد الخصم')}</option>
              </LabeledSelect>
            )}
            <LabeledInput label={t('Starts', 'يبدأ')} type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            <LabeledInput label={t('Ends', 'ينتهي')} type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            <LabeledInput label={t('Uses per customer (empty = no limit)', 'مرات الاستخدام لكل عميل (فارغ = بلا حد)')} inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set('perCustomerLimit', e.target.value)} />
            <LabeledInput label={t('Total uses (empty = no limit)', 'إجمالي الاستخدامات (فارغ = بلا حد)')} inputMode="numeric" value={form.totalUsesLimit} onChange={(e) => set('totalUsesLimit', e.target.value)} />
            <LabeledInput label={t('Budget (EGP, empty = no limit)', 'الميزانية (ج.م، فارغ = بلا حد)')} inputMode="decimal" value={form.budgetCap} onChange={(e) => set('budgetCap', e.target.value)} />
            <LabeledSelect label={t('Applies to', 'ينطبق على')} value={form.scopeType} onChange={(e) => { set('scopeType', e.target.value); set('scopeIds', []); }}>
              <option value="ALL">{t('All stores', 'كل المتاجر')}</option>
              <option value="SECTORS">{t('Chosen sectors', 'أقسام محددة')}</option>
              <option value="BRANCHES">{t('Chosen stores (per-store promotion)', 'متاجر محددة (عرض لمتجر)')}</option>
            </LabeledSelect>
            {form.scopeType !== 'ALL' && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-sm font-medium text-gray-700">{form.scopeType === 'SECTORS' ? t('Sectors', 'الأقسام') : t('Stores', 'المتاجر')}</p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 p-2">
                  {scopeOptions.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input type="checkbox" checked={form.scopeIds.includes(o.id)} onChange={(e) => set('scopeIds', e.target.checked ? [...form.scopeIds, o.id] : form.scopeIds.filter((x) => x !== o.id))} />
                      <bdi>{o.label}</bdi>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.newCustomersOnly} onChange={(e) => set('newCustomersOnly', e.target.checked)} />{t('New customers only (first order)', 'للعملاء الجدد فقط (أول طلب)')}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.stackable} onChange={(e) => set('stackable', e.target.checked)} />{t('Can combine with other promotions, store offers and coupons', 'يمكن جمعه مع عروض وكوبونات أخرى')}</label>
            {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{err}</p>}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(usesOf)} wide title={usesOf ? t(`Uses — ${usesOf.name}`, `الاستخدامات — ${usesOf.name}`) : ''} onClose={() => setUsesOf(null)}>
        {uses.error && <ErrorState message={uses.error} onRetry={uses.reload} />}
        <ul className="divide-y divide-gray-100 text-sm">
          {(uses.data ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
              <a href={`/order-management?order=${u.orderId}`} className="font-mono text-hatly-orangeDark hover:underline" dir="ltr">{u.orderNumber}</a>
              <bdi>{u.customerName}</bdi>
              <span className="tabular-nums">{money(u.discountMinor)}</span>
              <span className="text-xs text-gray-500">{dateTime(u.createdAt)}</span>
              {u.reversedAt && <Badge tone="gray">{t('Given back (order cancelled)', 'أُعيد (طلب ملغي)')}</Badge>}
            </li>
          ))}
          {uses.data && uses.data.length === 0 && <li className="py-6 text-center text-gray-500">{t('Not used yet.', 'لم يُستخدم بعد.')}</li>}
        </ul>
      </Modal>
    </div>
  );
}
