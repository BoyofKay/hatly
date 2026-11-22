'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { DispatchAlert, assignDriver, listDispatchAlerts } from '../../../lib/api/admin-dispatch';
import { fetchAdminChanges } from '../../../lib/api/changes';
import { useChangeFeed } from '../../../lib/changes/use-change-feed';
import { Badge, Button, Card, ConfirmDialog, KpiCard, Modal, PageHeader, StatusPill } from '../../../components/ui';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { useIsMobile, useMediaQuery } from '../../../lib/ui/use-media-query';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useAdminPermission } from '../../../lib/auth/use-admin-permission';
import { deliveryAddressText } from '../../../lib/delivery-address';
import { I18nProvider, useI18n } from '../../../lib/i18n/i18n';
import { MessageKey } from '../../../lib/i18n/messages';
import { DispatchAction } from '../../../components/operations/DispatchAction';
import { OperationsFactsCard } from '../../../components/operations/OperationsFactsCard';

const PAGE_SIZE = 20;
const COMPACT_PAGE_SIZE = 10;
const ALERTS_SHOWN = 8;
const ASSIGN_REASSIGN_ORDERS = 'ASSIGN_REASSIGN_ORDERS';
const VIEWS_KEY = 'hatly_ct_views_v1';

interface SavedView {
  name: string;
  stage: ControlTowerStage;
  search: string;
  releasedOnly: boolean;
}

/**
 * Operations Command Center (the Control Tower). Everything shown comes from the existing domain through read-only endpoints
 * (`admin/control-tower/*`, `admin/dispatch-alerts`); the only writes are the existing assign / reassign operations, gated by
 * ASSIGN_REASSIGN_ORDERS on the backend, which stays the single authority (the screen never pre-filters by a client-side rule).
 * Live: the page reloads when the change feed (D-72) reports an order change, falling back to a timed reload by itself; "Refresh" and
 * every action always re-read the backend (never an optimistic local change).
 * Command-center extras (all client-side conveniences, none changes a rule): saved views (this browser), keyboard shortcuts, a details
 * panel per order, a CSV export of the visible rows (no customer data), and a selected-orders "assign" that is only offered while
 * automatic dispatch is OFF and only for orders waiting for a driver — each order is still assigned by the same backend endpoint.
 */
/**
 * Who released an order (back to "waiting for a driver"). R17 (2026-11-06): only Operations release now. Older rows may still show a
 * driver hand-back (DRIVER) or the former automatic accept-window release (recorded as ADMIN by the system — indistinguishable from an
 * Operations release after the fact, so any admin role reads as Operations).
 */
function releasedKey(released: { byRole: string | null }): 'ctFlagReleasedByDriver' | 'ctFlagReleasedByOperations' {
  return released.byRole === 'DRIVER' ? 'ctFlagReleasedByDriver' : 'ctFlagReleasedByOperations';
}

export default function ControlTowerPage() {
  // This is where every admin lands after sign-in. An admin whose role has no order permission has nothing to run here: send them to the
  // overview, which lists the areas they can open.
  const perms = usePermissions();
  const router = useRouter();
  const denied = perms.loaded && !perms.failed && !perms.can('VIEW_ORDERS');
  useEffect(() => { if (denied) router.replace('/executive'); }, [denied, router]);
  if (!perms.loaded || denied) return <div aria-busy="true" className="h-24 animate-pulse rounded-xl bg-gray-100" />;
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
  // Under two hours in minutes, under two days in hours, then days — "22825 min ago" is unreadable.
  if (minutes < 120) return locale === 'ar' ? `${time} (منذ ${minutes} د)` : `${time} (${minutes} min ago)`;
  if (minutes < 2880) { const h = Math.round(minutes / 60); return locale === 'ar' ? `${time} (منذ ${h} س)` : `${time} (${h} h ago)`; }
  const d = Math.round(minutes / 1440);
  return locale === 'ar' ? `${at.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })} (منذ ${d} يوم)` : `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (${d} d ago)`;
}

/** A cell value that spreadsheet software could execute as a formula is neutralised before it goes into a CSV. */
function csvCell(v: unknown): string {
  let text = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function readViews(): SavedView[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(VIEWS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((v) => v && typeof v.name === 'string').slice(0, 20) : [];
  } catch {
    return [];
  }
}

function ControlTowerScreen() {
  const { t, locale } = useI18n();
  const tt = useLang().t;
  const isMobile = useIsMobile();
  // Phones AND tablets read the orders as cards (the 8-column table needs a desktop-width screen); the summary layouts differ at the phone breakpoint.
  const isCompact = useMediaQuery('(max-width: 1023px)');
  const pageSize = isCompact ? COMPACT_PAGE_SIZE : PAGE_SIZE;
  const [alertsAll, setAlertsAll] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const searchRef = useRef<HTMLInputElement>(null);

  const [drivers, setDrivers] = useState<DispatchDriver[] | null>(null);
  const [driversError, setDriversError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<DispatchAlert[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsOpenOnly, setAlertsOpenOnly] = useState(true);

  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [panel, setPanel] = useState<ControlTowerDeliveryRow | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDriver, setBulkDriver] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => setViews(readViews()), []);

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
      const result = await listControlTowerDeliveries({ stage, search: search || undefined, releasedOnly, page, limit: pageSize });
      if (ticket === deliveriesRequest.current) setDeliveries(result);
    } catch (err) {
      if (ticket === deliveriesRequest.current) setDeliveriesError(apiErrorMessage(err, t('ctLoadFailed')));
    } finally {
      if (ticket === deliveriesRequest.current) setLoadingDeliveries(false);
    }
  }, [stage, search, releasedOnly, page, pageSize, t]);

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
    setSelected(new Set());
  }, [loadSummary, loadDeliveries, loadDispatchData]);

  // Live updates (D-72): reload when an order changed; the hook falls back to a timed reload on its own if the feed is unavailable.
  const liveMode = useChangeFeed((since_) => fetchAdminChanges('orders', since_), refreshAll);

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  // Keyboard shortcuts (ignored while typing in a field).
  const shortcutRef = useRef({ refreshAll, setHelpOpen });
  shortcutRef.current = { refreshAll, setHelpOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'r') void shortcutRef.current.refreshAll();
      else if (e.key === '?') shortcutRef.current.setHelpOpen(true);
      else if (e.key === 'Escape') setPanel(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function saveView() {
    const name = viewName.trim().slice(0, 40);
    if (!name) return;
    const next = [{ name, stage, search, releasedOnly }, ...views.filter((v) => v.name !== name)].slice(0, 20);
    setViews(next);
    try {
      window.localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
    setSaveOpen(false);
    setViewName('');
  }
  function applyView(name: string) {
    const v = views.find((x) => x.name === name);
    if (!v) return;
    setStage(v.stage);
    setSearch(v.search);
    setSearchInput(v.search);
    setReleasedOnly(v.releasedOnly);
    setPage(1);
  }
  function deleteView(name: string) {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    try {
      window.localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* not remembered */
    }
  }

  function exportCsv() {
    if (!deliveries) return;
    const lines = [['order', 'status', 'status_since', 'area', 'driver', 'flags'].map(csvCell).join(',')];
    for (const r of deliveries.data) {
      const flags = [r.released ? 'released' : '', r.openDispatchAlert ? 'dispatch-alert' : '', r.acceptDeadlinePassed ? 'past-deadline' : '', r.reassignmentCount > 0 ? `reassigned-${r.reassignmentCount}` : ''].filter(Boolean).join(' ');
      lines.push([r.orderNumber, r.status, r.statusSince ?? '', r.deliveryAddress ? deliveryAddressText(r.deliveryAddress, 'en') : '', r.driver?.fullName ?? '', flags].map(csvCell).join(','));
    }
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `control-tower-${stage.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const bulkEnabled = canAssign === true && summary !== null && !summary.automaticDispatchEnabled;
  const selectable = useMemo(() => (bulkEnabled && deliveries ? deliveries.data.filter((r) => r.status === 'READY_FOR_PICKUP') : []), [bulkEnabled, deliveries]);
  async function runBulk() {
    setBulkBusy(true);
    const failures: string[] = [];
    let done = 0;
    for (const id of selected) {
      try {
        await assignDriver(id, bulkDriver);
        done++;
      } catch (err) {
        failures.push(`${deliveries?.data.find((r) => r.orderId === id)?.orderNumber ?? id.slice(0, 8)}: ${apiErrorMessage(err, tt('refused', 'مرفوض'))}`);
      }
    }
    setBulkBusy(false);
    setBulkConfirm(false);
    setFlash({ ok: failures.length === 0, message: failures.length === 0 ? tt(`${done} order(s) assigned.`, `تم إسناد ${done} طلب.`) : tt(`${done} assigned, ${failures.length} refused by the backend — ${failures.join('; ')}`, `تم إسناد ${done}، ورفض الخادم ${failures.length} — ${failures.join('؛ ')}`) });
    setBulkDriver('');
    await refreshAll();
  }

  const pages = deliveries ? Math.max(1, Math.ceil(deliveries.meta.total / deliveries.meta.limit)) : 1;
  const at = summary?.attention;
  const hot = (n: number) => (n > 0 ? 'bad' : 'neutral') as 'bad' | 'neutral';
  const canAct = (r: ControlTowerDeliveryRow) => r.status === 'READY_FOR_PICKUP' || r.status === 'ASSIGNED_TO_DRIVER';
  const actionLabel = (r: ControlTowerDeliveryRow) => (r.status === 'ASSIGNED_TO_DRIVER' ? tt('Reassign driver', 'إعادة إسناد السائق') : tt('Assign a driver', 'إسناد سائق'));

  // The urgent items, most urgent first, as tappable rows (phone) — the same counts and filters as the desktop "Needs attention" list.
  const urgent = at
    ? [
        { id: 'released', n: at.releasedAwaitingManualAssignment, label: t('ctReleasedAwaitingManual'), tone: 'red', go: () => { setStage('AWAITING_ASSIGNMENT'); setReleasedOnly(true); setPage(1); } },
        { id: 'awaiting', n: at.awaitingAssignment, label: t('ctAwaitingAssignment'), tone: 'amber', go: () => { setStage('AWAITING_ASSIGNMENT'); setReleasedOnly(false); setPage(1); } },
        { id: 'deadline', n: at.assignedPastAcceptDeadline, label: t('ctPastDeadline'), tone: 'amber', go: undefined },
        { id: 'failed', n: at.failedDeliveriesUnresolved, label: t('ctFailedUnresolved'), tone: 'red', href: '/failed-deliveries' },
        { id: 'pickup', n: at.readyForCustomerPickup, label: t('ctReadyForCustomerPickup'), tone: 'blue', href: '/order-management?view=readyPickup' },
      ]
    : [];
  const toneCls: Record<string, string> = { red: 'bg-red-600 text-white', amber: 'bg-amber-500 text-white', blue: 'bg-blue-600 text-white', gray: 'bg-gray-300 text-gray-800' };

  const fleetLine = summary?.drivers && (
    <Link href="/drivers" data-testid="ct-drivers" className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm shadow-sm">
      <span className="font-medium">{tt('Drivers', 'السائقون')}</span>
      <span className="flex items-center gap-3 text-xs text-gray-600">
        <span><b className="text-green-700">{summary.drivers.onlineAndAvailable}</b> {tt('free', 'متاح')}</span>
        <span><b>{summary.drivers.onlineBusy}</b> {tt('busy', 'مشغول')}</span>
        <span><b>{summary.drivers.offline}</b> {tt('offline', 'غير متصل')}</span>
      </span>
    </Link>
  );

  const flagChips = (row: ControlTowerDeliveryRow) => (
    <>
      {row.released && (
        <span className={`block rounded-md px-1.5 py-0.5 ${row.openDispatchAlert ? 'bg-amber-100 text-amber-900' : 'bg-red-100 font-medium text-red-800'}`} data-testid="ct-flag-released">
          {t(releasedKey(row.released), { time: since(row.released.at, locale) })}
        </span>
      )}
      {row.openDispatchAlert && <span className="block rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900" data-testid="ct-flag-alert">{t('ctFlagAlert', { time: since(row.openDispatchAlert.createdAt, locale) })}</span>}
      {row.acceptDeadlinePassed && <span className="block rounded-md bg-amber-100 px-1.5 py-0.5 text-amber-900" data-testid="ct-flag-deadline">{t('ctFlagDeadline')}</span>}
      {row.reassignmentCount > 0 && <span className="block text-gray-600" data-testid="ct-flag-reassigned">{t('ctFlagReassigned', { count: row.reassignmentCount })}</span>}
      {row.hasPendingHatlyServicePricing && <span className="block text-gray-600">{t('ctFlagPendingPrice')}</span>}
    </>
  );

  const tabs = (
    <div role="tablist" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-sm md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
      {CONTROL_TOWER_STAGES.map((s) => (
        <button
          key={s}
          role="tab"
          aria-selected={stage === s}
          data-testid={`ct-stage-${s}`}
          onClick={() => { setStage(s); setReleasedOnly(false); setPage(1); }}
          className={`min-h-[40px] shrink-0 rounded-lg px-3 font-medium md:min-h-0 md:px-2.5 md:py-1 ${stage === s ? 'bg-hatly-orange text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          {t(`ctStage${s}` as MessageKey)}
        </button>
      ))}
    </div>
  );

  const searchForm = (
    <form onSubmit={applySearch} className="flex w-full flex-wrap gap-1.5 md:w-auto">
      <input
        ref={searchRef}
        data-testid="ct-search"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder={t('ctSearchPlaceholder')}
        className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-base focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 md:min-h-0 md:w-64 md:flex-none md:px-2.5 md:py-1.5 md:text-sm"
      />
      <Button type="submit" className="min-h-[44px] md:min-h-0">{t('ctSearch')}</Button>
      {search && <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-0" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>{t('ctClear')}</Button>}
    </form>
  );

  const toolsBar = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-gray-600">
        {tt('Saved views', 'العروض المحفوظة')}
        <select className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-1.5 md:min-h-0 md:py-1" value="" onChange={(e) => applyView(e.target.value)} aria-label={tt('Saved views', 'العروض المحفوظة')}>
          <option value="">{views.length ? tt('Choose…', 'اختر…') : tt('None yet', 'لا يوجد بعد')}</option>
          {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
      </label>
      <Button size="sm" className="min-h-[40px] md:min-h-0" onClick={() => setSaveOpen(true)}>{tt('Save this view', 'حفظ هذا العرض')}</Button>
      {views.length > 0 && <span className="flex flex-wrap gap-1">{views.slice(0, 5).map((v) => <Badge key={v.name}>{v.name} <button className="ms-1 px-1 text-gray-500 hover:text-red-700" aria-label={tt(`Delete view ${v.name}`, `حذف العرض ${v.name}`)} onClick={() => deleteView(v.name)}>×</button></Badge>)}</span>}
      <span className="ms-auto" />
      <Button size="sm" className="min-h-[40px] md:min-h-0" onClick={exportCsv} disabled={!deliveries || deliveries.data.length === 0}>{tt('Export visible rows (CSV)', 'تصدير الصفوف الظاهرة (CSV)')}</Button>
    </div>
  );

  const bulkBar = bulkEnabled && selectable.length > 0 && (
    <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-amber-50/60 px-3 py-2 text-sm" data-testid="ct-bulk">
      <span className="w-full text-amber-900 md:w-auto">{tt('Automatic dispatch is OFF — you can assign several waiting orders at once.', 'التوزيع التلقائي متوقف — يمكنك إسناد عدة طلبات منتظرة دفعة واحدة.')}</span>
      <select value={bulkDriver} onChange={(e) => setBulkDriver(e.target.value)} className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 md:min-h-0 md:flex-none md:py-1" aria-label={tt('Driver for the selected orders', 'السائق للطلبات المحددة')}>
        <option value="">{tt('Driver…', 'السائق…')}</option>
        {(drivers ?? []).map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
      </select>
      <Button data-testid="ct-bulk-assign" variant="primary" size="sm" className="min-h-[44px] md:min-h-0" disabled={selected.size === 0 || !bulkDriver} onClick={() => setBulkConfirm(true)}>
        {tt(`Assign ${selected.size} selected`, `إسناد ${selected.size} محدد`)}
      </Button>
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-5">
      <PageHeader
        title={t('ctTitle')}
        subtitle={isMobile ? undefined : tt('One place to see what needs a person right now: orders waiting for a driver, released or late, failed deliveries, and the fleet. Press ? for shortcuts.', 'مكان واحد لما يحتاج إلى شخص الآن: الطلبات التي تنتظر سائقًا أو أُعيدت أو تأخرت، والتوصيلات الفاشلة، والأسطول. اضغط ? للاختصارات.')}
        actions={
          <>
            {summary && (
              <span data-testid="ct-updated" className="text-xs text-gray-500">
                {t('ctUpdatedAt', { time: new Date(summary.generatedAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB') })}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-xs ${liveMode === 'feed' ? 'text-green-700' : 'text-gray-500'}`} data-testid="ct-live" title={liveMode === 'feed' ? tt('Updates as orders change', 'يتحدث عند تغيّر الطلبات') : tt('Refreshing every 20 seconds', 'يتحدث كل 20 ثانية')}>
              <span className={`h-2 w-2 rounded-full ${liveMode === 'feed' ? 'bg-green-500' : 'bg-gray-400'}`} aria-hidden />
              {liveMode === 'feed' ? tt('Live', 'مباشر') : tt('Timed refresh', 'تحديث دوري')}
            </span>
            <Button data-testid="ct-refresh" className="min-h-[40px] md:min-h-0" onClick={refreshAll}>{t('ctRefresh')}</Button>
            {!isMobile && <Button variant="ghost" onClick={() => setHelpOpen(true)} aria-label={tt('Keyboard shortcuts', 'اختصارات لوحة المفاتيح')}>?</Button>}
          </>
        }
      />
      {flash && (
        <div role="status" data-testid="ct-flash" className={`rounded-xl border p-3 text-sm ${flash.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {flash.message}
        </div>
      )}

      {summaryError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {summaryError}{' '}
          <button onClick={loadSummary} className="font-medium underline">{t('retry')}</button>
        </div>
      )}
      {!summaryError && !summary && <p className="text-gray-500">{t('loading')}</p>}

      {summary && at && isMobile && (
        <>
          {/* PHONE: urgent items first, as large tappable rows; the fleet in one line; everything else folded away. */}
          <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" data-testid="ct-attention">
            <h2 className="mb-2 text-sm font-semibold text-gray-900">{t('ctNeedsAttention')}</h2>
            <ul className="divide-y divide-gray-100" data-testid="ct-urgent">
              {urgent.map((u) => {
                const inner = (
                  <>
                    <span className={`inline-flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums ${u.n > 0 ? toneCls[u.tone] : toneCls.gray}`}>{u.n}</span>
                    <span className="min-w-0 flex-1 text-sm text-gray-900">{u.label}</span>
                    {(u.go || u.href) && <span aria-hidden className="text-gray-400 rtl:rotate-180">›</span>}
                  </>
                );
                const cls = 'flex min-h-[52px] w-full items-center gap-3 py-2 text-start';
                const tid = u.id === 'awaiting' ? 'ct-awaiting' : u.id === 'released' ? 'ct-released' : u.id === 'deadline' ? 'ct-past-deadline' : u.id === 'failed' ? 'ct-failed' : 'ct-pickup-ready';
                return (
                  <li key={u.id} data-testid={tid}>
                    {u.go ? <button className={cls} onClick={u.go}>{inner}</button> : u.href ? <Link href={u.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-gray-600" data-testid="ct-auto-dispatch">
              {t('ctAutoDispatch')}: <span className={summary.automaticDispatchEnabled ? 'font-medium text-green-700' : 'font-medium text-amber-800'}>{summary.automaticDispatchEnabled ? t('ctOn') : t('ctOff')}</span>
            </p>
          </section>
          {fleetLine}
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className="flex min-h-[48px] w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium shadow-sm">
            {tt('More operational details', 'مزيد من التفاصيل التشغيلية')}<span aria-hidden>{moreOpen ? '▴' : '▾'}</span>
          </button>
          {moreOpen && (
            <div className="space-y-3">
              {summary.operations && <OperationsFactsCard facts={summary.operations} />}
              <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm" data-testid="ct-by-status">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">{t('ctActiveOrders')}</h2>
                <div className="flex flex-wrap gap-2 text-sm">
                  {Object.entries(summary.ordersByStatus).map(([status, count]) => (
                    <Link key={status} href={`/order-management?status=${status}`} className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-200 bg-gray-50 px-3" data-testid={`ct-status-${status}`}>{status.replace(/_/g, ' ')}: <b className="ms-1">{count}</b></Link>
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {summary && at && !isMobile && (
        <>
          <div className="grid grid-cols-3 gap-3 xl:grid-cols-6" data-testid="ct-kpis">
            <KpiCard label={tt('Waiting for a driver', 'بانتظار سائق')} value={at.awaitingAssignment} tone={hot(at.awaitingAssignment)} />
            <KpiCard label={tt('Released by a driver', 'أعادها سائق')} value={at.releasedAwaitingManualAssignment} tone={hot(at.releasedAwaitingManualAssignment)} />
            <KpiCard label={tt('Past accept deadline', 'تجاوزت مهلة القبول')} value={at.assignedPastAcceptDeadline} tone={hot(at.assignedPastAcceptDeadline)} />
            <KpiCard label={tt('Failed, unresolved', 'فاشلة غير محسومة')} value={at.failedDeliveriesUnresolved} tone={hot(at.failedDeliveriesUnresolved)} />
            <KpiCard label={tt('Pickup ready', 'جاهزة للاستلام')} value={at.readyForCustomerPickup} />
            <KpiCard label={tt('Drivers available', 'سائقون متاحون')} value={summary.drivers ? summary.drivers.onlineAndAvailable : '—'} tone={summary.drivers && summary.drivers.onlineAndAvailable === 0 ? 'bad' : 'neutral'} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2" data-testid="ct-attention">
              <h2 className="text-sm font-semibold text-gray-900">{t('ctNeedsAttention')}</h2>
              <ul className="mt-3 space-y-3 text-sm">
                <li data-testid="ct-awaiting">
                  <button className="text-start hover:underline" onClick={() => { setStage('AWAITING_ASSIGNMENT'); setReleasedOnly(false); setPage(1); }}>
                    <b>{at.awaitingAssignment}</b> {t('ctAwaitingAssignment')}
                  </button>
                  <span className="ms-2 text-gray-500">
                    ({at.awaitingWithOpenNoDriverAlert} {t('ctAwaitingWithAlert')} · {at.awaitingWithoutAlert} {t('ctAwaitingWithoutAlert')})
                  </span>
                  {at.awaitingWithoutAlert > 0 && <p className="text-xs text-gray-500">{t('ctAwaitingWithoutAlertHelp')}</p>}
                </li>
                <li data-testid="ct-released">
                  <button
                    className={`text-start hover:underline ${at.releasedAwaitingManualAssignment > 0 ? 'font-medium text-red-700' : ''}`}
                    onClick={() => { setStage('AWAITING_ASSIGNMENT'); setReleasedOnly(true); setPage(1); }}
                  >
                    <b>{at.releasedAwaitingManualAssignment}</b> {t('ctReleasedAwaitingManual')}
                  </button>
                  {at.releasedAwaitingManualAssignment > 0 && <p className="text-xs text-red-700">{t('ctReleasedAwaitingManualHelp')}</p>}
                </li>
                <li data-testid="ct-past-deadline"><b>{at.assignedPastAcceptDeadline}</b> {t('ctPastDeadline')}</li>
                <li data-testid="ct-failed">
                  <Link href="/failed-deliveries" className="hover:underline"><b>{at.failedDeliveriesUnresolved}</b> {t('ctFailedUnresolved')}</Link>
                </li>
                <li data-testid="ct-pickup-ready">
                  <Link href="/order-management?view=readyPickup" className="hover:underline"><b>{at.readyForCustomerPickup}</b> {t('ctReadyForCustomerPickup')}</Link>
                </li>
                <li data-testid="ct-auto-dispatch">
                  {t('ctAutoDispatch')}:{' '}
                  <span className={summary.automaticDispatchEnabled ? 'font-medium text-green-700' : 'font-medium text-amber-800'}>{summary.automaticDispatchEnabled ? t('ctOn') : t('ctOff')}</span>
                </li>
              </ul>
            </section>

            {summary.drivers && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" data-testid="ct-drivers">
                <h2 className="text-sm font-semibold text-gray-900">
                  <Link href="/drivers" className="hover:underline">{t('ctDrivers')}: {summary.drivers.approved}</Link>
                </h2>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex justify-between"><span>{t('ctDriversAvailable')}</span><b className="tabular-nums">{summary.drivers.onlineAndAvailable}</b></li>
                  <li className="flex justify-between"><span>{t('ctDriversBusy')}</span><b className="tabular-nums">{summary.drivers.onlineBusy}</b></li>
                  <li className="flex justify-between"><span>{t('ctDriversOffline')}</span><b className="tabular-nums">{summary.drivers.offline}</b></li>
                  <li className="flex justify-between"><span>{t('ctDriversPending')}</span><b className="tabular-nums">{summary.drivers.pendingVerification}</b></li>
                </ul>
              </section>
            )}

            {summary.operations && (
              <div className="lg:col-span-3">
                <OperationsFactsCard facts={summary.operations} />
              </div>
            )}

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm lg:col-span-3" data-testid="ct-by-status">
              <h2 className="text-sm font-semibold text-gray-900">{t('ctActiveOrders')}</h2>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {Object.entries(summary.ordersByStatus).map(([status, count]) => (
                  <Link key={status} href={`/order-management?status=${status}`} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 hover:bg-white hover:shadow-sm" data-testid={`ct-status-${status}`}>
                    {status.replace(/_/g, ' ')}: <b>{count}</b>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      {/* ---- deliveries ---- */}
      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="space-y-3 border-b border-gray-100 p-3 md:flex md:flex-wrap md:items-center md:justify-between md:gap-3 md:space-y-0">
          <h2 className="text-sm font-semibold text-gray-900">{t('ctDeliveries')}</h2>
          {tabs}
          {searchForm}
        </div>

        {isMobile ? (
          <div className="border-b border-gray-100 bg-gray-50/60 px-3 py-2">
            <button type="button" aria-expanded={toolsOpen} onClick={() => setToolsOpen((v) => !v)} className="flex min-h-[40px] w-full items-center justify-between text-xs font-medium text-gray-700">
              {tt('Saved views and export', 'العروض المحفوظة والتصدير')}<span aria-hidden>{toolsOpen ? '▴' : '▾'}</span>
            </button>
            {toolsOpen && <div className="pt-2">{toolsBar}</div>}
          </div>
        ) : (
          <div className="border-b border-gray-100 bg-gray-50/60 px-3 py-2">{toolsBar}</div>
        )}

        {releasedOnly && (
          <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="ct-released-filter">
            {t('ctReleasedFilter')}
            <button onClick={() => { setReleasedOnly(false); setPage(1); }} className="min-h-[40px] px-2 font-medium underline md:min-h-0 md:px-0">{t('ctClear')}</button>
          </div>
        )}

        {bulkBar}

        {deliveriesError && (
          <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {deliveriesError}{' '}
            <button onClick={loadDeliveries} className="font-medium underline">{t('retry')}</button>
          </div>
        )}
        {!deliveriesError && deliveries === null && <p className="p-3 text-gray-500">{t('loading')}</p>}
        {deliveries && deliveries.data.length === 0 && !deliveriesError && (
          <p data-testid="ct-empty" className="p-6 text-center text-sm text-gray-500">{search ? t('ctEmptySearch') : t('ctEmpty')}</p>
        )}
        {driversError && canAssign && <p className="px-3 pt-2 text-xs text-red-600">{driversError}</p>}

        {/* PHONE: one card per order — the most important facts first, the main action one tap away. */}
        {isCompact && deliveries && deliveries.data.length > 0 && (
          <ul className={`grid gap-2.5 p-3 md:grid-cols-2  ${loadingDeliveries ? 'opacity-60' : ''}`} data-testid="ct-cards" aria-busy={loadingDeliveries}>
            {deliveries.data.map((row) => (
              <li key={row.orderId} data-testid={`ct-row-${row.orderNumber}`} className={`rounded-xl border bg-white p-3 shadow-sm ${row.released || row.openDispatchAlert ? 'border-amber-300' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {bulkEnabled && row.status === 'READY_FOR_PICKUP' && (
                      <input type="checkbox" className="h-5 w-5" aria-label={tt(`Select ${row.orderNumber}`, `تحديد ${row.orderNumber}`)} checked={selected.has(row.orderId)} onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(row.orderId); else n.delete(row.orderId); return n; })} />
                    )}
                    <Link href={`/order-management?order=${row.orderId}`} className="text-base font-semibold text-hatly-orangeDark" dir="ltr">{row.orderNumber}</Link>
                  </div>
                  <span data-testid="ct-row-status" className="shrink-0"><StatusPill status={row.status} /></span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{t('ctColSince')}: {since(row.statusSince, locale)}</p>
                <p className="mt-2 line-clamp-2 text-sm text-gray-800">{row.deliveryAddress ? deliveryAddressText(row.deliveryAddress, locale) : '—'}</p>
                <p className="mt-2 text-sm" data-testid="ct-row-driver">
                  <span className="text-gray-500">{t('ctColDriver')}: </span>
                  {row.driver ? <b><bdi>{row.driver.fullName}</bdi></b> : <span className="font-medium text-amber-800">{t('ctNoDriver')}</span>}
                </p>
                <div className="mt-2 space-y-1 text-xs">{flagChips(row)}</div>
                <div className="mt-3 flex gap-2">
                  {canAssign && canAct(row) && drivers ? (
                    <Button variant="primary" className="min-h-[44px] flex-1" data-testid={`ct-action-${row.orderNumber}`} onClick={() => setPanel(row)}>{actionLabel(row)}</Button>
                  ) : null}
                  <Button className="min-h-[44px] flex-1" data-testid={`ct-details-${row.orderNumber}`} onClick={() => setPanel(row)}>{tt('Details', 'تفاصيل')}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* TABLET / DESKTOP: the operational table. */}
        {!isCompact && deliveries && deliveries.data.length > 0 && (
          <div className={`overflow-x-auto ${loadingDeliveries ? 'opacity-60' : ''}`} aria-busy={loadingDeliveries}>
            <table className="w-full text-start text-sm" data-testid="ct-table">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  {bulkEnabled && selectable.length > 0 && (
                    <th className="w-8 px-3 py-2">
                      <input type="checkbox" aria-label={tt('Select all waiting orders on this page', 'تحديد كل الطلبات المنتظرة في هذه الصفحة')} checked={selected.size > 0 && selected.size === selectable.length} onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.orderId)) : new Set())} />
                    </th>
                  )}
                  <th className="px-3 py-2 text-start font-medium">{t('ctColOrder')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ctColStatus')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ctColArea')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ctColDriver')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('ctColFlags')}</th>
                  {canAssign && <th className="px-3 py-2 text-start font-medium">{t('ctColAction')}</th>}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((row) => (
                  <tr key={row.orderId} data-testid={`ct-row-${row.orderNumber}`} className="border-b border-gray-100 align-top last:border-0 hover:bg-gray-50/60">
                    {bulkEnabled && selectable.length > 0 && (
                      <td className="px-3 py-2">
                        {row.status === 'READY_FOR_PICKUP' && (
                          <input type="checkbox" aria-label={tt(`Select ${row.orderNumber}`, `تحديد ${row.orderNumber}`)} checked={selected.has(row.orderId)} onChange={(e) => setSelected((cur) => { const n = new Set(cur); if (e.target.checked) n.add(row.orderId); else n.delete(row.orderId); return n; })} />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <Link href={`/order-management?order=${row.orderId}`} className="font-medium text-hatly-orangeDark hover:underline" dir="ltr">{row.orderNumber}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <span data-testid="ct-row-status">{row.status.replace(/_/g, ' ')}</span>
                      <div className="text-xs text-gray-500">{t('ctColSince')}: {since(row.statusSince, locale)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.deliveryAddress ? deliveryAddressText(row.deliveryAddress, locale) : '—'}</td>
                    <td className="px-3 py-2" data-testid="ct-row-driver">
                      {row.driver ? (
                        <>
                          {row.driver.fullName}
                          <div className="text-xs text-gray-500" dir="ltr">{row.driver.phone}</div>
                        </>
                      ) : (
                        <span className="text-gray-500">{t('ctNoDriver')}</span>
                      )}
                    </td>
                    <td className="space-y-1 px-3 py-2 text-xs">{flagChips(row)}</td>
                    {canAssign && (
                      <td className="min-w-[16rem] px-3 py-2">
                        {drivers && (
                          <DispatchAction
                            orderId={row.orderId}
                            orderNumber={row.orderNumber}
                            status={row.status}
                            currentDriver={row.driver}
                            drivers={drivers}
                            onChanged={(outcome) => { setFlash(outcome); refreshAll(); }}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-end">
                      <Button size="sm" variant="ghost" data-testid={`ct-details-${row.orderNumber}`} onClick={() => setPanel(row)}>{tt('Details', 'تفاصيل')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {deliveries && deliveries.meta.total > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-gray-100 p-3 text-sm">
            <span data-testid="ct-page" className="text-xs md:text-sm">{t('ctPageOf', { page: deliveries.meta.page, pages, total: deliveries.meta.total })}</span>
            <div className="flex gap-2">
              <Button size="sm" className="min-h-[44px] md:min-h-0" disabled={page <= 1 || loadingDeliveries} onClick={() => setPage((p) => p - 1)}>{t('listPrevious')}</Button>
              <Button size="sm" className="min-h-[44px] md:min-h-0" disabled={page >= pages || loadingDeliveries} onClick={() => setPage((p) => p + 1)}>{t('listNext')}</Button>
            </div>
          </div>
        )}
      </section>

      {/* ---- dispatch alerts (dispatchers only — same permission as the endpoint) ---- */}
      {canAssign && (
        <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm md:p-4" data-testid="ct-alerts">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">{t('ctAlerts')}</h2>
            <label className="flex min-h-[40px] items-center gap-1.5 text-sm md:min-h-0">
              <input type="checkbox" className="h-4 w-4" checked={alertsOpenOnly} onChange={(e) => setAlertsOpenOnly(e.target.checked)} />
              {t('ctAlertsOpenOnly')}
            </label>
          </div>
          {alertsError && <p className="mt-2 text-sm text-red-600">{alertsError}</p>}
          {!alertsError && alerts === null && <p className="mt-2 text-sm text-gray-500">{t('loading')}</p>}
          {!alertsError && alerts !== null && alerts.length === 0 && (
            <p className="mt-2 text-sm text-gray-500" data-testid="ct-alerts-empty">{alertsOpenOnly ? t('ctAlertsNone') : t('ctAlertsNoneAll')}</p>
          )}
          {alerts && alerts.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {(alertsAll ? alerts : alerts.slice(0, ALERTS_SHOWN)).map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5" data-testid={`ct-alert-${a.id}`}>
                  <span className="min-w-0">
                    <Link href={`/order-management?order=${a.orderId}`} className="font-medium text-hatly-orangeDark hover:underline" dir="ltr">{a.orderNumber ?? a.orderId.slice(0, 8)}</Link>{' '}
                    — {t(`opReason_${a.reason}` as MessageKey)} · {since(a.createdAt, locale)}
                    {a.detail && <span className="ms-1 text-xs text-gray-500">({a.detail})</span>}
                    {a.orderStatus && <span className="ms-1 text-xs text-gray-500">({a.orderStatus.replace(/_/g, ' ')})</span>}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${a.resolvedAt ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{a.resolvedAt ? t('ctAlertResolved') : t('ctAlertOpen')}</span>
                </li>
              ))}
            </ul>
          )}
          {alerts && alerts.length > ALERTS_SHOWN && (
            <Button className="mt-2 min-h-[44px] w-full md:min-h-0 md:w-auto" onClick={() => setAlertsAll((v) => !v)}>
              {alertsAll ? tt('Show fewer', 'عرض أقل') : tt(`Show all ${alerts.length}`, `عرض الكل (${alerts.length})`)}
            </Button>
          )}
        </section>
      )}

      {/* ---- details: a side drawer on larger screens, a bottom sheet on a phone ---- */}
      {panel && (
        <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && setPanel(null)}>
          <div className="absolute inset-0 bg-black/30" aria-hidden />
          <aside
            role="dialog"
            aria-label={tt(`Order ${panel.orderNumber}`, `الطلب ${panel.orderNumber}`)}
            data-testid="ct-panel"
            className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-6 shadow-2xl md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-full md:max-w-md md:rounded-none md:p-5 [&_button]:min-h-[44px] md:[&_button]:min-h-0 [&_select]:min-h-[44px] md:[&_select]:min-h-0"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-300 md:hidden" aria-hidden />
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold" dir="ltr">{panel.orderNumber}</h2>
                <StatusPill status={panel.status} />
              </div>
              <Button variant="ghost" onClick={() => setPanel(null)} aria-label={tt('Close', 'إغلاق')}>✕</Button>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-xs text-gray-500">{t('ctColSince')}</dt><dd>{since(panel.statusSince, locale)}</dd></div>
              <div><dt className="text-xs text-gray-500">{t('ctColArea')}</dt><dd>{panel.deliveryAddress ? deliveryAddressText(panel.deliveryAddress, locale) : '—'}</dd></div>
              <div><dt className="text-xs text-gray-500">{t('ctColDriver')}</dt><dd>{panel.driver ? `${panel.driver.fullName} · ${panel.driver.phone}` : t('ctNoDriver')}</dd></div>
              {panel.released && <div><dt className="text-xs text-gray-500">{t('ctColFlags')}</dt><dd className="text-red-800">{t(releasedKey(panel.released), { time: since(panel.released.at, locale) })}</dd></div>}
              {panel.openDispatchAlert && <div><dd className="text-amber-900">{t('ctFlagAlert', { time: since(panel.openDispatchAlert.createdAt, locale) })}</dd></div>}
            </dl>
            {canAssign && drivers && canAct(panel) && (
              <div className="mt-5 border-t border-gray-100 pt-4">
                <h3 className="mb-2 text-sm font-semibold">{t('ctColAction')}</h3>
                <DispatchAction orderId={panel.orderId} orderNumber={panel.orderNumber} status={panel.status} currentDriver={panel.driver} drivers={drivers} onChanged={(outcome) => { setFlash(outcome); setPanel(null); refreshAll(); }} />
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/order-management?order=${panel.orderId}`} className="inline-flex min-h-[44px] items-center rounded-lg bg-hatly-orange px-4 text-sm font-medium text-white hover:bg-hatly-orangeDark md:min-h-0 md:py-1.5">{tt('Open the order', 'فتح الطلب')}</Link>
              <Link href={`/exceptions?order=${panel.orderId}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm hover:bg-gray-50 md:min-h-0 md:py-1.5">{tt('Exceptions queue', 'قائمة الاستثناءات')}</Link>
            </div>
          </aside>
        </div>
      )}

      <Modal open={saveOpen} title={tt('Save this view', 'حفظ هذا العرض')} onClose={() => setSaveOpen(false)}>
        <form onSubmit={(e) => { e.preventDefault(); saveView(); }} className="space-y-3">
          <p className="text-sm text-gray-600">{tt('Remembers the current tab, search and the released-only filter in this browser.', 'يحفظ التبويب والبحث ومرشح "المُعادة فقط" الحاليين في هذا المتصفح.')}</p>
          <input autoFocus value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={40} placeholder={tt('View name', 'اسم العرض')} className="min-h-[44px] w-full rounded-lg border border-gray-300 px-3 py-2 text-base md:text-sm" aria-label={tt('View name', 'اسم العرض')} />
          <div className="flex justify-end gap-2"><Button type="button" className="min-h-[44px]" onClick={() => setSaveOpen(false)}>{tt('Cancel', 'إلغاء')}</Button><Button type="submit" variant="primary" className="min-h-[44px]" disabled={!viewName.trim()}>{tt('Save', 'حفظ')}</Button></div>
        </form>
      </Modal>
      <Modal open={helpOpen} title={tt('Keyboard shortcuts', 'اختصارات لوحة المفاتيح')} onClose={() => setHelpOpen(false)}>
        <ul className="space-y-2 text-sm">
          <li><kbd className="rounded border bg-gray-50 px-1.5">/</kbd> {tt('Focus the search box', 'الانتقال إلى البحث')}</li>
          <li><kbd className="rounded border bg-gray-50 px-1.5">r</kbd> {tt('Refresh from the server', 'التحديث من الخادم')}</li>
          <li><kbd className="rounded border bg-gray-50 px-1.5">Esc</kbd> {tt('Close the details panel', 'إغلاق لوحة التفاصيل')}</li>
          <li><kbd className="rounded border bg-gray-50 px-1.5">Ctrl/⌘ K</kbd> {tt('Quick find across the Admin', 'البحث السريع في لوحة الإدارة')}</li>
          <li><kbd className="rounded border bg-gray-50 px-1.5">?</kbd> {tt('This list', 'هذه القائمة')}</li>
        </ul>
      </Modal>
      <ConfirmDialog
        open={bulkConfirm}
        title={tt('Assign the selected orders?', 'إسناد الطلبات المحددة؟')}
        message={tt(`Each of the ${selected.size} orders is assigned to the chosen driver through the normal assignment, one by one. The backend checks every rule and may refuse some; refusals are listed afterwards.`, `سيُسنَد كل طلب من الطلبات (${selected.size}) إلى السائق المختار عبر الإسناد المعتاد واحدًا تلو الآخر. يتحقق الخادم من كل قاعدة وقد يرفض بعضها؛ تُعرض حالات الرفض بعد ذلك.`)}
        confirmLabel={tt('Assign', 'إسناد')}
        busy={bulkBusy}
        onConfirm={runBulk}
        onClose={() => setBulkConfirm(false)}
      />
    </div>
  );
}
