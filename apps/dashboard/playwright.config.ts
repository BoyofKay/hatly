import { defineConfig, devices } from '@playwright/test';
import { DASHBOARD_BASE_URL, DASHBOARD_PORT } from './e2e/env';

/**
 * Sales Release Candidate hardening milestone — the minimum useful Playwright foundation for the
 * Vendor Dashboard's real-browser critical path. See e2e/README.md for setup/running instructions.
 *
 * Deliberately NOT a generic enterprise test framework: one browser project (Chromium — the only
 * one Sales will actually demo on), one worker (the fixtures below are shared, stateful backend
 * data — parallel workers would race each other's mutations), real traces/screenshots only on
 * failure (never bloats a green run), and no arbitrary sleeps anywhere in the specs themselves.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: DASHBOARD_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Starts the REAL Next.js dev server against the REAL backend (PLAYWRIGHT_API_BASE_URL, default
  // http://localhost:3000/api/v1) — never a mocked backend. The backend itself is NOT started
  // here: it's a separate long-running process (`npm run start:dev` in apps/backend), exactly as a
  // developer already runs it, per e2e/README.md.
  webServer: {
    command: `npx next dev -p ${DASHBOARD_PORT}`,
    url: DASHBOARD_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
