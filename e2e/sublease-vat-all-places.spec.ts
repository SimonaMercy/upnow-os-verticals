/**
 * The four follow-ups on the sub-lease VAT mapping, end to end on CID-393
 * (industrial shed, sub-leased building — levy 29,000 + tax on it 1,450):
 *
 *   1. Fee & VAT report counts the pass-through tax in its output-VAT figure.
 *   2. Both Payments ledgers file `other` under Third Party, not "Other".
 *   3. The customer's contract page separates rent from the pass-throughs.
 *   4. The rows now carry vat_amount themselves (migration 0174 + the Payment
 *      save hook), so the figures hold without the label rule doing the work.
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

test('Fee & VAT report counts the pass-through tax', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, 'kbaalfalasi@gmail.com');

  const res = await page.request.get('/api/reports/fee-taxation');
  expect(res.ok(), 'fee-taxation responded').toBeTruthy();
  const data = await res.json() as {
    totals: Record<string, number>;
    items: Array<{ contractId: number; otherNetFils: number; otherVatFils: number; totalVatFils: number }>;
  };

  // The report buckets by the period each payment falls DUE, so one contract can
  // now span several period rows (CID-393's rent runs into the next year). Sum
  // the contract's rows before comparing — a `find` would grab whichever period
  // came first, which for CID-393 is the tail year holding rent but no VAT.
  const sumFor = (cid: number, key: 'otherNetFils' | 'otherVatFils' | 'totalVatFils') =>
    data.items.filter(i => i.contractId === cid).reduce((s, i) => s + i[key], 0);

  expect(data.items.some(i => i.contractId === 393), 'CID-393 present in the report').toBeTruthy();
  // 29,000 levy + 250 Ejari-free... the levy and Fire-Fighting style charges are
  // net; only the 1,450 is tax.
  expect(sumFor(393, 'otherNetFils')).toBe(29_000_00);
  expect(sumFor(393, 'otherVatFils')).toBe(1_450_00);
  // Rent VAT 7,250 (its own cheque) + the 1,450 pass-through tax.
  expect(sumFor(393, 'totalVatFils')).toBe(8_700_00);

  // CID-332: the 20%-worded LEVY must stay net — 21,000 + 2,500 Fire Fighting
  // net, 1,050 + 5,250 tax.
  expect(data.items.some(i => i.contractId === 332), 'CID-332 present').toBeTruthy();
  expect(sumFor(332, 'otherNetFils')).toBe(23_500_00);
  expect(sumFor(332, 'otherVatFils')).toBe(6_300_00);

  expect(data.totals.otherVatFils).toBeGreaterThan(0);
  console.log('fee-taxation totals otherNet/otherVat/totalVat:',
    data.totals.otherNetFils, data.totals.otherVatFils, data.totals.totalVatFils);
});

test('both ledgers file the sub-lease charges under Third Party', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 1100 });

  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard/payments');
  await page.getByPlaceholder(/search/i).first().fill('sub-lease');
  await page.waitForTimeout(1500);
  // The group header is CSS-uppercased, so the DOM text is title case.
  const rpGroup = page.locator('tr', { hasText: /Third Party\s*2 records/ });
  await expect(rpGroup).toHaveCount(1);
  await expect(page.locator('tr', { hasText: /^Other\s*2 records/ })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/rp-ledger-thirdparty.png`, fullPage: true });

  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/payments?rp=2');
  await page.getByPlaceholder(/search/i).first().fill('sub-lease');
  await page.waitForTimeout(1500);
  await expect(page.locator('tr', { hasText: /Third Party\s*2 records/ })).toHaveCount(1);
  // The Third Party summary card must exist too, or the money shows only in the
  // grand total and every category card reads AED 0.
  await expect(page.getByText('Contract Registration · Fees VAT · pass-throughs')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/mgr-ledger-thirdparty.png`, fullPage: true });
});

test('customer contract page separates rent from the pass-throughs', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'dev@upnow.ae');

  await page.goto('/dashboard/customer/contracts/393');
  await page.getByText('Payments', { exact: true }).first().click();
  await page.waitForTimeout(1500);

  // Rent section: 4 instalments + the rental-VAT cheque — no sub-lease lines.
  await expect(page.getByText('Rental Instalments (4 / 4)')).toBeVisible();
  await expect(page.getByText('Other Charges (2)')).toBeVisible();
  // Both pass-throughs left the rent table and now sit in their own section.
  const rentTable = page.locator('table').first();
  await expect(rentTable).not.toContainText('Sub-lease charge (20%)');
  await expect(rentTable).not.toContainText('5% VAT on sub-lease');
  const otherTable = page.locator('table').nth(1);
  await expect(otherTable).toContainText('Sub-lease charge (20%)');
  await expect(otherTable).toContainText('5% VAT on sub-lease');
  await page.screenshot({ path: `${SHOTS}/393-customer-split.png`, fullPage: true });
});
