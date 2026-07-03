/**
 * E2E — Customer "Personal details" section on the paperwork step
 * (/dashboard/customer/spaces/v2/v-<leadId>, the "Almost there. Let us gather
 * your paperwork." screen).
 *
 * Verifies the requested behaviour:
 *   • BLANK by default  — before any Emirates ID is uploaded the five fields
 *     are empty and NON-editable (no inputs); the section auto-fills from the ID.
 *   • EDITABLE on issue — once the Emirates ID is uploaded but the details
 *     couldn't be captured automatically, the fields unlock for manual entry.
 *   • CONFIRM when filled — auto-filled details show as read-only chips with a
 *     "Something not right? Edit details" toggle that unlocks editing on demand.
 *
 * Reuses the compliant throwaway RP already in the local DB and a fresh
 * customer + published unit per state so each case starts clean.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'rp.leaddetail.e2e@example.com';   // throwaway compliant RP (owns a test property)
const TS = Date.now();
const SHOTS = 'test-results/personal-details';

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(r1.ok(), `OTP step-1 for ${email}: ${r1.status()}`).toBeTruthy();
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing — backend must be non-production').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  expect(r2.ok(), `OTP step-2 for ${email}: ${r2.status()}`).toBeTruthy();
  return ((await r2.json()) as { access_token: string }).access_token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

async function setCookie(page: Page, token: string) {
  await page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);
}

/** Fresh customer → book viewing → RP completes it → customer expresses interest,
 *  landing the lead at the `docs_required` paperwork step. Returns ids + token. */
async function leadAtPaperwork(request: APIRequestContext, rpToken: string, unitId: number, tag: string) {
  const reg = await request.post(`${BACKEND}/auth/register/customer`, {
    data: { email: `cust.pd.${tag}.${TS}@example.com`, phone: `+9715${(TS + Math.floor(Math.random() * 100000)).toString().slice(-8)}` },
  });
  expect(reg.status(), `register: ${reg.status()}`).toBe(201);
  const custToken = ((await reg.json()) as { access_token: string }).access_token;

  const book = await request.post(`${BACKEND}/leads/viewings`, {
    headers: auth(custToken),
    data: { unitId, scheduledAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), notes: `pd ${tag}`, desiredMoveIn: '2026-09-01', preferredChequeCount: 4 },
  });
  expect(book.status(), `book: ${book.status()}`).toBe(201);
  const b = (await book.json()) as { lead: { id: number }; viewing: { id: number } };

  await request.patch(`${BACKEND}/leads/viewings/${b.viewing.id}/status`, { headers: auth(rpToken), data: { status: 'completed' } });
  const ei = await request.post(`${BACKEND}/leads/my-viewings/${b.viewing.id}/express-interest`, {
    headers: auth(custToken), data: { contractStartDate: '2026-09-01', paymentsCount: 4, occupantsAdults: 1 },
  });
  expect(ei.ok(), `express-interest: ${ei.status()}`).toBeTruthy();

  // convertedTenantId (the tenant profile id) — needed to attach docs on the customer.
  const rpLead = await (await request.get(`${BACKEND}/leads/${b.lead.id}`, { headers: auth(rpToken) })).json() as { convertedTenantId?: number };
  return { leadId: b.lead.id, viewingId: b.viewing.id, custToken, tenantId: rpLead.convertedTenantId ?? 0 };
}

const spaceUrl = (leadId: number) => `/dashboard/customer/spaces/v2/v-${leadId}`;

test.describe.serial('Customer paperwork — Personal details states', () => {
  let rpToken = '';
  let unitId = 0;

  test('setup — RP published unit', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);
    const props = await (await request.get(`${BACKEND}/properties`, { headers: auth(rpToken) })).json() as Array<{ id: number }>;
    expect(props.length, 'RP must own a property').toBeGreaterThan(0);
    const unitRes = await request.post(`${BACKEND}/properties/${props[0].id}/units`, {
      headers: auth(rpToken),
      data: { unitNumber: `PD-${TS}`, unitName: `Personal-Details Test ${TS}`, unitType: 'apartment', rentalPrice: 90000, securityDeposit: 4500, adminFee: 1050, availability: 'available' },
    });
    expect(unitRes.status(), `unit: ${unitRes.status()}`).toBe(201);
    unitId = ((await unitRes.json()) as { id: number }).id;
    await request.patch(`${BACKEND}/properties/${props[0].id}/units/${unitId}/toggle-listing`, { headers: auth(rpToken) });
  });

  test('1. BLANK by default — no Emirates ID yet → fields empty & non-editable', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'blank');
    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    await expect(page.locator('.acard, body')).toBeVisible();
    const card = page.getByTestId('personal-details');
    await expect(card).toBeVisible({ timeout: 10000 });
    // Default state = blank & locked
    await expect(card).toHaveAttribute('data-state', 'blank');
    await expect(card).toContainText(/fill in automatically from your Emirates ID/i);
    // No editable inputs are rendered — the section is a locked placeholder.
    await expect(card.locator('input')).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Edit details/i })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/1-blank.png`, fullPage: true });
  });

  test('2. EDITABLE on issue — Emirates ID uploaded but not auto-read → manual entry unlocks', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'manual');
    // Attach the Emirates ID as a document row (storage metadata only) WITHOUT
    // populating the profile — this is exactly the "couldn't auto-read" case.
    const doc = await request.post(`${BACKEND}/documents`, {
      headers: auth(L.custToken),
      data: { ownerType: 'customer', ownerId: L.tenantId, documentKey: 'emirates_id', category: 'identity', displayName: 'Emirates ID', fileUrl: 'http://test.local/eid.jpg', mimeType: 'image/jpeg', s3Key: `test/eid-${TS}.jpg`, storageProvider: 's3' },
    });
    expect(doc.ok(), `create doc: ${doc.status()}`).toBeTruthy();

    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    const card = page.getByTestId('personal-details');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-state', 'manual');
    await expect(card).toContainText(/couldn.t read your Emirates ID/i);
    // Fields are now editable — the manual-entry form is present.
    await expect(card.locator('input').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/2-manual.png`, fullPage: true });
  });

  test('3. CONFIRM when filled — read-only chips + Edit-details toggle unlocks editing', async ({ page, request }) => {
    const L = await leadAtPaperwork(request, rpToken, unitId, 'filled');
    // Simulate OCR / admin auto-fill of the identity fields on the profile.
    await request.patch(`${BACKEND}/auth/me`, { headers: auth(L.custToken), data: { firstName: 'Aisha', lastName: 'Al Marri', emiratesIdNumber: '784-1990-1234567-1', nationality: 'UAE', gender: 'female' } });

    await setCookie(page, L.custToken);
    await page.goto(spaceUrl(L.leadId), { waitUntil: 'networkidle' });

    const card = page.getByTestId('personal-details');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card).toHaveAttribute('data-state', 'populated');
    // Read-only confirmation: values shown, no inputs until the customer opts in.
    await expect(card).toContainText('Aisha');
    await expect(card).toContainText('784-1990-1234567-1');
    await expect(card.locator('input')).toHaveCount(0);
    const editBtn = card.getByRole('button', { name: /Edit details/i });
    await expect(editBtn).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/3a-confirm.png`, fullPage: true });

    // Toggling edit unlocks the fields.
    await editBtn.click();
    await expect(card.locator('input').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/3b-editing.png`, fullPage: true });
  });
});
