'use client';

import { useState } from 'react';
import { MenuImportSummary, checkMenuFile, downloadMenuTemplate, importMenuFile } from '../../lib/api/admin-menu-import';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Badge, Button } from '../ui';

/**
 * Upload a whole menu: download the template → fill it → upload the .xlsx (or a .zip with the .xlsx + photos) → "Check file" lists every
 * problem by row → "Import" saves everything in one go (or nothing, if anything is wrong). Replaces the old update-only Excel import here.
 */
export function MenuImportPanel({ branchId, branchName, onImported }: { branchId: string; branchName: string; onImported: () => void | Promise<void> }) {
  const { t } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<MenuImportSummary | null>(null);
  const [busy, setBusy] = useState<'download' | 'check' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy('download');
    setError(null);
    try {
      const blob = await downloadMenuTemplate(branchId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hatly-menu-${branchName.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) || 'branch'}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not download the template.', 'تعذّر تنزيل القالب.')));
    } finally {
      setBusy(null);
    }
  }

  async function run(step: 'check' | 'import') {
    if (!file) return;
    setBusy(step);
    setError(null);
    try {
      const res = step === 'check' ? await checkMenuFile(branchId, file) : await importMenuFile(branchId, file);
      setSummary(res);
      if (res.status === 'APPLIED') await onImported();
    } catch (err: any) {
      const failed = err?.response?.data?.error?.details?.summary as MenuImportSummary | undefined;
      if (failed) setSummary(failed);
      setError(apiErrorMessage(err, t('The import failed. Nothing was saved.', 'فشل الاستيراد. لم يُحفظ أي شيء.')));
    } finally {
      setBusy(null);
    }
  }

  const c = summary?.counts;
  const problems = summary?.rows.filter((r) => r.errors.length > 0) ?? [];

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-orange-100 bg-orange-50/40 p-4" data-testid="menu-import">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{t('Import a menu from Excel', 'استيراد المنيو من إكسل')}</h3>
        <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-xs text-gray-600">
          <li>{t('Download the template (it already lists this branch’s products, if any).', 'نزّل القالب (يحتوي منتجات هذا الفرع إن وجدت).')}</li>
          <li>{t('Fill the Menu sheet (and Options for sizes / add-ons). Empty productId = new product.', 'املأ ورقة Menu (وOptions للأحجام والإضافات). productId فارغ = منتج جديد.')}</li>
          <li>{t('With photos: put the .xlsx and the photos in one .zip and write each photo’s file name in the "image" column.', 'مع الصور: ضع ملف الإكسل والصور في ملف ‎.zip واحد واكتب اسم كل صورة في عمود image.')}</li>
          <li>{t('Upload → Check file → Import. If any row has a problem, nothing is saved.', 'ارفع ← افحص الملف ← استيراد. إذا وُجدت مشكلة في أي صف لا يُحفظ شيء.')}</li>
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void download()} loading={busy === 'download'}>{t('Download template', 'تنزيل القالب')}</Button>
        <input
          type="file"
          accept=".xlsx,.zip,application/zip,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label={t('Menu file (.xlsx or .zip)', 'ملف المنيو (‎.xlsx أو ‎.zip)')}
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSummary(null); setError(null); }}
          className="max-w-full text-sm"
        />
        <Button size="sm" variant="primary" disabled={!file} loading={busy === 'check'} onClick={() => void run('check')}>{t('Check file', 'فحص الملف')}</Button>
        {summary?.status === 'READY' && <Button size="sm" variant="primary" loading={busy === 'import'} onClick={() => void run('import')}>{t('Import', 'استيراد')}</Button>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {summary && c && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={summary.status === 'FAILED' ? 'gray' : 'green'}>
              {summary.status === 'FAILED' ? t('Has problems', 'به مشكلات') : summary.status === 'READY' ? t('Ready to import', 'جاهز للاستيراد') : t('Imported', 'تم الاستيراد')}
            </Badge>
            <span>{t(`${c.newProducts} new · ${c.updatedProducts} updated · ${c.unchangedProducts} unchanged · ${c.newCategories} new categories · ${c.optionGroups} option groups · ${c.photos} photos`, `${c.newProducts} جديد · ${c.updatedProducts} معدّل · ${c.unchangedProducts} بدون تغيير · ${c.newCategories} أقسام جديدة · ${c.optionGroups} مجموعات اختيارات · ${c.photos} صور`)}</span>
          </div>
          {problems.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-red-100 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-red-50 text-start">
                  <tr><th className="p-2 text-start">{t('Sheet', 'الورقة')}</th><th className="p-2 text-start">{t('Row', 'الصف')}</th><th className="p-2 text-start">{t('Item', 'العنصر')}</th><th className="p-2 text-start">{t('Problem', 'المشكلة')}</th></tr>
                </thead>
                <tbody>
                  {problems.map((r, i) => (
                    <tr key={i} className="border-t border-red-50 align-top">
                      <td className="p-2">{r.sheet}</td>
                      <td className="p-2" dir="ltr">{r.rowNumber ?? '—'}</td>
                      <td className="p-2"><bdi>{r.label ?? '—'}</bdi></td>
                      <td className="p-2 text-red-700">{r.errors.join(' • ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
