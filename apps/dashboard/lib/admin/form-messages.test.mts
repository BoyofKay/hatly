import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeAdminFormMessage } from './form-messages.ts';
const en = (a: string, _b: string) => a;
const ar = (_a: string, b: string) => b;
test('known validation messages keep English and provide Arabic', () => {
  assert.equal(localizeAdminFormMessage('A name is required.', en), 'A name is required.');
  assert.equal(localizeAdminFormMessage('A name is required.', ar), 'الاسم مطلوب.');
  assert.match(localizeAdminFormMessage('The image is 100×200. A banner must be at least 320×320 pixels (recommended 1080×1080).', ar), /100×200.*320×320/);
  assert.equal(localizeAdminFormMessage('Unknown diagnostic', ar), 'Unknown diagnostic');
});
