'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreateStaffInput,
  LEVEL_LABEL,
  StaffAccount,
  StaffLevel,
  StaffListMeta,
  createStaff,
  deleteStaff,
  listStaff,
  resetStaffPassword,
  setStaffActive,
  setStaffPermissions,
  staffPasswordProblem,
  updateStaff,
} from '../../../lib/api/admin-staff';
import { apiErrorMessage } from '../../../lib/api/errors';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, inputCls, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, Skeleton, useToast } from '../../../components/ui';

type Editor =
  | { kind: 'create' }
  | { kind: 'edit'; user: StaffAccount }
  | { kind: 'permissions'; user: StaffAccount }
  | { kind: 'password'; user: StaffAccount };
type Confirm = { kind: 'activate' | 'deactivate' | 'delete'; user: StaffAccount };

const LEVEL_TONE: Record<string, 'orange' | 'blue' | 'green' | 'gray'> = { SUPER_ADMIN: 'orange', ADMIN: 'blue', OPS_SUPERVISOR: 'green', OPS_TEAM: 'gray' };

/**
 * Staff & permissions — Super admin > Admin > Operations supervisor > Operations team. Everyone with MANAGE_STAFF_ACCOUNTS sees themselves and
 * the staff below them; what each row allows comes from the server (`manageable`) and every action is re-checked there. Super admins also
 * keep full control of every permission; others can give only permissions they hold.
 */
export default function StaffPage() {
  const { t, locale } = useLang();
  const toast = useToast();
  const [rows, setRows] = useState<StaffAccount[] | null>(null);
  const [meta, setMeta] = useState<StaffListMeta>({ creatableLevels: [], grantable: [], presets: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const label = (l: string) => { const pair = LEVEL_LABEL[l as StaffLevel] ?? [l, l]; return t(pair[0], pair[1]); };
  const canDelete = usePermissions().can('DELETE_RECORDS');

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await listStaff();
      setRows(res.data);
      setMeta(res.meta);
    } catch (err) {
      setError(apiErrorMessage(err, t('Failed to load staff accounts.', 'تعذّر تحميل حسابات الموظفين.')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((u) => (!levelFilter || u.level === levelFilter) && (!q || u.fullName.toLowerCase().includes(q) || u.phone.includes(q)));
  }, [rows, search, levelFilter]);

  const count = (l: string) => (rows ?? []).filter((u) => u.level === l).length;

  async function runConfirm() {
    if (!confirm || busy) return;
    setBusy(true);
    setConfirmError(null);
    try {
      if (confirm.kind === 'delete') await deleteStaff(confirm.user.id);
      else await setStaffActive(confirm.user.id, confirm.kind === 'activate');
      toast.push('success', confirm.kind === 'delete' ? t('Account deleted.', 'تم حذف الحساب.') : confirm.kind === 'activate' ? t('Account activated.', 'تم تفعيل الحساب.') : t('Account deactivated.', 'تم إيقاف الحساب.'));
      setConfirm(null);
      await refresh();
    } catch (err) {
      setConfirmError(apiErrorMessage(err, t('The action failed.', 'تعذّر تنفيذ الإجراء.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={t('Staff & permissions', 'الموظفون والصلاحيات')}
        subtitle={t('Super admin › Admin › Operations supervisor › Operations team. You manage the levels below yours.', 'المدير العام › مدير › مشرف التشغيل › فريق التشغيل. تدير المستويات الأقل من مستواك.')}
        actions={<>
          <Button onClick={refresh} loading={loading}>{t('Refresh', 'تحديث')}</Button>
          {meta.creatableLevels.length > 0 && <Button variant="primary" onClick={() => setEditor({ kind: 'create' })}>{t('Add staff member', 'إضافة موظف')}</Button>}
        </>}
      />

      {rows && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={label('ADMIN')} value={count('ADMIN')} />
          <KpiCard label={label('OPS_SUPERVISOR')} value={count('OPS_SUPERVISOR')} />
          <KpiCard label={label('OPS_TEAM')} value={count('OPS_TEAM')} />
          <KpiCard label={t('Inactive', 'غير نشط')} value={rows.filter((u) => !u.isActive).length} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search name or phone', 'ابحث بالاسم أو الهاتف')} aria-label={t('Search staff', 'البحث في الموظفين')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-sm`} />
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} aria-label={t('Level', 'المستوى')} className={`${inputCls} min-h-[44px] sm:min-h-0 sm:max-w-[14rem]`}>
          <option value="">{t('Any level', 'أي مستوى')}</option>
          {(['SUPER_ADMIN', 'ADMIN', 'OPS_SUPERVISOR', 'OPS_TEAM'] as const).map((l) => <option key={l} value={l}>{label(l)}</option>)}
        </select>
      </div>

      {error && !rows ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !rows ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-busy="true">{[0, 1].map((i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : visible.length === 0 ? (
        <Card><EmptyState title={t('No staff account matches.', 'لا يوجد حساب مطابق.')} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((u) => (
            <section key={u.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm" data-testid="staff-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900"><bdi>{u.fullName}</bdi></p>
                  <p className="text-xs text-gray-500" dir="ltr">{u.phone}{u.email ? ` · ${u.email}` : ''}</p>
                </div>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <Badge tone={LEVEL_TONE[u.level] ?? 'gray'}>{label(u.level)}</Badge>
                  <Badge tone={u.isActive ? 'green' : 'gray'}>{u.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}</Badge>
                </span>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {u.level === 'SUPER_ADMIN'
                  ? t('Has every permission by role.', 'يملك كل الصلاحيات بحكم دوره.')
                  : t(`${u.permissions.length} permission(s)`, `${u.permissions.length} صلاحية`)}
              </p>
              {u.level !== 'SUPER_ADMIN' && u.permissions.length > 0 && (
                <div className="mt-1.5 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                  {u.permissions.map((p) => <span key={p} dir="ltr" className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">{p}</span>)}
                </div>
              )}
              {u.manageable && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                  <Button size="sm" onClick={() => setEditor({ kind: 'edit', user: u })}>{t('Edit', 'تعديل')}</Button>
                  <Button size="sm" onClick={() => setEditor({ kind: 'permissions', user: u })}>{t('Permissions', 'الصلاحيات')}</Button>
                  <Button size="sm" onClick={() => setEditor({ kind: 'password', user: u })}>{t('Reset password', 'إعادة تعيين كلمة المرور')}</Button>
                  <Button size="sm" onClick={() => { setConfirmError(null); setConfirm({ kind: u.isActive ? 'deactivate' : 'activate', user: u }); }}>{u.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</Button>
                  {canDelete && <Button size="sm" variant="danger" onClick={() => { setConfirmError(null); setConfirm({ kind: 'delete', user: u }); }}>{t('Delete', 'حذف')}</Button>}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {editor?.kind === 'create' && <StaffForm meta={meta} onClose={() => setEditor(null)} onDone={async () => { setEditor(null); toast.push('success', t('Staff account created.', 'تم إنشاء حساب الموظف.')); await refresh(); }} />}
      {editor?.kind === 'edit' && <StaffForm meta={meta} user={editor.user} onClose={() => setEditor(null)} onDone={async () => { setEditor(null); toast.push('success', t('Saved.', 'تم الحفظ.')); await refresh(); }} />}
      {editor?.kind === 'permissions' && <PermissionsEditor meta={meta} user={editor.user} onClose={() => setEditor(null)} onDone={async () => { setEditor(null); toast.push('success', t('Permissions saved.', 'تم حفظ الصلاحيات.')); await refresh(); }} />}
      {editor?.kind === 'password' && <ResetPassword user={editor.user} onClose={() => setEditor(null)} onDone={() => { setEditor(null); toast.push('success', t('Password reset. Share it with the person privately.', 'تمت إعادة التعيين. شاركها مع الشخص بشكل خاص.')); }} />}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'delete' ? t('Delete this staff account?', 'حذف حساب الموظف؟') : confirm?.kind === 'activate' ? t('Activate this account?', 'تفعيل هذا الحساب؟') : t('Deactivate this account?', 'إيقاف هذا الحساب؟')}
        message={confirm ? (confirm.kind === 'delete'
          ? t(`${confirm.user.fullName} loses access immediately and the account disappears from this list. Their past actions stay in the audit log. The phone number can be used again.`, `سيفقد ${confirm.user.fullName} الوصول فورًا ويختفي الحساب من القائمة. تبقى أفعاله السابقة في سجل التدقيق. يمكن استخدام رقم الهاتف مجددًا.`)
          : confirm.kind === 'deactivate'
            ? t(`${confirm.user.fullName} is signed out and cannot sign in until the account is activated again.`, `سيتم تسجيل خروج ${confirm.user.fullName} ولن يستطيع الدخول حتى يُعاد التفعيل.`)
            : t(`${confirm.user.fullName} can sign in again.`, `سيستطيع ${confirm.user.fullName} تسجيل الدخول مجددًا.`)) : ''}
        confirmLabel={confirm?.kind === 'delete' ? t('Delete', 'حذف') : confirm?.kind === 'activate' ? t('Activate', 'تفعيل') : t('Deactivate', 'إيقاف')}
        danger={confirm?.kind !== 'activate'}
        typeToConfirm={confirm?.kind === 'delete' ? (locale === 'ar' ? 'حذف' : 'DELETE') : undefined}
        busy={busy}
        error={confirmError}
        onConfirm={() => void runConfirm()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function StaffForm({ meta, user, onClose, onDone }: { meta: StaffListMeta; user?: StaffAccount; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { t } = useLang();
  const creating = !user;
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '+20');
  const [email, setEmail] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [level, setLevel] = useState<StaffLevel>((user?.level as StaffLevel) ?? meta.creatableLevels[meta.creatableLevels.length - 1] ?? 'OPS_TEAM');
  const [usePreset, setUsePreset] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presetKey = level === 'ADMIN' ? 'ADMIN_GENERAL' : level;
  const preset = meta.presets.find((p) => p.key === presetKey);
  const presetBeyondMe = preset ? preset.permissions.filter((p) => !meta.grantable.includes(p)) : [];
  const pwProblem = creating && password ? staffPasswordProblem(password, t) : null;
  const ok = fullName.trim().length >= 2 && /^\+\d{8,15}$/.test(phone) && (!creating || (password && !pwProblem));
  const label = (l: string) => { const pair = LEVEL_LABEL[l as StaffLevel] ?? [l, l]; return t(pair[0], pair[1]); };

  async function submit() {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        const input: CreateStaffInput = { fullName: fullName.trim(), phone, password, level, ...(email.trim() ? { email: email.trim() } : {}) };
        if (usePreset && preset) input.permissions = preset.permissions.filter((p) => meta.grantable.includes(p));
        await createStaff(input);
      } else {
        await updateStaff(user!.id, {
          ...(fullName.trim() !== user!.fullName ? { fullName: fullName.trim() } : {}),
          ...(phone !== user!.phone ? { phone } : {}),
          ...(email.trim() !== (user!.email ?? '') ? { email: email.trim() } : {}),
          ...(level !== user!.level ? { level } : {}),
        });
      }
      await onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save.', 'تعذّر الحفظ.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={creating ? t('Add staff member', 'إضافة موظف') : t('Edit staff member', 'تعديل بيانات الموظف')} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void submit()}>{creating ? t('Create account', 'إنشاء الحساب') : t('Save', 'حفظ')}</Button>
    </>}>
      <LabeledInput label={t('Full name', 'الاسم الكامل')} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <LabeledInput label={t('Phone (sign-in)', 'الهاتف (للدخول)')} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\s/g, ''))} hint={t('International format, e.g. +201001234567', 'بالصيغة الدولية مثل ‎+201001234567')} />
      <LabeledInput label={t('Email (optional)', 'البريد الإلكتروني (اختياري)')} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <LabeledSelect label={t('Level', 'المستوى')} value={level} onChange={(e) => setLevel(e.target.value as StaffLevel)}>
        {(creating || meta.creatableLevels.includes(level) ? meta.creatableLevels : [level, ...meta.creatableLevels]).map((l) => <option key={l} value={l}>{label(l)}</option>)}
      </LabeledSelect>
      {creating && (
        <>
          <LabeledInput label={t('First password', 'كلمة المرور الأولى')} type="text" autoComplete="new-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} error={pwProblem} hint={t('Share it privately. The person can change it from their profile.', 'شاركها بشكل خاص. يمكن للشخص تغييرها من ملفه.')} />
          {preset && (
            <label className="flex items-start gap-2 rounded-xl bg-orange-50 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={usePreset} onChange={(e) => setUsePreset(e.target.checked)} />
              <span>
                <span className="font-medium text-gray-900">{t(`Start with the recommended "${preset.nameEn}" permissions (${preset.permissions.length})`, `ابدأ بصلاحيات "${preset.nameAr}" الموصى بها (${preset.permissions.length})`)}</span>
                <span className="block text-xs text-gray-600">{t(preset.descriptionEn, preset.descriptionAr)}</span>
                {presetBeyondMe.length > 0 && <span className="mt-1 block text-xs text-amber-700">{t(`${presetBeyondMe.length} of them are not yours to give and will be skipped.`, `${presetBeyondMe.length} منها ليست لديك ولن تُمنح.`)}</span>}
              </span>
            </label>
          )}
        </>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

function PermissionsEditor({ meta, user, onClose, onDone }: { meta: StaffListMeta; user: StaffAccount; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { t } = useLang();
  const [selected, setSelected] = useState<Set<string>>(new Set(user.permissions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notMine = user.permissions.filter((p) => !meta.grantable.includes(p));
  const preset = meta.presets.find((p) => p.key === (user.level === 'ADMIN' ? 'ADMIN_GENERAL' : user.level));
  const toggle = (p: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setStaffPermissions(user.id, [...selected].filter((p) => meta.grantable.includes(p)));
      await onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save permissions.', 'تعذّر حفظ الصلاحيات.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide open title={t(`Permissions — ${user.fullName}`, `الصلاحيات — ${user.fullName}`)} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} onClick={() => void save()}>{t('Save permissions', 'حفظ الصلاحيات')}</Button>
    </>}>
      {preset && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-600">{t('Quick set:', 'تعيين سريع:')}</span>
          <Button size="sm" onClick={() => setSelected(new Set(preset.permissions.filter((p) => meta.grantable.includes(p))))}>{t(`Recommended for ${preset.nameEn}`, `الموصى به لـ ${preset.nameAr}`)}</Button>
          <Button size="sm" onClick={() => setSelected(new Set())}>{t('Clear all', 'إزالة الكل')}</Button>
        </div>
      )}
      <div className="grid max-h-[55vh] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
        {meta.grantable.map((p) => (
          <label key={p} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
            <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} />
            <span dir="ltr" className="font-mono text-xs text-gray-700">{p}</span>
          </label>
        ))}
      </div>
      {notMine.length > 0 && <p className="text-xs text-gray-500">{t(`Kept as is (given by someone above you): ${notMine.join(', ')}`, `تبقى كما هي (منحها من هو أعلى منك): ${notMine.join(', ')}`)}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

function ResetPassword({ user, onClose, onDone }: { user: StaffAccount; onClose: () => void; onDone: () => void }) {
  const { t } = useLang();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = password ? staffPasswordProblem(password, t) : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await resetStaffPassword(user.id, password);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not reset the password.', 'تعذّرت إعادة تعيين كلمة المرور.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t(`Reset password — ${user.fullName}`, `إعادة تعيين كلمة المرور — ${user.fullName}`)} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!password || !!problem} onClick={() => void submit()}>{t('Reset password', 'إعادة التعيين')}</Button>
    </>}>
      <p className="text-sm text-gray-600">{t('They are signed out and must use the new password.', 'سيتم تسجيل خروجه وعليه استخدام كلمة المرور الجديدة.')}</p>
      <LabeledInput label={t('New password', 'كلمة المرور الجديدة')} type="text" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={problem} />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
