'use client';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';

import { useCallback, useEffect, useState } from 'react';
import { ServiceArea, activateServiceArea, createServiceArea, deactivateServiceArea, listServiceAreas, updateServiceArea } from '../../../lib/api/admin-service-areas';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, Column, ConfirmDialog, DataTable, LabeledInput, Modal, PageHeader, useToast } from '../../../components/ui';

/**
 * Service Areas — consumes the Phase I-B backend exactly. A service area is a centre point plus a radius (not a polygon), so the form collects exactly
 * those fields and nothing is fabricated. Renaming and activating are one click; deactivating is confirmed.
 */
export default function ServiceAreasPage() {
  const { t, num } = useLang();
  const toast = useToast();
  const [areas, setAreas] = useState<ServiceArea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renaming, setRenaming] = useState<ServiceArea | null>(null);
  const [newName, setNewName] = useState('');
  const [newNameAr, setNewNameAr] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [deactivate, setDeactivate] = useState<ServiceArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setAreas(await listServiceAreas());
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load service areas.', 'تعذّر تحميل مناطق الخدمة.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    const centerLatitude = Number(lat);
    const centerLongitude = Number(lng);
    const radiusMeters = Math.round(Number(radius) * 1000); // typed in km (7.5), stored in metres
    if (!nameAr.trim()) return setCreateError(t('Enter the Arabic name too.', 'أدخل الاسم العربي أيضًا.'));
    if ([lat, lng, radius].some((v) => !v.trim()) || [centerLatitude, centerLongitude, radiusMeters].some((n) => Number.isNaN(n))) return setCreateError(t('Latitude, longitude and radius must all be valid numbers.', 'خط العرض وخط الطول ونصف القطر يجب أن تكون كلها أرقامًا صحيحة.'));
    setIsSubmitting(true);
    setCreateError(null);
    try {
      await createServiceArea({ name: name.trim(), nameAr: nameAr.trim(), centerLatitude, centerLongitude, radiusMeters });
      setName(''); setNameAr(''); setLat(''); setLng(''); setRadius('');
      setCreating(false);
      toast.push('success', t('Service area created.', 'تم إنشاء منطقة الخدمة.'));
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, t('Failed to create service area.', 'تعذّر إنشاء منطقة الخدمة.')));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string, fail: string, done: () => void) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      toast.push('success', ok);
      done();
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, fail));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ServiceArea>[] = [
    { key: 'name', header: t('Name', 'الاسم'), cell: (a) => <span className="font-medium text-gray-900">{a.name}</span> },
    { key: 'center', header: t('Centre', 'المركز'), cell: (a) => <span dir="ltr" className="text-xs text-gray-600">{a.centerLatitude}, {a.centerLongitude}</span> },
    { key: 'radius', header: t('Radius', 'نصف القطر'), align: 'end', cell: (a) => `${num(Number((a.radiusMeters / 1000).toFixed(1)))} ${t('km', 'كم')}` },
    { key: 'status', header: t('Status', 'الحالة'), cell: (a) => <Badge tone={a.isActive ? 'green' : 'gray'}>{a.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge> },
    {
      key: 'actions', header: '', align: 'end',
      cell: (a) => (
        <span className="inline-flex gap-2">
          <Button size="sm" className="min-h-[36px]" onClick={() => { setActionError(null); setNewName(a.name); setNewNameAr(a.nameAr ?? ''); setRenaming(a); }}>{t('Rename', 'إعادة تسمية')}</Button>
          {a.isActive
            ? <Button size="sm" className="min-h-[36px]" onClick={() => { setActionError(null); setDeactivate(a); }}>{t('Deactivate', 'إيقاف')}</Button>
            : <Button size="sm" variant="primary" className="min-h-[36px]" loading={busy} onClick={() => void run(() => activateServiceArea(a.id), t('Service area activated.', 'تم تفعيل منطقة الخدمة.'), t('Failed to update service area.', 'تعذّر تحديث منطقة الخدمة.'), () => undefined)}>{t('Activate', 'تفعيل')}</Button>}
          <DeleteRecordButton path={`/admin/service-areas/${a.id}`} name={a.name} what={['Service area', 'منطقة الخدمة']} consequence={['Only an area with no stores and no delivery zones can be deleted.', 'يمكن حذف المنطقة التي لا تحتوي متاجر ولا مناطق توصيل فقط.']} onDeleted={refresh} />
        </span>
      ),
    },
  ];

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('Service Areas', 'مناطق الخدمة')}
        subtitle={t('Each area is a centre point and a radius — not a drawn boundary.', 'كل منطقة هي نقطة مركز ونصف قطر — وليست حدودًا مرسومة.')}
        actions={<><Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button><Button variant="primary" onClick={() => { setCreateError(null); setCreating(true); }}>{t('New service area', 'منطقة خدمة جديدة')}</Button></>}
      />
      <Card pad={false}>
        <DataTable columns={columns} rows={areas ?? undefined} rowKey={(a) => a.id} loading={loading} error={error} onRetry={refresh} emptyTitle={t('No service areas yet.', 'لا توجد مناطق خدمة بعد.')} emptyHint={t('Create the first area to define where you deliver.', 'أنشئ أول منطقة لتحديد أين توصّل.')} />
      </Card>

      <Modal
        open={creating}
        title={t('New service area', 'منطقة خدمة جديدة')}
        onClose={() => !isSubmitting && setCreating(false)}
        footer={<><Button onClick={() => setCreating(false)} disabled={isSubmitting}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="sa-create" loading={isSubmitting}>{isSubmitting ? t('Creating...', 'جارٍ الإنشاء...') : t('Create service area', 'إنشاء المنطقة')}</Button></>}
      >
        <form id="sa-create" onSubmit={handleCreate} className="space-y-3">
          <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} required value={name} onChange={(e) => setName(e.target.value)} />
          <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} required dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-3">
            <LabeledInput label={t('Centre latitude', 'خط عرض المركز')} required dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            <LabeledInput label={t('Centre longitude', 'خط طول المركز')} required dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            <LabeledInput label={t('Radius (km)', 'نصف القطر (كم)')} required dir="ltr" inputMode="decimal" placeholder="7.5" value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
          {createError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
        </form>
      </Modal>

      <Modal
        open={!!renaming}
        title={t('Rename service area', 'إعادة تسمية منطقة الخدمة')}
        onClose={() => !busy && setRenaming(null)}
        footer={<><Button onClick={() => setRenaming(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="sa-rename" loading={busy} disabled={!newName.trim() || !newNameAr.trim() || (newName === renaming?.name && newNameAr === (renaming?.nameAr ?? ''))}>{t('Save', 'حفظ')}</Button></>}
      >
        <form id="sa-rename" onSubmit={(e) => { e.preventDefault(); if (renaming) void run(() => updateServiceArea(renaming.id, { name: newName.trim(), nameAr: newNameAr.trim() }), t('Service area renamed.', 'تمت إعادة تسمية المنطقة.'), t('Failed to rename service area.', 'تعذّرت إعادة التسمية.'), () => setRenaming(null)); }} className="space-y-3">
          <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} required value={newName} onChange={(e) => setNewName(e.target.value)} />
          <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} required dir="rtl" value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} />
          {actionError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deactivate}
        title={t('Deactivate this service area?', 'إيقاف منطقة الخدمة هذه؟')}
        message={deactivate ? t(`"${deactivate.name}" will be marked inactive. You can activate it again at any time.`, `ستُوسَم "${deactivate.name}" كغير نشطة. يمكنك تفعيلها مجددًا في أي وقت.`) : ''}
        confirmLabel={t('Deactivate', 'إيقاف')}
        danger
        busy={busy}
        error={actionError}
        onConfirm={() => deactivate && void run(() => deactivateServiceArea(deactivate.id), t('Service area deactivated.', 'تم إيقاف منطقة الخدمة.'), t('Failed to update service area.', 'تعذّر تحديث منطقة الخدمة.'), () => setDeactivate(null))}
        onClose={() => setDeactivate(null)}
      />
    </div>
  );
}
