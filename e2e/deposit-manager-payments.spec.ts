import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// The manager ledger mirrors the landlord's: four payment categories, and the
// deposits in their own section below with their own total.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/945c51cb-be6d-4cd8-bf26-c856bdb6d8e7/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('manager payments: deposits are a section, not a category', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');

  await page.goto('/dashboard/manager/payments?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  const body = await page.locator('body').innerText();
  expect(body).toContain('Security Deposits');
  expect(body).toContain('Held for the customer, refundable at move-out');
  await page.screenshot({ path: `${SHOTS}/deposit-manager-ledger.png`, fullPage: false });

  const heading = page.getByRole('heading', { name: 'Security Deposits' });
  await heading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/deposit-manager-section.png`, fullPage: false });
});
