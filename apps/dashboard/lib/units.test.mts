import test from 'node:test';
import assert from 'node:assert/strict';
import { basisPointsToPercent, gramsToKg, minorToEgpInput, parseEgpToMinor, parseKgToGrams, parsePercentToBasisPoints } from './money.ts';

test('money is typed in EGP with up to 2 decimals and stored as piastres without float errors', () => {
  assert.deepEqual(parseEgpToMinor('10'), { ok: true, minor: 1000 });
  assert.deepEqual(parseEgpToMinor('10.5'), { ok: true, minor: 1050 });
  assert.deepEqual(parseEgpToMinor('150.10'), { ok: true, minor: 15010 });
  assert.deepEqual(parseEgpToMinor('١٠٫٥'), { ok: true, minor: 1050 });
  assert.equal(parseEgpToMinor('10.555').ok, false);
  assert.equal(minorToEgpInput(1050), '10.50');
  assert.equal(minorToEgpInput(1000), '10.00');
});

test('commission is typed as a percentage', () => {
  assert.equal(parsePercentToBasisPoints('15'), 1500);
  assert.equal(parsePercentToBasisPoints('12.5'), 1250);
  assert.equal(parsePercentToBasisPoints('7.25'), 725);
  assert.equal(parsePercentToBasisPoints('101'), null);
  assert.equal(parsePercentToBasisPoints('-1'), null);
  assert.equal(basisPointsToPercent(1250), '12.5');
  assert.equal(basisPointsToPercent(1500), '15');
});

test('weights are typed in kg and stored as grams', () => {
  assert.equal(parseKgToGrams('1.5'), 1500);
  assert.equal(parseKgToGrams('0.25'), 250);
  assert.equal(parseKgToGrams('2'), 2000);
  assert.equal(parseKgToGrams('1.2345'), null);
  assert.equal(gramsToKg(1500), '1.5');
  assert.equal(gramsToKg(250), '0.25');
});
