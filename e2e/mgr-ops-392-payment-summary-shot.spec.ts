/**
 * Manager Operations contract 392 — capture how the payment summary is
 * rendered on the RP/manager side, so the customer renewal card can mirror it.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/a78187e4-8a7c-414e-b19d-32998b9132c0/scratchpad/renewal-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('manager operations 392 payment summary', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });
  await signIn(page, "sheco1300@yahoo.com");
  await page.goto('/dashboard/manager/operations/392?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/mgr-ops-392-full.png`, fullPage: true });

  const summary = page.getByText(/Payment summary/i).first();
  if (await summary.isVisible().catch(() => false)) {
    await summary.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/mgr-ops-392-summary.png`, fullPage: false });
  } else {
    console.log('no "Payment summary" heading found');
  }
});
