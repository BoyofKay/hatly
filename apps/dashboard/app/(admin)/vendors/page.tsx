'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, DataTable, FilterBar, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, useToast } from '../../../components/ui';
import { createVendor, type Vendor } from '../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';

/**
 * Vendor directory — consumes `GET/POST admin/vendors`. Only `name`/`nameAr`/`logoUrl` are collected when creating — `category`/`commissionPercent`
 * are excluded, per the closed decision. A newly created vendor is NEVER auto-activated here; the backend itself starts it inactive.
 */
export default function VendorsPage() {
  const { t, num, locale } = useLang();
  const { can } = usePermissions();
  const toast = useToast();
  const list = useApi<Vendor[]>('/admin/vendors');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = list.data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((v) => (status === '' || (status === 'ACTIVE') === v.isActive) && (!needle || `${v.name} ${v.nameAr ?? ''}`.toLowerCase().includes(needle)));
  }, [all, q, status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createVendor({ name, nameAr: nameAr || undefined, logoUrl: logoUrl || undefined });
      setName(''); setNameAr(''); setLogoUrl(''); setOpen(false);
      toast.push('success', t('Vendor created. It stays inactive until you activate it.', 'تم إنشاء المورد. يبقى غير مفعّل حتى تفعّله.'));
      list.reload();
    } catch (err) {
      setError(apiErrorMessage(err, t('Failed to create vendor.', 'تعذّر إنشاء المورد.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('Vendors', 'الموردون')}
        subtitle={t('Every vendor on the platform. Open a vendor to manage its branches, staff, hours and commission.', 'كل الموردين على المنصة. افتح المورد لإدارة فروعه وموظفيه ومواعيده وعمولته.')}
        actions={can('MANAGE_VENDORS') ? <Button variant="primary" onClick={() => setOpen(true)}>{t('New Vendor', 'مورد جديد')}</Button> : undefined}
      />
      <div className="mb-4 grid grid-cols-3 gap-3 sm:max-w-xl">
        <KpiCard label={t('Vendors', 'الموردون')} value={num(all.length)} />
        <KpiCard label={t('Active', 'مفعّل')} value={num(all.filter((v) => v.isActive).length)} />
        <KpiCard label={t('Inactive', 'غير مفعّل')} value={num(all.filter((v) => !v.isActive).length)} tone={all.some((v) => !v.isActive) ? 'bad' : 'neutral'} />
      </div>
      <FilterBar onClear={() => { setQ(''); setStatus(''); }}>
        <div className="w-64"><LabeledInput label={t('Search by name', 'بحث بالاسم')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-44"><LabeledSelect label={t('Status', 'الحالة')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('Any', 'الكل')}</option><option value="ACTIVE">{t('Active', 'مفعّل')}</option><option value="INACTIVE">{t('Inactive', 'غير مفعّل')}</option></LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable
          rows={list.data ? rows : undefined}
          rowKey={(v) => v.id}
          loading={list.loading}
          error={list.error}
          status={list.status}
          onRetry={list.reload}
          emptyTitle={all.length === 0 ? t('No vendors yet. Create one to get started.', 'لا يوجد موردون بعد. أنشئ واحدًا للبدء.') : t('No vendor matches the filters.', 'لا يوجد مورد يطابق الفلاتر.')}
          columns={[
            { key: 'n', header: t('Vendor', 'المورد'), cell: (v) => <Link href={`/vendors/${v.id}`} className="font-medium text-hatly-orangeDark hover:underline"><bdi>{locale === 'ar' && v.nameAr ? v.nameAr : v.name}</bdi></Link> },
            { key: 'o', header: t('Other name', 'الاسم الآخر'), cell: (v) => <bdi className="text-gray-500">{locale === 'ar' ? v.name : v.nameAr ?? '—'}</bdi> },
            { key: 's', header: t('Status', 'الحالة'), cell: (v) => (v.isActive ? <Badge tone="green">{t('Active', 'مفعّل')}</Badge> : <Badge tone="gray">{t('Inactive', 'غير مفعّل')}</Badge>) },
          ]}
        />
      </Card>
      <Modal open={open} title={t('New Vendor', 'مورد جديد')} onClose={() => setOpen(false)}>
        <form onSubmit={submit} className="space-y-3">
          <LabeledInput label={t('Name', 'الاسم')} required value={name} onChange={(e) => setName(e.target.value)} />
          <LabeledInput label={t('Name (Arabic)', 'الاسم (بالعربية)')} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <LabeledInput label={t('Logo URL', 'رابط الشعار')} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-gray-500">{t('The new vendor starts inactive until you activate it.', 'يبدأ المورد الجديد غير مفعّل حتى تفعّله.')}</p>
          <div className="flex justify-end gap-2"><Button type="button" onClick={() => setOpen(false)}>{t('Cancel', 'إلغاء')}</Button><Button type="submit" variant="primary" loading={busy}>{t('Create Vendor', 'إنشاء المورد')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
