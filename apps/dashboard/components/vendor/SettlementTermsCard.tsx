'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, LabeledSelect, useToast } from '../ui';
import { useLang } from '../../lib/ui/lang';
import { apiErrorMessage } from '../../lib/api/errors';
import { useAdminPermission } from '../../lib/auth/use-admin-permission';
import { getBusinessConfigValue } from '../../lib/api/admin-business-config';
import { getSettlementTerms, setSettlementTerms, type SettlementTerms } from '../../lib/api/vendor-operations';

/**
 * The vendor's contractual settlement frequency (weekly or monthly), agreed per vendor and set here — when absent the platform-wide frequency is used at closing. Reading needs the vendor-financial-reports permission and changing it the settlement permission; the server enforces
 * both and every change is audited. It only labels settlement periods closed from now on; it never changes an amount or a closed period.
 */
export function SettlementTermsCard({ vendorId }: { vendorId: string }) {
  const { t, dateTime } = useLang();
  const toast = useToast();
  const canSet = useAdminPermission('CLOSE_VENDOR_SETTLEMENTS');
  const [generalFrequency, setGeneralFrequency] = useState<string | null | undefined>(undefined);
  const [terms, setTerms] = useState<SettlementTerms | null>(null);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [value, setValue] = useState<string>('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const x = await getSettlementTerms(vendorId); setTerms(x); setValue(x.frequency ?? ''); setError(null); }
    catch (e: any) { setError({ message: apiErrorMessage(e, t('Could not load the settlement terms.', 'تعذّر تحميل شروط التسوية.')), denied: e?.response?.status === 403 }); }
  }, [vendorId, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let active = true; getBusinessConfigValue<string>('VENDOR_SETTLEMENT_FREQUENCY').then(v => { if (active) setGeneralFrequency(v); }).catch(() => { if (active) setGeneralFrequency(undefined); }); return () => { active = false; }; }, [vendorId]);

  const label = (f: string | null) => (f === 'WEEKLY' ? t('Weekly', 'أسبوعيًا') : f === 'MONTHLY' ? t('Monthly', 'شهريًا') : t('Not configured', 'غير محددة'));
  async function save() {
    if (busy) return;
    setBusy(true); setSaveError(null);
    try { setTerms(await setSettlementTerms(vendorId, value === '' ? null : (value as 'WEEKLY' | 'MONTHLY'))); setConfirm(false); toast.push('success', t('Settlement terms saved.', 'تم حفظ شروط التسوية.')); }
    catch (e) { setSaveError(apiErrorMessage(e, t('The change was refused.', 'تم رفض التغيير.'))); } finally { setBusy(false); }
  }

  return (
    <Card title={t('Settlement terms', 'شروط التسوية')}>
      <div data-testid="settlement-terms">
        {error ? (
          <p className="text-sm text-gray-600">{error.denied ? t('You do not have permission to view this vendor’s settlement terms.', 'ليست لديك صلاحية عرض شروط التسوية لهذا المتجر.') : error.message}</p>
        ) : !terms ? <p className="text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p> : (
          <div className="space-y-3">
            <p className="text-sm">{t('Frequency', 'الدورة')}: <Badge tone={terms.frequency ? 'green' : 'amber'}>{terms.frequency ? label(terms.frequency) : generalFrequency ? `${t('Inherited', 'موروثة')} — ${label(generalFrequency)}` : generalFrequency === null ? t('Default not configured', 'الدورة الافتراضية غير محددة') : t('Uses general settings', 'تستخدم الإعدادات العامة')}</Badge></p>
            {terms.updatedAt && <p className="text-xs text-gray-500">{t('Last set', 'آخر تعديل')} {dateTime(terms.updatedAt)}{terms.updatedBy ? ` · ${terms.updatedBy}` : ''}</p>}
            {canSet === true ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[12rem] flex-1"><LabeledSelect label={t('Contractual frequency', 'الدورة المتفق عليها')} value={value} onChange={(e) => setValue(e.target.value)}><option value="">{t('Use general settings', 'استخدام الإعدادات العامة')}</option><option value="WEEKLY">{t('Weekly', 'أسبوعيًا')}</option><option value="MONTHLY">{t('Monthly', 'شهريًا')}</option></LabeledSelect></div>
                <Button variant="primary" disabled={value === (terms.frequency ?? '')} onClick={() => { setSaveError(null); setConfirm(true); }}>{t('Save', 'حفظ')}</Button>
              </div>
            ) : <p className="text-xs text-gray-500">{t('Changing this needs the settlement permission.', 'تغييرها يحتاج صلاحية التسوية.')}</p>}
            <p className="text-xs text-gray-500">{t('Vendor-specific terms override the general vendor frequency for every branch. If no override is set, new closings inherit the general setting. This labels new closings only; it does not trigger automatic closing or change any amount or closed period.', 'تعلو شروط المتجر الخاصة على الدورة العامة لجميع فروعه. عند عدم تحديدها ترث التقفيلات الجديدة الإعداد العام. يحدد ذلك وصف التقفيلات الجديدة فقط، ولا يؤدي إلى تقفيل تلقائي أو تعديل أي مبلغ أو فترة مغلقة.')}</p>
          </div>
        )}
      </div>
      <ConfirmDialog open={confirm} title={t('Change the settlement terms?', 'تغيير شروط التسوية؟')} message={t(`The settlement frequency of ${terms?.vendorName ?? 'this vendor'} becomes “${value ? label(value) : t('Use general settings', 'استخدام الإعدادات العامة')}”. The change is recorded in the audit log.`, `ستصبح دورة تسوية ${terms?.vendorName ?? 'هذا المتجر'} «${label(value || null)}». يُسجَّل التغيير في سجل المراجعة.`)} confirmLabel={t('Save', 'حفظ')} busy={busy} error={saveError} onConfirm={() => void save()} onClose={() => setConfirm(false)} />
    </Card>
  );
}
