/**
 * Phase 3 + Approve Documents + Step 3 — v1-launch journey E2E
 *
 * Covers the four new behaviors layered onto the lead-payment-workflow:
 *
 *  1. expressInterest auto-generates a PaymentPlan (customer never waits
 *     for the RP to issue one manually). Lead.stage flips to `interested`
 *     with a non-null `paymentPlan` in the same write.
 *
 *  2. PATCH /leads/:id/approve-documents — RP one-click action flips the
 *     lead from `interested` → `payment_plan_shared` *without* requiring
 *     the issue-plan modal. The previously-auto-generated plan stays put.
 *
 *  3. POST /leads/my-viewings/:vid/cheque-uploads now accepts uploads
 *     while the lead is in `payment_plan_shared` (Step 3 cheque attach UX).
 *     The previous matrix only allowed `interested` / `cheques_submitted`.
 *
 *  4. PATCH /leads/:id/cheques-ready remains the "Ready to collect"
 *     transition and still requires `payment_plan_shared`.
 *
 * Backend on :3001. Super admin seeded with SUPER_ADMIN_EMAIL/PASSWORD
 * from upnow-backend/.env. Run: npm run test:e2e -- phase3-approve-docs-step3
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';

/** Reuse the Phase 1/2 fixture RP — already compliance-approved, owns
 *  property 3, no admin bootstrap needed. Each run still uses a fresh
 *  customer + a fresh unit so the journey starts from a clean slate. */
const RP_EMAIL = 'rp.test@upnow.ae';
const RP_PROPERTY_ID = 3;

const TS = Date.now();
const TENANT_EMAIL = `tenant.p3.${TS}@upnow.ae`;

/** All login goes through the 2-step OTP flow now. devOtp is exposed in
 *  non-production for exactly this kind of automation. */
async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(r1.ok(), `OTP step-1 for ${email}: ${r1.status()}`).toBeTruthy();
  const b1 = await r1.json() as { devOtp?: string };
  expect(b1.devOtp, 'devOtp missing — NODE_ENV must not be production').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: b1.devOtp },
  });
  expect(r2.ok(), `OTP step-2 for ${email}: ${r2.status()}`).toBeTruthy();
  return ((await r2.json()) as { access_token: string }).access_token;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.describe.serial('Phase 3 — auto-plan, Approve Docs, Step 3 cheque uploads', () => {
  let rpToken = '';
  let tenantToken = '';
  let leadId = 0;
  let viewingId = 0;
  let unitId = 0;

  // ─── 1. Bootstrap actors + a listable unit ───────────────────────────────

  test('1. log in as fixture RP + register fresh tenant + create published unit', async ({ request }) => {
    // Reuse seeded RP — already compliance-approved per Phase 1 fixture
    rpToken = await loginOtp(request, RP_EMAIL);

    // Unit under the fixture RP's existing property — all mandatory fees set
    // so the auto-plan generation in expressInterest succeeds.
    const unitRes = await request.post(`${BACKEND}/properties/${RP_PROPERTY_ID}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `P3-${TS}`,
        unitType: 'apartment',
        rentalPrice: 100000,        // 100k AED / yr
        premiseNumber: `${TS}`.slice(-7),
        securityDeposit: 5000,
        adminFee: 1000,
        ejariFeeFils: 25000,        // 250 AED
        commission: 5000,
        availability: 'available',
      },
    });
    expect(unitRes.status(), `Unit create: ${unitRes.status()}`).toBe(201);
    unitId = ((await unitRes.json()) as { id: number }).id;

    // Publish so the customer can book a viewing
    const toggle = await request.patch(`${BACKEND}/properties/${RP_PROPERTY_ID}/units/${unitId}/toggle-listing`, {
      headers: auth(rpToken),
    });
    expect(toggle.ok(), `Toggle listing: ${toggle.status()}`).toBeTruthy();

    // Fresh customer per run — never reuse, so journey starts at viewing_scheduled
    const tReg = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: TENANT_EMAIL, phone: `+9715${(TS + 1).toString().slice(-8)}` },
    });
    expect(tReg.status(), `Tenant register: ${tReg.status()}`).toBe(201);
    tenantToken = ((await tReg.json()) as { access_token: string }).access_token;
  });

  // ─── 2. Tenant books a viewing ────────────────────────────────────────────

  test('2. tenant books a viewing → lead at viewing_scheduled', async ({ request }) => {
    const res = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(tenantToken),
      data: {
        unitId,
        scheduledAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        notes: 'phase3 test booking',
      },
    });
    expect(res.status(), `Book viewing: ${res.status()}`).toBe(201);
    const body = await res.json() as { lead: { id: number; stage: string }; viewing: { id: number } };
    leadId = body.lead.id;
    viewingId = body.viewing.id;
    expect(body.lead.stage).toBe('viewing_scheduled');
  });

  // ─── 3. Express-interest auto-generates a plan ───────────────────────────

  test('3. express-interest flips to interested AND attaches an auto-plan', async ({ request }) => {
    const res = await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/express-interest`, {
      headers: auth(tenantToken),
      data: { contractStartDate: '2026-08-01', paymentsCount: 4, occupantsAdults: 1 },
    });
    expect(res.ok(), `Express interest: ${res.status()}`).toBeTruthy();

    // Verify lead now has plan + INTERESTED stage
    const leadRes = await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) });
    expect(leadRes.ok()).toBeTruthy();
    const lead = await leadRes.json() as { stage: string; paymentPlan: { installmentCount: number; chequeCount: number; rentFils: number } | null };
    expect(lead.stage).toBe('interested');
    expect(lead.paymentPlan).toBeTruthy();
    expect(lead.paymentPlan!.installmentCount).toBe(4);
    expect(lead.paymentPlan!.chequeCount).toBe(5);          // 4 + deposit
    expect(lead.paymentPlan!.rentFils).toBe(10_000_000);    // 100k AED
  });

  // ─── 4. Guard — approve-documents rejected from wrong stage ──────────────

  test('4. guard — a second approve-documents rejects once past documents, then share', async ({ request }) => {
    // First approval: interested → approved (RP-only plan draft).
    const ok = await request.patch(`${BACKEND}/leads/${leadId}/approve-documents`, { headers: auth(rpToken) });
    expect(ok.ok(), `First approve-documents: ${ok.status()}`).toBeTruthy();

    // Second approval is rejected — the lead has left the documents stage.
    const again = await request.patch(`${BACKEND}/leads/${leadId}/approve-documents`, { headers: auth(rpToken) });
    expect(again.status(), 'second approve-documents must reject once past documents').toBe(400);

    // Share the reviewed plan → payment_plan_shared (unlocks the customer's Step 3).
    const shared = await request.patch(`${BACKEND}/leads/${leadId}/share-plan`, { headers: auth(rpToken) });
    expect(shared.ok(), `share-plan: ${shared.status()}`).toBeTruthy();
  });

  // ─── 5. Lead is now at payment_plan_shared with plan intact ───────────────

  test('5. after approve + share → stage payment_plan_shared, plan still attached', async ({ request }) => {
    const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as {
      stage: string; paymentPlan: { installmentCount: number } | null;
    };
    expect(lead.stage).toBe('payment_plan_shared');
    expect(lead.paymentPlan).toBeTruthy();
    expect(lead.paymentPlan!.installmentCount).toBe(4);     // unchanged by approval
  });

  // ─── 6. Step 3 — cheque uploads accepted in payment_plan_shared ──────────

  test('6. cheque-uploads accepted during payment_plan_shared', async ({ request }) => {
    const res = await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, {
      headers: auth(tenantToken),
      data: { imageUrl: 'http://test/cheque-1.jpg', fileKey: `test-${TS}/c1`, label: 'Cheque 1' },
    });
    expect(res.status(), `Cheque upload: ${res.status()}`).toBe(201);
    const body = await res.json() as { id: number; isCustomerUpload: boolean };
    expect(body.id).toBeTruthy();
    expect(body.isCustomerUpload).toBe(true);

    // List shows it
    const list = await (await request.get(`${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, { headers: auth(tenantToken) })).json() as Array<{ id: number }>;
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  // ─── 7. Ready to collect — payment_plan_shared → cheques_submitted ───────

  test('7. cheques-ready flips payment_plan_shared → cheques_submitted', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, { headers: auth(tenantToken) });
    expect(res.ok(), `Cheques-ready: ${res.status()}`).toBeTruthy();

    const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { stage: string };
    expect(lead.stage).toBe('cheques_submitted');
  });

  // ─── 8. Double-tap guard — cheques-ready twice rejects ───────────────────

  test('8. guard — calling cheques-ready a second time rejects', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, { headers: auth(tenantToken) });
    expect(res.status()).toBe(400);
  });

  // ─── 8b. Phase 5b — RP tags each uploaded reference with a method ────────

  test('8b. RP can tag each uploaded reference with a payment method', async ({ request }) => {
    // Pull the uploaded cheques back as a tenant (RP listing is gated by a
    // different relation chain in this DB seed; the tenant route is enough
    // to discover the id).
    const list = await (await request.get(
      `${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, { headers: auth(tenantToken) },
    )).json() as Array<{ id: number }>;
    expect(list.length).toBeGreaterThan(0);
    const chequeId = list[0].id;

    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques/${chequeId}/status`, {
      headers: auth(rpToken),
      data: { paymentMethod: 'bank_transfer' },
    });
    expect(res.ok(), `Tag method: ${res.status()} ${await res.text()}`).toBeTruthy();
    const body = await res.json() as { paymentMethod: string };
    expect(body.paymentMethod).toBe('bank_transfer');
  });

  test('8c. RP method tag rejects invalid values', async ({ request }) => {
    const list = await (await request.get(
      `${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, { headers: auth(tenantToken) },
    )).json() as Array<{ id: number }>;
    const chequeId = list[0].id;
    const res = await request.patch(`${BACKEND}/leads/${leadId}/cheques/${chequeId}/status`, {
      headers: auth(rpToken),
      data: { paymentMethod: 'bitcoin' },
    });
    expect(res.status()).toBe(400);
  });

  // ─── 9. Phase 5a — confirm-cheques-collected auto-issues a contract ──────

  test('9. confirm-cheques-collected auto-issues contract → stage contract_issued', async ({ request }) => {
    const res = await request.patch(`${BACKEND}/leads/${leadId}/confirm-cheques-collected`, { headers: auth(rpToken) });
    expect(res.ok(), `Confirm collected: ${res.status()}`).toBeTruthy();
    const body = await res.json() as { confirmed: boolean; contractId: number };
    expect(body.confirmed).toBe(true);
    expect(body.contractId, 'contract row must be auto-created').toBeGreaterThan(0);

    // Lead should now be at contract_issued — the customer's state machine
    // routes that to Step 4 (signature) on the v2 page.
    const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { stage: string };
    expect(lead.stage).toBe('contract_issued');
  });
});
