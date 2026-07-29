import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end lease-journey suite — runs against the LOCAL DEV stack already
 * running on :3000 (frontend) / :3001 (backend, db upnow_prod_clone).
 *
 * Specs are numbered and order-dependent; cross-spec state lives in
 * e2e/journey/.state.json. Delete it to start a fresh journey.
 *
 *   npx playwright test --config=playwright.journey.config.ts
 *
 * Artifacts live outside the repo tree — Tailwind v4's source scanner walks
 * non-gitignored files and chokes on binary traces/videos (see e2e/full-cycle/BUGS.md).
 */
export default defineConfig({
  testDir: './e2e/journey',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: '/tmp/upnow-journey/test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '/tmp/upnow-journey/report' }],
  ],
  use: {
    baseURL: process.env.JOURNEY_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
