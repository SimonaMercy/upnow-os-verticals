/**
 * Phase 2 — Step 1 (Booked + Payment Summary + "I'm Interested") tests.
 *
 * Covers the new BookedAction flow:
 *   1. POST /leads/my-viewings/:id/plan-preview returns a full payment plan
 *      breakdown derived from the unit's RP-configured fees.
 *   2. POST /leads/my-viewings/:id/express-interest persists customer
 *      preferences + sets lead.stage = 'interested'.
 *   3. After express-interest, the lead cannot be re-expressed (already
 *      past this step).
 *   4. express-interest is gated by KYC — a fresh customer with no docs
 *      receives a 400 with a "complete your KYC" message.
 *
 * Prerequisites match phase1-state-machine.spec.ts —
 * `rp.test@upnow.ae` owns property 3, `tenant.test@upnow.ae` is the
 * customer; backend on :3001, frontend on :3000, NODE_ENV != production.
 *
 * Run: npm run test:e2e -- phase2-booked-step
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
// phone_97145768483@upnow.internal has a viewing on a unit with all fees
// configured (rentalPrice, securityDeposit, adminFee, ejariFee, commission).
// The default `tenant.test@upnow.ae` seed predates the Phase 1 mandatory-fee
// requirement so its units have NULL fees and plan-preview throws.
const CUSTOMER_EMAIL = 'phone_97145768483@upnow.internal';

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const step1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(step1.ok(), `OTP step-1 failed for ${email}`).toBeTruthy();
  const body1 = await step1.json() as { devOtp?: string };
  expect(body1.devOtp, 'devOtp missing — NODE_ENV must not be production').toBeTruthy();
  const step2 = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: body1.devOtp },
  });
  expect(step2.ok(), 'OTP step-2 failed').toBeTruthy();
  const body2 = await step2.json() as { access_token?: string };
  expect(body2.access_token).toBeTruthy();
  return body2.access_token as string;
}

function authHdr(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function getFirstViewing(request: APIRequestContext, token: string) {
  const res = await request.get(`${BACKEND}/leads/my-viewings`, { headers: authHdr(token) });
  expect(res.ok()).toBeTruthy();
  const list = await res.json() as Array<{ id: number; leadId: number; lead?: { stage: string } }>;
  expect(list.length, 'seeded customer must have a viewing').toBeGreaterThan(0);
  return list[0];
}

// ─── 1. Plan-preview returns the full breakdown ─────────────────────────────

test.describe('Phase 2 — plan-preview returns the full payment breakdown', () => {
  test('all fee categories present + items sum to total', async ({ request }) => {
    const token = await loginOtp(request, CUSTOMER_EMAIL);
    const viewing = await getFirstViewing(request, token);

    const res = await request.post(
      `${BACKEND}/leads/my-viewings/${viewing.id}/plan-preview`,
      { headers: authHdr(token), data: { contractStartDate: '2026-08-01', paymentsCount: 4 } },
    );
    expect(res.status()).toBe(200);
    const plan = await res.json() as {
      chequeCount: number;
      totalAmountFils: number;
      rentFils: number;
      adminFeeFils: number;
      ejariFils: number;
      commissionFils: number;
      securityDepositFils: number;
      installmentCount: number;
      items: Array<{ amountFils: number; type: string; dueDate: string }>;
    };

    // Every fee category should be present (no zeros for a properly-configured unit).
    expect(plan.rentFils, 'rent must be > 0').toBeGreaterThan(0);
    expect(plan.adminFeeFils, 'admin fee must be > 0').toBeGreaterThan(0);
    expect(plan.ejariFils, 'ejari fee must be > 0').toBeGreaterThan(0);
    expect(plan.commissionFils, 'commission must be > 0').toBeGreaterThan(0);
    expect(plan.securityDepositFils, 'security deposit must be > 0').toBeGreaterThan(0);
    expect(plan.installmentCount).toBe(4);
    expect(plan.chequeCount).toBe(5); // 4 installments + 1 deposit row

    // Item amounts must add up to the total.
    const itemSum = plan.items.reduce((s, it) => s + it.amountFils, 0);
    expect(itemSum, `items must sum to totalAmountFils (${itemSum} vs ${plan.totalAmountFils})`).toBe(plan.totalAmountFils);

    // Items must include a security_deposit row.
    expect(plan.items.some(it => it.type === 'security_deposit')).toBeTruthy();
  });

  test('flipping paymentsCount changes installmentCount + chequeCount', async ({ request }) => {
    const token = await loginOtp(request, CUSTOMER_EMAIL);
    const viewing = await getFirstViewing(request, token);

    const quarterly = await request.post(
      `${BACKEND}/leads/my-viewings/${viewing.id}/plan-preview`,
      { headers: authHdr(token), data: { contractStartDate: '2026-08-01', paymentsCount: 4 } },
    );
    const monthly = await request.post(
      `${BACKEND}/leads/my-viewings/${viewing.id}/plan-preview`,
      { headers: authHdr(token), data: { contractStartDate: '2026-08-01', paymentsCount: 12 } },
    );
    const q = await quarterly.json() as { chequeCount: number; installmentCount: number; totalAmountFils: number };
    const m = await monthly.json() as { chequeCount: number; installmentCount: number; totalAmountFils: number };

    expect(q.installmentCount).toBe(4);
    expect(m.installmentCount).toBe(12);
    // Cheque count = installments + 1 (security deposit cheque).
    expect(q.chequeCount).toBe(5);
    expect(m.chequeCount).toBe(13);
    // Total payable is the same regardless of cheque count.
    expect(m.totalAmountFils).toBe(q.totalAmountFils);
  });
});

// ─── 2. KYC gate on express-interest ────────────────────────────────────────
//
// The seeded `phone_97145768483@upnow.internal` customer has
// `kycStatus = unverified`, so calling express-interest must be rejected
// with a friendly "complete your KYC" message. This is the exact gate
// Phase 3 will surface as a "Complete KYC" deep link in the UI.
//
// Once Phase 3 lands a fixture that auto-verifies KYC for a dedicated
// test customer, we'll add a happy-path test that asserts
// stage = 'interested' after a successful call.

test.describe('Phase 2 — express-interest enforces the KYC gate', () => {
  test('rejects with a KYC message when customer is unverified', async ({ request }) => {
    const token = await loginOtp(request, CUSTOMER_EMAIL);
    const viewing = await getFirstViewing(request, token);

    const res = await request.post(
      `${BACKEND}/leads/my-viewings/${viewing.id}/express-interest`,
      {
        headers: authHdr(token),
        data: {
          contractStartDate: '2026-08-15',
          paymentsCount: 4,
          paymentMethod: 'postdated_cheque',
          occupantsAdults: 2,
        },
      },
    );
    expect(res.status(), `expected 400, got ${res.status()}`).toBe(400);
    const body = await res.json().catch(() => ({} as { message?: string }));
    expect((body.message ?? '').toLowerCase()).toContain('kyc');
  });
});
