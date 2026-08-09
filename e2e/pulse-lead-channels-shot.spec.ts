import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Platform Pulse — the "Lead channels" card added to Section 1 · Growth.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/8828c023-a733-467d-ad43-7d475d407ce2/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('lead channels card renders on Platform Pulse', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'testadmin@test.com');

  // The card's numbers must be the funnel endpoint's, not a second count.
  const res = await page.request.get('/api/admin/pulse/funnel?days=365');
  expect(res.ok()).toBeTruthy();
  const f = (await res.json()) as { leads: number; leadsConverted: number; channels: { leads: number; converted: number }[] };
  expect(f.channels.reduce((a, c) => a + c.leads, 0)).toBe(f.leads);
  expect(f.channels.reduce((a, c) => a + c.converted, 0)).toBe(f.leadsConverted);

  await page.goto('/dashboard/admin');
  const card = page.locator('text=/^Lead channels — /').first();
  await card.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await card.locator('xpath=ancestor::*[self::div][1]').screenshot({ path: `${SHOTS}/lead-channels.png` });
  await page.screenshot({ path: `${SHOTS}/pulse-growth.png`, fullPage: false });
});
