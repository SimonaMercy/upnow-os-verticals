import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
// Pointed elsewhere, the servers are already up: starting our own would collide.
const OWN_SERVERS = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // run sequentially so cookie state is predictable
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    // Overridable so a suite can be pointed at a second copy of the app — a
    // worktree on its own ports, verifying against a restored database — without
    // editing this file. Unset, it is the ordinary dev environment.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // webServer: reuse existing servers in local dev; start fresh in CI.
  // Playwright polls the url until it gets a 2xx/3xx before running tests.
  webServer: OWN_SERVERS ? [
    {
      // NestJS backend — Swagger UI at /docs returns 200
      command: 'npm --prefix ../upnow-backend run start:dev',
      url: 'http://localhost:3001/docs',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Next.js frontend
      command: 'npm run dev',
      url: BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ] : undefined,
});
