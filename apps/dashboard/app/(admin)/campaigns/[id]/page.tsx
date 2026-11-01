'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Async, Badge, Button, Card, ConfirmDialog, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, StatusPill, useToast } from '../../../../components/ui';
import { send, useApi } from '../../../../lib/ui/api';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';

const local = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, num, money, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const c = useApi<any>(`/admin/campaigns/${id}`);
  const perf = useApi<any>(`/admin/campaigns/${id}/performance`);
  const [dlg, setDlg] = useState<null | 'reject' | 'cancel' | 'edit' | 'items'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = c.data;
  const refresh = () => { c.reload(); perf.reload(); };
  const act = async (path: string, body?: unknown, ok?: string) => {
    setBusy(true); setError(null);
    try { await send('post', `/admin/campaigns/${id}/${path}`, body); if (ok) toast.push('success', ok); setDlg(null); refresh(); }
    catch (e) { setError(apiErrorMessage(e, t('The action failed.', 'فشل الإجراء.'))); } finally { setBusy(false); }
  };
  return (
    <div>
      <p className="mb-2 text-sm"><Link className="text-hatly-orangeDark hover:underline" href="/campaigns">← {t('Campaigns', 'الحملات')}</Link></p>
      <Async state={c} rows={4}>
        {d && (
          <>
            <PageHeader title={d.nameEn} subtitle={`${d.nameAr} · ${dateTime(d.startsAt)} → ${dateTime(d.endsAt)} · ${d.status.replace(/_/g, ' ')}`} actions={
              <span className="flex flex-wrap gap-2">
                {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED'].includes(d.status) && can('MANAGE_CAMPAIGNS') && <Button onClick={() => { setError(null); setDlg('edit'); }}>{t('Edit details', 'تعديل التفاصيل')}</Button>}
                {d.status === 'DRAFT' && can('MANAGE_CAMPAIGNS') && <><Button onClick={() => { setError(null); setDlg('items'); }}>{t('Choose items', 'اختيار العناصر')}</Button><Button variant="primary" loading={busy} disabled={d.items.length === 0} title={d.items.length === 0 ? t('Add at least one item first', 'أضف عنصرًا واحدًا على الأقل') : undefined} onClick={() => act('submit', undefined, t('Submitted for approval.', 'أُرسلت للموافقة.'))}>{t('Submit for approval', 'إرسال للموافقة')}</Button></>}
                {d.status === 'PENDING_APPROVAL' && can('CAMPAIGN_APPROVE') && <><Button variant="primary" loading={busy} onClick={() => act('approve', undefined, t('Approved.', 'تمت الموافقة.'))}>{t('Approve', 'موافقة')}</Button><Button onClick={() => { setError(null); setDlg('reject'); }}>{t('Reject…', 'رفض…')}</Button></>}
                {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'ACTIVE'].includes(d.status) && can('MANAGE_CAMPAIGNS') && <Button variant="danger" onClick={() => { setError(null); setDlg('cancel'); }}>{t('Cancel', 'إلغاء')}</Button>}
              </span>
            } />
            {error && !dlg && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {d.rejectionReason && d.status === 'DRAFT' && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('Returned by the reviewer:', 'أعادها المراجع:')} <bdi>{d.rejectionReason}</bdi></p>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card title={t('Included items', 'العناصر المضمّنة')} className="lg:col-span-2">
                {d.items.length === 0 ? <p className="text-sm text-gray-500">{t('Nothing included yet. A draft needs at least one offer, banner or broadcast.', 'لا شيء مضمّن بعد. تحتاج المسودة إلى عرض أو لافتة أو رسالة واحدة على الأقل.')}</p> : (
                  <ul className="divide-y divide-gray-100 text-sm">{d.items.map((i: any) => <li key={`${i.type}${i.id}`} className="flex items-center justify-between py-2"><span><Badge>{i.type}</Badge> <bdi className="ms-2">{i.label ?? i.id}</bdi></span></li>)}</ul>
                )}
                <p className="mt-3 text-xs text-gray-500">{t('Offers and banners are switched on at the start time and off at the end; broadcasts still need their own approval. Existing discount rules are not touched.', 'تُفعَّل العروض واللافتات وقت البدء وتُوقف عند الانتهاء؛ وتحتاج الرسائل موافقتها الخاصة. لا تُمس قواعد الخصم القائمة.')}</p>
              </Card>
              <Card title={t('History', 'السجل')}>
                <ol className="space-y-2 text-xs">{d.timeline.map((e: any, i: number) => <li key={i}><span className="font-medium">{e.from ? `${e.from.replace(/_/g, ' ')} → ` : ''}{e.to.replace(/_/g, ' ')}</span> <span className="text-gray-500">· {e.actor ?? t('system', 'النظام')} · {dateTime(e.at)}</span>{e.note && <span className="block text-gray-600"><bdi>{e.note}</bdi></span>}</li>)}</ol>
              </Card>
            </div>
            <Card title={t('Performance (recorded data only)', 'الأداء (بيانات مسجلة فقط)')} className="mt-4">
              <Async state={perf} rows={2}>
                {perf.data && (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <KpiCard label={t('Offer uses', 'استخدامات العروض')} value={num(perf.data.offers.consumptions - perf.data.offers.reversed)} hint={`${num(perf.data.offers.reversed)} ${t('reversed', 'معكوسة')}`} />
                    <KpiCard label={t('Net discount given', 'صافي الخصم الممنوح')} value={money(perf.data.offers.netDiscountMinor)} />
                    <KpiCard label={t('Broadcast recipients', 'مستلمو الرسائل')} value={num(perf.data.broadcasts.recipients)} />
                    <KpiCard label={t('Delivered', 'سُلّمت')} value={num(perf.data.broadcasts.sent)} />
                  </div>
                )}
              </Async>
              <p className="mt-2 text-xs text-gray-500">{t('No return on investment or revenue attribution is estimated.', 'لا يُقدَّر عائد الاستثمار ولا إسناد الإيراد.')}</p>
            </Card>
            {dlg === 'edit' && <EditModal d={d} onClose={() => setDlg(null)} onSaved={refresh} />}
            {dlg === 'items' && <ItemsModal id={id} current={d.items} onClose={() => setDlg(null)} onSaved={refresh} />}
            <ConfirmDialog open={dlg === 'reject'} title={t('Return to the author?', 'إعادتها إلى كاتبها؟')} message={t('It goes back to draft with your reason.', 'تعود مسودة مع سببك.')} confirmLabel={t('Reject', 'رفض')} reasonLabel={t('Reason (required)', 'السبب (مطلوب)')} reasonMin={5} busy={busy} error={error} onConfirm={(reason) => act('reject', { reason }, t('Returned.', 'أُعيدت.'))} onClose={() => setDlg(null)} />
            <ConfirmDialog open={dlg === 'cancel'} danger title={t('Cancel this campaign?', 'إلغاء هذه الحملة؟')} message={t('Offers and banners it switched on are switched off again. Orders already placed keep their discounts.', 'تُوقف العروض واللافتات التي فعّلتها. تحتفظ الطلبات المقدمة بخصوماتها.')} confirmLabel={t('Cancel campaign', 'إلغاء الحملة')} busy={busy} error={error} onConfirm={() => act('cancel', undefined, t('Cancelled.', 'أُلغيت.'))} onClose={() => setDlg(null)} />
          </>
        )}
      </Async>
    </div>
  );
}

function EditModal({ d, onClose, onSaved }: { d: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [f, setF] = useState({ nameEn: d.nameEn, nameAr: d.nameAr, startsAt: local(d.startsAt), endsAt: local(d.endsAt) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await send('patch', `/admin/campaigns/${d.id}`, { nameEn: f.nameEn, nameAr: f.nameAr, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString() }); toast.push('success', t('Saved.', 'تم الحفظ.')); onSaved(); onClose(); }
    catch (e) { setError(apiErrorMessage(e, t('Could not save.', 'تعذّر الحفظ.'))); } finally { setBusy(false); }
  };
  return (
    <Modal open title={t('Edit campaign', 'تعديل الحملة')} onClose={() => !busy && onClose()} footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('Save', 'حفظ')}</Button></>}>
      <div className="space-y-3">
        {d.status !== 'DRAFT' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('Editing sends it back to draft and cancels the approval; it must be approved again.', 'التعديل يعيدها مسودة ويلغي الموافقة؛ ويجب اعتمادها من جديد.')}</p>}
        <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        <LabeledInput label={t('Starts', 'تبدأ')} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        <LabeledInput label={t('Ends', 'تنتهي')} type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}

function ItemsModal({ id, current, onClose, onSaved }: { id: string; current: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const offers = useApi<any[]>('/admin/offers');
  const banners = useApi<any[]>('/admin/home-banners');
  const broadcasts = useApi<any[]>('/admin/broadcasts', { limit: 100 });
  const [sel, setSel] = useState<Array<{ type: string; id: string; label: string }>>(current.map((i) => ({ type: i.type, id: i.id, label: i.label ?? i.id })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = (type: string, itemId: string) => sel.some((s) => s.type === type && s.id === itemId);
  const toggle = (type: string, itemId: string, label: string) => setSel((s) => (has(type, itemId) ? s.filter((x) => !(x.type === type && x.id === itemId)) : [...s, { type, id: itemId, label }]));
  const save = async () => {
    setBusy(true); setError(null);
    try { await send('put', `/admin/campaigns/${id}/items`, { items: sel.map(({ type, id: i }) => ({ type, id: i })) }); toast.push('success', t('Items saved.', 'تم حفظ العناصر.')); onSaved(); onClose(); }
    catch (e) { setError(apiErrorMessage(e, t('Could not save the items.', 'تعذّر حفظ العناصر.'))); } finally { setBusy(false); }
  };
  const group = (title: string, type: string, rows: any[] | undefined, label: (r: any) => string, state: any) => (
    <fieldset className="mb-3">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {state.loading && !rows ? <p className="text-xs text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p> : (rows ?? []).length === 0 ? <p className="text-xs text-gray-500">{t('None available.', 'لا شيء متاح.')}</p> : (
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-gray-200">{(rows ?? []).map((r) => <li key={r.id} className="border-b border-gray-100 last:border-0"><label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={has(type, r.id)} onChange={() => toggle(type, r.id, label(r))} /><bdi>{label(r)}</bdi></label></li>)}</ul>
      )}
    </fieldset>
  );
  return (
    <Modal open wide title={t('Choose campaign items', 'اختيار عناصر الحملة')} onClose={() => !busy && onClose()} footer={<><Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={save}>{t(`Save (${sel.length})`, `حفظ (${sel.length})`)}</Button></>}>
      {group(t('Offers', 'العروض'), 'OFFER', offers.data, (r) => r.name, offers)}
      {group(t('Home banners', 'لافتات الرئيسية'), 'BANNER', banners.data, (r) => r.title, banners)}
      {group(t('Broadcasts', 'الرسائل الجماعية'), 'BROADCAST', broadcasts.data, (r) => r.titleEn, broadcasts)}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
