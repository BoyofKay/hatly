'use client';
import { useState, type ComponentProps } from 'react';
import { useLang } from '../../lib/ui/lang';

/** Password is hidden by default; each field has independent visibility. */
export function PasswordVisibilityInput({ className, id, ...props }: ComponentProps<'input'>) {
  const [visible, setVisible] = useState(false);
  const { t } = useLang();
  return (
    <div className="relative" dir="ltr">
      <input {...props} id={id} type={visible ? 'text' : 'password'} className={`${className ?? ''} pe-11`} />
      <button type="button" onClick={() => setVisible(v => !v)} aria-pressed={visible} aria-controls={id}
        aria-label={visible ? t('Hide password', 'إخفاء كلمة المرور') : t('Show password', 'إظهار كلمة المرور')}
        className="absolute inset-y-0 end-0 mt-1 flex w-11 items-center justify-center text-gray-500 hover:text-gray-900">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {visible ? <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.6 8 3.4 9.8 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1.1" /> : <><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
      </button>
    </div>
  );
}
