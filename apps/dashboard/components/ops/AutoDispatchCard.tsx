'use client';

import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, useToast } from '../ui';
import { Async } from '../ui';
import { send, useApi } from '../../lib/ui/api';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';

/**
 * The single, obvious Automatic Dispatch switch (B3). ON: eligible drivers are assigned automatically. OFF: automatic assignment stops and
 * authorised admins assign / reassign manually. Switching never touches existing orders or assignments. Audited on the server.
 */
export function AutoDispatchCard() {
  const { t } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const state = useApi<{ enabled: boolean; openAutoAssignDisabledAlerts: number }>('/admin/dispatch/automation');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('OVERRIDE_DISPATCH', 'MANAGE_BUSINESS_CONFIG');
  const enabled = state.data?.enabled;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await send('put', '/admin/dispatch/automation', { enabled: !enabled });
      toast.push('success', !enabled ? t('Automatic dispatch is ON.', 'التوزيع التلقائي مفعّل.') : t('Automatic dispatch is OFF. Assign drivers manually.', 'التوزيع التلقائي متوقف. عيّن السائقين يدويًا.'));
      setConfirm(false);
      state.reload();
    } catch (e) {
      setError(apiErrorMessage(e, t('Could not change the setting.', 'تعذّر تغيير الإعداد.')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('Automatic dispatch', 'التوزيع التلقائي')}>
      <Async state={state} rows={1}>
        {state.data && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Badge tone={enabled ? 'green' : 'amber'}>{enabled ? t('ON', 'مفعّل') : t('OFF', 'متوقف')}</Badge>
                <p className="mt-2 text-xs text-gray-500">{enabled ? t('Eligible drivers are assigned automatically.', 'يُعيَّن السائقون المؤهلون تلقائيًا.') : t('Automatic assignment is stopped. Ready orders wait for a manual assignment.', 'التعيين التلقائي متوقف. تنتظر الطلبات الجاهزة تعيينًا يدويًا.')}</p>
              </div>
              <Button variant={enabled ? 'secondary' : 'primary'} disabled={!allowed} title={allowed ? undefined : t('Needs the Override dispatch permission', 'يحتاج صلاحية تجاوز التوزيع')} onClick={() => setConfirm(true)}>
                {enabled ? t('Turn OFF', 'إيقاف') : t('Turn ON', 'تفعيل')}
              </Button>
            </div>
            {!enabled && state.data.openAutoAssignDisabledAlerts > 0 && <p className="text-xs text-amber-700">{t(`${state.data.openAutoAssignDisabledAlerts} order(s) are waiting for manual assignment.`, `${state.data.openAutoAssignDisabledAlerts} طلب بانتظار التعيين اليدوي.`)}</p>}
            <p className="text-[11px] text-gray-400">{t('Existing orders and assignments are never changed by this switch.', 'لا يغيّر هذا المفتاح الطلبات والتعيينات القائمة.')}</p>
          </div>
        )}
      </Async>
      <ConfirmDialog
        open={confirm}
        title={enabled ? t('Turn automatic dispatch OFF?', 'إيقاف التوزيع التلقائي؟') : t('Turn automatic dispatch ON?', 'تفعيل التوزيع التلقائي؟')}
        message={enabled ? t('New ready orders will no longer be assigned automatically; they will raise an alert until someone assigns a driver.', 'لن تُعيَّن الطلبات الجاهزة الجديدة تلقائيًا، وستظهر كتنبيه حتى يعيّن أحدهم سائقًا.') : t('Ready orders will be assigned to eligible drivers automatically again.', 'ستُعيَّن الطلبات الجاهزة للسائقين المؤهلين تلقائيًا مرة أخرى.')}
        confirmLabel={enabled ? t('Turn OFF', 'إيقاف') : t('Turn ON', 'تفعيل')}
        danger={Boolean(enabled)}
        busy={busy}
        error={error}
        onConfirm={apply}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}
