/**
 * The segment reference carries a "/" suffix (PP-…-00104/D). Confirm it never
 * reaches the download filename as a path separator.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('segment receipt downloads with a filesystem-safe name', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/contracts/394/print/receipt?rp=2&kind=deposit');
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByText('Download PDF').first().click(),
  ]);
  const name = download.suggestedFilename();
  console.log('suggested filename:', name);
  expect(name).not.toContain('/');
  expect(name).toBe('PP-2-2026-00104-D.pdf');
});
