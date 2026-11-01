'use client';

import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { getEnvelope, newKey, send } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledSelect, Modal, useToast } from '../ui';

/** Streams an export file through the authenticated API client (cookie + CSRF) and hands it to the browser. */
export async function downloadExport(id: string): Promise<void> {
  const res = await apiClient.get(`/admin/exports/${id}/download`, { responseType: 'blob' });
  const cd = String(res.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `export-${id}`;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Requests a background export of a report with the CURRENT filters (the same definition the screen uses), shows progress,
 * and offers the secure download when ready. Permission is enforced by the server at request time and again at download.
 */
export function ExportButton({ report, params, label }: { report: string; params: Record<string, string | undefined>; label?: string }) {
  const { t, locale } = useLang();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState('XLSX');
  const [lang, setLang] = useState(locale);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => { if (open) { setJob(null); setError(null); key.current = newKey(); setLang(locale); } }, [open, locale]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
      const res = await send<any>('post', `/admin/reports/${report}/exports`, { params: clean, format, locale: lang }, { 'Idempotency-Key': key.current });
      setJob(res.export);
      timer.current = setInterval(async () => {
        try {
          const j = (await getEnvelope(`/admin/exports/${res.export.id}`)).data;
          setJob(j);
          if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(j.status) && timer.current) { clearInterval(timer.current); timer.current = null; }
        } catch { /* keep polling */ }
      }, 1200);
    } catch (e) {
      setError(apiErrorMessage(e, t('The export could not be started.', 'تعذّر بدء التصدير.')));
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    try { await downloadExport(job.id); } catch (e) { toast.push('error', apiErrorMessage(e, t('Download failed.', 'فشل التنزيل.'))); }
  };
  const done = job?.status === 'SUCCEEDED';
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label ?? t('Export', 'تصدير')}</Button>
      <Modal open={open} title={t('Export this report', 'تصدير هذا التقرير')} onClose={() => setOpen(false)} footer={<>
        <Button onClick={() => setOpen(false)}>{t('Close', 'إغلاق')}</Button>
        {!job && <Button variant="primary" loading={busy} onClick={start}>{t('Start export', 'بدء التصدير')}</Button>}
        {done && <Button variant="primary" onClick={download}>{t('Download', 'تنزيل')}</Button>}
      </>}>
        {!job && (
          <div className="grid grid-cols-2 gap-3">
            <LabeledSelect label={t('Format', 'الصيغة')} value={format} onChange={(e) => setFormat(e.target.value)}><option value="XLSX">Excel (XLSX)</option><option value="CSV">CSV</option><option value="PDF">PDF</option></LabeledSelect>
            <LabeledSelect label={t('File language', 'لغة الملف')} value={lang} onChange={(e) => setLang(e.target.value as 'en' | 'ar')}><option value="en">English</option><option value="ar">العربية</option></LabeledSelect>
            <p className="col-span-2 text-xs text-gray-500">{t('The file uses exactly the filters you see. Money and personal data follow your permissions. XLSX is limited to 100,000 rows and PDF to 5,000; CSV has no such limit. Files are private and expire after 72 hours.', 'يستخدم الملف نفس الفلاتر الظاهرة. المبالغ والبيانات الشخصية حسب صلاحياتك. XLSX حتى 100,000 صف و PDF حتى 5,000؛ CSV بلا حد. الملفات خاصة وتنتهي بعد 72 ساعة.')}</p>
          </div>
        )}
        {job && (
          <div className="space-y-2 text-sm" aria-live="polite">
            <p>{t('Status', 'الحالة')}: <strong>{job.status}</strong>{job.rowCount != null && <span className="text-gray-500"> · {job.rowCount} {t('rows', 'صف')}</span>}</p>
            {['QUEUED', 'RUNNING'].includes(job.status) && <div className="h-2 w-full overflow-hidden rounded bg-gray-200"><div className="h-full bg-hatly-orange transition-all" style={{ width: `${Math.max(5, job.progress)}%` }} /></div>}
            {job.status === 'FAILED' && <p role="alert" className="text-red-700">{job.errorMessage ?? t('The export failed.', 'فشل التصدير.')}</p>}
            {done && <p className="text-green-700">{t('Ready. The file expires on', 'الملف جاهز. ينتهي في')} {new Date(job.expiresAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo' })}.</p>}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </Modal>
    </>
  );
}
