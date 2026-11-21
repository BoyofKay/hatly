import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng } from './lat-lng.ts';

test('reads plain "lat, lng" and the common Google Maps link shapes', () => {
  assert.deepEqual(parseLatLng('30.4170, 31.5620'), { lat: 30.417, lng: 31.562 });
  assert.deepEqual(parseLatLng('https://www.google.com/maps/place/X/@30.4171,31.5622,17z/data=!3d30.41715!4d31.56231'), { lat: 30.41715, lng: 31.56231 });
  assert.deepEqual(parseLatLng('https://www.google.com/maps/@30.4171,31.5622,17z'), { lat: 30.4171, lng: 31.5622 });
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=30.417,31.562'), { lat: 30.417, lng: 31.562 });
  assert.deepEqual(parseLatLng('https://maps.google.com/?q=30.417%2C31.562'), { lat: 30.417, lng: 31.562 });
});

test('refuses text without coordinates, short links and impossible values', () => {
  assert.equal(parseLatLng('Belbeis, Sharqia'), null);
  assert.equal(parseLatLng('https://maps.app.goo.gl/abc123'), null);
  assert.equal(parseLatLng('200, 31'), null);
  assert.equal(parseLatLng(''), null);
});
