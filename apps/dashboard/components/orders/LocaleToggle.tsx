'use client';

/**
 * Formerly a second English/Arabic switch inside individual Admin pages. The Admin shell now owns the only language control (top bar) and
 * every page follows it, so this renders nothing; it stays so existing imports keep compiling.
 */
export function LocaleToggle() {
  return null;
}
