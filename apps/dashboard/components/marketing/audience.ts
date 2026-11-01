export function describeRules(rules: Record<string, any>, t: (en: string, ar: string) => string): string {
  const parts: string[] = [];
  if (rules.lastOrderWithinDays) parts.push(t(`Ordered in the last ${rules.lastOrderWithinDays} days`, `طلب خلال آخر ${rules.lastOrderWithinDays} يومًا`));
  if (rules.noOrderForDays) parts.push(t(`No order for ${rules.noOrderForDays} days`, `بلا طلب منذ ${rules.noOrderForDays} يومًا`));
  if (rules.minOrders) parts.push(t(`At least ${rules.minOrders} orders`, `${rules.minOrders} طلبات على الأقل`));
  if (rules.neverOrdered) parts.push(t('Never ordered', 'لم يطلب أبدًا'));
  if (rules.registeredFrom || rules.registeredTo) parts.push(t(`Registered ${rules.registeredFrom ?? '…'} → ${rules.registeredTo ?? '…'}`, `سجّل ${rules.registeredFrom ?? '…'} ← ${rules.registeredTo ?? '…'}`));
  if (rules.usedOfferId) parts.push(t('Used a specific offer', 'استخدم عرضًا محددًا'));
  return parts.length ? parts.join(' · ') : t('All active customers', 'كل العملاء النشطين');
}
