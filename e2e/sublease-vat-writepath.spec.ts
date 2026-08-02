/**
 * The write path: a NEW labelled tax charge must save with vat_amount already
 * set, without any surface having to read its label (Payment's @BeforeInsert /
 * @BeforeUpdate hook, shared/charge-tax.isTaxLabel). Also shoots the Fee & VAT
 * report so its new "Other charges" columns can be eyeballed.
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

test('a newly recorded tax charge saves with its VAT already stamped', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, 'kbaalfalasi@gmail.com');

  const add = async (description: string, amount: number) => {
    const res = await page.request.post('/api/contracts/393/payments', {
      data: { paymentType: 'other', description, amount, transactionDate: '2026-07-25', paymentMethod: 'cheque' },
    });
    expect(res.ok(), `recorded ${description}`).toBeTruthy();
    return await res.json() as { id: number; vatAmount: number; amount: number };
  };

  // Labelled as tax at the standard rate → the whole amount is VAT.
  const tax = await add('5% VAT on sub-lease (e2e)', 200);
  expect(tax.vatAmount).toBe(200);

  // A levy worded as VAT at another rate → a NET charge, VAT untouched.
  const levy = await add('20% VAT on Sublease (e2e)', 4000);
  expect(levy.vatAmount).toBe(0);

  // Editing the amount keeps the stamped VAT in step.
  const patched = await page.request.patch(`/api/contracts/393/payments/${tax.id}`, { data: { amount: 350 } });
  expect(patched.ok(), 'edited the tax charge').toBeTruthy();
  expect((await patched.json() as { vatAmount: number }).vatAmount).toBe(350);

  // Clean up so CID-393 goes back to its real schedule.
  for (const id of [tax.id, levy.id]) {
    const del = await page.request.delete(`/api/contracts/393/payments/${id}`);
    expect(del.ok(), `removed e2e row ${id}`).toBeTruthy();
  }
});

test('Fee & VAT report renders its Other-charges columns', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1100 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/reports/fee-taxation');
  await page.getByText('Other charges VAT').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/fee-vat-report.png`, fullPage: true });
});
