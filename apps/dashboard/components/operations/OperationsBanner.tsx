'use client';

import { useEffect, useMemo, useState } from 'react';
import { OperationsFacts } from '../../lib/api/admin-control-tower';
import { LOCALE_CHANGED_EVENT, Locale, readStoredLocale } from '../../lib/i18n/i18n';
import { CATALOGS, MessageKey } from '../../lib/i18n/messages';

/** The banner/badge live in the admin layout, outside the pages' I18nProvider: they follow the remembered language themselves. */
export function useStoredLocale(): Locale {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    setLocale(readStoredLocale());
    const onChange = () => setLocale(readStoredLocale());
    window.addEventListener(LOCALE_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(LOCALE_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return locale;
}

function translator(locale: Locale) {
  const catalog: Record<MessageKey, string> = CATALOGS[locale];
  return (key: MessageKey, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((text, [name, v]) => text.split(`{${name}}`).join(String(v)), catalog[key]);
}

/** Small count next to the Control Tower link: everything an operator has to act on right now. */
export function OperationsBadge({ facts }: { facts: OperationsFacts | null }) {
  const locale = useStoredLocale();
  if (!facts || facts.actionRequired <= 0) return null;
  const t = translator(locale);
  return (
    <span
      data-testid="operations-badge"
      aria-label={t('opNavBadgeLabel', { count: facts.actionRequired })}
      title={t('opNavBadgeLabel', { count: facts.actionRequired })}
      className="ms-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
    >
      {facts.actionRequired}
    </span>
  );
}

/**
 * Persistent banner while anything needs a person: unassigned orders (every reason), vendor parts nobody accepted for the approved
 * threshold, overdue preparation, refunds waiting to be sent. It can be hidden, but comes back as soon as the numbers change.
 */
export function OperationsBanner({ facts }: { facts: OperationsFacts | null }) {
  const locale = useStoredLocale();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const signature = facts ? JSON.stringify(facts) : '';

  const lines = useMemo(() => {
    if (!facts) return [];
    const t = translator(locale);
    const a = facts.openDispatchAlerts;
    const out: string[] = [];
    if (a.NO_ELIGIBLE_DRIVER) out.push(t('opBannerNoDriver', { count: a.NO_ELIGIBLE_DRIVER }));
    if (a.AUTO_ASSIGN_DISABLED) out.push(t('opBannerAutoOff', { count: a.AUTO_ASSIGN_DISABLED }));
    if (a.ASSIGNMENT_ERROR) out.push(t('opBannerAssignError', { count: a.ASSIGNMENT_ERROR }));
    if (a.DRIVER_NOT_RESPONDING) out.push(t('opBannerNotResponding', { count: a.DRIVER_NOT_RESPONDING }));
    if (a.ACKNOWLEDGEMENT_OVERDUE) out.push(t('opBannerNotAcknowledged', { count: a.ACKNOWLEDGEMENT_OVERDUE }));
    if (facts.pendingAcceptanceOverdue) out.push(t('opBannerPendingOverdue', { count: facts.pendingAcceptanceOverdue, minutes: facts.pendingAcceptanceAlertMinutes }));
    if (facts.preparationOverdue) out.push(t('opBannerPrepOverdue', { count: facts.preparationOverdue }));
    if (facts.refundsToSend) out.push(t('opBannerRefunds', { count: facts.refundsToSend }));
    return out;
  }, [facts, locale]);

  const [expanded, setExpanded] = useState(false);
  if (!facts || lines.length === 0 || hiddenFor === signature) return null;
  const t = translator(locale);
  const ar = locale === 'ar';
  return (
    <div
      role="alert"
      data-testid="operations-banner"
      dir={ar ? 'rtl' : 'ltr'}
      className="flex flex-col gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-4 sm:px-6"
    >
      <div className="min-w-0 sm:flex-1">
        <p className="flex items-center justify-between gap-2 font-semibold sm:block">
          <span>
            {t('opBannerTitle')}
            <span className="ms-1.5 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white sm:hidden" aria-hidden>{lines.length}</span>
          </span>
          <button type="button" onClick={() => setHiddenFor(signature)} aria-label={t('opBannerDismiss')} className="-me-2 flex h-10 w-10 items-center justify-center rounded-lg text-red-800 sm:hidden">✕</button>
        </p>
        {/* On a phone the list is folded behind a toggle (the title and count stay visible); from `sm` up it is always shown. */}
        <ul className={`mt-0.5 list-disc ps-5 ${expanded ? '' : 'hidden sm:block'}`}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:flex-wrap sm:items-center sm:gap-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="min-h-[44px] rounded-lg border border-red-300 bg-white px-3 text-sm font-medium sm:hidden">
          {expanded ? (ar ? 'إخفاء التفاصيل' : 'Hide details') : ar ? 'عرض التفاصيل' : 'Show details'}
        </button>
        <a href="/control-tower" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-300 bg-white px-3 text-sm font-medium sm:min-h-0 sm:py-1">
          {t('opBannerOpen')}
        </a>
        <button type="button" onClick={() => setHiddenFor(signature)} className="hidden text-xs underline sm:inline">
          {t('opBannerDismiss')}
        </button>
      </div>
    </div>
  );
}
