import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessProduct, normalizeName } from './photo-match.ts';

const products = [
  { id: 'a', name: 'Chicken Shawarma', nameAr: 'شاورما فراخ' },
  { id: 'b', name: 'Chicken Shawarma Meal', nameAr: 'وجبة شاورما فراخ' },
  { id: 'c', name: 'Pepsi', nameAr: 'بيبسي' },
];

test('normalizes separators, digits, extensions and Arabic letter forms', () => {
  assert.equal(normalizeName('Chicken_Shawarma-2.JPG'), 'chicken shawarma');
  assert.equal(normalizeName('وجبة_شاورما.jpeg'), 'وجبه شاورما');
});

test('exact name wins; the longest contained name otherwise; nothing for unrelated files', () => {
  assert.equal(guessProduct('chicken-shawarma.jpg', products), 'a');
  assert.equal(guessProduct('Chicken Shawarma Meal 1.png', products), 'b');
  assert.equal(guessProduct('شاورما فراخ.jpg', products), 'a');
  assert.equal(guessProduct('pepsi can 330.jpg', products), 'c');
  assert.equal(guessProduct('IMG_2031.jpg', products), '');
});
