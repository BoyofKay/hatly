'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { useLang } from '../../lib/ui/lang';

/**
 * A side panel that slides in from the END edge (right in English, left in Arabic) so a list stays visible and in place behind it. On a phone it
 * is a full-screen sheet. Esc and a click on the dim area close it; focus moves into the panel and returns to where it was; the page behind does not
 * scroll. `header` carries the title and any previous/next controls, `children` is the body.
 */
export function Drawer({ open, onClose, title, header, children, widthClass = 'sm:max-w-[760px]', testId = 'drawer' }: {
  open: boolean; onClose: () => void; title: string; header?: ReactNode; children: ReactNode; widthClass?: string; testId?: string;
}) {
  const { t } = useLang();
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const id = window.setTimeout(() => panel.current?.focus(), 0);
    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = previousOverflow;
      returnTo.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" data-testid={`${testId}-root`}>
      <div className="absolute inset-0 bg-black/30" aria-hidden onMouseDown={onClose} />
      <div
        ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}
        className={`absolute inset-y-0 end-0 flex w-full ${widthClass} flex-col bg-gray-50 shadow-2xl outline-none`}
      >
        <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">{header ?? <p className="truncate text-sm font-semibold text-gray-900">{title}</p>}</div>
          <button type="button" onClick={onClose} aria-label={t('Close', 'إغلاق')} data-testid={`${testId}-close`} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">{children}</div>
      </div>
    </div>
  );
}
