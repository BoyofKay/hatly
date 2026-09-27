import { readFileSync } from 'fs';
import { FIXTURE_FILE, Fixtures } from './env';

/** Reads the fixture data global-setup.ts wrote once for this whole test run. */
export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf-8'));
}
