/**
 * Sub-lease pass-through charges on the Third Party receipt.
 *
 * Both live sub-leased contracts in Avenue Warehouse (industrial sheds, RP 2),
 * because their labels disagree about what "VAT" means:
 *
 *   CID-393  Sub-lease charge (20%)  29,000  ← levy, net
 *            5% VAT on sub-lease      1,450  ← the tax ON that levy → VAT column
 *            Rental VAT (5%)          7,250  ← payment_type 'vat' → VAT column
 *
 *   CID-332  20% VAT on Sublease     21,000  ← 20% of rent: the LEVY, worded as
 *                                              VAT by the RP → must stay NET
 *            5% VAT on Sublease       1,050  ← the tax on it → VAT column
 *            5% VAT on Rent           5,250  ← tax → VAT column
 *            Fire Fighting            2,500  ← flat charge → net
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

test('sub-lease VAT maps to the VAT column, the levy stays net', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  for (const cid of [393, 332]) {
    await page.goto(`/rental-provider/dashboard/contracts/${cid}/print/receipt?kind=vat`);
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${SHOTS}/${cid}-rp-vat.png`, fullPage: true });
  }
});

test('customer sees the same split on CID-393', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'dev@upnow.ae');

  for (const kind of ['vat', 'all']) {
    await page.goto(`/dashboard/customer/contracts/393/print/receipt?kind=${kind}`);
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${SHOTS}/393-${kind}.png`, fullPage: true });
  }
});
