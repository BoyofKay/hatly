'use client';

import { useCallback, useEffect, useState } from 'react';
import { listVendorBranches, VendorBranch } from '../../../lib/api/admin-vendors';
import { listDrivers, AdminDriver } from '../../../lib/api/admin-dispatch';
import {
  closeVendorSettlementPeriod,
  closeDriverSettlementPeriod,
  VendorSettlementPeriod,
  DriverSettlementPeriod,
} from '../../../lib/api/admin-settlement';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, ConfirmDialog, ErrorState, LabeledSelect, PageHeader } from '../../../components/ui';

/**
 * Settlement — closes the current settlement period for one vendor branch or one driver (the two close endpoints of the settlement service). Closing is
 * financial and irreversible, so it is confirmed in a dialog first. SettlementService is the ONLY place any total here is computed: this page shows the
 * numbers the backend returned and derives nothing from them. In particular it does NOT show a "payable to the vendor" figure — the vendor ledger records
 * the commission Hatly is owed, and no vendor net-payable rule has been defined, so inventing one here would be a misleading balance.
 *
 * There is deliberately no history list on this page: the backend has only the two close endpoints (no GET of past periods). See the Vendor Financial
 * Centre for read-only vendor statements.
 */
export default function SettlementPage() {
  const { t, money, dateTime } = useLang();
  const [branches, setBranches] = useState<VendorBranch[]>([]);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [vendorResult, setVendorResult] = useState<VendorSettlementPeriod | null>(null);
  const [vendorError, setVendorError] = useState<string | null>(null);
  const [closingVendor, setClosingVendor] = useState(false);

  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [driverResult, setDriverResult] = useState<DriverSettlementPeriod | null>(null);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [closingDriver, setClosingDriver] = useState(false);

  const [confirm, setConfirm] = useState<'vendor' | 'driver' | null>(null);

  const loadPickers = useCallback(async () => {
    setLoadError(null);
    try {
      const [branchList, driverList] = await Promise.all([listVendorBranches(), listDrivers()]);
      setBranches(branchList);
      setDrivers(driverList);
    } catch (err: any) {
      setLoadError(apiErrorMessage(err, t('Failed to load vendor branches / drivers.', 'تعذّر تحميل فروع المتاجر / السائقين.')));
    }
  }, [t]);

  useEffect(() => {
    void loadPickers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function closeVendor() {
    if (!selectedBranchId || closingVendor) return;
    setClosingVendor(true);
    setVendorError(null);
    try {
      setVendorResult(await closeVendorSettlementPeriod(selectedBranchId));
    } catch (err: any) {
      setVendorError(apiErrorMessage(err, t('Failed to close the vendor settlement period.', 'تعذّر إغلاق فترة تسوية المتجر.')));
    } finally {
      setClosingVendor(false);
      setConfirm(null);
    }
  }

  async function closeDriver() {
    if (!selectedDriverId || closingDriver) return;
    setClosingDriver(true);
    setDriverError(null);
    try {
      setDriverResult(await closeDriverSettlementPeriod(selectedDriverId));
    } catch (err: any) {
      setDriverError(apiErrorMessage(err, t('Failed to close the driver settlement period.', 'تعذّر إغلاق فترة تسوية السائق.')));
    } finally {
      setClosingDriver(false);
      setConfirm(null);
    }
  }

  const branch = branches.find((b) => b.id === selectedBranchId);
  const driver = drivers.find((d) => d.id === selectedDriverId);
  const Row = ({ l, v, strong }: { l: string; v: string; strong?: boolean }) => (
    <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-gray-600">{l}</dt><dd className={`tabular-nums ${strong ? 'font-semibold text-gray-900' : ''}`}>{v}</dd></div>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('Settlement', 'التسويات')} subtitle={t('Close the current settlement period for a vendor branch or a driver. Closing is final.', 'أغلق فترة التسوية الحالية لفرع متجر أو لسائق. الإغلاق نهائي.')} />
      {loadError && <div className="mb-4"><ErrorState message={loadError} onRetry={loadPickers} /></div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('Vendor Branch Settlement', 'تسوية فرع متجر')}>
          <div className="space-y-3">
            <LabeledSelect label={t('Vendor branch', 'فرع المتجر')} value={selectedBranchId} onChange={(e) => { setSelectedBranchId(e.target.value); setVendorResult(null); setVendorError(null); }}>
              <option value="">{t('Select a vendor branch...', 'اختر فرع متجر...')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </LabeledSelect>
            <Button variant="primary" className="min-h-[44px] w-full" disabled={!selectedBranchId} loading={closingVendor} onClick={() => setConfirm('vendor')}>{closingVendor ? t('Closing...', 'جارٍ الإغلاق...') : t('Close Period', 'إغلاق الفترة')}</Button>
            {vendorError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{vendorError}</p>}
            {vendorResult && (
              <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
                <p className="font-medium">{t('Period closed successfully.', 'تم إغلاق الفترة بنجاح.')}</p>
                <p className="mt-1 text-xs text-gray-700">{dateTime(vendorResult.periodStart)} → {dateTime(vendorResult.periodEnd)} <Badge>{vendorResult.frequency}</Badge></p>
                <dl className="mt-2 divide-y divide-green-100">
                  <Row l={t('Gross sales', 'إجمالي المبيعات')} v={money(vendorResult.grossSalesMinor)} />
                  <Row l={t('Commission owed to Hatly', 'العمولة المستحقة لهاتلي')} v={money(vendorResult.totalCommissionOwedMinor)} strong />
                </dl>
              </div>
            )}
          </div>
        </Card>

        <Card title={t('Driver Settlement', 'تسوية سائق')}>
          <div className="space-y-3">
            <LabeledSelect label={t('Driver', 'السائق')} value={selectedDriverId} onChange={(e) => { setSelectedDriverId(e.target.value); setDriverResult(null); setDriverError(null); }}>
              <option value="">{t('Select a driver...', 'اختر سائقًا...')}</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
            </LabeledSelect>
            <Button variant="primary" className="min-h-[44px] w-full" disabled={!selectedDriverId} loading={closingDriver} onClick={() => setConfirm('driver')}>{closingDriver ? t('Closing...', 'جارٍ الإغلاق...') : t('Close Period', 'إغلاق الفترة')}</Button>
            {driverError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{driverError}</p>}
            {driverResult && (
              <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
                <p className="font-medium">{t('Period closed successfully.', 'تم إغلاق الفترة بنجاح.')}</p>
                <p className="mt-1 text-xs text-gray-700">{dateTime(driverResult.periodStart)} → {dateTime(driverResult.periodEnd)} <Badge>{driverResult.frequency}</Badge></p>
                <dl className="mt-2 divide-y divide-green-100">
                  <Row l={t('Total earnings', 'إجمالي الأرباح')} v={money(driverResult.totalEarningsMinor)} />
                  <Row l={t('Commission owed', 'العمولة المستحقة')} v={money(driverResult.totalCommissionOwedMinor)} />
                  <Row l={t('Reimbursements owed', 'التعويضات المستحقة')} v={money(driverResult.totalReimbursementsOwedMinor)} />
                  <Row l={t('Net payable', 'صافي المستحق')} v={money(driverResult.netPayableMinor)} strong />
                </dl>
              </div>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={t('Close this settlement period?', 'إغلاق فترة التسوية هذه؟')}
        message={confirm === 'vendor'
          ? t(`Close the current settlement period for "${branch?.name ?? ''}"? This is a financial, irreversible action and cannot be undone.`, `إغلاق فترة التسوية الحالية لـ "${branch?.name ?? ''}"؟ هذا إجراء مالي لا رجعة فيه.`)
          : t(`Close the current settlement period for driver "${driver?.fullName ?? ''}"? This is a financial, irreversible action and cannot be undone.`, `إغلاق فترة التسوية الحالية للسائق "${driver?.fullName ?? ''}"؟ هذا إجراء مالي لا رجعة فيه.`)}
        confirmLabel={t('Close Period', 'إغلاق الفترة')}
        danger
        busy={closingVendor || closingDriver}
        onConfirm={() => void (confirm === 'vendor' ? closeVendor() : closeDriver())}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
