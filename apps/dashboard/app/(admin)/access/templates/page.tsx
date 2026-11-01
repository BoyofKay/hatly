'use client';

import { useState } from 'react';
import { Async, Badge, Button, Card, ConfirmDialog, LabeledInput, LabeledSelect, Modal, PageHeader, useToast } from '../../../../components/ui';
import { send, useApi } from '../../../../lib/ui/api';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { useLang } from '../../../../lib/ui/lang';

export default function TemplatesPage() {
  const { t, locale } = useLang();
  const toast = useToast();
  const templates = useApi<any[]>('/admin/permission-templates');
  const catalog = useApi<string[]>('/admin/permissions');
  const users = useApi<any[]>('/admin/users');
  const [editor, setEditor] = useState<null | { id?: string; key: string; nameEn: string; nameAr: string; permissions: string[] }>(null);
  const [applyTo, setApplyTo] = useState<any>(null);
  const [del, setDel] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveTemplate = async () => {
    if (!editor) return;
    setBusy(true); setError(null);
    try {
      if (editor.id) await send('patch', `/admin/permission-templates/${editor.id}`, { nameEn: editor.nameEn, nameAr: editor.nameAr, permissions: editor.permissions });
      else await send('post', '/admin/permission-templates', { key: editor.key, nameEn: editor.nameEn, nameAr: editor.nameAr, permissions: editor.permissions });
      toast.push('success', t('Template saved.', 'تم حفظ القالب.')); setEditor(null); templates.reload();
    } catch (e) { setError(apiErrorMessage(e, t('Could not save the template.', 'تعذّر حفظ القالب.'))); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError(null);
    try { await send('delete', `/admin/permission-templates/${del.id}`); toast.push('success', t('Template deleted.', 'تم حذف القالب.')); setDel(null); templates.reload(); }
    catch (e) { setError(apiErrorMessage(e, t('Could not delete.', 'تعذّر الحذف.'))); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title={t('Role templates', 'قوالب الأدوار')} subtitle={t('A template is a named set of permissions you can apply to an admin in one step. Applying changes only that admin’s explicit permissions, is audited, and takes effect on their next request. Super admins always keep full access.', 'القالب مجموعة صلاحيات مسماة يمكن تطبيقها على مسؤول بخطوة واحدة. التطبيق يغيّر صلاحيات ذلك المسؤول فقط، ويُسجَّل في التدقيق، ويسري عند طلبه التالي. يحتفظ المشرف الأعلى دائمًا بالوصول الكامل.')} actions={<Button variant="primary" onClick={() => { setError(null); setEditor({ key: '', nameEn: '', nameAr: '', permissions: [] }); }}>{t('New template', 'قالب جديد')}</Button>} />
      <Async state={templates} rows={3}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(templates.data ?? []).map((tp) => (
            <Card key={tp.id} title={locale === 'ar' ? tp.nameAr : tp.nameEn} actions={tp.isSystem ? <Badge>{t('Built-in', 'مضمّن')}</Badge> : undefined}>
              <p className="text-xs text-gray-500">{locale === 'ar' ? tp.descriptionAr ?? tp.descriptionEn : tp.descriptionEn}</p>
              <p className="mt-2 text-xs"><strong>{tp.permissions.length}</strong> {t('permissions', 'صلاحية')}</p>
              <details className="mt-1 text-xs text-gray-600"><summary className="cursor-pointer">{t('Show permissions', 'عرض الصلاحيات')}</summary><p className="mt-1 break-words leading-relaxed" dir="ltr">{tp.permissions.join(', ')}</p></details>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" onClick={() => { setError(null); setApplyTo(tp); }}>{t('Apply to an admin…', 'تطبيق على مسؤول…')}</Button>
                {!tp.isSystem && <><Button size="sm" onClick={() => { setError(null); setEditor({ id: tp.id, key: tp.key, nameEn: tp.nameEn, nameAr: tp.nameAr, permissions: tp.permissions }); }}>{t('Edit', 'تعديل')}</Button><Button size="sm" variant="danger" onClick={() => { setError(null); setDel(tp); }}>{t('Delete', 'حذف')}</Button></>}
              </div>
            </Card>
          ))}
        </div>
      </Async>

      <Modal open={Boolean(editor)} wide title={editor?.id ? t('Edit template', 'تعديل القالب') : t('New template', 'قالب جديد')} onClose={() => !busy && setEditor(null)} footer={<><Button onClick={() => setEditor(null)} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} onClick={saveTemplate}>{t('Save', 'حفظ')}</Button></>}>
        {editor && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LabeledInput label={t('Key (a–z, 0–9, _ )', 'المفتاح (a–z و 0–9 و _)')} disabled={Boolean(editor.id)} maxLength={39} value={editor.key} onChange={(e) => setEditor({ ...editor, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} />
              <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} value={editor.nameEn} onChange={(e) => setEditor({ ...editor, nameEn: e.target.value })} />
              <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} dir="rtl" value={editor.nameAr} onChange={(e) => setEditor({ ...editor, nameAr: e.target.value })} />
            </div>
            <Async state={catalog} rows={2}>
              <div className="grid max-h-72 grid-cols-1 gap-x-4 overflow-y-auto rounded-lg border border-gray-200 p-2 text-xs sm:grid-cols-2" dir="ltr">
                {(catalog.data ?? []).map((p) => <label key={p} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={editor.permissions.includes(p)} onChange={() => setEditor({ ...editor, permissions: editor.permissions.includes(p) ? editor.permissions.filter((x) => x !== p) : [...editor.permissions, p] })} /> {p}</label>)}
              </div>
            </Async>
            <p className="text-xs text-gray-500">{editor.permissions.length} {t('selected', 'محددة')}</p>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>
        )}
      </Modal>

      {applyTo && <ApplyModal tpl={applyTo} users={users.data ?? []} onClose={() => setApplyTo(null)} />}
      <ConfirmDialog open={Boolean(del)} danger title={t('Delete this template?', 'حذف هذا القالب؟')} message={t('Admins who already received it keep their permissions.', 'يحتفظ المسؤولون الذين حصلوا عليه بصلاحياتهم.')} confirmLabel={t('Delete', 'حذف')} busy={busy} error={error} onConfirm={remove} onClose={() => setDel(null)} />
    </div>
  );
}

function ApplyModal({ tpl, users, onClose }: { tpl: any; users: any[]; onClose: () => void }) {
  const { t } = useLang();
  const toast = useToast();
  const admins = users.filter((u) => u.role === 'ADMIN');
  const [userId, setUserId] = useState('');
  const [mode, setMode] = useState<'ADD' | 'REPLACE'>('ADD');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    setBusy(true); setError(null);
    try { setResult(await send('post', `/admin/users/${userId}/apply-template`, { templateId: tpl.id, mode })); toast.push('success', t('Template applied.', 'تم تطبيق القالب.')); }
    catch (e) { setError(apiErrorMessage(e, t('Could not apply the template.', 'تعذّر تطبيق القالب.'))); } finally { setBusy(false); }
  };
  return (
    <Modal open title={t(`Apply “${tpl.nameEn}”`, `تطبيق «${tpl.nameAr}»`)} onClose={() => !busy && onClose()} footer={result ? <Button variant="primary" onClick={onClose}>{t('Done', 'تم')}</Button> : <><Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!userId} onClick={apply}>{t('Apply', 'تطبيق')}</Button></>}>
      {result ? (
        <div className="space-y-2 text-sm">
          <p>{t('Added', 'أُضيفت')}: <strong>{result.added.length}</strong>{result.added.length > 0 && <span className="block break-words text-xs text-gray-600" dir="ltr">{result.added.join(', ')}</span>}</p>
          <p>{t('Removed', 'أُزيلت')}: <strong>{result.removed.length}</strong>{result.removed.length > 0 && <span className="block break-words text-xs text-gray-600" dir="ltr">{result.removed.join(', ')}</span>}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <LabeledSelect label={t('Admin', 'المسؤول')} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">{t('Choose…', 'اختر…')}</option>{admins.map((u) => <option key={u.id} value={u.id}>{u.fullName}{u.isActive ? '' : ` (${t('inactive', 'غير نشط')})`}</option>)}</LabeledSelect>
          <LabeledSelect label={t('How', 'الطريقة')} value={mode} onChange={(e) => setMode(e.target.value as 'ADD' | 'REPLACE')}><option value="ADD">{t('Add these permissions to what they already have', 'أضف هذه الصلاحيات إلى ما لديه')}</option><option value="REPLACE">{t('Replace all their permissions with these', 'استبدل كل صلاحياته بهذه')}</option></LabeledSelect>
          {mode === 'REPLACE' && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('Replace removes every permission they hold that is not in the template.', 'الاستبدال يزيل كل صلاحية لديه ليست في القالب.')}</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
