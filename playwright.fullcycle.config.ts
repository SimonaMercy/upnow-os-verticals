import { defineConfig, devices } from '@playwright/test';

/**
 * Full-cycle UI E2E suite — runs against the ISOLATED test stack:
 *   frontend :3010 → backend :3002 → Postgres db upnow_e2e (local-disk uploads)
 *
 * Start the stack before running (servers are NOT booted here):
 *   backend:  PORT=3002 DB_NAME=upnow_e2e AWS_S3_BUCKET= OCR_MOCK=true \
 *             FRONTEND_URL="http://localhost:3010,http://127.0.0.1:3010" node dist/main
 *   frontend: NEXT_DIST_DIR=.next-e2e BACKEND_URL=http://localhost:3002/api \
 *             NEXT_PUBLIC_API_URL=/api NEXT_PUBLIC_BACKEND_URL=http://localhost:3002 \
 *             npx next dev -p 3010
 *
 * Run:  npx playwright test --config=playwright.fullcycle.config.ts
 * Specs are numbered and order-dependent (registration → approval → portfolio → …);
 * cross-spec state lives in e2e/full-cycle/.state.json — delete it to start a fresh cycle.
 */
export default defineConfig({
  testDir: './e2e/full-cycle',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Artifacts live OUTSIDE the repo tree: Tailwind v4's source scanner walks
  // non-gitignored files and chokes on binary traces/videos (BUGS.md BUG-01).
  outputDir: '/tmp/upnow-e2e-artifacts/test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '/tmp/upnow-e2e-artifacts/report' }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
