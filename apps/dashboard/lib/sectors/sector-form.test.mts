// Focused tests for the new-sector form helpers. Run: node --experimental-strip-types --test lib/sectors/sector-form.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_SECTOR_FORM, SECTOR_SLUG_PATTERN, buildCreateSectorBody, suggestSlug, type SectorFormState } from './sector-form.ts';

const form = (over: Partial<SectorFormState> = {}): SectorFormState => ({ ...EMPTY_SECTOR_FORM, name: 'Restaurants', slug: 'restaurants', ...over });

test('a new sector starts INACTIVE: customers do not see an empty category until the admin turns it on', () => {
  assert.equal(EMPTY_SECTOR_FORM.active, false);
  assert.deepEqual(buildCreateSectorBody(form()), { ok: true, body: { name: 'Restaurants', slug: 'restaurants', sortOrder: 0, isActive: false } });
});

test('the Arabic name is optional and trimmed; active is sent when chosen', () => {
  const r = buildCreateSectorBody(form({ nameAr: '  مطاعم ', active: true, sortOrder: '3' }));
  assert.deepEqual(r, { ok: true, body: { name: 'Restaurants', nameAr: 'مطاعم', slug: 'restaurants', sortOrder: 3, isActive: true } });
});

test('name and slug are required, with reasons', () => {
  for (const bad of [form({ name: '  ' }), form({ slug: '' })]) assert.equal(buildCreateSectorBody(bad).ok, false);
});

test('the slug follows the backend rule exactly', () => {
  for (const ok of ['restaurants', 'fast-food', 'fast_food', 'a1', 'a-b-c']) assert.ok(SECTOR_SLUG_PATTERN.test(ok), ok);
  for (const bad of ['Restaurants', 'fast food', '-a', 'a-', 'a--b', 'مطاعم', 'a.b', '']) assert.ok(!SECTOR_SLUG_PATTERN.test(bad), bad);
  assert.equal(buildCreateSectorBody(form({ slug: 'Fast Food' })).ok, false);
});

test('display order must be a whole number ≥ 0', () => {
  for (const bad of ['-1', '1.5', 'x']) assert.equal(buildCreateSectorBody(form({ sortOrder: bad })).ok, false, bad);
  assert.equal(buildCreateSectorBody(form({ sortOrder: '' })).ok, true);
});

test('a slug suggestion is derived from an English name only; an Arabic name gives none (the admin types it)', () => {
  assert.equal(suggestSlug('Fast Food!'), 'fast-food');
  assert.equal(suggestSlug('  Pharmacies & Health '), 'pharmacies-health');
  assert.equal(suggestSlug('مطاعم'), '');
  assert.ok(SECTOR_SLUG_PATTERN.test(suggestSlug('Fast Food!')));
});
