'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AdminDriver,
  DriverVehicleTypeOption,
  createDriver,
  listDriverVehicleTypes,
  listDrivers,
  setDriverVehicleType,
  setDriverVerification,
} from '../../../lib/api/admin-dispatch';
import { apiErrorMessage } from '../../../lib/api/errors';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { LocaleToggle } from '../../../components/orders/LocaleToggle';

/**
 * Real Admin Driver provisioning — consumes the real backend
 * `GET/POST admin/drivers` exactly (list added in Chunk 6, create
 * existing since Chunk 5). CONFIRMED (locked decisions): phone +
 * password only, no OTP field anywhere; no acceptance-configuration
 * field, since none exists on the backend DTO.
 *
 * Operational Completion milestone: the driver's vehicle type is set / changed / cleared here
 * (`PATCH admin/drivers/:id/vehicle-type`, MANAGE_DRIVERS) from the ACTIVE `vehicle_types` catalog; the page is
 * bilingual (EN/AR) like the other admin operational screens.
 */
export default function AdminDriversPage() {
  return (
    <I18nProvider>
      <AdminDriversScreen />
    </I18nProvider>
  );
}

function AdminDriversScreen() {
  const { t, locale } = useI18n();
  const [drivers, setDrivers] = useState<AdminDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // M3a (Launch-Readiness Gap Audit, G-20).
  const [verifyingDriverId, setVerifyingDriverId] = useState<string | null>(null);
  const [verifyErrorById, setVerifyErrorById] = useState<Record<string, string>>({});

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
    refresh();
    loadVehicleTypes();
  }, [refresh, loadVehicleTypes]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setCreateError(null);
    setSuccessMessage(null);
    try {
      const driver = await createDriver({ fullName, phone, password });
      setFullName('');
      setPhone('');
      // Password is never kept in state beyond this submission.
      setPassword('');
      setSuccessMessage(t('drvCreated', { name: driver.fullName }));
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, t('drvCreateFailed')));
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * M3a (Launch-Readiness Gap Audit, G-20). Explicit confirmation — a
   * newly Admin-created driver defaults to PENDING and can never receive
   * a dispatch assignment until APPROVED (see
   * DriverRankingService.rankCandidates), so this materially changes
   * dispatch eligibility either way. Re-set from the server's own
   * response, never assumed locally.
   */
  async function handleSetVerification(driver: AdminDriver, status: 'APPROVED' | 'REJECTED') {
    if (verifyingDriverId) return;
    const confirmed = window.confirm(
      status === 'APPROVED' ? t('drvConfirmApprove', { name: driver.fullName }) : t('drvConfirmReject', { name: driver.fullName }),
    );
    if (!confirmed) return;

    setVerifyingDriverId(driver.id);
    setVerifyErrorById((prev) => ({ ...prev, [driver.id]: '' }));
    try {
      await setDriverVerification(driver.id, status);
      await refresh();
    } catch (err: any) {
      setVerifyErrorById((prev) => ({ ...prev, [driver.id]: apiErrorMessage(err, t('drvVerifyFailed')) }));
      await refresh();
    } finally {
      setVerifyingDriverId(null);
    }
  }

  /** Saves the picked vehicle type; the row then shows what the backend now holds (re-read), never a local assumption. */
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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('drvTitle')}</h1>
        <LocaleToggle />
      </div>

      <div className="mt-4 rounded border bg-white p-4">
        <h2 className="font-semibold">{t('drvCreateTitle')}</h2>
        <form onSubmit={handleCreate} className="mt-3 space-y-3">
          <div>
            <label className="block text-sm font-medium">{t('drvFullName')}</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">{t('drvPhone')}</label>
            <input
              required
              type="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+20..."
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">{t('drvPassword')}</label>
            <input
              required
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2"
            />
            <p className="mt-1 text-xs text-gray-500">{t('drvPasswordHelp')}</p>
          </div>
          {createError && <p className="text-sm text-red-600">{createError}</p>}
          {successMessage && <p className="text-sm text-green-700">{successMessage}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded bg-hatly-orange px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? t('drvCreating') : t('drvCreate')}
          </button>
        </form>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t('drvAll')}</h2>
          <button onClick={refresh} className="text-sm text-gray-500 underline">
            {t('drvRefresh')}
          </button>
        </div>

        {error && (
          <div className="mt-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            <button onClick={refresh} className="underline">
              {t('retry')}
            </button>
          </div>
        )}
        {vehicleTypesError && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="driver-vehicle-types-error">
            {vehicleTypesError}{' '}
            <button onClick={loadVehicleTypes} className="underline">
              {t('retry')}
            </button>
          </div>
        )}
        {!error && drivers === null && <p className="mt-2 text-gray-500">{t('loading')}</p>}
        {!error && drivers !== null && drivers.length === 0 && <p className="mt-2 text-gray-500">{t('drvEmpty')}</p>}
        {!error && drivers !== null && drivers.length > 0 && (
          <ul className="mt-2 divide-y rounded border bg-white">
            {drivers.map((d) => {
              const saved = d.vehicleTypeId ?? '';
              const draft = vehicleDraftById[d.id];
              const picked = draft ?? saved;
              const savedIsInactive = d.vehicleTypeId !== null && vehicleTypes !== null && !vehicleTypes.some((v) => v.id === d.vehicleTypeId);
              const result = vehicleResultById[d.id];
              return (
                <li key={d.id} data-testid={`driver-row-${d.id}`} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{d.fullName}</p>
                      <p className="text-xs text-gray-500">
                        <span dir="ltr">{d.phone}</span>
                        <span data-testid="driver-vehicle-name">{d.vehicleTypeName ? ` · ${d.vehicleTypeName}` : ` · ${t('drvNoVehicle')}`}</span>
                        {d.lastLocationAt
                          ? ` · ${t('drvLocationUpdated', { time: new Date(d.lastLocationAt).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB') })}`
                          : ''}
                      </p>
                      {d.activeDelivery && (
                        <p className="text-xs" data-testid="driver-active-delivery">
                          {t('drvOnOrder')}{' '}
                          <a href={`/order-search/${d.activeDelivery.orderId}`} className="font-medium text-hatly-orange underline" dir="ltr">
                            {d.activeDelivery.orderNumber}
                          </a>{' '}
                          ({d.activeDelivery.status.replace(/_/g, ' ')})
                        </p>
                      )}
                      {verifyErrorById[d.id] && <p className="mt-1 text-xs text-red-600">{verifyErrorById[d.id]}</p>}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                      <span className={`rounded px-2 py-0.5 ${d.isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                        {d.isOnline ? t('drvOnline') : t('drvOffline')}
                      </span>
                      <span className={`rounded px-2 py-0.5 ${d.isAvailable ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'}`}>
                        {d.isAvailable ? t('drvFree') : d.activeDelivery ? t('drvOnDelivery') : t('drvUnavailable')}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 ${
                          d.verificationStatus === 'APPROVED'
                            ? 'bg-green-100 text-green-700'
                            : d.verificationStatus === 'REJECTED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {d.verificationStatus}
                      </span>
                      {d.verificationStatus !== 'APPROVED' && (
                        <button
                          onClick={() => handleSetVerification(d, 'APPROVED')}
                          disabled={verifyingDriverId === d.id}
                          className="rounded bg-green-600 px-2 py-1 font-medium text-white disabled:opacity-50"
                        >
                          {t('drvApprove')}
                        </button>
                      )}
                      {d.verificationStatus !== 'REJECTED' && (
                        <button
                          onClick={() => handleSetVerification(d, 'REJECTED')}
                          disabled={verifyingDriverId === d.id}
                          className="rounded bg-gray-200 px-2 py-1 font-medium text-gray-700 disabled:opacity-50"
                        >
                          {t('drvReject')}
                        </button>
                      )}
                    </div>
                  </div>

                  {vehicleTypes !== null && (
                    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="driver-vehicle">
                      <label htmlFor={`vehicle-${d.id}`} className="font-medium">
                        {t('drvVehicleLabel')}
                      </label>
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
                        className="rounded border px-2 py-1"
                      >
                        <option value="">{t('drvVehicleNone')}</option>
                        {savedIsInactive && (
                          <option value={saved} disabled>
                            {t('drvVehicleInactive', { name: d.vehicleTypeName ?? saved })}
                          </option>
                        )}
                        {vehicleTypes.map((v) => (
                          <option key={v.id} value={v.id}>
                            {vehicleName(v)}
                          </option>
                        ))}
                      </select>
                      <button
                        data-testid="driver-vehicle-save"
                        onClick={() => handleSaveVehicle(d)}
                        disabled={draft === undefined || savingVehicleId !== null}
                        className="rounded border px-2 py-1 font-medium disabled:opacity-40"
                      >
                        {savingVehicleId === d.id ? t('drvVehicleSaving') : t('drvVehicleSave')}
                      </button>
                      {result && (
                        <span role="status" data-testid="driver-vehicle-result" className={result.ok ? 'text-green-700' : 'text-red-600'}>
                          {result.message}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-500">{t('drvVehicleHelp')}</p>
      </div>
    </div>
  );
}
