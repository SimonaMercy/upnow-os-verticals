/**
 * The RP / manager contract ledger must show the register-booked deposit's issued
 * receipt number too (it was only tagged for deposits booked as a payments row).
 * Contract 214's deposit lives in security_deposits (id 31 → RCP-2-2025-00024).
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/7697c093-c986-4a44-bce4-ef68a95dd4b5/scratchpad/receipt-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('RP ledger tags the register-booked deposit with its receipt number', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });

  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard/contracts/214/v2');
  const tag = page.getByText('Receipt RCP-2-2025-00024');
  await tag.first().waitFor({ state: 'attached', timeout: 60_000 });
  await tag.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/rp-ledger-deposit.png` });
  await expect(tag.first()).toBeVisible();
});
