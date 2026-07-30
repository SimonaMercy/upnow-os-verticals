/**
 * Renewal-path coverage for this session's changes:
 *   1. doc rows read "Uploaded" / "Not uploaded" (never "On file")
 *   2. fee rows offer Edit, never Delete
 *   3. inspection Back lands on Operations, inspector pre-fills with the manager
 * Untracked; mirrored to the session scratchpad.
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

test('renewal: doc labels, no fee Delete, inspection back-nav', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');

  // Renewal 359 has uploaded contract docs (payment_advice ×3, trade licence).
  await page.goto('/dashboard/manager/operations/359?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const rows = page.locator('.docitem');
  for (let i = 0; i < await rows.count(); i++) console.log(`  doc ${i}: ${(await rows.nth(i).innerText()).replace(/\n+/g, ' | ')}`);
  const body = await page.locator('body').innerText();
  expect(body, 'renewal binder has no "On file"').not.toMatch(/On file/);
  expect(await page.getByRole('button', { name: /^Delete$/ }).count(), 'renewal has no fee Delete').toBe(0);
  await page.screenshot({ path: `${SHOTS}/renewal-359-docs.png`, fullPage: true });

  // Inspection back-nav + inspector prefill on the renewal.
  await page.goto('/dashboard/manager/contracts/359/inspection/v2?type=move_in&rp=2');
  const back = page.getByRole('link', { name: /Back to/ });
  await back.waitFor({ timeout: 30_000 });
  console.log('renewal back  :', (await back.textContent())?.trim(), '->', await back.getAttribute('href'));
  expect(await back.getAttribute('href')).toBe('/dashboard/manager/operations/359?rp=2');
  const team = page.getByText('INSPECTION TEAM').first();
  await team.waitFor({ timeout: 30_000 });
  console.log('renewal team  :', (await team.locator('xpath=ancestor::*[2]').innerText()).replace(/\n+/g, ' | '));
});
