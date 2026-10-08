'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CATALOGS, MessageKey } from './messages';

export type Locale = 'en' | 'ar';

const STORAGE_KEY = 'hatly_dashboard_locale';

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'ar' || fromUrl === 'en') return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  return 'en';
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Translate;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18n | null>(null);

/** Wraps the Admin Order Search screens: owns the locale (English by default, remembered in localStorage) and the text direction. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  // The Admin layout renders nothing until the client-side session check has run, so this never renders on the server.
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* the choice just isn't remembered */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const catalog: Record<MessageKey, string> = CATALOGS[locale];
    const t: Translate = (key, vars) =>
      Object.entries(vars ?? {}).reduce((text, [name, v]) => text.split(`{${name}}`).join(String(v)), catalog[key]);
    return { locale, dir: locale === 'ar' ? 'rtl' : 'ltr', t, setLocale };
  }, [locale, setLocale]);

  return (
    <I18nContext.Provider value={value}>
      <div dir={value.dir} lang={value.locale}>
        {children}
      </div>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>.');
  return ctx;
}
