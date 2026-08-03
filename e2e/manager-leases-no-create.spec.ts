import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * The Leases register is a read/edit surface for BOTH roles: leases are started
 * in Operations, not here, so "New contract" must not appear on either the
 * manager's page or the landlord's. The row Edit affordance — the part that IS
 * used here — must survive on both.
 *
 * Manager 411 (sheco1300@yahoo.com) holds every permission for landlords 1 and 2,
 * so the button's absence there is the code path, not a missing permission.
 * kbaalfalasi is landlord 2 — the same landlord the manager view is scoped to,
 * so the two halves of this test are the same register seen from both sides.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/ecfa9414-fcae-42f6-ad45-7953143b04b2/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('leases register has no create option for manager or landlord, but keeps edit', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');

  await page.goto('/dashboard/manager/contracts?rp=2');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leases');
  await page.waitForLoadState('networkidle');

  // No create entry point — neither the button nor a link into the /new route.
  await expect(page.getByRole('link', { name: /new contract/i })).toHaveCount(0);
  await expect(page.locator('a[href*="/dashboard/manager/contracts/new"]')).toHaveCount(0);

  // Edit survives: either rows are present with the pencil, or the register is
  // empty for this landlord (nothing to edit) — both are acceptable, an
  // edit-less non-empty register is not.
  const rows = page.locator('a.row');
  const rowCount = await rows.count();
  if (rowCount > 0) {
    expect(await page.getByRole('button', { name: /edit contract/i }).count()).toBeGreaterThan(0);
  }
  console.log('MANAGER ROWS', rowCount);
  await page.screenshot({ path: `${SHOTS}/manager-leases-no-create.png`, fullPage: false });

  // Same register from the landlord's own side — no create entry point either,
  // and the edit pencils still there.
  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard/orders');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('leases');
  await page.waitForLoadState('networkidle');

  await expect(page.getByRole('link', { name: /new contract/i })).toHaveCount(0);
  await expect(page.locator('a[href*="/dashboard/contracts/new"]')).toHaveCount(0);

  const rpRows = await page.locator('a.row').count();
  if (rpRows > 0) {
    expect(await page.getByRole('button', { name: /edit contract/i }).count()).toBeGreaterThan(0);
  }
  console.log('LANDLORD ROWS', rpRows);
  await page.screenshot({ path: `${SHOTS}/rp-leases-no-create.png`, fullPage: false });

  // The landlord's OTHER contract list — /contracts, where the contract detail
  // back-arrow lands — carried its own "New Contract" button. Same rule.
  await page.goto('/rental-provider/dashboard/contracts');
  await expect(page.getByText('All Contracts')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: /new contract/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/rp-all-contracts-no-create.png`, fullPage: false });
});
