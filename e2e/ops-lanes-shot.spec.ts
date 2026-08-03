import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/4a62b7c5-2078-4047-b218-c39be76f154e/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('capture every operations tab as the manager sees it', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1800, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');

  for (const tab of ['lead', 'new', 'renewal']) {
    await page.goto(`/dashboard/manager/operations?rp=2&tab=${tab}&view=kanban`);
    await page.waitForLoadState('networkidle');
    const board = page.getByText('tracker').first();
    await board.waitFor({ timeout: 30_000 });
    await board.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/ops-${tab}.png` });
  }
});
