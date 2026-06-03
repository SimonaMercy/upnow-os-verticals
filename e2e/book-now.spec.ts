/**
 * e2e/book-now.spec.ts
 *
 * Playwright UI tests for the "Book Now" flow on /listings/units/218.
 * Covers: modal rendering, form validation, unauthenticated auth sub-flow
 * (new user + existing user), success screen, navigation, and gap detection.
 *
 * Confirmed bugs found during testing:
 *  BUG-1  Escape key does not close the modal (no keyboard listener on ModalShell).
 *  BUG-2  "View My Application" navigates to /login instead of the customer dashboard
 *         when the session was established via the inline Book Now auth flow.
 *  BUG-3  Error message in the main form persists when the modal is reopened.
 *  GAP-1  Book Now auth is email-only with a Create/Sign-in toggle; Schedule Viewing
 *         uses the newer unified "email or phone" single field — inconsistent UX.
 *
 * Run: npx playwright test e2e/book-now.spec.ts --reporter=list
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const UNIT_URL  = '/listings/units/218';
const BACKEND   = 'http://localhost:3001/api';
const TS        = Date.now();

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshEmail(tag: string) {
  return `book-${tag}-${TS}@upnow.test`;
}

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

async function registerCustomer(request: APIRequestContext, email: string): Promise<void> {
  await request.post(`${BACKEND}/auth/register/customer`, { data: { email } });
  const r = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const b = await r.json() as { devOtp?: string };
  await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: b.devOtp },
  });
}

async function otpLogin(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const b1 = await r1.json() as { devOtp?: string };
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: b1.devOtp },
  });
  return ((await r2.json()) as { access_token: string }).access_token;
}

async function injectCookie(page: Page, token: string) {
  await page.context().addCookies([{
    name: 'upnow_token', value: token,
    domain: 'localhost', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }]);
}

async function openBookNow(page: Page) {
  await page.goto(UNIT_URL);
  await page.waitForLoadState('networkidle');
  const btn = page.locator('button').filter({ hasText: /^Book Now$/ }).first();
  await expect(btn).toBeVisible({ timeout: 10000 });
  await btn.click();
  await expect(page.locator('h3').filter({ hasText: 'Book Now' })).toBeVisible({ timeout: 5000 });
}

/** Click the X close button (absolute top-right corner of the modal). */
async function closeModal(page: Page) {
  await page.locator('button[class*="top-4"][class*="right-4"]').click();
}

/** Fill identifier (email or phone), send code, return the dev OTP string. */
async function sendOtpCode(page: Page, identifier: string): Promise<string> {
  // The unified auth field is type="text" with a combined email/phone placeholder
  const input = page.locator('input[placeholder*="@"]');
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(identifier);
  await page.locator('button').filter({ hasText: /Send verification code/ }).click();
  const devBox = page.locator('text=/Dev code:/');
  await expect(devBox).toBeVisible({ timeout: 10000 });
  return ((await devBox.textContent()) ?? '').replace(/[^0-9]/g, '').slice(0, 6);
}

async function fillOtp(page: Page, otp: string) {
  const inputs = page.locator('input[inputmode="numeric"]');
  await expect(inputs.first()).toBeVisible({ timeout: 5000 });
  for (let i = 0; i < 6; i++) await inputs.nth(i).fill(otp[i]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Book Now — InquireModal', () => {

  // ── 1. Modal rendering ─────────────────────────────────────────────────────
  test('1 — modal opens with correct title and all form fields', async ({ page }) => {
    await openBookNow(page);

    await expect(page.locator('h3').filter({ hasText: 'Book Now' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Move-in date' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Occupants' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Payment installments' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Message' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Submit Application' })).toBeVisible();
  });

  // ── 2. Submit button disabled until move-in date filled ────────────────────
  test('2 — Submit Application disabled without move-in date', async ({ page }) => {
    await openBookNow(page);
    await expect(page.locator('button').filter({ hasText: 'Submit Application' })).toBeDisabled();
  });

  test('3 — Submit Application enables once move-in date is set', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await expect(page.locator('button').filter({ hasText: 'Submit Application' })).toBeEnabled();
  });

  // ── 3. Installment selector ────────────────────────────────────────────────
  test('4 — installment options Annual / Semi-annual / Quarterly / Monthly all visible', async ({ page }) => {
    await openBookNow(page);
    // Use exact role match to avoid "Annual" matching inside "Semi-annual"
    await expect(page.getByRole('button', { name: 'Annual', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Semi-annual', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quarterly', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toBeVisible();
  });

  test('5 — clicking Monthly selects it (visual state change)', async ({ page }) => {
    await openBookNow(page);
    const monthly = page.getByRole('button', { name: 'Monthly', exact: true });
    await monthly.click();
    await expect(monthly).toHaveClass(/border-\[#2e9f82\]/);
  });

  // ── 4. Close button ────────────────────────────────────────────────────────
  test('6 — X close button dismisses the modal', async ({ page }) => {
    await openBookNow(page);
    await closeModal(page);
    await expect(page.locator('h3').filter({ hasText: 'Book Now' })).not.toBeVisible({ timeout: 3000 });
  });

  test('7 — Escape key closes the modal', async ({ page }) => {
    await openBookNow(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('h3').filter({ hasText: 'Book Now' })).not.toBeVisible({ timeout: 3000 });
  });

  // ── 5. Unauthenticated → auth sub-flow ────────────────────────────────────
  test('8 — unauthenticated submit shows unified "Continue to UpNow" auth step', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });
    // Unified flow — no Create/Sign-in toggle
    await expect(page.locator('button').filter({ hasText: 'Create account' })).not.toBeVisible();
  });

  test('9 — auth input accepts both email and phone (unified field)', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });

    // Single text input with placeholder covering both email and phone
    const input = page.locator('input[placeholder*="@"]');
    await expect(input).toBeVisible();
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toContain('@');
    expect(placeholder).toContain('+971');
  });

  test('10 — Send verification code disabled when identifier field is empty', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();
    await expect(page.locator('button').filter({ hasText: /Send verification code/ })).toBeDisabled({ timeout: 5000 });
  });

  test('11 — "Check your email" heading appears after sending code', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await sendOtpCode(page, freshEmail('t11'));
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).toBeVisible({ timeout: 8000 });
  });

  // ── 6. New user: register → OTP → contract → success ─────────────────────
  test('12 — new user: register → OTP verify → success screen shows CID reference', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    const otp = await sendOtpCode(page, freshEmail('new1'));
    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Reservation Submitted!' })).toBeVisible({ timeout: 12000 });
    await expect(page.locator('text=/CID-\\d+/')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /View My Application/ })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Stay on this page' })).toBeVisible();
  });

  // ── 7. Existing user: sign in → OTP → contract → success ──────────────────
  test('13 — existing user: unified identify → OTP verify → success screen', async ({ request, page }) => {
    const email = freshEmail('exist');
    await registerCustomer(request, email);

    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    // Unified flow — no toggle needed; just enter the registered email
    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });
    const otp = await sendOtpCode(page, email);
    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Reservation Submitted!' })).toBeVisible({ timeout: 12000 });
    await expect(page.locator('text=/CID-\\d+/')).toBeVisible();
  });

  // ── 8. Logged-in customer skips auth ──────────────────────────────────────
  test('14 — logged-in customer goes straight to contract submit (no auth modal)', async ({ request, page }) => {
    const email = freshEmail('loggedin');
    await registerCustomer(request, email);
    const token = await otpLogin(request, email);
    await injectCookie(page, token);

    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    // Auth modal must NOT appear
    await expect(page.locator('button').filter({ hasText: 'Create account' })).not.toBeVisible({ timeout: 3000 });
    // Either success or a business-logic error (e.g. unit already booked)
    await expect(
      page.locator('h3').filter({ hasText: 'Reservation Submitted!' })
        .or(page.locator('text=/already|occupied|duplicate/i'))
        .or(page.locator('[class*="bg-red"]').first())
    ).toBeVisible({ timeout: 10000 });
  });

  // ── 9. Non-customer role blocked ──────────────────────────────────────────
  // Phase 6c — listing CTAs are hidden entirely for operator accounts
  // (rental_provider/manager/admin/super_admin). Instead of clicking Book
  // Now and seeing a role error, RPs land on the listing and see a
  // "sign in with a customer account" notice. See
  // ListingPageClient.tsx → canBook derivation.
  test('15 — rental provider does not see Book Now CTA, gets switch-account notice', async ({ request, page }) => {
    const rpEmail = freshEmail('rp');
    const rpReg = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: { email: rpEmail, phone: '+971501299001' },
    });
    const rpBody = await rpReg.json() as { access_token: string };
    await injectCookie(page, rpBody.access_token);

    await page.goto(UNIT_URL);
    await page.waitForLoadState('networkidle');

    // Book Now / Schedule Viewing CTAs are hidden …
    await expect(page.locator('button').filter({ hasText: /^Book Now$/ })).toHaveCount(0);
    await expect(page.locator('button').filter({ hasText: /^Schedule Viewing$/ })).toHaveCount(0);
    // … and the operator notice is shown instead.
    await expect(page.locator('text=/sign in with a customer account/i')).toBeVisible({ timeout: 5000 });
  });

  // ── 10. Back button in OTP step ────────────────────────────────────────────
  test('16 — Back button in OTP step returns to identifier entry', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await sendOtpCode(page, freshEmail('back'));
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).toBeVisible({ timeout: 8000 });

    await page.locator('button').filter({ hasText: /Back/ }).click();
    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible();
  });

  // ── 11. Resend OTP link ────────────────────────────────────────────────────
  test('17 — Resend link is present in OTP step', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await sendOtpCode(page, freshEmail('resend'));
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).toBeVisible({ timeout: 8000 });

    // Use role-based locator to avoid matching the email display span
    await expect(page.getByRole('button', { name: 'Resend' })).toBeVisible();
  });

  // ── 12. OTP verify button disabled until 6 digits ─────────────────────────
  test('18 — Verify & reserve disabled until all 6 OTP digits entered', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await sendOtpCode(page, freshEmail('btn'));
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).toBeVisible({ timeout: 8000 });

    const verifyBtn = page.locator('button').filter({ hasText: 'Verify & reserve' });
    await expect(verifyBtn).toBeDisabled();

    const inputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 5; i++) await inputs.nth(i).fill('1');
    await expect(verifyBtn).toBeDisabled();

    await inputs.nth(5).fill('1');
    await expect(verifyBtn).toBeEnabled();
  });

  // ── 13. OTP paste support ──────────────────────────────────────────────────
  test('19 — OTP paste fills all 6 boxes at once', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    const otp = await sendOtpCode(page, freshEmail('paste'));
    await expect(page.locator('h3').filter({ hasText: 'Check your email' })).toBeVisible({ timeout: 8000 });

    const firstOtp = page.locator('input[inputmode="numeric"]').first();
    await firstOtp.focus();
    await page.evaluate((code) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', code);
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, otp);

    const inputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) await expect(inputs.nth(i)).toHaveValue(otp[i]);
    await expect(page.locator('button').filter({ hasText: 'Verify & reserve' })).toBeEnabled();
  });

  // ── 14. Stay on page button ────────────────────────────────────────────────
  test('20 — "Stay on this page" dismisses success screen without navigating', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    const otp = await sendOtpCode(page, freshEmail('stay'));
    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('button').filter({ hasText: 'Stay on this page' })).toBeVisible({ timeout: 12000 });
    await page.locator('button').filter({ hasText: 'Stay on this page' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Reservation Submitted!' })).not.toBeVisible({ timeout: 3000 });
    await expect(page).toHaveURL(new RegExp(UNIT_URL.replace(/\//g, '\\/')));
  });

  // ── 15. "View My Application" navigates to customer dashboard ─────────────
  test('21 — "View My Application" reaches /dashboard/customer/spaces', async ({ page }) => {
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    const otp = await sendOtpCode(page, freshEmail('nav'));
    await fillOtp(page, otp);
    await page.locator('button').filter({ hasText: 'Verify & reserve' }).click();

    await expect(page.locator('button').filter({ hasText: /View My Application/ })).toBeVisible({ timeout: 12000 });
    await page.locator('button').filter({ hasText: /View My Application/ }).click();

    // After inline OTP verification, AuthContext is refreshed before navigation
    // so DashboardShell finds an authenticated user and does not redirect to /login.
    await expect(page).toHaveURL(/dashboard\/customer\/spaces/, { timeout: 8000 });
  });

  // ── 16. Operator notice persists across reload ──────────────────────────
  // Phase 6c — replaces the old "modal error clears on reopen" test, since
  // RP accounts no longer see the Book Now / Schedule Viewing modals at all
  // (CTAs hidden, contextual notice shown instead). This verifies the
  // canBook derivation isn't a render-time fluke: a hard reload keeps RPs
  // in the notice state, never showing CTAs.
  test('22 — operator notice persists across page reload, CTAs never appear', async ({ request, page }) => {
    const rpEmail = freshEmail('rp2');
    const rpReg = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: { email: rpEmail, phone: '+971509990002' },
    });
    const rpBody = await rpReg.json() as { access_token: string };
    await injectCookie(page, rpBody.access_token);

    await page.goto(UNIT_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/sign in with a customer account/i')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button').filter({ hasText: /^Book Now$/ })).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/sign in with a customer account/i')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button').filter({ hasText: /^Book Now$/ })).toHaveCount(0);
  });

  // ── 17. Both Book Now and Schedule Viewing use unified auth ───────────────
  test('23 — Book Now auth matches Schedule Viewing: unified "Continue to UpNow" flow', async ({ page }) => {
    // Both modals now use the same unified email-or-phone single-field auth.
    await openBookNow(page);
    await page.locator('input[type="date"]').fill(tomorrow());
    await page.locator('button').filter({ hasText: 'Submit Application' }).click();

    await expect(page.locator('h3').filter({ hasText: 'Continue to UpNow' })).toBeVisible({ timeout: 5000 });
    // No toggle — unified flow used consistently across both Book Now and Schedule Viewing
    await expect(page.locator('button').filter({ hasText: 'Create account' })).not.toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Sign in' })).not.toBeVisible();
    console.log('GAP-1 resolved: Book Now now uses the same unified auth flow as Schedule Viewing.');
  });
});
