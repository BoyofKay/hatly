/**
 * Owner decision 2026-11-28: recompress the photos already stored (customer request photos, proof-of-delivery photos, legacy images)
 * IN PLACE — same file name and format, so every stored link keeps working. JPEG → quality 80 (mozjpeg), PNG → max compression;
 * at most 1600 px on the long edge; orientation applied; ALL metadata (GPS, camera) removed. A file is rewritten only when the
 * result is at least 10% smaller. WebP files (already produced by the media pipeline) and audio are not touched.
 *
 *   node dist/src/scripts/recompress-uploads.js            → dry run: what would change, nothing written
 *   node dist/src/scripts/recompress-uploads.js --apply    → writes (take a backup first: prod.sh backup)
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import sharp = require('sharp');

const MAX_EDGE = 1600;
const MIN_BYTES = 150 * 1024;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

export async function recompressFile(file: string): Promise<{ before: number; after: number; write?: Buffer } | null> {
  const ext = path.extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png'].includes(ext)) return null;
  const input = await fs.readFile(file);
  if (input.length < MIN_BYTES) return null;
  let pipeline = sharp(input, { limitInputPixels: 60_000_000 }).rotate().resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
  pipeline = ext === '.png' ? pipeline.png({ compressionLevel: 9, effort: 10 }) : pipeline.jpeg({ quality: 80, mozjpeg: true });
  const output = await pipeline.toBuffer();
  if (output.length > input.length * 0.9) return { before: input.length, after: input.length };
  return { before: input.length, after: output.length, write: output };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dir = path.resolve(process.env.UPLOADS_LOCAL_DIR || './uploads-storage');
  let files = 0, changed = 0, failed = 0, before = 0, after = 0;
  for await (const file of walk(dir)) {
    try {
      const r = await recompressFile(file);
      if (!r) continue;
      files++;
      before += r.before;
      after += r.after;
      if (r.write) {
        changed++;
        if (apply) {
          const tmp = `${file}.recompress-tmp`;
          await fs.writeFile(tmp, r.write);
          await fs.rename(tmp, file);
        }
      }
    } catch {
      failed++; // unreadable / not really an image: left untouched
    }
  }
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${files} photo(s) over ${MIN_BYTES / 1024} KB checked, ${changed} smaller after recompression, ${failed} skipped as unreadable.`);
  console.log(`size of the checked photos: ${mb(before)} MB → ${mb(after)} MB (saves ${mb(before - after)} MB)`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('recompress failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
