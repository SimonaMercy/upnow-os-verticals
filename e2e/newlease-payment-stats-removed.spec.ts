/**
 * The new-lease payment step no longer carries the stats trio above the Payment
 * Summary (Annual rent · Total contract value · Before move-in); the card itself
 * still carries the same figures.
 *
 * Runs against v-5, which is still at payment_plan_shared. v-8 was the original
 * subject but has since advanced to awaiting_rp_confirm, where the payment card
 * is not rendered at all.
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

test('new-lease payment step drops the stats trio', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1280, height: 1400 });
  await signIn(page, 'ahmed_f_tantawy11@hotmail.com');
  await page.goto('/dashboard/customer/spaces/v2/v-5');
  await page.waitForLoadState('networkidle');

  // The Payment Summary must be on screen, or the absence checks pass vacuously.
  await expect(page.getByText('Payment Summary').first()).toBeVisible({ timeout: 30_000 });

  await expect(page.getByText('Annual rent', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Total contract value', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Before move-in', { exact: true })).toHaveCount(0);

  // The plan itself is untouched — grand total still reconciles.
  await expect(page.getByText(/GRAND TOTAL/i)).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/space-v5-payment.png`, fullPage: true });
});
