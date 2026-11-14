import test from 'node:test';
import assert from 'node:assert/strict';
import { startPageFor } from './start-page.ts';
import { NAV } from '../../components/shell/nav.ts';

const who = (perms: string[], role = 'ADMIN') => ({ role, can: (...need: string[]) => role === 'SUPER_ADMIN' || need.length === 0 || need.some((n) => perms.includes(n)) });

test('stage 5 start page: operations staff → the board; reports → the overview; settlement desk → Drivers today', () => {
  assert.equal(startPageFor(who(['VIEW_ORDERS', 'MANAGE_ORDER_FULFILMENT']), NAV), 'ops');
  assert.equal(startPageFor(who(['VIEW_ORDERS', 'ASSIGN_REASSIGN_ORDERS']), NAV), 'ops');
  assert.equal(startPageFor(who([], 'SUPER_ADMIN'), NAV), 'ops');
  assert.equal(startPageFor(who(['VIEW_REPORTS', 'VIEW_ORDERS']), NAV), 'overview');
  assert.equal(startPageFor(who(['CLOSE_DRIVER_SETTLEMENTS', 'VIEW_DRIVER_SETTLEMENTS']), NAV), '/drivers-today');
});

test('stage 5 start page: anyone else lands on the first page their menu shows — never a "More" page, never a page open to everyone', () => {
  assert.equal(startPageFor(who(['CATALOG_VIEW']), NAV), '/catalog');
  assert.equal(startPageFor(who(['VIEW_ORDERS']), NAV), '/operations'); // read-only orders staff: the board (read-only for them)
  assert.equal(startPageFor(who(['VIEW_CUSTOMERS']), NAV), '/customers');
  assert.equal(startPageFor(who([]), NAV), 'overview'); // nothing to open: the overview says "choose a section"
});
