'use client';

import { useState } from 'react';
import { apiClient } from '../../lib/api/client';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, LabeledSelect, Modal, useToast } from '../ui';

export interface SimpleField {
  key: string;
  label: [string, string];
  kind?: 'text' | 'int' | 'money' | 'phone';
  dir?: 'ltr' | 'rtl';
  required?: boolean;
  hint?: [string, string];
  /** When set, the field is a dropdown of [value, English, Arabic]. */
  options?: Array<[string, string, string]>;
}

/**
 * A small "Edit" form for records whose edit is a handful of plain fields (sector names, driver details, …). It PATCHes `path` with ONLY
 * the fields that changed; `money` fields are shown in EGP and sent as integer piastres (`…Minor`), never as a fractional number.
 */
export function SimpleEditModal({ title, path, fields, initial, onClose, onSaved }: {
  title: [string, string];
  path: string;
  fields: SimpleField[];
  initial: Record<string, unknown>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useLang();
  const toast = useToast();
  const show = (f: SimpleField, v: unknown) => (v === null || v === undefined ? '' : f.kind === 'money' ? (Number(v) / 100).toFixed(2) : String(v));
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, show(f, initial[f.key])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = (f: SimpleField): string | null => {
    const v = values[f.key].trim();
    if (!v) return f.required ? t('Required.', 'مطلوب.') : null;
    if (f.kind === 'int' && !/^\d+$/.test(v)) return t('A whole number.', 'عدد صحيح.');
    if (f.kind === 'money' && !(Number(v) >= 0)) return t('A number in EGP.', 'رقم بالجنيه.');
    if (f.kind === 'phone' && !/^\+\d{8,15}$/.test(v)) return t('International format, e.g. +201001234567', 'بالصيغة الدولية مثل ‎+201001234567');
    return null;
  };
  const ok = fields.every((f) => !problem(f));

  async function save() {
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key].trim();
      if (raw === show(f, initial[f.key])) continue;
      if (!raw && !f.required) continue;
      body[f.key] = f.kind === 'int' ? Number(raw) : f.kind === 'money' ? Math.round(Number(raw) * 100) : raw;
    }
    if (Object.keys(body).length === 0) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await apiClient.patch(path, body);
      toast.push('success', t('Saved.', 'تم الحفظ.'));
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save.', 'تعذّر الحفظ.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t(title[0], title[1])} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>{t('Save', 'حفظ')}</Button>
    </>}>
      {fields.map((f) => f.options ? (
        <LabeledSelect key={f.key} label={t(f.label[0], f.label[1])} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
          {f.options.map(([value, en, ar]) => <option key={value} value={value}>{t(en, ar)}</option>)}
        </LabeledSelect>
      ) : (
        <LabeledInput
          key={f.key}
          label={t(f.label[0], f.label[1])}
          dir={f.dir ?? (f.kind && f.kind !== 'text' ? 'ltr' : undefined)}
          inputMode={f.kind === 'int' ? 'numeric' : f.kind === 'money' ? 'decimal' : undefined}
          value={values[f.key]}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          error={values[f.key] ? problem(f) : null}
          hint={f.hint ? t(f.hint[0], f.hint[1]) : undefined}
        />
      ))}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
