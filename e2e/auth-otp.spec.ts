/**
 * Auth OTP flow — end-to-end tests for passwordless authentication.
 *
 * Covers:
 *  - Customer email registration → email OTP verification → dashboard
 *  - Rental provider email-only registration (no phone input, no OAuth)
 *  - OTP login flow (email) → dashboard
 *
 * devOtp is returned in the URL query param so we can complete the flow
 * without a real mail/SMS delivery.
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001 (NODE_ENV != 'production')
 *   - Frontend running on http://localhost:3000
 */

import { test, expect, type Page } from '@playwright/test';

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}@test.upnow.ae`;
}

/** Fill the 6-digit OTP (6 separate maxLength=1 inputs) by typing character by character. */
async function fillOtp(page: Page, otp: string) {
  await page.locator('input[inputmode="numeric"]').first().click();
  await page.keyboard.type(otp, { delay: 30 });
}

// ─── Customer registration ────────────────────────────────────────────────────

// Customer registration is phone-only (CustomerRegisterForm.tsx). Email path
// is exposed indirectly via the unified Book Now / Schedule Viewing modals on
// listing pages; the standalone /register/customer page collects a phone
// number and sends an SMS OTP. Tests below pin the phone flow.
function uniquePhone(suffix: string) {
  // +97150 prefix + 8 digits (7 from timestamp + 1 from suffix). The
  // backend's E.164 validator accepts this format.
  const tail = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const digit = suffix.charCodeAt(0) % 10;
  return `+97150${tail}${digit}`;
}

test.describe('Customer registration — phone OTP flow', () => {
  test('shows phone field and OAuth buttons on /register/customer', async ({ page }) => {
    await page.goto('/register/customer');
    await expect(page.getByLabel('Phone number')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    // OAuth buttons present (even if env vars not set, buttons always render)
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with apple/i })).toBeVisible();
  });

  test('registers customer with phone and completes OTP verification', async ({ page }) => {
    const phone = uniquePhone('c');

    await page.goto('/register/customer');
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Phone registrations route to /verify (phone OTP), not /verify-email
    await expect(page).toHaveURL(/\/verify/, { timeout: 10_000 });

    const url = new URL(page.url());
    const devOtp = url.searchParams.get('devOtp');
    expect(devOtp).toBeTruthy();

    await fillOtp(page, devOtp!);
    await page.getByRole('button', { name: /verify|continue|create account/i }).click();

    await page.waitForURL(u => !u.toString().includes('/verify'), { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard\/customer/, { timeout: 10_000 });
  });

  test('shows error for duplicate phone registration', async ({ page }) => {
    const phone = uniquePhone('d');

    // First registration
    await page.goto('/register/customer');
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/verify/, { timeout: 10_000 });

    // Second registration with same phone
    await page.goto('/register/customer');
    await page.getByLabel('Phone number').fill(phone);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should stay on /register/customer and show conflict error
    await expect(page).toHaveURL(/\/register\/customer/, { timeout: 5_000 });
    await expect(page.getByText(/already exists|already registered/i)).toBeVisible({ timeout: 5_000 });
  });

  test('shows error when phone field left blank', async ({ page }) => {
    await page.goto('/register/customer');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 3_000 });
  });
});

// ─── Rental provider registration ────────────────────────────────────────────

test.describe('Rental provider registration — email only', () => {
  test('shows email-only field, no phone option, no OAuth buttons', async ({ page }) => {
    await page.goto('/register/rental-provider');
    // Label must say "Email address" not "Email or phone number"
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    // No OAuth buttons for rental provider
    await expect(page.getByRole('button', { name: /continue with google/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /continue with apple/i })).not.toBeVisible();
  });

  test('registers rental provider with email and completes OTP verification', async ({ page }) => {
    const email = uniqueEmail('rp');

    await page.goto('/register/rental-provider');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/verify-email/, { timeout: 10_000 });

    const url = new URL(page.url());
    const devOtp = url.searchParams.get('devOtp');
    expect(devOtp).toBeTruthy();

    await fillOtp(page, devOtp!);
    await page.getByRole('button', { name: /verify email|create account|continue/i }).click();

    // Rental providers land on their onboarding/dashboard
    await expect(page).toHaveURL(/\/dashboard\/rental-provider|\/onboarding/, { timeout: 15_000 });
  });

  test('rejects phone-only input for rental provider', async ({ page }) => {
    await page.goto('/register/rental-provider');
    await page.getByLabel('Email address').fill('+971501234567');
    await page.getByRole('button', { name: 'Create account' }).click();
    // Should show validation error for invalid email
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 3_000 });
  });
});

// ─── OTP login flow ───────────────────────────────────────────────────────────

test.describe('OTP login flow', () => {
  const EXISTING_EMAIL = `otp_login_${Date.now()}@test.upnow.ae`;

  test.beforeAll(async ({ request }) => {
    // Pre-register and verify a customer so we can test login
    const regRes = await request.post('http://localhost:3001/api/auth/register/customer', {
      data: { email: EXISTING_EMAIL },
    });
    const regBody = await regRes.json();
    const devOtp = regBody.devOtp;
    if (devOtp) {
      await request.post('http://localhost:3001/api/auth/email/verify-otp', {
        data: { email: EXISTING_EMAIL, code: devOtp },
      });
    }
  });

  // Login page (app/login/page.tsx) renders a plain <label>Phone or email</label>
  // followed by an unlabeled <input>, so getByLabel can't find it. Match the
  // input by placeholder instead. Submit button is "Send code".
  test('login page shows identifier field and send-code button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder(/or you@example/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^send code/i })).toBeVisible();
    // No password field
    await expect(page.locator('input[type="password"]')).not.toBeVisible();
  });

  test('login with unknown email stays on login and shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder(/or you@example/i).fill('nobody_unknown@test.upnow.ae');
    await page.getByRole('button', { name: /^send code/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('login with known email sends OTP and completes sign-in', async ({ page }) => {
    // Capture all auth-related responses, navigation events, and JS errors for debugging
    const authResponses: { path: string; status: number }[] = [];
    const navEvents: string[] = [];
    const jsErrors: string[] = [];
    page.on('response', async resp => {
      if (resp.url().includes('/api/auth')) {
        try { authResponses.push({ path: resp.url().split('/api')[1], status: resp.status() }); } catch {}
      }
    });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) navEvents.push(frame.url());
    });
    page.on('pageerror', err => jsErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') jsErrors.push(msg.text());
    });

    await page.goto('/login');
    await page.getByPlaceholder(/or you@example/i).fill(EXISTING_EMAIL);
    await page.getByRole('button', { name: /^send code/i }).click();

    // Should redirect to /verify-email?email=...&mode=login&devOtp=...
    await expect(page).toHaveURL(/\/verify-email.*mode=login/, { timeout: 10_000 });

    const url = new URL(page.url());
    const devOtp = url.searchParams.get('devOtp');
    expect(devOtp).toBeTruthy();

    await fillOtp(page, devOtp!);
    await page.getByRole('button', { name: /sign in|verify/i }).click();

    // Wait for URL to change away from verify-email
    await page.waitForURL(u => !u.toString().includes('/verify-email'), { timeout: 15_000 });
    await page.waitForTimeout(2000);  // wait for any secondary redirects to settle
    console.log('Auth API responses:', JSON.stringify(authResponses.map(r => ({ path: r.path, status: r.status })), null, 2));
    console.log('Navigation events:', navEvents.join(' → '));
    console.log('Final URL:', page.url());

    // Should reach the customer dashboard
    await expect(page).toHaveURL(/\/dashboard\/customer/, { timeout: 10_000 });
  });

  test('forgot-password page redirects to /login', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});

// ─── API sanity checks ────────────────────────────────────────────────────────

test.describe('Auth API — OTP endpoints', () => {
  test('POST /api/auth/register/customer returns requiresVerification:true', async ({ request }) => {
    const email = uniqueEmail('api_reg');
    const res = await request.post('http://localhost:3001/api/auth/register/customer', {
      data: { email },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.requiresVerification).toBe(true);
    expect(body.verificationStep).toBe('email');
    expect(body.devOtp).toMatch(/^\d{6}$/);
  });

  test('POST /api/auth/login with known email returns requiresVerification:true (no JWT)', async ({ request }) => {
    // Register first
    const email = uniqueEmail('api_login');
    const regRes = await request.post('http://localhost:3001/api/auth/register/customer', {
      data: { email },
    });
    const regBody = await regRes.json();
    // Activate via verify-otp
    await request.post('http://localhost:3001/api/auth/email/verify-otp', {
      data: { email, code: regBody.devOtp },
    });

    const loginRes = await request.post('http://localhost:3001/api/auth/login', {
      data: { email },
    });
    expect(loginRes.status()).toBe(200);
    const body = await loginRes.json();
    expect(body.requiresVerification).toBe(true);
    // No access_token in step 1
    expect(body.access_token).toBeUndefined();
    expect(body.devOtp).toMatch(/^\d{6}$/);
  });

  test('POST /api/auth/login/verify-otp returns access_token', async ({ request }) => {
    const email = uniqueEmail('api_verify');
    const regRes = await request.post('http://localhost:3001/api/auth/register/customer', {
      data: { email },
    });
    const regBody = await regRes.json();
    await request.post('http://localhost:3001/api/auth/email/verify-otp', {
      data: { email, code: regBody.devOtp },
    });

    const loginRes = await request.post('http://localhost:3001/api/auth/login', {
      data: { email },
    });
    const loginBody = await loginRes.json();

    const verifyRes = await request.post('http://localhost:3001/api/auth/login/verify-otp', {
      data: { identifier: email, code: loginBody.devOtp },
    });
    expect(verifyRes.status()).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.access_token).toBeTruthy();
    expect(verifyBody.user.email).toBe(email);
    expect(verifyBody.user.role).toBe('customer');
  });

  test('GET /api/auth/me without token returns 401', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/auth/me');
    expect(res.status()).toBe(401);
  });
});
