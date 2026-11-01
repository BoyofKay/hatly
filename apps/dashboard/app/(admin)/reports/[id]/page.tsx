'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Async, Button, Card, DataTable, DateRange, FilterBar, LabeledInput, LabeledSelect, PageHeader, Pagination, cairoDate } from '../../../../components/ui';
import { send, useApi } from '../../../../lib/ui/api';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { useLang } from '../../../../lib/ui/lang';
import { ExportButton } from '../../../../components/reports/ExportButton';

export default function ReportRunnerPage() {
  const { t, locale, money, num } = useLang();
  const { id } = useParams<{ id: string }>();
  const def = useApi<any>(`/admin/reports/${id}`);
  const [params, setParams] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = def.data;

  useEffect(() => {
    if (!d) return;
    const init: Record<string, string> = {};
    if (d.params.some((p: any) => p.key === 'from')) { init.from = cairoDate(-29); init.to = cairoDate(0); }
    setParams(init);
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (p = 1) => {
    setRunning(true); setError(null);
    try {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v));
      const r = await send<any>('post', `/admin/reports/${id}/run`, { params: clean, page: p, limit: 50 });
      setResult(r); setPage(p);
    } catch (e) { setError(apiErrorMessage(e, t('The report could not be run.', 'تعذّر تشغيل التقرير.'))); }
    finally { setRunning(false); }
  };
  useEffect(() => { if (d && Object.keys(params).length >= 0 && result === null && !running) void run(1); }, [d, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (c: any, v: any) => {
    if (v === null || v === undefined || v === '') return '—';
    if (c.type === 'money') return money(Number(v));
    if (c.type === 'int') return num(Number(v));
    if (c.type === 'percent') return `${v}%`;
    if (c.type === 'bool') return v ? t('Yes', 'نعم') : t('No', 'لا');
    return <bdi>{String(v)}</bdi>;
  };
  const columns = (result?.columns ?? d?.columns ?? []).map((c: any) => ({ key: c.key, header: locale === 'ar' ? c.ar : c.en, align: ['money', 'int', 'percent'].includes(c.type) ? ('end' as const) : ('start' as const), cell: (r: any) => fmt(c, r[c.key]) }));
  const hasRange = d?.params.some((p: any) => p.key === 'from');

  return (
    <div>
      <PageHeader title={d ? (locale === 'ar' ? d.ar : d.en) : t('Report', 'تقرير')} subtitle={d ? (locale === 'ar' ? d.descriptionAr : d.descriptionEn) : undefined} actions={<><Link href="/reports" className="text-sm text-gray-600 hover:underline">{t('← All reports', '← كل التقارير')}</Link>{d?.canExport && <ExportButton report={id} params={params} />}</>} />
      <Async state={def}>
        {d && (
          <>
            {(d.moneyHidden || d.piiMasked) && <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">{d.moneyHidden && t('Money columns are hidden for your permissions. ', 'أعمدة المبالغ مخفية حسب صلاحياتك. ')}{d.piiMasked && t('Customer names and phones are masked.', 'أسماء العملاء وهواتفهم مقنَّعة.')}</p>}
            <FilterBar>
              {hasRange && <DateRange from={params.from ?? ''} to={params.to ?? ''} onChange={(f, tt) => setParams({ ...params, from: f, to: tt })} />}
              {d.params.filter((p: any) => p.key !== 'from' && p.key !== 'to').map((p: any) => p.type === 'enum' ? (
                <div key={p.key} className="w-48"><LabeledSelect label={locale === 'ar' ? p.ar : p.en} value={params[p.key] ?? ''} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}><option value="">{t('All', 'الكل')}</option>{p.options.map((o: string) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}</LabeledSelect></div>
              ) : (
                <div key={p.key} className="w-56"><LabeledInput label={locale === 'ar' ? p.ar : p.en} value={params[p.key] ?? ''} onChange={(e) => setParams({ ...params, [p.key]: e.target.value })} /></div>
              ))}
              <Button variant="primary" loading={running} onClick={() => run(1)}>{t('Run report', 'تشغيل التقرير')}</Button>
            </FilterBar>
            {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Card pad={false}>
              <DataTable rows={result?.rows} rowKey={(r: any) => JSON.stringify(r)} loading={running} error={null} columns={columns} emptyTitle={t('No rows for these filters', 'لا توجد صفوف لهذه الفلاتر')} footer={result?.totals ? (
                <tfoot><tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">{columns.map((c: any, i: number) => { const col = result.columns[i]; return <td key={c.key} className={`px-3 py-2 ${c.align === 'end' ? 'text-end tabular-nums' : ''}`}>{i === 0 ? t('Total (all rows)', 'الإجمالي (كل الصفوف)') : result.totals[col.key] !== undefined ? fmt(col, result.totals[col.key]) : ''}</td>; })}</tr></tfoot>
              ) : undefined} />
              {result && result.rowCount > result.limit && <Pagination page={page} limit={result.limit} total={result.rowCount} onPage={(p) => run(p)} />}
              {result && <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">{t(`${num(result.rowCount)} rows · generated`, `${num(result.rowCount)} صف · أُنشئ`)} {new Date(result.generatedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })} ({result.timezone})</p>}
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}
