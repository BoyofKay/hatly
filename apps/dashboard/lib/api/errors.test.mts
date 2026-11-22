import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorMessage } from './errors.ts';

const err = (code: string, message: string, details: Record<string, unknown> = {}) => ({ response: { status: 409, data: { error: { code: 'CONFLICT', message, details: { code, ...details } } } } });
const setLang = (lang: string) => { (globalThis as any).document = { documentElement: { lang } }; };

test('Arabic UI: a known code shows Arabic, with the numbers from the details', () => {
  setLang('ar');
  const m = apiErrorMessage(err('DRIVER_UNAVAILABLE', 'This driver already has 5 active order(s) — their limit is 5.', { reason: 'AT_CAPACITY', active: 5, capacity: 5 }), 'x');
  assert.match(m, /هذا المندوب لديه 5 طلبات نشطة — الحد الأقصى 5/);
});

test('Arabic UI: an untranslated code keeps the server reason after an Arabic lead', () => {
  setLang('ar');
  assert.equal(apiErrorMessage(err('SOMETHING_NEW', 'Something new happened.'), 'x'), 'تعذّر تنفيذ العملية: Something new happened.');
});

test('English UI: the server message is shown unchanged', () => {
  setLang('en');
  assert.equal(apiErrorMessage(err('DRIVER_UNAVAILABLE', 'This driver is offline.', { reason: 'OFFLINE' }), 'x'), 'This driver is offline.');
});
