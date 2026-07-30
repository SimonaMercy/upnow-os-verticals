/**
 * "Add" on the Rental Income rail must offer ONLY the Rental income type —
 * on a new lease and on a renewal. Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/ops-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

async function checkRentalAdd(page: Page, id: number, tag: string) {
  await page.goto(`/dashboard/manager/operations/${id}?rp=2`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const rail = page.locator('tr', { hasText: 'Rental Income' }).first();
  await rail.scrollIntoViewIfNeeded();
  await rail.getByRole('button', { name: /Add/ }).first().click();
  const modal = page.locator('.modal').filter({ hasText: 'New payment' });
  await modal.waitFor({ timeout: 15_000 });
  const typeSel = modal.locator('select').first();
  const opts = await typeSel.locator('option').allTextContents();
  console.log(`[${tag} #${id}] Type options = ${JSON.stringify(opts)}  selected=${await typeSel.inputValue()}`);
  expect(opts).toEqual(['Rental income']);
  expect(await typeSel.inputValue()).toBe('rental_income');
  await page.screenshot({ path: `${SHOTS}/rental-add-${tag}-${id}.png` });
  await modal.getByRole('button', { name: /Cancel/ }).click();
}

test('rental Add offers only rental income (new + renewal)', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  // 394 is now an ACTIVE lease — its plan is frozen post-activation, so the
  // per-section Add is gone. 393 is the equivalent pre-activation new lease.
  await checkRentalAdd(page, 393, 'new');
  await checkRentalAdd(page, 392, 'renewal');
});
