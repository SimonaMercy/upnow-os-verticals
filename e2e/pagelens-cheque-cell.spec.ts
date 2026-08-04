/** Does the Cheques Management page hold money anywhere? Click a month cell. */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b3c3a712-8558-4890-bf12-df4741a749a6/scratchpad/lens';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('cheque cell drill-down', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard/reports/cheques-management?year=2026');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  // First clickable month count in the grid
  const btn = page.locator('table tbody button').first();
  console.log('clickable month cells:', await page.locator('table tbody button').count());
  await btn.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/cheq-cell-modal.png` });
  const modal = await page.evaluate(() => (document.body.textContent ?? '').replace(/\s+/g, ' '));
  console.log('MODAL SNIPPET:', modal.slice(modal.indexOf('Cheque #') - 200, modal.indexOf('Cheque #') + 400));
});
