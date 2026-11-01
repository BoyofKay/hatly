/**
 * Client side of D-72 change detection. Framework-free so it can be tested without a browser.
 *
 * How it keeps a screen current without re-downloading a list every few seconds:
 *   1. ask the server for a starting cursor BEFORE the first full load (so nothing that happens during the load is missed);
 *   2. load the list once (`reload`);
 *   3. every `pollMs` ask "what changed since my cursor?" — a few ids, or nothing; reload only when something did;
 *   4. when the server says the cursor can no longer be honoured (`reset`), reload once and continue from the fresh cursor.
 *
 * It never trusts the feed alone. A safety-net reload runs every `safetyReloadMs`, and if the feed is unavailable (an older backend without
 * the endpoint, repeated errors) it falls back to the previous behaviour — a full reload every `legacyPollMs` — and tries the feed again
 * later. A screen therefore can only be as stale as the old polling made it, never more.
 */
export interface ChangesPage {
  cursor: string;
  changes: Array<{ entity: string; id: string; orderId: string; kind: string; seq: string }>;
  hasMore: boolean;
  reset: boolean;
}

export interface ChangeFeedOptions {
  /** `since` undefined = "give me a starting cursor". */
  fetchPage: (since?: string) => Promise<ChangesPage>;
  /** The full, authoritative load of whatever the screen shows. */
  reload: () => Promise<void>;
  onChanges?: (changes: ChangesPage['changes']) => void;
  /** Called with the mode whenever it changes, so a screen can say "live" or "refreshing every 20 s". */
  onMode?: (mode: 'feed' | 'legacy') => void;
  pollMs?: number;
  safetyReloadMs?: number;
  legacyPollMs?: number;
  retryFeedMs?: number;
  maxErrorsBeforeLegacy?: number;
  isVisible?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const MAX_PAGES_PER_TICK = 20;

export class ChangeFeed {
  private cursor: string | undefined;
  private mode: 'feed' | 'legacy' = 'legacy';
  private timer: unknown;
  private running = false;
  private busy = false;
  private errors = 0;
  private lastReloadAt = 0;
  private lastFeedAttemptAt = 0;
  private announced = false;
  private readonly o: Required<Omit<ChangeFeedOptions, 'onChanges' | 'onMode'>> & Pick<ChangeFeedOptions, 'onChanges' | 'onMode'>;

  constructor(options: ChangeFeedOptions) {
    this.o = {
      pollMs: 8_000,
      safetyReloadMs: 120_000,
      legacyPollMs: 20_000,
      retryFeedMs: 300_000,
      maxErrorsBeforeLegacy: 3,
      isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  get currentMode() {
    return this.mode;
  }
  get currentCursor() {
    return this.cursor;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.connect();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) this.o.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** Check now (e.g. the tab became visible again, or the user pressed refresh). */
  async kick(): Promise<void> {
    if (!this.running) return;
    await this.tick(true);
  }

  /** One step of the loop; public so tests can drive it without timers. */
  async tick(force = false): Promise<void> {
    if (this.busy) return;
    if (!force && !this.o.isVisible()) return;
    this.busy = true;
    try {
      if (this.mode === 'legacy') {
        if (this.o.now() - this.lastFeedAttemptAt >= this.o.retryFeedMs) {
          await this.connect();
          return;
        }
        await this.reloadSafely();
        return;
      }
      await this.drain();
      if (this.mode === 'feed' && this.o.now() - this.lastReloadAt >= this.o.safetyReloadMs) await this.reloadSafely();
    } finally {
      this.busy = false;
    }
  }

  /** Cursor first, then the full load: whatever changes while the list loads is reported by the feed afterwards. */
  private async connect(): Promise<void> {
    this.lastFeedAttemptAt = this.o.now();
    try {
      const start = await this.o.fetchPage(undefined);
      this.cursor = start.cursor;
      this.errors = 0;
      this.setMode('feed');
    } catch {
      this.cursor = undefined;
      this.setMode('legacy');
    }
    await this.reloadSafely();
  }

  private async drain(): Promise<void> {
    try {
      for (let i = 0; i < MAX_PAGES_PER_TICK; i++) {
        const page = await this.o.fetchPage(this.cursor);
        this.errors = 0;
        this.cursor = page.cursor;
        if (page.reset) {
          await this.reloadSafely();
          return;
        }
        if (page.changes.length > 0) {
          this.o.onChanges?.(page.changes);
          await this.reloadSafely();
        }
        if (!page.hasMore) return;
      }
    } catch {
      this.errors++;
      if (this.errors >= this.o.maxErrorsBeforeLegacy) {
        this.setMode('legacy');
        this.cursor = undefined;
        await this.reloadSafely();
      }
    }
  }

  private async reloadSafely(): Promise<void> {
    try {
      await this.o.reload();
    } catch {
      /* the screen keeps its last data and reports its own error */
    }
    this.lastReloadAt = this.o.now();
  }

  /** Announces the mode the first time it is known and whenever it changes. */
  private setMode(mode: 'feed' | 'legacy') {
    const changed = this.mode !== mode;
    this.mode = mode;
    if (changed || !this.announced) {
      this.announced = true;
      this.o.onMode?.(mode);
    }
  }

  private schedule(): void {
    if (!this.running) return;
    const wait = this.mode === 'feed' ? this.o.pollMs : this.o.legacyPollMs;
    this.timer = this.o.setTimer(() => {
      void this.tick().finally(() => this.schedule());
    }, wait);
  }
}
