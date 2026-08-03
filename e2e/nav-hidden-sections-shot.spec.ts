import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// AMC & Vendors, Communications and Analytics are parked — they must not appear
// in the sidebar for the RP (or the manager, which mirrors it). The pages
// themselves stay reachable by URL.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/fe2215ba-1d5e-4a25-9712-2345b5b9b210/scratchpad/shots';
const HIDDEN = ['AMC & Vendors', 'Communications', 'Analytics'];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('RP sidebar drops the parked sections', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1000 });
  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard');

  const rail = page.locator('aside');
  await expect(rail.getByRole('link', { name: 'Reports', exact: true })).toBeVisible({ timeout: 30_000 });
  for (const label of HIDDEN) {
    await expect(rail.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  // The neighbours that stay.
  for (const label of ['Templates', 'Reports', 'Restoration List', 'Settings']) {
    await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible();
  }
  await page.screenshot({ path: `${SHOTS}/nav-rp-hidden.png`, fullPage: false });

  // Still reachable directly — hidden from the menu, not removed.
  for (const path of ['amc', 'communications', 'analytics']) {
    const r = await page.request.get(`/rental-provider/dashboard/${path}`);
    console.log('DIRECT', path, r.status());
    expect(r.status()).toBeLessThan(400);
  }
});

test('manager sidebar mirrors it', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1000 });
  await signIn(page, 'sheco1300@yahoo.com');       // Sherif Mohamed Atef, manager for RP 2
  await page.goto('/dashboard/manager');

  const rail = page.locator('aside');
  await expect(rail.getByRole('link', { name: 'Overview', exact: true })).toBeVisible({ timeout: 30_000 });
  for (const label of ['AMC & Vendors', 'Analytics']) {
    await expect(rail.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  }
  console.log('MGR-RAIL', (await rail.getByRole('link').allInnerTexts()).map(t => t.trim().split('\n')[0]).join(' · '));
  await page.screenshot({ path: `${SHOTS}/nav-manager-hidden.png`, fullPage: false });
});
