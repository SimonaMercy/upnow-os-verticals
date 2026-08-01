import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// SCRUM-694 — the per-category fee schedule from `fee_rules` on the landlord's
// admin page. RP 2 (user 286) carries 20 rules across 4 space categories and has
// commission switched OFF, which exercises the inactive-rule rendering.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/95f933ee-6ff0-4c77-b08a-51c7146febc2/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('landlord fee schedule renders per space category', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1600 });
  await signIn(page, 'admin@upnow.ae');

  // RP 2 — 4 categories, 20 rules, commission inactive.
  await page.goto('/dashboard/admin/users/286', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // Screenshot the panel itself — it sits well below the fold, so a viewport
  // shot clips it.
  const panel = page.getByText('Charging rules', { exact: true }).first();
  await expect(panel).toBeVisible();
  const card = panel.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await card.screenshot({ path: `${SHOTS}/01-fee-schedule-rp2.png` });

  // The fee rows must actually be present, not just the panel.
  await expect(page.getByText('Contract registration').first()).toBeVisible();
  await expect(page.getByText('Commission').first()).toBeVisible();

  // RP 1 — a single residential category, everything active.
  await page.goto('/dashboard/admin/users/285', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const p2 = page.getByText('Charging rules', { exact: true }).first();
  const card2 = p2.locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await card2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await card2.screenshot({ path: `${SHOTS}/02-fee-schedule-rp1.png` });
});
