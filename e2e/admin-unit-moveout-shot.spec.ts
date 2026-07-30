import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/20d9ec8f-112a-4640-ba6c-61ebb6947275/scratchpad/shots6';
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}
test('move-out condition — priced and legacy', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1250 });
  await signIn(page, 'admin@upnow.ae');
  for (const [unit, name] of [[55, 'priced'], [2, 'legacy']] as [number, string][]) {
    await page.goto(`/dashboard/admin/units/${unit}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const t = page.getByText('Last move-out condition', { exact: true }).first();
    await expect(t).toBeVisible({ timeout: 10000 });
    await t.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/unit-${unit}-${name}.png` });
  }
});
