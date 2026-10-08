import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_MEDIA_DIR, findMediaFile, isSeededMediaUrl, isValidMediaKey, localUploadExists, mediaKeys, slugify, stageMediaFile } from './seed-media';

describe('seed-media', () => {
  let tmp: string;
  let mediaDir: string;
  let uploadsDir: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hatly-seed-media-'));
    mediaDir = path.join(tmp, 'media');
    uploadsDir = path.join(tmp, 'uploads');
    await fs.mkdir(mediaDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('slugifies names deterministically', () => {
    expect(slugify('Cafes & Desserts')).toBe('cafes-and-desserts');
    expect(slugify("  Abu Ali's Grill! ")).toBe('abu-ali-s-grill');
    expect(slugify('Medicines & OTC')).toBe('medicines-and-otc');
  });

  it('builds natural-key based keys (never UUIDs)', () => {
    expect(mediaKeys.sector('pharmacy')).toBe('sectors/pharmacy');
    expect(mediaKeys.subcategory('groceries', 'Dairy & Eggs')).toBe('subcategories/groceries/dairy-and-eggs');
    expect(mediaKeys.vendorLogo('Abu Ali Grill')).toBe('vendors/abu-ali-grill/logo');
    expect(mediaKeys.product('Abu Ali Grill', 'Mixed Grill')).toBe('products/abu-ali-grill/mixed-grill');
  });

  it('rejects keys that contain an empty slug segment (Arabic-only names)', () => {
    expect(isValidMediaKey('products/abu-ali-grill/mixed-grill')).toBe(true);
    expect(isValidMediaKey('vendors/abu-ali-grill/logo')).toBe(true);
    expect(isValidMediaKey(mediaKeys.product('Abu Ali Grill', 'مشويات'))).toBe(false);
    expect(isValidMediaKey('products//x')).toBe(false);
  });

  it('finds nothing when no file was delivered', async () => {
    expect(await findMediaFile(mediaDir, 'sectors/pharmacy')).toBeNull();
    expect(await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/pharmacy' })).toBeNull();
  });

  it('ignores empty files and unsupported extensions', async () => {
    await fs.mkdir(path.join(mediaDir, 'sectors'), { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'sectors/pharmacy.webp'), '');
    await fs.writeFile(path.join(mediaDir, 'sectors/bakery.gif'), 'gif-bytes');
    expect(await findMediaFile(mediaDir, 'sectors/pharmacy')).toBeNull();
    expect(await findMediaFile(mediaDir, 'sectors/bakery')).toBeNull();
  });

  it('copies a delivered file into uploads/marketplace and returns the server-relative URL', async () => {
    await fs.mkdir(path.join(mediaDir, 'sectors'), { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'sectors/pharmacy.png'), 'png-bytes');
    const url = await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/pharmacy' });
    expect(url).toBe('/uploads/files/marketplace/sectors/pharmacy.png');
    const copied = await fs.readFile(path.join(uploadsDir, 'marketplace/sectors/pharmacy.png'), 'utf8');
    expect(copied).toBe('png-bytes');
  });

  it('prefers webp over other formats and is idempotent on re-run', async () => {
    await fs.mkdir(path.join(mediaDir, 'sectors'), { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'sectors/produce.webp'), 'webp');
    await fs.writeFile(path.join(mediaDir, 'sectors/produce.jpg'), 'jpg');
    const first = await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/produce' });
    const second = await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/produce' });
    expect(first).toBe('/uploads/files/marketplace/sectors/produce.webp');
    expect(second).toBe(first);
  });

  it('the default pack is the committed docs/assets/pack, and it holds the delivered marketplace assets', async () => {
    expect(DEFAULT_MEDIA_DIR.endsWith(path.join('docs', 'assets', 'pack'))).toBe(true);
    for (const key of ['sectors/restaurants', 'products/flatini-pizza/margherita-pizza', 'catalog-products/sunflower-oil-1l']) {
      expect(await findMediaFile(DEFAULT_MEDIA_DIR, key)).not.toBeNull();
    }
  });

  it('recognises only URLs the seed itself stored (never a real upload or an external URL)', () => {
    expect(isSeededMediaUrl('/uploads/files/marketplace/sectors/bakery.webp')).toBe(true);
    expect(isSeededMediaUrl('/uploads/files/4f1c2b.webp')).toBe(false); // a real admin upload
    expect(isSeededMediaUrl('https://cdn.example.com/x.webp')).toBe(false);
    expect(isSeededMediaUrl(null)).toBe(false);
  });

  it('checks a stored server-relative URL against the uploads directory (missing file = broken reference)', async () => {
    await fs.writeFile(path.join(mediaDir, 'x.webp'), Buffer.from('RIFF....WEBP'));
    await fs.mkdir(path.join(mediaDir, 'sectors'), { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'sectors', 'bakery.webp'), Buffer.from('RIFF....WEBP'));
    const url = await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/bakery' });
    expect(await localUploadExists(uploadsDir, url!)).toBe(true);
    await fs.rm(uploadsDir, { recursive: true, force: true }); // an uploads reset
    expect(await localUploadExists(uploadsDir, url!)).toBe(false);
    // re-staging the same key restores the very same URL (what the seed does on every run)
    expect(await stageMediaFile({ mediaDir, uploadsDir, key: 'sectors/bakery' })).toBe(url);
    expect(await localUploadExists(uploadsDir, url!)).toBe(true);
    expect(await localUploadExists(uploadsDir, 'https://cdn.example.com/x.webp')).toBeNull();
    expect(await localUploadExists(uploadsDir, '/uploads/files/../../etc/passwd')).toBe(false);
  });
});
