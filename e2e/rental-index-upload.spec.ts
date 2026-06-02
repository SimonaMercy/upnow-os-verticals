/**
 * Playwright E2E — Rental Index Report upload in Issue/Edit Payment Plan form
 *
 * Verifies:
 *  1. RP can upload a rental index report while issuing a payment plan
 *  2. The inline success status banner appears immediately after upload
 *  3. The file card (green border) replaces the upload widget
 *  4. The report link appears in the plan summary after saving
 *  5. The same upload flow works when editing an existing plan
 *  6. API — rentalIndexReportUrl is persisted in paymentPlan JSONB
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const BACKEND = 'http://localhost:3001/api';
const ADMIN_EMAIL = 'superadmin@upnow.ae';

const TS = Date.now();
const RP_EMAIL     = `rp.upload.${TS}@upnow.ae`;
const TENANT_EMAIL = `tenant.upload.${TS}@upnow.ae`;

// ── Auth helpers ─────────────────────────────────────────────────────────────

/** Register a new account; backend returns access_token immediately (no OTP required). */
async function registerRp(request: APIRequestContext, email: string) {
  const res = await request.post(`${BACKEND}/auth/register/rental-provider`, {
    data: { email, phone: '+971501111222' },
  });
  expect(res.status(), `RP register ${email}: ${res.status()}`).toBe(201);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function registerTenant(request: APIRequestContext, email: string) {
  const res = await request.post(`${BACKEND}/auth/register/customer`, {
    data: { email, phone: '+971509998877' },
  });
  expect(res.status(), `Tenant register ${email}: ${res.status()}`).toBe(201);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** OTP two-step login — used for seeded / admin accounts. */
async function loginOtp(request: APIRequestContext, email: string) {
  const step1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(step1.ok(), `OTP step-1 ${email}: ${step1.status()}`).toBeTruthy();
  const { devOtp } = await step1.json() as { devOtp: string };
  expect(devOtp, 'devOtp must be present in non-prod mode').toBeTruthy();

  const step2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: devOtp },
  });
  expect(step2.ok(), `OTP step-2 ${email}: ${step2.status()}`).toBeTruthy();
  return ((await step2.json()) as { access_token: string }).access_token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function setCookie(page: import('@playwright/test').Page, token: string) {
  await page.context().addCookies([{
    name: 'upnow_token', value: token, domain: 'localhost', path: '/',
  }]);
}

/** Create a minimal valid PDF in /tmp for file-upload tests. */
function createTestPdf(label = ''): string {
  const pdfPath = path.join(os.tmpdir(), `rental-index-${label}-${TS}.pdf`);
  fs.writeFileSync(pdfPath, `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF`);
  return pdfPath;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('Rental Index Report upload — Issue + Edit Payment Plan', () => {
  let rpToken     = '';
  let tenantToken = '';
  let unitId      = 0;
  let leadId      = 0;
  let viewingId   = 0;

  const testPdf = createTestPdf('v1');
  const testPdf2 = createTestPdf('v2');

  // ── Setup ─────────────────────────────────────────────────────────────────

  test('setup: register RP + tenant, create property/unit, book & complete viewing', async ({ request }) => {
    rpToken     = await registerRp(request, RP_EMAIL);
    tenantToken = await registerTenant(request, TENANT_EMAIL);

    // Complete RP onboarding (sets accountTypeConfirmedAt — required by RpOnboardingGate)
    const onboardRes = await request.patch(`${BACKEND}/profiles/rental-provider/me`, {
      headers: auth(rpToken),
      data: { entityType: 'individual', companyName: `Upload Corp ${TS}` },
    });
    expect(onboardRes.ok(), `RP onboarding PATCH: ${onboardRes.status()}`).toBeTruthy();

    // Admin approves RP compliance
    const adminToken = await loginOtp(request, ADMIN_EMAIL);
    const rpMe = await request.get(`${BACKEND}/profiles/rental-provider/me`, { headers: auth(rpToken) });
    expect(rpMe.ok(), `GET /profiles/rental-provider/me: ${rpMe.status()}`).toBeTruthy();
    const rpProfileId = ((await rpMe.json()) as { profile: { id: number } }).profile.id;
    const approveRes = await request.patch(
      `${BACKEND}/profiles/rental-provider/${rpProfileId}/compliance`,
      { headers: auth(adminToken), data: { complianceStatus: 'compliant', complianceNotes: 'Upload spec' } },
    );
    expect(approveRes.ok(), `Compliance approve: ${approveRes.status()}`).toBeTruthy();

    // Property + unit
    const propRes = await request.post(`${BACKEND}/properties`, {
      headers: auth(rpToken),
      data: {
        buildingName: `Upload Tower ${TS}`,
        fullAddress: 'Business Bay, Dubai',
        spaceCategory: 'residential',
        numberOfFloors: '5',
      },
    });
    expect(propRes.status()).toBe(201);
    const propertyId = ((await propRes.json()) as { id: number }).id;

    const unitRes = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `UP-${TS}`,
        unitName: `Upload Apt ${TS}`,
        unitType: 'apartment',
        floor: '2',
        bedrooms: 1,
        bathrooms: 1,
        rentalPrice: 7000000,
        availability: 'available',
      },
    });
    expect(unitRes.status()).toBe(201);
    unitId = ((await unitRes.json()) as { id: number }).id;

    await request.patch(
      `${BACKEND}/properties/${propertyId}/units/${unitId}/toggle-listing`,
      { headers: auth(rpToken) },
    );

    // Tenant books viewing
    const bookRes = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(tenantToken),
      data: {
        unitId,
        scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        desiredMoveIn: '2026-09-01',
        preferredChequeCount: 2,
      },
    });
    expect(bookRes.status()).toBe(201);
    const bookBody = (await bookRes.json()) as { lead: { id: number }; viewing: { id: number } };
    leadId    = bookBody.lead.id;
    viewingId = bookBody.viewing.id;

    // RP marks viewing completed → documents_collection
    const visitRes = await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, {
      headers: auth(rpToken),
      data: { status: 'completed', outcome: 'Upload spec visit' },
    });
    expect(visitRes.ok(), `Mark completed: ${visitRes.status()}`).toBeTruthy();
  });

  // ── Test 1: Upload while issuing plan ─────────────────────────────────────

  test('1. upload rental index report while issuing plan — success banner + file card appear', async ({ page }) => {
    await setCookie(page, rpToken);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });

    // Find the lead row at "Docs Collection" stage
    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Docs Collection' }).first();
    await expect(leadRow).toBeVisible({ timeout: 10_000 });

    // Open Issue Payment Plan form
    await leadRow.getByRole('button', { name: /Issue Payment Plan/i }).click();

    // Fill annual rent
    const rentInput = page.getByPlaceholder(/e\.g\. 85000/i);
    await expect(rentInput).toBeVisible({ timeout: 5_000 });
    await rentInput.fill('70000');

    // Fill fees
    const zeroInputs = page.locator('input[placeholder="0"]');
    await zeroInputs.nth(0).fill('5000');  // Admin Fee
    await zeroInputs.nth(1).fill('2150');  // Ejari
    await zeroInputs.nth(2).fill('4250');  // Commission
    await zeroInputs.nth(3).fill('4250');  // Security Deposit

    // Fill all date inputs
    await page.waitForFunction(() => document.querySelectorAll('input[type="date"]').length >= 2);
    const dateInputs = page.locator('input[type="date"]');
    const dateCount  = await dateInputs.count();
    for (let i = 0; i < dateCount; i++) {
      await dateInputs.nth(i).fill('2026-09-01');
    }

    // ── Rental Index Report section ──────────────────────────────────────
    await expect(page.getByText('Rental Index Report', { exact: false }).first()).toBeVisible({ timeout: 4_000 });

    // Upload widget should be visible before upload
    await expect(page.getByText('Attach PDF or image')).toBeVisible();

    // Upload the test PDF
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(testPdf);

    // ── Verify inline success status banner appears ──────────────────────
    const successBanner = page.locator('text=uploaded successfully').first();
    await expect(successBanner).toBeVisible({ timeout: 12_000 });

    // Upload widget should be gone; green file card should replace it
    await expect(page.getByText('Attach PDF or image')).not.toBeVisible({ timeout: 5_000 });

    // Green-bordered file card must be visible (bg-[#f0faf6] + border-[#2e9f82] is unique to the card)
    const fileCard = page.locator('[class*="bg-[#f0faf6]"][class*="border-[#2e9f82]"]').first();
    await expect(fileCard).toBeVisible();

    // "View" link inside the file card
    await expect(fileCard.getByRole('link', { name: /View/i })).toBeVisible();

    // ── Submit the plan ──────────────────────────────────────────────────
    const submitBtn = page.getByRole('button', { name: /^Issue Payment Plan$/i }).last();
    await submitBtn.click();

    // Stage should flip to "Plan Shared"
    await expect(page.locator('text=Plan Shared').first()).toBeVisible({ timeout: 10_000 });
    await expect(rentInput).not.toBeVisible();
  });

  // ── Test 2: Plan summary link ─────────────────────────────────────────────

  test('2. plan summary shows "View Rental Index Report" link after save', async ({ page }) => {
    await setCookie(page, rpToken);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });

    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Plan Shared' }).first();
    await expect(leadRow).toBeVisible({ timeout: 10_000 });

    // Open the ··· menu and click "View Payment Plan" to expand the plan summary panel
    await leadRow.locator('button.w-8').click();
    await page.getByRole('button', { name: /View Payment Plan/i }).click();

    // Plan summary panel now shows the rental index report link
    const reportLink = leadRow.getByRole('link', { name: /View Rental Index Report/i });
    await expect(reportLink).toBeVisible({ timeout: 5_000 });

    const href = await reportLink.getAttribute('href');
    expect(href).toContain('uploads');
    expect(href).toContain('rental_index_report');
  });

  // ── Test 3: Edit plan pre-populates the existing file card ────────────────

  test('3. edit payment plan — existing report is pre-populated in the form', async ({ page }) => {
    await setCookie(page, rpToken);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });

    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Plan Shared' }).first();
    await expect(leadRow).toBeVisible({ timeout: 10_000 });

    // Open ··· menu → Edit Payment Plan
    await leadRow.locator('button.w-8').click();
    await page.getByRole('button', { name: /Edit Payment Plan/i }).click();

    // The plan form opens; the file card should already show (state synced from existing plan URL)
    await expect(page.getByText('Attach PDF or image')).not.toBeVisible({ timeout: 6_000 });

    const fileCard = page.locator('[class*="bg-[#f0faf6]"][class*="border-[#2e9f82]"]').first();
    await expect(fileCard).toBeVisible({ timeout: 5_000 });
    await expect(fileCard.getByRole('link', { name: /View/i })).toBeVisible();
  });

  // ── Test 4: Replace report in edit mode ──────────────────────────────────

  test('4. edit plan — can replace the existing report with a new upload', async ({ page }) => {
    await setCookie(page, rpToken);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });

    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Plan Shared' }).first();
    await expect(leadRow).toBeVisible({ timeout: 10_000 });
    // Open ··· menu → Edit Payment Plan
    await leadRow.locator('button.w-8').click();
    await page.getByRole('button', { name: /Edit Payment Plan/i }).click();

    // Remove existing file card
    const fileCard = page.locator('[class*="bg-[#f0faf6]"][class*="border-[#2e9f82]"]').first();
    await expect(fileCard).toBeVisible({ timeout: 5_000 });
    await fileCard.getByRole('button').click();  // X button

    // Upload widget reappears
    await expect(page.getByText('Attach PDF or image')).toBeVisible({ timeout: 3_000 });

    // Upload replacement file
    const fileInput = page.locator('input[type="file"][accept*=".pdf"]');
    await fileInput.setInputFiles(testPdf2);

    // Success banner
    await expect(page.locator('text=uploaded successfully').first()).toBeVisible({ timeout: 12_000 });

    // Save
    const updateBtn = page.getByRole('button', { name: /^Update Plan$/i });
    await expect(updateBtn).toBeVisible();
    await updateBtn.click();

    // Panel closes
    await expect(page.locator('text=Plan Shared').first()).toBeVisible({ timeout: 8_000 });

    // Re-open plan summary to verify the report link persisted
    await leadRow.locator('button.w-8').click();
    await page.getByRole('button', { name: /View Payment Plan/i }).click();
    await expect(leadRow.getByRole('link', { name: /View Rental Index Report/i })).toBeVisible({ timeout: 5_000 });
  });

  // ── Test 5: API — rentalIndexReportUrl persisted in JSONB ─────────────────

  test('5. API — paymentPlan JSONB contains rentalIndexReportUrl after save', async ({ request }) => {
    const leads = await request.get(`${BACKEND}/leads`, { headers: auth(rpToken) });
    expect(leads.ok()).toBeTruthy();
    const list = (await leads.json()) as Array<{
      id: number;
      paymentPlan: { rentalIndexReportUrl?: string } | null;
    }>;
    const lead = list.find(l => l.id === leadId);
    expect(lead, `lead ${leadId} not found in list`).toBeTruthy();
    expect(lead?.paymentPlan?.rentalIndexReportUrl, 'rentalIndexReportUrl should be persisted').toBeTruthy();
    expect(lead?.paymentPlan?.rentalIndexReportUrl).toContain('rental_index_report');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  test.afterAll(() => {
    for (const f of [testPdf, testPdf2]) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });
});
