import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// SP-248 — visual check: the provider's My Services checklist, and the admin
// approval drawer's per-service "Tools" chip + verify panel.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b4b37c3d-de90-4219-afd9-f8632a63e10d/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('SP-248 surfaces', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1100 });

  // Provider: My Services → open the first Tools chip.
  await signIn(page, 'spptest@test.com');
  await page.goto('/dashboard/service-provider/services', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const chip = page.getByRole('button', { name: /^Tools \d+\/\d+/ }).first();
  await expect(chip).toBeVisible();
  await chip.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/03-sp-my-services-checklist.png`, fullPage: false });

  // Admin: approval drawer for provider 20 → Tools chip → panel.
  await page.context().clearCookies();
  await signIn(page, 'admin@upnow.ae');
  await page.goto('/dashboard/admin/listings/service-providers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // Status defaults to Pending — spptest's listings are approved; switch tab, then click its card.
  const approvedTab = page.getByRole('button', { name: /^Approved/ }).first();
  if (await approvedTab.count()) { await approvedTab.click(); await page.waitForTimeout(2000); }
  const card = page.getByRole('button').filter({ hasText: /10 approved/ }).first();
  if (await card.count()) { await card.click(); await page.waitForTimeout(3000); }
  const achip = page.getByRole('button', { name: /^Tools \d+\/\d+ declared/ }).first();
  if (await achip.count()) { await achip.scrollIntoViewIfNeeded(); await achip.click(); await page.waitForTimeout(800); }
  await page.screenshot({ path: `${SHOTS}/04-admin-drawer-capabilities.png`, fullPage: false });
});
