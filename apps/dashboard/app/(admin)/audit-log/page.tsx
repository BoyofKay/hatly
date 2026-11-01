'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { AuditLogItem, listAuditLogs } from '../../../lib/api/admin-audit-log';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, EmptyState, ErrorState, inputCls, LabeledInput, LabeledSelect, PageHeader, Pagination, Skeleton } from '../../../components/ui';

/**
 * Audit log — read-only view of the append-only admin audit trail: who did what, to which object, from which address. There is deliberately no edit or
 * delete control: the table is append-only in the database and the API has no write route. Filter by action, outcome, actor and time; open an entry for
 * its full detail. Phones get one card per entry instead of the wide table.
 */
const KNOWN_ACTIONS = [
  'admin.mutation',
  'auth.dashboard_login',
  'auth.dashboard_login_failed',
  'auth.dashboard_logout',
  'mfa.setup_started',
  'mfa.enabled',
  'mfa.disabled',
  'mfa.recovery_code_used',
  'mfa.reset_by_admin',
  'mfa.verify_failed',
  'permission.granted',
  'permission.revoked',
  'vendor_staff.created',
  'vendor_staff.activated',
  'vendor_staff.deactivated',
  'vendor_staff.branch_assigned',
  'vendor_staff.branch_unassigned',
  'branch_closure.created',
  'branch_closure.cancelled',
  'stocktake.started',
  'stocktake.applied',
  'stocktake.cancelled',
  'vendor_settlement_terms.set',
  'business_config.changed',
  'sector.custom_requests_changed',
  'customer.account_deleted',
  'customer.account_deletion_request_rejected',
];

/** `datetime-local` gives local wall-clock text; the API wants an ISO instant. Empty / unparsable input means "no bound". */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function AuditLogPage() {
  const { t, dateTime } = useLang();
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState<'' | 'SUCCESS' | 'FAILURE'>('');
  const [actorUserId, setActorUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AuditLogItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const run = useCallback(async (targetPage: number) => {
    setIsLoading(true);
    setError(null);
    setExpanded(null);
    try {
      const result = await listAuditLogs({ page: targetPage, action: action || undefined, outcome: outcome || undefined, actorUserId: actorUserId.trim() || undefined, from: toIso(from), to: toIso(to) });
      setItems(result.data);
      setTotal(result.meta.total);
      setLimit(result.meta.limit);
      setPage(result.meta.page);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load the audit log.', 'تعذّر تحميل سجل المراجعة.')));
    } finally {
      setIsLoading(false);
    }
  }, [action, outcome, actorUserId, from, to, t]);

  useEffect(() => {
    void run(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = !!(action || outcome || actorUserId.trim() || from || to);
  const clear = () => { setAction(''); setOutcome(''); setActorUserId(''); setFrom(''); setTo(''); setTimeout(() => void run(1), 0); };

  const outcomeBadge = (o: string) => <Badge tone={o === 'SUCCESS' ? 'green' : 'red'}>{o === 'SUCCESS' ? t('Success', 'نجاح') : o === 'FAILURE' ? t('Failure', 'فشل') : o}</Badge>;
  const detailGrid = (row: AuditLogItem) => (
    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-gray-500">{t('Entry id', 'معرّف السجل')}</dt>
      <dd className="break-all font-mono" dir="ltr">{row.id}</dd>
      {row.actorUserId && (<><dt className="text-gray-500">{t('Actor id', 'معرّف المنفّذ')}</dt><dd className="break-all font-mono" dir="ltr">{row.actorUserId}</dd></>)}
      {Object.entries(row.metadata).map(([k, v]) => (
        <Fragment key={k}><dt className="text-gray-500">{k}</dt><dd className="break-words">{String(v)}</dd></Fragment>
      ))}
    </dl>
  );

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('Audit log', 'سجل المراجعة')} subtitle={t('Read-only record of privileged actions: who did what, to which object, from which address. Entries cannot be changed or deleted.', 'سجل للقراءة فقط للإجراءات الحساسة: من فعل ماذا، وعلى أي عنصر، ومن أي عنوان. لا يمكن تعديل السجلات أو حذفها.')} />

      <form onSubmit={(e) => { e.preventDefault(); void run(1); }} className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LabeledSelect label={t('Action', 'الإجراء')} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('Any action', 'أي إجراء')}</option>
            {KNOWN_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </LabeledSelect>
          <LabeledSelect label={t('Outcome', 'النتيجة')} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
            <option value="">{t('Any outcome', 'أي نتيجة')}</option>
            <option value="SUCCESS">{t('Success', 'نجاح')}</option>
            <option value="FAILURE">{t('Failure', 'فشل')}</option>
          </LabeledSelect>
          <div className="sm:col-span-2"><LabeledInput label={t('Actor user id', 'معرّف المنفّذ')} dir="ltr" value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} placeholder="uuid" /></div>
          <div>
            <label htmlFor="al-from" className="mb-1 block text-xs font-medium text-gray-700">{t('From', 'من')}</label>
            <input id="al-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="al-to" className="mb-1 block text-xs font-medium text-gray-700">{t('To', 'إلى')}</label>
            <input id="al-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={isLoading} className="min-h-[44px] sm:min-h-0">{isLoading ? t('Loading...', 'جارٍ التحميل...') : t('Apply', 'تطبيق')}</Button>
          {filtered && <Button type="button" variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={clear}>{t('Clear filters', 'مسح الفلاتر')}</Button>}
        </div>
      </form>

      {error && <div data-testid="audit-error"><ErrorState message={error} onRetry={() => void run(page)} /></div>}
      {!error && items === null && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
      {!error && items !== null && items.length === 0 && <Card><EmptyState title={t('No audit entries match these filters.', 'لا توجد سجلات مطابقة لهذه الفلاتر.')} /></Card>}

      {!error && items !== null && items.length > 0 && (
        <Card pad={false}>
          <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite">{t(`${total} entr${total === 1 ? 'y' : 'ies'}`, `${total} سجل`)}</p>
          <div className={`hidden overflow-x-auto md:block ${isLoading ? 'opacity-60' : ''}`}>
            <table className="min-w-full text-sm" data-testid="audit-table">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  {[t('When', 'الوقت'), t('Actor', 'المنفّذ'), t('Action', 'الإجراء'), t('Target', 'الهدف'), t('Outcome', 'النتيجة'), t('Address', 'العنوان'), ''].map((h, i) => <th key={i} scope="col" className="px-3 py-2 text-start font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50" data-testid="audit-row">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{dateTime(row.createdAt)}</td>
                      <td className="px-3 py-2">{row.actorName ?? <span className="text-gray-400">{t('unknown', 'غير معروف')}</span>}{row.actorRole && <span className="ms-1 text-xs text-gray-500">({row.actorRole})</span>}</td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">{row.action}</td>
                      <td className="px-3 py-2 text-xs">{row.targetType ?? '—'}{row.targetRef ? ` · ${row.targetRef}` : ''}</td>
                      <td className="px-3 py-2">{outcomeBadge(row.outcome)}</td>
                      <td className="px-3 py-2 text-xs" dir="ltr">{row.ipAddress ?? '—'}</td>
                      <td className="px-3 py-2 text-end"><button onClick={() => setExpanded(expanded === row.id ? null : row.id)} className="min-h-[36px] font-medium text-hatly-orangeDark hover:underline" aria-expanded={expanded === row.id}>{expanded === row.id ? t('Hide', 'إخفاء') : t('Details', 'التفاصيل')}</button></td>
                    </tr>
                    {expanded === row.id && <tr className="border-b border-gray-100 bg-gray-50" data-testid="audit-details"><td colSpan={7} className="px-3 py-3">{detailGrid(row)}</td></tr>}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-gray-100 md:hidden">
            {items.map((row) => (
              <li key={row.id} className="space-y-1.5 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-mono text-xs font-semibold" dir="ltr">{row.action}</span>
                  {outcomeBadge(row.outcome)}
                </div>
                <p className="text-xs text-gray-500">{dateTime(row.createdAt)} · {row.actorName ?? t('unknown', 'غير معروف')}{row.actorRole && ` (${row.actorRole})`}</p>
                {(row.targetType || row.targetRef) && <p className="break-words text-xs text-gray-600">{row.targetType ?? '—'}{row.targetRef ? ` · ${row.targetRef}` : ''}</p>}
                <button onClick={() => setExpanded(expanded === row.id ? null : row.id)} className="min-h-[36px] text-xs font-medium text-hatly-orangeDark" aria-expanded={expanded === row.id}>{expanded === row.id ? t('Hide', 'إخفاء') : t('Details', 'التفاصيل')}</button>
                {expanded === row.id && <div className="rounded-lg bg-gray-50 p-2">{detailGrid(row)}</div>}
              </li>
            ))}
          </ul>
          <Pagination page={page} limit={limit} total={total} onPage={(p) => void run(p)} />
        </Card>
      )}
    </div>
  );
}
