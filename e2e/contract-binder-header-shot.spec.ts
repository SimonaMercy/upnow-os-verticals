/**
 * The documents binder is a full-viewport takeover — no sidebar, no page chrome.
 * Its header must therefore carry the UpNow lockup AND a Close control that
 * returns to the page the reviewer came from.
 *
 * Read-only. Untracked; mirrored to the session scratchpad.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'kbaalfalasi@gmail.com';
const CONTRACT_ID = 368;
const SHOTS = 'e2e/__shots__/binder-header';

// One login for the whole file — the OTP endpoint is rate-limited, so a second
// login inside the same run comes back without `devOtp`.
let cachedToken = '';
async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  if (cachedToken) return cachedToken;
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing — is EXPOSE_DEV_OTP on locally?').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  cachedToken = ((await r2.json()) as { access_token: string }).access_token;
  return cachedToken;
}
const setCookie = (page: Page, token: string) =>
  page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

test('the binder header brands the page and closes back to the contract', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));

  // Arrive the way a reviewer does — from the contract, via "View all".
  await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${CONTRACT_ID}/v2`);
  await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${CONTRACT_ID}/documents`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });

  // The dashboard shell's own header is still in the DOM (hidden behind the
  // fixed takeover) — pick the binder's by its title.
  const header = page.locator('header').filter({ hasText: 'All documents' }).first();
  await expect(header.getByText('UpNow')).toBeVisible();
  const close = page.getByRole('button', { name: 'Close and go back' });
  await expect(close).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-header.png`, fullPage: false });

  // Close lands on the contract the binder belongs to.
  await close.click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${CONTRACT_ID}/v2$`), { timeout: 30000 });
});

test('deep-linked with no in-app history, Close still lands on the contract', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));

  await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${CONTRACT_ID}/documents`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Close and go back' }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts/${CONTRACT_ID}/v2$`), { timeout: 30000 });
});
