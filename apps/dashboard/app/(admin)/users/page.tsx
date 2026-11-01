'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminUser, grantPermission, listAdminUsers, listPermissionCatalog, revokePermission } from '../../../lib/api/admin-users';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, inputCls, KpiCard, PageHeader, Skeleton, useToast } from '../../../components/ui';

/**
 * Admin Users & Permissions — who holds which admin capability. Reuses the existing grant / revoke endpoints and the read-only `GET admin/users` /
 * `GET admin/permissions` listings. Server-side authorization (SUPER_ADMIN-only via `RolesGuard`) is the real boundary: a non-SUPER_ADMIN who reaches
 * this page gets a plain 403 from every call, never a client-side redirect pretending to be the security check. Only ADMIN / SUPER_ADMIN-tier users
 * are listed (no customer management). Permission codes are shown exactly as the backend names them. Every grant and revoke is confirmed first.
 */
export default function AdminUsersPage() {
  const { t } = useLang();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [action, setAction] = useState<{ kind: 'grant' | 'revoke'; user: AdminUser; permission: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [userList, permissionList] = await Promise.all([listAdminUsers(), listPermissionCatalog()]);
      setUsers(userList);
      setCatalog(permissionList);
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load admin users.', 'تعذّر تحميل مستخدمي الإدارة.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => (!roleFilter || u.role === roleFilter) && (!q || u.fullName.toLowerCase().includes(q) || u.phone.includes(q)));
  }, [users, search, roleFilter]);

  async function confirm() {
    if (!action || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (action.kind === 'grant') await grantPermission(action.user.id, action.permission);
      else await revokePermission(action.user.id, action.permission);
      toast.push('success', action.kind === 'grant' ? t('Permission granted.', 'تم منح الصلاحية.') : t('Permission revoked.', 'تم سحب الصلاحية.'));
      if (action.kind === 'grant') setSelected((p) => ({ ...p, [action.user.id]: '' }));
      setAction(null);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, action.kind === 'grant' ? t('Failed to grant permission.', 'تعذّر منح الصلاحية.') : t('Failed to revoke permission.', 'تعذّر سحب الصلاحية.')));
    } finally {
      setBusy(false);
    }
  }

  const supers = (users ?? []).filter((u) => u.role === 'SUPER_ADMIN').length;

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Admin Users & Permissions', 'مستخدمو الإدارة والصلاحيات')}
        subtitle={t('Grant or withdraw individual capabilities for admin accounts. A change takes effect immediately.', 'امنح أو اسحب قدرات محددة لحسابات الإدارة. يسري التغيير فورًا.')}
        actions={<Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button>}
      />

      {users && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={t('Admin accounts', 'حسابات الإدارة')} value={users.length} />
          <KpiCard label={t('Super admins', 'المديرون العامون')} value={supers} />
          <KpiCard label={t('Permissions available', 'الصلاحيات المتاحة')} value={catalog.length} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search name or phone', 'ابحث بالاسم أو الهاتف')} aria-label={t('Search admin users', 'البحث في مستخدمي الإدارة')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-sm`} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={t('Role', 'الدور')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-[12rem]`}>
          <option value="">{t('Any role', 'أي دور')}</option>
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
          <option value="ADMIN">ADMIN</option>
        </select>
      </div>

      {error && !users ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !users ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : visible.length === 0 ? (
        <Card><EmptyState title={users.length === 0 ? t('No admin users found.', 'لا يوجد مستخدمو إدارة.') : t('No admin user matches.', 'لا يوجد مستخدم مطابق.')} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((user) => (
            <section key={user.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{user.fullName}</p>
                  <p className="text-xs text-gray-500" dir="ltr">{user.phone}</p>
                </div>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Badge tone={user.role === 'SUPER_ADMIN' ? 'orange' : 'blue'}>{user.role}</Badge>
                  <Badge tone={user.isActive ? 'green' : 'gray'}>{user.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>
                </span>
              </div>

              {user.role === 'SUPER_ADMIN' ? (
                <p className="mt-3 text-sm text-gray-500">{t('SUPER_ADMIN has every capability by role — permissions are not granted/revoked individually.', 'المدير العام يملك كل القدرات بحكم دوره — لا تُمنح الصلاحيات أو تُسحب له بشكل فردي.')}</p>
              ) : (
                <>
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500">{t('Granted permissions', 'الصلاحيات الممنوحة')} ({user.permissions.length})</p>
                    {user.permissions.length === 0 ? (
                      <p className="mt-1 text-sm text-gray-500">{t('None yet.', 'لا يوجد بعد.')}</p>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {user.permissions.map((permission) => (
                          <span key={permission} className="inline-flex items-center gap-1 rounded-md bg-gray-100 ps-2 pe-1 text-xs text-gray-700">
                            <span dir="ltr" className="font-mono">{permission}</span>
                            <button onClick={() => { setActionError(null); setAction({ kind: 'revoke', user, permission }); }} className="flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:text-red-600" aria-label={`Revoke ${permission}`} title={`Revoke ${permission}`}>&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <select value={selected[user.id] ?? ''} onChange={(e) => setSelected((p) => ({ ...p, [user.id]: e.target.value }))} aria-label={`${t('Grant a permission', 'منح صلاحية')} — ${user.fullName}`} className={`${inputCls} min-w-0 flex-1`} dir="ltr">
                      <option value="">{t('Grant a permission...', 'منح صلاحية...')}</option>
                      {catalog.filter((p) => !user.permissions.includes(p)).map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <Button variant="primary" disabled={!selected[user.id]} onClick={() => { setActionError(null); setAction({ kind: 'grant', user, permission: selected[user.id] }); }}>{t('Grant', 'منح')}</Button>
                  </div>
                </>
              )}
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!action}
        title={action?.kind === 'grant' ? t('Grant this permission?', 'منح هذه الصلاحية؟') : t('Revoke this permission?', 'سحب هذه الصلاحية؟')}
        message={action ? (action.kind === 'grant'
          ? t(`Grant "${action.permission}" to ${action.user.fullName}? This changes what they can do immediately.`, `منح "${action.permission}" إلى ${action.user.fullName}؟ يتغير ما يستطيع فعله فورًا.`)
          : t(`Revoke "${action.permission}" from ${action.user.fullName}? They will lose this access immediately.`, `سحب "${action.permission}" من ${action.user.fullName}؟ سيفقد هذا الوصول فورًا.`)) : ''}
        confirmLabel={action?.kind === 'grant' ? t('Grant', 'منح') : t('Revoke', 'سحب')}
        danger={action?.kind === 'revoke'}
        busy={busy}
        error={actionError}
        onConfirm={() => void confirm()}
        onClose={() => setAction(null)}
      />
    </div>
  );
}
