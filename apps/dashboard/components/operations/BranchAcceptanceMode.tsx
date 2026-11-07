'use client';

import { useState } from 'react';
import { MANAGE_VENDOR_COMMISSION, setBranchAcceptanceMode, type AcceptanceMode } from '../../lib/api/admin-operations';
import { apiErrorMessage } from '../../lib/api/errors';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { I18nProvider, useI18n } from '../../lib/i18n/i18n';

/**
 * R12 (decision register 2026-11-06): per-branch order acceptance mode.
 *  - Automatic: new orders are accepted on placement (only accepted — the vendor still prepares and marks ready). Never skips checkout checks.
 *  - Vendor (default): the vendor accepts or rejects every order.
 *  - Hatly: Hatly Operations accept or reject on the vendor's behalf; the vendor cannot, but prepares once accepted.
 * The branch is the single source of truth. The state shown is always the one the backend returned.
 */
export function BranchAcceptanceMode(props: { branchId: string; mode: AcceptanceMode; onChanged: () => Promise<void> | void }) {
  return (
    <I18nProvider>
      <Control {...props} />
    </I18nProvider>
  );
}

function Control({ branchId, mode, onChanged }: { branchId: string; mode: AcceptanceMode; onChanged: () => Promise<void> | void }) {
  const { t } = useI18n();
  const canChange = useAdminPermission(MANAGE_VENDOR_COMMISSION);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const describe: Record<AcceptanceMode, string> = { AUTO: t('opBranchAuto'), VENDOR: t('opBranchManual'), HATLY: t('opBranchHatly') };
  const label: Record<AcceptanceMode, string> = { AUTO: t('opBranchModeAuto'), VENDOR: t('opBranchModeVendor'), HATLY: t('opBranchModeHatly') };

  async function change(next: AcceptanceMode) {
    if (busy || next === mode) return;
    setBusy(true);
    setFlash(null);
    try {
      await setBranchAcceptanceMode(branchId, next);
      setFlash({ ok: true, message: t('opBranchChanged') });
    } catch (err) {
      setFlash({ ok: false, message: apiErrorMessage(err, t('opBranchFailed')) });
    } finally {
      await onChanged();
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm" data-testid="branch-acceptance-mode">
      <h2 className="font-semibold">{t('opBranchTitle')}</h2>
      <p className="mt-1 text-sm text-gray-700" data-testid="branch-acceptance-state">{describe[mode]}</p>
      <p className="text-xs text-gray-500">{t('opBranchApplies')} {t('opBranchNever')}</p>
      {canChange === true && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t('opBranchTitle')}>
          {(['AUTO', 'VENDOR', 'HATLY'] as AcceptanceMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`branch-acceptance-${m}`}
              aria-pressed={m === mode}
              disabled={busy}
              onClick={() => change(m)}
              className={`rounded-lg border px-3 py-1 text-sm font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40 ${m === mode ? 'border-hatly-orange bg-hatly-orange/10 text-hatly-orangeDark' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {label[m]}
            </button>
          ))}
        </div>
      )}
      {canChange === false && <p className="mt-2 text-xs text-gray-500">{t('opBranchNoPermission')}</p>}
      {flash && (
        <p role={flash.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${flash.ok ? 'text-green-700' : 'text-red-600'}`}>
          {flash.message}
        </p>
      )}
    </div>
  );
}
