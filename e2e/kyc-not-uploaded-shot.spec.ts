/**
 * Screenshots the manager Operations detail Documents card for contract 394,
 * where three customer KYC slots were REQUESTED but never uploaded (documents
 * 3324/3325/3326: status 'pending', file_url ''). They must read
 * "Not uploaded", not "Pending review".
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const MGR_EMAIL = 'sheco1300@yahoo.com';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/bb20d575-9419-4f04-bafd-8bd8c5e23955/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: email, code: devOtp },
  });
  expect(verify.ok(), 'signed in').toBeTruthy();
}

test('manager operations 394 — requested-but-not-uploaded KYC rows', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });

  await signIn(page, MGR_EMAIL);
  await page.goto('/dashboard/manager/operations/394?rp=2');
  await page.getByText('Customer KYC · review').first().waitFor({ timeout: 60_000 });

  const card = page.locator('.sec', { has: page.getByText('Customer KYC · review') }).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await card.screenshot({ path: `${SHOTS}/kyc-review-card.png` });

  // Assert the three never-uploaded slots no longer claim a file arrived.
  for (const label of ['UAE Visa / Residency', 'Employment / Salary Certificate', 'Bank Statement / Pay Slip']) {
    const row = card.locator('.docitem', { has: page.getByText(label, { exact: true }) }).first();
    await expect(row).toHaveClass(/docmiss/);
    await expect(row.locator('.ds')).toHaveText('Not uploaded');
    await expect(row.getByRole('button', { name: /Approve|Reject|View/ })).toHaveCount(0);
  }
  // A real uploaded-and-approved slot still reads Approved with View.
  const eid = card.locator('.docitem', { has: page.getByText('Emirates ID — Front', { exact: true }) }).first();
  await expect(eid.locator('.ds')).toHaveText('Approved');
  await expect(eid.getByRole('button', { name: 'View' })).toBeVisible();
});

test('RP customer detail — requested-but-not-uploaded KYC slots', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });

  await signIn(page, 'kbaalfalasi@gmail.com');   // RP 2 — owns tenant 202
  await page.goto('/rental-provider/dashboard/tenants/202');
  await page.getByText('UAE Visa / Residency').first().waitFor({ timeout: 60_000 });

  // Employment letter + bank statement were requested and never uploaded — they
  // must not read "On record" / "Pending review", and must not carry a green tick.
  for (const label of ['Employment / Salary Certificate', 'Bank Statement / Pay Slip']) {
    const row = page.getByText(label, { exact: true }).first()
      .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(row).toContainText('Not uploaded');
    await expect(row).not.toContainText('On record');
    await expect(row).not.toContainText('Pending review');
    await expect(row.getByRole('button', { name: 'View' })).toHaveCount(0);
  }

  // The needs-attention chips read off the same 'pending' status — they must ask
  // for the upload, not for a review.
  const attention = page.getByText('NEEDS ATTENTION').first()
    .locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
  await expect(attention).toContainText('UAE Visa / Residency not uploaded');
  await expect(attention).not.toContainText('pending review');
  await attention.screenshot({ path: `${SHOTS}/rp-needs-attention.png` });

  const kycCard = page.getByText('Supporting Documents').first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await kycCard.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await kycCard.screenshot({ path: `${SHOTS}/rp-customer-kyc.png` });
});
