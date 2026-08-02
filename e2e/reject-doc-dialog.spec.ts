/**
 * Rejecting a customer document must use the app's own dialog, not window.prompt().
 *
 * The native prompt was unstyled browser chrome mid-page, could not say WHICH
 * document was being rejected, and its Cancel (null) was indistinguishable from a
 * silent failure — the old handler also swallowed every fetch error.
 *
 * NON-MUTATING: opens the dialog and cancels. Never confirms a rejection.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const B = 'http://localhost:3001/api';
const RP_EMAIL = 'kbaalfalasi@gmail.com';
const SHOTS = 'e2e/__shots__/renewal-docs';

async function login(request: APIRequestContext, email: string) {
  const r1 = await request.post(`${B}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  const r2 = await request.post(`${B}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  return ((await r2.json()) as { access_token: string }).access_token;
}

test('reject opens an in-app dialog naming the document, and cancels cleanly', async ({ page, request }) => {
  const token = await login(request, RP_EMAIL);
  await page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

  // A native prompt would block the page and never resolve — fail loudly if one fires.
  let nativeDialog = false;
  page.on('dialog', async d => { nativeDialog = true; await d.dismiss(); });

  const before = await (await request.get(`${B}/contracts/363`, { headers: { Authorization: `Bearer ${token}` } })).json() as { documents?: { status: string }[] };
  const rejectedBefore = (before.documents ?? []).filter(d => d.status === 'rejected').length;

  await page.goto('http://localhost:3000/rental-provider/dashboard/operations/363');
  // Whichever KYC document the review card currently offers to reject — the
  // behaviour under test is the dialog, not which row it came from.
  const rejectBtn = page.getByRole('button', { name: /Reject/ }).first();
  await expect(rejectBtn).toBeVisible({ timeout: 30000 });
  const rowText = (await rejectBtn.locator('xpath=ancestor::div[contains(@class,"docitem")][1]').innerText()).split('\n')[0].trim();

  await rejectBtn.click();

  const dialog = page.getByRole('dialog', { name: 'Reject document' });
  await expect(dialog).toBeVisible();
  expect(nativeDialog, 'no native window.prompt').toBe(false);
  // It names the document, which the prompt could not.
  await expect(dialog).toContainText(rowText);
  await expect(dialog.getByPlaceholder(/Reason \(optional/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/7-reject-dialog.png` });

  // Cancel leaves the document untouched.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  const after = await (await request.get(`${B}/contracts/363`, { headers: { Authorization: `Bearer ${token}` } })).json() as { documents?: { status: string }[] };
  expect((after.documents ?? []).filter(d => d.status === 'rejected').length, 'cancel must not reject anything').toBe(rejectedBefore);
});
