/**
 * Customer space, step 7: once the CUSTOMER has counter-signed the move-in
 * inspection there is nothing left for them to do — the space must say it is
 * waiting on the rental provider / property manager, and that the tenancy goes
 * live once they approve.
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

test('signed move-in shows the awaiting-approval state', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1300 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/spaces/v2/c-394');
  await page.waitForLoadState('networkidle');

  // Data-dependent: once the RP/manager counter-signs, the lease advances to
  // step 8 and this state is no longer reachable on THIS contract. Skip loudly
  // rather than fail red on a lease that has moved on.
  if (await page.getByText('Your tenancy is live.').count()) {
    test.skip(true, 'contract 394 has been counter-signed — step 7 review state no longer applies');
  }

  // The step states the wait, who unblocks it, and what happens after — once.
  await expect(page.getByText(/awaiting your rental provider’s approval/i)).toBeVisible();
  await expect(page.getByText(/property manager will counter-sign/i)).toBeVisible();
  await expect(page.getByText(/your tenancy goes live/i)).toBeVisible();
  await expect(page.getByText('Inspection under review')).toBeVisible();

  // No stale call-to-action: the customer is not asked to sign again.
  await expect(page.getByRole('button', { name: /Counter-sign inspection/i })).toHaveCount(0);
  // The captured signature image is NOT reproduced on the space page.
  await expect(page.getByAltText('Your signature')).toHaveCount(0);
  await expect(page.getByText(/^Signed /)).toBeVisible();
  // The signed document stays reachable.
  await expect(page.getByText('View full inspection report')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/space-awaiting-approval.png`, fullPage: false });
});
