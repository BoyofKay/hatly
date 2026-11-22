'use client';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';
import { SimpleEditModal } from '../../../components/admin/SimpleEditModal';
import { ResetPasswordButton } from '../../../components/admin/ResetPasswordButton';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminDriver,
  DriverVehicleTypeOption,
  createDriver,
  listDriverVehicleTypes,
  listDrivers,
  setDriverVehicleType,
  setDriverVerification,
} from '../../../lib/api/admin-dispatch';
import { apiClient } from '../../../lib/api/client';
import { apiErrorMessage } from '../../../lib/api/errors';
import { DriverCommissionEditor } from '../../../components/drivers/DriverCommissionEditor';
import { DriverCapacityEditor } from '../../../components/drivers/DriverCapacityEditor';
import { ORDER_STATUS, label } from '../../../lib/admin/labels';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, inputCls, KpiCard, LabeledInput, Modal, PageHeader, Skeleton, StatusPill, useToast } from '../../../components/ui';

/**
 * Admin Drivers — the fleet at a glance (online / free / on a delivery / waiting for approval), a searchable, filterable list of driver cards, approval
 * and vehicle-type management, and driver creation in a dialog. Consumes `GET/POST admin/drivers` exactly (phone + password only, no OTP; no
 * acceptance configuration — none exists on the backend). A newly created driver is PENDING and can never be dispatched until APPROVED, so drivers
 * waiting for approval are listed first. `?search=` pre-fills the search box.
 */
export default function AdminDriversPage() {
  return (
    <I18nProvider>
      <AdminDriversScreen />
    </I18nProvider>
  );
}

type Filter = 'all' | 'online' | 'free' | 'onDelivery' | 'pending' | 'rejected';
const PAGE = 30;
const VERIFICATION: Record<string, [string, string]> = { PENDING: ['Pending approval', 'بانتظار الموافقة'], APPROVED: ['Approved', 'معتمد'], REJECTED: ['Rejected', 'مرفوض'] };
const rank = (d: AdminDriver) => (d.verificationStatus === 'PENDING' ? 0 : d.activeDelivery ? 1 : d.isOnline ? 2 : 3);

function AdminDriversScreen() {
  const { t, locale } = useI18n();
  const { t: tl, dateTime } = useLang();
  const toast = useToast();
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState(PAGE);
  // A driver's settings (commission · orders at once · vehicle) open on demand, so the list stays a list; one search result opens by itself.
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  const [createOpen, setCreateOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [editingDriver, setEditingDriver] = useState<{ id: string; fullName: string; phone: string } | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [verifying, setVerifying] = useState<{ driver: AdminDriver; status: 'APPROVED' | 'REJECTED' } | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [vehicleTypes, setVehicleTypes] = useState<DriverVehicleTypeOption[] | null>(null);
  const [vehicleTypesError, setVehicleTypesError] = useState<string | null>(null);
  /** The picker's value per driver while it differs from the saved one (`''` = no vehicle type). */
  const [vehicleDraftById, setVehicleDraftById] = useState<Record<string, string>>({});
  const [savingVehicleId, setSavingVehicleId] = useState<string | null>(null);
  const [vehicleResultById, setVehicleResultById] = useState<Record<string, { ok: boolean; message: string }>>({});

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDrivers(await listDrivers());
    } catch (err: any) {
      setError(apiErrorMessage(err, t('drvLoadFailed')));
    }
  }, [t]);

  const loadVehicleTypes = useCallback(async () => {
    setVehicleTypesError(null);
    try {
      setVehicleTypes(await listDriverVehicleTypes());
    } catch (err: any) {
      setVehicleTypesError(apiErrorMessage(err, t('drvVehicleTypesFailed')));
    }
  }, [t]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('search');
    if (q) setSearch(q);
    void refresh();
    void loadVehicleTypes();
  }, [refresh, loadVehicleTypes]);

  const counts = useMemo(() => {
    const l = drivers ?? [];
    return {
      all: l.length,
      online: l.filter((d) => d.isOnline).length,
      free: l.filter((d) => d.isOnline && d.isAvailable).length,
      onDelivery: l.filter((d) => d.activeDelivery).length,
      pending: l.filter((d) => d.verificationStatus === 'PENDING').length,
      rejected: l.filter((d) => d.verificationStatus === 'REJECTED').length,
    };
  }, [drivers]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (d: AdminDriver) =>
      filter === 'all' ? true
        : filter === 'online' ? d.isOnline
        : filter === 'free' ? d.isOnline && d.isAvailable
        : filter === 'onDelivery' ? !!d.activeDelivery
        : filter === 'pending' ? d.verificationStatus === 'PENDING'
        : d.verificationStatus === 'REJECTED';
    return (drivers ?? [])
      .filter((d) => match(d) && (!q || d.fullName.toLowerCase().includes(q) || d.phone.replace(/\s/g, '').includes(q.replace(/\s/g, ''))))
      .sort((a, b) => rank(a) - rank(b) || a.fullName.localeCompare(b.fullName));
  }, [drivers, search, filter]);

  useEffect(() => setShown(PAGE), [search, filter]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setCreateError(null);
    try {
      const driver = await createDriver({ fullName, phone, password });
      setFullName('');
      setPhone('');
      setPassword(''); // never kept in state beyond this submission
      setCreateOpen(false);
      toast.push('success', t('drvCreated', { name: driver.fullName }));
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, t('drvCreateFailed')));
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Approving / rejecting changes dispatch eligibility, so it is confirmed first; the list is re-read from the server afterwards. */
  async function confirmVerification() {
    if (!verifying || verifyBusy) return;
    setVerifyBusy(true);
    setVerifyError(null);
    try {
      await setDriverVerification(verifying.driver.id, verifying.status);
      setVerifying(null);
      await refresh();
    } catch (err: any) {
      setVerifyError(apiErrorMessage(err, t('drvVerifyFailed')));
      await refresh();
    } finally {
      setVerifyBusy(false);
    }
  }

  /** Saves the picked vehicle type; the card then shows what the backend now holds (re-read), never a local assumption. */
  async function handleSaveVehicle(driver: AdminDriver) {
    if (savingVehicleId) return;
    const draft = vehicleDraftById[driver.id];
    if (draft === undefined) return;
    setSavingVehicleId(driver.id);
    setVehicleResultById((prev) => {
      const { [driver.id]: _, ...rest } = prev;
      return rest;
    });
    try {
      await setDriverVehicleType(driver.id, draft === '' ? null : draft);
      setVehicleResultById((prev) => ({ ...prev, [driver.id]: { ok: true, message: t('drvVehicleSaved', { name: driver.fullName }) } }));
    } catch (err: any) {
      setVehicleResultById((prev) => ({ ...prev, [driver.id]: { ok: false, message: apiErrorMessage(err, t('drvVehicleFailed')) } }));
    } finally {
      setVehicleDraftById((prev) => {
        const { [driver.id]: _, ...rest } = prev;
        return rest;
      });
      await Promise.all([refresh(), loadVehicleTypes()]);
      setSavingVehicleId(null);
    }
  }

  const vehicleName = (v: DriverVehicleTypeOption) => {
    const name = locale === 'ar' && v.nameAr ? v.nameAr : v.name;
    return v.isBicycle ? t('drvVehicleBicycle', { name }) : name;
  };

  const chips: Array<[Filter, string, number]> = [
    ['all', tl('All', 'الكل'), counts.all],
    ['online', t('drvOnline'), counts.online],
    ['free', t('drvFree'), counts.free],
    ['onDelivery', t('drvOnDelivery'), counts.onDelivery],
    ['pending', tl('Waiting for approval', 'بانتظار الموافقة'), counts.pending],
    ['rejected', tl('Rejected', 'مرفوضون'), counts.rejected],
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('drvTitle')}
        subtitle={tl('Approve new drivers, see who is online and free, and set each driver’s vehicle.', 'اعتمد المندوبين الجدد، وتابع من هو متصل ومتاح، وحدّد مركبة كل مندوب.')}
        actions={<><Button onClick={refresh}>{t('drvRefresh')}</Button><Button variant="primary" onClick={() => { setCreateError(null); setCreateOpen(true); }} data-testid="drv-add">{tl('Add driver', 'إضافة سائق')}</Button></>}
      />

      {drivers && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="drv-kpis">
          <KpiCard label={tl('Drivers', 'السائقون')} value={counts.all} />
          <KpiCard label={t('drvOnline')} value={counts.online} hint={tl(`${counts.free} free`, `${counts.free} متاح`)} />
          <KpiCard label={t('drvOnDelivery')} value={counts.onDelivery} />
          <KpiCard label={tl('Waiting for approval', 'بانتظار الموافقة')} value={counts.pending} tone={counts.pending > 0 ? 'bad' : 'neutral'} hint={counts.pending > 0 ? tl('Cannot receive orders yet', 'لا يستقبلون طلبات بعد') : undefined} />
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl('Search by name or phone', 'ابحث بالاسم أو الهاتف')} aria-label={tl('Search by name or phone', 'ابحث بالاسم أو الهاتف')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-sm`} data-testid="drv-search" />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label={tl('Filter drivers', 'تصفية السائقين')}>
          {chips.map(([id, text, n]) => (
            <button key={id} role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} data-testid={`drv-filter-${id}`}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition ${filter === id ? 'border-hatly-orange bg-hatly-orange text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {text} <span className={`rounded-full px-1.5 text-xs tabular-nums ${filter === id ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      {vehicleTypesError && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="driver-vehicle-types-error">
          {vehicleTypesError} <button onClick={loadVehicleTypes} className="underline">{t('retry')}</button>
        </div>
      )}

      {error && !drivers ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !drivers ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : drivers.length === 0 ? (
        <Card><EmptyState title={tl('No drivers yet', 'لا يوجد سائقون بعد')} hint={tl('Add the first driver to start delivering orders.', 'أضف أول سائق لبدء توصيل الطلبات.')} action={<Button variant="primary" onClick={() => setCreateOpen(true)}>{tl('Add driver', 'إضافة سائق')}</Button>} /></Card>
      ) : visible.length === 0 ? (
        <Card><EmptyState title={tl('No drivers match', 'لا يوجد سائقون مطابقون')} hint={tl('Try another search or filter.', 'جرّب بحثًا أو فلترًا آخر.')} action={<Button onClick={() => { setSearch(''); setFilter('all'); }}>{tl('Clear filters', 'مسح الفلاتر')}</Button>} /></Card>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.slice(0, shown).map((d) => {
              const saved = d.vehicleTypeId ?? '';
              const draft = vehicleDraftById[d.id];
              const picked = draft ?? saved;
              const savedIsInactive = d.vehicleTypeId !== null && vehicleTypes !== null && !vehicleTypes.some((v) => v.id === d.vehicleTypeId);
              const result = vehicleResultById[d.id];
              const vTone = d.verificationStatus === 'APPROVED' ? 'green' : d.verificationStatus === 'REJECTED' ? 'red' : 'amber';
              return (
                <li key={d.id} data-testid={`driver-row-${d.id}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-gray-900">{d.fullName}</p>
                      <p className="text-xs text-gray-500" dir="ltr">{d.phone}</p>
                    </div>
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge tone={d.isOnline ? 'green' : 'gray'}>{d.isOnline ? t('drvOnline') : t('drvOffline')}</Badge>
                      <Badge tone={vTone}>{label(VERIFICATION, d.verificationStatus, tl)}</Badge>
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-gray-600">
                    <p>
                      <Badge tone={d.isAvailable ? 'blue' : 'gray'}>{d.isAvailable ? t('drvFree') : d.activeDelivery ? t('drvOnDelivery') : t('drvUnavailable')}</Badge>{' '}
                      <span data-testid="driver-vehicle-name">{d.vehicleTypeName ?? t('drvNoVehicle')}</span>
                    </p>
                    {d.capacity != null && <p data-testid="driver-load">{t('drvLoad', { active: d.activeCount ?? 0, capacity: d.capacity })}</p>}
                    {d.lastSeenAt && <p data-testid="driver-last-seen">{t('drvLastSeen', { time: dateTime(d.lastSeenAt) })}</p>}
                    {/* Driver shifts (2026-11-22): on duty since…, a 14-hour warning, "stopped new orders", and the supervisor's force-end. */}
                    {d.shiftStartedAt ? (
                      <p data-testid="driver-shift" className="flex flex-wrap items-center gap-1.5">
                        <span>{tl('On shift since', 'في الوردية منذ')} {dateTime(d.shiftStartedAt)}</span>
                        {Date.now() - new Date(d.shiftStartedAt).getTime() >= 14 * 3_600_000 && <Badge tone="red">{tl('Shift open 14h+', 'وردية مفتوحة +14 ساعة')}</Badge>}
                        {d.acceptingNewOrders === false && <Badge tone="amber">{tl('Not taking new orders', 'لا يستقبل طلبات جديدة')}</Badge>}
                        <button type="button" className="text-hatly-orangeDark underline" data-testid={`driver-end-shift-${d.id}`}
                          onClick={async () => {
                            if (!window.confirm(tl(`End ${d.fullName}'s shift now? Orders still with them stay with them — reassign them if needed.`, `إنهاء وردية ${d.fullName} الآن؟ الطلبات التي معه تبقى معه — أعد إسنادها إن لزم.`))) return;
                            try { await apiClient.post(`/admin/drivers/${d.id}/shift/end`); await refresh(); } catch (e) { window.alert(apiErrorMessage(e, tl('Could not end the shift.', 'تعذّر إنهاء الوردية.'))); }
                          }}>{tl('End shift', 'إنهاء الوردية')}</button>
                      </p>
                    ) : (
                      <p data-testid="driver-shift" className="text-gray-400">{tl('Off duty', 'خارج الخدمة')}</p>
                    )}
                    {d.lastLocationAt && <p>{t('drvLocationUpdated', { time: dateTime(d.lastLocationAt) })}</p>}
                    {d.activeDelivery && (
                      <p data-testid="driver-active-delivery">
                        {t('drvOnOrder')}{' '}
                        <a href={`/order-search/${d.activeDelivery.orderId}`} className="font-medium text-hatly-orangeDark hover:underline" dir="ltr">{d.activeDelivery.orderNumber}</a>{' '}
                        <StatusPill status={d.activeDelivery.status} label={label(ORDER_STATUS, d.activeDelivery.status, tl)} />
                      </p>
                    )}
                  </div>

                  {(
                    <div className="flex flex-wrap gap-2">
                      {d.verificationStatus !== 'APPROVED' && <Button variant="primary" size="sm" className="min-h-[40px]" onClick={() => { setVerifyError(null); setVerifying({ driver: d, status: 'APPROVED' }); }}>{t('drvApprove')}</Button>}
                      {d.verificationStatus !== 'REJECTED' && <Button size="sm" className="min-h-[40px]" onClick={() => { setVerifyError(null); setVerifying({ driver: d, status: 'REJECTED' }); }}>{t('drvReject')}</Button>}
                      <Button size="sm" className="min-h-[40px]" onClick={() => setEditingDriver({ id: d.id, fullName: d.fullName, phone: d.phone })}>{tl('Edit details', 'تعديل البيانات')}</Button>
                      <ResetPasswordButton path={`/admin/drivers/${d.id}/reset-password`} name={d.fullName} />
                      <DeleteRecordButton path={`/admin/drivers/${d.id}`} name={d.fullName} what={['Driver', 'السائق']} consequence={['They are signed out of the driver app and cannot sign in again. Refused while they have deliveries in progress. Their past deliveries and settlements stay.', 'سيتم تسجيل خروجه من تطبيق السائق ولن يستطيع الدخول. يُرفض إذا كان لديه توصيلات جارية. تبقى توصيلاته وتسوياته السابقة.']} onDeleted={refresh} />
                    </div>
                  )}

                  {(() => {
                    const open = editing[d.id] ?? visible.length === 1;
                    return (
                      <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                        <span data-testid="driver-settings-summary">
                          {tl('Commission', 'العمولة')}: <b className="font-medium text-gray-800">{d.commissionRateBasisPoints != null ? `${d.commissionRateBasisPoints / 100}%` : tl('not set', 'غير محددة')}</b>
                        </span>
                        <button type="button" onClick={() => setEditing((e) => ({ ...e, [d.id]: !open }))} aria-expanded={open} data-testid={`driver-edit-${d.id}`}
                          className="min-h-[36px] rounded-lg border border-gray-200 px-3 font-medium text-gray-700 hover:bg-gray-50">
                          {open ? tl('Close settings', 'إغلاق الإعدادات') : tl('Edit settings', 'تعديل الإعدادات')}
                        </button>
                      </div>
                    );
                  })()}

                  {(editing[d.id] ?? visible.length === 1) && <DriverCommissionEditor driverId={d.id} basisPoints={d.commissionRateBasisPoints} onSaved={refresh} />}
                  {(editing[d.id] ?? visible.length === 1) && <DriverCapacityEditor driverId={d.id} />}

                  {vehicleTypes !== null && (editing[d.id] ?? visible.length === 1) && (
                    <div className="mt-auto border-t border-gray-100 pt-3" data-testid="driver-vehicle">
                      <label htmlFor={`vehicle-${d.id}`} className="mb-1 block text-xs font-medium text-gray-700">{t('drvVehicleLabel')}</label>
                      <div className="flex gap-2">
                        <select
                          id={`vehicle-${d.id}`}
                          data-testid="driver-vehicle-select"
                          value={picked}
                          disabled={savingVehicleId === d.id}
                          onChange={(e) => {
                            const value = e.target.value;
                            setVehicleDraftById((prev) => {
                              const { [d.id]: _, ...rest } = prev;
                              return value === saved ? rest : { ...rest, [d.id]: value };
                            });
                          }}
                          className={`${inputCls} min-w-0 flex-1`}
                        >
                          <option value="">{t('drvVehicleNone')}</option>
                          {savedIsInactive && <option value={saved} disabled>{t('drvVehicleInactive', { name: d.vehicleTypeName ?? saved })}</option>}
                          {vehicleTypes.map((v) => <option key={v.id} value={v.id}>{vehicleName(v)}</option>)}
                        </select>
                        <Button data-testid="driver-vehicle-save" onClick={() => handleSaveVehicle(d)} disabled={draft === undefined || savingVehicleId !== null} className="shrink-0">
                          {savingVehicleId === d.id ? t('drvVehicleSaving') : t('drvVehicleSave')}
                        </Button>
                      </div>
                      {result && <p role="status" data-testid="driver-vehicle-result" className={`mt-1 text-xs ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {visible.length > shown && (
            <div className="mt-4 text-center">
              <Button onClick={() => setShown((n) => n + PAGE)}>{tl(`Show more (${visible.length - shown} left)`, `عرض المزيد (${visible.length - shown} متبقٍ)`)}</Button>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500">{t('drvVehicleHelp')}</p>
        </>
      )}

      <Modal
        open={createOpen}
        title={t('drvCreateTitle')}
        onClose={() => !isSubmitting && setCreateOpen(false)}
        footer={<><Button onClick={() => setCreateOpen(false)} disabled={isSubmitting}>{tl('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="drv-create" loading={isSubmitting}>{isSubmitting ? t('drvCreating') : t('drvCreate')}</Button></>}
      >
        <form id="drv-create" onSubmit={handleCreate} className="space-y-3">
          <LabeledInput label={t('drvFullName')} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <LabeledInput label={t('drvPhone')} required type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20..." />
          <LabeledInput label={t('drvPassword')} required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} hint={t('drvPasswordHelp')} autoComplete="new-password" />
          {createError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!verifying}
        title={verifying?.status === 'APPROVED' ? t('drvApprove') : t('drvReject')}
        message={verifying ? (verifying.status === 'APPROVED' ? t('drvConfirmApprove', { name: verifying.driver.fullName }) : t('drvConfirmReject', { name: verifying.driver.fullName })) : ''}
        confirmLabel={verifying?.status === 'APPROVED' ? t('drvApprove') : t('drvReject')}
        danger={verifying?.status === 'REJECTED'}
        busy={verifyBusy}
        error={verifyError}
        onConfirm={confirmVerification}
        onClose={() => setVerifying(null)}
      />
      {editingDriver && (
        <SimpleEditModal
          title={['Edit driver', 'تعديل السائق']}
          path={`/admin/drivers/${editingDriver.id}/profile`}
          initial={editingDriver}
          fields={[
            { key: 'fullName', label: ['Full name', 'الاسم الكامل'], required: true },
            { key: 'phone', label: ['Phone (sign-in)', 'الهاتف (للدخول)'], kind: 'phone', required: true, hint: ['Changing it signs the driver out.', 'تغييره يُخرج السائق من التطبيق.'] },
          ]}
          onClose={() => setEditingDriver(null)}
          onSaved={async () => { setEditingDriver(null); await refresh(); }}
        />
      )}
    </div>
  );
}
