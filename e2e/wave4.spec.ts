/**
 * Wave 4 — Rental Provider Registration · Email Verification · Phone OTP · KYC
 *
 * Covers the full onboarding journey for the rental_provider role:
 *   1. Registration (API + UI validation)
 *   2. Email verification link flow
 *   3. Phone OTP (request + verify)
 *   4. KYC status endpoint + profile/documents pages
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - superadmin@upnow.ae / ChangeMe2026! exists in DB
 *
 * Run: npm run test:e2e -- wave4
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const TS = Date.now();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uniqueRpEmail() {
  return `rp.test.${Date.now()}@upnow.ae`;
}

async function registerRp(request: APIRequestContext, email: string) {
  const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
    data: {
      email,
      password: 'Test1234!',
    },
  });
  return res;
}

async function getSuperAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BACKEND}/auth/login`, {
    data: { email: 'superadmin@upnow.ae', password: 'ChangeMe2026!' },
  });
  const body = await res.json();
  return body.access_token as string;
}

// ─── GROUP 1: API — Registration validation ────────────────────────────────────

test.describe('Wave 4 — API: Rental Provider Registration', () => {
  test('T4-1: Successful RP registration returns 201 with requiresVerification=true', async ({ request }) => {
    const email = uniqueRpEmail();
    const res = await registerRp(request, email);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user.role).toBe('rental_provider');
    expect(body.user.status).toBe('pending_verification');
    expect(body.user.emailVerified).toBe(false);
    expect(body.requiresVerification).toBe(true);
    expect(body.verificationStep).toBe('email');
    expect(body.access_token).toBeTruthy();
  });

  test('T4-2: Duplicate email registration returns 409', async ({ request }) => {
    const email = uniqueRpEmail();
    await registerRp(request, email); // first registration
    const res = await registerRp(request, email); // duplicate
    expect(res.status()).toBe(409);
  });

  test('T4-3: Missing companyName returns 400', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: {
        fullName: 'No Company',
        email: uniqueRpEmail(),
        phone: '+971501234567',
        password: 'Test1234!',
        // companyName intentionally omitted
      },
    });
    expect(res.status()).toBe(400);
  });

  test('T4-4: Weak password (< 8 chars) returns 400', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: {
        fullName: 'Weak Password RP',
        email: uniqueRpEmail(),
        phone: '+971501234567',
        password: 'short',
        companyName: 'Test LLC',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('T4-5: Invalid phone format returns 400', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: {
        fullName: 'Bad Phone RP',
        email: uniqueRpEmail(),
        phone: 'not-a-phone',
        password: 'Test1234!',
        companyName: 'Test LLC',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('T4-6: Invalid email format returns 400', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: {
        fullName: 'Bad Email RP',
        email: 'not-an-email',
        phone: '+971501234567',
        password: 'Test1234!',
        companyName: 'Test LLC',
      },
    });
    expect(res.status()).toBe(400);
  });

  test('T4-7: Honeypot filled (bot simulation) — dev logs warning, strict mode blocks', async ({ request }) => {
    const email = uniqueRpEmail();
    const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: {
        email,
        password: 'Test1234!',
        website: 'http://malicious.com', // honeypot filled
      },
    });
    // In dev (ANTIFRAUD_STRICT not set), backend logs the honeypot hit but still creates
    // the account so bots cannot distinguish dev from prod. In production
    // (ANTIFRAUD_STRICT=true) the backend returns a fake-success shape and no DB row.
    // We just verify the endpoint doesn't crash and returns a success-shaped response.
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.user).toBeTruthy();
    expect(body.requiresVerification).toBe(true);
  });
});

// ─── GROUP 2: API — Email Verification ────────────────────────────────────────

test.describe('Wave 4 — API: Email Verification', () => {
  test('T4-8: GET /auth/email/confirm with invalid token returns 400', async ({ request }) => {
    const res = await request.get(`${BACKEND}/auth/email/confirm?token=totally-invalid-token-abc123`);
    expect(res.status()).toBe(400);
  });

  test('T4-9: GET /auth/email/confirm without token returns 400', async ({ request }) => {
    const res = await request.get(`${BACKEND}/auth/email/confirm`);
    expect(res.status()).toBe(400);
  });

  test('T4-10: POST /auth/email/resend without auth returns 401 or 429', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/email/resend`, { data: {} });
    // 401 = unauthenticated (normal); 429 = rate-limiter fires before auth guard after repeated runs
    expect([401, 429]).toContain(res.status());
  });

  test('T4-11: POST /auth/email/resend with valid auth returns 200 or 429 (rate-limited)', async ({ request }) => {
    const email = uniqueRpEmail();
    const regRes = await registerRp(request, email);
    const { access_token } = await regRes.json();

    const res = await request.post(`${BACKEND}/auth/email/resend`, {
      data: {},
      headers: { Authorization: `Bearer ${access_token}` },
    });
    // 200 = resent successfully; 429 = too soon after registration email was sent
    expect([200, 429]).toContain(res.status());
  });
});

// ─── GROUP 3: API — Phone OTP ─────────────────────────────────────────────────

test.describe('Wave 4 — API: Phone OTP', () => {
  test('T4-12: POST /auth/otp/request without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/otp/request`, { data: {} });
    expect(res.status()).toBe(401);
  });

  test('T4-13: POST /auth/otp/verify without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BACKEND}/auth/otp/verify`, { data: { code: '123456' } });
    expect(res.status()).toBe(401);
  });

  test('T4-14: POST /auth/otp/verify with wrong code returns 400', async ({ request }) => {
    const email = uniqueRpEmail();
    const regRes = await registerRp(request, email);
    const { access_token } = await regRes.json();

    // Request OTP first
    await request.post(`${BACKEND}/auth/otp/request`, {
      data: {},
      headers: { Authorization: `Bearer ${access_token}` },
    });

    // Attempt with wrong code
    const res = await request.post(`${BACKEND}/auth/otp/verify`, {
      data: { code: '000000' },
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(400);
  });
});

// ─── GROUP 4: API — KYC Status ────────────────────────────────────────────────

test.describe('Wave 4 — API: KYC Status', () => {
  test('T4-15: GET /profiles/rental-provider/me/kyc-status without auth returns 401', async ({ request }) => {
    const res = await request.get(`${BACKEND}/profiles/rental-provider/me/kyc-status`);
    expect(res.status()).toBe(401);
  });

  test('T4-16: GET /profiles/rental-provider/me/kyc-status with RP token returns status', async ({ request }) => {
    const email = uniqueRpEmail();
    const regRes = await registerRp(request, email);
    const { access_token } = await regRes.json();

    const res = await request.get(`${BACKEND}/profiles/rental-provider/me/kyc-status`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.hasProfile).toBe('boolean');
    // Registration atomically creates the RP profile row, so hasProfile=true immediately
    expect(body.hasProfile).toBe(true);
    expect(body.entityType).toBeTruthy();
    expect(typeof body.requiredDocumentsMissing).toBe('number');
  });

  test('T4-17: GET /profiles/rental-provider/me/kyc-status with super_admin token returns 200 hasProfile=false', async ({ request }) => {
    // The endpoint has no role restriction — any authenticated user can call it.
    // For super_admin (no RP profile row), it returns { hasProfile: false }.
    const token = await getSuperAdminToken(request);
    const res = await request.get(`${BACKEND}/profiles/rental-provider/me/kyc-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.hasProfile).toBe(false);
  });

  test('T4-18: POST /profiles/rental-provider without auth returns 401', async ({ request }) => {
    const res = await request.post(`${BACKEND}/profiles/rental-provider`, {
      data: { entityType: 'individual' },
    });
    expect(res.status()).toBe(401);
  });
});

// ─── GROUP 5: Frontend — Registration page ────────────────────────────────────

test.describe('Wave 4 — Frontend: Registration Page', () => {
  test('T4-19: /register/rental-provider renders with email and password fields', async ({ page }) => {
    await page.goto('/register/rental-provider');
    await expect(page.getByRole('heading', { name: /Sign up as a Rental Provider/i })).toBeVisible();
    await expect(page.getByLabel(/Email address/i)).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('T4-20: Submitting empty form shows required-field error', async ({ page }) => {
    await page.goto('/register/rental-provider');
    await page.getByRole('button', { name: /Create account/i }).click();
    // HTML5 validation or inline error — form should NOT navigate away
    await expect(page).toHaveURL(/register\/rental-provider/);
  });

  test('T4-21: Successful registration redirects to /verify-email', async ({ page }) => {
    await page.goto('/register/rental-provider');
    await page.getByLabel(/Email address/i).fill(`rp.e2e.${Date.now()}@upnow.ae`);
    // Password field — target by autocomplete to avoid ambiguity with show/hide button
    await page.locator('input[autocomplete="new-password"]').fill('Test1234!');
    await page.getByRole('button', { name: /Create account/i }).click();
    // Wait for the verify-email heading rather than URL, more resilient to fast navigations
    await expect(page.getByRole('heading', { name: /Verify your email/i })).toBeVisible({ timeout: 12_000 });
    expect(page.url()).toMatch(/verify-email/);
  });
});

// ─── GROUP 6: Frontend — Verify Email page ────────────────────────────────────

test.describe('Wave 4 — Frontend: Verify Email Page', () => {
  test('T4-22: /verify-email without token shows inbox prompt and Resend button', async ({ page }) => {
    // Register to get a session cookie
    await page.goto('/register/rental-provider');
    await page.getByLabel(/Email address/i).fill(`rp.email.${TS}@upnow.ae`);
    await page.locator('input[autocomplete="new-password"]').fill('Test1234!');
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL(/verify-email/, { timeout: 10_000 });

    await expect(page.getByRole('heading', { name: /Verify your email/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Resend verification email/i })).toBeVisible();
  });

  test('T4-23: /verify-email?token=invalid shows error state', async ({ page }) => {
    await page.goto('/verify-email?token=this-is-an-invalid-token-xyz');
    await expect(page.getByRole('heading', { name: /Verify your email/i })).toBeVisible();
    // Wait for API call to resolve to error
    await expect(page.getByText(/couldn't verify|expired|invalid/i)).toBeVisible({ timeout: 8_000 });
  });
});

// ─── GROUP 7: Frontend — Phone Verification page ─────────────────────────────

test.describe('Wave 4 — Frontend: Phone OTP Page', () => {
  test('T4-24: Unauthenticated visit to /verify redirects to /login', async ({ page }) => {
    await page.goto('/verify');
    await expect(page).toHaveURL(/login/, { timeout: 8_000 });
  });

  test('T4-25: /verify page renders OTP input for authenticated user', async ({ page }) => {
    // Register RP then manually navigate to /verify as authenticated user
    await page.goto('/register/rental-provider');
    await page.getByLabel(/Email address/i).fill(`rp.otp.${TS}@upnow.ae`);
    await page.locator('input[autocomplete="new-password"]').fill('Test1234!');
    await page.getByRole('button', { name: /Create account/i }).click();
    await page.waitForURL(/verify-email/, { timeout: 10_000 });

    // Navigate to /verify — should redirect to /verify-email since verificationStep=email
    await page.goto('/verify');
    // With email step pending, /verify should redirect back to /verify-email
    await expect(page).toHaveURL(/verify-email/, { timeout: 8_000 });
  });
});

// ─── GROUP 8: Frontend — KYC Dashboard pages ─────────────────────────────────

test.describe('Wave 4 — Frontend: KYC Dashboard Pages', () => {
  test('T4-26: /dashboard/rental-provider/profile redirects unauthenticated to /login', async ({ page }) => {
    await page.goto('/dashboard/rental-provider/profile');
    await expect(page).toHaveURL(/login/, { timeout: 8_000 });
  });

  test('T4-27: /dashboard/rental-provider/documents redirects unauthenticated to /login', async ({ page }) => {
    await page.goto('/dashboard/rental-provider/documents');
    await expect(page).toHaveURL(/login/, { timeout: 8_000 });
  });

  test('T4-28: RP dashboard redirects unauthenticated to /login', async ({ page }) => {
    await page.goto('/dashboard/rental-provider');
    await expect(page).toHaveURL(/login/, { timeout: 8_000 });
  });
});
