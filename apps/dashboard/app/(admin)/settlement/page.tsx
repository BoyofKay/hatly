'use client';

import { useEffect, useState } from 'react';
import { listVendorBranches, VendorBranch } from '../../../lib/api/admin-vendors';
import { listDrivers, AdminDriver } from '../../../lib/api/admin-dispatch';
import {
  closeVendorSettlementPeriod,
  closeDriverSettlementPeriod,
  VendorSettlementPeriod,
  DriverSettlementPeriod,
} from '../../../lib/api/admin-settlement';
import { apiErrorMessage } from '../../../lib/api/errors';

function minor(amount: number): string {
  return (amount / 100).toFixed(2);
}

/**
 * M3a (Launch-Readiness Gap Audit, G-05) — the first Admin Dashboard
 * surface for M2's settlement close endpoints. Mirrors the rest of this
 * dashboard's conventions exactly (plain useState/useEffect, no query
 * library, window.confirm for the irreversible action — same as
 * Settings' OTP toggle). SettlementService is the ONLY place any total
 * here is computed; `payable` below is a pure display-only subtraction
 * of two numbers the backend already returned, never a recomputation of
 * gross sales or commission themselves.
 *
 * Deliberately no "history" list: the real backend has only the two
 * close endpoints (no GET to list past periods) — see
 * admin-settlement.controller.ts. Each close's own response is the
 * server-authoritative result shown below; there is nothing further to
 * "reconcile" against, since no separate read endpoint exists to
 * reconcile with (a real, named limitation — see the M3a report).
 */
export default function SettlementPage() {
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

  async function loadPickers() {
    setLoadError(null);
    try {
      const [branchList, driverList] = await Promise.all([listVendorBranches(), listDrivers()]);
      setBranches(branchList);
      setDrivers(driverList);
    } catch (err: any) {
      setLoadError(apiErrorMessage(err, 'Failed to load vendor branches / drivers.'));
    }
  }

  useEffect(() => {
    loadPickers();
  }, []);

  async function handleCloseVendorPeriod() {
    if (!selectedBranchId || closingVendor) return;
    const branch = branches.find((b) => b.id === selectedBranchId);
    const confirmed = window.confirm(
      `Close the current settlement period for "${branch?.name ?? selectedBranchId}"? ` +
        'This is a financial, irreversible action and cannot be undone.',
    );
    if (!confirmed) return;

    setClosingVendor(true);
    setVendorError(null);
    try {
      const period = await closeVendorSettlementPeriod(selectedBranchId);
      setVendorResult(period);
    } catch (err: any) {
      setVendorError(apiErrorMessage(err, 'Failed to close the vendor settlement period.'));
    } finally {
      setClosingVendor(false);
    }
  }

  async function handleCloseDriverPeriod() {
    if (!selectedDriverId || closingDriver) return;
    const driver = drivers.find((d) => d.id === selectedDriverId);
    const confirmed = window.confirm(
      `Close the current settlement period for driver "${driver?.fullName ?? selectedDriverId}"? ` +
        'This is a financial, irreversible action and cannot be undone.',
    );
    if (!confirmed) return;

    setClosingDriver(true);
    setDriverError(null);
    try {
      const period = await closeDriverSettlementPeriod(selectedDriverId);
      setDriverResult(period);
    } catch (err: any) {
      setDriverError(apiErrorMessage(err, 'Failed to close the driver settlement period.'));
    } finally {
      setClosingDriver(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Settlement</h1>

      {loadError && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {loadError}{' '}
          <button onClick={loadPickers} className="underline">
            Retry
          </button>
        </div>
      )}

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Vendor Branch Settlement</h2>
        <div className="mt-3 flex gap-2">
          <select
            value={selectedBranchId}
            onChange={(e) => {
              setSelectedBranchId(e.target.value);
              setVendorResult(null);
              setVendorError(null);
            }}
            className="flex-1 rounded border px-2 py-1.5 text-sm"
          >
            <option value="">Select a vendor branch...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleCloseVendorPeriod}
            disabled={!selectedBranchId || closingVendor}
            className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {closingVendor ? 'Closing...' : 'Close Period'}
          </button>
        </div>

        {vendorError && <p className="mt-2 text-sm text-red-600">{vendorError}</p>}

        {vendorResult && (
          <div className="mt-3 rounded bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">Period closed successfully.</p>
            <p className="mt-1 text-gray-700">
              {new Date(vendorResult.periodStart).toLocaleString()} &rarr; {new Date(vendorResult.periodEnd).toLocaleString()} (
              {vendorResult.frequency})
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-gray-600">Gross sales</dt>
              <dd>{minor(vendorResult.grossSalesMinor)}</dd>
              <dt className="text-gray-600">Commission owed</dt>
              <dd>{minor(vendorResult.totalCommissionOwedMinor)}</dd>
              <dt className="text-gray-600">Payable (gross &minus; commission)</dt>
              <dd className="font-medium">{minor(vendorResult.grossSalesMinor - vendorResult.totalCommissionOwedMinor)}</dd>
            </dl>
          </div>
        )}
      </section>

      <section className="rounded border bg-white p-4">
        <h2 className="font-semibold">Driver Settlement</h2>
        <div className="mt-3 flex gap-2">
          <select
            value={selectedDriverId}
            onChange={(e) => {
              setSelectedDriverId(e.target.value);
              setDriverResult(null);
              setDriverError(null);
            }}
            className="flex-1 rounded border px-2 py-1.5 text-sm"
          >
            <option value="">Select a driver...</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
              </option>
            ))}
          </select>
          <button
            onClick={handleCloseDriverPeriod}
            disabled={!selectedDriverId || closingDriver}
            className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {closingDriver ? 'Closing...' : 'Close Period'}
          </button>
        </div>

        {driverError && <p className="mt-2 text-sm text-red-600">{driverError}</p>}

        {driverResult && (
          <div className="mt-3 rounded bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">Period closed successfully.</p>
            <p className="mt-1 text-gray-700">
              {new Date(driverResult.periodStart).toLocaleString()} &rarr; {new Date(driverResult.periodEnd).toLocaleString()} (
              {driverResult.frequency})
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-gray-600">Total earnings</dt>
              <dd>{minor(driverResult.totalEarningsMinor)}</dd>
              <dt className="text-gray-600">Commission owed</dt>
              <dd>{minor(driverResult.totalCommissionOwedMinor)}</dd>
              <dt className="text-gray-600">Reimbursements owed</dt>
              <dd>{minor(driverResult.totalReimbursementsOwedMinor)}</dd>
              <dt className="text-gray-600">Net payable</dt>
              <dd className="font-medium">{minor(driverResult.netPayableMinor)}</dd>
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}
