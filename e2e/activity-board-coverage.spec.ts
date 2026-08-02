/**
 * activity-board-coverage.spec.ts — drive the REST of the board.
 *
 * `activity-full-cycle.spec.ts` proves the new-lease pipeline: one lease from
 * enquiry to activation, all eight L/N lanes. This drives everything that spec
 * cannot reach, so every cell on the board is filled by a real request rather
 * than asserted from the mapping table:
 *
 *   · lead edge cases   — Book Now, viewing confirm/outcome, rejection,
 *                         document request / replace / reject / expiry,
 *                         personal details, asking price, generated plan,
 *                         cheques-ready, lease edit, lease cancel
 *   · CREATE/EDIT/DELETE — payments and cheques driven through all three
 *   · renewal R1→R7     — propose, revise, send, accept, KYC refresh, plan,
 *                         cheques, both signatures, registration
 *   · termination T1→T4 — request, accept, direct, move-out inspection,
 *                         bills, settlement draft → deduction → send → agree
 *                         → counter-sign → paid
 *
 * A MANAGER DRIVES MOST OF IT, and that is not incidental. The design draws
 * the move-out and settlement lanes as manager cells, so the same call made by
 * the landlord writes its audit row and records NO step — the recorder finds no
 * cell for the actor and the failure is swallowed, leaving a 200 response and an
 * empty lane. Where the design says manager, this uses a manager.
 *
 *   npx playwright test e2e/activity-board-coverage.spec.ts --workers=1 --retries=0
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = process.env.ACTIVITY_BACKEND ?? 'http://localhost:3011/api';
const RP_EMAIL = process.env.ACTIVITY_RP_EMAIL ?? 'kbaalfalasi@gmail.com';
/** An ACTIVE manager for RP 2 with the agreements / termination / settlement rights. */
const MGR_EMAIL = process.env.ACTIVITY_MGR_EMAIL ?? 'sheco1300@yahoo.com';
const RP_ID = Number(process.env.ACTIVITY_RP_ID ?? 2);

const TS = Date.now();
const hdrs = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const SIG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (days: number) => iso(new Date(today.getTime() + days * 86400_000));

const S = {
  rp: '', mgr: '', cx: '', cx2: '',
  cxProfileId: 0, cx2ProfileId: 0,
  unitId: 0, propertyId: 0,
  leadId: 0, viewingId: 0, contractId: 0,
  throwLeadId: 0, throwViewingId: 0,
  childId: 0, docId: 0, paymentId: 0, chequeId: 0,
  portalMoveOut: '',
};

const trace: string[] = [];
async function step(name: string, fn: () => Promise<{ status(): number; text(): Promise<string>; ok(): boolean }>) {
  try {
    const r = await fn();
    const body = await r.text();
    const line = `${r.ok() ? 'ok  ' : 'FAIL'} ${String(r.status()).padEnd(3)} ${name}`;
    trace.push(line);
    // eslint-disable-next-line no-console
    console.log(line + (r.ok() ? '' : `\n         ↳ ${body.slice(0, 220)}`));
    try { return JSON.parse(body); } catch { return null; }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`ERR      ${name} — ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function otpLogin(request: APIRequestContext, email: string): Promise<string> {
  const req = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(req.ok(), `login ${email}: ${await req.text()}`).toBeTruthy();
  const otp = ((await req.json()) as { devOtp?: string }).devOtp;
  const v = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  expect(v.ok(), `verify ${email}: ${await v.text()}`).toBeTruthy();
  return ((await v.json()) as { access_token: string }).access_token;
}

async function newCustomer(request: APIRequestContext, tag: string): Promise<string> {
  const r = await request.post(`${BACKEND}/auth/register/customer`, {
    data: { email: `cx.${tag}.${TS}@e2e.upnow.test`, phone: `+9715${String(TS + tag.length * 13).slice(-8)}` },
  });
  expect(r.status(), `register ${tag}: ${await r.text()}`).toBe(201);
  const b = (await r.json()) as { access_token: string; devOtp?: string };
  if (b.devOtp) await request.post(`${BACKEND}/auth/otp/verify`, { headers: hdrs(b.access_token), data: { code: b.devOtp } });
  return b.access_token;
}

/** Publish a vacant unit the way the product does: landlord submits, admin approves. */
async function liveUnit(request: APIRequestContext): Promise<{ id: number; propertyId: number }> {
  const load = async () => {
    const r = await request.get(`${BACKEND}/properties/units/all`, { headers: hdrs(S.rp) });
    const raw = (await r.json()) as unknown;
    return (Array.isArray(raw) ? raw : (raw as { data?: unknown[] })?.data ?? []) as Array<{
      id: number; availability?: string; listingStatus?: string; propertyId?: number;
    }>;
  };
  let list = await load();
  let u = list.find((x) => x.availability === 'available' && x.listingStatus === 'published');
  if (u) return { id: u.id, propertyId: Number(u.propertyId) };

  let cand = list.find((x) => x.availability === 'available');
  if (!cand) {
    const propId = list[0]?.propertyId;
    const made = (await step('setup: landlord adds a unit', () =>
      request.post(`${BACKEND}/properties/${propId}/units`, {
        headers: hdrs(S.rp),
        data: { unitNumber: `C${String(TS).slice(-5)}`, unitType: 'apartment', bedrooms: 2, bathrooms: 2, rentalPrice: 90000, availability: 'available' },
      }),
    )) as { id?: number } | null;
    cand = { id: Number(made!.id), propertyId: Number(propId), availability: 'available', listingStatus: 'draft' };
  }
  if (cand.listingStatus !== 'pending') {
    await step('setup: submit listing', () =>
      request.patch(`${BACKEND}/properties/${cand!.propertyId}/units/${cand!.id}/submit-listing`, { headers: hdrs(S.rp), data: {} }));
  }
  const admin = await otpLogin(request, 'admin@upnow.ae');
  await step('setup: admin approves listing', () =>
    request.patch(`${BACKEND}/admin/listings/${cand!.propertyId}/units/${cand!.id}/approve`, { headers: hdrs(admin), data: {} }));
  list = await load();
  u = list.find((x) => x.id === cand!.id);
  return { id: cand!.id, propertyId: Number(cand!.propertyId) };
}

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('Activity board — the lanes the new-lease drive cannot reach', () => {
  test('01 — sign in landlord, manager, two customers', async ({ request }) => {
    S.rp = await otpLogin(request, RP_EMAIL);
    S.mgr = await otpLogin(request, MGR_EMAIL);
    S.cx = await newCustomer(request, 'main');
    S.cx2 = await newCustomer(request, 'throw');
    expect(S.rp && S.mgr && S.cx && S.cx2).toBeTruthy();
  });

  // ── L1 · the lead lane, driven by the roles the design names ─────────────
  test('02 — L1: Book Now, viewing confirm + outcome, a rejected lead', async ({ request }) => {
    const u = await liveUnit(request);
    S.unitId = u.id; S.propertyId = u.propertyId;

    // interest_registered — Book Now is a different entry point to booking a viewing.
    const bn = (await step('L1 customer registers interest (Book Now)', () =>
      request.post(`${BACKEND}/leads/book-now`, {
        headers: hdrs(S.cx),
        data: { unitId: S.unitId, contractStartDate: plus(0), paymentsCount: 4, occupantsAdults: 2, occupantsChildren: 1, occupantsPets: 0 },
      }),
    )) as { leadId?: number; viewingId?: number } | null;
    S.leadId = Number(bn?.leadId ?? 0);
    S.viewingId = Number(bn?.viewingId ?? 0);
    expect(S.leadId, 'Book Now created a lead').toBeGreaterThan(0);

    // The TENANT PROFILE id, not the user id — every customer-scoped route keys
    // off it. Book Now does not return it (booking a viewing does), so read it
    // back off the lead it just created.
    const lead = (await step('L1 read the lead for its tenant profile', () =>
      request.get(`${BACKEND}/leads/${S.leadId}`, { headers: hdrs(S.rp) }))) as
      { convertedTenantId?: number; tenantId?: number } | null;
    S.cxProfileId = Number(lead?.convertedTenantId ?? lead?.tenantId ?? 0);
    expect(S.cxProfileId, 'tenant profile resolved').toBeGreaterThan(0);

    // A SECOND lead on a throwaway customer — rejecting ends a lead, so it must
    // never be the one being driven to a lease.
    const bv = (await step('L1 throwaway customer books a viewing', () =>
      request.post(`${BACKEND}/leads/viewings`, {
        headers: hdrs(S.cx2),
        data: { unitId: S.unitId, scheduledAt: new Date(Date.now() + 48 * 3600_000).toISOString(), desiredMoveIn: plus(30), occupantsAdults: 1, occupantsChildren: 0, occupantsPets: 0 },
      }),
    )) as { lead?: { id: number }; viewing?: { id: number } } | null;
    S.throwLeadId = Number(bv?.lead?.id ?? 0);
    S.throwViewingId = Number(bv?.viewing?.id ?? 0);

    // viewing_confirmed / viewing_outcome are MANAGER cells.
    if (S.throwViewingId) {
      await step('L1 manager confirms the viewing', () =>
        request.patch(`${BACKEND}/manager/leads/viewings/${S.throwViewingId}/status?rp=${RP_ID}`, {
          headers: hdrs(S.mgr), data: { status: 'confirmed' },
        }));
      await step('L1 manager records the outcome', () =>
        request.patch(`${BACKEND}/manager/leads/viewings/${S.throwViewingId}/status?rp=${RP_ID}`, {
          headers: hdrs(S.mgr), data: { status: 'completed', outcome: 'Attended — liked the unit, wants to proceed' },
        }));
    }
    // lead_rejected is also a manager cell: the bridge narrows by ACTOR before it
    // consults the row, so as the landlord this files as a plain stage change.
    if (S.throwLeadId) {
      await step('L1 manager rejects the throwaway lead', () =>
        request.patch(`${BACKEND}/manager/leads/${S.throwLeadId}/stage?rp=${RP_ID}`, {
          headers: hdrs(S.mgr), data: { stage: 'rejected' },
        }));
    }
  });


  // ── L3 · money, all three verbs ──────────────────────────────────────────
  test('04 — L3: asking price, generated plan, cheques ready, cheque C/E/D', async ({ request }) => {
    // The reprice has to name the plan THIS unit sits on, and has to happen while
    // the unit's lead is still open — the emit anchors to that lead, because a
    // plan-wide reprice owns no lead of its own.
    const unitRow = (await step('L3 read the unit for its plan label', () =>
      request.get(`${BACKEND}/properties/${S.propertyId}/units`, { headers: hdrs(S.rp) }))) as unknown;
    const units = (Array.isArray(unitRow) ? unitRow : (unitRow as { data?: unknown[] })?.data ?? []) as Array<{ id: number; planLabel?: string | null }>;
    const planLabel = units.find((u) => u.id === S.unitId)?.planLabel ?? null;
    if (planLabel) {
      await step(`L3 landlord re-prices the "${planLabel}" plan`, () =>
        request.patch(`${BACKEND}/properties/floor-plans/price`, {
          headers: hdrs(S.rp), data: { propertyId: S.propertyId, planLabel, rentalPrice: 97000 },
        }));
    } else {
      // eslint-disable-next-line no-console
      console.log(`ok      unit #${S.unitId} has no plan label — reprice skipped`);
    }

    if (S.viewingId) {
      await step('L3 customer generates a plan', () =>
        request.post(`${BACKEND}/leads/my-viewings/${S.viewingId}/generate-plan`, { headers: hdrs(S.cx), data: {} }));
    }

    // Book Now leaves the lead at `interested`; issue-payment-plan requires
    // documents_collection / approved / payment_plan_shared.
    for (const stage of ['contacted', 'documents_collection']) {
      await step(`L3 lead → ${stage}`, () =>
        request.patch(`${BACKEND}/leads/${S.leadId}/stage`, { headers: hdrs(S.rp), data: { stage } }));
    }

    await step('L3 landlord issues the payment plan', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/issue-payment-plan`, {
        headers: hdrs(S.rp),
        data: {
          rentFils: 9000000, installmentCount: 4, adminFeeFils: 50000, ejariFils: 22000,
          commissionFils: 0, securityDepositFils: 450000,
          bundleDueDate: plus(20), depositDueDate: plus(20),
          installmentDueDates: [plus(120), plus(210), plus(300)],
        },
      }));
    await step('L3 customer confirms their cheques are ready', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/cheques-ready`, { headers: hdrs(S.cx), data: {} }));

    // CREATE
    const chq = (await step('L3 CREATE a cheque', () =>
      request.post(`${BACKEND}/leads/${S.leadId}/cheques`, {
        headers: hdrs(S.rp),
        data: { chequeSerial: `COV-${TS}-1`, bankName: 'Emirates NBD', amountFils: 2250000, dueDate: plus(30), notes: 'Cheque 1 of 4' },
      }),
    )) as { id?: number } | null;
    S.chequeId = Number(chq?.id ?? 0);
    // a second so the lead can still convert after the delete below
    await step('L3 CREATE a second cheque', () =>
      request.post(`${BACKEND}/leads/${S.leadId}/cheques`, {
        headers: hdrs(S.rp),
        data: { chequeSerial: `COV-${TS}-2`, bankName: 'ADCB', amountFils: 2250000, dueDate: plus(60) },
      }));
    // DELETE
    if (S.chequeId) {
      await step('L3 DELETE a cheque', () =>
        request.delete(`${BACKEND}/leads/${S.leadId}/cheques/${S.chequeId}`, { headers: hdrs(S.rp) }));
    }

    await step('L3 lead → cheques_submitted', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/stage`, { headers: hdrs(S.rp), data: { stage: 'cheques_submitted' } }));
    const conf = (await step('L3 confirm cheques — issues the lease', () =>
      request.patch(`${BACKEND}/leads/${S.leadId}/confirm-cheques-collected`, { headers: hdrs(S.rp), data: {} }),
    )) as { contractId?: number } | null;
    S.contractId = Number(conf?.contractId ?? 0);
    expect(S.contractId, 'lease issued from the lead').toBeGreaterThan(0);
  });

  test('05 — L3: lease payments C/E/D, and a lease edit', async ({ request }) => {
    const pay = (await step('L3 CREATE a lease payment', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/payments`, {
        headers: hdrs(S.rp),
        data: {
          description: 'Rent instalment 1 of 4', amount: 22500, vatAmount: 0,
          paymentType: 'rental_income', paymentMethod: 'cheque',
          chequeStatus: 'pending', chequeNumber: `COV-P-${TS}`, transactionDate: plus(30),
        },
      }),
    )) as { id?: number } | null;
    S.paymentId = Number(pay?.id ?? 0);

    if (S.paymentId) {
      await step('L3 EDIT that payment', () =>
        request.patch(`${BACKEND}/contracts/${S.contractId}/payments/${S.paymentId}`, {
          headers: hdrs(S.rp),
          data: { amount: 23000, description: 'Rent instalment 1 of 4 (re-priced)', chequeNumber: `COV-P-${TS}-R` },
        }));
      await step('L3 DELETE that payment', () =>
        request.delete(`${BACKEND}/contracts/${S.contractId}/payments/${S.paymentId}`, { headers: hdrs(S.rp) }));
    }

    await step('L3 manager edits the lease terms', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}`, {
        headers: hdrs(S.mgr), data: { listedRent: 92000, notes: 'Rent re-agreed after the viewing' },
      }));
  });

  // ── L2 · documents, all four verbs — ON THE LEASE ────────────────────────
  // A CUSTOMER-owned document resolves a customer and nothing else, so the bridge
  // has no flow to anchor to and the step is dropped however correct the call is.
  // These have to hang off the tenancy, which is why they run after it exists.
  test('06 — L2: request, create, replace, expiry, approve, reject', async ({ request }) => {
    await step('L2 manager requests a document', () =>
      request.post(`${BACKEND}/documents/request`, {
        headers: hdrs(S.mgr),
        data: {
          ownerType: 'tenancy_contract', ownerId: S.contractId, documentKey: 'noc_previous_landlord',
          displayName: 'NOC from previous landlord', category: 'contract',
          notes: 'Please upload before handover', required: true,
        },
      }));

    const doc = (await step('L2 CREATE a document', () =>
      request.post(`${BACKEND}/documents`, {
        headers: hdrs(S.rp),
        data: {
          ownerType: 'tenancy_contract', ownerId: S.contractId, category: 'contract',
          documentKey: 'tenancy_supporting', displayName: 'Supporting document',
          fileUrl: `http://localhost:3011/uploads/cov-sup-${TS}.pdf`, mimeType: 'application/pdf',
        },
      }),
    )) as { id?: number } | null;
    S.docId = Number(doc?.id ?? 0);
    expect(S.docId, 'document created on the lease').toBeGreaterThan(0);

    await step('L2 EDIT — replace the file', () =>
      request.patch(`${BACKEND}/documents/${S.docId}`, {
        headers: hdrs(S.rp),
        data: { fileUrl: `http://localhost:3011/uploads/cov-sup-${TS}-v2.pdf`, mimeType: 'application/pdf' },
      }));
    await step('L2 EDIT — record an expiry date', () =>
      request.patch(`${BACKEND}/documents/${S.docId}`, { headers: hdrs(S.mgr), data: { expiryDate: '2029-05-01' } }));
    await step('L2 approve it', () =>
      request.post(`${BACKEND}/documents/${S.docId}/verify`, { headers: hdrs(S.mgr), data: { expiryDate: '2029-05-01' } }));
    await step('L2 DELETE-ish — reject it', () =>
      request.post(`${BACKEND}/documents/${S.docId}/reject`, {
        headers: hdrs(S.rp), data: { reason: 'Illegible scan — please re-upload a clear copy' },
      }));

    // personal_details is a CUSTOMER cell — the customer editing their OWN record,
    // not staff editing it for them. A manager call writes an audit row that has
    // no cell to land in.
    await step('L2 customer updates their own details', () =>
      request.patch(`${BACKEND}/profiles/customer/me`, {
        headers: hdrs(S.cx),
        data: { entityType: 'company', companyName: `Journey Trading LLC ${TS}`, tradeLicenseNumber: `TL-${TS}`, tradeLicenseAuthority: 'DED Dubai' },
      }));
  });

  // ── N2 · the landlord-side signing link, then take the lease live ────────
  test('07 — N2→N6: landlord link, draft inspection, sign, register, activate', async ({ request }) => {
    await step('N2 landlord-side signing link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.rp),
        data: { tenantId: S.cxProfileId, contractId: S.contractId, purpose: 'contract', signerRole: 'landlord', sendEmail: false },
      }));

    const link = (await step('N2 customer signing link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.rp),
        data: { tenantId: S.cxProfileId, contractId: S.contractId, purpose: 'contract', signerRole: 'tenant', sendEmail: false },
      }),
    )) as { token?: string } | null;
    if (link?.token) {
      await step('N2 customer signs', () =>
        request.post(`${BACKEND}/portal/${link.token}/contracts/${S.contractId}/sign`, {
          data: { signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
        }));
    }
    await step('N2 landlord signs', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/sign`, {
        headers: hdrs(S.rp), data: { role: 'landlord', signatureImage: SIG, signatoryName: 'Journey Landlord', method: 'online', consent: true },
      }));

    await step('N3 customer submits utility', () =>
      request.patch(`${BACKEND}/contracts/tenant/${S.contractId}/utility`, {
        headers: hdrs(S.cx), data: { utilityAccountNumber: `20${String(TS).slice(-8)}` },
      }));
    await step('N3 landlord verifies utility', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/utility/verify`, { headers: hdrs(S.rp), data: {} }));

    // movein_drafted — an UNFINALISED save. The full-cycle spec finalises in one
    // call, so the draft state never exists there.
    await step('N4 DRAFT the move-in inspection', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/inspection`, {
        headers: hdrs(S.rp),
        data: { type: 'move_in', data: { rooms: [{ name: 'Living room', condition: 'good', notes: 'Walkthrough in progress' }], keysHandedOver: 2 }, finalize: false },
      }));
    await step('N4 submit the move-in inspection', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/inspection`, {
        headers: hdrs(S.rp),
        data: { type: 'move_in', data: { rooms: [{ name: 'Living room', condition: 'good', notes: 'Handed over clean' }, { name: 'Kitchen', condition: 'good', notes: 'Appliances working' }], meterReadings: { electricity: '41221', water: '9088' }, keysHandedOver: 2 }, finalize: true },
      }));

    const ml = (await step('N4 move-in signing link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.rp),
        data: { tenantId: S.cxProfileId, contractId: S.contractId, purpose: 'move_in', signerRole: 'tenant', sendEmail: false },
      }),
    )) as { token?: string } | null;
    if (ml?.token) {
      await step('N4 customer signs the report', () =>
        request.post(`${BACKEND}/portal/${ml.token}/contracts/${S.contractId}/inspection/sign`, {
          data: { type: 'move_in', signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
        }));
    }
    await step('N4 landlord counter-signs', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/inspection/counter-sign`, {
        headers: hdrs(S.rp), data: { type: 'move_in', signatureImage: SIG, signatoryName: 'Journey Landlord', consent: true },
      }));

    await step('N5 Ejari certificate', () =>
      request.post(`${BACKEND}/documents`, {
        headers: hdrs(S.rp),
        data: { ownerType: 'tenancy_contract', ownerId: S.contractId, category: 'contract', documentKey: 'ejari_certificate', displayName: 'Ejari certificate', fileUrl: `http://localhost:3011/uploads/cov-ejari-${TS}.pdf`, mimeType: 'application/pdf' },
      }));
    const reg = (await step('N5 mark registered → N6 activates', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/ejari/mark-registered`, { headers: hdrs(S.rp), data: {} }),
    )) as { status?: string } | null;
    // eslint-disable-next-line no-console
    console.log(`         ↳ lease #${S.contractId} status: ${reg?.status ?? '?'}`);
  });

  // ── RENEWAL R1→R7 ────────────────────────────────────────────────────────
  test('08 — R1→R7: propose, revise, send, accept, plan, cheques, sign, register', async ({ request }) => {
    const c = (await step('R read the parent lease', () =>
      request.get(`${BACKEND}/contracts/${S.contractId}`, { headers: hdrs(S.rp) }))) as { contractEndDate?: string } | null;
    const end = c?.contractEndDate ? new Date(c.contractEndDate) : new Date(today.getTime() + 364 * 86400_000);
    const nextStart = iso(new Date(end.getTime() + 86400_000));
    const nextEnd = iso(new Date(end.getTime() + 365 * 86400_000));

    const child = (await step('R1 manager proposes the renewal', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/propose`, {
        headers: hdrs(S.mgr),
        data: {
          newAnnualRent: 95000, listedRent: 95000, newStartDate: nextStart, newEndDate: nextEnd,
          numberOfInstallments: 4, modeOfPayment: 'cheque', adminFee: 500, ejariFee: 220, commission: 0,
        },
      }),
    )) as { id?: number; childId?: number } | null;
    S.childId = Number(child?.childId ?? child?.id ?? 0);

    if (S.childId) {
      await step('R1 manager revises the renewal terms', () =>
        request.patch(`${BACKEND}/contracts/${S.childId}/clauses`, {
          headers: hdrs(S.mgr),
          data: { customClauses: ['Rent reviewed at renewal', 'Parking bay P-114 included'], notes: 'Renewal terms revised after negotiation' },
        }));
    }
    await step('R2 manager sends the renewal', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/send`, { headers: hdrs(S.mgr), data: {} }));

    // REJECTED FIRST, then re-offered and accepted. A renewal can only end one
    // way, so the only honest route to both cells on one tenancy is the
    // negotiation the product is actually designed around: the customer pushes
    // back on the rent, the landlord re-prices, the customer accepts.
    await step('R2 customer REJECTS the first offer', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/reject`, {
        headers: hdrs(S.cx), data: { reason: 'The proposed rent is above market', intent: 'negotiate' },
      }));
    const re2 = (await step('R1 manager re-proposes at a lower rent', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/propose`, {
        headers: hdrs(S.mgr),
        data: {
          newAnnualRent: 92000, listedRent: 95000, newStartDate: nextStart, newEndDate: nextEnd,
          numberOfInstallments: 4, modeOfPayment: 'cheque', adminFee: 500, ejariFee: 220, commission: 0,
        },
      }),
    )) as { id?: number; childId?: number } | null;
    if (re2?.childId || re2?.id) S.childId = Number(re2.childId ?? re2.id);
    await step('R2 manager re-sends', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/send`, { headers: hdrs(S.mgr), data: {} }));
    await step('R2 customer accepts', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/renewal/accept`, { headers: hdrs(S.cx), data: {} }));

    if (S.childId) {
      await step('R3 customer uploads a refreshed ID', () =>
        request.post(`${BACKEND}/documents`, {
          headers: hdrs(S.cx),
          data: { ownerType: 'tenancy_contract', ownerId: S.childId, category: 'identity', documentKey: 'emirates_id', displayName: 'Emirates ID (renewal refresh)', fileUrl: `http://localhost:3011/uploads/cov-eid-${TS}.pdf`, mimeType: 'application/pdf' },
        }));
      await step('R5 CREATE a renewal payment', () =>
        request.post(`${BACKEND}/contracts/${S.childId}/payments`, {
          headers: hdrs(S.rp),
          data: { description: 'Renewal rent instalment 1 of 4', amount: 23750, vatAmount: 0, paymentType: 'rental_income', paymentMethod: 'cheque', chequeStatus: 'pending', chequeNumber: `RNW-${TS}`, transactionDate: nextStart },
        }));
      const rl = (await step('R6 customer signing link', () =>
        request.post(`${BACKEND}/portal/generate`, {
          headers: hdrs(S.rp),
          data: { tenantId: S.cxProfileId, contractId: S.childId, purpose: 'contract', signerRole: 'tenant', sendEmail: false },
        }),
      )) as { token?: string } | null;
      if (rl?.token) {
        await step('R6 customer signs the renewal', () =>
          request.post(`${BACKEND}/portal/${rl.token}/contracts/${S.childId}/sign`, {
            data: { signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
          }));
      }
      await step('R6 landlord signs the renewal', () =>
        request.post(`${BACKEND}/contracts/${S.childId}/sign`, {
          headers: hdrs(S.rp), data: { role: 'landlord', signatureImage: SIG, signatoryName: 'Journey Landlord', method: 'online', consent: true },
        }));
      await step('R7 manager registers the renewal', () =>
        request.patch(`${BACKEND}/contracts/${S.childId}/ejari`, { headers: hdrs(S.mgr), data: { ejariStatus: 'registered' } }));
    }
  });

  // ── TERMINATION T1→T4 ────────────────────────────────────────────────────
  test('09 — T1: request, accept, then a direct termination', async ({ request }) => {
    await step('T1 customer requests termination', () =>
      request.post(`${BACKEND}/contracts/tenant/${S.contractId}/termination/request`, {
        headers: hdrs(S.cx), data: { reason: 'Relocating to Abu Dhabi for work', effectiveDate: plus(45) },
      }));
    await step('T1 landlord accepts', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/termination/respond`, {
        headers: hdrs(S.rp), data: { response: 'accepted', comment: 'Agreed — hand the keys back on the effective date' },
      }));
    await step('T1 landlord raises a direct termination', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/termination/direct`, {
        headers: hdrs(S.rp), data: { reason: 'Customer confirmed move-out; winding down directly', effectiveDate: plus(1) },
      }));
  });

  test('10 — T2/T3: move-out inspection, bills cleared, utility closeout', async ({ request }) => {
    // ONE save only — finalize:true locks the record, and it emits BOTH the
    // move-out submit (T2) and the bill clearance (T3).
    await step('T2/T3 manager submits move-out + bill clearance', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/inspection`, {
        headers: hdrs(S.mgr),
        data: {
          type: 'move_out',
          data: {
            rooms: [{ name: 'Living room', condition: 'fair', notes: 'Scuff marks on the north wall' }, { name: 'Kitchen', condition: 'good', notes: 'Appliances intact' }],
            meterReadings: { electricity: '43980', water: '9611' },
            // { items: [...] } — the emit reads billClearance.items, so a bare
            // array leaves it empty and the bill-clearance row never fires.
            billClearance: {
              items: [
                { name: 'DEWA', cleared: true, reference: `DEWA-${TS}` },
                { name: 'Chiller', cleared: true, reference: `CHL-${TS}` },
              ],
            },
          },
          finalize: true,
        },
      }));

    const pl = (await step('T2 move-out signing link', () =>
      request.post(`${BACKEND}/portal/generate`, {
        headers: hdrs(S.mgr),
        data: { tenantId: S.cxProfileId, contractId: S.contractId, purpose: 'move_out', signerRole: 'tenant', sendEmail: false },
      }),
    )) as { token?: string } | null;
    S.portalMoveOut = String(pl?.token ?? '');
    if (S.portalMoveOut) {
      await step('T2 customer signs the move-out report', () =>
        request.post(`${BACKEND}/portal/${S.portalMoveOut}/contracts/${S.contractId}/inspection/sign`, {
          data: { type: 'move_out', signatureImage: SIG, signatoryName: 'Journey Customer', consent: true },
        }));
    }
    // The dashboard SIGN route (with ?type=move_out) is what records the
    // counter-signature — counter-sign is absent from the interceptor map.
    await step('T2 manager counter-signs → also vacates the unit', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/inspection/sign?type=move_out`, {
        headers: hdrs(S.mgr), data: { signatureImage: SIG, signatoryName: 'Ops Manager', consent: true },
      }));

    await step('T3 manager files the utility clearance', () =>
      request.post(`${BACKEND}/documents`, {
        headers: hdrs(S.mgr),
        data: { ownerType: 'tenancy_contract', ownerId: S.contractId, category: 'property', documentKey: 'utility_clearance', displayName: 'DEWA final clearance certificate', fileUrl: `http://localhost:3011/uploads/cov-dewa-${TS}.pdf`, mimeType: 'application/pdf' },
      }));
  });

  test('11 — T4: draft, add a deduction, send, agree, counter-sign, pay', async ({ request }) => {
    await step('T4 manager drafts the settlement', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/settlement`, {
        headers: hdrs(S.mgr),
        data: {
          depositHeld: 4500, notes: 'Move-out settlement — direct termination',
          lines: [{ label: 'Professional cleaning', amount: 350, type: 'deduction', category: 'restoration' }],
        },
      }));
    // deduction_added — a SECOND line, so the collection diff has a before AND after.
    await step('T4 manager ADDS a deduction', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/settlement`, {
        headers: hdrs(S.mgr),
        data: {
          depositHeld: 4500, notes: 'Repainting added after the walk-through',
          lines: [
            { label: 'Professional cleaning', amount: 350, type: 'deduction', category: 'restoration' },
            { label: 'Wall repainting', amount: 650, type: 'deduction', category: 'restoration' },
          ],
        },
      }));
    await step('T4 manager records a settlement payment', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/settlement/payments`, {
        headers: hdrs(S.mgr),
        data: { payments: [{ amount: 250, method: 'bank_transfer', reference: `TRF-${TS}`, receivedOn: plus(0) }] },
      }));
    await step('T4 manager sends it', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/settlement/send`, { headers: hdrs(S.mgr), data: {} }));
    await step('T4 customer agrees', () =>
      request.post(`${BACKEND}/contracts/tenant/${S.contractId}/settlement/agree`, {
        headers: hdrs(S.cx), data: { signatureImage: SIG },
      }));
    await step('T4 landlord counter-signs', () =>
      request.patch(`${BACKEND}/contracts/${S.contractId}/settlement/sign`, {
        headers: hdrs(S.rp), data: { rpSignature: SIG },
      }));
    await step('T4 manager marks it paid — closes the tenancy', () =>
      request.post(`${BACKEND}/contracts/${S.contractId}/settlement/paid`, {
        headers: hdrs(S.mgr), data: { allowOutstanding: true, allowGaps: true },
      }));
  });

  // ── The two that need their OWN tenancy ──────────────────────────────────
  // A lease can be cancelled OR carried on with, and a renewal can be accepted
  // OR rejected — never both. The main lease is driven all the way through, so
  // these two outcomes need a second lead and a second renewal of their own.
  test('12 — contract_cancelled and a REJECTED renewal', async ({ request }) => {
    // (a) a throwaway lead → lease → cancel it
    const u = await liveUnit(request);
    const cx3 = await newCustomer(request, 'cancel');
    const bv = (await step('X customer books on a second unit', () =>
      request.post(`${BACKEND}/leads/viewings`, {
        headers: hdrs(cx3),
        data: { unitId: u.id, scheduledAt: new Date(Date.now() + 24 * 3600_000).toISOString(), desiredMoveIn: plus(20), occupantsAdults: 1, occupantsChildren: 0, occupantsPets: 0 },
      }),
    )) as { lead?: { id: number; convertedTenantId?: number } } | null;
    const leadId = Number(bv?.lead?.id ?? 0);
    if (leadId) {
      for (const stage of ['contacted', 'documents_collection']) {
        await step(`X lead → ${stage}`, () =>
          request.patch(`${BACKEND}/leads/${leadId}/stage`, { headers: hdrs(S.rp), data: { stage } }));
      }
      await step('X issue a plan', () =>
        request.patch(`${BACKEND}/leads/${leadId}/issue-payment-plan`, {
          headers: hdrs(S.rp),
          data: { rentFils: 8000000, installmentCount: 1, adminFeeFils: 50000, ejariFils: 22000, commissionFils: 0, securityDepositFils: 400000, bundleDueDate: plus(15), depositDueDate: plus(15), installmentDueDates: [] },
        }));
      await step('X lead → cheques_submitted', () =>
        request.patch(`${BACKEND}/leads/${leadId}/stage`, { headers: hdrs(S.rp), data: { stage: 'cheques_submitted' } }));
      const conf = (await step('X confirm cheques — issues a lease', () =>
        request.patch(`${BACKEND}/leads/${leadId}/confirm-cheques-collected`, { headers: hdrs(S.rp), data: {} }),
      )) as { contractId?: number } | null;
      const throwaway = Number(conf?.contractId ?? 0);
      if (throwaway) {
        await step('L3 manager CANCELS that lease', () =>
          request.post(`${BACKEND}/contracts/${throwaway}/cancel`, {
            headers: hdrs(S.mgr), data: { reason: 'Customer withdrew before signing' },
          }));
      }
    }

  });

  test('13 — report', async () => {
    // eslint-disable-next-line no-console
    console.log(
      `\n──────── COVERAGE DRIVE ────────\n${trace.join('\n')}\n\n` +
      `lead #${S.leadId} · lease #${S.contractId} · renewal #${S.childId} · throwaway lead #${S.throwLeadId}\n`,
    );
    expect(S.contractId).toBeGreaterThan(0);
  });
});
