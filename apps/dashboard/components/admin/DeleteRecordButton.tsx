'use client';

import { useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { Button, ConfirmDialog, useToast } from '../ui';

/**
 * One "Delete" button for every admin record (backend `DELETE /admin/...`, a safe soft delete — see AdminRecordsService). Confirms first;
 * when the server refuses (orders still in progress, a category that still has products, …) its plain reason is shown in the dialog.
 * `strong` asks the user to type the word to confirm — used for deletes that also switch off related records (a store and its menu).
 */
export function DeleteRecordButton({
  path,
  name,
  what,
  consequence,
  strong,
  size = 'sm',
  onDeleted,
  disabled,
}: {
  path: string;
  name: string;
  what: [string, string];
  consequence?: [string, string];
  strong?: boolean;
  size?: 'sm' | 'md';
  onDeleted: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const { t, locale } = useLang();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting is an admin decision (DELETE_RECORDS, on top of the area permission). Others deactivate instead; the server enforces it too.
  const canDelete = usePermissions().can('DELETE_RECORDS');

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.delete(path);
      toast.push('success', t(`${what[0]} deleted.`, `تم حذف ${what[1]}.`));
      setOpen(false);
      await onDeleted();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not delete.', 'تعذّر الحذف.')));
    } finally {
      setBusy(false);
    }
  }

  if (!canDelete) return null;
  return (
    <>
      <Button size={size} variant="danger" disabled={disabled} onClick={(e) => { e.stopPropagation(); setError(null); setOpen(true); }} aria-label={t(`Delete ${what[0].toLowerCase()} ${name}`, `حذف ${what[1]} ${name}`)}>
        {t('Delete', 'حذف')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t(`Delete this ${what[0].toLowerCase()}?`, `حذف ${what[1]}؟`)}
        message={
          <div className="space-y-2">
            <p><bdi className="font-semibold">{name}</bdi></p>
            {consequence && <p>{t(consequence[0], consequence[1])}</p>}
            <p className="text-xs text-gray-500">{t('Past orders and reports keep their records. This cannot be undone from the panel.', 'تحتفظ الطلبات والتقارير السابقة بسجلاتها. لا يمكن التراجع من لوحة التحكم.')}</p>
          </div>
        }
        confirmLabel={t('Delete', 'حذف')}
        danger
        typeToConfirm={strong ? (locale === 'ar' ? 'حذف' : 'DELETE') : undefined}
        busy={busy}
        error={error}
        onConfirm={() => void confirm()}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
