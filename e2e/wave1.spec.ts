/**
 * Wave 1 — Super Admin Bootstrap
 * Full-stack end-to-end tests: DB → API → Frontend (browser)
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - super_admin row exists in DB (email: superadmin@upnow.ae, password: ChangeMe2026!)
 *
 * Run: npm run test:e2e
 */

import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'superadmin@upnow.ae';
const ADMIN_PASSWORD = 'ChangeMe2026!';
const WRONG_PASSWORD = 'wrongpassword123';
const UNKNOWN_EMAIL = 'nobody@upnow.ae';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Target the password input precisely — avoids the "Show password" button
 *  that also gets matched by getByLabel('Password') in strict mode. */
function passwordInput(page: Page) {
  return page.locator('input[autocomplete="current-password"]');
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await passwordInput(page).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// ─── GROUP 1: Backend API (via the Next.js proxy) ────────────────────────────

test.describe('Wave 1 — Backend API (via /api proxy)', () => {
  test('T1: POST /api/auth/login with correct credentials returns super_admin', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe('super_admin');
    expect(body.user.status).toBe('active');
    expect(body.access_token).toBeTruthy();
  });

  test('T2: POST /api/auth/login with wrong password returns 401', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: WRONG_PASSWORD },
    });
    expect(res.status()).toBe(401);
  });

  test('T3: POST /api/auth/login with unknown email returns 401', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/auth/login', {
      data: { email: UNKNOWN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status()).toBe(401);
  });

  test('T4: GET /api/auth/me without token returns 401', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/auth/me');
    expect(res.status()).toBe(401);
  });

  test('T5: GET /api/auth/me with valid token returns super_admin profile', async ({ request }) => {
    // Get token first
    const loginRes = await request.post('http://localhost:3001/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { access_token } = await loginRes.json();

    const res = await request.get('http://localhost:3001/api/auth/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(res.status()).toBe(200);
    const user = await res.json();
    expect(user.email).toBe(ADMIN_EMAIL);
    expect(user.role).toBe('super_admin');
    expect(user.status).toBe('active');
  });
});

// ─── GROUP 2: Frontend login flow ────────────────────────────────────────────

test.describe('Wave 1 — Frontend login flow', () => {
  test('T6: Login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(passwordInput(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
  });

  test('T7: Wrong password shows error alert, no redirect', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, WRONG_PASSWORD);
    // Should stay on /login and show an error
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('[role="alert"], .text-red, [class*="error"]').first()).toBeVisible({ timeout: 5000 });
  });

  test('T8: Correct credentials redirect to /dashboard/admin', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    // Should redirect to the admin dashboard
    await expect(page).toHaveURL(/\/dashboard\/admin/, { timeout: 10000 });
  });

  test('T9: Admin dashboard shows "Super Admin Dashboard" heading', async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard\/admin/, { timeout: 10000 });
    await expect(
      page.getByRole('heading', { name: 'Super Admin Dashboard' }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('T10: Unauthenticated access to /dashboard/admin redirects to /login', async ({ page }) => {
    // Navigate without being logged in (fresh page with no cookie)
    await page.goto('/dashboard/admin');
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test('T11: Password toggle shows/hides password text', async ({ page }) => {
    await page.goto('/login');
    const pwInput = passwordInput(page);
    await pwInput.fill('TestPassword');
    // Should start as type="password"
    await expect(pwInput).toHaveAttribute('type', 'password');
    // Click the toggle button
    await page.getByRole('button', { name: /show password/i }).click();
    await expect(pwInput).toHaveAttribute('type', 'text');
    // Click again to hide
    await page.getByRole('button', { name: /hide password/i }).click();
    await expect(pwInput).toHaveAttribute('type', 'password');
  });
});

// ─── GROUP 3: Password reset flow ────────────────────────────────────────────

test.describe('Wave 1 — Forgot password page', () => {
  test('T12: Forgot password page renders step 1 (email form)', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: /forgot|reset/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send|continue/i })).toBeVisible();
  });

  test('T13: Forgot password with unknown email still shows step 2 (enumeration-safe)', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel(/email/i).fill('unknown-nobody@upnow.ae');
    await page.getByRole('button', { name: /send|continue/i }).click();
    // Should advance to step 2 (OTP input appears) — backend returns same shape regardless
    await expect(page.getByPlaceholder('••••••')).toBeVisible({ timeout: 8000 });
  });

  test('T14: Login page shows success banner after ?reset=1 param', async ({ page }) => {
    await page.goto('/login?reset=1');
    await expect(
      page.getByText(/password updated|reset success/i),
    ).toBeVisible({ timeout: 3000 });
  });
});

// ─── GROUP 4: Protected routes ───────────────────────────────────────────────

test.describe('Wave 1 — Route protection', () => {
  const protectedRoutes = [
    '/dashboard/admin',
    '/dashboard/customer',
    '/dashboard/rental-provider',
    '/dashboard/service-provider',
    '/dashboard/manager',
    '/dashboard/technician',
  ];

  for (const route of protectedRoutes) {
    test(`T15: ${route} redirects unauthenticated users to /login`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
    });
  }
});
