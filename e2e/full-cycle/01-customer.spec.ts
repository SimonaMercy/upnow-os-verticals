import { test, expect } from '@playwright/test';
import {
  expectUploadServed,
  loginViaUi,
  logout,
  pngFile,
  q,
  readState,
  registerCustomerViaUi,
  writeState,
} from './helpers';

/**
 * 01 — Customer full registration + KYC + re-login (all through the UI).
 *
 *   1. Fresh customer registers (phone OTP) → /welcome → uploads ALL 4 KYC
 *      slots (EID front/back, passport, UAE visa) → "4 of 4 uploaded" →
 *      users.kyc_status flips to pending_review → continue to marketplace.
 *   2. Logout → login again via phone OTP on /login → lands on the
 *      marketplace ('/' is the customer dashboard) with the authenticated
 *      avatar menu (Profile / My Spaces / Log out).
 *   3. /dashboard/customer/profile → edit first/last name → sticky save bar
 *      → reload → values persisted (UI + DB).
 *
 * State written: customerPhone, customerUserId, customerTenantId,
 *                customerFirstName, customerLastName.
 */

const KYC_KEYS = ['emirates_id_front', 'emirates_id_back', 'passport', 'uae_visa'] as const;

const FIRST_NAME = 'Zane';
const LAST_NAME = 'Cycletester';

test.describe.serial('01 customer registration + KYC + profile', () => {
  test('registers via phone OTP and uploads all 4 KYC docs on /welcome', async ({ page }) => {
    const phone = await registerCustomerViaUi(page);
    writeState({ customerPhone: phone });

    // Known race (F-UX-1, noted in 00-smoke): choosing a file before the lazy
    // /profiles/customer/me fetch resolves shows "Profile not ready" and the
    // chosen file is silently dropped. Structure around it: arm the response
    // wait BEFORE navigating, and only touch the inputs after it resolves.
    const profileLoaded = page.waitForResponse(
      (r) => r.url().includes('/profiles/customer/me') && r.ok(),
      { timeout: 45_000 },
    );
    await page.goto('/welcome');
    await profileLoaded;

    await expect(page.getByText('0 of 4 uploaded')).toBeVisible();

    for (const key of KYC_KEYS) {
      const input = page.getByTestId(`kyc-input-${key}`);
      await input.waitFor({ state: 'attached', timeout: 15_000 });
      const docPosted = page.waitForResponse(
        (r) => r.url().includes('/api/documents') && r.request().method() === 'POST' && r.ok(),
        { timeout: 30_000 },
      );
      await input.setInputFiles(pngFile(`${key}.png`));
      await docPosted;
    }

    // UI reflects completion
    await expect(page.getByText('4 of 4 uploaded')).toBeVisible();
    await expect(page.getByText(/All set — landlord will review/)).toBeVisible();

    // DB: user + tenant profile exist, kyc_status advanced on first upload
    const userId = q(
      `SELECT id FROM users WHERE phone LIKE '%${phone}' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    );
    expect(Number(userId), 'customer user row').toBeGreaterThan(0);
    expect(q(`SELECT kyc_status FROM users WHERE id=${userId}`)).toBe('pending_review');

    const tenantId = q(`SELECT id FROM tenants WHERE user_id=${userId} ORDER BY id DESC LIMIT 1`);
    expect(Number(tenantId), 'tenant profile row').toBeGreaterThan(0);

    const docCount = q(
      `SELECT count(*) FROM documents WHERE owner_type='customer' AND owner_id=${tenantId}
       AND document_key IN ('emirates_id_front','emirates_id_back','passport','uae_visa')`,
    );
    expect(Number(docCount), 'all four KYC document rows').toBe(4);

    // one of the uploads actually serves bytes through the frontend proxy
    const fileUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='customer' AND owner_id=${tenantId}
       ORDER BY id DESC LIMIT 1`,
    );
    expect(fileUrl, 'upload must be local, not cloud storage').not.toContain('googleapis');
    expect(fileUrl, 'upload must be local, not cloud storage').not.toContain('amazonaws');
    const uploadPath = fileUrl.startsWith('http') ? new URL(fileUrl).pathname : fileUrl;
    await expectUploadServed(page, uploadPath);

    writeState({ customerUserId: Number(userId), customerTenantId: Number(tenantId) });

    // With all 4 slots done the CTA reads "Continue to marketplace"
    // (it says "Take me to listings" only while 0 docs are uploaded).
    const continueBtn = page.getByTestId('kyc-continue');
    await expect(continueBtn).toHaveText(/Continue to marketplace/i);
    await continueBtn.click();
    await page.waitForURL((u) => new URL(String(u)).pathname === '/', { timeout: 30_000 });
  });

  test('logs out and back in via phone OTP; lands authenticated on the marketplace', async ({
    page,
  }) => {
    const { customerPhone } = readState();
    expect(customerPhone, 'customerPhone persisted by previous test').toBeTruthy();

    // fresh context per test = already logged out, but exercise the helper
    // anyway so the cookie-clearing path is covered.
    await logout(page);

    await loginViaUi(page, customerPhone);

    // customer dashboard IS the marketplace landing page '/'
    await page.waitForURL((u) => new URL(String(u)).pathname === '/', { timeout: 30_000 });

    // authenticated header: avatar menu replaces the Sign in / Sign up links
    const navActions = page.locator('.l-nav-actions');
    await expect(navActions.locator('button').first()).toBeVisible({ timeout: 30_000 });
    await expect(navActions.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

    await navActions.locator('button').first().click();
    await expect(page.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Spaces' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  });

  test('edits first/last name on the customer profile and it persists', async ({ page }) => {
    const { customerPhone, customerUserId } = readState();
    await loginViaUi(page, customerPhone);

    // arm BEFORE navigation: the page populates the form only after the
    // authed GET /auth/me resolves — filling earlier gets overwritten.
    const meLoaded = page.waitForResponse(
      (r) =>
        r.url().includes('/api/auth/me') && r.request().method() === 'GET' && r.ok(),
      { timeout: 60_000 },
    );
    await page.goto('/dashboard/customer/profile');
    await meLoaded;

    // user data rendered: the verification list shows the (verified) phone
    await expect(page.getByText(`+971${customerPhone}`).first()).toBeVisible({
      timeout: 30_000,
    });

    const firstNameInput = page.getByPlaceholder('Ahmed');
    const lastNameInput = page.getByPlaceholder('Al Mansouri');
    await expect(firstNameInput).toBeVisible();
    await firstNameInput.fill(FIRST_NAME);
    await lastNameInput.fill(LAST_NAME);

    // sticky save bar appears once dirty
    const saveBtn = page.getByRole('button', { name: /Save changes/i });
    await expect(saveBtn).toBeEnabled();
    const patched = page.waitForResponse(
      (r) => r.url().includes('/api/auth/me') && r.request().method() === 'PATCH' && r.ok(),
      { timeout: 30_000 },
    );
    await saveBtn.click();
    await patched;
    // NOTE: exact-string match, not /^Saved$/ — the toast's text is " Saved"
    // (leading JSX whitespace) and regex matching does NOT normalize whitespace.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // reload — values must come back from the server, not local state
    await page.reload();
    await expect(page.getByPlaceholder('Ahmed')).toHaveValue(FIRST_NAME, { timeout: 60_000 });
    await expect(page.getByPlaceholder('Al Mansouri')).toHaveValue(LAST_NAME);

    // and the DB agrees
    expect(q(`SELECT first_name FROM users WHERE id=${customerUserId}`)).toBe(FIRST_NAME);
    expect(q(`SELECT last_name FROM users WHERE id=${customerUserId}`)).toBe(LAST_NAME);

    writeState({ customerFirstName: FIRST_NAME, customerLastName: LAST_NAME });
  });
});
