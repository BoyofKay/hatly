'use client';

import { useState } from 'react';
import { MANAGE_VENDOR_COMMISSION, setBranchAutoAccept } from '../../lib/api/admin-operations';
import { apiErrorMessage } from '../../lib/api/errors';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { I18nProvider, useI18n } from '../../lib/i18n/i18n';

/**
 * Per-branch order acceptance mode. Automatic = new orders are accepted on the vendor's behalf (and ONLY accepted — the vendor still
 * prepares and marks ready). Manual (the default) = the vendor accepts or rejects each order. The branch is the single source of truth: there
 * is no global switch. The state shown is always the one the backend returned.
 */
export function BranchAcceptanceMode(props: { branchId: string; autoAcceptEnabled: boolean; onChanged: () => Promise<void> | void }) {
  return (
    <I18nProvider>
      <Control {...props} />
    </I18nProvider>
  );
}

function Control({ branchId, autoAcceptEnabled, onChanged }: { branchId: string; autoAcceptEnabled: boolean; onChanged: () => Promise<void> | void }) {
  const { t } = useI18n();
  const canChange = useAdminPermission(MANAGE_VENDOR_COMMISSION);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  async function change(next: boolean) {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    try {
      await setBranchAutoAccept(branchId, next);
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
      <p className="mt-1 text-sm text-gray-700" data-testid="branch-acceptance-state">
        {autoAcceptEnabled ? t('opBranchAuto') : t('opBranchManual')}
      </p>
      <p className="text-xs text-gray-500">{t('opBranchApplies')}</p>
      {canChange === true && (
        <button
          type="button"
          data-testid="branch-acceptance-toggle"
          disabled={busy}
          onClick={() => change(!autoAcceptEnabled)}
          className="mt-2 rounded-lg border px-3 py-1 text-sm font-medium disabled:opacity-50 border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
        >
          {autoAcceptEnabled ? t('opBranchSwitchToManual') : t('opBranchSwitchToAuto')}
        </button>
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
