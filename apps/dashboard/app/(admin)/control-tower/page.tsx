'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  CONTROL_TOWER_STAGES,
  ControlTowerDeliveryRow,
  ControlTowerStage,
  ControlTowerSummary,
  DispatchDriver,
  Paged,
  getControlTowerSummary,
  listControlTowerDeliveries,
  listDispatchDrivers,
} from '../../../lib/api/admin-control-tower';
import { DispatchAlert, listDispatchAlerts } from '../../../lib/api/admin-dispatch';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { deliveryAddressText } from '../../../lib/delivery-address';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { MessageKey } from '../../../lib/i18n/messages';
import { LocaleToggle } from '../../../components/orders/LocaleToggle';
import { DispatchAction } from '../../../components/operations/DispatchAction';

const PAGE_SIZE = 20;
const ASSIGN_REASSIGN_ORDERS = 'ASSIGN_REASSIGN_ORDERS';

/**
 * Admin Control Tower — the operational view of active orders and deliveries. Everything shown comes from the existing
 * domain through read-only endpoints (`admin/control-tower/*`, `admin/dispatch-alerts`); the only actions are the existing
 * assign / reassign operations, gated by ASSIGN_REASSIGN_ORDERS on the backend. No polling: data is reloaded on entry, on
 * "Refresh" and after every action, and always re-read from the backend (never an optimistic local change).
 */
export default function ControlTowerPage() {
  return (
    <I18nProvider>
      <ControlTowerScreen />
    </I18nProvider>
  );
}

function since(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const at = new Date(iso);
  const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  const time = at.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return locale === 'ar' ? `${time} (منذ ${minutes} د)` : `${time} (${minutes} min ago)`;
}

function ControlTowerScreen() {
  const { t, locale } = useI18n();
  const canAssign = useAdminPermission(ASSIGN_REASSIGN_ORDERS);

  const [summary, setSummary] = useState<ControlTowerSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [stage, setStage] = useState<ControlTowerStage>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [releasedOnly, setReleasedOnly] = useState(false);
  const [deliveries, setDeliveries] = useState<Paged<ControlTowerDeliveryRow> | null>(null);
  const [deliveriesError, setDeliveriesError] = useState<string | null>(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const deliveriesRequest = useRef(0);

  const [drivers, setDrivers] = useState<DispatchDriver[] | null>(null);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<DispatchAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsOpenOnly, setAlertsOpenOnly] = useState(true);

  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const loadSummary = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummary(await getControlTowerSummary());
    } catch (err) {
      setSummaryError(apiErrorMessage(err, t('ctLoadFailed')));
    }
  }, [t]);

  const loadDeliveries = useCallback(async () => {
    const ticket = ++deliveriesRequest.current;
    setLoadingDeliveries(true);
    setDeliveriesError(null);
    try {
      const result = await listControlTowerDeliveries({ stage, search: search || undefined, releasedOnly, page, limit: PAGE_SIZE });
      if (ticket === deliveriesRequest.current) setDeliveries(result);
    } catch (err) {
      if (ticket === deliveriesRequest.current) setDeliveriesError(apiErrorMessage(err, t('ctLoadFailed')));
    } finally {
      if (ticket === deliveriesRequest.current) setLoadingDeliveries(false);
    }
  }, [stage, search, releasedOnly, page, t]);

  const loadDispatchData = useCallback(async () => {
    if (canAssign !== true) return;
    setDriversError(null);
    setAlertsError(null);
    const [driversResult, alertsResult] = await Promise.allSettled([listDispatchDrivers(), listDispatchAlerts(alertsOpenOnly)]);
    if (driversResult.status === 'fulfilled') setDrivers(driversResult.value);
    else setDriversError(apiErrorMessage(driversResult.reason, t('dxDriversFailed')));
    if (alertsResult.status === 'fulfilled') setAlerts(alertsResult.value);
    else setAlertsError(apiErrorMessage(alertsResult.reason, t('ctAlertsLoadFailed')));
  }, [canAssign, alertsOpenOnly, t]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);
  useEffect(() => {
    loadDispatchData();
  }, [loadDispatchData]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadDeliveries(), loadDispatchData()]);
  }, [loadSummary, loadDeliveries, loadDispatchData]);

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  const pages = deliveries ? Math.max(1, Math.ceil(deliveries.meta.total / deliveries.meta.limit)) : 1;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('ctTitle')}</h1>
        <div className="flex items-center gap-3">
          {summary && (
            <span data-testid="ct-updated" className="text-xs text-gray-500">
              {t('ctUpdatedAt', { time: new Date(summary.generatedAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB') })}
            </span>
          )}
          <button data-testid="ct-refresh" onClick={refreshAll} className="rounded border px-3 py-1 text-sm">
            {t('ctRefresh')}
          </button>
          <LocaleToggle />
        </div>
      </div>

      {flash && (
        <div
          role="status"
          data-testid="ct-flash"
          className={`rounded border p-3 text-sm ${flash.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          {flash.message}
        </div>
      )}

      {/* ---- summary ---- */}
      {summaryError && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {summaryError}{' '}
          <button onClick={loadSummary} className="underline">
            {t('retry')}
          </button>
        </div>
      )}
      {!summaryError && !summary && <p className="text-gray-500">{t('loading')}</p>}
      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded border bg-white p-4 md:col-span-2" data-testid="ct-attention">
            <h2 className="font-medium">{t('ctNeedsAttention')}</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li data-testid="ct-awaiting">
                <button className="hover:underline" onClick={() => { setStage('AWAITING_ASSIGNMENT'); setReleasedOnly(false); setPage(1); }}>
                  <b>{summary.attention.awaitingAssignment}</b> {t('ctAwaitingAssignment')}
                </button>
                <span className="ms-2 text-gray-500">
                  ({summary.attention.awaitingWithOpenNoDriverAlert} {t('ctAwaitingWithAlert')} · {summary.attention.awaitingWithoutAlert}{' '}
                  {t('ctAwaitingWithoutAlert')})
                </span>
                {summary.attention.awaitingWithoutAlert > 0 && <p className="text-xs text-gray-500">{t('ctAwaitingWithoutAlertHelp')}</p>}
              </li>
              <li data-testid="ct-released">
                <button
                  className={`hover:underline ${summary.attention.releasedAwaitingManualAssignment > 0 ? 'font-medium text-red-700' : ''}`}
                  onClick={() => {
                    setStage('AWAITING_ASSIGNMENT');
                    setReleasedOnly(true);
                    setPage(1);
                  }}
                >
                  <b>{summary.attention.releasedAwaitingManualAssignment}</b> {t('ctReleasedAwaitingManual')}
                </button>
                {summary.attention.releasedAwaitingManualAssignment > 0 && (
                  <p className="text-xs text-red-700">{t('ctReleasedAwaitingManualHelp')}</p>
                )}
              </li>
              <li data-testid="ct-past-deadline">
                <b>{summary.attention.assignedPastAcceptDeadline}</b> {t('ctPastDeadline')}
              </li>
              <li data-testid="ct-failed">
                <Link href="/failed-deliveries" className="hover:underline">
                  <b>{summary.attention.failedDeliveriesUnresolved}</b> {t('ctFailedUnresolved')}
                </Link>
              </li>
              <li data-testid="ct-pickup-ready">
                <Link href="/order-search?status=READY_FOR_PICKUP&fulfillmentType=PICKUP" className="hover:underline">
                  <b>{summary.attention.readyForCustomerPickup}</b> {t('ctReadyForCustomerPickup')}
                </Link>
              </li>
              <li data-testid="ct-auto-dispatch">
                {t('ctAutoDispatch')}:{' '}
                <span className={summary.automaticDispatchEnabled ? 'text-green-700' : 'font-medium text-amber-800'}>
                  {summary.automaticDispatchEnabled ? t('ctOn') : t('ctOff')}
                </span>
              </li>
            </ul>
          </section>

          {summary.drivers && (
            <section className="rounded border bg-white p-4" data-testid="ct-drivers">
              <h2 className="font-medium">
                <Link href="/drivers" className="hover:underline">
                  {t('ctDrivers')}: {summary.drivers.approved}
                </Link>
              </h2>
              <ul className="mt-2 space-y-1 text-sm">
                <li>{t('ctDriversAvailable')}: <b>{summary.drivers.onlineAndAvailable}</b></li>
                <li>{t('ctDriversBusy')}: <b>{summary.drivers.onlineBusy}</b></li>
                <li>{t('ctDriversOffline')}: <b>{summary.drivers.offline}</b></li>
                <li>{t('ctDriversPending')}: <b>{summary.drivers.pendingVerification}</b></li>
              </ul>
            </section>
          )}

          <section className="rounded border bg-white p-4 md:col-span-3" data-testid="ct-by-status">
            <h2 className="font-medium">{t('ctActiveOrders')}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {Object.entries(summary.ordersByStatus).map(([status, count]) => (
                <Link
                  key={status}
                  href={`/order-search?status=${status}`}
                  className="rounded border px-2 py-1 hover:bg-gray-50"
                  data-testid={`ct-status-${status}`}
                >
                  {status.replace(/_/g, ' ')}: <b>{count}</b>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ---- deliveries ---- */}
      <section className="rounded border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <h2 className="font-medium">{t('ctDeliveries')}</h2>
          <div role="tablist" className="flex flex-wrap gap-1 text-sm">
            {CONTROL_TOWER_STAGES.map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={stage === s}
                data-testid={`ct-stage-${s}`}
                onClick={() => {
                  setStage(s);
                  setReleasedOnly(false);
                  setPage(1);
                }}
                className={`rounded px-2 py-1 ${stage === s ? 'bg-hatly-orange text-white' : 'border'}`}
              >
                {t(`ctStage${s}` as MessageKey)}
              </button>
            ))}
          </div>
          <form onSubmit={applySearch} className="flex gap-1">
            <input
              data-testid="ct-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('ctSearchPlaceholder')}
              className="w-64 rounded border px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded border px-2 py-1 text-sm">
              {t('ctSearch')}
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setSearch('');
                  setPage(1);
                }}
                className="text-sm underline"
              >
                {t('ctClear')}
              </button>
            )}
          </form>
        </div>

        {releasedOnly && (
          <div className="flex items-center gap-2 border-b bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="ct-released-filter">
            {t('ctReleasedFilter')}
            <button
              onClick={() => {
                setReleasedOnly(false);
                setPage(1);
              }}
              className="underline"
            >
              {t('ctClear')}
            </button>
          </div>
        )}
        {deliveriesError && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {deliveriesError}{' '}
            <button onClick={loadDeliveries} className="underline">
              {t('retry')}
            </button>
          </div>
        )}
        {!deliveriesError && deliveries === null && <p className="p-3 text-gray-500">{t('loading')}</p>}
        {deliveries && deliveries.data.length === 0 && !deliveriesError && (
          <p data-testid="ct-empty" className="p-3 text-sm text-gray-500">
            {search ? t('ctEmptySearch') : t('ctEmpty')}
          </p>
        )}
        {driversError && canAssign && <p className="px-3 pt-2 text-xs text-red-600">{driversError}</p>}
        {deliveries && deliveries.data.length > 0 && (
          <div className={`overflow-x-auto ${loadingDeliveries ? 'opacity-60' : ''}`} aria-busy={loadingDeliveries}>
            <table className="w-full text-start text-sm" data-testid="ct-table">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-start">{t('ctColOrder')}</th>
                  <th className="px-3 py-2 text-start">{t('ctColStatus')}</th>
                  <th className="px-3 py-2 text-start">{t('ctColArea')}</th>
                  <th className="px-3 py-2 text-start">{t('ctColDriver')}</th>
                  <th className="px-3 py-2 text-start">{t('ctColFlags')}</th>
                  {canAssign && <th className="px-3 py-2 text-start">{t('ctColAction')}</th>}
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((row) => (
                  <tr key={row.orderId} data-testid={`ct-row-${row.orderNumber}`} className="border-b align-top last:border-0">
                    <td className="px-3 py-2">
                      <Link href={`/order-search/${row.orderId}`} className="font-medium text-hatly-orange hover:underline" dir="ltr">
                        {row.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span data-testid="ct-row-status">{row.status.replace(/_/g, ' ')}</span>
                      <div className="text-xs text-gray-500">
                        {t('ctColSince')}: {since(row.statusSince, locale)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.deliveryAddress ? deliveryAddressText(row.deliveryAddress, locale) : '—'}</td>
                    <td className="px-3 py-2" data-testid="ct-row-driver">
                      {row.driver ? (
                        <>
                          {row.driver.fullName}
                          <div className="text-xs text-gray-500" dir="ltr">
                            {row.driver.phone}
                          </div>
                        </>
                      ) : (
                        <span className="text-gray-500">{t('ctNoDriver')}</span>
                      )}
                    </td>
                    <td className="space-y-1 px-3 py-2 text-xs">
                      {row.released && (
                        <span
                          className={`block rounded px-1 ${row.openDispatchAlert ? 'bg-amber-100 text-amber-900' : 'bg-red-100 font-medium text-red-800'}`}
                          data-testid="ct-flag-released"
                        >
                          {t(row.released.byRole === 'DRIVER' ? 'ctFlagReleasedByDriver' : 'ctFlagReleasedBySystem', {
                            time: since(row.released.at, locale),
                          })}
                        </span>
                      )}
                      {row.openDispatchAlert && (
                        <span className="block rounded bg-amber-100 px-1 text-amber-900" data-testid="ct-flag-alert">
                          {t('ctFlagAlert', { time: since(row.openDispatchAlert.createdAt, locale) })}
                        </span>
                      )}
                      {row.acceptDeadlinePassed && (
                        <span className="block rounded bg-amber-100 px-1 text-amber-900" data-testid="ct-flag-deadline">
                          {t('ctFlagDeadline')}
                        </span>
                      )}
                      {row.reassignmentCount > 0 && (
                        <span className="block text-gray-600" data-testid="ct-flag-reassigned">
                          {t('ctFlagReassigned', { count: row.reassignmentCount })}
                        </span>
                      )}
                      {row.hasPendingHatlyServicePricing && <span className="block text-gray-600">{t('ctFlagPendingPrice')}</span>}
                    </td>
                    {canAssign && (
                      <td className="min-w-[16rem] px-3 py-2">
                        {drivers && (
                          <DispatchAction
                            orderId={row.orderId}
                            orderNumber={row.orderNumber}
                            status={row.status}
                            currentDriver={row.driver}
                            drivers={drivers}
                            onChanged={(outcome) => {
                              setFlash(outcome);
                              refreshAll();
                            }}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deliveries && deliveries.meta.total > 0 && (
          <div className="flex items-center justify-between border-t p-3 text-sm">
            <span data-testid="ct-page">{t('ctPageOf', { page: deliveries.meta.page, pages, total: deliveries.meta.total })}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1 || loadingDeliveries} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">
                {t('listPrevious')}
              </button>
              <button disabled={page >= pages || loadingDeliveries} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">
                {t('listNext')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---- dispatch alerts (dispatchers only — same permission as the endpoint) ---- */}
      {canAssign && (
        <section className="rounded border bg-white p-4" data-testid="ct-alerts">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('ctAlerts')}</h2>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={alertsOpenOnly} onChange={(e) => setAlertsOpenOnly(e.target.checked)} />
              {t('ctAlertsOpenOnly')}
            </label>
          </div>
          {alertsError && <p className="mt-2 text-sm text-red-600">{alertsError}</p>}
          {!alertsError && alerts === null && <p className="mt-2 text-sm text-gray-500">{t('loading')}</p>}
          {!alertsError && alerts !== null && alerts.length === 0 && (
            <p className="mt-2 text-sm text-gray-500" data-testid="ct-alerts-empty">
              {alertsOpenOnly ? t('ctAlertsNone') : t('ctAlertsNoneAll')}
            </p>
          )}
          {alerts && alerts.length > 0 && (
            <ul className="mt-2 divide-y text-sm">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2" data-testid={`ct-alert-${a.id}`}>
                  <span>
                    <Link href={`/order-search/${a.orderId}`} className="font-medium text-hatly-orange hover:underline" dir="ltr">
                      {a.orderNumber ?? a.orderId.slice(0, 8)}
                    </Link>{' '}
                    — {t('ctAlertNoEligible')} · {since(a.createdAt, locale)}
                    {a.orderStatus && <span className="ms-1 text-xs text-gray-500">({a.orderStatus.replace(/_/g, ' ')})</span>}
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs ${a.resolvedAt ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                    {a.resolvedAt ? t('ctAlertResolved') : t('ctAlertOpen')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
