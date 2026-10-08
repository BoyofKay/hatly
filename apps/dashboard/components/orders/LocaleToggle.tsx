'use client';

import { useI18n } from '../../lib/i18n/i18n';

/** Language switch for the Admin Order Search screens (English ↔ Arabic/RTL). */
export function LocaleToggle() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500" role="group" aria-label={t('langToggleLabel')}>
      {(['en', 'ar'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`rounded border px-2 py-0.5 ${locale === l ? 'border-hatly-orange text-hatly-orange' : 'border-gray-300'}`}
        >
          {l === 'en' ? t('langEnglish') : t('langArabic')}
        </button>
      ))}
    </div>
  );
}
