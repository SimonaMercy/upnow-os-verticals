/**
 * Payment Grouping after migration 0186 — shoots the Third Party card and prints
 * its line items, to confirm the sub-lease levy and its tax each read as ONE card
 * (not four) and the registration fee carries the generated wording.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/e3afd303-2289-4b78-b120-b7e4e8cb8ad3/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('third party groups one card per charge', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/reports/payment-grouping');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/payment-grouping-full.png`, fullPage: true });

  const cards = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll('*').forEach(el => {
      const t = (el.textContent ?? '').trim();
      if (/^Third Party\b/.test(t) && t.length < 700 && el.children.length && el.querySelectorAll('*').length < 80) out.push(t);
    });
    return out.slice(-1);
  });
  console.log('THIRD PARTY CARD:', cards.join(' || '));
});
