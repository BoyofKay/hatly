'use client';

/**
 * The alarm sound, generated with Web Audio (no audio file). Browsers refuse to start audio until the person interacts with the page
 * (autoplay policy), so the context starts "locked"; the first click or key press anywhere — or the explicit "Enable sound" button —
 * unlocks it. `audioState()` reports the truth; nothing claims sound is on while it is locked.
 */
type Ctx = AudioContext;
let ctx: Ctx | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export type AudioState = 'unsupported' | 'locked' | 'ready';

function create(): Ctx | null {
  if (typeof window === 'undefined') return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  if (!ctx) {
    ctx = new C();
    ctx.onstatechange = notify;
  }
  return ctx;
}

export function audioState(): AudioState {
  if (typeof window === 'undefined') return 'locked';
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return 'unsupported';
  return ctx && ctx.state === 'running' ? 'ready' : 'locked';
}

export function onAudioStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Call from a user gesture. Resolves true when audio is running. */
export async function unlockAudio(): Promise<boolean> {
  const c = create();
  if (!c) return false;
  try {
    if (c.state !== 'running') await c.resume();
    // A silent blip keeps iOS/Safari's context unlocked.
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.02);
  } catch {
    /* refused */
  }
  notify();
  return c.state === 'running';
}

/** Unlocks on the first interaction anywhere on the page (the only way browsers allow it). */
export function unlockOnFirstGesture(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = () => void unlockAudio();
  const opts = { capture: true, passive: true } as AddEventListenerOptions;
  document.addEventListener('pointerdown', handler, opts);
  document.addEventListener('keydown', handler, opts);
  document.addEventListener('touchend', handler, opts);
  return () => {
    document.removeEventListener('pointerdown', handler, opts);
    document.removeEventListener('keydown', handler, opts);
    document.removeEventListener('touchend', handler, opts);
  };
}

const PATTERNS: Record<'critical' | 'high' | 'test', Array<[number, number, number]>> = {
  // [frequency Hz, start s, duration s] — critical: three urgent two-tone pulses (~1.7 s); high: one soft chime.
  critical: [[988, 0, 0.18], [1319, 0.2, 0.18], [988, 0.6, 0.18], [1319, 0.8, 0.18], [988, 1.2, 0.18], [1319, 1.4, 0.25]],
  high: [[660, 0, 0.2], [880, 0.22, 0.3]],
  test: [[988, 0, 0.18], [1319, 0.2, 0.25]],
};

/** Plays once. Returns false when audio is locked or unsupported (the caller shows why). Never loops by itself. */
export function playAlarm(kind: 'critical' | 'high' | 'test'): boolean {
  const c = ctx;
  if (!c || c.state !== 'running') return false;
  try {
    const t0 = c.currentTime + 0.02;
    for (const [freq, start, dur] of PATTERNS[kind]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(kind === 'high' ? 0.12 : 0.25, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(c.destination);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.02);
    }
    (window as unknown as { __hatlyAlarmPlays?: number }).__hatlyAlarmPlays = ((window as unknown as { __hatlyAlarmPlays?: number }).__hatlyAlarmPlays ?? 0) + 1;
    return true;
  } catch {
    return false;
  }
}
