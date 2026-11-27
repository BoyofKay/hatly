/** Matching a photo's file name to a branch item (bulk item photos, 2026-11-27). Pure functions — unit-tested. */
export interface MatchProduct { id: string; name: string; nameAr: string | null }

/** Lower-case, digits/separators/extension removed — "Chicken_Shawarma-2.jpg" → "chicken shawarma". Arabic letters kept. */
export function normalizeName(s: string): string {
  return s
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_\-.()[\]]+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The best product for a file name: exact normalized match first, then the longest product name the file name contains (or vice versa). */
export function guessProduct(fileName: string, products: MatchProduct[]): string {
  const f = normalizeName(fileName);
  if (!f) return '';
  let best: { id: string; score: number } = { id: '', score: 0 };
  for (const p of products) {
    for (const n of [p.name, p.nameAr ?? ''].map(normalizeName).filter(Boolean)) {
      const score = n === f ? 1000 : f.includes(n) || n.includes(f) ? Math.min(n.length, f.length) : 0;
      if (score > best.score) best = { id: p.id, score };
    }
  }
  return best.score >= 3 ? best.id : '';
}

