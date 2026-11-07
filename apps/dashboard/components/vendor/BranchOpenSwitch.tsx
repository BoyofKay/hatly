'use client';

import { useState } from 'react';
import { useLang } from '../../lib/ui/lang';
import { apiErrorMessage } from '../../lib/api/errors';
import { updateVendorBranch } from '../../lib/api/vendor-business';
import { useToast } from '../ui';

/** Opens or closes a branch for new orders. The server decides (a branch Hatly has deactivated cannot be opened); the switch shows the server's answer. */
export function BranchOpenSwitch({ branchId, name, isOpen, isActive, onChanged }: { branchId: string; name: string; isOpen: boolean; isActive: boolean; onChanged: (open: boolean) => void }) {
  const { t } = useLang();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const next = await updateVendorBranch(branchId, { isOpen: !isOpen });
      onChanged(next.isOpen);
      // R8/R44: pausing or reopening is a request — the store changes only once Hatly approves it.
      if (next.requests?.length) toast.push('success', isOpen ? t(`Pause request for ${name} sent to Hatly. The store stays open until it is approved.`, `تم إرسال طلب إيقاف ${name} إلى هاتلي. يبقى المتجر مفتوحًا حتى الموافقة.`) : t(`Reopen request for ${name} sent to Hatly.`, `تم إرسال طلب إعادة فتح ${name} إلى هاتلي.`));
      else toast.push('success', next.isOpen ? t(`${name} is open for orders.`, `${name} مفتوح لاستقبال الطلبات.`) : t(`${name} is closed.`, `${name} مغلق.`));
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('Could not change the branch.', 'تعذّر تغيير حالة الفرع.')));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOpen}
      aria-label={t(`${isOpen ? 'Close' : 'Open'} ${name}`, `${isOpen ? 'إغلاق' : 'فتح'} ${name}`)}
      disabled={busy || (!isOpen && !isActive)}
      onClick={toggle}
      title={!isActive ? t('Hatly has deactivated this branch.', 'ألغت هاتلي تفعيل هذا الفرع.') : undefined}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/50 disabled:opacity-50 ${isOpen ? 'bg-green-600' : 'bg-gray-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${isOpen ? 'ltr:translate-x-6 rtl:-translate-x-6' : 'ltr:translate-x-1 rtl:-translate-x-1'}`} />
    </button>
  );
}
