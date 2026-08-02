/**
 * CID-393's contract header "Total payable · incl. X VAT" must count the
 * sub-lease VAT row (1,450) that lives in an `other` charge's label, not in
 * vat_amount — so the figure reads 8,700, not 7,250. See lib/chargeTax.
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

test('contract header VAT includes the sub-lease VAT', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/contracts/393/v2');
  const vatNote = page.getByText(/incl\. AED [\d,]+ VAT/).first();
  await vatNote.waitFor({ state: 'visible', timeout: 60_000 });
  console.log('393 header:', (await vatNote.textContent())?.trim());
  await expect(vatNote).toHaveText(/incl\. AED 8,700 VAT/);
  await page.screenshot({ path: `${SHOTS}/393-contract-header.png` });
});
