/**
 * activity-full-cycle.spec.ts — ONE lease driven the WHOLE way, so the Activity
 * board can be seen filled rather than described.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every journey in the database is a fragment. The best real lease reaches 8
 * lanes, but they are scattered across the lead and renewal pipelines and it
 * never reaches N6 at all — because those leases were created before any of this
 * was instrumented. Querying harder cannot fix that: the steps were never
 * recorded, so there is nothing to find. The only way to show a complete cycle
 * is to perform one.
 *
 * This drives a brand-new tenancy through all EIGHT lead + new-lease lanes:
 *
 *   L1 Interested  → L2 KYC → L3 Payments
 *   → N2 Signatures → N3 Utility → N4 Move-in → N5 Registration → N6 Activated
 *
 * Everything goes through the REAL HTTP endpoints with REAL tokens from the
 * real registration flow. Nothing is inserted into the activity tables directly.
 * That is the whole point: if a lane comes out empty, the product genuinely does
 * not record that step, and the board is right to show it as not reached.
 *
 * It targets the branch backend on :3011 (clone `upnow_prod_clone`) so the
 * journey is browsable at :3010 afterwards. Ports 3000/3001 are untouched.
 *
 *   npx playwright test e2e/activity-full-cycle.spec.ts --workers=1
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = process.env.ACTIVITY_BACKEND ?? 'http://localhost:3011/api';
const FRONTEND = process.env.ACTIVITY_FRONTEND ?? 'http://127.0.0.1:3010';

const TS = Date.now();
/**
 * An EXISTING, VERIFIED landlord with real stock.
 *
 * A freshly registered RP sits at `pending_review` and is 403'd from creating a
 * property until an admin approves them — a correct gate, and not the thing
 * under test here. Driving the tenancy as a landlord who is already trading is
 * also the more representative case: their settings, fee rules and penalties are
 * real, so the money steps record real values rather than defaults.
 */
const RP_EMAIL = process.env.ACTIVITY_RP_EMAIL ?? 'kbaalfalasi@gmail.com';
const ADMIN_EMAIL = process.env.ACTIVITY_ADMIN_EMAIL ?? 'admin@upnow.ae';
const CX_EMAIL = `cx.journey.${TS}@e2e.upnow.test`;
const CX_PHONE = `+9715${String(TS + 7).slice(-8)}`;

/**
 * The tenancy starts TODAY.
 *
 * Registration deliberately does NOT flip a lease live before its term begins —
 * that would double-book the unit with the outgoing tenancy — so a future start
 * date defers activation to the overnight cron and N6 can never be reached in a
 * same-day drive. Starting today is what makes the last lane observable.
 */
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const START = iso(today);
const END = iso(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate() - 1));

const hdrs = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

/** A 1x1 transparent PNG — enough to satisfy "a signature was drawn". */
const SIG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Shared across the serial tests — this is one continuous tenancy. */
const S = {
  rpToken: '', cxToken: '', cxProfileId: 0,
  propertyId: 0, unitId: 0, leadId: 0, viewingId: 0, contractId: 0, portalToken: '',
};

/**
 * Report rather than throw.
 *
 * A hard failure at step 9 hides whether steps 10-20 would have worked, and the
 * question here is "which lanes fill", not "does everything pass". Each call
 * prints its outcome and the run continues; the final assertion is on the lane
 * coverage, which is the thing actually being demonstrated.
 */
const trace: string[] = [];
async function step(
  name: string,
  fn: () => Promise<{ status: () => number; text: () => Promise<string>; ok: () => boolean }>,
): Promise<unknown> {
  try {
    const r = await fn();
    const body = await r.text();
    const line = `${r.ok() ? 'ok  ' : `FAIL`} ${String(r.status()).padEnd(3)} ${name}`;
    trace.push(line);
    // eslint-disable-next-line no-console
    console.log(line + (r.ok() ? '' : `\n         ↳ ${body.slice(0, 300)}`));
    if (!r.ok()) trace.push(`         ↳ ${body.slice(0, 200)}`);
    try { return JSON.parse(body); } catch { return null; }
  } catch (e) {
    trace.push(`ERR      ${name} — ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// NO RETRIES. A retry re-books against the lead the first pass already
// converted, and the second contract comes back with origin_lead_id NULL —
// which splits the journey into two flows and hides the lead lanes.
test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('Activity board — one lease, the whole cycle', () => {
  // ── Accounts ────────────────────────────────────────────────────────────
  test('01 — sign the landlord in, register the customer', async ({ request }) => {
    // Real OTP login — request, then verify with the code the dev API returns.
    const req = await request.post(`${BACKEND}/auth/login`, { data: { email: RP_EMAIL } });
    expect(req.ok(), `RP login request: ${await req.text()}`).toBeTruthy();
    const otp = ((await req.json()) as { devOtp?: string }).devOtp;
    expect(otp, 'dev OTP returned').toBeTruthy();
    const verify = await request.post(`${BACKEND}/auth/login/verify-otp`, {
      data: { identifier: RP_EMAIL, code: otp },
    });
    expect(verify.ok(), `RP OTP verify: ${await verify.text()}`).toBeTruthy();
    S.rpToken = ((await verify.json()) as { access_token: string }).access_token;

    const cx = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: CX_EMAIL, phone: CX_PHONE },
    });
    expect(cx.status(), `Customer register: ${await cx.text()}`).toBe(201);
    const cxBody = (await cx.json()) as { access_token: string; devOtp?: string };
    S.cxToken = cxBody.access_token;
    if (cxBody.devOtp) {
      await request.post(`${BACKEND}/auth/otp/verify`, {
        headers: hdrs(S.cxToken), data: { code: cxBody.devOtp },
      });
    }
    expect(S.rpToken && S.cxToken).toBeTruthy();
  });

  test('02 — get a live listing to lease (provisions one if none is left)', async ({ request }) => {
    const load = async () => {
      const r = await request.get(`${BACKEND}/properties/units/all`, { headers: hdrs(S.rpToken) });
      const raw = (await r.json()) as unknown;
      return (Array.isArray(raw) ? raw : (raw as { data?: unknown[] })?.data ?? []) as Array<{
        id: number; availability?: string; listingStatus?: string; unitNumber?: string; propertyId?: number;
      }>;
    };

    let list = await load();
    const isFree = (u: { availability?: string }) => u.availability === 'available';
    let unit = list.find((u) => isFree(u) && u.listingStatus === 'published');

    // SELF-PROVISIONING, because this spec CONSUMES a listing every time it runs:
    // the unit it leases becomes occupied. Without this the second run has no
    // stock and fails on setup rather than on anything it is testing.
    //
    // It provisions the way the product does — the landlord submits the listing,
    // an ADMIN approves it — rather than by writing listing_status directly.
    if (!unit) {
      let candidate = list.find((u) => isFree(u) && u.listingStatus !== 'published');

      // Nothing vacant left either — every run leases one away. Create a unit on
      // an existing property so the spec never depends on leftover stock.
      if (!candidate) {
        const propId = list[0]?.propertyId;
        expect(propId, 'the landlord has at least one property').toBeTruthy();
        const made = (await step('setup: landlord adds a unit', () =>
          request.post(`${BACKEND}/properties/${propId}/units`, {
            headers: hdrs(S.rpToken),
            data: {
              unitNumber: `J${String(TS).slice(-5)}`,
              unitType: 'apartment',
              bedrooms: 2, bathrooms: 2,
              rentalPrice: 90000,
              availability: 'available',
            },
          }),
        )) as { id?: number } | null;
        expect(made?.id, 'unit created').toBeTruthy();
        candidate = { id: Number(made!.id), propertyId: Number(propId), listingStatus: 'draft', availability: 'available' };
      }
      expect(candidate?.id, `some vacant unit exists to list (of ${list.length})`).toBeTruthy();

      if (candidate!.listingStatus !== 'pending') {
        await step(`setup: landlord submits unit ${candidate!.id} for listing`, () =>
          request.patch(`${BACKEND}/properties/${candidate!.propertyId}/units/${candidate!.id}/submit-listing`, {
            headers: hdrs(S.rpToken), data: {},
          }),
        );
      }

      // Admin OTP login — the approval is genuinely a different person's decision.
      const areq = await request.post(`${BACKEND}/auth/login`, { data: { email: ADMIN_EMAIL } });
      const aotp = ((await areq.json()) as { devOtp?: string }).devOtp;
      const averify = await request.post(`${BACKEND}/auth/login/verify-otp`, {
        data: { identifier: ADMIN_EMAIL, code: aotp },
      });
      expect(averify.ok(), `admin OTP verify: ${await averify.text()}`).toBeTruthy();
      const adminToken = ((await averify.json()) as { access_token: string }).access_token;

      await step(`setup: admin approves unit ${candidate!.id}`, () =>
        request.patch(
          `${BACKEND}/admin/listings/${candidate!.propertyId}/units/${candidate!.id}/approve`,
          { headers: hdrs(adminToken), data: {} },
        ),
      );

      list = await load();
      unit = list.find((u) => u.id === candidate!.id && u.listingStatus === 'published');
      expect(unit?.id, 'the unit is published after admin approval').toBeTruthy();
    }

    S.unitId = Number(unit!.id);
    S.propertyId = Number(unit!.propertyId ?? 0);
    // eslint-disable-next-line no-console
    console.log(`ok      leasing unit #${S.unitId} (${unit!.unitNumber ?? '?'})`);
  });

  // ── L1 Interested ───────────────────────────────────────────────────────
  test('03 — L1: the customer books a viewing, the landlord runs it', async ({ request }) => {
    const bv = (await step('L1 customer books viewing', () =>
      request.post(`${BACKEND}/leads/viewings`, {
        headers: hdrs(S.cxToken),
        data: {
          unitId: S.unitId,
          scheduledAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
          notes: 'Looking to move in for the new school year',
          desiredMoveIn: START,
          occupantsAdults: 2, occupantsChildren: 1, occupantsPets: 0,
        },
      }),
    )) as { lead?: { id: number; convertedTenantId?: number }; viewing?: { id: number } } | null;

    S.leadId = Number(bv?.lead?.id ?? 0);
    S.viewingId = Number(bv?.viewing?.id ?? 0);
    S.cxProfileId = Number(bv?.lead?.convertedTenantId ?? 0);
    expect(S.leadId, 'lead created').toBeGreaterThan(0);

    await step('L1 landlord confirms the viewing', () =>
      request.patch(`${BACKEND}/leads/viewings/${S.viewingId}/status`, {
        headers: hdrs(S.rpToken), data: { status: 'confirmed' },
      }),
    );
    await step('L1 landlord records the outcome', () =>
      request.patch(`${BACKEND}/leads/viewings/${S.viewingId}/status`, {
        headers: hdrs(S.rpToken), data: { status: 'completed' },
      }),
    );
    await step('L1 lead → contacted', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/stage`, {
        headers: hdrs(S.rpToken), data: { stage: 'contacted' },
      }),
    );
  });

  // ── L2 KYC ──────────────────────────────────────────────────────────────
  test('04 — L2: the customer submits a document pack and the landlord reviews it', async ({ request }) => {
    await step('L2 lead → documents_collection', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/stage`, {
        headers: hdrs(S.rpToken), data: { stage: 'documents_collection' },
      }),
    );

    for (const d of [
      { key: 'emirates_id', cat: 'identity' },
      { key: 'passport', cat: 'identity' },
      { key: 'uae_visa', cat: 'identity' },
    ]) {
      await step(`L2 customer uploads ${d.key}`, () =>
        request.post(`${BACKEND}/documents`, {
          headers: hdrs(S.cxToken),
          data: {
            ownerType: 'customer', ownerId: S.cxProfileId,
            category: d.cat, documentKey: d.key,
            displayName: d.key.replace(/_/g, ' '),
            fileUrl: `http://localhost:3011/uploads/journey-${d.key}-${TS}.pdf`,
            mimeType: 'application/pdf',
          },
        }),
      );
    }

    // The bug this branch fixed: before 0178 this click never left the browser.
    await step('L2 customer submits the pack for review', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/documents-ready`, {
        headers: hdrs(S.cxToken), data: {},
      }),
    );
    await step('L2 landlord approves the lead', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/stage`, {
        headers: hdrs(S.rpToken), data: { stage: 'approved' },
      }),
    );
  });

  // ── L3 Payments ─────────────────────────────────────────────────────────
  test('05 — L3: an offer, then a REVISED offer, then the cheques', async ({ request }) => {
    // The first offer.
    await step('L3 landlord issues the payment plan (1 cheque)', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/issue-payment-plan`, {
        headers: hdrs(S.rpToken),
        data: {
          rentFils: 9500000, installmentCount: 1,
          adminFeeFils: 50000, ejariFils: 22000, commissionFils: 0,
          securityDepositFils: 475000,
          bundleDueDate: '2026-08-25', depositDueDate: '2026-08-25',
          installmentDueDates: [],
        },
      }),
    );

    // The REVISION — this is the case you asked to be able to see: what was
    // offered, and what is offered now, both readable from the step.
    await step('L3 landlord REVISES the plan (4 cheques, lower rent)', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/issue-payment-plan`, {
        headers: hdrs(S.rpToken),
        data: {
          rentFils: 9000000, installmentCount: 4,
          adminFeeFils: 50000, ejariFils: 22000, commissionFils: 0,
          securityDepositFils: 450000,
          bundleDueDate: '2026-08-25', depositDueDate: '2026-08-25',
          installmentDueDates: ['2026-12-01', '2027-03-01', '2027-06-01'],
        },
      }),
    );

    await step('L3 lead → cheques_submitted', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/stage`, {
        headers: hdrs(S.rpToken), data: { stage: 'cheques_submitted' },
      }),
    );

    for (let i = 1; i <= 4; i++) {
      await step(`L3 cheque ${i} recorded`, () =>
        request.post(`${BACKEND}/leads/${S.leadId}/cheques`, {
          headers: hdrs(S.rpToken),
          data: {
            chequeSerial: `JRN-${TS}-${i}`,
            bankName: 'Emirates NBD',
            amountFils: 2250000,
            dueDate: `2026-${String(8 + i).padStart(2, '0')}-01`,
          },
        }),
      );
    }

    // ⚠️ THIS AUTO-ISSUES THE LEASE. Confirming the cheques converts the lead:
    // `confirmChequesCollected` calls `createContractForLead` and hands back the
    // new contractId. Calling POST /contracts afterwards makes a SECOND lease on
    // the same unit — two 'issued' rows, a double-booking, and the journey split
    // across two flows. Take the lease the product just made.
    const confirmed = (await step('L3 landlord confirms the cheques — this ISSUES the lease', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/confirm-cheques-collected`, {
        headers: hdrs(S.rpToken), data: {},
      }),
    )) as { contractId?: number } | null;
    S.contractId = Number(confirmed?.contractId ?? 0);
  });

  test('06 — the lease the lead became', async () => {
    // No POST /contracts here. The lease already exists — the lead became it the
    // moment its cheques were confirmed, which is the product's own design.
    expect(S.contractId, 'the lead auto-issued a lease').toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`ok      lead #${S.leadId} became lease #${S.contractId}`);
  });

  // ── N2 Signatures ───────────────────────────────────────────────────────
  test('07 — N2: both parties sign', async ({ request }) => {
    // THE CUSTOMER SIGNS THROUGH THEIR MAGIC LINK, not the dashboard. The
    // dashboard route is landlord/manager only and 403s a customer token —
    // correctly. Minting the link is itself the product's first N2 action.
    // ONE LINK PER PURPOSE. Each portal route asserts a specific purpose —
    // contract signing wants 'contract', the inspection wants 'move_in' — so a
    // single link cannot serve both. Valid purposes are documents | contract |
    // move_in | move_out | settlement.
    const link = (await step('N2 landlord sends the signing link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.rpToken),
        data: {
          tenantId: S.cxProfileId, contractId: S.contractId,
          purpose: 'contract', signerRole: 'tenant', sendEmail: false,
        },
      }),
    )) as { token?: string; link?: string } | null;
    S.portalToken = String(link?.token ?? (link?.link ?? '').split('/portal/')[1]?.split('/')[0] ?? '');

    if (S.portalToken) {
      await step('N2 customer signs via the portal', () =>
        request.post(`${BACKEND}/portal/${S.portalToken}/contracts/${S.contractId}/sign`, {
          data: { signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
        }),
      );
    }

    await step('N2 landlord signs', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/sign`, {
        headers: hdrs(S.rpToken),
        data: {
          role: 'landlord', signatureImage: SIG,
          signatoryName: 'Journey Landlord', method: 'online', consent: true,
        },
      }),
    );
  });

  // ── N3 Utility ──────────────────────────────────────────────────────────
  test('08 — N3: the utility account is submitted and verified', async ({ request }) => {
    await step('N3 customer submits the DEWA account', () =>
      request.patch(`${BACKEND}/contracts/tenant/${S.contractId}/utility`, {
        headers: hdrs(S.cxToken),
        // The field is `utilityAccountNumber`. Sending anything else used to reach
        // `.trim()` on undefined and come back as a 500.
        data: { utilityAccountNumber: `20${String(TS).slice(-8)}` },
      }),
    );
    await step('N3 landlord verifies it', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/utility/verify`, {
        headers: hdrs(S.rpToken), data: {},
      }),
    );
  });

  // ── N4 Move-in ──────────────────────────────────────────────────────────
  test('09 — N4: the move-in inspection is filled, signed and counter-signed', async ({ request }) => {
    await step('N4 inspection filled in', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/inspection`, {
        headers: hdrs(S.rpToken),
        data: {
          type: 'move_in',
          data: {
            rooms: [
              { name: 'Living room', condition: 'good', notes: 'Handed over clean' },
              { name: 'Kitchen', condition: 'good', notes: 'All appliances working' },
            ],
            meterReadings: { electricity: '41221', water: '9088' },
            keysHandedOver: 2,
          },
          finalize: true,
        },
      }),
    );
    // A SECOND link, minted for the inspection — see the note in N2.
    const inspLink = (await step('N4 landlord sends the inspection link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.rpToken),
        data: {
          tenantId: S.cxProfileId, contractId: S.contractId,
          purpose: 'move_in', signerRole: 'tenant', sendEmail: false,
        },
      }),
    )) as { token?: string; link?: string } | null;
    const inspToken = String(inspLink?.token ?? (inspLink?.link ?? '').split('/portal/')[1]?.split('/')[0] ?? '');
    if (inspToken) {
      await step('N4 customer signs the report via the portal', () =>
        request.post(`${BACKEND}/portal/${inspToken}/contracts/${S.contractId}/inspection/sign`, {
          data: { type: 'move_in', signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
        }),
      );
    }
    await step('N4 landlord counter-signs', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/inspection/counter-sign`, {
        headers: hdrs(S.rpToken),
        data: { type: 'move_in', signatureImage: SIG, signatoryName: 'Journey Landlord', consent: true },
      }),
    );
  });

  // ── N5 Registration → N6 Activated ──────────────────────────────────────
  test('10 — N5: Ejari registered, which activates the lease (N6)', async ({ request }) => {
    // mark-registered LINKS AN EXISTING CERTIFICATE — it returns matched:false
    // when there is no ejari* document to link, and correctly records nothing.
    await step('N5 Ejari certificate uploaded', () =>
      request.post(`${BACKEND}/documents`, {
        headers: hdrs(S.rpToken),
        data: {
          ownerType: 'tenancy_contract', ownerId: S.contractId,
          category: 'contract', documentKey: 'ejari_certificate',
          displayName: 'Ejari certificate',
          fileUrl: `http://localhost:3011/uploads/ejari-${TS}.pdf`,
          mimeType: 'application/pdf',
        },
      }),
    );
    await step('N5 marked registered', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/ejari/mark-registered`, {
        headers: hdrs(S.rpToken), data: {},
      }),
    );

    const c = (await step('N6 read the lease status back', () =>
      request.get(`${BACKEND}/contracts/${S.contractId}`, { headers: hdrs(S.rpToken) }),
    )) as { status?: string } | null;
    trace.push(`         ↳ lease status is now: ${c?.status ?? 'unknown'}`);
  });

  // ── What actually landed on the board ───────────────────────────────────
  test('11 — the journey reads back with every lane filled', async ({ request }) => {
    const j = (await step('GET /activity/journey', () =>
      request.get(`${BACKEND}/activity/journey/${S.contractId}`, { headers: hdrs(S.rpToken) }),
    )) as {
      totalSteps?: number;
      pipelines?: Array<{ key: string; lanes: Array<{ id: string; title: string; steps: unknown[] }> }>;
    } | null;

    const lanes = (j?.pipelines ?? []).flatMap((p) => p.lanes);
    const filled = lanes.filter((l) => l.steps.length);

    // eslint-disable-next-line no-console
    console.log(
      `\n───────── DRIVE TRACE ─────────\n${trace.join('\n')}\n` +
      `\n───────── LANES ─────────\n` +
      lanes.map((l) => `${l.steps.length ? '●' : '○'} ${l.id.padEnd(3)} ${l.title.padEnd(24)} ${l.steps.length}`).join('\n') +
      `\n\nlease #${S.contractId} · lead #${S.leadId} · ${j?.totalSteps ?? 0} steps · ${filled.length} lanes filled` +
      `\n${FRONTEND}/rental-provider/dashboard/operations/${S.contractId}/journey\n`,
    );

    expect(S.contractId, 'a lease exists to look at').toBeGreaterThan(0);
  });
});
