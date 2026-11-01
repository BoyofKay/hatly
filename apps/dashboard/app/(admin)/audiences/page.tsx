'use client';

import { useState } from 'react';
import { Button, Card, DataTable, LabeledInput, Modal, PageHeader, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { describeRules } from '../../../components/marketing/audience';

export default function AudiencesPage() {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const list = useApi<any[]>('/admin/audiences');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [rules, setRules] = useState({ lastOrderWithinDays: '', noOrderForDays: '', minOrders: '', neverOrdered: false, registeredFrom: '', registeredTo: '' });
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compiled = () => {
    const r: Record<string, unknown> = {};
    for (const k of ['lastOrderWithinDays', 'noOrderForDays', 'minOrders'] as const) if (rules[k]) r[k] = Number(rules[k]);
    if (rules.neverOrdered) r.neverOrdered = true;
    if (rules.registeredFrom) r.registeredFrom = rules.registeredFrom;
    if (rules.registeredTo) r.registeredTo = rules.registeredTo;
    return r;
  };
  const doPreview = async () => { setBusy(true); setError(null); try { setPreview(await send('post', '/admin/audiences/preview', { rules: compiled() })); } catch (e) { setError(apiErrorMessage(e, t('Preview failed.', 'فشلت المعاينة.'))); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true); setError(null);
    try { await send('post', '/admin/audiences', { name, rules: compiled() }); toast.push('success', t('Audience saved.', 'تم حفظ الجمهور.')); setOpen(false); setName(''); setPreview(null); list.reload(); }
    catch (e) { setError(apiErrorMessage(e, t('Could not save the audience.', 'تعذّر حفظ الجمهور.'))); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof rules, v: any) => { setRules((r) => ({ ...r, [k]: v })); setPreview(null); };

  return (
    <div>
      <PageHeader title={t('Audiences', 'الجمهور')} subtitle={t('Saved customer segments for broadcasts. Only active customers are ever included. Segments smaller than 20 are shown as “<20” so individuals cannot be identified.', 'شرائح عملاء محفوظة للرسائل الجماعية. يُدرج العملاء النشطون فقط. الشرائح الأقل من 20 تظهر «<20» حتى لا يمكن تحديد الأفراد.')} actions={can('MANAGE_BROADCASTS') ? <Button variant="primary" onClick={() => { setError(null); setOpen(true); }}>{t('New audience', 'جمهور جديد')}</Button> : undefined} />
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No audiences yet', 'لا يوجد جمهور بعد')} columns={[
          { key: 'n', header: t('Name', 'الاسم'), cell: (r: any) => <bdi className="font-medium">{r.name}</bdi> },
          { key: 'r', header: t('Rules', 'القواعد'), cell: (r: any) => describeRules(r.rules ?? {}, t) },
          { key: 'c', header: t('Created', 'أُنشئ'), cell: (r: any) => dateTime(r.createdAt) },
        ]} />
      </Card>
      <Modal open={open} wide title={t('New audience', 'جمهور جديد')} onClose={() => !busy && setOpen(false)} footer={<><Button onClick={() => setOpen(false)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button onClick={doPreview} loading={busy}>{t('Preview size', 'معاينة الحجم')}</Button><Button variant="primary" onClick={save} disabled={busy || !name.trim()}>{t('Save', 'حفظ')}</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><LabeledInput label={t('Name', 'الاسم')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <LabeledInput label={t('Ordered within the last N days', 'طلب خلال آخر N يومًا')} inputMode="numeric" value={rules.lastOrderWithinDays} onChange={(e) => set('lastOrderWithinDays', e.target.value.replace(/\D/g, ''))} />
          <LabeledInput label={t('No order for N days', 'بلا طلب منذ N يومًا')} inputMode="numeric" value={rules.noOrderForDays} onChange={(e) => set('noOrderForDays', e.target.value.replace(/\D/g, ''))} />
          <LabeledInput label={t('At least N orders', 'N طلبات على الأقل')} inputMode="numeric" value={rules.minOrders} onChange={(e) => set('minOrders', e.target.value.replace(/\D/g, ''))} />
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={rules.neverOrdered} onChange={(e) => set('neverOrdered', e.target.checked)} /> {t('Never ordered', 'لم يطلب أبدًا')}</label>
          <LabeledInput label={t('Registered from', 'سجّل من')} type="date" value={rules.registeredFrom} onChange={(e) => set('registeredFrom', e.target.value)} />
          <LabeledInput label={t('Registered to', 'سجّل حتى')} type="date" value={rules.registeredTo} onChange={(e) => set('registeredTo', e.target.value)} />
        </div>
        {preview && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">{preview.empty ? t('This audience matches no customers.', 'هذا الجمهور لا يطابق أي عميل.') : t(`About ${preview.display} customers`, `حوالي ${preview.display} عميل`)}</p>}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Modal>
    </div>
  );
}
