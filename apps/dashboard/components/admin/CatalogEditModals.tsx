'use client';

import { useState } from 'react';
import { Product, ProductCategory, updateCategory, updateProduct } from '../../lib/api/admin-catalog';
import { apiErrorMessage } from '../../lib/api/errors';
import { useLang } from '../../lib/ui/lang';
import { Button, LabeledInput, LabeledSelect, LabeledTextarea, Modal, useToast } from '../ui';
import { gramsToKg, minorToEgpInput, parseEgpToMinor, parseKgToGrams } from '../../lib/money';

/** Full product edit for admins (replaces the old name-only prompt): names, descriptions, category, price and stock mode. */
export function ProductEditModal({ product, categories, onClose, onSaved }: { product: Product; categories: ProductCategory[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState(product.name);
  const [nameAr, setNameAr] = useState(product.nameAr ?? '');
  const [description, setDescription] = useState(product.description ?? '');
  const [descriptionAr, setDescriptionAr] = useState(product.descriptionAr ?? '');
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [price, setPrice] = useState(minorToEgpInput(product.priceMinor));
  const [inventoryMode, setInventoryMode] = useState(product.inventoryMode);
  const isWeight = product.pricingUnit === 'WEIGHT';
  // Weighed products are counted in kg on screen (1.5 kg) and stored in grams; pieces stay whole numbers.
  const [quantity, setQuantity] = useState(product.quantity === null ? '' : isWeight ? gramsToKg(product.quantity) : String(product.quantity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedPrice = parseEgpToMinor(price);
  const priceMinor = parsedPrice.ok ? parsedPrice.minor : 0;
  const priceOk = parsedPrice.ok;
  const quantityValue = isWeight ? parseKgToGrams(quantity) : /^\d+$/.test(quantity) ? Number(quantity) : null;
  const qtyOk = inventoryMode === 'OPEN' || quantityValue !== null;
  const ok = name.trim().length > 0 && priceOk && qtyOk;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProduct(product.id, {
        name: name.trim(),
        nameAr: nameAr.trim(),
        description: description.trim(),
        descriptionAr: descriptionAr.trim(),
        categoryId,
        priceMinor,
        inventoryMode,
        ...(inventoryMode === 'TRACKED' && quantityValue !== null ? { quantity: quantityValue } : {}),
      } as any);
      toast.push('success', t('Product saved.', 'تم حفظ المنتج.'));
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save the product.', 'تعذّر حفظ المنتج.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide open title={t('Edit product', 'تعديل المنتج')} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>{t('Save', 'حفظ')}</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} value={name} onChange={(e) => setName(e.target.value)} />
        <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        <LabeledTextarea label={t('Description (English)', 'الوصف (إنجليزي)')} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <LabeledTextarea label={t('Description (Arabic)', 'الوصف (عربي)')} dir="rtl" rows={2} value={descriptionAr} onChange={(e) => setDescriptionAr(e.target.value)} />
        <LabeledSelect label={t('Category', 'القسم')} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr ? `${c.name} — ${c.nameAr}` : c.name}</option>)}
        </LabeledSelect>
        <LabeledInput
          label={product.pricingUnit === 'WEIGHT' ? t('Price per kg (EGP)', 'السعر لكل كجم (جنيه)') : t('Price (EGP)', 'السعر (جنيه)')}
          inputMode="decimal" dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)}
          error={priceOk ? null : t('Enter a price above 0.', 'أدخل سعرًا أكبر من صفر.')}
        />
        <LabeledSelect label={t('Stock', 'المخزون')} value={inventoryMode} onChange={(e) => setInventoryMode(e.target.value as 'OPEN' | 'TRACKED')}>
          <option value="OPEN">{t('Not counted (always available)', 'غير محسوب (متاح دائمًا)')}</option>
          <option value="TRACKED">{t('Counted', 'محسوب بالكمية')}</option>
        </LabeledSelect>
        {inventoryMode === 'TRACKED' && (
          <LabeledInput
            label={isWeight ? t('Quantity in stock (kg)', 'الكمية بالمخزون (كجم)') : t('Quantity in stock (pieces)', 'الكمية بالمخزون (قطعة)')}
            inputMode={isWeight ? 'decimal' : 'numeric'} dir="ltr" value={quantity} onChange={(e) => setQuantity(e.target.value)}
            placeholder={isWeight ? '12.5' : '20'}
            error={qtyOk ? null : isWeight ? t('Kilograms, e.g. 12.5 (up to 3 decimals).', 'بالكيلو، مثل 12.5 (حتى 3 أرقام عشرية).') : t('A whole number, 0 or more.', 'عدد صحيح 0 أو أكثر.')}
          />
        )}
      </div>
      <p className="text-xs text-gray-500">{t('Pricing unit (piece / weight) cannot change; photos are managed from Products › Images.', 'لا يمكن تغيير وحدة التسعير (قطعة/وزن)؛ الصور من المنتجات › الصور.')}</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

export function CategoryEditModal({ category, onClose, onSaved }: { category: ProductCategory; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { t } = useLang();
  const toast = useToast();
  const [name, setName] = useState(category.name);
  const [nameAr, setNameAr] = useState(category.nameAr ?? '');
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = name.trim().length > 0 && /^\d+$/.test(sortOrder);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateCategory(category.id, { name: name.trim(), nameAr: nameAr.trim(), sortOrder: Number(sortOrder) });
      toast.push('success', t('Category saved.', 'تم حفظ القسم.'));
      await onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, t('Could not save the category.', 'تعذّر حفظ القسم.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t('Edit category', 'تعديل القسم')} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>{t('Save', 'حفظ')}</Button>
    </>}>
      <LabeledInput label={t('Name (English)', 'الاسم (إنجليزي)')} value={name} onChange={(e) => setName(e.target.value)} />
      <LabeledInput label={t('Name (Arabic)', 'الاسم (عربي)')} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
      <LabeledInput label={t('Order in the menu (0 = first)', 'الترتيب في المنيو (0 = الأول)')} inputMode="numeric" dir="ltr" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
