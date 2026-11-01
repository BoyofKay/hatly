'use client';

import { useState } from 'react';
import { Button, Card, DataTable, LabeledSelect, FilterBar, PageHeader, Pagination, StatusPill, useToast, usePaging } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { downloadExport } from '../../../components/reports/ExportButton';

export default function ExportsPage() {
  const { t, dateTime, num } = useLang();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const { page, setPage, limit } = usePaging(status);
  const list = useApi<any[]>('/admin/exports', { status: status || undefined, page, limit }, { refreshInterval: 4000 });
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.push('success', ok); list.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('The action failed.', 'فشل الإجراء.'))); }
  };
  return (
    <div>
      <PageHeader title={t('Exports', 'التصدير')} subtitle={t('Background exports with progress. Files are private, permission-checked again at download, audited, and expire after 72 hours.', 'تصديرات في الخلفية مع التقدم. الملفات خاصة، يُعاد فحص الصلاحية عند التنزيل، ومُدقَّقة، وتنتهي بعد 72 ساعة.')} />
      <FilterBar><div className="w-48"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All', 'الكل')}</option>{['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].map((s) => <option key={s} value={s}>{s}</option>)}</LabeledSelect></div></FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No exports yet', 'لا توجد تصديرات بعد')} emptyHint={t('Open a report and press Export.', 'افتح تقريرًا واضغط تصدير.')} columns={[
          { key: 'r', header: t('Report', 'التقرير'), cell: (r) => <span><strong>{r.reportId}</strong> <span className="text-gray-500"><bdi>{r.reportName}</bdi></span></span> },
          { key: 'f', header: t('Format', 'الصيغة'), cell: (r) => `${r.format} · ${r.locale.toUpperCase()}` },
          { key: 's', header: t('Status', 'الحالة'), cell: (r) => <span className="flex items-center gap-2"><StatusPill status={r.status} />{['QUEUED', 'RUNNING'].includes(r.status) && <span className="text-xs tabular-nums text-gray-500">{r.progress}%</span>}{r.status === 'FAILED' && <span className="text-xs text-red-600" title={r.errorMessage}>{r.errorCode}</span>}</span> },
          { key: 'n', header: t('Rows', 'الصفوف'), align: 'end', cell: (r) => (r.rowCount != null ? num(r.rowCount) : '—') },
          { key: 'c', header: t('Requested (Cairo)', 'الطلب (القاهرة)'), cell: (r) => dateTime(r.createdAt) },
          { key: 'e', header: t('Expires', 'ينتهي'), cell: (r) => (r.expiresAt ? dateTime(r.expiresAt) : '—') },
          { key: 'a', header: '', align: 'end', cell: (r) => (
            <span className="flex justify-end gap-2">
              {r.status === 'SUCCEEDED' && <Button size="sm" variant="primary" onClick={() => act(() => downloadExport(r.id), t('Download started.', 'بدأ التنزيل.'))}>{t('Download', 'تنزيل')}</Button>}
              {['QUEUED', 'RUNNING'].includes(r.status) && <Button size="sm" onClick={() => act(() => send('post', `/admin/exports/${r.id}/cancel`), t('Cancel requested.', 'طُلب الإلغاء.'))}>{t('Cancel', 'إلغاء')}</Button>}
              {['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => act(() => send('delete', `/admin/exports/${r.id}`), t('Export removed.', 'أُزيل التصدير.'))}>{t('Remove', 'إزالة')}</Button>}
            </span>
          ) },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
