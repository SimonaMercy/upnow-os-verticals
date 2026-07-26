/**
 * E2E — Lead DETAIL page (/rental-provider/dashboard/leads/[id]) full workflow.
 *
 * Drives the NEW quest-page-style lead detail through every RP-facing stage,
 * exercising the real endpoints via the page's own buttons where the RP acts,
 * and the customer-side transitions via API. Screenshots are captured per stage
 * to test-results/lead-detail/.
 *
 * Stages walked: viewing → interested → payment plan → payment advice →
 * converted, plus reject → reopen on a second lead.
 *
 * Uses a real compliance-approved RP already in the local DB and a fresh
 * customer + unit per run so the journey starts clean.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'rp.leaddetail.e2e@example.com';   // throwaway compliant RP (fake, non-deliverable) — owns a test property
const TS = Date.now();
const SHOTS = 'test-results/lead-detail';

/** 2-step OTP login (dev backend exposes devOtp in non-prod). */
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

async function setRpCookie(page: Page, token: string) {
  await page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);
}

/** Register a fresh customer, book a viewing on `unitId`, return {leadId, viewingId, token}. */
async function freshLead(request: APIRequestContext, unitId: number, tag: string) {
  const reg = await request.post(`${BACKEND}/auth/register/customer`, {
    data: { email: `cust.${tag}.${TS}@example.com`, phone: `+9715${(TS + Math.floor(Math.random() * 1000)).toString().slice(-8)}` },
  });
  expect(reg.status(), `Customer register: ${reg.status()}`).toBe(201);
  const token = ((await reg.json()) as { access_token: string }).access_token;
  const book = await request.post(`${BACKEND}/leads/viewings`, {
    headers: auth(token),
    data: {
      unitId,
      scheduledAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      notes: `lead-detail e2e (${tag})`,
      desiredMoveIn: '2026-08-01',
      preferredChequeCount: 4,
    },
  });
  expect(book.status(), `Book viewing: ${book.status()}`).toBe(201);
  const b = (await book.json()) as { lead: { id: number; stage: string }; viewing: { id: number } };
  expect(b.lead.stage).toBe('viewing_scheduled');
  return { leadId: b.lead.id, viewingId: b.viewing.id, token };
}

test.describe.serial('Lead detail page — full workflow', () => {
  let rpToken = '';
  let unitId = 0;
  let leadId = 0;
  let viewingId = 0;
  let custToken = '';

  const detailUrl = () => `/rental-provider/dashboard/leads/${leadId}`;

  // Each Playwright test gets a fresh browser context (no shared cookies), so
  // re-apply the RP auth cookie before every test once we have a token.
  test.beforeEach(async ({ page }) => { if (rpToken) await setRpCookie(page, rpToken); });

  test('setup — RP unit (all fees) + published + fresh lead at viewing_scheduled', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);
    const props = await (await request.get(`${BACKEND}/properties`, { headers: auth(rpToken) })).json() as Array<{ id: number }>;
    expect(props.length, 'RP must own a property').toBeGreaterThan(0);
    const propertyId = props[0].id;

    const unitRes = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: auth(rpToken),
      data: {
        unitNumber: `LD-${TS}`, unitName: `Lead-Detail Test ${TS}`, unitType: 'apartment',
        rentalPrice: 132000, securityDeposit: 6600, adminFee: 1050, ejariFeeFils: 22000, commission: 6600,
        availability: 'available',
      },
    });
    expect(unitRes.status(), `Unit create: ${unitRes.status()}`).toBe(201);
    unitId = ((await unitRes.json()) as { id: number }).id;
    await request.patch(`${BACKEND}/properties/${propertyId}/units/${unitId}/toggle-listing`, { headers: auth(rpToken) });

    const lead = await freshLead(request, unitId, 'main');
    leadId = lead.leadId; viewingId = lead.viewingId; custToken = lead.token;
  });

  test('1. viewing_scheduled — renders journey + Mark visited; clicking it records the visit', async ({ page, request }) => {
    await setRpCookie(page, rpToken);
    await page.goto(detailUrl(), { waitUntil: 'networkidle' });

    await expect(page.locator('.qmap-l')).toContainText('Lead journey');
    await expect(page.locator('.qhead h1')).toContainText(`Lead-${leadId}`);
    await expect(page.locator('.infobar')).toContainText('Customer');
    await expect(page.locator('.acard h2')).toContainText(/Viewing/i);
    // Two customer-aligned sections: "Your viewing" + "Cost summary"
    await expect(page.locator('.acard')).toContainText(/Your viewing/i);
    await expect(page.locator('.vcard')).toBeVisible();
    const markVisited = page.getByRole('button', { name: /^Mark visited$/i });
    await expect(markVisited).toBeVisible();
    // Full cost summary — the SAME breakdown the customer sees (not just bare rent)
    await expect(page.locator('.acard')).toContainText(/Security deposit/i);
    await expect(page.locator('.acard')).toContainText(/Admin fee/i);
    await expect(page.locator('.acard')).toContainText(/Total payable/i);
    // Notify-guard opens a POPUP; entering a phone reveals a Send button
    const notify = page.getByRole('button', { name: /Notify guard/i });
    await expect(notify).toBeVisible();
    await notify.click();
    const gmodal = page.locator('.qmodal');
    await expect(gmodal).toBeVisible();
    await expect(gmodal).toContainText(/Notify security guard/i);
    await gmodal.getByPlaceholder(/Guard phone or email/i).fill('+971501234567');
    await expect(gmodal.getByRole('link', { name: /Send WhatsApp/i })).toBeVisible();
    await expect(gmodal.getByRole('button', { name: /Copy/i })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-viewing.png`, fullPage: true });
    await gmodal.getByRole('button', { name: /Close/i }).click();
    await expect(gmodal).toBeHidden();

    // Mark visited now prompts for the RP's outcome notes
    await markVisited.click();
    const mv = page.locator('.qmodal');
    await expect(mv).toBeVisible();
    await expect(mv).toContainText(/Record the viewing outcome/i);
    await mv.getByPlaceholder(/Customer liked the unit/i).fill('Customer very interested — wants 4 cheques');
    await mv.getByRole('button', { name: /Save & mark visited/i }).click();
    // Records completed (does NOT advance the stage — customer must express interest)
    await expect(page.locator('.acard')).toContainText(/No active viewing to mark/i, { timeout: 8000 });
    await expect(page.locator('.qbanner.danger')).toHaveCount(0);
    // Notes were saved as the viewing outcome
    await expect.poll(async () => {
      const l = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as { viewings?: Array<{ id: number; outcome?: string | null }> };
      return (l.viewings ?? []).find(x => x.id === viewingId)?.outcome ?? '';
    }, { timeout: 6000 }).toContain('Customer very interested');
  });

  test('2. interested — approve documents → RP reviews plan → shares → Plan shared', async ({ page, request }) => {
    // Ensure the viewing is completed (idempotent) so express-interest is eligible.
    await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, { headers: auth(rpToken), data: { status: 'completed' } });
    const ei = await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/express-interest`, {
      headers: auth(custToken), data: { contractStartDate: '2026-08-01', paymentsCount: 4, occupantsAdults: 1 },
    });
    expect(ei.ok(), `express-interest: ${ei.status()}`).toBeTruthy();

    await page.goto(detailUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Interested/i);
    await expect(page.locator('.youare .yv')).toContainText('Interested');
    const reviewBtn = page.locator('.action-body').getByRole('button', { name: /Approve documents/i });
    await expect(reviewBtn).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-interested.png`, fullPage: true });

    // Step 1: Approve documents → RP-only plan draft (customer does NOT see it yet).
    await reviewBtn.click();
    await expect(page.locator('.acard h2')).toContainText(/review the plan/i, { timeout: 8000 });
    // Step 2: RP shares the reviewed plan → payment_plan_shared.
    const shareBtn = page.locator('.action-body').getByRole('button', { name: /Share plan with customer/i });
    await expect(shareBtn).toBeVisible();
    await shareBtn.click();
    await expect(page.locator('.acard h2')).toContainText(/Plan shared/i, { timeout: 8000 });
  });

  test('3. payment_plan_shared — plan table renders, waiting on customer', async ({ page }) => {
    await page.goto(detailUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Plan shared/i);
    await expect(page.locator('.youare .yv')).toContainText('Payment plan');
    await expect(page.locator('.plan2')).toBeVisible();           // real grouped instalment schedule
    await expect(page.locator('.plan2-tot')).toContainText(/Total/i);
    await page.screenshot({ path: `${SHOTS}/03-plan.png`, fullPage: true });
  });

  test('4. payment advice — cheques-ready (API) then Payment review & approve converts', async ({ page, request }) => {
    const cr = await request.patch(`${BACKEND}/leads/${leadId}/cheques-ready`, { headers: auth(custToken) });
    expect(cr.ok(), `cheques-ready: ${cr.status()}`).toBeTruthy();

    await page.goto(detailUrl(), { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Payment confirmation/i);
    await expect(page.locator('.youare .yv')).toContainText('Payment confirmation');
    const approve = page.locator('.action-body').getByRole('button', { name: /Payment review & approve/i });
    await expect(approve).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-advice.png`, fullPage: true });

    // Approve → approve-cheques → auto-creates contract → converted
    await approve.click();
    await expect(page.locator('.acard h2')).toContainText(/converted/i, { timeout: 12000 });
    await expect(page.locator('.acard')).toContainText(/Open lease/i);
    await page.screenshot({ path: `${SHOTS}/05-converted.png`, fullPage: true });

    // "Open lease" deep-links to the New Lease tab with the created lease highlighted.
    await page.locator('.action-body').getByRole('button', { name: /Open lease/i }).click();
    await page.waitForURL(/\/operations\?.*focus=c-\d+/, { timeout: 10000 });
    await expect(page).toHaveURL(/tab=new/);
    await expect(page.locator('.card.focused, .rrow.focused').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}/06-open-lease-highlight.png`, fullPage: true });
  });

  test('5. reject → reopen on a fresh lead (UI actions)', async ({ page, request }) => {
    page.on('dialog', d => d.accept());   // header Reject has a window.confirm guard
    const l2 = await freshLead(request, unitId, 'reject');
    await setRpCookie(page, rpToken);
    await page.goto(`/rental-provider/dashboard/leads/${l2.leadId}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.acard h2')).toContainText(/Viewing/i);

    // Header Reject → stage rejected
    await page.locator('.qhead').getByRole('button', { name: /^Reject/i }).click();
    await expect(page.locator('.acard h2')).toContainText(/Rejected/i, { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/06-rejected.png`, fullPage: true });

    // Reopen → back to viewing
    await page.locator('.qhead').getByRole('button', { name: /^Reopen$/i }).click();
    const rm = page.locator('.qmodal');
    await expect(rm).toBeVisible();
    await rm.getByRole('button', { name: /notify customer/i }).click();   // reopen (no note)
    await expect(page.locator('.acard h2')).toContainText(/Viewing/i, { timeout: 8000 });
  });
});
