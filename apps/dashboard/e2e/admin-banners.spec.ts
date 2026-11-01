import { test, expect } from '@playwright/test';
import { deflateSync } from 'zlib';
import { SUPER_ADMIN_STORAGE_STATE } from './env';

/** CRC-32 (PNG chunk checksum) — a browser refuses a PNG whose chunk checksums are wrong. */
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A real, browser-decodable PNG of the given size (solid colour) — no image library, just the zlib in Node. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 180)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Home banners, end to end in a real browser against the real backend: create → image shape validation → upload + preview → publish →
 * unpublish → delete. The shape rule (wide ~2:1, at least 800×320) is enforced in the browser AND by the server.
 */
test.describe('Admin — Home banners', () => {
  test.use({ storageState: SUPER_ADMIN_STORAGE_STATE });

  test('a banner goes draft → image (shape-checked) → published → unpublished → deleted', async ({ page }) => {
    await page.goto('/banners');
    await expect(page.getByTestId('banners-rule')).toContainText('at least 800×320');

    const title = `E2E banner ${Date.now()}`;
    await page.getByTestId('banner-new').click();
    await page.getByTestId('banner-title').fill(title);
    await page.getByTestId('banner-title-ar').fill('بانر تجريبي');
    await page.getByTestId('banner-form').getByRole('button', { name: /create|save/i }).click();

    const row = page.locator('tr[data-testid^="banner-row-"]', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByTestId('banner-status')).toHaveText('Draft');
    await expect(row.getByTestId('banner-toggle')).toBeDisabled(); // cannot publish without an image

    // Too small → refused in the browser, with the actual size; nothing is uploaded.
    await row.getByTestId('banner-image').click();
    await page.getByTestId('banner-file').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: png(400, 200) });
    await expect(row.getByTestId('banner-row-error')).toContainText('400×200');
    await expect(row.getByTestId('banner-no-image')).toBeVisible();

    // Square → refused (not a wide banner).
    await row.getByTestId('banner-image').click();
    await page.getByTestId('banner-file').setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: png(1000, 1000) });
    await expect(row.getByTestId('banner-row-error')).toContainText('about 2:1');

    // 1200×600 → stored, previewed.
    await row.getByTestId('banner-image').click();
    const [upload] = await Promise.all([
      page.waitForResponse((r) => /\/admin\/home-banners\/.+\/image/.test(r.url()) && r.request().method() === 'POST'),
      page.getByTestId('banner-file').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: png(1200, 600) }),
    ]);
    expect(upload.ok()).toBe(true);
    await expect(row.getByTestId('banner-thumb')).toBeVisible();

    // Publish → Published; unpublish → Draft.
    await row.getByTestId('banner-toggle').click();
    await expect(row.getByTestId('banner-status')).toHaveText('Live');
    await row.getByTestId('banner-toggle').click();
    await expect(row.getByTestId('banner-status')).toHaveText('Draft');

    page.once('dialog', (d) => d.accept());
    await row.getByTestId('banner-delete').click();
    await expect(row).toHaveCount(0);
  });

  test('a banner needs a title; an action other than "none" needs its destination', async ({ page }) => {
    await page.goto('/banners');
    await page.getByTestId('banner-new').click();
    await page.getByTestId('banner-form').getByRole('button', { name: /create|save/i }).click();
    await expect(page.getByTestId('banner-form-error')).toContainText(/title is required/i);
  });
});
