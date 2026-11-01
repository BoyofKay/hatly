import { BadRequestException } from '@nestjs/common';

/** Opaque keyset cursor: base64url of `<ISO timestamp>|<uuid>`. Keyset pagination is stable under concurrent inserts (no duplicates / skips). */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!at || !id || Number.isNaN(Date.parse(at))) throw new Error('bad');
    return { at, id };
  } catch {
    throw new BadRequestException({ message: 'Invalid cursor.', details: { code: 'INVALID_CURSOR' } });
  }
}

export function clampLimit(limit: string | number | undefined, def = 50, max = 200): number {
  return Math.min(max, Math.max(1, Math.floor(Number(limit) || def)));
}
