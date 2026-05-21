/**
 * Wave 3 — IAM: Permission Guard, Audit Log, Delegated Admin
 * SCRUM-10, SCRUM-11, SCRUM-12
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - super_admin row exists in DB (email: superadmin@upnow.ae, password: ChangeMe2026!)
 *   - audit_logs table created (docs/sprint-03-schema-delta-audit.sql applied)
 *
 * Run: npm run test:e2e
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const SUPER_EMAIL = 'superadmin@upnow.ae';
const SUPER_PASSWORD = 'ChangeMe2026!';
const BACKEND = 'http://localhost:3001/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSuperAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${BACKEND}/auth/login`, {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body.access_token as string;
}

/** Unique email for each test run so we don't hit ConflictException. */
function uniqueAdminEmail(): string {
  return `admin.test.${Date.now()}@upnow.ae`;
}

// ─── GROUP 1: Permission Guard (SCRUM-10) ────────────────────────────────────

test.describe('Wave 3 — SCRUM-10: Permission Guard', () => {
  test('T3-1: POST /admin/accounts without token returns 401', async ({ request }) => {
    const res = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email: 'x@x.com', name: 'X' },
    });
    expect(res.status()).toBe(401);
  });

  test('T3-2: POST /admin/accounts with non-super_admin token returns 403', async ({ request }) => {
    // Register a regular customer then try to create admin
    const regRes = await request.post(`${BACKEND}/auth/register/customer`, {
      data: {
        email: `customer.${Date.now()}@upnow.ae`,
        password: 'Test1234!',
      },
    });
    expect([201, 200, 409]).toContain(regRes.status());

    // If we got a token, try the admin endpoint
    const regBody = await regRes.json().catch(() => null);
    if (regBody?.access_token) {
      const res = await request.post(`${BACKEND}/admin/accounts`, {
        data: { email: 'shouldfail@upnow.ae', name: 'Should Fail' },
        headers: { Authorization: `Bearer ${regBody.access_token}` },
      });
      expect(res.status()).toBe(403);
    }
  });

  test('T3-3: GET /admin/accounts without token returns 401', async ({ request }) => {
    const res = await request.get(`${BACKEND}/admin/accounts`);
    expect(res.status()).toBe(401);
  });
});

// ─── GROUP 2: Delegated Admin (SCRUM-11) ─────────────────────────────────────

test.describe('Wave 3 — SCRUM-11: Delegated Admin Account', () => {
  test('T3-4: super_admin can create a new admin account', async ({ request }) => {
    const token = await getSuperAdminToken(request);
    const email = uniqueAdminEmail();

    const res = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email, name: 'Test Admin', firstName: 'Test', lastName: 'Admin' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(201);

    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.role).toBe('admin');
    expect(body.status).toBe('active');
    // Password hash must NEVER be returned
    expect(body.password).toBeUndefined();
  });

  test('T3-5: Creating admin with duplicate email returns 409', async ({ request }) => {
    const token = await getSuperAdminToken(request);
    const email = uniqueAdminEmail();

    // First create
    await request.post(`${BACKEND}/admin/accounts`, {
      data: { email, name: 'Dup Admin' },
      headers: { Authorization: `Bearer ${token}` },
    });

    // Second create with same email
    const res = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email, name: 'Dup Admin Again' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(409);
  });

  test('T3-6: Creating admin with invalid email returns 400', async ({ request }) => {
    const token = await getSuperAdminToken(request);

    const res = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email: 'not-an-email', name: 'Bad Email' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('T3-7: Creating admin with invalid phone returns 400', async ({ request }) => {
    const token = await getSuperAdminToken(request);

    const res = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email: uniqueAdminEmail(), name: 'Bad Phone Admin', phone: 'not-a-phone' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(400);
  });

  test('T3-8: super_admin can list admin accounts', async ({ request }) => {
    const token = await getSuperAdminToken(request);

    const res = await request.get(`${BACKEND}/admin/accounts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // All returned rows must have role=admin
    for (const a of body) {
      expect(a.role).toBe('admin');
      expect(a.password).toBeUndefined();
    }
  });

  test('T3-9: Creating admin generates an audit log entry', async ({ request }) => {
    const token = await getSuperAdminToken(request);
    const email = uniqueAdminEmail();

    const createRes = await request.post(`${BACKEND}/admin/accounts`, {
      data: { email, name: 'Audit Test Admin' },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(createRes.status()).toBe(201);
    const { id: adminId } = await createRes.json();

    // Audit trail endpoint
    const auditRes = await request.get(`${BACKEND}/admin/accounts/${adminId}/audit`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(auditRes.status()).toBe(200);

    const logs = await auditRes.json();
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBeGreaterThan(0);

    const entry = logs[0];
    expect(entry.actionKey).toBe('admin_account.create');
    expect(entry.entityType).toBe('user');
    expect(entry.entityId).toBe(adminId);
  });
});

// ─── GROUP 3: Frontend — Admin Accounts UI ───────────────────────────────────

test.describe('Wave 3 — Frontend: Admin Accounts UI', () => {
  test('T3-10: /dashboard/admin/accounts redirects unauthenticated to /login', async ({ page }) => {
    await page.goto('/dashboard/admin/accounts');
    await expect(page).toHaveURL(/\/login/);
  });

  test('T3-11: super_admin sees Admin Accounts quick action on dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPER_EMAIL);
    await page.locator('input[autocomplete="current-password"]').fill(SUPER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/dashboard/admin');

    await expect(page.getByText('Admin Accounts')).toBeVisible();
  });

  test('T3-12: super_admin can navigate to admin accounts list', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPER_EMAIL);
    await page.locator('input[autocomplete="current-password"]').fill(SUPER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/dashboard/admin');

    await page.goto('/dashboard/admin/accounts');
    await expect(page.getByRole('heading', { name: 'Admin Accounts', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /New Admin/ })).toBeVisible();
  });

  test('T3-13: Create admin form validates required fields', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPER_EMAIL);
    await page.locator('input[autocomplete="current-password"]').fill(SUPER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/dashboard/admin');

    await page.goto('/dashboard/admin/accounts/new');
    await expect(page.getByRole('heading', { name: 'Create Admin Account' })).toBeVisible();

    // Submit empty form — should show validation errors
    await page.getByRole('button', { name: /Create Admin Account/ }).click();
    await expect(page.getByText(/valid email/i).or(page.getByText(/required/i))).toBeVisible();
  });

  test('T3-14: super_admin can create an admin account via the UI form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(SUPER_EMAIL);
    await page.locator('input[autocomplete="current-password"]').fill(SUPER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('/dashboard/admin');

    await page.goto('/dashboard/admin/accounts/new');

    const email = `ui.admin.${Date.now()}@upnow.ae`;
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Display name').fill('UI Test Admin');
    await page.getByRole('button', { name: /Create Admin Account/ }).click();

    // Should show success message then redirect
    await expect(page.getByText(/Admin account created/i)).toBeVisible();
    await page.waitForURL('/dashboard/admin/accounts');
  });
});
