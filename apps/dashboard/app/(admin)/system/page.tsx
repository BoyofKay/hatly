'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Button, Card, DataTable, Modal, PageHeader, StatusPill, useToast } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

const NAMES: Record<string, [string, string]> = {
  api: ['API', 'واجهة البرمجة'], database: ['Database', 'قاعدة البيانات'], redis: ['Redis cache', 'ذاكرة Redis'], storage: ['File storage', 'تخزين الملفات'], sms: ['SMS (OTP)', 'الرسائل النصية'], maps: ['Maps', 'الخرائط'], push: ['Push notifications', 'الإشعارات'], jobs: ['Background jobs', 'المهام الخلفية'], migrations: ['Database migrations', 'ترحيلات قاعدة البيانات'],
};

export default function SystemPage() {
  const { t, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const ov = useApi<any>('/admin/system/overview', undefined, { refreshInterval: 60000 });
  const [hist, setHist] = useState<string | null>(null);
  const history = useApi<any[]>(hist ? `/admin/system/integrations/${hist}/history` : null);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { await send('post', '/admin/system/check'); toast.push('success', t('Checks re-run.', 'أُعيد تشغيل الفحوصات.')); ov.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('The check failed.', 'فشل الفحص.'))); } finally { setBusy(false); } };
  const d = ov.data;
  return (
    <div>
      <PageHeader title={t('System health', 'صحة النظام')} subtitle={t('Live probes of the platform and its integrations. “Not configured” means the integration is switched off on purpose or not set up — it is not an error. Checks never send an SMS or a push message.', 'فحوصات مباشرة للمنصة وتكاملاتها. «غير مُعدّ» يعني أن التكامل متوقف عمدًا أو لم يُجهَّز — وليس خطأ. لا ترسل الفحوصات رسائل نصية ولا إشعارات.')} actions={<span className="flex items-center gap-2"><Link className="text-sm text-hatly-orangeDark hover:underline" href="/system/metrics">{t('Metrics', 'المقاييس')}</Link><Link className="text-sm text-hatly-orangeDark hover:underline" href="/system/jobs">{t('Jobs', 'المهام')}</Link>{can('MANAGE_SYSTEM_JOBS') && <Button loading={busy} onClick={run}>{t('Run checks now', 'تشغيل الفحوصات الآن')}</Button>}</span>} />
      <Async state={ov} rows={4}>
        {d && (
          <>
            <p className="mb-3 flex items-center gap-2 text-sm"><StatusPill status={d.overall} /> <span className="text-gray-500">{t('Checked', 'فُحص')} {dateTime(d.checkedAt)}</span></p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {d.checks.map((c: any) => {
                const [en, ar] = NAMES[c.key] ?? [c.key, c.key];
                return (
                  <Card key={c.key}>
                    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{t(en, ar)}</h3><StatusPill status={c.status} label={c.status === 'DISABLED' ? t('Not configured', 'غير مُعدّ') : undefined} /></div>
                    <p className="mt-2 text-xs text-gray-600"><bdi>{c.detail}</bdi></p>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500"><span>{c.latencyMs !== null ? `${c.latencyMs} ms` : ''}</span>{['database', 'redis', 'storage', 'sms', 'maps', 'push', 'jobs'].includes(c.key) && <button className="text-hatly-orangeDark hover:underline" onClick={() => setHist(c.key)}>{t('History', 'السجل')}</button>}</div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </Async>
      <Modal open={Boolean(hist)} wide title={hist ? t(`History — ${hist}`, `السجل — ${hist}`) : ''} onClose={() => setHist(null)}>
        <DataTable rows={history.data} rowKey={(r: any) => r.checkedAt} loading={history.loading} error={history.error} status={history.status} onRetry={history.reload} emptyTitle={t('No recorded checks yet', 'لا فحوصات مسجلة بعد')} columns={[
          { key: 'at', header: t('When', 'متى'), cell: (r: any) => dateTime(r.checkedAt) },
          { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.status} /> },
          { key: 'l', header: 'ms', align: 'end', cell: (r: any) => r.latencyMs ?? '—' },
          { key: 'd', header: t('Detail', 'التفاصيل'), cell: (r: any) => <bdi>{r.detail}</bdi> },
        ]} />
      </Modal>
    </div>
  );
}
