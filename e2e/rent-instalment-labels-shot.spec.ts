/**
 * Contract payment schedule after migration 0187 — shoots CID-81, the contract
 * that mixes a split instalment 1 (14,000 + 5,250), a bounced cheque and its
 * settlement, to confirm the numbering reads 1 · 1 · 2 · 3 · 4 with the
 * settlement row keeping its own wording.
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

test('rent schedule numbers instalments 1..N', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 1400 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/contracts/81/v2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/cid81-schedule.png`, fullPage: true });

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tr'))
      .map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.textContent ?? '').trim()).join(' | '))
      .filter(t => /Instal|bounced/i.test(t)));
  console.log('SCHEDULE ROWS:\n' + rows.join('\n'));
});
