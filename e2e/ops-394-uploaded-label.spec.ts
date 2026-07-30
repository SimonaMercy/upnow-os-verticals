/** Doc rows on Operations 394 must read "Uploaded", not "On file". Untracked. */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/ops-shots';
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}
test('ops 394 doc labels', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/operations/394?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const rows = page.locator('.docitem');
  for (let i = 0; i < await rows.count(); i++) console.log(`  ${i}: ${(await rows.nth(i).innerText()).replace(/\n+/g, ' | ')}`);
  const body = await page.locator('body').innerText();
  expect(body, 'no "On file" left in the binder').not.toMatch(/On file/);
  const row = rows.filter({ hasText: 'Contract Registration Certificate' }).first();
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/uploaded-labels.png` });
});
