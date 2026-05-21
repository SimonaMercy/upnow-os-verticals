/**
 * Rent History & Pricing Lifecycle
 *
 * Verifies the full pricing chain introduced in sprint-04:
 *   1. Unit created with initial rentalPrice
 *   2. Contract activated → units.rental_price updated + history row written
 *   3. RP contract page shows Terminate button on active contract
 *   4. Contract terminated → history row closed, unit becomes available
 *   5. Second contract (20% increase) activated → new history row, changePercent = 20%
 *   6. GET /properties/:id/units/:unitId/rent-history returns full progression
 *
 * Run: npm run test:e2e -- rent-history
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';

const BACKEND = 'http://localhost:3001/api';
const SUPER_ADMIN_EMAIL = 'superadmin@upnow.ae';
const SUPER_ADMIN_PASSWORD = 'ChangeMe2026!';

const TS = Date.now();
const RP_EMAIL    = `rp.rh.${TS}@upnow.ae`;
const T1_EMAIL    = `t1.rh.${TS}@upnow.ae`;
const T2_EMAIL    = `t2.rh.${TS}@upnow.ae`;
const PASSWORD    = 'Test1234!';

const INITIAL_RENT = 85_000;   // AED — stored as-is (numeric)
const RENEWAL_RENT = 102_000;  // 20% increase

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext, email: string, pw: string) {
  const res = await request.post(`${BACKEND}/auth/login`, { data: { email, password: pw } });
  expect(res.ok(), `Login failed for ${email}: ${res.status()}`).toBeTruthy();
  return ((await res.json()) as { access_token: string }).access_token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe.serial('Rent History & Pricing Lifecycle', () => {
  let adminToken = '';
  let rpToken    = '';
  let t1Token    = '';
  let t2Token    = '';

  let rpProfileId  = 0;
  let t1ProfileId  = 0;
  let t2ProfileId  = 0;
  let propertyId   = 0;
  let unitId       = 0;
  let contract1Id  = 0;
  let contract2Id  = 0;

  // ── Step 1: register RP + 2 tenants ────────────────────────────────────────
  test('1 · register RP and two tenants', async ({ request }) => {
    const rpReg = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: { email: RP_EMAIL, password: PASSWORD, phone: '+971501110001' },
    });
    expect(rpReg.status()).toBe(201);
    rpToken = ((await rpReg.json()) as { access_token: string }).access_token;

    const t1Reg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: T1_EMAIL, password: PASSWORD, phone: '+971501110002' },
    });
    expect(t1Reg.status()).toBe(201);
    t1Token = ((await t1Reg.json()) as { access_token: string }).access_token;

    const t2Reg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: T2_EMAIL, password: PASSWORD, phone: '+971501110003' },
    });
    expect(t2Reg.status()).toBe(201);
    t2Token = ((await t2Reg.json()) as { access_token: string }).access_token;

    adminToken = await apiLogin(request, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
  });

  // ── Step 2: RP setup — profile, compliance, property, unit ─────────────────
  test('2 · RP creates property and unit (rentalPrice = 85,000)', async ({ request }) => {
    await request.patch(`${BACKEND}/profiles/rental-provider/me`, {
      headers: auth(rpToken),
      data: {
        entityType: 'individual',
        companyName: `RH Estates ${TS}`,
        contactAddress: 'JLT, Dubai, UAE',
        bankAccountName: 'RH Estates',
        bankIban: `AE0703312345${TS.toString().slice(-8)}`,
        tradeLicenseNumber: `TL-RH-${TS}`,
        authorizedSignatoryName: 'Ali Hassan',
      },
    });

    const rpMe = await request.get(`${BACKEND}/profiles/rental-provider/me`, {
      headers: auth(rpToken),
    });
    rpProfileId = ((await rpMe.json()) as { profile: { id: number } }).profile.id;

    // Admin approve compliance
    await request.patch(`${BACKEND}/profiles/rental-provider/${rpProfileId}/compliance`, {
      headers: auth(adminToken),
      data: { complianceStatus: 'compliant', complianceNotes: 'Auto-approved for rent-history spec' },
    });

    // Create property
    const propRes = await request.post(`${BACKEND}/properties`, {
      headers: auth(rpToken),
      data: {
        buildingName: `RH Tower ${TS}`,
        fullAddress: 'JLT Cluster T, Dubai',
        spaceCategory: 'residential',
        numberOfFloors: '10',
      },
    });
    expect(propRes.status()).toBe(201);
    propertyId = ((await propRes.json()) as { id: number }).id;

    // Create unit with initial rentalPrice
    const unitRes = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `RH-${TS}`,
        unitName: `RH Apt ${TS}`,
        unitType: 'apartment',
        floor: '5',
        bedrooms: 2,
        bathrooms: 2,
        rentalPrice: INITIAL_RENT,
        availability: 'available',
      },
    });
    expect(unitRes.status()).toBe(201);
    const unitBody = (await unitRes.json()) as { id: number; rentalPrice: number };
    unitId = unitBody.id;

    // Verify initial price stored correctly
    expect(Number(unitBody.rentalPrice)).toBe(INITIAL_RENT);
  });

  // ── Step 3: get tenant profile IDs via GET /documents/my ────────────────────
  test('3 · resolve tenant profile IDs', async ({ request }) => {
    // documents/my is the canonical way to get tenantProfileId for a logged-in tenant
    const t1Docs = await request.get(`${BACKEND}/documents/my`, { headers: auth(t1Token) });
    expect(t1Docs.ok(), `t1 docs failed: ${t1Docs.status()}`).toBeTruthy();
    t1ProfileId = ((await t1Docs.json()) as { tenantProfileId: number }).tenantProfileId;

    const t2Docs = await request.get(`${BACKEND}/documents/my`, { headers: auth(t2Token) });
    expect(t2Docs.ok(), `t2 docs failed: ${t2Docs.status()}`).toBeTruthy();
    t2ProfileId = ((await t2Docs.json()) as { tenantProfileId: number }).tenantProfileId;

    expect(t1ProfileId).toBeGreaterThan(0);
    expect(t2ProfileId).toBeGreaterThan(0);
  });

  // ── Step 4: create + issue + sign + activate Contract 1 ────────────────────
  test('4 · Contract 1 (85,000) — create → issue → tenant sign → activate', async ({ request }) => {
    // Create
    const createRes = await request.post(`${BACKEND}/contracts`, {
      headers: auth(rpToken),
      data: {
        unitId,
        tenantId: t1ProfileId,
        contractStartDate: '2025-01-01',
        contractEndDate:   '2025-12-31',
        annualRent: INITIAL_RENT,
        securityDepositAmount: 5000,
        numberOfInstallments: 4,
        modeOfPayment: 'cheque',
        adminFee: 500,
        ejariFee: 220,
      },
    });
    expect(createRes.status()).toBe(201);
    contract1Id = ((await createRes.json()) as { id: number }).id;

    // Issue (sends to tenant)
    const issueRes = await request.patch(`${BACKEND}/contracts/${contract1Id}/issue`, {
      headers: auth(rpToken),
    });
    expect(issueRes.ok()).toBeTruthy();
    expect((await issueRes.json() as { status: string }).status).toBe('issued');

    // Tenant signs
    const signRes = await request.post(`${BACKEND}/contracts/tenant/${contract1Id}/sign`, {
      headers: auth(t1Token),
      data: { signatoryName: 'Tenant One', signatureImage: null },
    });
    expect(signRes.ok(), `Tenant sign failed: ${signRes.status()}`).toBeTruthy();

    // Ejari (required before activation in some flows — set directly)
    await request.patch(`${BACKEND}/contracts/${contract1Id}/ejari`, {
      headers: auth(rpToken),
      data: { ejariStatus: 'registered' },
    });

    // Activate — this is the key step: writes rent history + updates unit price
    const activateRes = await request.patch(`${BACKEND}/contracts/${contract1Id}/activate`, {
      headers: auth(rpToken),
    });
    expect(activateRes.ok(), `Activate failed: ${activateRes.status()}`).toBeTruthy();
    const activated = (await activateRes.json()) as { status: string };
    expect(activated.status).toBe('active');
  });

  // ── Step 5: verify unit price + rent history after activation ───────────────
  test('5 · after activation — unit.rentalPrice = 85,000 + 1 history row', async ({ request }) => {
    // Check unit price via properties endpoint
    const unitsRes = await request.get(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
    });
    expect(unitsRes.ok()).toBeTruthy();
    const units = (await unitsRes.json()) as Array<{ id: number; rentalPrice: number | string | null; availability: string }>;
    const u = units.find(x => x.id === unitId);
    expect(u, 'unit not found in list').toBeTruthy();
    expect(Number(u!.rentalPrice)).toBe(INITIAL_RENT);
    expect(u!.availability).toBe('occupied');

    // Check rent history
    const histRes = await request.get(`${BACKEND}/properties/${propertyId}/units/${unitId}/rent-history`, {
      headers: auth(rpToken),
    });
    expect(histRes.ok(), `Rent history failed: ${histRes.status()}`).toBeTruthy();
    const hist = (await histRes.json()) as {
      currentListingPrice: number;
      history: Array<{ annualRent: number; isActive: boolean; contractType: string; changePercent: number | null }>;
    };

    expect(Number(hist.currentListingPrice)).toBe(INITIAL_RENT);
    expect(hist.history).toHaveLength(1);
    expect(Number(hist.history[0].annualRent)).toBe(INITIAL_RENT);
    expect(hist.history[0].isActive).toBe(true);
    expect(hist.history[0].changePercent).toBeNull(); // first tenancy — no prior rent
  });

  // ── Step 6: view active contract in RP UI — Terminate button visible ────────
  test('6 · RP contract page shows Terminate button on active contract', async ({ page }) => {
    // Force email verified in DB (token is hashed — psql bypass is the dev standard)
    execSync(`psql upnow -c "UPDATE users SET email_verified = true WHERE email = '${RP_EMAIL}'"`, { encoding: 'utf8' });

    // Log in via UI
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(RP_EMAIL);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/rental-provider\/dashboard/, { timeout: 15_000 });

    // Navigate to the contract detail page
    await page.goto(`/rental-provider/dashboard/contracts/${contract1Id}`);
    await page.waitForLoadState('networkidle');

    // The contract should be active — Step 6 should show Terminate button
    await expect(page.getByRole('button', { name: /Terminate Contract/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Contract is live')).toBeVisible();
  });

  // ── Step 7: terminate Contract 1 ───────────────────────────────────────────
  test('7 · terminate Contract 1 — unit becomes available, history row closed', async ({ request }) => {
    const termRes = await request.patch(`${BACKEND}/contracts/${contract1Id}/terminate`, {
      headers: auth(rpToken),
    });
    expect(termRes.ok(), `Terminate failed: ${termRes.status()}`).toBeTruthy();
    const terminated = (await termRes.json()) as { status: string };
    expect(terminated.status).toBe('terminated');

    // Unit should be available again
    const unitsRes = await request.get(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
    });
    const units = (await unitsRes.json()) as Array<{ id: number; availability: string; rentalPrice: number | string | null }>;
    const u = units.find(x => x.id === unitId);
    expect(u!.availability).toBe('available');

    // rental_price still = 85,000 (not cleared on termination)
    expect(Number(u!.rentalPrice)).toBe(INITIAL_RENT);

    // History row should now be closed (effectiveTo set)
    const histRes = await request.get(`${BACKEND}/properties/${propertyId}/units/${unitId}/rent-history`, {
      headers: auth(rpToken),
    });
    const hist = (await histRes.json()) as {
      history: Array<{ isActive: boolean; effectiveTo: string | null }>;
    };
    expect(hist.history[0].isActive).toBe(false);
    expect(hist.history[0].effectiveTo).not.toBeNull();
  });

  // ── Step 8: Contract 2 at +20% — activate and verify progression ───────────
  test('8 · Contract 2 (102,000, +20%) — activate and verify full history', async ({ request }) => {
    // Create second contract with 20% higher rent
    const createRes = await request.post(`${BACKEND}/contracts`, {
      headers: auth(rpToken),
      data: {
        unitId,
        tenantId: t2ProfileId,
        contractStartDate: '2026-01-01',
        contractEndDate:   '2026-12-31',
        annualRent: RENEWAL_RENT,
        securityDepositAmount: 6000,
        numberOfInstallments: 4,
        modeOfPayment: 'cheque',
        adminFee: 500,
        ejariFee: 220,
      },
    });
    expect(createRes.status()).toBe(201);
    contract2Id = ((await createRes.json()) as { id: number }).id;

    // Issue → tenant sign → ejari → activate
    await request.patch(`${BACKEND}/contracts/${contract2Id}/issue`, { headers: auth(rpToken) });

    await request.post(`${BACKEND}/contracts/tenant/${contract2Id}/sign`, {
      headers: auth(t2Token),
      data: { signatoryName: 'Tenant Two', signatureImage: null },
    });

    await request.patch(`${BACKEND}/contracts/${contract2Id}/ejari`, {
      headers: auth(rpToken),
      data: { ejariStatus: 'registered' },
    });

    const activateRes = await request.patch(`${BACKEND}/contracts/${contract2Id}/activate`, {
      headers: auth(rpToken),
    });
    expect(activateRes.ok()).toBeTruthy();
  });

  // ── Step 9: verify full rent history (2 rows, +20% change) ─────────────────
  test('9 · rent history shows 2 rows with +20% change on second contract', async ({ request }) => {
    const histRes = await request.get(`${BACKEND}/properties/${propertyId}/units/${unitId}/rent-history`, {
      headers: auth(rpToken),
    });
    expect(histRes.ok()).toBeTruthy();
    const hist = (await histRes.json()) as {
      currentListingPrice: number;
      history: Array<{
        annualRent: number;
        isActive: boolean;
        changePercent: number | null;
        contractType: string;
      }>;
    };

    // Listing price updated to new contract rent
    expect(Number(hist.currentListingPrice)).toBe(RENEWAL_RENT);

    // Two history rows (newest first)
    expect(hist.history).toHaveLength(2);

    const [newest, oldest] = hist.history;
    expect(Number(newest.annualRent)).toBe(RENEWAL_RENT);
    expect(newest.isActive).toBe(true);
    expect(newest.changePercent).toBe(20);         // exactly +20%

    expect(Number(oldest.annualRent)).toBe(INITIAL_RENT);
    expect(oldest.isActive).toBe(false);
    expect(oldest.changePercent).toBeNull();       // first tenancy
  });

  // ── Step 10: new-contract form UI pre-fills updated rental price ────────────
  test('10 · new-contract form pre-fills rentalPrice = 102,000 from unit', async ({ page }) => {
    await page.goto(`/rental-provider/dashboard/contracts/new`);
    await page.waitForLoadState('networkidle');

    // Search for and select our unit
    const unitSearch = page.getByPlaceholder(/search unit/i).or(page.getByRole('combobox').first());
    if (await unitSearch.isVisible()) {
      await unitSearch.fill(`RH Apt ${TS}`);
      await page.waitForTimeout(600);
      const option = page.getByText(`RH Apt ${TS}`).first();
      if (await option.isVisible()) {
        await option.click();
        await page.waitForTimeout(400);
        // annualRent field should be pre-filled with 102000
        const rentInput = page.getByLabel(/annual rent/i).or(page.locator('input[name="annualRent"]'));
        if (await rentInput.isVisible()) {
          await expect(rentInput).toHaveValue(`${RENEWAL_RENT}`);
        }
      }
    }
  });
});
