'use client';

import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, DataTable, FilterBar, LabeledSelect, PageHeader, Pagination, useToast, usePaging } from '../../../components/ui';
import { send, useApi } from '../../../lib/ui/api';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';

export default function ReviewsPage() {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [hidden, setHidden] = useState('false');
  const [stars, setStars] = useState('');
  const { page, setPage, limit } = usePaging(JSON.stringify([target, hidden, stars]));
  const list = useApi<any[]>('/admin/ratings', { target: target || undefined, hidden: hidden || undefined, stars: stars || undefined, page, limit });
  const [hide, setHide] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doHide = async (reason: string) => {
    setBusy(true); setError(null);
    try { await send('post', `/admin/ratings/${hide.target}/${hide.id}/hide`, { reason }); toast.push('success', t('Hidden. The average rating was recalculated.', 'أُخفي. أُعيد حساب متوسط التقييم.')); setHide(null); list.reload(); }
    catch (e) { setError(apiErrorMessage(e, t('Could not hide.', 'تعذّر الإخفاء.'))); } finally { setBusy(false); }
  };
  const unhide = async (r: any) => { try { await send('post', `/admin/ratings/${r.target}/${r.id}/unhide`); toast.push('success', t('Visible again.', 'عاد ظاهرًا.')); list.reload(); } catch (e) { toast.push('error', apiErrorMessage(e, t('Could not restore.', 'تعذّرت الاستعادة.'))); } };
  return (
    <div>
      <PageHeader title={t('Reviews', 'التقييمات')} subtitle={t('Hide abusive or false ratings. Hiding never deletes a rating; the vendor/driver/product average is recalculated from the visible ratings in the same transaction.', 'أخفِ التقييمات المسيئة أو الكاذبة. الإخفاء لا يحذف التقييم، ويُعاد حساب متوسط المورد/السائق/المنتج من التقييمات الظاهرة في المعاملة نفسها.')} />
      <FilterBar>
        <div className="w-44"><LabeledSelect label={t('About', 'عن')} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="vendor">{t('Vendors', 'الموردين')}</option><option value="driver">{t('Drivers', 'السائقين')}</option><option value="product">{t('Products', 'المنتجات')}</option></LabeledSelect></div>
        <div className="w-40"><LabeledSelect label={t('Visibility', 'الظهور')} value={hidden} onChange={(e) => setHidden(e.target.value)}><option value="false">{t('Visible', 'ظاهرة')}</option><option value="true">{t('Hidden', 'مخفية')}</option><option value="">{t('All', 'الكل')}</option></LabeledSelect></div>
        <div className="w-32"><LabeledSelect label={t('Stars', 'النجوم')} value={stars} onChange={(e) => setStars(e.target.value)}><option value="">{t('All', 'الكل')}</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => `${r.target}${r.id}`} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No ratings', 'لا توجد تقييمات')} columns={[
          { key: 'at', header: t('Time', 'الوقت'), cell: (r) => dateTime(r.createdAt) },
          { key: 'tg', header: t('About', 'عن'), cell: (r) => <span><Badge>{r.target}</Badge> <bdi>{r.subject ?? '—'}</bdi></span> },
          { key: 's', header: t('Stars', 'النجوم'), cell: (r) => <span title={String(r.stars)}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span> },
          { key: 'c', header: t('Comment', 'التعليق'), cell: (r) => <span className="line-clamp-2 max-w-md"><bdi>{r.comment ?? '—'}</bdi></span> },
          { key: 'h', header: t('State', 'الحالة'), cell: (r) => (r.hidden ? <Badge tone="red" title={r.hiddenReason}>{t('Hidden', 'مخفي')}</Badge> : <Badge tone="green">{t('Visible', 'ظاهر')}</Badge>) },
          { key: 'a', header: '', align: 'end', cell: (r) => (r.hidden ? <Button size="sm" onClick={() => unhide(r)}>{t('Unhide', 'إظهار')}</Button> : <Button size="sm" onClick={() => { setError(null); setHide(r); }}>{t('Hide…', 'إخفاء…')}</Button>) },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <ConfirmDialog open={Boolean(hide)} title={t('Hide this rating?', 'إخفاء هذا التقييم؟')} message={t('It disappears from the app and the average is recalculated. You can show it again later.', 'يختفي من التطبيق ويُعاد حساب المتوسط. يمكن إظهاره لاحقًا.')} confirmLabel={t('Hide', 'إخفاء')} danger reasonLabel={t('Reason (required)', 'السبب (مطلوب)')} reasonMin={5} busy={busy} error={error} onConfirm={doHide} onClose={() => setHide(null)} />
    </div>
  );
}
