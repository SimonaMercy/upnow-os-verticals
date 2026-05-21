/**
 * e2e/negative-cases.spec.ts
 *
 * Negative / sad-path tests for the UpNow rental platform.
 * Covers:
 *
 *  Group 1 — Login UI: wrong credentials
 *    1a  Wrong password → alert "Invalid credentials"
 *    1b  Non-existent email → alert "Invalid credentials"
 *
 *  Group 2 — Registration UI: duplicate email
 *    2a  Re-register with same email → alert "already exists"
 *
 *  Group 3 — Contract API: date validation
 *    3a  Create contract where end < start → 400 + correct message
 *
 *  Group 4 — Contract API: ownership + double-sign enforcement (serial)
 *    4a  Tenant B cannot sign Tenant A's contract → 403
 *    4b  Tenant A signs their own contract → 201
 *    4c  Tenant A cannot sign the same contract twice → 400
 *
 *  Group 5 — Access control: unauthenticated users redirected to /login
 *    5a  /rental-provider/dashboard → /login
 *    5b  /dashboard/customer → /login
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// ── Unique per run so parallel CI runs don't collide ─────────────────────────
const TS = Date.now();
const PASSWORD = 'TestNeg1234!';
const ADMIN_EMAIL = 'superadmin@upnow.ae';
const ADMIN_PASS = 'ChangeMe2026!';

/** Generate a unique UAE mobile number per call, scoped to this test run. */
let _phoneIdx = 0;
function nextPhone(): string {
  return `+9715${String((TS + _phoneIdx++) % 100_000_000).padStart(8, '0')}`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function psql(sql: string): string {
  return execSync(`psql upnow -t -c "${sql}"`, { encoding: 'utf8' }).trim();
}

function verifyEmail(email: string) {
  psql(`UPDATE users SET email_verified = true WHERE email = '${email}'`);
}

/** Returns the rental_providers.id for the given user email. */
function getRpId(email: string): number {
  return parseInt(
    psql(`SELECT rp.id FROM rental_providers rp JOIN users u ON rp.user_id = u.id WHERE u.email = '${email}'`),
    10,
  );
}

/** Returns the tenants.id for the given user email. */
function getTenantId(email: string): number {
  return parseInt(
    psql(`SELECT t.id FROM tenants t JOIN users u ON t.user_id = u.id WHERE u.email = '${email}'`),
    10,
  );
}

/** Set RP compliance_status = compliant directly in the DB (bypasses admin KYC UI — GAP G1). */
function approveRpKyc(email: string) {
  psql(`UPDATE rental_providers SET compliance_status = 'compliant' WHERE user_id = (SELECT id FROM users WHERE email = '${email}')`);
}

// ── API helpers (use page.request so the httpOnly cookie is managed for us) ───

/** Register a user via the Next.js proxy. Sets upnow_token cookie on the page. */
async function apiRegister(page: Parameters<Parameters<typeof test>[1]>[0], role: 'rental-provider' | 'customer', email: string) {
  const res = await page.request.post(`/api/auth/register/${role}`, {
    data: { email, password: PASSWORD, phone: nextPhone() },
  });
  expect(res.status(), `Register ${role} (${email}) failed: ${res.status()}`).toBe(201);
  verifyEmail(email);
}

/** Log in via the Next.js proxy. Replaces the upnow_token cookie on the page. */
async function apiLogin(page: Parameters<Parameters<typeof test>[1]>[0], email: string, pw = PASSWORD) {
  const res = await page.request.post('/api/auth/login', {
    data: { email, password: pw },
  });
  expect(res.status(), `Login (${email}) failed: ${res.status()}`).toBe(200);
}

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — Login UI: wrong credentials
// ══════════════════════════════════════════════════════════════════════════════

test.describe('1 — Login UI: wrong credentials', () => {
  test('1a — wrong password shows "Invalid credentials" alert', async ({ page }) => {
    const email = `neg.login.wp.${TS}@upnow.ae`;
    await apiRegister(page, 'customer', email);

    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill('WrongPassword99!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid credentials/i).first()).toBeVisible({ timeout: 8000 });
    // Must stay on login page — not redirected to dashboard
    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
  });

  test('1b — non-existent email shows "Invalid credentials" alert', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(`ghost.${TS}@upnow.ae`);
    await page.locator('input[type="password"]').fill('SomePassword1!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid credentials/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/login/, { timeout: 3000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — Registration UI: duplicate email
// ══════════════════════════════════════════════════════════════════════════════

test.describe('2 — Registration UI: duplicate email', () => {
  test('2a — re-registering with an existing email shows an error', async ({ page }) => {
    const email = `neg.dup.${TS}@upnow.ae`;
    // Seed the account via API
    await apiRegister(page, 'customer', email);

    // Attempt to register again via the UI form with the same email
    await page.goto('/register/customer');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /create account/i }).click();

    await expect(
      page.getByText(/already exists/i).first(),
    ).toBeVisible({ timeout: 8000 });
    // Must remain on register page
    await expect(page).toHaveURL(/\/register/, { timeout: 3000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — Contract API: date validation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('3 — Contract API: date validation', () => {
  let rpEmail: string;
  let tenantEmail: string;
  let unitId: number;
  let tenantProfileId: number;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(60_000);
    // Spin up a temporary context just for fixture setup
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    rpEmail     = `neg.rp.dt.${TS}@upnow.ae`;
    tenantEmail = `neg.ten.dt.${TS}@upnow.ae`;

    // 1. Register RP + email-verify + set KYC compliant
    await page.request.post('/api/auth/register/rental-provider', {
      data: { email: rpEmail, password: PASSWORD, phone: nextPhone() },
    });
    verifyEmail(rpEmail);
    approveRpKyc(rpEmail);
    await apiLogin(page, rpEmail);

    // 2. Create property + unit
    const propRes = await page.request.post('/api/properties', {
      data: { buildingName: `NegDtProp ${TS}`, spaceCategory: 'residential' },
    });
    expect(propRes.ok(), `Create property failed: ${propRes.status()}`).toBeTruthy();
    const { id: propertyId } = await propRes.json() as { id: number };

    const unitRes = await page.request.post(`/api/properties/${propertyId}/units`, {
      data: { unitNumber: `NDT-${TS}`, unitType: 'apartment' },
    });
    expect(unitRes.ok(), `Create unit failed: ${unitRes.status()}`).toBeTruthy();
    unitId = ((await unitRes.json()) as { id: number }).id;

    // 3. Register tenant
    await page.request.post('/api/auth/register/customer', {
      data: { email: tenantEmail, password: PASSWORD, phone: nextPhone() },
    });
    verifyEmail(tenantEmail);
    tenantProfileId = getTenantId(tenantEmail);

    await ctx.close();
  });

  test('3a — contract end date before start date is rejected → 400', async ({ page }) => {
    await apiLogin(page, rpEmail);

    const res = await page.request.post('/api/contracts', {
      data: {
        unitId,
        tenantId: tenantProfileId,
        contractStartDate: '2026-12-01',
        contractEndDate:   '2026-06-01', // ← before start
        annualRent: 50000,
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/contractEndDate must be after contractStartDate/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — Contract API: ownership + double-sign enforcement
// ══════════════════════════════════════════════════════════════════════════════

test.describe('4 — Contract API: ownership and double-sign enforcement', () => {
  // Serial so test 4c can rely on 4b having signed the contract
  test.describe.configure({ mode: 'serial' });

  let rpEmail:     string;
  let tenantAEmail: string;
  let tenantBEmail: string;
  let contractId:  number;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000); // fixture setup: register RP, 2 tenants, property, unit, contract, issue
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    rpEmail      = `neg.rp.sig.${TS}@upnow.ae`;
    tenantAEmail = `neg.tena.sig.${TS}@upnow.ae`;
    tenantBEmail = `neg.tenb.sig.${TS}@upnow.ae`;

    // Register + approve RP
    await page.request.post('/api/auth/register/rental-provider', {
      data: { email: rpEmail, password: PASSWORD, phone: nextPhone() },
    });
    verifyEmail(rpEmail);
    approveRpKyc(rpEmail);
    await apiLogin(page, rpEmail);

    // Create property + unit
    const propRes = await page.request.post('/api/properties', {
      data: { buildingName: `NegSigProp ${TS}`, spaceCategory: 'residential' },
    });
    expect(propRes.ok(), `Create property failed: ${propRes.status()}`).toBeTruthy();
    const { id: propertyId } = await propRes.json() as { id: number };

    const unitRes = await page.request.post(`/api/properties/${propertyId}/units`, {
      data: { unitNumber: `NSG-${TS}`, unitType: 'apartment' },
    });
    expect(unitRes.ok(), `Create unit failed: ${unitRes.status()}`).toBeTruthy();
    const { id: unitId } = await unitRes.json() as { id: number };

    // Register tenants
    await page.request.post('/api/auth/register/customer', {
      data: { email: tenantAEmail, password: PASSWORD, phone: nextPhone() },
    });
    verifyEmail(tenantAEmail);

    await page.request.post('/api/auth/register/customer', {
      data: { email: tenantBEmail, password: PASSWORD, phone: nextPhone() },
    });
    verifyEmail(tenantBEmail);

    const tenantAId = getTenantId(tenantAEmail);

    // Create contract for Tenant A (as RP)
    await apiLogin(page, rpEmail);
    const cRes = await page.request.post('/api/contracts', {
      data: {
        unitId,
        tenantId: tenantAId,
        contractStartDate: '2026-09-01',
        contractEndDate:   '2027-08-31',
        annualRent: 60000,
      },
    });
    expect(cRes.ok(), `Create contract failed: ${cRes.status()}`).toBeTruthy();
    contractId = ((await cRes.json()) as { id: number }).id;

    // Issue the contract so tenant can sign it
    const issueRes = await page.request.patch(`/api/contracts/${contractId}/issue`);
    expect(issueRes.ok(), `Issue contract failed: ${issueRes.status()}`).toBeTruthy();

    await ctx.close();
  });

  test('4a — Tenant B cannot sign Tenant A\'s contract → 403', async ({ page }) => {
    await apiLogin(page, tenantBEmail);

    const res = await page.request.post(`/api/contracts/tenant/${contractId}/sign`, {
      data: { signatoryName: 'Tenant B Unauthorized' },
    });

    expect(res.status()).toBe(403);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/not your contract/i);
  });

  test('4b — Tenant A signs their own contract → 201', async ({ page }) => {
    await apiLogin(page, tenantAEmail);

    const res = await page.request.post(`/api/contracts/tenant/${contractId}/sign`, {
      data: { signatoryName: 'Tenant A Legit' },
    });

    expect(res.status()).toBe(201);
  });

  test('4c — Tenant A cannot sign the same contract a second time → 400', async ({ page }) => {
    await apiLogin(page, tenantAEmail);

    const res = await page.request.post(`/api/contracts/tenant/${contractId}/sign`, {
      data: { signatoryName: 'Tenant A Again' },
    });

    expect(res.status()).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toMatch(/already signed/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — Access control: unauthenticated redirect to /login
// ══════════════════════════════════════════════════════════════════════════════

test.describe('5 — Access control: unauthenticated users are redirected to /login', () => {
  // Each test has a fresh context (no cookies) — do NOT log in

  test('5a — /rental-provider/dashboard without session → /login', async ({ page }) => {
    await page.goto('/rental-provider/dashboard');
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });

  test('5b — /dashboard/customer without session → /login', async ({ page }) => {
    await page.goto('/dashboard/customer');
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });
});
