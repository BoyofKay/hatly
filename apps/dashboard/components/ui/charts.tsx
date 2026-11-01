'use client';

import { useId } from 'react';

/**
 * Dependency-free SVG charts in the Hatly orange. Both carry a text alternative (a visually hidden data table) for assistive technology, never
 * draw anything the data does not contain, and keep time axes left→right even on a right-to-left page.
 */
export interface ChartPoint { label: string; value: number }

/**
 * Daily series from the reports API list only the days that had activity. For a count or a sum a missing day really is zero, so this
 * returns one point per calendar day from `from` to `to` (inclusive, `YYYY-MM-DD`), keeping the reported values and filling the rest with 0 —
 * otherwise the line would join days that are not adjacent and a 7-day chart would show 3 points.
 */
export function fillDays(points: ChartPoint[], from: string, to: string): ChartPoint[] {
  const byDay = new Map(points.map((p) => [p.label, p.value]));
  const out: ChartPoint[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ label: day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

/** An area/line chart (orders per day …). Empty or single-point data still renders honestly (a flat baseline, never an invented trend). */
export function AreaChart({ points, label, format, height = 'h-48', xLabel }: { points: ChartPoint[]; label: string; format?: (n: number) => string; height?: string; xLabel?: (label: string) => string }) {
  const gid = useId().replace(/:/g, '');
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 50 : 4 + (i * 92) / (n - 1));
  const y = (v: number) => 34 - (v / max) * 28;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(2)},36 L${x(0).toFixed(2)},36 Z` : '';
  const fmt = format ?? ((v: number) => String(v));
  const ticks = [0, Math.round(max / 2), max];
  return (
    <figure aria-label={label} dir="ltr" className="w-full">
      <div className="flex gap-2">
        <div className="flex h-48 flex-col justify-between pb-5 text-xs tabular-nums text-gray-400" aria-hidden>
          {[...ticks].reverse().map((t, i) => <span key={i}>{fmt(t)}</span>)}
        </div>
        <div className="relative w-full">
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={`${height} w-full`} role="img" aria-label={label}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF7A1A" stopOpacity="0.28" /><stop offset="100%" stopColor="#FF7A1A" stopOpacity="0.02" /></linearGradient>
            </defs>
            {[6, 20, 34].map((gy) => <line key={gy} x1="0" x2="100" y1={gy} y2={gy} stroke="#EEF0F3" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />)}
            {area && <path d={area} fill={`url(#${gid})`} />}
            {line && <path d={line} fill="none" stroke="#FF7A1A" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
          </svg>
          {/* Dots are HTML so they stay round while the SVG stretches to the card's width. */}
          {points.map((p, i) => (
            <span key={i} title={`${p.label}: ${fmt(p.value)}`} aria-hidden className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-hatly-orange bg-white"
              style={{ left: `${x(i)}%`, top: `${(y(p.value) / 40) * 100}%` }} />
          ))}
        </div>
      </div>
      {n <= 7 ? (
        <div className="relative ms-6 mt-1 h-4 text-xs text-gray-400" aria-hidden>
          {/* On a phone every other name is hidden (its place kept) so day names never run into each other. */}
          {points.map((p, i) => <span key={i} className={`absolute -translate-x-1/2 whitespace-nowrap ${(n - 1 - i) % 2 ? 'invisible sm:visible' : ''}`} style={{ left: `${x(i)}%` }}>{xLabel ? xLabel(p.label) : p.label.slice(5)}</span>)}
        </div>
      ) : (
        <div className="ms-6 mt-1 flex justify-between text-xs text-gray-400" aria-hidden>
          {[points[0], points[Math.floor((n - 1) / 2)], points[n - 1]].map((p, i) => <span key={i}>{xLabel ? xLabel(p.label) : p.label.slice(5)}</span>)}
        </div>
      )}
      <table className="sr-only"><caption>{label}</caption><tbody>{points.map((p, i) => <tr key={i}><th scope="row">{p.label}</th><td>{fmt(p.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}

export interface DonutSegment { label: string; value: number; color: string }

/** A donut with the total in the middle and a legend with each share. Zero segments are dropped from the ring, not from the legend. */
export function DonutChart({ segments, label, centerLabel, testId }: { segments: DonutSegment[]; label: string; centerLabel?: string; testId?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let offset = 25; // start at 12 o'clock
  return (
    <figure aria-label={label} className="flex flex-col items-center gap-4" dir="ltr" data-testid={testId}>
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full" role="img" aria-label={label}>
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#F3F4F6" strokeWidth="5" />
          {total > 0 && segments.map((s) => {
            if (s.value <= 0) return null;
            const len = (s.value / total) * 100;
            const el = (
              <circle key={s.label} cx="21" cy="21" r="15.9155" fill="none" stroke={s.color} strokeWidth="5" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={offset}>
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            );
            offset -= len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums text-gray-900" data-testid={testId ? `${testId}-total` : undefined}>{total.toLocaleString('en-US')}</span>
          {centerLabel && <span className="text-xs text-gray-500">{centerLabel}</span>}
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-gray-700"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
            <span className="shrink-0 tabular-nums text-gray-500">{total > 0 ? Math.round((s.value / total) * 100) : 0}% <span className="text-gray-400">· {s.value.toLocaleString('en-US')}</span></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
