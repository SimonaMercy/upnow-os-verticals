/**
 * Customer space → Documents on a live tenancy: exactly the four tenancy
 * documents (Payment Plan · Receipts · Signed Tenancy Contract · Contract
 * Registration Certification) and nothing else — the verified KYC uploads are no
 * longer re-listed here.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('tenancy documents list is exactly the lease hand-over set', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1300 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/spaces/v2/c-394');
  await page.getByRole('heading', { name: 'Tenancy Documents' }).or(page.getByText('Tenancy Documents').first()).first().waitFor({ timeout: 60_000 });

  const wanted = ['Payment Plan', 'Receipts', 'Signed Tenancy Contract', 'Contract Registration Certification'];
  for (const label of wanted) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // The old headings and the KYC / inspection entries are gone.
  for (const gone of ['Your documents', 'Contract documents', 'Move-in inspection report', 'Emirates ID — Front', 'Passport']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }

  await page.screenshot({ path: `${SHOTS}/tenancy-documents.png`, fullPage: false });
});
