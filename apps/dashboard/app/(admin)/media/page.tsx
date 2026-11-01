'use client';

import { useState } from 'react';
import { Async, Badge, Button, Card, ConfirmDialog, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, StatusPill, Tabs, useDebounced, usePaging, useToast, FilterBar } from '../../../components/ui';
import { resolveMediaUrl } from '../../../lib/media-url';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { MediaUploader, PURPOSE_LABELS } from '../../../components/media/MediaUploader';

export default function MediaLibraryPage() {
  const { t, locale, num, dateTime } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const [tab, setTab] = useState('library');
  const [q, setQ] = useState('');
  const [purpose, setPurpose] = useState('');
  const [used, setUsed] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [upload, setUpload] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);
  const [altEn, setAltEn] = useState('');
  const [altAr, setAltAr] = useState('');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([search, purpose, used, status]), 24);
  const list = useApi<any[]>('/admin/media', { q: search || undefined, purpose: purpose || undefined, used: used || undefined, status, page, limit });
  const stats = useApi<any>('/admin/media/stats', undefined, { refreshInterval: 0 });
  const usage = useApi<any>(detail ? `/admin/media/${detail.id}/usage` : null);
  const [purgeResult, setPurgeResult] = useState<any>(null);
  const [backfill, setBackfill] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can('MANAGE_MEDIA');
  const canDelete = can('MEDIA_DELETE');

  const open = (a: any) => { setDetail(a); setAltEn(a.altEn ?? ''); setAltAr(a.altAr ?? ''); };
  const saveAlt = async () => { try { await send('patch', `/admin/media/${detail.id}`, { altEn, altAr }); toast.push('success', t('Saved.', 'تم الحفظ.')); list.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not save.', 'تعذّر الحفظ.'))); } };
  const remove = async () => {
    setDelBusy(true); setDelError(null);
    try { await send('delete', `/admin/media/${del.id}`); toast.push('success', t('Moved to deleted (restorable).', 'نُقلت إلى المحذوفات (قابلة للاستعادة).')); setDel(null); setDetail(null); list.reload(); stats.reload(); }
    catch (e) { setDelError(apiErrorMessage(e, t('Could not delete.', 'تعذّر الحذف.'))); } finally { setDelBusy(false); }
  };
  const restore = async (a: any) => { try { await send('post', `/admin/media/${a.id}/restore`); toast.push('success', t('Restored.', 'تمت الاستعادة.')); setDetail(null); list.reload(); stats.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not restore.', 'تعذّرت الاستعادة.'))); } };
  const purge = async (dryRun: boolean) => { setBusy(true); try { setPurgeResult(await send('post', '/admin/media-purge', { dryRun })); if (!dryRun) stats.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Purge failed.', 'فشل التطهير.'))); } finally { setBusy(false); } };
  const runBackfill = async () => { setBusy(true); try { setBackfill(await send('post', '/admin/media-backfill', { limit: 25 })); stats.reload(); list.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Backfill failed.', 'فشلت التهيئة.'))); } finally { setBusy(false); } };

  return (
    <div>
      <PageHeader title={t('Media library', 'مكتبة الوسائط')} subtitle={t('Every image goes through direct upload: type checked from the bytes, EXIF/GPS removed, WebP display and thumbnail versions generated. An image that is in use cannot be deleted, and nothing in use or in order history is ever purged.', 'كل صورة تُرفع مباشرة: يُفحص النوع من البايتات، وتُزال بيانات EXIF/GPS، وتُنشأ نسخ WebP للعرض والمصغّرة. لا تُحذف صورة قيد الاستخدام، ولا يُطهَّر شيء مستخدم أو مرتبط بسجل الطلبات.')} actions={canManage || can('MANAGE_CATALOG') ? <Button variant="primary" onClick={() => setUpload(true)}>{t('Upload images', 'رفع صور')}</Button> : undefined} />
      <Tabs tabs={[{ id: 'library', label: t('Library', 'المكتبة') }, { id: 'cleanup', label: t('Cleanup & storage', 'التنظيف والتخزين') }]} value={tab} onChange={setTab} />
      {tab === 'library' ? (
        <>
          <FilterBar onClear={() => { setQ(''); setPurpose(''); setUsed(''); setStatus('ACTIVE'); }}>
            <div className="w-56"><LabeledInput label={t('Search name or alt text', 'بحث بالاسم أو النص البديل')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="w-52"><LabeledSelect label={t('Purpose', 'الغرض')} value={purpose} onChange={(e) => setPurpose(e.target.value)}><option value="">{t('All', 'الكل')}</option>{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{locale === 'ar' ? v[1] : v[0]}</option>)}</LabeledSelect></div>
            <div className="w-40"><LabeledSelect label={t('Usage', 'الاستخدام')} value={used} onChange={(e) => setUsed(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('In use', 'قيد الاستخدام')}</option><option value="false">{t('Unused', 'غير مستخدمة')}</option></LabeledSelect></div>
            <div className="w-40"><LabeledSelect label={t('State', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">{t('Active', 'نشطة')}</option><option value="DELETED">{t('Deleted', 'محذوفة')}</option></LabeledSelect></div>
          </FilterBar>
          <Card pad={false}>
            <Async state={list} empty={list.data && list.data.length === 0} emptyTitle={t('No images found', 'لا توجد صور')}>
              <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {(list.data ?? []).map((a) => (
                  <li key={a.id}>
                    <button onClick={() => open(a)} className="group block w-full text-start">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.thumb?.url ? resolveMediaUrl(a.thumb.url) : undefined} alt={(locale === 'ar' ? a.altAr : a.altEn) ?? a.originalName ?? ''} loading="lazy" className="aspect-square w-full rounded-lg border border-gray-200 bg-gray-100 object-cover group-hover:border-hatly-orange" />
                      <p className="mt-1 truncate text-xs text-gray-700"><bdi>{a.originalName ?? '—'}</bdi></p>
                      <p className="flex flex-wrap gap-1 text-[10px] text-gray-500">{a.used ? <Badge tone="green">{t('In use', 'مستخدمة')}</Badge> : <Badge>{t('Unused', 'غير مستخدمة')}</Badge>}{a.legacy && <Badge tone="blue">{t('Legacy', 'قديمة')}</Badge>}</p>
                    </button>
                  </li>
                ))}
              </ul>
              {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
            </Async>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title={t('Storage', 'التخزين')}>
            <Async state={stats} rows={2}>
              {stats.data && <dl className="grid grid-cols-2 gap-2 text-sm"><dt className="text-gray-500">{t('Active images', 'صور نشطة')}</dt><dd className="text-end tabular-nums">{num(stats.data.active)}</dd><dt className="text-gray-500">{t('Soft-deleted', 'محذوفة (قابلة للاستعادة)')}</dt><dd className="text-end tabular-nums">{num(stats.data.softDeleted)}</dd><dt className="text-gray-500">{t('Registered legacy images', 'صور قديمة مسجلة')}</dt><dd className="text-end tabular-nums">{num(stats.data.legacyRegistered)}</dd><dt className="text-gray-500">{t('Unreferenced', 'غير مرتبطة')}</dt><dd className="text-end tabular-nums">{num(stats.data.unreferenced)}</dd><dt className="text-gray-500">{t('Stored bytes', 'البايتات المخزنة')}</dt><dd className="text-end tabular-nums">{(stats.data.storedBytes / 1024 / 1024).toFixed(1)} MB</dd><dt className="text-gray-500">{t('Retention before purge', 'مدة الاحتفاظ قبل التطهير')}</dt><dd className="text-end tabular-nums">{stats.data.retentionDays} {t('days', 'يوم')}</dd></dl>}
            </Async>
          </Card>
          <Card title={t('Register existing images', 'تسجيل الصور الحالية')}>
            <p className="mb-3 text-xs text-gray-500">{t('Existing pictures keep working exactly as they are. This registers them in the library and creates WebP display/thumbnail versions next to them — no URL or file is changed. Run it repeatedly until nothing remains.', 'تظل الصور الحالية تعمل كما هي. هذا يسجلها في المكتبة وينشئ نسخ WebP للعرض والمصغّرة بجانبها دون تغيير أي رابط أو ملف. كرّره حتى لا يتبقى شيء.')}</p>
            <Button loading={busy} disabled={!canManage} onClick={runBackfill}>{t('Register next 25', 'تسجيل أول 25')}</Button>
            {backfill && <p className="mt-2 text-xs text-gray-600">{t(`Registered ${backfill.processed}; ${backfill.remaining} remaining.`, `تم تسجيل ${backfill.processed}؛ المتبقي ${backfill.remaining}.`)} {backfill.message}</p>}
          </Card>
          <Card title={t('Purge deleted images', 'تطهير الصور المحذوفة')} className="lg:col-span-2">
            <p className="mb-3 text-xs text-gray-500">{t('Only images deleted for longer than the retention period that nothing references — neither a live record nor an order snapshot — are physically removed. Preview first.', 'تُزال فعليًا فقط الصور المحذوفة منذ أكثر من مدة الاحتفاظ والتي لا يشير إليها شيء — لا سجل حي ولا لقطة طلب. عاين أولًا.')}</p>
            <div className="flex gap-2"><Button loading={busy} disabled={!canDelete} onClick={() => purge(true)}>{t('Preview', 'معاينة')}</Button><Button variant="danger" loading={busy} disabled={!canDelete || !purgeResult?.dryRun || purgeResult.purged.length === 0} onClick={() => purge(false)}>{t('Purge now', 'تطهير الآن')}</Button></div>
            {purgeResult && <p className="mt-2 text-xs text-gray-600">{purgeResult.dryRun ? t('Would purge', 'سيُطهَّر') : t('Purged', 'تم تطهير')}: {purgeResult.purged.length}; {t('kept (referenced)', 'محفوظة (مرتبطة)')}: {purgeResult.skipped.length}</p>}
          </Card>
        </div>
      )}

      <Modal open={upload} wide title={t('Upload images', 'رفع صور')} onClose={() => setUpload(false)}>
        <MediaUploader onUploaded={() => { list.reload(); stats.reload(); }} />
      </Modal>

      <Modal open={Boolean(detail)} wide title={detail?.originalName ?? t('Image', 'صورة')} onClose={() => setDetail(null)} footer={detail && (detail.status === 'DELETED' ? (canDelete ? <Button variant="primary" onClick={() => restore(detail)}>{t('Restore', 'استعادة')}</Button> : null) : canDelete ? <Button variant="danger" onClick={() => { setDelError(null); setDel(detail); }}>{t('Delete', 'حذف')}</Button> : null)}>
        {detail && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detail.display?.url ? resolveMediaUrl(detail.display.url) : undefined} alt={detail.altEn ?? ''} className="max-h-72 w-full rounded-lg border border-gray-200 bg-gray-100 object-contain" />
            <div className="space-y-3 text-sm">
              <dl className="grid grid-cols-2 gap-1 text-xs"><dt className="text-gray-500">{t('Purpose', 'الغرض')}</dt><dd>{detail.purpose}</dd><dt className="text-gray-500">{t('Size', 'الحجم')}</dt><dd>{detail.display?.width}×{detail.display?.height} · {Math.round((detail.display?.bytes ?? 0) / 1024)} KB</dd><dt className="text-gray-500">{t('Uploaded', 'رُفعت')}</dt><dd>{dateTime(detail.createdAt)}</dd><dt className="text-gray-500">{t('State', 'الحالة')}</dt><dd><StatusPill status={detail.status === 'ACTIVE' ? 'ACTIVE' : 'EXPIRED'} label={detail.status} /></dd></dl>
              {canManage && <div className="space-y-2"><LabeledInput label={t('Alt text (English)', 'نص بديل (إنجليزي)')} value={altEn} onChange={(e) => setAltEn(e.target.value)} /><LabeledInput label={t('Alt text (Arabic)', 'نص بديل (عربي)')} value={altAr} onChange={(e) => setAltAr(e.target.value)} dir="rtl" /><Button size="sm" onClick={saveAlt}>{t('Save alt text', 'حفظ النص البديل')}</Button></div>}
              <div>
                <p className="mb-1 text-xs font-semibold text-gray-700">{t('Where it is used', 'أين تُستخدم')}</p>
                <Async state={usage} rows={2}>
                  {usage.data && (usage.data.references.length === 0 ? <p className="text-xs text-gray-500">{t('Not used anywhere.', 'غير مستخدمة في أي مكان.')}</p> : <ul className="space-y-1 text-xs">{usage.data.references.map((r: any) => <li key={`${r.type}${r.id}${r.field}`}><Badge>{r.type}</Badge> <bdi>{r.label}</bdi> · {r.field}</li>)}</ul>)}
                  {usage.data?.historicalSnapshots > 0 && <p className="mt-1 text-xs text-gray-500">{t(`Also kept in ${usage.data.historicalSnapshots} past order item(s) — never purged.`, `محفوظة أيضًا في ${usage.data.historicalSnapshots} من بنود الطلبات السابقة — لا تُطهَّر أبدًا.`)}</p>}
                </Async>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(del)} title={t('Delete this image?', 'حذف هذه الصورة؟')} message={t('It moves to Deleted and can be restored. It is refused while any record still uses it.', 'تنتقل إلى المحذوفات ويمكن استعادتها. يُرفض الحذف ما دام أي سجل يستخدمها.')} confirmLabel={t('Delete', 'حذف')} danger busy={delBusy} error={delError} onConfirm={remove} onClose={() => setDel(null)} />
    </div>
  );
}
