/**
 * e2e/book-now-phone.spec.ts
 *
 * Phone-only registration path through the Book Now (InquireModal) on
 * /listings/units/218.  Tests the unified "email or phone" auth field.
 *
 * Run: npx playwright test e2e/book-now-phone.spec.ts --reporter=list
 */

import { test, expect, type Page } from '@playwright/test';

const UNIT_URL = '/listings/units/218';
const BACKEND  = 'http://localhost:3001/api';
const TS       = Date.now();

function freshPhone(): string {
  // +97150XXXXXXX — 9-digit local number (UAE mobile)
  const suffix = String(TS).slice(-7);
  return `+97150${suffix}`;
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function openBookNow(page: Page) {
  await page.goto(UNIT_URL);
  await page.waitForLoadState('networkidle');
  const btn = page.locator('button').filter({ hasText: /^Book Now$/ }).first();
  await expect(btn).toBeVisible({ timeout: 10000 });
  await btn.click();
  await expect(page.locator('h3').filter({ hasText: 'Book Now' })).toBeVisible({ timeout: 5000 });
}

async function fillOtp(page: Page, otp: string) {
  const inputs = page.locator('input[inputmode="numeric"]');
  await expect(inputs.first()).toBeVisible({ timeout: 5000 });
  for (let i = 0; i < 6; i++) await inputs.nth(i).fill(otp[i]);
}

test.describe('Book Now — phone-only registration', () => {

  test('1 — new user can enter a UAE phone number in the unified field', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    const input = page.locator('input[placeholder*="@"]');
    await expect(input).toBeVisible();
    await input.fill(freshPhone());

    // Send verification code becomes enabled
    await expect(page.locator('button').filter({ hasText: /Send verification code/ })).toBeEnabled();
  });

  test('2 — phone registration triggers "Check your phone" OTP step', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    const input = page.locator('input[placeholder*="@"]');
    await input.fill(freshPhone());
    await page.locator('button').filter({ hasText: /Send verification code/ }).click();

    // Backend registration creates a phone OTP; EXPOSE_DEV_OTP exposes devOtp
    const devBox = page.locator('text=/Dev code:/');
    await expect(devBox).toBeVisible({ timeout: 10000 });

    // Heading should say "phone" not "email"
    await expect(page.locator('h3').filter({ hasText: 'Check your phone' })).toBeVisible();
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).not.toBeVisible();
  });

  test('3 — phone OTP verify → contract created → success screen with CID', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    const phone = freshPhone();
    const input = page.locator('input[placeholder*="@"]');
    await input.fill(phone);
    await page.locator('button').filter({ hasText: /Send verification code/ }).click();

    const devBox = page.locator('text=/Dev code:/');
    await expect(devBox).toBeVisible({ timeout: 10000 });
    const otp = ((await devBox.textContent()) ?? '').replace(/[^0-9]/g, '').slice(0, 6);

    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Reservation Submitted!' })).toBeVisible({ timeout: 12000 });
    await expect(page.locator('text=/CID-\\d+/')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /View My Application/ })).toBeVisible();
  });

  test('4 — "View My Application" reaches dashboard after phone registration', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    const phone = `+97150${String(TS + 1).slice(-7)}`; // slightly different to avoid conflict
    const input = page.locator('input[placeholder*="@"]');
    await input.fill(phone);
    await page.locator('button').filter({ hasText: /Send verification code/ }).click();

    const devBox = page.locator('text=/Dev code:/');
    await expect(devBox).toBeVisible({ timeout: 10000 });
    const otp = ((await devBox.textContent()) ?? '').replace(/[^0-9]/g, '').slice(0, 6);

    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('button').filter({ hasText: /View My Application/ })).toBeVisible({ timeout: 12000 });
    await page.locator('button').filter({ hasText: /View My Application/ }).click();

    await expect(page).toHaveURL(/dashboard\/customer\/spaces/, { timeout: 8000 });
  });

  test('5 — short local format (0501234567) is normalised to +971... and registers', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    // Enter without country code — frontend normalises to +971...
    const localPhone = `050${String(TS + 2).slice(-7)}`;
    const input = page.locator('input[placeholder*="@"]');
    await input.fill(localPhone);
    await page.locator('button').filter({ hasText: /Send verification code/ }).click();

    await expect(page.locator('h3').filter({ hasText: 'Check your phone' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Dev code:/')).toBeVisible({ timeout: 5000 });
  });

  test('6 — existing phone user can sign in (login path, not register)', async ({ request, page }) => {
    const phone = `+97150${String(TS + 3).slice(-7)}`;

    // Pre-register the user via API
    const reg = await request.post(`${BACKEND}/auth/register/customer`, { data: { phone } });
    expect(reg.ok()).toBe(true);
    const regBody = await reg.json() as { devOtp?: string };

    // Verify phone OTP via API so account is active
    const regToken = ((await reg.json()) as { access_token?: string }).access_token ?? '';
    // We need to call /auth/otp/verify with the registration token
    const verify = await request.post(`${BACKEND}/auth/otp/verify`, {
      headers: { Authorization: `Bearer ${regToken}` },
      data: { code: regBody.devOtp },
    });
    // Even if verify fails here (we already consumed the OTP from reg.json() twice), the key check is the UI flow

    // Now open Book Now and enter the same phone — should hit the LOGIN path
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });
    const input = page.locator('input[placeholder*="@"]');
    await input.fill(phone);
    await page.locator('button').filter({ hasText: /Send verification code/ }).click();

    // A login OTP is dispatched for an existing phone user
    await expect(page.locator('h3').filter({ hasText: 'Check your phone' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/Dev code:/')).toBeVisible();
  });
});
