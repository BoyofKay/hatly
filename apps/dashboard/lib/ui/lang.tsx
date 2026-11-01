'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALE_CHANGED_EVENT, Locale, readStoredLocale } from '../i18n/i18n';

const STORAGE_KEY = 'hatly_dashboard_locale';

export interface Lang {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  /** Every user-visible string is written as an English/Arabic PAIR at the call site, so a missing translation cannot compile. */
  t: (en: string, ar: string) => string;
  setLocale: (l: Locale) => void;
  money: (minor: number | null | undefined) => string;
  num: (n: number | null | undefined) => string;
  date: (iso: string | Date | null | undefined) => string;
  dateTime: (iso: string | Date | null | undefined) => string;
}

const LangContext = createContext<Lang | null>(null);

const CAIRO = 'Africa/Cairo';

/**
 * Formatting policy: Africa/Cairo times, Western (Latin) digits in tables in BOTH languages (consistent with exports), money as an
 * integer-minor-unit string converted by string arithmetic only — never float maths. The dashboard never computes money.
 */
export function formatMoney(minor: number | null | undefined, locale: Locale): string {
  if (minor === null || minor === undefined || Number.isNaN(Number(minor))) return '—';
  const n = Number(minor);
  const neg = n < 0;
  const abs = Math.abs(Math.trunc(n));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  const text = `${neg ? '-' : ''}${whole}.${frac}`;
  return locale === 'ar' ? `${text} ج.م` : `EGP ${text}`;
}

/** The remembered language, or `fallback` when the person never chose one (the Vendor area is Arabic-first; the Admin defaults to English). */
function storedOr(fallback: Locale): Locale {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl === 'ar' || fromUrl === 'en') return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  } catch {
    /* storage unavailable — use the fallback */
  }
  return fallback;
}

export function LangProvider({ children, defaultLocale = 'en' }: { children: React.ReactNode; defaultLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  useEffect(() => {
    setLocaleState(storedOr(defaultLocale));
    const onChange = () => setLocaleState(storedOr(defaultLocale));
    window.addEventListener(LOCALE_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(LOCALE_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [defaultLocale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* not remembered */
    }
    setLocaleState(l);
    window.dispatchEvent(new Event(LOCALE_CHANGED_EVENT));
  }, []);

  const value = useMemo<Lang>(() => {
    const tag = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
    const fmtDate = new Intl.DateTimeFormat(tag, { timeZone: CAIRO, year: 'numeric', month: 'short', day: '2-digit' });
    const fmtDateTime = new Intl.DateTimeFormat(tag, { timeZone: CAIRO, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const toDate = (v: string | Date | null | undefined) => (v ? (v instanceof Date ? v : new Date(v)) : null);
    return {
      locale,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
      t: (en, ar) => (locale === 'ar' ? ar : en),
      setLocale,
      money: (m) => formatMoney(m, locale),
      num: (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US').format(n)),
      date: (v) => {
        const d = toDate(v);
        return d && !Number.isNaN(d.getTime()) ? fmtDate.format(d) : '—';
      },
      dateTime: (v) => {
        const d = toDate(v);
        return d && !Number.isNaN(d.getTime()) ? fmtDateTime.format(d) : '—';
      },
    };
  }, [locale, setLocale]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside <LangProvider>');
  return ctx;
}
