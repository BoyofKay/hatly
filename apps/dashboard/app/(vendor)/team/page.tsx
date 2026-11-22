'use client';

import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, DataTable, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, useToast } from '../../../components/ui';
import { ICONS } from '../../../components/ui/icons';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { apiErrorMessage } from '../../../lib/api/errors';
import { assignOperatorBranch, createOperator, promoteOperator, setOperatorActive, unassignOperatorBranch, type TeamMember, type TeamView } from '../../../lib/api/vendor-operations';

/**
 * The people linked to your branches. A branch MANAGER can, within their own branches only: add an operator, activate or deactivate an operator, and
 * add or remove an operator on another of their branches. Creating or promoting a manager, changing a role, and changing a manager's account (or
 * one's own, or a person who also works at a branch you do not manage) stay with Hatly — the page says so instead of hiding it.
 */
export default function VendorTeamPage() {
  const { t, num } = useLang();
  const toast = useToast();
  const state = useApi<TeamView>('/vendor/team');
  const team = state.data;

  const [addOpen, setAddOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [toggle, setToggle] = useState<TeamMember | null>(null);
  const [promote, setPromote] = useState<TeamMember | null>(null);
  const [branchesFor, setBranchesFor] = useState<TeamMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const target = branchId || team?.branches[0]?.id || '';
    setSaving(true);
    setFormError(null);
    try {
      await createOperator({ fullName: fullName.trim(), phone: phone.trim(), password, branchId: target });
      setFullName(''); setPhone(''); setPassword(''); // the password is never kept beyond this submission
      setAddOpen(false);
      toast.push('success', t('Operator account created. Share the phone number and password with them privately.', 'تم إنشاء حساب المشغّل. شارك رقم الهاتف وكلمة المرور معه بشكل خاص.'));
      state.reload();
    } catch (err) {
      setFormError(apiErrorMessage(err, t('The account could not be created.', 'تعذّر إنشاء الحساب.')));
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggle() {
    if (!toggle || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await setOperatorActive(toggle.id, !toggle.isActive);
      toast.push('success', toggle.isActive ? t('Account deactivated.', 'تم إيقاف الحساب.') : t('Account activated.', 'تم تفعيل الحساب.'));
      setToggle(null);
      state.reload();
    } catch (err) {
      setActionError(apiErrorMessage(err, t('The change was refused.', 'تم رفض التغيير.')));
    } finally {
      setBusy(false);
    }
  }

  async function branchChange(member: TeamMember, id: string, add: boolean) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await (add ? assignOperatorBranch(member.id, id) : unassignOperatorBranch(member.id, id));
      state.reload();
      setBranchesFor(null);
      toast.push('success', add ? t('Branch added.', 'تمت إضافة الفرع.') : t('Branch removed.', 'تمت إزالة الفرع.'));
    } catch (err) {
      setActionError(apiErrorMessage(err, t('The change was refused.', 'تم رفض التغيير.')));
    } finally {
      setBusy(false);
    }
  }

  const live = team ? team.members.find((m) => branchesFor && m.id === branchesFor.id) ?? branchesFor : branchesFor;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Team', 'الفريق')}
        subtitle={team?.canManage
          ? t('Add operators, switch their accounts on or off, and choose which of your branches they work at.', 'أضف مشغّلين، وفعّل حساباتهم أو أوقفها، وحدّد الفروع التي يعملون بها.')
          : t('Everyone linked to your branches. Only a branch manager can change the team.', 'كل من هم مرتبطون بفروعك. يغيّر مدير الفرع وحده الفريق.')}
        actions={team?.canManage ? <Button variant="primary" onClick={() => { setFormError(null); setBranchId(team.branches[0]?.id ?? ''); setAddOpen(true); }} data-testid="team-add">{t('Add operator', 'إضافة مشغّل')}</Button> : undefined}
      />
      {team && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="team-kpis">
          <KpiCard label={t('People', 'الأشخاص')} value={num(team.members.length)} icon={ICONS.users} />
          <KpiCard label={t('Managers', 'المديرون')} value={num(team.members.filter((m) => m.role === 'MANAGER').length)} icon={ICONS.shield} />
          <KpiCard label={t('Operators', 'المشغّلون')} value={num(team.members.filter((m) => m.role !== 'MANAGER').length)} icon={ICONS.user} />
          <KpiCard label={t('Inactive accounts', 'حسابات غير نشطة')} value={num(team.members.filter((m) => !m.isActive).length)} icon={ICONS.userOff} />
        </div>
      )}
      <Card pad={false}>
        <DataTable rows={team?.members} rowKey={(m) => m.id} loading={state.loading} error={state.error} status={state.status} onRetry={state.reload} columns={[
          { key: 'n', header: t('Name', 'الاسم'), cell: (m) => <span><bdi className="font-medium">{m.fullName}</bdi> {m.isYou && <Badge tone="blue">{t('You', 'أنت')}</Badge>}</span> },
          { key: 'r', header: t('Role', 'الدور'), cell: (m) => <Badge tone={m.role === 'MANAGER' ? 'blue' : 'gray'}>{m.role === 'MANAGER' ? t('Manager', 'مدير') : t('Operator', 'مشغّل')}</Badge> },
          { key: 'p', header: t('Phone', 'الهاتف'), cell: (m) => <span dir="ltr">{m.phoneMasked}</span> },
          { key: 'b', header: t('Branches', 'الفروع'), cell: (m) => <bdi>{m.branches.join('، ')}</bdi> },
          { key: 's', header: t('Status', 'الحالة'), cell: (m) => (m.isActive ? <Badge tone="green">{t('Active', 'نشط')}</Badge> : <Badge tone="gray">{t('Inactive', 'غير نشط')}</Badge>) },
          {
            key: 'a', header: '', align: 'end',
            cell: (m) => m.manageable ? (
              <span className="inline-flex gap-2">
                {(team?.branches.length ?? 0) > 1 && <Button size="sm" className="min-h-[36px]" onClick={() => { setActionError(null); setBranchesFor(m); }}>{t('Branches', 'الفروع')}</Button>}
                {m.role !== 'MANAGER' && m.isActive && <Button size="sm" className="min-h-[36px]" onClick={() => { setActionError(null); setPromote(m); }}>{t('Make manager', 'ترقية لمدير')}</Button>}
                <Button size="sm" className="min-h-[36px]" onClick={() => { setActionError(null); setToggle(m); }}>{m.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}</Button>
              </span>
            ) : null,
          },
        ]} />
      </Card>

      <Card title={t('What each role can do', 'ماذا يستطيع كل دور')}>
        <ul className="space-y-2 text-sm text-gray-700">
          <li><b>{t('Manager', 'مدير')}</b> — {t('everything an operator can do, plus weekly hours, preparation time and closures of the branch, stocktakes, the financial centre, and the team (operators only).', 'كل ما يفعله المشغّل، إضافة إلى مواعيد الفرع ومدة التحضير والإغلاقات، وجرد المخزون، والمركز المالي، وإدارة الفريق (المشغّلون فقط).')}</li>
          <li><b>{t('Operator', 'مشغّل')}</b> — {t('accepts and prepares orders, marks items unavailable, opens or closes the branch, manages products and stock, and counts stock.', 'يقبل الطلبات ويحضّرها، ويُبلّغ عن منتجات غير متاحة، ويفتح الفرع أو يغلقه، ويدير المنتجات والمخزون، ويعدّ الجرد.')}</li>
        </ul>
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600" data-testid="team-hatly-only">{t('Contact Hatly to add or promote a manager, change anyone’s role, change a manager’s account, or change someone who also works at a branch you do not manage. This keeps every account verified.', 'تواصل مع هاتلي لإضافة مدير أو ترقية شخص إلى مدير أو تغيير أي دور أو تغيير حساب مدير أو شخص يعمل أيضًا في فرع لا تديره. هذا يُبقي كل حساب موثَّقًا.')}</p>
      </Card>

      <Modal
        open={addOpen}
        title={t('Add operator', 'إضافة مشغّل')}
        onClose={() => !saving && setAddOpen(false)}
        footer={<><Button onClick={() => setAddOpen(false)} disabled={saving}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" type="submit" form="team-add-form" loading={saving}>{t('Create account', 'إنشاء الحساب')}</Button></>}
      >
        <form id="team-add-form" onSubmit={add} className="space-y-3">
          <LabeledInput label={t('Full name', 'الاسم الكامل')} required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <LabeledInput label={t('Phone number', 'رقم الهاتف')} required type="tel" dir="ltr" placeholder="+20…" value={phone} onChange={(e) => setPhone(e.target.value)} hint={t('With the country code. It must not belong to any other account.', 'مع رمز الدولة. يجب ألا يكون لأي حساب آخر.')} />
          <LabeledInput label={t('Password', 'كلمة المرور')} required type="password" minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={t('At least 8 characters. They sign in with their phone number and this password.', '8 أحرف على الأقل. يدخلون برقم الهاتف وهذه الكلمة.')} />
          {(team?.branches.length ?? 0) > 1 && (
            <LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {team?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </LabeledSelect>
          )}
          <p className="text-xs text-gray-500">{t('The account is an operator. Hatly creates managers.', 'الحساب حساب مشغّل. تنشئ هاتلي حسابات المديرين.')}</p>
          {formError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toggle}
        title={toggle?.isActive ? t('Deactivate this account?', 'إيقاف هذا الحساب؟') : t('Activate this account?', 'تفعيل هذا الحساب؟')}
        message={toggle ? (toggle.isActive ? t(`${toggle.fullName} will no longer be able to sign in.`, `لن يتمكن ${toggle.fullName} من الدخول.`) : t(`${toggle.fullName} will be able to sign in again.`, `سيتمكن ${toggle.fullName} من الدخول مجددًا.`)) : ''}
        confirmLabel={toggle?.isActive ? t('Deactivate', 'إيقاف') : t('Activate', 'تفعيل')}
        danger={toggle?.isActive}
        busy={busy}
        error={actionError}
        onConfirm={() => void confirmToggle()}
        onClose={() => setToggle(null)}
      />

      <ConfirmDialog
        open={!!promote}
        title={t('Make this person a manager?', 'ترقية هذا الشخص إلى مدير؟')}
        message={promote ? t(`${promote.fullName} will be able to manage the team, products and settings of your branches. Only Hatly can undo this.`, `سيتمكن ${promote.fullName} من إدارة الفريق والمنتجات وإعدادات فروعك. هاتلي فقط يمكنها التراجع عن ذلك.`) : ''}
        confirmLabel={t('Make manager', 'ترقية لمدير')}
        busy={busy}
        error={actionError}
        onConfirm={() => void (async () => {
          if (!promote || busy) return;
          setBusy(true);
          setActionError(null);
          try {
            await promoteOperator(promote.id);
            toast.push('success', t('Promoted. They get manager rights the next time they sign in.', 'تمت الترقية. تظهر صلاحيات المدير عند تسجيل دخوله التالي.'));
            setPromote(null);
            state.reload();
          } catch (err) {
            setActionError(apiErrorMessage(err, t('Could not promote this person.', 'تعذّرت الترقية.')));
          } finally {
            setBusy(false);
          }
        })()}
        onClose={() => setPromote(null)}
      />

      <Modal open={!!live} title={live ? t(`Branches of ${live.fullName}`, `فروع ${live.fullName}`) : ''} onClose={() => !busy && setBranchesFor(null)} footer={<Button onClick={() => setBranchesFor(null)}>{t('Close', 'إغلاق')}</Button>}>
        <ul className="divide-y divide-gray-100">
          {team?.branches.map((b) => {
            const has = live?.branchIds.includes(b.id) ?? false;
            return (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <bdi className="text-sm">{b.name}</bdi>
                {live && <Button size="sm" className="min-h-[36px]" loading={busy} variant={has ? 'secondary' : 'primary'} onClick={() => void branchChange(live, b.id, !has)}>{has ? t('Remove', 'إزالة') : t('Add', 'إضافة')}</Button>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-gray-500">{t('A person always keeps at least one branch. To stop someone working here, deactivate the account.', 'يبقى لكل شخص فرع واحد على الأقل. لإيقاف شخص عن العمل هنا، أوقف حسابه.')}</p>
        {actionError && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      </Modal>
    </div>
  );
}
