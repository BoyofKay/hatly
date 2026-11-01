// Focused tests for the public legal-page settings. Run: node --experimental-strip-types --test lib/legal/public-site.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVED_PRIVACY_CONTACT_EMAIL,
  APPROVED_PRIVACY_EFFECTIVE_DATE,
  resolvePublicLegalSettings,
  validDate,
  validEmail,
} from './public-site.ts';

test('the owner-approved values are the defaults: contact and date shown, no draft banner', () => {
  assert.equal(APPROVED_PRIVACY_CONTACT_EMAIL, 'Amrrizk1111@gmail.com');
  assert.equal(APPROVED_PRIVACY_EFFECTIVE_DATE, '2026-10-23');
  assert.deepEqual(resolvePublicLegalSettings({}), { contactEmail: 'Amrrizk1111@gmail.com', effectiveDate: '2026-10-23', isDraft: false });
});

test('empty or whitespace overrides mean "not set": the approved values are used', () => {
  assert.equal(resolvePublicLegalSettings({ NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: '  ', NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE: '' }).isDraft, false);
});

test('a valid override wins (a later policy revision) and the page is still published', () => {
  const s = resolvePublicLegalSettings({ NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: 'other@example.test', NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE: '2027-01-15' });
  assert.deepEqual(s, { contactEmail: 'other@example.test', effectiveDate: '2027-01-15', isDraft: false });
});

test('an INVALID override never falls back to the approved value: the page becomes a draft', () => {
  const badMail = resolvePublicLegalSettings({ NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL: 'not-an-email' });
  assert.equal(badMail.contactEmail, null);
  assert.equal(badMail.isDraft, true);
  const badDate = resolvePublicLegalSettings({ NEXT_PUBLIC_PRIVACY_EFFECTIVE_DATE: '2026-02-30' });
  assert.equal(badDate.effectiveDate, null);
  assert.equal(badDate.isDraft, true);
});

test('missing values (no approved value and no override) are a draft — either one is enough', () => {
  const none = { contactEmail: null, effectiveDate: null };
  assert.deepEqual(resolvePublicLegalSettings({}, none), { contactEmail: null, effectiveDate: null, isDraft: true });
  assert.equal(resolvePublicLegalSettings({}, { contactEmail: 'a@b.co', effectiveDate: null }).isDraft, true);
  assert.equal(resolvePublicLegalSettings({}, { contactEmail: null, effectiveDate: '2026-10-23' }).isDraft, true);
});

test('validation: e-mail shape and real calendar dates', () => {
  for (const ok of ['Amrrizk1111@gmail.com', 'a.b+c@sub.example.co']) assert.equal(validEmail(ok), ok);
  for (const bad of ['', 'x', 'a@b', '@gmail.com', 'a@@b.com', 'a b@c.com', 'a@b.c']) assert.equal(validEmail(bad), null, bad);
  for (const ok of ['2026-10-23', '2028-02-29']) assert.equal(validDate(ok), ok);
  for (const bad of ['2026-13-01', '2026-02-29', '2026-10-32', '23-10-2026', '2026/10/23', '2026-10-23T00:00']) assert.equal(validDate(bad), null, bad);
});
