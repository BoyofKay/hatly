'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  OptionsScope,
  ProductOptionGroup,
  addOptionValue,
  createOptionGroup,
  deleteOptionGroup,
  deleteOptionValue,
  formatSignedMinor,
  listOptionGroups,
  parseSignedEgpToMinor,
  updateOptionGroup,
  updateOptionValue,
} from '../../lib/api/product-options';
import { apiErrorMessage } from '../../lib/api/errors';

/**
 * Option groups ("modifiers") of one product: a group is single-choice or multiple-choice, optionally required, with optional
 * minimum / maximum selections; each value carries a price (EGP, may be negative) added to the product's base price. Every rule is
 * enforced by the server — this form only helps and shows the server's message. Changing a group never changes an order already
 * placed (orders keep their own snapshot); a carts holding a removed value simply loses it and asks again at checkout.
 */
export function ProductOptionsEditor({ scope, productId }: { scope: OptionsScope; productId: string }) {
  const [groups, setGroups] = useState<ProductOptionGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setGroups(await listOptionGroups(scope, productId));
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load the options.'));
    }
  }, [scope, productId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const replaceGroup = (updated: ProductOptionGroup) => setGroups((all) => (all ?? []).map((g) => (g.id === updated.id ? updated : g)));

  return (
    <div data-testid={`options-editor-${productId}`} className="mt-3 rounded border border-dashed bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Options (modifiers)</h4>
        <button data-testid="option-group-new" onClick={() => setAdding((v) => !v)} className="text-xs text-hatly-orange underline">
          {adding ? 'Cancel' : 'Add option group'}
        </button>
      </div>
      {scope === 'vendor' && (
        <p className="mt-2 rounded bg-blue-50 p-2 text-xs text-blue-800" data-testid="options-review-note">
          On a live product, new options, renamed choices and higher prices are sent to Hatly for approval; lowering a price or removing a choice applies at once.
          {' '}<span dir="rtl">في المنتج المعروض، الخيارات الجديدة وتغيير الأسماء ورفع الأسعار تُرسل إلى هاتلي للموافقة؛ خفض السعر أو حذف خيار يُطبَّق فورًا.</span>
        </p>
      )}
      {error && (
        <p data-testid="options-error" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
      {groups === null && !error && <p className="mt-2 text-xs text-gray-500">Loading…</p>}
      {groups?.length === 0 && !adding && <p className="mt-2 text-xs text-gray-500">No options — customers just add the product.</p>}
      {adding && (
        <NewGroupForm
          onCreate={async (input) => {
            const created = await createOptionGroup(scope, productId, input);
            setGroups((all) => [...(all ?? []), created]);
            setAdding(false);
          }}
        />
      )}
      <div className="mt-2 space-y-3">
        {groups?.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            scope={scope}
            onChanged={replaceGroup}
            onDeleted={() => setGroups((all) => (all ?? []).filter((x) => x.id !== g.id))}
          />
        ))}
      </div>
    </div>
  );
}

function describe(g: ProductOptionGroup): string {
  const kind = g.allowsMultiple ? 'Multiple choice' : 'Single choice';
  const parts = [kind];
  if (g.isRequired) parts.push('required');
  if (g.allowsMultiple && g.minSelections > 1) parts.push(`min ${g.minSelections}`);
  if (g.allowsMultiple && g.maxSelections != null) parts.push(`max ${g.maxSelections}`);
  return parts.join(' · ');
}

function GroupCard({
  group,
  scope,
  onChanged,
  onDeleted,
}: {
  group: ProductOptionGroup;
  scope: OptionsScope;
  onChanged: (g: ProductOptionGroup) => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [valueName, setValueName] = useState('');
  const [valuePrice, setValuePrice] = useState('');

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(apiErrorMessage(err, 'The change was refused.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`option-group-${group.id}`} className="rounded-xl border bg-white p-3 border-gray-200 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">
            {group.name}
            {group.nameAr ? <span dir="rtl" className="text-gray-500"> / {group.nameAr}</span> : null}
          </p>
          <p data-testid="option-group-summary" className="text-xs text-gray-500">
            {describe(group)}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <button data-testid="option-group-edit" onClick={() => setEditing((v) => !v)} className="underline">
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            data-testid="option-group-delete"
            disabled={busy}
            onClick={() => run(async () => {
              if (!window.confirm(`Delete the option group “${group.name}” and all its values?`)) return;
              await deleteOptionGroup(scope, group.id);
              onDeleted();
            })}
            className="text-red-600 underline disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {editing && <GroupEditForm group={group} onSave={(input) => run(async () => { onChanged(await updateOptionGroup(scope, group.id, input)); setEditing(false); })} />}

      <ul className="mt-2 space-y-1">
        {group.values.map((v) => (
          <ValueRow key={v.id} value={v} scope={scope} onChanged={onChanged} onError={setError} />
        ))}
      </ul>

      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const price = valuePrice.trim() === '' ? 0 : parseSignedEgpToMinor(valuePrice);
          if (!valueName.trim()) return setError('Enter a value name.');
          if (price === null) return setError('Enter the price in EGP, e.g. 5, 5.50 or -2.');
          run(async () => {
            onChanged(await addOptionValue(scope, group.id, { name: valueName.trim(), priceDeltaMinor: price }));
            setValueName('');
            setValuePrice('');
          });
        }}
      >
        <input data-testid="option-value-name" value={valueName} onChange={(e) => setValueName(e.target.value)} placeholder="New value" className="rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
        <input data-testid="option-value-price" value={valuePrice} onChange={(e) => setValuePrice(e.target.value)} placeholder="Price EGP (0)" className="w-28 rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
        <button data-testid="option-value-add" type="submit" disabled={busy} className="rounded-lg bg-hatly-orange px-2 py-1 text-xs text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
          Add value
        </button>
      </form>
      {error && (
        <p data-testid="option-group-error" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

function ValueRow({
  value,
  scope,
  onChanged,
  onError,
}: {
  value: ProductOptionGroup['values'][number];
  scope: OptionsScope;
  onChanged: (g: ProductOptionGroup) => void;
  onError: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState((value.priceDeltaMinor / 100).toFixed(2));

  async function save() {
    const minor = parseSignedEgpToMinor(price);
    if (minor === null) return onError('Enter the price in EGP, e.g. 5, 5.50 or -2.');
    try {
      onError(null);
      onChanged(await updateOptionValue(scope, value.id, { priceDeltaMinor: minor }));
      setEditing(false);
    } catch (err) {
      onError(apiErrorMessage(err, 'The change was refused.'));
    }
  }

  async function remove() {
    try {
      onError(null);
      onChanged(await deleteOptionValue(scope, value.id));
    } catch (err) {
      onError(apiErrorMessage(err, 'The change was refused.'));
    }
  }

  return (
    <li data-testid={`option-value-${value.id}`} className="flex items-center justify-between text-xs">
      <span>
        {value.name}
        {value.nameAr ? <span dir="rtl" className="text-gray-500"> / {value.nameAr}</span> : null}
      </span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input data-testid="option-value-price-input" value={price} onChange={(e) => setPrice(e.target.value)} className="w-20 rounded-lg border px-1 py-0.5 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          <button data-testid="option-value-price-save" onClick={save} className="rounded-lg bg-hatly-orange px-2 py-0.5 text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
            Save
          </button>
          <button onClick={() => setEditing(false)} className="underline">
            Cancel
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span data-testid="option-value-price-text">{formatSignedMinor(value.priceDeltaMinor)} EGP</span>
          <button data-testid="option-value-price-edit" onClick={() => setEditing(true)} className="underline">
            Price
          </button>
          <button data-testid="option-value-delete" onClick={remove} className="text-red-600 underline">
            Remove
          </button>
        </span>
      )}
    </li>
  );
}

interface GroupFormState {
  name: string;
  nameAr: string;
  allowsMultiple: boolean;
  isRequired: boolean;
  min: string;
  max: string;
}

function toLimits(f: GroupFormState): { ok: true; minSelections: number; maxSelections: number | null } | { ok: false; error: string } {
  const min = f.min.trim() === '' ? 0 : Number(f.min);
  const max = f.max.trim() === '' ? null : Number(f.max);
  if (!Number.isInteger(min) || min < 0) return { ok: false, error: 'Minimum must be a whole number ≥ 0.' };
  if (max !== null && (!Number.isInteger(max) || max < 1)) return { ok: false, error: 'Maximum must be a whole number ≥ 1 (or empty for no limit).' };
  return { ok: true, minSelections: min, maxSelections: max };
}

function LimitsFields({ f, set }: { f: GroupFormState; set: (patch: Partial<GroupFormState>) => void }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
      <label className="flex items-center gap-1">
        <input data-testid="option-group-multiple" type="checkbox" checked={f.allowsMultiple} onChange={(e) => set({ allowsMultiple: e.target.checked })} />
        Multiple choice
      </label>
      <label className="flex items-center gap-1">
        <input data-testid="option-group-required" type="checkbox" checked={f.isRequired} onChange={(e) => set({ isRequired: e.target.checked })} />
        Required
      </label>
      {f.allowsMultiple && (
        <>
          <label>
            Min selections
            <input data-testid="option-group-min" value={f.min} onChange={(e) => set({ min: e.target.value })} className="ml-1 w-14 rounded-lg border px-1 py-0.5 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </label>
          <label>
            Max selections
            <input data-testid="option-group-max" value={f.max} onChange={(e) => set({ max: e.target.value })} placeholder="no limit" className="ml-1 w-16 rounded-lg border px-1 py-0.5 border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 text-sm" />
          </label>
        </>
      )}
    </div>
  );
}

function GroupEditForm({ group, onSave }: { group: ProductOptionGroup; onSave: (input: { name: string; nameAr?: string; isRequired: boolean; allowsMultiple: boolean; minSelections: number; maxSelections: number | null }) => void }) {
  const [f, setF] = useState<GroupFormState>({
    name: group.name,
    nameAr: group.nameAr ?? '',
    allowsMultiple: group.allowsMultiple,
    isRequired: group.isRequired,
    min: String(group.minSelections),
    max: group.maxSelections == null ? '' : String(group.maxSelections),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<GroupFormState>) => setF((s) => ({ ...s, ...patch }));
  return (
    <form
      className="mt-2 rounded bg-gray-50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        const limits = toLimits(f);
        if (!f.name.trim()) return setError('Enter a group name.');
        if (!limits.ok) return setError(limits.error);
        setError(null);
        onSave({
          name: f.name.trim(),
          nameAr: f.nameAr.trim() || undefined,
          isRequired: f.isRequired,
          allowsMultiple: f.allowsMultiple,
          minSelections: f.allowsMultiple ? limits.minSelections : f.isRequired ? 1 : 0,
          maxSelections: f.allowsMultiple ? limits.maxSelections : null,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input data-testid="option-group-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Name" className="rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
        <input value={f.nameAr} dir="rtl" onChange={(e) => set({ nameAr: e.target.value })} placeholder="الاسم بالعربية" className="rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      </div>
      <LimitsFields f={f} set={set} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <button data-testid="option-group-save" type="submit" className="mt-2 rounded-lg bg-hatly-orange px-3 py-1 text-xs text-white shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
        Save group
      </button>
    </form>
  );
}

function NewGroupForm({ onCreate }: { onCreate: (input: { name: string; nameAr?: string; isRequired: boolean; allowsMultiple: boolean; minSelections: number; maxSelections?: number | null; values: Array<{ name: string; priceDeltaMinor: number }> }) => Promise<void> }) {
  const [f, setF] = useState<GroupFormState>({ name: '', nameAr: '', allowsMultiple: false, isRequired: false, min: '', max: '' });
  const [valuesText, setValuesText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<GroupFormState>) => setF((s) => ({ ...s, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!f.name.trim()) return setError('Enter a group name.');
    const limits = toLimits(f);
    if (!limits.ok) return setError(limits.error);
    // One value per line: "Name | price EGP" — the price is optional (0) and may be negative.
    const values: Array<{ name: string; priceDeltaMinor: number }> = [];
    for (const line of valuesText.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [name, price = ''] = line.split('|').map((s) => s.trim());
      const minor = price === '' ? 0 : parseSignedEgpToMinor(price);
      if (!name || minor === null) return setError(`Could not read “${line}”. Use: Name | price in EGP (e.g. Large | 6.50).`);
      values.push({ name, priceDeltaMinor: minor });
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: f.name.trim(),
        nameAr: f.nameAr.trim() || undefined,
        isRequired: f.isRequired,
        allowsMultiple: f.allowsMultiple,
        minSelections: f.allowsMultiple ? limits.minSelections : 0,
        maxSelections: f.allowsMultiple ? limits.maxSelections : undefined,
        values,
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'The group was refused.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-testid="option-group-form" onSubmit={submit} className="mt-2 space-y-2 rounded-xl border bg-white p-3 border-gray-200 shadow-sm">
      <div className="grid grid-cols-2 gap-2">
        <input data-testid="option-group-name" value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Group name (e.g. Size)" className="rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
        <input value={f.nameAr} dir="rtl" onChange={(e) => set({ nameAr: e.target.value })} placeholder="الاسم بالعربية" className="rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100" />
      </div>
      <LimitsFields f={f} set={set} />
      <textarea
        data-testid="option-group-values"
        value={valuesText}
        onChange={(e) => setValuesText(e.target.value)}
        rows={4}
        placeholder={'One value per line — Name | price in EGP\nSmall\nLarge | 6.50'}
        className="w-full rounded-lg border px-2 py-1 text-xs border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
      />
      {error && (
        <p data-testid="option-group-form-error" className="text-xs text-red-600">
          {error}
        </p>
      )}
      <button data-testid="option-group-create" type="submit" disabled={busy} className="rounded-lg bg-hatly-orange px-3 py-1 text-xs text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
        {busy ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}
