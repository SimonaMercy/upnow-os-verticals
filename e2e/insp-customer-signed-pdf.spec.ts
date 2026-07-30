/**
 * Customer inspection page, already-signed lease (391): the report's own two-party
 * Signatures block shows the captured signature, the separate "Your Signature"
 * card is gone, and the customer has NO Preview / Download / Print controls.
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

test('signed customer report, no export controls', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'dev@upnow.ae');
  await page.goto('/dashboard/customer/contracts/391/inspection?type=move_in');
  // The report is a rasterised document, not HTML — wait for the drawn canvas.
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 200 && c.height > 200;
  }, undefined, { timeout: 90_000 });

  // Signed → no standalone signing card, and the signed confirmation shows.
  await expect(page.getByRole('heading', { name: 'Your Signature' })).toHaveCount(0);
  await expect(page.getByText(/You have signed|Both parties have signed/)).toBeVisible();

  // The customer never gets the document-export controls.
  for (const name of ['Preview', 'Download', 'Print']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }

  await page.screenshot({ path: `${SHOTS}/customer-signed.png`, fullPage: false });
});
