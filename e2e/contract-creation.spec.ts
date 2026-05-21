/**
 * Contract Creation E2E Tests
 *
 * Tests the full create-contract flow:
 *   API layer  → POST /api/contracts, GET /api/contracts/tenants/search
 *   UI layer   → /rental-provider/dashboard/contracts/new
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - RP account: rp.test@upnow.ae / Test1234!
 *   - Tenant account: tenant.test@upnow.ae (tenant id=2)
 *   - Property id=2 (Avenue Residence) with unit id=6 (101)
 *
 * Run: npm run test:e2e -- --grep "Contract Creation"
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const RP_EMAIL    = 'rp.test@upnow.ae';
const RP_PASSWORD = 'Test1234!';

// Known fixture IDs (from seed data)
const PROPERTY_ID = 2;
const UNIT_ID     = 6;
const TENANT_ID   = 2;
const TENANT_NAME = 'Test Tenant';
const TENANT_EMAIL = 'tenant.test@upnow.ae';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('http://localhost:3001/api/auth/login', {
    data: { email: RP_EMAIL, password: RP_PASSWORD },
  });
  const body = await res.json();
  return body.access_token as string;
}

async function loginAsRp(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(RP_EMAIL);
  await page.locator('input[autocomplete="current-password"]').fill(RP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait until redirected away from /login
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}

// ─── Group 1: Backend API ────────────────────────────────────────────────────

test.describe('Contract Creation — Backend API', () => {

  test('TC-API-01: tenant search returns results for "test"', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.get('http://localhost:3001/api/contracts/tenants/search?q=test', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('id');
    expect(body[0].user).toHaveProperty('name');
    expect(body[0].user).toHaveProperty('email');
  });

  test('TC-API-02: tenant search returns empty array for short query', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.get('http://localhost:3001/api/contracts/tenants/search?q=x', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // single-char query → empty (min 2 chars enforced in backend service)
    expect(body.length).toBe(0);
    // Note: 2-char minimum is enforced server-side in searchTenants()
  });

  test('TC-API-03: POST /contracts creates a contract successfully', async ({ request }) => {
    const token = await getToken(request);
    const today      = new Date();
    const startDate  = today.toISOString().split('T')[0];
    const endDate    = new Date(today.setFullYear(today.getFullYear() + 1)).toISOString().split('T')[0];

    const res = await request.post('http://localhost:3001/api/contracts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        unitId:              UNIT_ID,
        tenantId:            TENANT_ID,
        contractStartDate:   startDate,
        contractEndDate:     endDate,
        annualRent:          120000,
        securityDepositAmount: 10000,
        numberOfInstallments: 4,
        modeOfPayment:       'cheque',
        contractType:        'new',
      },
    });

    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.unitId).toBe(UNIT_ID);
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.status).toBe('pending');
    expect(Number(body.annualRent)).toBe(120000);
  });

  test('TC-API-04: POST /contracts rejects missing required fields', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post('http://localhost:3001/api/contracts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        // unitId intentionally omitted
        tenantId: TENANT_ID,
        contractStartDate: '2026-06-01',
        contractEndDate:   '2027-05-31',
        annualRent: 120000,
      },
    });
    expect(res.status()).toBe(400);
  });

  test('TC-API-05: POST /contracts rejects end date before start date', async ({ request }) => {
    const token = await getToken(request);
    const res = await request.post('http://localhost:3001/api/contracts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        unitId:            UNIT_ID,
        tenantId:          TENANT_ID,
        contractStartDate: '2027-01-01',
        contractEndDate:   '2026-01-01', // before start
        annualRent:        120000,
      },
    });
    expect(res.status()).toBe(400);
  });

  test('TC-API-06: POST /contracts is protected — 401 without token', async ({ request }) => {
    const res = await request.post('http://localhost:3001/api/contracts', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        unitId: UNIT_ID, tenantId: TENANT_ID,
        contractStartDate: '2026-06-01', contractEndDate: '2027-05-31',
        annualRent: 120000,
      },
    });
    expect(res.status()).toBe(401);
  });

});

// ─── Group 2: Frontend UI ────────────────────────────────────────────────────

test.describe('Contract Creation — Frontend UI', () => {

  test('TC-UI-01: New Contract link is visible on dashboard quick access', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard');
    const link = page.getByRole('link', { name: 'New Contract' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/rental-provider/dashboard/contracts/new');
  });

  test('TC-UI-02: New Contract page renders all form sections', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    await expect(page.getByRole('heading', { name: 'New Tenancy Contract' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Property & Unit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tenant' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Contract Details' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Contract' })).toBeVisible();
  });

  test('TC-UI-03: Unit dropdown is disabled until a property is selected', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    const unitSelect = page.locator('select').nth(1);
    await expect(unitSelect).toBeDisabled();
  });

  test('TC-UI-04: Selecting a property enables and populates the unit dropdown', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    // Select first property
    const propertySelect = page.locator('select').first();
    await propertySelect.selectOption({ index: 1 });

    // Unit dropdown should become enabled and have options
    const unitSelect = page.locator('select').nth(1);
    await expect(unitSelect).not.toBeDisabled({ timeout: 5_000 });
    // Wait for options to populate (fetch happens after property change)
    await expect(unitSelect.locator('option')).toHaveCount(await unitSelect.locator('option').count(), { timeout: 5_000 });
    await page.waitForFunction(
      (sel) => (sel as HTMLSelectElement).options.length > 1,
      await unitSelect.elementHandle(),
      { timeout: 5_000 }
    );
    const options = await unitSelect.locator('option').count();
    expect(options).toBeGreaterThan(1); // placeholder + at least one unit
  });

  test('TC-UI-05: Tenant search autocomplete works', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    const tenantInput = page.getByPlaceholder('Type name or email…');
    await tenantInput.fill('test');

    // Dropdown results should appear
    const dropdown = page.locator('[class*="absolute"][class*="z-20"]');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // First result should contain the tenant name
    await expect(dropdown.locator('button').first()).toContainText(TENANT_NAME);

    // Click the result to select
    await dropdown.locator('button').first().click();
    await expect(page.getByText(`✓ Tenant selected: ${TENANT_NAME}`)).toBeVisible();
  });

  test('TC-UI-06: Submit without tenant shows inline error', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    // Fill in everything except tenant
    const propertySelect = page.locator('select').first();
    await propertySelect.selectOption({ index: 1 });

    const unitSelect = page.locator('select').nth(1);
    await expect(unitSelect).not.toBeDisabled({ timeout: 5_000 });
    await unitSelect.selectOption({ index: 1 });

    await page.locator('input[type="date"]').first().fill('2026-06-01');
    await page.locator('input[type="date"]').nth(1).fill('2027-05-31');
    await page.locator('input[type="number"]').first().fill('120000');

    await page.getByRole('button', { name: 'Create Contract' }).click();

    await expect(page.getByText('Please select a tenant.')).toBeVisible();
  });

  test('TC-UI-07: Full successful contract creation flow', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    // Select property
    const propertySelect = page.locator('select').first();
    await propertySelect.selectOption({ index: 1 });

    // Select unit
    const unitSelect = page.locator('select').nth(1);
    await expect(unitSelect).not.toBeDisabled({ timeout: 5_000 });
    await unitSelect.selectOption({ index: 1 });

    // Search & select tenant
    const tenantInput = page.getByPlaceholder('Type name or email…');
    await tenantInput.fill('test');
    const dropdown = page.locator('[class*="absolute"][class*="z-20"]');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });
    await dropdown.locator('button').first().click();
    await expect(page.getByText(`✓ Tenant selected: ${TENANT_NAME}`)).toBeVisible();

    // Fill dates & rent
    await page.locator('input[type="date"]').first().fill('2026-08-01');
    await page.locator('input[type="date"]').nth(1).fill('2027-07-31');
    await page.locator('input[type="number"]').first().fill('90000');
    await page.locator('input[type="number"]').nth(1).fill('7500');

    // Submit
    await page.getByRole('button', { name: 'Create Contract' }).click();

    // Should show success screen
    await expect(page.getByRole('heading', { name: 'Contract Created' })).toBeVisible({ timeout: 10_000 });
  });

  test('TC-UI-08: Cancel button navigates back to dashboard', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');
    await page.getByRole('link', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/\/rental-provider\/dashboard/, { timeout: 5_000 });
  });

  test('TC-UI-09: Back arrow navigates to dashboard', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');
    await page.locator('a[href="/rental-provider/dashboard"]').first().click();
    await expect(page).toHaveURL(/\/rental-provider\/dashboard/, { timeout: 5_000 });
  });

  test('TC-UI-10: Tenant search by email also works', async ({ page }) => {
    await loginAsRp(page);
    await page.goto('/rental-provider/dashboard/contracts/new');

    const tenantInput = page.getByPlaceholder('Type name or email…');
    await tenantInput.fill(TENANT_EMAIL.slice(0, 10));

    const dropdown = page.locator('[class*="absolute"][class*="z-20"]');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });
    await expect(dropdown.locator('button').first()).toContainText(TENANT_EMAIL);
  });

});
