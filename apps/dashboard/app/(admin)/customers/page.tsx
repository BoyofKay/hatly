'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AdminCustomerListItem, searchAdminCustomers } from '../../../lib/api/admin-customers';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, Column, DataTable, inputCls, KpiCard, LabeledSelect, PageHeader, Pagination } from '../../../components/ui';
import { ICONS } from '../../../components/ui/icons';
import { useApi } from '../../../lib/ui/api';

/**
 * Admin Customer Management — search by name, phone or id, filter by account status, open a customer. Same list shape as Order Search:
 * results with an explicit count, labelled mobile cards, loading / empty / error states, server pagination.
 */
export default function CustomersPage() {
  const { t, date, num } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminCustomerListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const run = useCallback(async (targetPage: number, q: string, status: '' | 'active' | 'inactive') => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await searchAdminCustomers({ page: targetPage, search: q.trim() || undefined, isActive: status === '' ? undefined : status === 'active' });
      setItems(result.data);
      setTotal(result.meta.total);
      setLimit(result.meta.limit);
      setPage(result.meta.page);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to search customers.', 'تعذّر البحث عن العملاء.')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void run(1, '', '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Header figures: the same search endpoint's own totals (one row requested each), never computed in the browser.
  const allCount = useApi<unknown[]>('/admin/customers', { limit: 1 });
  const activeCount = useApi<unknown[]>('/admin/customers', { limit: 1, isActive: 'true' });
  const inactiveCount = useApi<unknown[]>('/admin/customers', { limit: 1, isActive: 'false' });

  const filtered = search.trim() !== '' || statusFilter !== '';
  const columns: Column<AdminCustomerListItem>[] = [
    { key: 'name', header: t('Name', 'الاسم'), cell: (c) => <Link href={`/customers/${c.id}`} className="font-medium text-gray-900 hover:underline">{c.fullName}</Link> },
    { key: 'phone', header: t('Phone', 'الهاتف'), cell: (c) => <span dir="ltr">{c.phone}</span> },
    { key: 'status', header: t('Status', 'الحالة'), cell: (c) => <Badge tone={c.isActive ? 'green' : 'gray'}>{c.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge> },
    { key: 'verified', header: t('Phone verified', 'الهاتف مُوثَّق'), cell: (c) => (c.isPhoneVerified ? t('Yes', 'نعم') : t('No', 'لا')) },
    { key: 'created', header: t('Created', 'تاريخ الإنشاء'), cell: (c) => <span className="whitespace-nowrap text-gray-600">{date(c.createdAt)}</span> },
    { key: 'open', header: '', align: 'end', cell: (c) => <Link href={`/customers/${c.id}`} className="inline-flex min-h-[36px] items-center font-medium text-hatly-orangeDark hover:underline">{t('Open', 'فتح')}</Link> },
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader title={t('Customers', 'العملاء')} subtitle={t('Look up a customer by name, phone or id, and see their orders and wallet.', 'ابحث عن عميل بالاسم أو الهاتف أو المعرّف، وشاهد طلباته ومحفظته.')} />

      {allCount.meta && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="customers-kpis">
          {([
            ['', t('All customers', 'كل العملاء'), allCount.meta?.total, ICONS.users],
            ['active', t('Active accounts', 'حسابات نشطة'), activeCount.meta?.total, ICONS.user],
            ['inactive', t('Deactivated accounts', 'حسابات موقوفة'), inactiveCount.meta?.total, ICONS.userOff],
          ] as const).map(([status, label, value, icon]) => (
            <button key={status || 'all'} type="button" onClick={() => { setStatusFilter(status); void run(1, search, status); }} className="rounded-2xl text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange">
              <KpiCard label={label} value={value === undefined ? '—' : num(value)} icon={icon} testId={`customers-kpi-${status || 'all'}`} />
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void run(1, search, statusFilter); }} className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Customer name, phone, or customer id', 'اسم العميل أو هاتفه أو معرّفه')} aria-label={t('Customer name, phone, or customer id', 'اسم العميل أو هاتفه أو معرّفه')} className={`${inputCls} min-h-[44px] flex-1 sm:min-h-0`} />
          <Button type="submit" variant="primary" loading={isLoading} className="min-h-[44px] sm:min-h-0">{isLoading ? t('Searching...', 'جارٍ البحث...') : t('Search', 'بحث')}</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem]">
            <LabeledSelect label={t('Account status', 'حالة الحساب')} value={statusFilter} onChange={(e) => { const v = e.target.value as '' | 'active' | 'inactive'; setStatusFilter(v); void run(1, search, v); }}>
              <option value="">{t('Any status', 'أي حالة')}</option>
              <option value="active">{t('Active', 'نشط')}</option>
              <option value="inactive">{t('Inactive', 'غير نشط')}</option>
            </LabeledSelect>
          </div>
          {filtered && <Button type="button" variant="ghost" className="min-h-[40px]" onClick={() => { setSearch(''); setStatusFilter(''); void run(1, '', ''); }}>{t('Clear filters', 'مسح الفلاتر')}</Button>}
        </div>
      </form>

      <Card pad={false}>
        {items && <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite">{t(`${total} customer${total === 1 ? '' : 's'}`, `${total} عميل`)}</p>}
        <DataTable
          columns={columns}
          rows={items ?? undefined}
          rowKey={(c) => c.id}
          loading={isLoading}
          error={error}
          onRetry={() => void run(page, search, statusFilter)}
          emptyTitle={t('No customers match this search.', 'لا يوجد عملاء مطابقون لهذا البحث.')}
          emptyHint={filtered ? t('Try removing a filter or checking the spelling.', 'جرّب إزالة أحد الفلاتر أو مراجعة الكتابة.') : undefined}
          onRowClick={(c) => router.push(`/customers/${c.id}`)}
        />
        {items && items.length > 0 && <Pagination page={page} limit={limit} total={total} onPage={(p) => void run(p, search, statusFilter)} />}
      </Card>
    </div>
  );
}
