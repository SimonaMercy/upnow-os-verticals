/**
 * E2E — KYC document gating on the customer paperwork step (v-<leadId>).
 *
 * Verifies:
 *   A. UAE Visa / Residency is OPTIONAL by default — the customer can submit
 *      once the three required identity docs + personal details are in, WITHOUT
 *      uploading the visa. (It no longer silently blocks the gate.)
 *   B. When the RP requests "UAE Visa / Residence Visa" as an additional
 *      document, the EXISTING visa slot is promoted to Required (badge flips)
 *      and NO duplicate "Requested by your rental provider" slot is created.
 *      Submit is then blocked until the visa is uploaded.
 *   C. Uploading the visa fulfils the promoted requirement and unblocks submit
 *      (the customer is not stuck behind a phantom additional_* key).
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'rp.leaddetail.e2e@example.com';
const TS = Date.now();
const SHOTS = 'test-results/kyc-gating';

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

async function leadAtPaperwork(request: APIRequestContext, rpToken: string, unitId: number, tag: string) {
  const reg = await request.post(`${BACKEND}/auth/register/customer`, {
    data: { email: `cust.kyc.${tag}.${TS}@example.com`, phone: `+9715${(TS + Math.floor(Math.random() * 100000)).toString().slice(-8)}` },
  });
  const custToken = ((await reg.json()) as { access_token: string }).access_token;
  const book = await request.post(`${BACKEND}/leads/viewings`, {
    headers: auth(custToken),
    data: { unitId, scheduledAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), notes: `kyc ${tag}`, desiredMoveIn: '2026-09-01', preferredChequeCount: 4 },
  });
  const b = (await book.json()) as { lead: { id: number }; viewing: { id: number } };
  await request.patch(`${BACKEND}/leads/viewings/${b.viewing.id}/status`, { headers: auth(rpToken), data: { status: 'completed' } });
  await request.post(`${BACKEND}/leads/my-viewings/${b.viewing.id}/express-interest`, {
    headers: auth(custToken), data: { contractStartDate: '2026-09-01', paymentsCount: 4, occupantsAdults: 1 },
  });
  const rpLead = await (await request.get(`${BACKEND}/leads/${b.lead.id}`, { headers: auth(rpToken) })).json() as { convertedTenantId?: number };
  return { leadId: b.lead.id, custToken, tenantId: rpLead.convertedTenantId ?? 0 };
}

/** Create a document row for the customer (storage metadata only). */
async function putDoc(request: APIRequestContext, custToken: string, tenantId: number, key: string, category = 'identity') {
  const r = await request.post(`${BACKEND}/documents`, {
    headers: auth(custToken),
    data: { ownerType: 'customer', ownerId: tenantId, documentKey: key, category, displayName: key, fileUrl: `http://test.local/${key}.jpg`, mimeType: 'image/jpeg', s3Key: `test/${key}-${TS}-${Math.random().toString(36).slice(2)}.jpg`, storageProvider: 's3' },
  });
  expect(r.ok(), `doc ${key}: ${r.status()}`).toBeTruthy();
}

/** Fill the identity details so personalDetailsComplete is satisfied. */
async function fillIdentity(request: APIRequestContext, custToken: string) {
  await request.patch(`${BACKEND}/auth/me`, { headers: auth(custToken), data: { firstName: 'Sara', lastName: 'Khan', emiratesIdNumber: '784-1992-7654321-2', nationality: 'Pakistan', gender: 'female' } });
}

const spaceUrl = (leadId: number) => `/dashboard/customer/spaces/v2/v-${leadId}`;
// A doc row is a [data-doc-key] div; only its small action pill is a <label>
// (a row-wide label would hand every click to the preview button — see KycDocRow).
const visaRow = (page: Page) => page.locator('[data-doc-key]').filter({ hasText: 'UAE Visa / Residency' });

test.describe.serial('Customer KYC — UAE Visa gating', () => {
  let rpToken = '';
  let unitId = 0;

  test('setup — RP published residential unit', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);
    const props = await (await request.get(`${BACKEND}/properties`, { headers: auth(rpToken) })).json() as Array<{ id: number }>;
    const unitRes = await request.post(`${BACKEND}/properties/${props[0].id}/units`, {
      headers: auth(rpToken),
      data: { unitNumber: `KYC-${TS}`, unitName: `KYC Gating Test ${TS}`, unitType: 'apartment', rentalPrice: 88000, securityDeposit: 4400, adminFee: 1050, availability: 'available' },
    });
    unitId = ((await unitRes.json()) as { id: number }).id;
    await request.patch(`${BACKEND}/properties/${props[0].id}/units/${unitId}/toggle-listing`, { headers: auth(rpToken) });
  });

  test('A. UAE Visa is OPTIONAL by default — submit reachable without it', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'optional');
    await fillIdentity(request, L.custToken);

    // First, with nothing uploaded the KYC section is expanded → the visa row is
    // visible and labelled Optional (not Required).
    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });
    await expect(visaRow(page)).toBeVisible({ timeout: 10000 });
    await expect(visaRow(page)).toContainText(/Optional/i);
    await expect(visaRow(page)).not.toContainText(/Required/i);
    await page.screenshot({ path: `${SHOTS}/A-visa-optional.png`, fullPage: true });

    // Upload only the three REQUIRED identity docs (no visa) → submit unlocks.
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_front');
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_back');
    await putDoc(request, L.custToken, L.tenantId, 'passport');
    await page.reload({ waitUntil: 'networkidle' });
    const submit = page.getByRole('button', { name: /Submit documents for review/i });
    await expect(submit).toBeVisible({ timeout: 10000 });
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: `${SHOTS}/A-submit-reachable.png`, fullPage: true });
  });

  test('B. RP requests the visa → existing slot becomes Required, no duplicate, blocks submit', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'promote');
    await fillIdentity(request, L.custToken);
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_front');
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_back');
    await putDoc(request, L.custToken, L.tenantId, 'passport');
    // RP requests the UAE Visa (different wording than the KYC label).
    await request.patch(`${BACKEND}/leads/${L.leadId}/additional-docs-note`, { headers: auth(rpToken), data: { items: ['UAE Visa / Residence Visa'] } });

    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    // The EXISTING visa row is now Required…
    await expect(visaRow(page)).toBeVisible({ timeout: 10000 });
    await expect(visaRow(page)).toContainText(/Required/i);
    // …and NO duplicate "Requested by your rental provider" slot was created.
    await expect(page.getByText('Requested by your rental provider')).toHaveCount(0);
    // Submit is blocked until the visa is uploaded.
    await expect(page.getByRole('button', { name: /Submit documents for review/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Upload all required docs/i })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/B-visa-required.png`, fullPage: true });
  });

  test('C. Uploading the visa fulfils the promoted requirement → submit unblocks', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'fulfil');
    await fillIdentity(request, L.custToken);
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_front');
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_back');
    await putDoc(request, L.custToken, L.tenantId, 'passport');
    await request.patch(`${BACKEND}/leads/${L.leadId}/additional-docs-note`, { headers: auth(rpToken), data: { items: ['UAE Visa / Residence Visa'] } });
    // Customer uploads the visa into the STANDARD slot (uae_visa), not a phantom key.
    await putDoc(request, L.custToken, L.tenantId, 'uae_visa');

    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    // All required docs (incl. the promoted visa) are in → KYC section collapses
    // to "Done" and the submit gate is reachable — the customer is NOT stuck
    // behind a phantom additional_* key.
    await expect(page.getByText('Identity documents (KYC)')).toBeVisible({ timeout: 10000 });
    const submit = page.getByRole('button', { name: /Submit documents for review/i });
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: `${SHOTS}/C-visa-fulfilled.png`, fullPage: true });
  });

  test('D. payment plan is HIDDEN while documents are under review', async ({ page, request }) => {
    // express-interest persists an auto payment plan on the lead, so one EXISTS
    // to (previously) leak into this stage — the assertion is meaningful.
    const L = await leadAtPaperwork(request, rpToken, unitId, 'review');
    await fillIdentity(request, L.custToken);
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_front');
    await putDoc(request, L.custToken, L.tenantId, 'emirates_id_back');
    await putDoc(request, L.custToken, L.tenantId, 'passport');

    await setCookie(page, L.custToken);
    // Mark docs submitted (client-side gate) so the stage advances to docs_under_review.
    await page.addInitScript((lid) => { window.localStorage.setItem(`upnow_docs_submitted_v-${lid}`, '1'); }, L.leadId);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    // We're on the "documents under review" stage…
    await expect(page.getByText(/Your documents are with our team/i)).toBeVisible({ timeout: 10000 });
    // …and the payment plan / schedule is NOT shown here (unlocks only after approval).
    await expect(page.getByText(/Payment plan summary/i)).toHaveCount(0);
    await expect(page.getByText(/Payment schedule/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/D-plan-hidden.png`, fullPage: true });
  });
});
