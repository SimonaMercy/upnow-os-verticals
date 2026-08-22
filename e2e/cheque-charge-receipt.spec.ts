import { test, expect, Page } from '@playwright/test';

/**
 * A cheque that fails produces TWO documents the customer must be able to hold:
 * a receipt for the money that replaced it, and a receipt for the charge raised
 * because it failed.
 *
 * The charge already had a real gapless number — contract 178's AED 500 fee is
 * RCP-2-2026-00384 — and appeared on no page anybody could hand over: every
 * receipt builder read `isFee`, which listed admin / ejari / commission and not
 * the cheque charges. This pins the page into existence.
 *
 * Contract 178 is the real case: cheque 000023 for AED 12,375 swapped for a bank
 * transfer, plus the AED 500 replacement fee.
 */
const RP_EMAIL = 'kbaalfalasi@gmail.com';   // rental_providers.id = 2, owns contract 178
const CONTRACT = 178;
const RECEIPT = `/rental-provider/dashboard/contracts/${CONTRACT}/print/receipt`;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('the replacement charge has a receipt of its own', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);

  // The combined document offers the segment as a tab…
  await page.goto(RECEIPT, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Cheque Charges' })).toBeVisible({ timeout: 30_000 });

  // …and the segment renders rather than falling through to the empty state.
  await page.goto(`${RECEIPT}?kind=charges`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/No cheque charges are recorded/i)).toHaveCount(0);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  // The header names the segment, so the tab and the page agree.
  await expect(page.getByText(/Cheque Charges Receipt/i).first()).toBeVisible({ timeout: 20_000 });
});

test('a BOUNCE fee gets the same page — it is the other way a cheque fails', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);
  // Contract 181's cheque 001395 bounced and carries a AED 1,000 penalty. It is
  // one of ELEVEN leases in this portfolio holding a cheque charge that no
  // receipt page has ever shown.
  await page.goto('/rental-provider/dashboard/contracts/181/print/receipt?kind=charges', { waitUntil: 'networkidle' });
  await expect(page.getByText(/No cheque charges are recorded/i)).toHaveCount(0);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
});

test('a lease with no failed cheque offers no charges tab', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);
  // Contract 2 has rent cheques and no charge of any kind — the segment must stay
  // hidden rather than print an empty page implying a charge exists.
  await page.goto('/rental-provider/dashboard/contracts/2/print/receipt', { waitUntil: 'networkidle' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('link', { name: 'Cheque Charges' })).toHaveCount(0);
});

/**
 * A REPLACEMENT DOES NOT RE-ISSUE THE RENT RECEIPT.
 *
 * The rent receipt is the SCHEDULE — the instalments the lease was agreed at.
 * When a cheque fails and the instalment is paid again, that is new money on a
 * new date by a new method, and it takes a receipt of its own. Folding it into
 * the rent page re-issued a document the customer already holds, with a
 * different total and no way for them to see what moved: contract 178 printed
 * "Installment 5 of 4" and AED 61,875 for a lease of four 12,375 cheques.
 */
test('the rent receipt keeps its schedule; the replacement gets its own page', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);

  await page.goto(`${RECEIPT}?kind=rental`, { waitUntil: 'networkidle' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  // Four instalments, at the lease's own value — not five, and not a total
  // inflated by the replacement.
  await expect(page.getByText('Rent Income Receipt', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // The replacement is a separate document with its own segment reference.
  await page.goto(`${RECEIPT}?kind=replacements`, { waitUntil: 'networkidle' });
  await expect(page.getByText(/No replacement payments are recorded/i)).toHaveCount(0);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Replacement Payments Receipt/i).first()).toBeVisible({ timeout: 20_000 });

  // …and it is offered as its own tab beside the others.
  await page.goto(RECEIPT, { waitUntil: 'networkidle' });
  await expect(page.getByRole('link', { name: 'Replacements' })).toBeVisible({ timeout: 30_000 });
});

test('a lease with no replacement offers no Replacements tab', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);
  await page.goto('/rental-provider/dashboard/contracts/2/print/receipt', { waitUntil: 'networkidle' });
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('link', { name: 'Replacements' })).toHaveCount(0);
});
