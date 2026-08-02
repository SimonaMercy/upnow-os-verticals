/**
 * The customer's own contract page (CID-393), after the pass-throughs were split
 * out of Rental Instalments into their own "Other Charges" section:
 *
 *   Rental Instalments  4 × 36,250 + the 7,250 rental-VAT cheque  → incl. 7,250 VAT
 *   Other Charges       levy 29,000 + the tax on it 1,450         → incl. 1,450 VAT
 *
 * 8,700 of VAT across the two, none of it printed as a net charge. See lib/chargeTax.
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

test('customer contract page totals the sub-lease VAT', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'dev@upnow.ae');

  await page.goto('/dashboard/customer/contracts/393');
  await page.getByText('Payments', { exact: true }).first().click();
  await page.waitForTimeout(1500);

  const rentTable = page.locator('table').first();
  await rentTable.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(rentTable.locator('tfoot')).toContainText('AED 152,250');
  await expect(rentTable.locator('tfoot')).toContainText('incl. AED 7,250 VAT');

  const otherTable = page.locator('table').nth(1);
  await expect(otherTable.locator('tr', { hasText: '5% VAT on sub-lease' })).toContainText('incl. AED 1,450 VAT');
  // The levy is a net charge — it must carry no VAT note.
  await expect(otherTable.locator('tr', { hasText: 'Sub-lease charge (20%)' })).not.toContainText('VAT');
  await expect(otherTable.locator('tfoot')).toContainText('AED 30,450');
  await expect(otherTable.locator('tfoot')).toContainText('incl. AED 1,450 VAT');

  await page.screenshot({ path: `${SHOTS}/393-customer-contract.png`, fullPage: true });
});
