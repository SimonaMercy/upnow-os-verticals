/**
 * Contract 394 move-in inspection: side-by-side evidence of the CUSTOMER report
 * vs the MANAGER report, to pin down why the two previews differ.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('manager move-in report', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/contracts/394/inspection/v2?type=move_in&rp=2');
  await page.getByText('Component Inspection Details').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/manager-full.png`, fullPage: true });
  const sig = page.getByText('Signatures', { exact: true }).first();
  await sig.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/manager-signatures.png`, fullPage: false });
});

test('customer move-in report', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/contracts/394/inspection?type=move_in');
  await page.getByText('Component Inspection Details').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/customer-full.png`, fullPage: true });
  const sig = page.getByText('Signatures', { exact: true }).first();
  await sig.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/customer-signatures.png`, fullPage: false });
  await page.getByRole('button', { name: /Agree & Sign/i }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/customer-sign-card.png`, fullPage: false });
});
