/**
 * Phase 3c — post-registration KYC-recommend page (`/welcome`).
 *
 * Verifies:
 *  1. Customer registers + logs in → /welcome renders with 3 KYC slots,
 *     "0 of 3 uploaded" counter, and always-present Skip link.
 *  2. Non-customers (RP) hitting /welcome are bounced away.
 *
 * We do not exercise the actual upload here — that path is covered by
 * the v2 / Step 2 doc-upload spec. /welcome's contract is "render +
 * skippable + role-gated", and that's what we assert.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const FRONTEND = 'http://localhost:3000';

const RP_EMAIL = 'rp.test@upnow.ae';

// The httpOnly proxy cookie name set by /app/api/[...path]/route.ts.
const SESSION_COOKIE = 'upnow_token';

async function loginOtpApi(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(r1.ok(), `OTP step-1 for ${email}: ${r1.status()} ${await r1.text()}`).toBeTruthy();
  const b1 = await r1.json() as { devOtp?: string };
  expect(b1.devOtp, 'devOtp missing — NODE_ENV must not be production').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: b1.devOtp },
  });
  expect(r2.ok(), `OTP step-2 for ${email}: ${r2.status()}`).toBeTruthy();
  return ((await r2.json()) as { access_token: string }).access_token;
}

async function setBrowserSession(page: Page, token: string) {
  await page.context().addCookies([{
    name: SESSION_COOKIE,
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: false,   // can't set httpOnly via CDP from script side; backend reads it via SSR proxy
    sameSite: 'Lax',
  }]);
}

test.describe('Phase 3c — /welcome KYC-recommend page', () => {
  test('customer lands on /welcome with 3 KYC slots + counter + Skip', async ({ request, page }) => {
    // Fresh customer per test so we never depend on order
    const ts = Date.now();
    const email = `welcome.cust.${ts}@upnow.ae`;
    const reg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email, phone: `+9715${ts.toString().slice(-8)}` },
    });
    expect(reg.status(), `Register: ${reg.status()} ${await reg.text()}`).toBe(201);

    const token = await loginOtpApi(request, email);
    await setBrowserSession(page, token);

    await page.goto(`${FRONTEND}/welcome`);

    // Heading
    await expect(page.getByRole('heading', { name: /add your documents now/i })).toBeVisible({ timeout: 10_000 });

    // Three KYC labels (Emirates ID line includes "Front + Back" — match by prefix)
    await expect(page.getByText(/emirates id/i).first()).toBeVisible();
    await expect(page.getByText(/^passport$/i).first()).toBeVisible();
    await expect(page.getByText(/uae visa/i).first()).toBeVisible();

    // Counter starts at 0
    await expect(page.getByText(/0 of 3 uploaded/i)).toBeVisible();

    // Skip link always points to /
    const skip = page.getByTestId('kyc-skip');
    await expect(skip).toBeVisible();
    await expect(skip).toHaveAttribute('href', '/');

    // Continue CTA present
    await expect(page.getByTestId('kyc-continue')).toBeVisible();
  });

  test('RP hitting /welcome gets bounced away', async ({ request, page }) => {
    const token = await loginOtpApi(request, RP_EMAIL);
    await setBrowserSession(page, token);
    await page.goto(`${FRONTEND}/welcome`);
    // Wait for the role-guard effect to push us off /welcome
    await page.waitForURL(url => !url.toString().includes('/welcome'), { timeout: 10_000 });
    expect(page.url()).not.toContain('/welcome');
  });
});
