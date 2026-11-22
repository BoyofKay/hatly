'use client';
import { DeleteRecordButton } from '../../../components/admin/DeleteRecordButton';
import { ResetPasswordButton } from '../../../components/admin/ResetPasswordButton';
import { SimpleEditModal } from '../../../components/admin/SimpleEditModal';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { VendorStaffMember, activateVendorStaff, createVendorStaff, deactivateVendorStaff, listVendorStaff } from '../../../lib/api/admin-vendor-staff';
import { Vendor, VendorBranch, listVendorBranches, listVendors } from '../../../lib/api/admin-vendors';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, Column, ConfirmDialog, DataTable, inputCls, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, useToast } from '../../../components/ui';

/**
 * Admin Vendor Staff — every vendor staff account in one searchable directory: filter by vendor, role and status, create an account in a dialog,
 * activate / deactivate with a confirmation. Consumes `GET/POST admin/vendor-staff` and the activate / deactivate endpoints exactly; `MANAGE_VENDOR_STAFF`
 * is enforced server-side (a 403 is shown as a plain error, never bypassed). Password reset, invitations and deletion are not part of this surface.
 */
const PAGE = 25;
const ROLE: Record<string, [string, string]> = { VENDOR: ['Operator', 'مشغّل'], VENDOR_MANAGER: ['Manager', 'مدير'] };

export default function VendorStaffPage() {
  const { t, date } = useLang();
  const toast = useToast();
  const [staff, setStaff] = useState<VendorStaffMember[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [branches, setBranches] = useState<VendorBranch[]>([]);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'VENDOR' | 'VENDOR_MANAGER'>('VENDOR');
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [toggle, setToggle] = useState<VendorStaffMember | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [editingStaff, setEditingStaff] = useState<VendorStaffMember | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [staffList, vendorList] = await Promise.all([listVendorStaff(), listVendors()]);
      setStaff(staffList);
      setVendors(vendorList);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load vendor staff.', 'تعذّر تحميل موظفي المتاجر.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedVendorId) {
      setBranches([]);
      setSelectedBranchId('');
      return;
    }
    listVendorBranches(selectedVendorId).then(setBranches).catch(() => setBranches([]));
  }, [selectedVendorId]);

  useEffect(() => setPage(1), [search, vendorFilter, roleFilter, statusFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (staff ?? [])
      .filter((s) => (!vendorFilter || s.vendorId === vendorFilter) && (!roleFilter || s.role === roleFilter) && (!statusFilter || (statusFilter === 'active') === s.isActive))
      .filter((s) => !q || [s.fullName, s.phone, s.vendorName, s.vendorBranchName].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.fullName.localeCompare(b.fullName));
  }, [staff, search, vendorFilter, roleFilter, statusFilter]);
  const pageRows = filtered.slice((page - 1) * PAGE, page * PAGE);
  const anyFilter = !!(search || vendorFilter || roleFilter || statusFilter);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedBranchId) return setCreateError(t('Select a vendor branch.', 'اختر فرع المتجر.'));
    setIsSubmitting(true);
    setCreateError(null);
    try {
      const created = await createVendorStaff({ phone, fullName, password, vendorBranchId: selectedBranchId, role });
      setFullName(''); setPhone(''); setPassword(''); // the password is never kept in state beyond this submission
      setCreateOpen(false);
      toast.push('success', t(`Staff account "${created.fullName}" created.`, `تم إنشاء حساب الموظف "${created.fullName}".`));
      await refresh();
    } catch (err: any) {
      setCreateError(apiErrorMessage(err, t('Failed to create staff account.', 'تعذّر إنشاء حساب الموظف.')));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmToggle() {
    if (!toggle || toggleBusy) return;
    setToggleBusy(true);
    setToggleError(null);
    try {
      toggle.isActive ? await deactivateVendorStaff(toggle.id) : await activateVendorStaff(toggle.id);
      toast.push('success', toggle.isActive ? t('Account deactivated.', 'تم إيقاف الحساب.') : t('Account activated.', 'تم تفعيل الحساب.'));
      setToggle(null);
      await refresh();
    } catch (err: any) {
      setToggleError(apiErrorMessage(err, t('Failed to update status.', 'تعذّر تحديث الحالة.')));
    } finally {
      setToggleBusy(false);
    }
  }

  const columns: Column<VendorStaffMember>[] = [
    { key: 'name', header: t('Name', 'الاسم'), cell: (s) => <span><span className="font-medium text-gray-900">{s.fullName}</span> <span dir="ltr" className="text-xs text-gray-500">{s.phone}</span></span> },
    { key: 'vendor', header: t('Vendor / branch', 'المتجر / الفرع'), cell: (s) => <span>{s.vendorName} <span className="text-gray-400">/</span> {s.vendorBranchName}</span> },
    { key: 'role', header: t('Role', 'الدور'), cell: (s) => <Badge tone={s.role === 'VENDOR_MANAGER' ? 'blue' : 'gray'}>{ROLE[s.role] ? t(ROLE[s.role][0], ROLE[s.role][1]) : s.role}</Badge> },
    { key: 'status', header: t('Status', 'الحالة'), cell: (s) => <Badge tone={s.isActive ? 'green' : 'gray'}>{s.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge> },
    { key: 'created', header: t('Created', 'أُنشئ'), cell: (s) => <span className="whitespace-nowrap text-gray-600">{date(s.createdAt)}</span> },
    { key: 'actions', header: '', align: 'end', cell: (s) => (
      <span className="inline-flex flex-wrap justify-end gap-2">
        <Button size="sm" className="min-h-[36px]" onClick={() => setEditingStaff(s)}>{t('Edit', 'تعديل')}</Button>
        <Button size="sm" className="min-h-[36px]" onClick={() => { setToggleError(null); setToggle(s); }}>{s.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</Button>
        <ResetPasswordButton path={`/admin/vendor-staff/${s.id}/reset-password`} name={s.fullName} />
        <DeleteRecordButton path={`/admin/vendor-staff/${s.id}`} name={s.fullName} what={['Staff member', 'الموظف']} consequence={['They are signed out and removed from every branch. The phone number can be used again.', 'سيتم تسجيل خروجه وإزالته من كل الفروع. يمكن استخدام رقم الهاتف مجددًا.']} onDeleted={refresh} />
      </span>
    ) },
  ];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Vendor Staff', 'موظفو المتاجر')}
        subtitle={t('Everyone who can sign in to a vendor’s dashboard, with their role and branch. A deactivated account can no longer sign in.', 'كل من يستطيع الدخول إلى لوحة متجر، مع دوره وفرعه. الحساب الموقوف لا يستطيع الدخول.')}
        actions={<Button variant="primary" onClick={() => { setCreateError(null); setCreateOpen(true); }}>{t('New staff account', 'حساب موظف جديد')}</Button>}
      />

      <div className="mb-4 space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search name, phone, vendor or branch', 'ابحث بالاسم أو الهاتف أو المتجر أو الفرع')} aria-label={t('Search vendor staff', 'البحث في موظفي المتاجر')} className={`${inputCls} min-h-[44px] sm:min-h-0`} />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <LabeledSelect label={t('Vendor', 'المتجر')} value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
            <option value="">{t('All vendors', 'كل المتاجر')}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </LabeledSelect>
          <LabeledSelect label={t('Role', 'الدور')} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">{t('Any role', 'أي دور')}</option>
            <option value="VENDOR">{t('Operator', 'مشغّل')}</option>
            <option value="VENDOR_MANAGER">{t('Manager', 'مدير')}</option>
          </LabeledSelect>
          <LabeledSelect label={t('Status', 'الحالة')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">{t('Any status', 'أي حالة')}</option>
            <option value="active">{t('Active', 'نشط')}</option>
            <option value="inactive">{t('Inactive', 'غير نشط')}</option>
          </LabeledSelect>
        </div>
        {anyFilter && <Button variant="ghost" className="min-h-[40px]" onClick={() => { setSearch(''); setVendorFilter(''); setRoleFilter(''); setStatusFilter(''); }}>{t('Clear filters', 'مسح الفلاتر')}</Button>}
      </div>

      <Card pad={false}>
        {staff && <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite">{t(`${filtered.length} account${filtered.length === 1 ? '' : 's'}`, `${filtered.length} حساب`)}</p>}
        <DataTable
          columns={columns}
          rows={staff ? pageRows : undefined}
          rowKey={(s) => s.id}
          loading={loading}
          error={error}
          onRetry={refresh}
          emptyTitle={staff && staff.length > 0 ? t('No staff match these filters.', 'لا يوجد موظفون مطابقون.') : t('No vendor staff yet.', 'لا يوجد موظفو متاجر بعد.')}
          emptyHint={staff && staff.length > 0 ? undefined : t('Create the first account so a vendor can sign in.', 'أنشئ أول حساب ليتمكن المتجر من الدخول.')}
        />
        {staff && filtered.length > 0 && <Pagination page={page} limit={PAGE} total={filtered.length} onPage={setPage} />}
      </Card>

      <Modal
        open={createOpen}
        title={t('New staff account', 'حساب موظف جديد')}
        onClose={() => !isSubmitting && setCreateOpen(false)}
        footer={<><Button onClick={() => setCreateOpen(false)} disabled={isSubmitting}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="vs-create" loading={isSubmitting}>{isSubmitting ? t('Creating...', 'جارٍ الإنشاء...') : t('Create staff account', 'إنشاء الحساب')}</Button></>}
      >
        <form id="vs-create" onSubmit={handleCreate} className="space-y-3">
          <LabeledInput label={t('Full name', 'الاسم الكامل')} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <LabeledInput label={t('Phone number', 'رقم الهاتف')} required type="tel" dir="ltr" placeholder="+20..." value={phone} onChange={(e) => setPhone(e.target.value)} />
          <LabeledInput label={t('Password', 'كلمة المرور')} required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('At least 8 characters. Used with the phone number to sign in to the dashboard — no OTP for staff accounts.', '8 أحرف على الأقل. تُستخدم مع رقم الهاتف لتسجيل الدخول — بدون رمز تحقق للموظفين.')} />
          <LabeledSelect label={t('Role', 'الدور')} value={role} onChange={(e) => setRole(e.target.value as 'VENDOR' | 'VENDOR_MANAGER')}>
            <option value="VENDOR">{t('Operator — handles orders and stock', 'مشغّل — يدير الطلبات والمخزون')}</option>
            <option value="VENDOR_MANAGER">{t('Manager — also manages the branch and its team', 'مدير — يدير الفرع وفريقه أيضًا')}</option>
          </LabeledSelect>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledSelect label={t('Vendor', 'المتجر')} required value={selectedVendorId} onChange={(e) => setSelectedVendorId(e.target.value)}>
              <option value="">{t('Select a vendor...', 'اختر متجرًا...')}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </LabeledSelect>
            <LabeledSelect label={t('Branch', 'الفرع')} required value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} disabled={!selectedVendorId}>
              <option value="">{t('Select a branch...', 'اختر فرعًا...')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </LabeledSelect>
          </div>
          {createError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{createError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggle}
        title={toggle?.isActive ? t('Deactivate this account?', 'إيقاف هذا الحساب؟') : t('Activate this account?', 'تفعيل هذا الحساب؟')}
        message={toggle ? (toggle.isActive ? t(`${toggle.fullName} will no longer be able to sign in to ${toggle.vendorName}'s dashboard.`, `لن يتمكن ${toggle.fullName} من الدخول إلى لوحة ${toggle.vendorName}.`) : t(`${toggle.fullName} will be able to sign in again.`, `سيتمكن ${toggle.fullName} من الدخول مجددًا.`)) : ''}
        confirmLabel={toggle?.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}
        danger={toggle?.isActive}
        busy={toggleBusy}
        error={toggleError}
        onConfirm={() => void confirmToggle()}
        onClose={() => setToggle(null)}
      />
      {editingStaff && (
        <SimpleEditModal
          title={['Edit store staff member', 'تعديل موظف المتجر']}
          path={`/admin/vendor-staff/${editingStaff.id}`}
          initial={editingStaff as unknown as Record<string, unknown>}
          fields={[
            { key: 'fullName', label: ['Full name', 'الاسم الكامل'], required: true },
            { key: 'phone', label: ['Phone (sign-in)', 'الهاتف (للدخول)'], kind: 'phone', required: true, hint: ['Changing it signs the person out.', 'تغييره يُخرج الشخص من الحساب.'] },
            { key: 'role', label: ['Role', 'الدور'], options: [['VENDOR_MANAGER', 'Store manager', 'مدير المتجر'], ['VENDOR', 'Store operator', 'مشغل المتجر']] },
          ]}
          onClose={() => setEditingStaff(null)}
          onSaved={async () => { setEditingStaff(null); await refresh(); }}
        />
      )}
    </div>
  );
}
