'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useLang } from '../../lib/ui/lang';
import { commonStatusLabel } from '../../lib/admin/labels';

/* ------------------------------------------------------------------ tokens / small primitives */

export const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100 disabled:text-gray-500';

type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'orange';
const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700 ring-gray-200',
  green: 'bg-green-50 text-green-800 ring-green-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
};

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  OK: 'green', ACTIVE: 'green', DELIVERED: 'green', COLLECTED: 'green', PAID: 'green', SUCCEEDED: 'green', COMPLETED: 'green', APPLIED: 'green', BALANCED: 'green', RUNNING: 'blue', SENT: 'green', APPROVED: 'blue',
  PENDING: 'amber', QUEUED: 'amber', PARTIAL: 'amber', UNPAID: 'amber', DEGRADED: 'amber', LOW: 'amber', SCHEDULED: 'blue', PENDING_APPROVAL: 'amber', SENDING: 'blue', PREPARING: 'blue', CONFIRMED: 'blue',
  CANCELLED: 'red', FAILED: 'red', DOWN: 'red', REJECTED: 'red', OVERPAID: 'red', OUT: 'red', MISMATCH: 'red', VOIDED: 'gray', DISABLED: 'gray', DRAFT: 'gray', EXPIRED: 'gray', NOTHING_DUE: 'gray', UNLIMITED: 'gray',
};

/** Status text is ALWAYS shown (colour is never the only carrier of meaning). */
export function StatusPill({ status, label }: { status: string | null | undefined; label?: string }) {
  const { t } = useLang();
  if (!status) return <span className="text-gray-400">—</span>;
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{label ?? commonStatusLabel(status, t)}</Badge>;
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-hatly-orange ${className}`} />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}

/* ------------------------------------------------------------------ buttons */

export function Button({
  variant = 'secondary', size = 'md', loading = false, className = '', disabled, children, ...rest
}: { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md'; loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus:ring-2 focus:ring-hatly-orange/40 disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-hatly-orange text-white hover:bg-hatly-orangeDark',
    secondary: 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-gray-700 hover:bg-gray-100',
  };
  return (
    <button {...rest} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-gray-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', pad = true, testId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; testId?: string }) {
  return (
    <section data-testid={testId} className={`rounded-2xl border border-gray-100 bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)] ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-gray-50 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {actions}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <div id={id}>{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Label bound to a single control via cloneElement-free approach: pass the control as children and the id through render prop when needed. */
export function LabeledInput({ label, hint, error, ...props }: { label: string; hint?: string; error?: string | null } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <input id={id} aria-invalid={Boolean(error)} {...props} className={`${inputCls} ${props.className ?? ''}`} />
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function LabeledSelect({ label, children, ...props }: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <select id={id} {...props} className={`${inputCls} ${props.className ?? ''}`}>{children}</select>
    </div>
  );
}

export function LabeledTextarea({ label, hint, error, ...props }: { label: string; hint?: string; error?: string | null } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-gray-700">{label}</label>
      <textarea id={id} {...props} className={`${inputCls} ${props.className ?? ''}`} />
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-400">∅</div>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="max-w-md text-xs text-gray-500">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, status, onRetry }: { message: string; status?: number | null; onRetry?: () => void }) {
  const { t } = useLang();
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">!</div>
      <p className="text-sm font-medium text-gray-800">{status === 403 ? t('You do not have access to this.', 'ليس لديك صلاحية الوصول إلى هذا.') : t('This could not be loaded.', 'تعذّر تحميل هذه البيانات.')}</p>
      <p className="max-w-md text-xs text-gray-500">{message}</p>
      {onRetry && status !== 403 && <Button size="sm" onClick={onRetry}>{t('Retry', 'إعادة المحاولة')}</Button>}
    </div>
  );
}

/** Renders loading skeleton / error / empty / children for a useApi() state. */
export function Async({ state, empty, emptyTitle, rows = 4, children }: { state: { loading: boolean; error: string | null; status: number | null; reload: () => void; data: any }; empty?: boolean; emptyTitle?: string; rows?: number; children: ReactNode }) {
  const { t } = useLang();
  if (state.error && !state.data) return <ErrorState message={state.error} status={state.status} onRetry={state.reload} />;
  if (state.loading && !state.data) return <div className="space-y-2" aria-busy="true">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
  if (empty) return <EmptyState title={emptyTitle ?? t('Nothing here yet', 'لا يوجد شيء بعد')} />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ KPI + charts */

export function KpiCard({ label, value, hint, delta, tone, icon, testId, footnote }: { label: string; value: ReactNode; hint?: string; delta?: number | null; tone?: 'good' | 'bad' | 'neutral'; icon?: ReactNode; testId?: string; footnote?: ReactNode }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)] sm:p-5">
      {/* The label shares its row with the icon and may wrap to two lines; the value gets the card's full width so amounts never wrap. */}
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-w-0 text-xs font-medium leading-snug text-gray-500" title={hint}>{label}</p>
        {icon && <span aria-hidden className="-mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-hatly-orange sm:h-10 sm:w-10">{icon}</span>}
      </div>
      <p data-testid={testId ? `${testId}-value` : undefined} className="mt-1.5 whitespace-nowrap text-xl font-semibold tabular-nums text-gray-900 sm:text-2xl">{value}</p>
      {footnote && <p className="mt-1 text-xs text-gray-400">{footnote}</p>}
      {delta !== undefined && delta !== null && (
        <p className={`mt-1.5 text-xs font-medium tabular-nums ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-700' : 'text-gray-500'}`}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {Math.abs(delta)}%
        </p>
      )}
    </div>
  );
}

/** Simple, dependency-free bar chart (SVG) with a data-table alternative for assistive technology. Time axes stay left→right in RTL. */
export function BarChart({ points, format, label, xLabel, tick }: { points: Array<{ label: string; value: number }>; format?: (n: number) => string; label: string; xLabel?: (label: string) => string; tick?: (n: number) => string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / Math.max(1, points.length);
  const name = (l: string) => (xLabel ? xLabel(l) : l);
  return (
    <figure aria-label={label} dir="ltr">
      <div className="flex gap-2">
        {/* Optional value axis (the reference's left scale): 0, half and the largest value, in the caller's short format. */}
        {tick && <div className="flex h-40 flex-col justify-between pb-1 text-xs tabular-nums text-gray-400" aria-hidden>{[max, max / 2, 0].map((v, i) => <span key={i}>{tick(v)}</span>)}</div>}
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={label}>
          <defs><linearGradient id="hatly-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF7A1A" /><stop offset="100%" stopColor="#FFB27A" /></linearGradient></defs>
          {tick && [2, 20, 38].map((gy) => <line key={gy} x1="0" x2="100" y1={gy} y2={gy} stroke="#EEF0F3" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />)}
          {points.map((p, i) => {
            const h = (p.value / max) * 36;
            return (
              <g key={i}>
                <title>{`${p.label}: ${format ? format(p.value) : p.value}`}</title>
                <rect x={i * w + w * 0.2} y={38 - h} width={w * 0.6} height={Math.max(h, 0.4)} rx={0.8} fill="url(#hatly-bar)" />
              </g>
            );
          })}
        </svg>
      </div>
      {points.length <= 7 ? (
        <div className={`mt-1 flex text-xs text-gray-500 ${tick ? 'ms-10' : ''}`} aria-hidden>{points.map((p, i) => <span key={i} className={`min-w-0 flex-1 truncate text-center ${(points.length - 1 - i) % 2 ? 'invisible sm:visible' : ''}`}>{name(p.label)}</span>)}</div>
      ) : (
        <div className={`mt-1 flex justify-between text-xs text-gray-500 ${tick ? 'ms-10' : ''}`} aria-hidden><span>{name(points[0]?.label ?? '')}</span><span>{name(points[points.length - 1]?.label ?? '')}</span></div>
      )}
      <table className="sr-only"><caption>{label}</caption><tbody>{points.map((p) => <tr key={p.label}><th>{p.label}</th><td>{format ? format(p.value) : p.value}</td></tr>)}</tbody></table>
    </figure>
  );
}

/* ------------------------------------------------------------------ tabs */

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${value === tb.id ? 'border-hatly-orange text-hatly-orange' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ data table (server-driven) */

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

/**
 * Server-paginated table. ≥ md: a real <table> (horizontal scroll when needed). < md: one card per row, every column labelled.
 * Loading shows skeleton rows, errors show a retry, an empty result is explicit (never a blank panel).
 */
export function DataTable<T>({ columns, rows, rowKey, loading, error, status, onRetry, emptyTitle, emptyHint, onRowClick, footer, renderCard }: {
  columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string; loading?: boolean; error?: string | null; status?: number | null; onRetry?: () => void; emptyTitle?: string; emptyHint?: string; onRowClick?: (r: T) => void; footer?: ReactNode;
  /** Phone layout: a purpose-built compact card per row instead of one labelled line per column. */
  renderCard?: (r: T) => ReactNode;
}) {
  const { t } = useLang();
  if (error && !rows) return <ErrorState message={error} status={status} onRetry={onRetry} />;
  if (loading && !rows) return <div className="space-y-2 p-4" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
  if (!rows || rows.length === 0) return <EmptyState title={emptyTitle ?? t('No results', 'لا توجد نتائج')} hint={emptyHint ?? t('Try changing or clearing the filters.', 'جرّب تغيير الفلاتر أو مسحها.')} />;
  return (
    <div className={loading ? 'opacity-60 transition-opacity' : ''}>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              {columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.align === 'end' ? 'text-end' : 'text-start'}`}>{c.header}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`border-b border-gray-100 ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
                {columns.map((c) => <td key={c.key} className={`px-3 py-2 align-middle ${c.align === 'end' ? 'text-end tabular-nums' : 'text-start'} ${c.className ?? ''}`}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
          {footer}
        </table>
      </div>
      <ul className="divide-y divide-gray-100 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={`px-3 py-3 ${renderCard ? '' : 'space-y-1'} ${onRowClick ? 'cursor-pointer active:bg-gray-50' : ''}`}>
            {renderCard ? renderCard(r) : columns.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 text-sm">
                <span className="shrink-0 text-xs text-gray-500">{c.header}</span>
                <span className="min-w-0 text-end">{c.cell(r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const { t, num } = useLang();
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav aria-label={t('Pagination', 'ترقيم الصفحات')} className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-600">
      <span className="tabular-nums">{t(`${num(from)}–${num(to)} of ${num(total)}`, `${num(from)}–${num(to)} من ${num(total)}`)}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('Previous page', 'الصفحة السابقة')}>{t('Previous', 'السابق')}</Button>
        <span className="px-2 tabular-nums">{num(page)} / {num(pages)}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('Next page', 'الصفحة التالية')}>{t('Next', 'التالي')}</Button>
      </span>
    </nav>
  );
}

/** "Load more" pager for keyset lists. */
export function CursorMore({ hasMore, loading, onMore }: { hasMore: boolean; loading: boolean; onMore: () => void }) {
  const { t } = useLang();
  if (!hasMore) return null;
  return <div className="flex justify-center border-t border-gray-100 p-3"><Button size="sm" loading={loading} onClick={onMore}>{t('Load more', 'تحميل المزيد')}</Button></div>;
}

/* ------------------------------------------------------------------ modal / confirm / toast */

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass `onClose` as an inline arrow, a NEW function on every render. With it in the effect's dependencies, each keystroke in a
  // field (which re-renders the caller) tore the effect down and set it up again: focus jumped back to the opener and then to the FIRST
  // field — typing stopped after one character (owner report, 2026-11-15). The latest onClose is read from a ref; the effect runs only
  // when the modal opens or closes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
        if (f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 0);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100">✕</button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** One-sentence consequence, optional required reason, optional typed confirmation. Never closes while the action is running. */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, reasonLabel, reasonMin = 0, typeToConfirm, busy, error, onConfirm, onClose }: {
  open: boolean; title: string; message: ReactNode; confirmLabel: string; danger?: boolean; reasonLabel?: string; reasonMin?: number; typeToConfirm?: string; busy?: boolean; error?: string | null; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const { t } = useLang();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) { setReason(''); setTyped(''); } }, [open]);
  const ok = reason.trim().length >= reasonMin && (!typeToConfirm || typed.trim() === typeToConfirm);
  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()} footer={<>
      <Button onClick={onClose} disabled={busy}>{t('Cancel', 'إلغاء')}</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!ok} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
    </>}>
      <div className="text-sm text-gray-700">{message}</div>
      {reasonLabel && <LabeledTextarea label={reasonLabel} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} hint={reasonMin ? t(`At least ${reasonMin} characters.`, `${reasonMin} أحرف على الأقل.`) : undefined} />}
      {typeToConfirm && <LabeledInput label={t(`Type "${typeToConfirm}" to confirm`, `اكتب "${typeToConfirm}" للتأكيد`)} value={typed} onChange={(e) => setTyped(e.target.value)} />}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}

interface ToastItem { id: number; kind: 'success' | 'error' | 'info'; text: string }
const ToastContext = createContext<{ push: (kind: ToastItem['kind'], text: string) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, kind, text }]);
    if (kind !== 'error') setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} role={i.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ${i.kind === 'error' ? 'bg-red-600 text-white' : i.kind === 'success' ? 'bg-green-600 text-white' : 'bg-gray-900 text-white'}`}>
            <span>{i.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems((s) => s.filter((x) => x.id !== i.id))} className="opacity-80 hover:opacity-100">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* ------------------------------------------------------------------ filter helpers */

export function FilterBar({ children, onClear }: { children: ReactNode; onClear?: () => void }) {
  const { t } = useLang();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      {children}
      {onClear && <Button variant="ghost" size="sm" onClick={onClear}>{t('Clear filters', 'مسح الفلاتر')}</Button>}
    </div>
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t } = useLang();
  return (
    <>
      <div className="w-40"><LabeledInput type="date" label={t('From (Cairo date)', 'من (تاريخ القاهرة)')} value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} /></div>
      <div className="w-40"><LabeledInput type="date" label={t('To (Cairo date)', 'إلى (تاريخ القاهرة)')} value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} /></div>
    </>
  );
}

/** Today / N days ago as Africa/Cairo calendar dates (the backend interprets every filter date in Cairo). */
export function cairoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

/** Page-level state for a paginated list: page resets when any filter changes. */
export function usePaging(resetKey: string, limit = 25) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  return { page, setPage, limit };
}
