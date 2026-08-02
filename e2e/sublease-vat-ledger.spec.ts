/**
 * The Payments ledger's VAT column for the sub-lease pass-throughs.
 *
 * "5% VAT on sub-lease" / "5% VAT on Sublease" IS tax but carries vat_amount 0,
 * so the column used to read "—" for it. The levy line ("20% on sub lease",
 * "20% VAT on Sublease") must still read "—". See lib/chargeTax.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/4c98d46c-dafd-4751-8ccb-6e9d50ccfd6b/scratchpad/receipt-393';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

/** The VAT cell of the ledger row whose description matches. */
async function vatCellFor(page: Page, desc: string): Promise<string> {
  const row = page.locator('tr', { has: page.locator(`td[title="${desc}"]`) }).first();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  // Intl currency formatting separates with a NBSP — normalise before comparing.
  return ((await row.locator('td').nth(7).textContent()) ?? '').replace(/ /g, ' ').trim();
}

test('RP payments ledger shows sub-lease VAT as VAT, the levy as none', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 1100 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/payments');
  await page.getByPlaceholder(/search/i).first().fill('sub-lease');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/rp-ledger-sublease.png`, fullPage: true });

  expect(await vatCellFor(page, '5% VAT on sub-lease')).toBe('AED 1,450');
  expect(await vatCellFor(page, 'Sub-lease charge (20%)')).toBe('—');
});
