import { test, expect, Page } from '@playwright/test';

/**
 * The Payment Summary modal (and the PDF built from the same rows) states the
 * PLAN — one line per instalment the lease was agreed at.
 *
 * A payment recorded against a bounced cheque is not one of those: it re-pays an
 * instalment already listed. Counting it numbered CID-118's four cheques up to
 * "Instalment 5" and totalled 225,000 on a 180,000 lease — visible to the RP and
 * printable for the customer.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('the plan counts instalments, not the cheques that replaced them', async ({ page }) => {
  test.setTimeout(120_000);
  page.setViewportSize({ width: 1500, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // CID-118: 4 × 45,000 = 180,000, one bounce made good by a 5th payment row.
  await page.goto('/rental-provider/dashboard/contracts/118/v2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // The plan opens from the "View" action on the Payment Plan slot in the
  // documents binder (the PDF link beside it renders the same rows).
  await page.locator('.docitem').filter({ hasText: /Payment (Plan|Summary)/i })
    .getByRole('button', { name: /View/i }).first().click();
  await page.waitForTimeout(2000);
  const modal = page.locator('[role="dialog"]').first();
  await expect(modal).toBeVisible({ timeout: 15_000 });
  await modal.screenshot({ path: '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/2a299e2c-8e1d-4e46-bf19-20e0128f77fd/scratchpad/shots/50-plan-modal-after.png' });
  const text = await modal.innerText();

  expect(text).toMatch(/Instalment 4/);
  expect(text).not.toMatch(/Instalment 5/);          // the replacement is not a 5th
  expect(text).toMatch(/180,000/);                    // rent total, not 225,000
  expect(text).not.toMatch(/225,000/);
  expect(text).toMatch(/181,000/);                    // grand total incl. the 1,000 penalty
  expect(text).not.toMatch(/226,000/);
});
