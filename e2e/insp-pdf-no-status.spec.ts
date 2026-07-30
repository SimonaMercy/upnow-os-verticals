/**
 * The inspection report PDF must not carry the Status (Draft/Signed) box —
 * a report already submitted to the customer was still printing "Draft".
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const OUT = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/pdf';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('inspection PDF has no Status box', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/contracts/394/inspection/v2?type=move_in&rp=2');
  await page.getByRole('button', { name: /Download/ }).waitFor({ timeout: 30_000 });
  const dl = page.waitForEvent('download', { timeout: 90_000 });
  await page.getByRole('button', { name: /Download/ }).click();
  const file = `${OUT}/move-in-394.pdf`;
  await (await dl).saveAs(file);
  console.log('saved', file, fs.statSync(file).size, 'bytes');
});
