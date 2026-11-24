// Focused tests for the Home-banner form helpers. Run: node --experimental-strip-types --test lib/banners/banner-form.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_BANNER_FORM,
  buildCreateBody,
  buildUpdateBody,
  checkBannerShape,
  checkImageFile,
  isoToLocalInput,
  localInputToIso,
  type BannerFormState,
} from './banner-form.ts';

const form = (over: Partial<BannerFormState> = {}): BannerFormState => ({ ...EMPTY_BANNER_FORM, title: 'Eid sale', ...over });
const UUID = '11111111-1111-4111-8111-111111111111';

test('a minimal banner needs only a title; empty optional values are left out of a create', () => {
  const r = buildCreateBody(form());
  assert.deepEqual(r, { ok: true, body: { title: 'Eid sale', sortOrder: 0, actionType: 'NONE' } });
});

test('a blank title is refused with a reason', () => {
  const r = buildCreateBody(form({ title: '   ' }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /title is required/i);
});

test('an action other than None needs its destination; each kind reads its own field', () => {
  for (const [actionType, field, word] of [['PRODUCT', 'productId', 'product'], ['VENDOR', 'branchId', 'vendor branch'], ['SECTOR', 'sectorId', 'sector']] as const) {
    const missing = buildCreateBody(form({ actionType }));
    assert.equal(missing.ok, false);
    assert.match((missing as { error: string }).error, new RegExp(word));
    const ok = buildCreateBody(form({ actionType, [field]: UUID } as Partial<BannerFormState>));
    assert.deepEqual(ok, { ok: true, body: { title: 'Eid sale', sortOrder: 0, actionType, actionTargetId: UUID } });
  }
});

test('a destination left over from another action is never sent', () => {
  const r = buildCreateBody(form({ actionType: 'NONE', productId: UUID, sectorId: UUID }));
  assert.deepEqual(r, { ok: true, body: { title: 'Eid sale', sortOrder: 0, actionType: 'NONE' } });
});

test('display order must be a whole number from 0 to 10000', () => {
  for (const bad of ['-1', '1.5', 'abc', '10001']) assert.equal(buildCreateBody(form({ sortOrder: bad })).ok, false, bad);
  assert.equal(buildCreateBody(form({ sortOrder: '' })).ok, true);
  assert.equal(buildCreateBody(form({ sortOrder: '10000' })).ok, true);
});

test('the schedule must run forward; equal or reversed times are refused before any request', () => {
  assert.equal(buildCreateBody(form({ startsAt: '2026-11-02T10:00', endsAt: '2026-11-02T10:00' })).ok, false);
  assert.equal(buildCreateBody(form({ startsAt: '2026-11-03T10:00', endsAt: '2026-11-02T10:00' })).ok, false);
  const ok = buildCreateBody(form({ startsAt: '2026-11-02T10:00', endsAt: '2026-11-03T10:00' }));
  assert.equal(ok.ok, true);
  assert.ok(ok.ok && ok.body.startsAt && ok.body.endsAt && ok.body.startsAt < ok.body.endsAt);
});

test('local datetime ⇄ ISO round-trips the same wall-clock minute in any time zone', () => {
  const local = '2026-10-28T14:30';
  const iso = localInputToIso(local);
  assert.ok(iso && /Z$/.test(iso));
  assert.equal(isoToLocalInput(iso), local);
  assert.equal(localInputToIso(''), null);
  assert.equal(isoToLocalInput(null), '');
  assert.equal(localInputToIso('not a date'), null);
});

test('an edit sends null for an emptied optional value so it is really cleared', () => {
  const r = buildUpdateBody(form({ titleAr: '', startsAt: '', endsAt: '', actionType: 'NONE' }));
  assert.deepEqual(r, { ok: true, body: { title: 'Eid sale', titleAr: null, actionType: 'NONE', actionTargetId: null, sectorId: null, sortOrder: 0, startsAt: null, endsAt: null } });
});

test('a promotion has a visual sector independently of the destination', () => {
  const r = buildCreateBody(form({ linkedSectorId: UUID, actionType: 'NONE' }));
  assert.deepEqual(r, { ok: true, body: { title: 'Eid sale', sortOrder: 0, actionType: 'NONE', sectorId: UUID } });
});

test('image files: only JPEG/PNG/WebP, not empty, not over 5 MB', () => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const max = 5 * 1024 * 1024;
  assert.equal(checkImageFile({ type: 'image/png', size: 1000 }, allowed, max), null);
  assert.match(checkImageFile({ type: 'image/gif', size: 1000 }, allowed, max) ?? '', /JPEG, PNG or WebP/);
  assert.match(checkImageFile({ type: 'application/pdf', size: 1000 }, allowed, max) ?? '', /JPEG, PNG or WebP/);
  assert.match(checkImageFile({ type: 'image/jpeg', size: max + 1 }, allowed, max) ?? '', /5 MB/);
  assert.match(checkImageFile({ type: 'image/jpeg', size: 0 }, allowed, max) ?? '', /empty/);
  assert.equal(checkImageFile({ type: 'image/jpeg', size: max }, allowed, max), null);
});

test('banner shape: square including the reported 1254×1254 and legacy landscape artwork pass', () => {
  for (const [w, h] of [[1080, 1080], [1254, 1254], [1000, 1000], [1200, 600], [800, 400], [512, 512]]) assert.equal(checkBannerShape(w, h), null, `${w}x${h}`);
});

test('banner shape: tiny images fail the quality floor; aspect recommendations are advisory', () => {
  assert.match(checkBannerShape(400, 200)!, /400×200.*at least 320×320/);
  assert.equal(checkBannerShape(800, 1200), null);
  assert.equal(checkBannerShape(3000, 800), null);
});

test('banner shape: an unreadable size is refused', () => {
  assert.match(checkBannerShape(0, 0)!, /could not be read/);
  assert.match(checkBannerShape(Number.NaN, 600)!, /could not be read/);
});
