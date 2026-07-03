/**
 * E2E — Lead DETAIL page DEEP interactions (two-sided, back-and-forth).
 *
 * Verifies the real functionality end-to-end by performing each action through
 * the detail-page UI and asserting the BACKEND STATE actually changed:
 *   A. Documents: RP reject-with-reason → customer re-upload → RP approve
 *   B. Payment plan: RP edits the plan (rent) inline
 *   C. Cheque collection: customer uploads → RP reviews → approve → convert
 *   D. Reject → reopen (header, with confirm dialog)
 *
 * Customer-side uploads (docs + cheque images) are created via API with fake
 * URLs (no real storage), mirroring the existing phase3 / lead-payment specs.
 * RP is the throwaway compliant fixture rp.leaddetail.e2e@example.com.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'rp.leaddetail.e2e@example.com';
const TS = Date.now();
const SHOTS = 'test-results/lead-detail-interactions';

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  return ((await r2.json()) as { access_token: string }).access_token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const setCookie = (page: Page, token: string) =>
  page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

/** Create a customer-owned KYC doc row (no real file needed). Returns doc id. */
async function createDoc(request: APIRequestContext, custToken: string, tenantId: number, key: string): Promise<number> {
  const res = await request.post(`${BACKEND}/documents`, {
    headers: auth(custToken),
    data: { ownerType: 'customer', ownerId: tenantId, category: 'identity', documentKey: key,
      displayName: key, fileUrl: `http://test.local/${key}-${Date.now()}.jpg`, mimeType: 'image/jpeg' },
  });
  expect(res.status(), `createDoc ${key}: ${res.status()} ${await res.text().catch(() => '')}`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}
async function docStatus(request: APIRequestContext, rpToken: string, tenantId: number, key: string): Promise<string | undefined> {
  const list = await (await request.get(`${BACKEND}/documents?ownerType=customer&ownerId=${tenantId}`, { headers: auth(rpToken) })).json() as Array<{ documentKey: string; status: string }>;
  return list.filter(d => d.documentKey === key).pop()?.status;
}

/** Spin up a fresh lead and drive it (via API) to a target stage. rpToken must be set. */
async function advanceLead(request: APIRequestContext, rpToken: string, unitId: number, target: 'interested' | 'plan' | 'cheques') {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const reg = await request.post(`${BACKEND}/auth/register/customer`, { data: { email: `cust.adv.${stamp}@example.com`, phone: `+9715${stamp.slice(-8)}` } });
  const custToken = ((await reg.json()) as { access_token: string }).access_token;
  const book = await request.post(`${BACKEND}/leads/viewings`, { headers: auth(custToken), data: { unitId, scheduledAt: new Date(Date.now() + 36e5 * 48).toISOString(), notes: 'adv', preferredChequeCount: 4 } });
  const b = (await book.json()) as { lead: { id: number; convertedTenantId: number }; viewing: { id: number } };
  const leadId = b.lead.id, viewingId = b.viewing.id, tenantId = b.lead.convertedTenantId;
  await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, { headers: auth(rpToken), data: { status: 'completed' } });
  await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/express-interest`, { headers: auth(custToken), data: { contractStartDate: '2026-08-01', paymentsCount: 4, occupantsAdults: 1 } });
  if (target === 'plan' || target === 'cheques') {
    // Two-step: approve documents → APPROVED (plan draft), then share → payment_plan_shared.
    await request.patch(`${BACKEND}/leads/${leadId}/approve-documents`, { headers: auth(rpToken) });
    await request.patch(`${BACKEND}/leads/${leadId}/share-plan`, { headers: auth(rpToken) });
  }
  if (target === 'cheques') {
    await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, { headers: auth(custToken), data: { imageUrl: 'http://test.local/c1.jpg', fileKey: `adv-${viewingId}/c1`, label: 'Cheque 1' } });
    await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, { headers: auth(custToken) });
  }
  return { leadId, viewingId, tenantId, custToken };
}

test.describe.serial('Lead detail — deep interactions', () => {
  let rpToken = '', custToken = '';
  let unitId = 0, leadId = 0, viewingId = 0, tenantId = 0;
  const url = () => `/rental-provider/dashboard/leads/${leadId}`;

  test.beforeEach(async ({ page }) => { if (rpToken) await setCookie(page, rpToken); });

  test('setup — unit + fresh lead advanced to interested with uploaded docs', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);
    const props = await (await request.get(`${BACKEND}/properties`, { headers: auth(rpToken) })).json() as Array<{ id: number }>;
    const propertyId = props[0].id;
    const u = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
      data: { unitNumber: `LDX-${TS}`, unitName: `LeadDetail Interactions ${TS}`, unitType: 'apartment',
        rentalPrice: 132000, securityDeposit: 6600, adminFee: 1050, ejariFeeFils: 22000, commission: 6600, availability: 'available' },
    });
    unitId = ((await u.json()) as { id: number }).id;
    await request.patch(`${BACKEND}/properties/${propertyId}/units/${unitId}/toggle-listing`, { headers: auth(rpToken) });

    const reg = await request.post(`${BACKEND}/auth/register/customer`, { data: { email: `cust.ldx.${TS}@example.com`, phone: `+9715${(TS).toString().slice(-8)}` } });
    custToken = ((await reg.json()) as { access_token: string }).access_token;
    const book = await request.post(`${BACKEND}/leads/viewings`, {
      headers: auth(custToken),
      data: { unitId, scheduledAt: new Date(Date.now() + 36e5 * 48).toISOString(), notes: 'ldx', preferredChequeCount: 4 },
    });
    const b = (await book.json()) as { lead: { id: number; convertedTenantId: number }; viewing: { id: number } };
    leadId = b.lead.id; viewingId = b.viewing.id; tenantId = b.lead.convertedTenantId;

    // Advance to interested (mark visited + express interest → auto plan)
    await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, { headers: auth(rpToken), data: { status: 'completed' } });
    await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/express-interest`, { headers: auth(custToken), data: { contractStartDate: '2026-08-01', paymentsCount: 4, occupantsAdults: 1 } });
    // Customer uploads two KYC docs
    await createDoc(request, custToken, tenantId, 'emirates_id_front');
    await createDoc(request, custToken, tenantId, 'passport');
  });

  test('A. documents — reject-with-reason → re-upload → approve (backend verified)', async ({ page, request }) => {
    await page.goto(url(), { waitUntil: 'networkidle' });
    // Both docs render as rows
    await expect(page.locator('.docitem').filter({ hasText: 'Emirates ID' }).first()).toBeVisible({ timeout: 8000 });
    const passportRow = page.locator('.docitem').filter({ hasText: 'Passport' }).first();
    await expect(passportRow).toBeVisible();

    // Reject the passport WITH a reason
    await passportRow.locator('.mini-btn.no').click();
    const modal = page.locator('.qmodal');
    await expect(modal).toBeVisible();
    await modal.locator('.qinput').fill('Photo is blurry — please re-scan');
    await modal.getByRole('button', { name: /^Reject$/ }).click();
    await expect(modal).toBeHidden({ timeout: 6000 });
    // BACKEND verified: passport now rejected
    await expect.poll(() => docStatus(request, rpToken, tenantId, 'passport'), { timeout: 6000 }).toBe('rejected');
    await page.screenshot({ path: `${SHOTS}/A1-doc-rejected.png`, fullPage: true });

    // Approve the Emirates ID — Front
    await page.locator('.docitem').filter({ hasText: 'Emirates ID' }).first().locator('.mini-btn.ok').click();
    await expect.poll(() => docStatus(request, rpToken, tenantId, 'emirates_id_front'), { timeout: 6000 }).toBe('processed');

    // Customer re-uploads the passport → RP sees a fresh pending row
    await createDoc(request, custToken, tenantId, 'passport');
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.docitem').filter({ hasText: 'Passport' }).first()).toBeVisible();
    await expect.poll(() => docStatus(request, rpToken, tenantId, 'passport'), { timeout: 6000 }).not.toBe('rejected'); // newest is pending
  });

  test('B. payment plan — RP reviews & edits the rent inline BEFORE sharing (backend verified)', async ({ page, request }) => {
    // Approve docs → APPROVED plan draft (the customer does NOT see it yet).
    await request.patch(`${BACKEND}/leads/${leadId}/approve-documents`, { headers: auth(rpToken) });
    await page.goto(url(), { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/review the plan/i);

    await page.getByRole('button', { name: /Edit plan/i }).click();
    const rent = page.getByPlaceholder(/e\.g\. 85000/i);
    await expect(rent).toBeVisible();
    await rent.fill('120000');
    await page.getByRole('button', { name: /Update plan/i }).click();

    // BACKEND verified: plan rent changed to 120,000 (12,000,000 fils)
    await expect.poll(async () => {
      const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { paymentPlan?: { rentFils: number } };
      return lead.paymentPlan?.rentFils;
    }, { timeout: 8000 }).toBe(12_000_000);
    // Editing the DRAFT must NOT share it — the lead stays on 'approved'.
    const st = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { stage: string };
    expect(st.stage).toBe('approved');
    await page.screenshot({ path: `${SHOTS}/B-plan-edited.png`, fullPage: true });
  });

  test('C. cheque collection — customer uploads render, RP approves → converts', async ({ page, request }) => {
    // Test B left the plan as a draft (approved). Share it so the customer can
    // see the plan and upload cheques (payment_plan_shared).
    await request.patch(`${BACKEND}/leads/${leadId}/share-plan`, { headers: auth(rpToken) });
    // Customer uploads 2 cheque images, then marks ready → cheques_submitted
    for (let i = 1; i <= 2; i++) {
      await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/cheque-uploads`, {
        headers: auth(custToken), data: { imageUrl: `http://test.local/cheque-${i}.jpg`, fileKey: `ldx-${TS}/c${i}`, label: `Cheque ${i}` },
      });
    }
    await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, { headers: auth(custToken) });

    await page.goto(url(), { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Payment advice/i);
    // Customer uploads are surfaced (2 cheque references)
    await expect(page.locator('.acard')).toContainText(/Cheque 1/i, { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/C1-cheques.png`, fullPage: true });
    await page.locator('.chqbox').scrollIntoViewIfNeeded();
    await page.locator('.chqbox').screenshot({ path: `${SHOTS}/C2-payments-section.png` });

    // Approve → convert
    await page.getByRole('button', { name: /Payment review & approve/i }).click();
    await expect(page.locator('.acard h2')).toContainText(/converted/i, { timeout: 12000 });
    // BACKEND verified
    await expect.poll(async () => {
      const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { stage: string };
      return lead.stage;
    }, { timeout: 8000 }).toBe('converted');
    await page.screenshot({ path: `${SHOTS}/C2-converted.png`, fullPage: true });
  });

  test('D. reject → reopen (header, confirm dialog)', async ({ page, request }) => {
    // Fresh lead for a clean reject/reopen
    const reg = await request.post(`${BACKEND}/auth/register/customer`, { data: { email: `cust.rj.${TS}@example.com`, phone: `+9715${(TS + 7).toString().slice(-8)}` } });
    const t2 = ((await reg.json()) as { access_token: string }).access_token;
    const book = await request.post(`${BACKEND}/leads/viewings`, { headers: auth(t2), data: { unitId, scheduledAt: new Date(Date.now() + 36e5 * 72).toISOString(), notes: 'rj' } });
    const rid = ((await book.json()) as { lead: { id: number } }).lead.id;

    page.on('dialog', d => d.accept());   // header Reject has a window.confirm guard
    await page.goto(`/rental-provider/dashboard/leads/${rid}`, { waitUntil: 'networkidle' });
    await page.locator('.qhead').getByRole('button', { name: /^Reject/i }).click();
    await expect(page.locator('.acard h2')).toContainText(/Rejected/i, { timeout: 8000 });
    await expect.poll(async () => ((await (await request.get(`${BACKEND}/leads/${rid}`, { headers: auth(rpToken) })).json()) as { stage: string }).stage, { timeout: 6000 }).toBe('rejected');

    await page.locator('.qhead').getByRole('button', { name: /^Reopen$/i }).click();
    const rm = page.locator('.qmodal');
    await expect(rm).toBeVisible();
    await rm.getByRole('button', { name: /notify customer/i }).click();   // reopen (no note)
    await expect(page.locator('.acard h2')).toContainText(/Viewing/i, { timeout: 8000 });
  });

  test('E. require additional document — RP requests a custom doc (backend verified)', async ({ page, request }) => {
    const L = await advanceLead(request, rpToken, unitId, 'interested');
    await page.goto(`/rental-provider/dashboard/leads/${L.leadId}`, { waitUntil: 'networkidle' });
    const combo = page.getByPlaceholder(/Search or type a document name/i);
    await expect(combo).toBeVisible({ timeout: 8000 });
    await combo.fill('Reference Letter QA');
    await combo.press('Enter');                                  // custom (no match) → adds to the request list
    await expect(page.locator('.docitem').filter({ hasText: 'Reference Letter QA' })).toBeVisible();
    await page.getByRole('button', { name: /Save request/i }).click();
    // BACKEND verified: the request persisted onto the lead's additionalDocsNote
    await expect.poll(async () =>
      ((await (await request.get(`${BACKEND}/leads/${L.leadId}`, { headers: auth(rpToken) })).json()) as { additionalDocsNote?: string }).additionalDocsNote ?? '',
      { timeout: 8000 }).toContain('Reference Letter QA');
    await page.screenshot({ path: `${SHOTS}/E-additional-doc.png`, fullPage: true });
  });

  test('F. upload document on behalf of customer (storage mocked → real doc row)', async ({ page, request }) => {
    const L = await advanceLead(request, rpToken, unitId, 'interested');
    // Mock the signed-URL handshake so no real bucket is touched; the register POST /documents is REAL.
    await page.route('**/api/documents/upload-url', r => r.fulfill({ status: 201, contentType: 'application/json',
      body: JSON.stringify({ uploadUrl: 'https://fake.storage.local/put', fileUrl: 'http://test.local/eid-back.jpg', fileKey: 'test/eid-back.jpg' }) }));
    await page.route('https://fake.storage.local/put', r => r.fulfill({ status: 200, body: '' }));
    await page.goto(`/rental-provider/dashboard/leads/${L.leadId}`, { waitUntil: 'networkidle' });
    const backRow = page.locator('.docitem').filter({ hasText: 'Emirates ID — Back' });
    await expect(backRow).toBeVisible({ timeout: 8000 });
    await backRow.locator('input[type=file]').setInputFiles({ name: 'eid-back.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('fake-image-bytes') });
    // BACKEND verified: an emirates_id_back doc row now exists for the customer
    await expect.poll(() => docStatus(request, rpToken, L.tenantId, 'emirates_id_back'), { timeout: 12000 }).toBeTruthy();
    await page.screenshot({ path: `${SHOTS}/F-upload-on-behalf.png`, fullPage: true });
  });

  test('G. per-cheque tagging — method + map-to-installment (backend verified)', async ({ page, request }) => {
    const L = await advanceLead(request, rpToken, unitId, 'cheques');
    await page.goto(`/rental-provider/dashboard/leads/${L.leadId}`, { waitUntil: 'networkidle' });
    const row = page.locator('.uprow').first();
    await expect(row).toBeVisible({ timeout: 8000 });
    const chequePM = async () => {
      const cs = await (await request.get(`${BACKEND}/leads/${L.leadId}/cheques`, { headers: auth(rpToken) })).json() as Array<{ isCustomerUpload: boolean; paymentMethod: string | null; planItemIndex: number | null }>;
      return cs.find(c => c.isCustomerUpload);
    };
    // method select (1st) → bank_transfer
    await row.locator('select').first().selectOption('bank_transfer');
    await expect.poll(async () => (await chequePM())?.paymentMethod, { timeout: 8000 }).toBe('bank_transfer');
    // map-to-installment select (2nd) → first real instalment
    await row.locator('select').nth(1).selectOption({ index: 1 });
    await expect.poll(async () => (await chequePM())?.planItemIndex, { timeout: 8000 }).not.toBeNull();
    await page.screenshot({ path: `${SHOTS}/G-cheque-tag.png`, fullPage: true });
  });

  test('H. journey is CLICKABLE — inspect a completed & an upcoming step, then return', async ({ page, request }) => {
    const L = await advanceLead(request, rpToken, unitId, 'cheques'); // current = Payment advice (node 4)
    await page.goto(`/rental-provider/dashboard/leads/${L.leadId}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Payment advice/i);

    // Click the "Viewing" waypoint (node 0 — completed) → read-only preview
    await page.locator('.qmap svg g.wp').nth(0).click();
    await expect(page.locator('.acard h2')).toContainText(/^Viewing$/i, { timeout: 6000 });
    await expect(page.locator('.acard')).toContainText(/Completed/i);
    await expect(page.locator('.acard')).toContainText(/Return to current step/i);
    await expect(page.locator('.youare .yl')).toContainText(/Completed step/i);

    // Click an upcoming waypoint (node 5 — Converted) → "Upcoming"
    await page.locator('.qmap svg g.wp').nth(5).click();
    await expect(page.locator('.acard')).toContainText(/Upcoming/i, { timeout: 6000 });

    // Return to the real current step
    await page.getByRole('button', { name: /Return to current step/i }).click();
    await expect(page.locator('.acard h2')).toContainText(/Payment advice/i, { timeout: 6000 });
    await page.screenshot({ path: `${SHOTS}/H-journey-clickable.png`, fullPage: true });
  });

  test('I. reopen a CUSTOMER-declined lead revives the viewing (customer no longer declined)', async ({ page, request }) => {
    // Fresh lead, then the customer marks not-interested → lead rejected + viewing cancelled/not_interested
    const reg = await request.post(`${BACKEND}/auth/register/customer`, { data: { email: `cust.reopen.${TS}@example.com`, phone: `+9715${(TS + 3).toString().slice(-8)}` } });
    const ct = ((await reg.json()) as { access_token: string }).access_token;
    const book = await request.post(`${BACKEND}/leads/viewings`, { headers: auth(ct), data: { unitId, scheduledAt: new Date(Date.now() + 36e5 * 48).toISOString(), notes: 'reopen' } });
    const b = (await book.json()) as { lead: { id: number }; viewing: { id: number } };
    const lid = b.lead.id, vid = b.viewing.id;
    // Customer declines WITH a reason. That reason must land in declineNote WITHOUT
    // clobbering the original booking notes ('reopen').
    await request.patch(`${BACKEND}/leads/my-viewings/${vid}/not-interested`, { headers: auth(ct), data: { notes: 'changed my mind — found a cheaper place' } });
    // rejected + viewing cancelled/not_interested (this is what makes the CUSTOMER show "declined")
    const before = await (await request.get(`${BACKEND}/leads/${lid}`, { headers: auth(rpToken) })).json() as { stage: string; viewings?: Array<{ id: number; status: string; outcome?: string | null; notes?: string | null; declineNote?: string | null }> };
    expect(before.stage).toBe('rejected');
    const bv = before.viewings?.find(v => v.id === vid);
    expect(bv?.outcome).toBe('not_interested');
    // The RP can see WHAT the customer wrote on rejection — in its own field.
    expect(bv?.declineNote ?? '').toContain('found a cheaper place');
    // …and the original booking notes were NOT overwritten.
    expect(bv?.notes ?? '').toBe('reopen');

    // RP DETAIL page surfaces the customer's decline reason before any reopen.
    await page.goto(`/rental-provider/dashboard/leads/${lid}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Rejected/i);
    const declineBanner = page.locator('.qbanner').filter({ hasText: /reason for declining/i });
    await expect(declineBanner).toBeVisible();
    await expect(declineBanner).toContainText('found a cheaper place');
    await page.screenshot({ path: `${SHOTS}/I-decline-reason.png`, fullPage: true });

    // RP reopens via the UI — the modal asks for a note the customer will see
    await page.locator('.qhead').getByRole('button', { name: /^Reopen$/i }).click();
    const rm = page.locator('.qmodal');
    await expect(rm).toBeVisible();
    await rm.getByRole('textbox').fill('We can offer AED 120,000 — please take another look.');
    await rm.getByRole('button', { name: /notify customer/i }).click();
    await expect(page.locator('.acard h2')).toContainText(/Viewing/i, { timeout: 8000 });

    // BACKEND verified: viewing revived + the RP note persisted → customer's declined-derivation
    // no longer triggers and the note is surfaced to the customer.
    const after = await (await request.get(`${BACKEND}/leads/${lid}`, { headers: auth(rpToken) })).json() as { stage: string; viewings?: Array<{ id: number; status: string; outcome?: string | null; reopenNote?: string | null; declineNote?: string | null }> };
    expect(after.stage).toBe('viewing_scheduled');
    const v = after.viewings?.find(x => x.id === vid);
    expect(v?.status).toBe('scheduled');
    expect(v?.outcome ?? null).toBeNull();
    expect(v?.reopenNote ?? '').toContain('AED 120,000');
    // Reviving the lead clears the now-stale decline reason.
    expect(v?.declineNote ?? null).toBeNull();

    // CUSTOMER verified: the reopen note reaches the customer's viewing feed.
    const mine = await (await request.get(`${BACKEND}/leads/my-viewings`, { headers: auth(ct) })).json() as Array<{ id: number; reopenNote?: string | null }>;
    expect(mine.find(x => x.id === vid)?.reopenNote ?? '').toContain('AED 120,000');
  });

  test('J. "View all documents" opens every uploaded file together in the viewer', async ({ page, request }) => {
    // Fresh lead with three uploaded identity docs so the button counts them.
    const L = await advanceLead(request, rpToken, unitId, 'interested');
    await createDoc(request, L.custToken, L.tenantId, 'emirates_id_front');
    await createDoc(request, L.custToken, L.tenantId, 'emirates_id_back');
    await createDoc(request, L.custToken, L.tenantId, 'passport');

    await page.goto(`/rental-provider/dashboard/leads/${L.leadId}`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: /View all documents \(3\)/i });
    await expect(btn).toBeVisible({ timeout: 8000 });
    await btn.click();
    // Opens the shared DocumentReaderModal (sidebar list + gallery preview) — the
    // same reader the tenant / property / unit views use. Assert its summary +
    // a requirement slot in the sidebar.
    await expect(page.getByText(/3 uploaded ·/i)).toBeVisible({ timeout: 6000 });
    await expect(page.getByText(/Passport/i).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/J-view-all-docs.png`, fullPage: true });
  });
});
