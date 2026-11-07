'use client';

import { useCallback, useEffect, useState } from 'react';
import { Async, Button, Card, LabeledInput, PageHeader, useToast } from '../../../components/ui';
import { BranchOpenSwitch } from '../../../components/vendor/BranchOpenSwitch';
import { BranchClosures } from '../../../components/vendor/BranchClosures';
import { BranchChangeRequests } from '../../../components/vendor/BranchChangeRequests';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { apiErrorMessage } from '../../../lib/api/errors';
import { getVendorBranch, updateVendorBranch, type OpeningHours, type VendorBranchProfile, type VendorOverview } from '../../../lib/api/vendor-business';

const DAYS: Array<[keyof OpeningHours, string, string]> = [['sat', 'Saturday', 'السبت'], ['sun', 'Sunday', 'الأحد'], ['mon', 'Monday', 'الإثنين'], ['tue', 'Tuesday', 'الثلاثاء'], ['wed', 'Wednesday', 'الأربعاء'], ['thu', 'Thursday', 'الخميس'], ['fri', 'Friday', 'الجمعة']];

function BranchCard({ id, reloadKey = 0, onRequested }: { id: string; reloadKey?: number; onRequested?: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [b, setB] = useState<VendorBranchProfile | null>(null);
  const [hours, setHours] = useState<OpeningHours>({});
  const [prep, setPrep] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { const x = await getVendorBranch(id); setB(x); setHours(x.openingHours); setPrep(x.preparationTimeMinutes == null ? '' : String(x.preparationTimeMinutes)); } catch (e) { setError(apiErrorMessage(e, t('Could not load the branch.', 'تعذّر تحميل الفرع.'))); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // reloadKey changes when a closure is scheduled or cancelled, so the open/closed status above is never stale
  useEffect(() => { void load(); }, [load, reloadKey]);
  if (error) return <Card><p role="alert" className="text-sm text-red-700">{error}</p></Card>;
  if (!b) return <Card><p className="text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p></Card>;

  const setDay = (d: keyof OpeningHours, patch: { open?: string; close?: string } | null) =>
    setHours((h) => { const n = { ...h }; if (patch === null) delete n[d]; else n[d] = { open: patch.open ?? n[d]?.open ?? '09:00', close: patch.close ?? n[d]?.close ?? '23:00' }; return n; });
  async function save() {
    setSaving(true);
    try {
      const p = prep.trim() === '' ? null : Number(prep);
      const hoursChanged = JSON.stringify(hours) !== JSON.stringify(b?.openingHours ?? {});
      const next = await updateVendorBranch(id, { ...(hoursChanged ? { openingHours: hours } : {}), preparationTimeMinutes: p });
      setB(next); setHours(next.openingHours);
      // R44: new weekly hours wait for Hatly's approval; the preparation time applies at once.
      toast.push('success', next.requests?.length ? t('Preparation time saved. The new hours were sent to Hatly for approval.', 'تم حفظ مدة التحضير. أُرسلت المواعيد الجديدة إلى هاتلي للموافقة.') : t('Branch settings saved.', 'تم حفظ إعدادات الفرع.'));
      onRequested?.();
    } catch (e) { toast.push('error', apiErrorMessage(e, t('The settings were refused.', 'تم رفض الإعدادات.'))); } finally { setSaving(false); }
  }
  return (
    <Card
      title={<bdi>{b.name}</bdi>}
      actions={<span className="flex items-center gap-2 text-xs text-gray-600">{!b.isActive ? t('Deactivated by Hatly', 'معطّل من هاتلي') : b.isOpen && b.effectiveOpen === false ? t('Closed by a scheduled closure', 'مغلق بإغلاق مجدول') : b.isOpen ? t('Open', 'مفتوح') : t('Closed', 'مغلق')}<BranchOpenSwitch branchId={b.id} name={b.name} isOpen={b.isOpen} isActive={b.isActive} onChanged={(v) => { setB({ ...b, isOpen: v }); onRequested?.(); }} /></span>}
    >
      <p className="mb-3 text-xs text-gray-500"><bdi>{b.address}</bdi> · {b.deliveryEnabled ? t('Delivery', 'توصيل') : ''}{b.deliveryEnabled && b.pickupEnabled ? ' + ' : ''}{b.pickupEnabled ? t('Pickup', 'استلام') : ''}{(b.acceptanceMode ?? (b.autoAcceptEnabled ? 'AUTO' : 'VENDOR')) === 'AUTO' ? ` · ${t('Orders are accepted automatically', 'تُقبل الطلبات تلقائيًا')}` : (b.acceptanceMode === 'HATLY' ? ` · ${t('Hatly accepts or rejects new orders for this branch; you prepare them once accepted', 'تقبل هاتلي الطلبات الجديدة لهذا الفرع أو ترفضها؛ وتحضّرها أنت بعد القبول')}` : '')}</p>
      <h3 className="mb-2 text-sm font-semibold">{t('Weekly hours', 'مواعيد العمل الأسبوعية')}</h3>
{Object.keys(hours).length === 0 && <p className="mb-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800" data-testid="no-hours-note">{t('No weekly hours are set, so the store takes orders at any time while it is open. Tick the days you open to set hours — days left unticked will then be closed.', 'لا توجد مواعيد أسبوعية، لذلك يستقبل المتجر الطلبات في أي وقت طالما هو مفتوح. حدّد الأيام التي تعمل فيها لضبط المواعيد — الأيام غير المحددة ستكون مغلقة حينها.')}</p>}
      <ul className="space-y-2" data-testid={`hours-${b.id}`}>
        {DAYS.map(([d, en, ar]) => {
          const h = hours[d];
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-24 font-medium">{t(en, ar)}</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" disabled={!b.canEditProfile} checked={Boolean(h)} onChange={(e) => setDay(d, e.target.checked ? {} : null)} />{t('Open', 'مفتوح')}</label>
              {h ? (
                <>
                  <input aria-label={t(`${en} opens`, `${ar} يفتح`)} type="time" disabled={!b.canEditProfile} value={h.open} onChange={(e) => setDay(d, { open: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100" />
                  <span className="text-gray-400">→</span>
                  <input aria-label={t(`${en} closes`, `${ar} يغلق`)} type="time" disabled={!b.canEditProfile} value={h.close} onChange={(e) => setDay(d, { close: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100" />
                </>
              ) : <span className="text-xs text-gray-400">{Object.keys(hours).length === 0 ? t('No set hours', 'بدون مواعيد محددة') : t('Closed all day', 'مغلق طوال اليوم')}</span>}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-56"><LabeledInput label={t('Preparation time (minutes)', 'مدة التحضير (بالدقائق)')} type="number" min={1} max={600} disabled={!b.canEditProfile} value={prep} onChange={(e) => setPrep(e.target.value)} hint={t('Shown to customers as an estimate.', 'تظهر للعملاء كتقدير.')} /></div>
        {b.canEditProfile ? <Button variant="primary" loading={saving} onClick={save}>{t('Save', 'حفظ')}</Button> : <p className="text-xs text-gray-500">{t('Only a branch manager can change hours and preparation time.', 'يغيّر مدير الفرع فقط المواعيد ومدة التحضير.')}</p>}
      </div>
    </Card>
  );
}

/** Each branch's open/closed switch, weekly hours and preparation time. Anyone linked to the branch may open or close it; a manager edits the rest. */
export default function MyBranchesPage() {
  const { t } = useLang();
  const [closuresVersion, setClosuresVersion] = useState(0);
  const state = useApi<VendorOverview>('/vendor/overview');
  return (
    <div className="space-y-4">
      <PageHeader title={t('My branches', 'فروعي')} subtitle={t('Open or close a branch for new orders, set its weekly hours and how long preparation takes.', 'افتح أو أغلق الفرع لاستقبال الطلبات، وحدّد مواعيده الأسبوعية ومدة التحضير.')} />
      <Async state={state} rows={3}>{state.data?.branches.map((b) => <div key={b.id} className="space-y-4"><BranchCard id={b.id} reloadKey={closuresVersion} onRequested={() => setClosuresVersion((v) => v + 1)} /><BranchChangeRequests branchId={b.id} reloadKey={closuresVersion} onChanged={() => setClosuresVersion((v) => v + 1)} /><BranchClosures scope="vendor" branchId={b.id} onChanged={() => setClosuresVersion((v) => v + 1)} /></div>)}</Async>
    </div>
  );
}
