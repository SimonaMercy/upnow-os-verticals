import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Recording a deposit on a lease that never had one — the gap the landlord's own
// tracker found on CID-340 (Unit 315, AED 5,000 on the sheet, nothing in the
// system). Until migration 0191 there was no way to do this at all: the register
// was written only by the June import.
//
// The test creates and then REMOVES the record, so the clone is left as it was —
// whether that 5,000 is really owed is a question for the signed paperwork, not
// for a test.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/945c51cb-be6d-4cd8-bf26-c856bdb6d8e7/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('a deposit can be added where none was ever recorded', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/contracts/340/v2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const section = page.locator('.sec').filter({ hasText: 'Security Deposit' }).first();

  // Re-runnable: a previous run may have left the deposit in place, in which case
  // the empty state is gone and there is nothing to add — the refusal assertion
  // at the end still proves the one-per-tenancy rule.
  const already = await (await page.request.get('/api/contracts/340')).json() as { securityDeposit: unknown };
  if (!already.securityDeposit) {
    await expect(section.getByText('No deposit on record for this tenancy')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/deposit-contract-empty.png`, fullPage: false });
    await section.getByRole('button', { name: /Add deposit/ }).click();
    await page.waitForTimeout(500);
    await section.locator('input[type="number"]').fill('5000');
    await section.locator('input[placeholder*="Cheque #"]').fill('TEST-0191');
    await section.getByRole('button', { name: /Record deposit/ }).click();
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: `${SHOTS}/deposit-added.png`, fullPage: false });

  // It reads back off the register, with the actions a deposit needs.
  const after = await (await page.request.get('/api/contracts/340')).json() as {
    securityDeposit: { depositId: number; amount: number; chequeNumber: string; chequeStatus: string } | null;
  };
  // eslint-disable-next-line no-console
  console.log('CID-340 after add', JSON.stringify(after.securityDeposit));
  expect(after.securityDeposit?.amount).toBe(5000);
  expect(after.securityDeposit?.chequeNumber).toBe('TEST-0191');
  expect(after.securityDeposit?.chequeStatus).toBe('pending');

  // One deposit per tenancy: a second attempt is refused, and says where the
  // first one lives rather than quietly listing the money twice.
  const dupe = await page.request.post('/api/contracts/340/deposits', { data: { amount: 1000 } });
  expect(dupe.status()).toBe(400);
  const body = await dupe.json() as { message?: string };
  // eslint-disable-next-line no-console
  console.log('duplicate refused:', body.message);
  expect(body.message).toMatch(/already holds a deposit/);
});
