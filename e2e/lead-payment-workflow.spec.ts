/**
 * Playwright E2E — Lead payment workflow (sprint-02f)
 *
 * Tests the full new lead pipeline from viewing completion through to contract
 * issuance. All API calls are made directly to the NestJS backend (port 3001);
 * UI checks hit the Next.js frontend (port 3000).
 *
 * Pipeline under test:
 *   viewing_scheduled → [RP marks visited] →
 *   documents_collection → [RP issues payment plan] →
 *   payment_plan_shared → [tenant confirms cheques ready] →
 *   cheques_submitted → [RP adds + confirms cheques] →
 *   cheques_collected → [RP issues contract] → contract issued
 *
 * Guard tests verify that stages cannot be skipped.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const SUPER_ADMIN_EMAIL = 'superadmin@upnow.ae';
const SUPER_ADMIN_PASSWORD = 'ChangeMe2026!';

const TS = Date.now();
const RP_EMAIL = `rp.payflow.${TS}@upnow.ae`;
const TENANT_EMAIL = `tenant.payflow.${TS}@upnow.ae`;
const PASSWORD = 'Test1234!';

async function loginApi(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${BACKEND}/auth/login`, { data: { email, password } });
  expect(res.ok(), `Login failed for ${email}: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe.serial('Lead payment-plan workflow — sprint-02f', () => {
  let adminToken = '';
  let rpToken = '';
  let tenantToken = '';

  let rpProfileId = 0;
  let tenantProfileId = 0;
  let propertyId = 0;
  let unitId = 0;
  let leadId = 0;
  let viewingId = 0;

  // ─── Setup: register actors + listing ───────────────────────────────────

  test('1. register RP, tenant, create property, unit, publish listing', async ({ request }) => {
    // RP
    const rpReg = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: { email: RP_EMAIL, password: PASSWORD, phone: '+971501234567' },
    });
    expect(rpReg.status()).toBe(201);
    rpToken = ((await rpReg.json()) as { access_token: string }).access_token;

    const rpMe = await request.get(`${BACKEND}/profiles/rental-provider/me`, {
      headers: auth(rpToken),
    });
    rpProfileId = ((await rpMe.json()) as { profile: { id: number } }).profile.id;

    // Admin approves RP compliance
    adminToken = await loginApi(request, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
    const approve = await request.patch(
      `${BACKEND}/profiles/rental-provider/${rpProfileId}/compliance`,
      { headers: auth(adminToken), data: { complianceStatus: 'compliant', complianceNotes: 'Auto-approved for test' } },
    );
    expect(approve.ok(), `Compliance approve: ${approve.status()}`).toBeTruthy();

    // Property
    const propRes = await request.post(`${BACKEND}/properties`, {
      headers: auth(rpToken),
      data: {
        buildingName: `PayFlow Tower ${TS}`,
        fullAddress: 'Downtown Dubai, UAE',
        spaceCategory: 'residential',
        numberOfFloors: '15',
      },
    });
    expect(propRes.status()).toBe(201);
    propertyId = ((await propRes.json()) as { id: number }).id;

    // Unit
    const unitRes = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `PF-${TS}`,
        unitName: `PayFlow Apt ${TS}`,
        unitType: 'apartment',
        floor: '5',
        bedrooms: 2,
        bathrooms: 1,
        rentalPrice: 8500000,
        availability: 'available',
      },
    });
    expect(unitRes.status()).toBe(201);
    unitId = ((await unitRes.json()) as { id: number }).id;

    // Publish via toggle (backward-compat path)
    const toggle = await request.patch(
      `${BACKEND}/properties/${propertyId}/units/${unitId}/toggle-listing`,
      { headers: auth(rpToken) },
    );
    expect(toggle.ok(), `Toggle listing: ${toggle.status()}`).toBeTruthy();
    const toggled = (await toggle.json()) as { isListed: boolean };
    expect(toggled.isListed).toBe(true);

    // Tenant
    const tenantReg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: TENANT_EMAIL, password: PASSWORD, phone: '+971509876543' },
    });
    expect(tenantReg.status()).toBe(201);
    tenantToken = ((await tenantReg.json()) as { access_token: string }).access_token;
  });

  // ─── Step 1: Tenant books viewing with preferred cheque count ────────────

  test('2. tenant books viewing with preferredChequeCount', async ({ request }) => {
    const booking = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(tenantToken),
      data: {
        unitId,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        notes: 'Looking for a quiet floor',
        desiredMoveIn: '2026-08-01',
        occupantsAdults: 2,
        occupantsChildren: 0,
        preferredChequeCount: 4,
      },
    });
    expect(booking.status()).toBe(201);
    const body = (await booking.json()) as {
      lead: { id: number; stage: string; convertedTenantId: number };
      viewing: { id: number; status: string; preferredChequeCount: number | null };
    };

    leadId = body.lead.id;
    viewingId = body.viewing.id;
    tenantProfileId = body.lead.convertedTenantId;

    expect(body.lead.stage).toBe('viewing_scheduled');
    expect(body.viewing.status).toBe('scheduled');
    expect(body.viewing.preferredChequeCount).toBe(4);
  });

  // ─── Guard: can't issue payment plan before viewing completed ────────────

  test('3. guard — cannot issue payment plan at viewing_scheduled stage', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/issue-payment-plan`, {
      headers: auth(rpToken),
      data: {
        chequeCount: 4,
        totalAmountFils: 8500000,
        items: [{ index: 1, amountFils: 8500000, dueDate: '2026-08-01' }],
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  // ─── Step 2: RP marks viewing completed → stage → documents_collection ───

  test('4. RP marks viewing completed → stage becomes documents_collection', async ({ request }) => {
    const update = await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, {
      headers: auth(rpToken),
      data: { status: 'completed', outcome: 'Very interested, wants 4-cheque plan' },
    });
    expect(update.ok(), `Mark visited: ${update.status()}`).toBeTruthy();

    // Verify lead stage via RP list endpoint
    const leads = await request.get(`${BACKEND}/leads`, { headers: auth(rpToken) });
    expect(leads.ok()).toBeTruthy();
    const list = (await leads.json()) as Array<{ id: number; stage: string }>;
    const lead = list.find(l => l.id === leadId);
    expect(lead?.stage).toBe('documents_collection');
  });

  // ─── Guard: tenant can't confirm cheques ready before plan is shared ─────

  test('5. guard — tenant cannot confirm cheques ready before payment plan shared', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, {
      headers: auth(tenantToken),
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  // ─── Step 3: RP issues payment plan ──────────────────────────────────────

  test('6. RP issues payment plan → stage becomes payment_plan_shared', async ({ request }) => {
    // Rent: 85,000 AED / 4 installments
    // Cheque structure: bundle(admin+ejari+comm+inst1), deposit, inst2, inst3, inst4
    // Total cheques = 4+1 = 5
    const planRes = await request.patch(`${BACKEND}/leads/${leadId}/issue-payment-plan`, {
      headers: auth(rpToken),
      data: {
        rentFils: 8500000,          // 85,000 AED
        installmentCount: 4,
        adminFeeFils: 500000,       // 5,000 AED
        ejariFils: 215000,          // 2,150 AED
        commissionFils: 425000,     // 4,250 AED
        securityDepositFils: 425000, // 4,250 AED
        dueDates: ['2026-08-01', '2026-08-01', '2026-11-01', '2027-02-01', '2027-05-01'],
        notes: 'Quarterly cheques',
      },
    });
    expect(planRes.ok(), `Issue plan: ${planRes.status()}`).toBeTruthy();
    const planBody = (await planRes.json()) as {
      issued: boolean;
      paymentPlan: {
        chequeCount: number; totalAmountFils: number; rentFils: number;
        installmentCount: number; notes: string; items: unknown[];
      };
    };
    expect(planBody.issued).toBe(true);
    expect(planBody.paymentPlan.chequeCount).toBe(5);            // 4 installments + 1 deposit
    expect(planBody.paymentPlan.installmentCount).toBe(4);
    expect(planBody.paymentPlan.rentFils).toBe(8500000);
    expect(planBody.paymentPlan.totalAmountFils).toBe(8500000 + 500000 + 215000 + 425000 + 425000);
    expect(planBody.paymentPlan.notes).toBe('Quarterly cheques');
    expect(planBody.paymentPlan.items).toHaveLength(5);          // bundle + deposit + 3 installments

    // Verify lead stage
    const leads = await request.get(`${BACKEND}/leads`, { headers: auth(rpToken) });
    const list = (await leads.json()) as Array<{ id: number; stage: string; paymentPlan: unknown }>;
    const lead = list.find(l => l.id === leadId);
    expect(lead?.stage).toBe('payment_plan_shared');
    expect(lead?.paymentPlan).toBeTruthy();
  });

  // ─── Guard: RP cannot add cheques before cheques_submitted ───────────────

  test('7. guard — RP cannot add cheques at payment_plan_shared stage', async ({ request }) => {
    const res = await request.post(`${BACKEND}/leads/${leadId}/cheques`, {
      headers: auth(rpToken),
      data: {
        chequeSerial: '000001',
        bankName: 'Emirates NBD',
        amountFils: 2125000,
        dueDate: '2026-08-01',
      },
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  // ─── Step 4: Tenant confirms cheques ready → cheques_submitted ───────────

  test('8. tenant confirms cheques ready → stage becomes cheques_submitted', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, {
      headers: auth(tenantToken),
    });
    expect(res.ok(), `Cheques ready: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { submitted: boolean };
    expect(body.submitted).toBe(true);

    // Verify stage
    const leads = await request.get(`${BACKEND}/leads`, { headers: auth(rpToken) });
    const list = (await leads.json()) as Array<{ id: number; stage: string }>;
    expect(list.find(l => l.id === leadId)?.stage).toBe('cheques_submitted');
  });

  // ─── Guard: tenant cannot confirm cheques ready twice ────────────────────

  test('9. guard — tenant cannot call cheques-ready twice', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, {
      headers: auth(tenantToken),
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  // ─── Step 5: RP records 4 physical cheques ────────────────────────────────

  test('10. RP records 4 physical cheques', async ({ request }) => {
    const cheques = [
      { serial: 'ENB-000001', bank: 'Emirates NBD', amount: 2125000, date: '2026-08-01' },
      { serial: 'ENB-000002', bank: 'Emirates NBD', amount: 2125000, date: '2026-11-01' },
      { serial: 'ENB-000003', bank: 'Emirates NBD', amount: 2125000, date: '2027-02-01' },
      { serial: 'ENB-000004', bank: 'Emirates NBD', amount: 2125000, date: '2027-05-01' },
    ];

    for (const c of cheques) {
      const add = await request.post(`${BACKEND}/leads/${leadId}/cheques`, {
        headers: auth(rpToken),
        data: {
          chequeSerial: c.serial,
          bankName: c.bank,
          amountFils: c.amount,
          dueDate: c.date,
          notes: 'Physically received',
        },
      });
      expect(add.status()).toBe(201);
      const body = (await add.json()) as { id: number; chequeSerial: string; status: string };
      expect(body.chequeSerial).toBe(c.serial);
      expect(body.status).toBe('pending');
    }

    // List and verify count
    const list = await request.get(`${BACKEND}/leads/${leadId}/cheques`, {
      headers: auth(rpToken),
    });
    expect(list.ok()).toBeTruthy();
    const chequeList = (await list.json()) as Array<{ id: number; chequeSerial: string; bankName: string }>;
    expect(chequeList).toHaveLength(4);
    expect(chequeList[0].bankName).toBe('Emirates NBD');
  });

  // ─── Guard: confirm collected fails without cheques ──────────────────────
  // (already have cheques so just verify stage guard from other state)

  // ─── Step 6: RP confirms all cheques collected → cheques_collected ────────

  test('11. RP confirms cheques collected → stage becomes cheques_collected', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/confirm-cheques-collected`, {
      headers: auth(rpToken),
    });
    expect(res.ok(), `Confirm collected: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as { confirmed: boolean };
    expect(body.confirmed).toBe(true);

    // Verify stage
    const leads = await request.get(`${BACKEND}/leads`, { headers: auth(rpToken) });
    const list = (await leads.json()) as Array<{ id: number; stage: string }>;
    expect(list.find(l => l.id === leadId)?.stage).toBe('cheques_collected');
  });

  // ─── Guard: cannot confirm collected twice (wrong stage) ─────────────────

  test('12. guard — cannot confirm cheques collected twice', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/confirm-cheques-collected`, {
      headers: auth(rpToken),
    });
    expect(res.ok()).toBe(false);
    expect(res.status()).toBe(400);
  });

  // ─── Step 7: RP issues contract ──────────────────────────────────────────

  test('13. RP creates and issues contract', async ({ request }) => {
    const create = await request.post(`${BACKEND}/contracts`, {
      headers: auth(rpToken),
      data: {
        unitId,
        tenantId: tenantProfileId,
        contractStartDate: '2026-08-01',
        contractEndDate: '2027-07-31',
        annualRent: 8500000,
        securityDepositAmount: 500000,
        numberOfInstallments: 4,
        modeOfPayment: 'cheque',
        adminFee: 5000,
        ejariFee: 220,
        notes: `Payment-plan workflow test — lead ${leadId}`,
      },
    });
    expect(create.status()).toBe(201);
    const contractId = ((await create.json()) as { id: number }).id;

    const issue = await request.patch(`${BACKEND}/contracts/${contractId}/issue`, {
      headers: auth(rpToken),
    });
    expect(issue.ok(), `Issue contract: ${issue.status()}`).toBeTruthy();
    const issued = (await issue.json()) as { id: number; status: string; contractSent: boolean };
    expect(issued.status).toBe('issued');
    expect(issued.contractSent).toBe(true);

    // Tenant can see the contract
    const tenantContracts = await request.get(`${BACKEND}/contracts/tenant`, {
      headers: auth(tenantToken),
    });
    expect(tenantContracts.ok()).toBeTruthy();
    const contracts = (await tenantContracts.json()) as Array<{ id: number; status: string }>;
    const matched = contracts.find(c => c.id === contractId);
    expect(matched?.status).toBe('issued');
  });

  // ─── UI tests use a fresh lead so state is predictable ─────────────────
  // We create a second viewing for the same unit+tenant, advance it to
  // documents_collection via API, then drive the remaining steps through
  // the browser so we exercise the actual UI components.

  let uiLeadId = 0;
  let uiViewingId = 0;

  async function rpCookie(page: import('@playwright/test').Page) {
    const res = await page.request.post(`${BACKEND}/auth/login`, {
      data: { email: RP_EMAIL, password: PASSWORD },
    });
    const { access_token } = (await res.json()) as { access_token: string };
    await page.context().addCookies([{ name: 'upnow_token', value: access_token, domain: 'localhost', path: '/' }]);
  }

  async function tenantCookie(page: import('@playwright/test').Page) {
    const res = await page.request.post(`${BACKEND}/auth/login`, {
      data: { email: TENANT_EMAIL, password: PASSWORD },
    });
    const { access_token } = (await res.json()) as { access_token: string };
    await page.context().addCookies([{ name: 'upnow_token', value: access_token, domain: 'localhost', path: '/' }]);
  }

  // ─── UI Test A: RP issues payment plan through the form ─────────────────

  test('14. UI — RP fills and submits payment plan form; badge flips to "Plan Shared"', async ({ request, page }) => {
    // Set up a fresh lead at documents_collection via API
    const booking = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(tenantToken),
      data: {
        unitId,
        scheduledAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        notes: 'UI test viewing',
        preferredChequeCount: 2,
      },
    });
    expect(booking.status()).toBe(201);
    const bBody = (await booking.json()) as { lead: { id: number }; viewing: { id: number } };
    uiLeadId = bBody.lead.id;
    uiViewingId = bBody.viewing.id;

    // Advance to documents_collection via API
    await request.patch(`${BACKEND}/leads/viewings/${uiViewingId}/status`, {
      headers: auth(rpToken),
      data: { status: 'completed', outcome: 'UI test visit' },
    });

    // ── Browser: RP logs in and opens leads page ──
    await rpCookie(page);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Leads');

    // Find the lead row (stage pill = "Docs Collection")
    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Docs Collection' }).first();
    await expect(leadRow).toBeVisible({ timeout: 8_000 });

    // Click "Issue Payment Plan" primary button
    const issuePlanBtn = leadRow.getByRole('button', { name: /Issue Payment Plan/i });
    await expect(issuePlanBtn).toBeVisible();
    await issuePlanBtn.click();

    // Payment plan form should open — fill Annual Rent
    const rentInput = page.getByPlaceholder(/e\.g\. 85000/i);
    await expect(rentInput).toBeVisible();
    await rentInput.fill('85000');

    // Fill fees
    await page.locator('input[placeholder="0"]').nth(0).fill('5000');   // Admin Fee
    await page.locator('input[placeholder="0"]').nth(1).fill('2150');   // Ejari
    await page.locator('input[placeholder="0"]').nth(2).fill('4250');   // Commission
    await page.locator('input[placeholder="0"]').nth(3).fill('4250');   // Security Deposit

    // Wait for cheque schedule to render (installmentCount+1 date inputs appear)
    await page.waitForFunction(() => document.querySelectorAll('input[type="date"]').length >= 2);
    const dateInputs = page.locator('input[type="date"]');
    const dateCount = await dateInputs.count();
    for (let i = 0; i < dateCount; i++) {
      const dates = ['2026-08-01', '2026-08-01', '2026-11-01', '2027-02-01', '2027-05-01'];
      await dateInputs.nth(i).fill(dates[i] ?? '2026-08-01');
    }

    // Submit — use .last() since the trigger button and submit button share the same label
    const submitBtn = page.getByRole('button', { name: /^Issue Payment Plan$/i }).last();
    await submitBtn.click();

    // Panel should close; badge should flip to "Plan Shared" (scoping to stale
    // leadRow would fail because the hasText filter no longer matches after stage change)
    await expect(page.locator('text=Plan Shared').first()).toBeVisible({ timeout: 6_000 });
    await expect(rentInput).not.toBeVisible();
  });

  // ─── UI Test B: Tenant sees payment plan + confirms cheques ready ────────

  test('15. UI — tenant sees payment plan schedule and clicks "Confirm Cheques Ready"', async ({ page }) => {
    await tenantCookie(page);
    await page.goto('/dashboard/customer/spaces', { waitUntil: 'networkidle' });

    // Spaces page should load — there will be at least one viewing row for the PayFlow unit
    await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 10_000 });

    // Click on the viewing row to open the detail view.
    // The list row contains the PayFlow unit name from test 1 (unique TS-stamped).
    // Fall back to clicking the first card whose text includes the RP's building name fragment.
    const spaceCard = page.locator('[class*="cursor-pointer"]').filter({ hasText: /PayFlow/i }).first();
    await expect(spaceCard).toBeVisible({ timeout: 10_000 });
    await spaceCard.click();

    // Detail view should open — the TenancyJourneyPanel step 4 shows "Payment Plan & Cheques"
    await expect(page.locator('text=Payment Plan & Cheques').first()).toBeVisible({ timeout: 8_000 });

    // Payment plan schedule heading should appear
    await expect(page.locator('text=Payment Schedule').first()).toBeVisible({ timeout: 6_000 });

    // "Confirm Cheques Ready" button
    const confirmBtn = page.getByRole('button', { name: /Confirm Cheques Ready/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Button should disappear once tenant's stage advances to cheques_submitted
    await expect(confirmBtn).not.toBeVisible({ timeout: 6_000 });
  });

  // ─── UI Test C: RP records a cheque and confirms collection ─────────────

  test('16. UI — RP adds a cheque via the panel then confirms all collected', async ({ page }) => {
    await rpCookie(page);
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });

    // Lead should now be "Cheques Ready"
    const leadRow = page.locator('[class*="rounded-xl"]').filter({ hasText: 'Cheques Ready' }).first();
    await expect(leadRow).toBeVisible({ timeout: 8_000 });

    // Click "Record Cheques" primary button
    const recordBtn = leadRow.getByRole('button', { name: /Record Cheques/i });
    await expect(recordBtn).toBeVisible();
    await recordBtn.click();

    // Cheque entry form should appear
    await expect(page.getByPlaceholder(/Cheque Serial No/i)).toBeVisible();

    // Fill in the cheque details
    await page.getByPlaceholder(/Cheque Serial No/i).fill('ENB-UI-001');
    await page.getByPlaceholder(/Bank Name/i).fill('Emirates NBD');
    await page.getByPlaceholder(/Amount \(AED\)/i).fill('42500');
    const dueDateInput = page.locator('input[type="date"]').last();
    await dueDateInput.fill('2026-08-01');

    // Add the cheque
    await page.getByRole('button', { name: /^Add Cheque$/i }).click();

    // Cheque should appear in the list
    await expect(page.locator('text=ENB-UI-001')).toBeVisible({ timeout: 4_000 });

    // Confirm all collected
    const confirmBtn = page.getByRole('button', { name: /Confirm All Collected/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Panel should close and stage should flip to "Cheques Collected"
    await expect(page.locator('text=Cheques Collected').first()).toBeVisible({ timeout: 6_000 });
    await expect(page.getByPlaceholder(/Cheque Serial No/i)).not.toBeVisible();
  });
});
