/**
 * Move-In Journey — End-to-end tests (backend API + frontend UI)
 *
 * Covers the full move-in workflow:
 *   1. API: RP submits move-in inspection
 *   2. API: itemAttachments stripped from tenant-facing inspection view
 *   3. API: tenant signs inspection
 *   4. API: RP counter-signs → contract auto-activates
 *   5. API: duplicate-sign guards
 *   6. UI: tenant inspection page shows "awaiting counter-signature" banner
 *   7. UI: RP contract detail page shows inspection signing progress indicators
 *   8. UI: Step 5 (Active Tenancy) shows "Preview Rental Agreement" + "Preview Receipt" buttons
 *
 * Prerequisites:
 *   - Backend running on http://localhost:3001
 *   - Frontend running on http://localhost:3000
 *   - Seeded accounts: rp.test@upnow.ae (RP, approved), tenant.test@upnow.ae (tenant)
 *   - rp.test@upnow.ae owns property id=3, units 69–78
 *   - tenant.test@upnow.ae customer profile id=2
 *
 * Run: npm run test:e2e -- move-in-journey
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';

const RP_EMAIL     = 'rp.test@upnow.ae';
const TENANT_EMAIL = 'tenant.test@upnow.ae';

// Units owned by rp.test@upnow.ae (property 3). Each test group uses a separate
// unit so parallel runs don't trample each other.
const UNIT_API = 69;   // Group 1 — backend API tests
const UNIT_UI_T = 70;  // Group 2 — frontend tenant UI
const UNIT_UI_RP = 71; // Group 3 — frontend RP detail UI

const SEED_TENANT_ID = 2; // customer profile id for tenant.test@upnow.ae

// Minimal base64 PNG — satisfies the signatureImage validator without S3 upload.
const SIG_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const step1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(step1.ok(), `OTP step-1 failed for ${email}: ${step1.status()}`).toBeTruthy();
  const body1 = await step1.json() as { devOtp?: string };
  expect(body1.devOtp, `devOtp missing — is NODE_ENV=production?`).toBeTruthy();

  const step2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: body1.devOtp },
  });
  expect(step2.ok(), `OTP step-2 failed: ${step2.status()}`).toBeTruthy();
  const body2 = await step2.json() as { access_token?: string };
  expect(body2.access_token).toBeTruthy();
  return body2.access_token as string;
}

function authHdr(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Push a contract through: issued → both signed → ejari_registered.
 * This is the pre-condition before the move-in inspection flow can start.
 * Does NOT activate — activation is triggered by the RP counter-sign.
 */
async function setupContractPreMoveIn(
  request: APIRequestContext,
  rpToken: string,
  tenantToken: string,
  unitId: number,
  tenantProfileId: number = SEED_TENANT_ID,
): Promise<number> {
  const today     = new Date().toISOString().split('T')[0];
  const nextYear  = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0];

  const createRes = await request.post(`${BACKEND}/contracts`, {
    headers: authHdr(rpToken),
    data: {
      unitId,
      tenantId: tenantProfileId,
      contractStartDate: today,
      contractEndDate: nextYear,
      annualRent: 60000,
      numberOfInstallments: 2,
      modeOfPayment: 'cheque',
      securityDepositAmount: 5000,
    },
  });
  expect(createRes.ok(), `Contract creation failed: ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
  const contractId = ((await createRes.json()) as { id: number }).id;

  // Issue
  const issueRes = await request.patch(`${BACKEND}/contracts/${contractId}/issue`, {
    headers: authHdr(rpToken),
  });
  expect(issueRes.ok(), `Issue failed: ${issueRes.status()}`).toBeTruthy();

  // RP signs the contract (landlord role)
  const rpSignRes = await request.post(`${BACKEND}/contracts/${contractId}/sign`, {
    headers: authHdr(rpToken),
    data: { role: 'landlord', signatureImage: SIG_PNG, signatoryName: 'Test RP', method: 'online' },
  });
  expect(rpSignRes.ok(), `RP sign failed: ${rpSignRes.status()}`).toBeTruthy();

  // Tenant signs the contract
  const tSignRes = await request.post(`${BACKEND}/contracts/tenant/${contractId}/sign`, {
    headers: authHdr(tenantToken),
    data: { role: 'tenant', signatureImage: SIG_PNG, signatoryName: 'Test Tenant', method: 'online' },
  });
  expect(tSignRes.ok(), `Tenant sign failed: ${tSignRes.status()}`).toBeTruthy();

  // Register Ejari — in the new flow this does NOT auto-activate; activation
  // happens only when the RP counter-signs the move-in inspection.
  const ejariRes = await request.patch(`${BACKEND}/contracts/${contractId}/ejari`, {
    headers: authHdr(rpToken),
    data: { ejariStatus: 'registered' },
  });
  expect(ejariRes.ok(), `Ejari registration failed: ${ejariRes.status()}`).toBeTruthy();

  const afterEjari = (await ejariRes.json()) as { status: string };
  // Contract must remain 'issued' — not yet active.
  expect(afterEjari.status).toBe('issued');

  return contractId;
}

function buildInspectionData() {
  return {
    type: 'move_in',
    data: {
      reportGeneratedDate: '2026-05-23',
      inspectorName: 'Test Inspector',
      moveInDate: new Date().toISOString().split('T')[0],
      generalNotes: 'All in good condition.',
      photos: [],
      areas: [
        {
          id: 'area-1',
          name: 'Living Room',
          remarks: 'Clean',
          items: [
            {
              id: 'item-1',
              name: 'Walls',
              isCustom: false,
              inCondition: 'G',
              outCondition: '',
              itemAttachments: [{ id: 'att-1', url: 'http://localhost:3001/test.jpg' }],
            },
            {
              id: 'item-2',
              name: 'Floor',
              isCustom: false,
              inCondition: 'G',
              outCondition: '',
              itemAttachments: [],
            },
          ],
        },
      ],
      tenantSig: null,
      landlordSig: null,
    },
  };
}

// ─── GROUP 1: Backend API — full inspection lifecycle ─────────────────────────

test.describe.serial('Move-In Journey — Backend API', () => {
  let rpToken    = '';
  let tenantToken = '';
  let contractId  = 0;

  test.beforeAll(async ({ request }) => {
    rpToken     = await loginOtp(request, RP_EMAIL);
    tenantToken = await loginOtp(request, TENANT_EMAIL);
    contractId  = await setupContractPreMoveIn(request, rpToken, tenantToken, UNIT_API);
  });

  test('API-1: RP can submit move-in inspection', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/contracts/${contractId}/inspection`, {
      headers: authHdr(rpToken),
      data: buildInspectionData(),
    });
    expect(res.ok(), `Inspection submit failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  });

  test('API-2: RP view includes itemAttachments and rpSubmittedAt', async ({ request }) => {
    const res = await request.get(
      `${BACKEND}/contracts/${contractId}/inspection?type=move_in`,
      { headers: authHdr(rpToken) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as {
      rpSubmittedAt?: string;
      areas?: Array<{ items?: Array<{ itemAttachments?: unknown[] }> }>;
    };
    expect(body.rpSubmittedAt).toBeTruthy();
    const firstItem = body.areas?.[0]?.items?.[0];
    expect(firstItem).toBeDefined();
    expect(Array.isArray(firstItem?.itemAttachments)).toBe(true);
    // The first item has 1 attachment we seeded
    expect((firstItem?.itemAttachments as unknown[]).length).toBeGreaterThan(0);
  });

  test('API-3: Tenant view strips itemAttachments', async ({ request }) => {
    const res = await request.get(
      `${BACKEND}/contracts/tenant/${contractId}/inspection?type=move_in`,
      { headers: authHdr(tenantToken) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { areas?: Array<{ items?: Array<Record<string, unknown>> }> };
    const firstItem = body.areas?.[0]?.items?.[0];
    expect(firstItem).toBeDefined();
    expect(Object.keys(firstItem ?? {}).includes('itemAttachments')).toBe(false);
  });

  test('API-4: Tenant can sign inspection', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/contracts/tenant/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(tenantToken), data: { signatureImage: SIG_PNG } },
    );
    expect(res.ok(), `Tenant sign-inspection failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json() as { signed?: boolean };
    expect(body.signed).toBe(true);
  });

  test('API-5: Duplicate tenant sign is rejected', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/contracts/tenant/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(tenantToken), data: { signatureImage: SIG_PNG } },
    );
    expect(res.status()).toBe(400);
    const body = await res.json() as { message?: string };
    expect(body.message).toMatch(/already signed/i);
  });

  test('API-6: RP counter-sign is blocked when tenant has not yet signed', async ({ request }) => {
    // Separate fresh contract on a spare unit
    const cid2 = await setupContractPreMoveIn(request, rpToken, tenantToken, 72);
    await request.patch(`${BACKEND}/contracts/${cid2}/inspection`, {
      headers: authHdr(rpToken),
      data: buildInspectionData(),
    });

    const res = await request.post(
      `${BACKEND}/contracts/${cid2}/inspection/sign?type=move_in`,
      { headers: authHdr(rpToken), data: { signatureImage: SIG_PNG } },
    );
    expect(res.status()).toBe(400);
    const body = await res.json() as { message?: string };
    expect(body.message).toMatch(/tenant must sign/i);
  });

  test('API-7: RP counter-sign auto-activates the contract', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/contracts/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(rpToken), data: { signatureImage: SIG_PNG } },
    );
    expect(res.ok(), `RP counter-sign failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json() as { signed?: boolean; activated?: boolean };
    expect(body.signed).toBe(true);
    expect(body.activated).toBe(true);
  });

  test('API-8: Contract status is "active" after counter-sign', async ({ request }) => {
    const res = await request.get(`${BACKEND}/contracts/${contractId}`, {
      headers: authHdr(rpToken),
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { status: string };
    expect(body.status).toBe('active');
  });

  test('API-9: Duplicate RP counter-sign is rejected', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/contracts/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(rpToken), data: { signatureImage: SIG_PNG } },
    );
    expect(res.status()).toBe(400);
    const body = await res.json() as { message?: string };
    expect(body.message).toMatch(/already counter-signed/i);
  });

  test('API-10: Inspection has rpCounterSig, rpCounterSignedAt, and inspectionDate set', async ({ request }) => {
    const res = await request.get(
      `${BACKEND}/contracts/${contractId}/inspection?type=move_in`,
      { headers: authHdr(rpToken) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as Record<string, unknown>;
    expect(body.rpCounterSig).toBeTruthy();
    expect(body.rpCounterSignedAt).toBeTruthy();
    expect(body.inspectionDate).toBeTruthy();
  });

  test('API-11: reportGeneratedDate is persisted and returned correctly', async ({ request }) => {
    const res = await request.get(
      `${BACKEND}/contracts/${contractId}/inspection?type=move_in`,
      { headers: authHdr(rpToken) },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { reportGeneratedDate?: string };
    expect(body.reportGeneratedDate).toBe('2026-05-23');
  });
});

/**
 * Inject auth state into the browser context without going through the login UI.
 *
 * Calls the NestJS backend directly to get an OTP + access_token, then sets
 * the upnow_token cookie on the page context so subsequent page.goto() calls
 * are fully authenticated. This is orders of magnitude faster than driving the
 * login form and avoids all React controlled-input / focus-tracking edge cases.
 *
 * Equivalent to the Playwright recommended "storageState" pattern but done
 * inline since each test group needs a fresh token for a specific user.
 */
async function injectAuthCookie(page: Page, email: string) {
  // Step 1: request OTP (backend returns devOtp in non-prod)
  const loginRes = await fetch(`${BACKEND}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const { devOtp } = await loginRes.json() as { devOtp: string };
  expect(devOtp, 'backend must return devOtp in non-prod').toBeTruthy();

  // Step 2: verify OTP → backend returns access_token in the body
  const verifyRes = await fetch(`${BACKEND}/auth/login/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, code: devOtp }),
  });
  const { access_token } = await verifyRes.json() as { access_token: string };
  expect(access_token, 'backend must return access_token on verify').toBeTruthy();

  // Step 3: inject the cookie that the Next.js proxy normally sets
  await page.context().addCookies([{
    name: 'upnow_token',
    value: access_token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Strict',
  }]);
}

// ─── GROUP 2: Frontend — Tenant inspection page ───────────────────────────────

test.describe('Move-In Journey — Frontend: Tenant inspection page', () => {
  let contractId = 0;
  let rpToken    = '';
  let tenantToken = '';

  test.beforeAll(async ({ request }) => {
    rpToken     = await loginOtp(request, RP_EMAIL);
    tenantToken = await loginOtp(request, TENANT_EMAIL);
    contractId  = await setupContractPreMoveIn(request, rpToken, tenantToken, UNIT_UI_T);

    // RP submits inspection so there is data for the tenant to view
    await request.patch(`${BACKEND}/contracts/${contractId}/inspection`, {
      headers: authHdr(rpToken),
      data: buildInspectionData(),
    });
  });

  test('UI-T1: Tenant sees "awaiting counter-signature" banner after signing', async ({ page }) => {
    await injectAuthCookie(page, TENANT_EMAIL);

    await page.goto(`/dashboard/customer/contracts/${contractId}/inspection?type=move_in`);
    await expect(page.locator('h1').filter({ hasText: /inspection/i })).toBeVisible({ timeout: 12_000 });

    // Draw a signature on the canvas
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 50);
      await page.mouse.up();
    }

    const signBtn = page.getByRole('button', { name: /sign inspection/i });
    await expect(signBtn).toBeEnabled({ timeout: 5_000 });
    await signBtn.click();

    // Signed banner
    await expect(page.locator('text=You have signed this inspection')).toBeVisible({ timeout: 10_000 });

    // Awaiting counter-signature banner (new addition from this feature)
    await expect(page.locator('text=/awaiting rental provider counter-signature/i')).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ─── GROUP 3: Frontend — RP contract detail page ─────────────────────────────

test.describe('Move-In Journey — Frontend: RP contract detail page', () => {
  let contractId = 0;
  let rpToken    = '';
  let tenantToken = '';

  test.beforeAll(async ({ request }) => {
    rpToken     = await loginOtp(request, RP_EMAIL);
    tenantToken = await loginOtp(request, TENANT_EMAIL);
    contractId  = await setupContractPreMoveIn(request, rpToken, tenantToken, UNIT_UI_RP);

    // Drive the full inspection signing flow via API so the contract ends up active
    await request.patch(`${BACKEND}/contracts/${contractId}/inspection`, {
      headers: authHdr(rpToken), data: buildInspectionData(),
    });
    await request.post(
      `${BACKEND}/contracts/tenant/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(tenantToken), data: { signatureImage: SIG_PNG } },
    );
    await request.post(
      `${BACKEND}/contracts/${contractId}/inspection/sign?type=move_in`,
      { headers: authHdr(rpToken), data: { signatureImage: SIG_PNG } },
    );
  });

  test('UI-RP1 + UI-RP2: Active Tenancy shows preview buttons; Step 4 shows inspection status', async ({
    page,
  }) => {
    await injectAuthCookie(page, RP_EMAIL);

    await page.goto(`/rental-provider/dashboard/contracts/${contractId}`);
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // ── Step 5: Active Tenancy ────────────────────────────────────────────────
    await expect(page.locator('text=Active Tenancy')).toBeVisible({ timeout: 12_000 });

    // Preview buttons must be visible in the Active Tenancy step
    await expect(page.locator('a', { hasText: /preview rental agreement/i })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('a', { hasText: /preview receipt/i })).toBeVisible({ timeout: 8_000 });

    // ── Step 4: Move-In inspection signing progress ───────────────────────────
    // All three indicators shown; the counter-sign one should be done (green)
    await expect(page.locator('text=/rp counter-signed/i')).toBeVisible({ timeout: 8_000 });
  });
});
