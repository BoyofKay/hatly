'use client';

import { useCallback, useEffect, useState } from 'react';
import { VehicleType, createVehicleType, listVehicleTypes, updateVehicleType } from '../../../lib/api/admin-vehicle-types';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, Column, ConfirmDialog, DataTable, LabeledInput, Modal, PageHeader, useToast } from '../../../components/ui';

/**
 * Vehicle Types — the catalogue drivers choose their vehicle from. Reuses the existing `admin/vehicle-types` endpoints exactly. `maxActiveDeliveries`
 * is each driver's capacity (R18: active orders at once; an Admin may override it per driver, audited). Only a bicycle type limits how far a driver is sent to a pickup. Deactivating is confirmed first.
 */
export default function VehicleTypesPage() {
  const { t } = useLang();
  const toast = useToast();
  const [types, setTypes] = useState<VehicleType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<VehicleType | 'new' | null>(null);
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [maxActive, setMaxActive] = useState('');
  const [isBicycle, setIsBicycle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deactivate, setDeactivate] = useState<VehicleType | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setTypes(await listVehicleTypes(true));
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load vehicle types.', 'تعذّر تحميل أنواع المركبات.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(target: VehicleType | 'new') {
    setFormError(null);
    setEditing(target);
    if (target === 'new') { setName(''); setNameAr(''); setMaxActive(''); setIsBicycle(false); }
    else { setName(target.name); setNameAr(target.nameAr ?? ''); setMaxActive(String(target.maxActiveDeliveries)); setIsBicycle(target.isBicycle); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !editing) return;
    const max = Number(maxActive);
    if (!name.trim() || !maxActive || !Number.isInteger(max) || max <= 0) return setFormError(t('A name and a whole number of max active deliveries (at least 1) are required.', 'الاسم وعدد صحيح للحد الأقصى للتوصيلات النشطة (1 على الأقل) مطلوبان.'));
    setSaving(true);
    setFormError(null);
    try {
      if (editing === 'new') await createVehicleType({ name: name.trim(), nameAr: nameAr.trim() || undefined, maxActiveDeliveries: max, isBicycle });
      else await updateVehicleType(editing.id, { name: name.trim(), nameAr: nameAr.trim() || undefined, maxActiveDeliveries: max, isBicycle });
      toast.push('success', editing === 'new' ? t('Vehicle type created.', 'تم إنشاء نوع المركبة.') : t('Vehicle type saved.', 'تم حفظ نوع المركبة.'));
      setEditing(null);
      await refresh();
    } catch (err: any) {
      setFormError(apiErrorMessage(err, t('Failed to save the vehicle type.', 'تعذّر حفظ نوع المركبة.')));
    } finally {
      setSaving(false);
    }
  }

  async function setActive(type: VehicleType, next: boolean) {
    if (busy) return;
    setBusy(true);
    setRowError(null);
    try {
      await updateVehicleType(type.id, { isActive: next });
      toast.push('success', next ? t('Vehicle type activated.', 'تم تفعيل نوع المركبة.') : t('Vehicle type deactivated.', 'تم إيقاف نوع المركبة.'));
      setDeactivate(null);
      await refresh();
    } catch (err: any) {
      setRowError(apiErrorMessage(err, t('Failed to update.', 'تعذّر التحديث.')));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<VehicleType>[] = [
    { key: 'name', header: t('Name', 'الاسم'), cell: (v) => <span><span className="font-medium text-gray-900">{v.name}</span>{v.nameAr && <span className="ms-2 text-gray-500" dir="rtl">{v.nameAr}</span>}</span> },
    { key: 'kind', header: t('Kind', 'النوع'), cell: (v) => (v.isBicycle ? <Badge tone="blue">{t('Bicycle', 'دراجة')}</Badge> : <span className="text-gray-500">{t('Motorised', 'بمحرك')}</span>) },
    { key: 'max', header: t('Max active deliveries', 'الحد الأقصى للتوصيلات النشطة'), align: 'end', cell: (v) => v.maxActiveDeliveries },
    { key: 'status', header: t('Status', 'الحالة'), cell: (v) => <Badge tone={v.isActive ? 'green' : 'gray'}>{v.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge> },
    {
      key: 'actions', header: '', align: 'end',
      cell: (v) => (
        <span className="inline-flex gap-2">
          <Button size="sm" className="min-h-[36px]" onClick={() => open(v)}>{t('Edit', 'تعديل')}</Button>
          {v.isActive ? <Button size="sm" className="min-h-[36px]" onClick={() => { setRowError(null); setDeactivate(v); }}>{t('Deactivate', 'إيقاف')}</Button> : <Button size="sm" variant="primary" className="min-h-[36px]" loading={busy} onClick={() => void setActive(v, true)}>{t('Activate', 'تفعيل')}</Button>}
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('Vehicle Types', 'أنواع المركبات')}
        subtitle={t('The vehicles drivers can choose from. Only a bicycle type limits how far a driver is sent to a pickup.', 'المركبات التي يختار منها السائقون. نوع الدراجة وحده يحدّ من مسافة الاستلام التي يُرسَل إليها السائق.')}
        actions={<><Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button><Button variant="primary" onClick={() => open('new')}>{t('New vehicle type', 'نوع مركبة جديد')}</Button></>}
      />
      <Card pad={false}>
        <DataTable columns={columns} rows={types ?? undefined} rowKey={(v) => v.id} loading={loading} error={error} onRetry={refresh} emptyTitle={t('No vehicle types yet.', 'لا توجد أنواع مركبات بعد.')} emptyHint={t('Add the vehicles your drivers use.', 'أضف المركبات التي يستخدمها سائقوك.')} />
      </Card>
      {rowError && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{rowError}</p>}

      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('New vehicle type', 'نوع مركبة جديد') : t('Edit vehicle type', 'تعديل نوع المركبة')}
        onClose={() => !saving && setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)} disabled={saving}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="vt-form" loading={saving}>{t('Save', 'حفظ')}</Button></>}
      >
        <form id="vt-form" onSubmit={save} className="space-y-3">
          <LabeledInput label={t('Name', 'الاسم')} required value={name} onChange={(e) => setName(e.target.value)} />
          <LabeledInput label={t('Name (Arabic, optional)', 'الاسم (بالعربية، اختياري)')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <LabeledInput label={t('Max active deliveries', 'الحد الأقصى للتوصيلات النشطة')} type="number" min={1} step={1} inputMode="numeric" required value={maxActive} onChange={(e) => setMaxActive(e.target.value)} hint={t('How many active orders a driver with this vehicle may carry at once (R18). Applies from the next assignment.', 'عدد الطلبات النشطة التي يحملها السائق بهذه المركبة في وقت واحد. يُطبَّق من الإسناد التالي.')} />
          <label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={isBicycle} onChange={(e) => setIsBicycle(e.target.checked)} />{t('Bicycle (subject to the max pickup distance policy)', 'دراجة (تخضع لسياسة الحد الأقصى لمسافة الاستلام)')}</label>
          {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deactivate}
        title={t('Deactivate this vehicle type?', 'إيقاف نوع المركبة هذا؟')}
        message={deactivate ? t(`Deactivate "${deactivate.name}"? Drivers using this vehicle type may become ineligible for new assignments.`, `إيقاف "${deactivate.name}"؟ قد يصبح السائقون الذين يستخدمون هذا النوع غير مؤهلين للتعيينات الجديدة.`) : ''}
        confirmLabel={t('Deactivate', 'إيقاف')}
        danger
        busy={busy}
        error={rowError}
        onConfirm={() => deactivate && void setActive(deactivate, false)}
        onClose={() => setDeactivate(null)}
      />
    </div>
  );
}
