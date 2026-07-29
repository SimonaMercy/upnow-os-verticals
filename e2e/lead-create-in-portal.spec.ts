/**
 * E2E — "Add Lead": the RP captures a lead directly in the portal.
 *
 * Walks the 4-stage slide-over on /rental-provider/dashboard/leads:
 *   1 · Customer (individual or company)  2 · Unit  3 · Booking  4 · Notes
 *
 * Covers both booking outcomes — "Schedule a viewing" (lead at
 * viewing_scheduled) and "Book directly" (lead at interested with a generated
 * payment plan) — the company-customer path, and the duplicate guard.
 *
 * Screenshots go to test-results/lead-create/.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
// A compliant RP that owns at least one property in the target DB. Override with
// E2E_RP_EMAIL when the local dataset uses a different landlord.
const RP_EMAIL = process.env.E2E_RP_EMAIL ?? 'rp.leaddetail.e2e@example.com';
const TS = Date.now();
const SHOTS = 'test-results/lead-create';

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

/** Open the slide-over and let it finish sliding in from the right. */
async function openWizard(page: Page): Promise<Locator> {
  await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Add Lead$/ }).first().click();
  await page.waitForTimeout(600);
  const modal = page.getByRole('dialog', { name: /Add a lead/i });
  await expect(modal.getByRole('heading', { name: /Who's enquiring/i })).toBeVisible();
  return modal;
}

const next = (modal: Locator) => modal.getByRole('button', { name: /^Continue$/ }).click();

/** Stage 1 — customer type, then their details. */
async function stageCustomer(modal: Locator, o: { type?: 'individual' | 'company'; company?: string; name: string; email: string; phone: string }) {
  if (o.type === 'company') {
    await modal.getByRole('button', { name: /Company/ }).click();
    await modal.getByPlaceholder('Al Mansoori Trading LLC').fill(o.company!);
    await modal.getByPlaceholder(/Who called on their behalf/i).fill(o.name);
  } else {
    await modal.getByPlaceholder('Ahmed Al Mansoori').fill(o.name);
  }
  await modal.getByPlaceholder('ahmed@example.com').fill(o.email);
  await modal.getByPlaceholder(/^\+971/).fill(o.phone);
  await next(modal);
}

/** Stage 2 — one searchable list of AVAILABLE units, grouped by building, keyed by number. */
async function stageUnit(modal: Locator, unitNumber: string) {
  await expect(modal.getByRole('heading', { name: /Which unit/i })).toBeVisible();
  await modal.getByPlaceholder(/Search a unit number or building/i).fill(unitNumber);
  await modal.getByRole('button', { name: new RegExp(`Unit ${unitNumber}`) }).click();
  await expect(modal.getByText(`Unit ${unitNumber}`, { exact: false }).first()).toBeVisible();
  await next(modal);
}

/** Tap a day on the shared MiniCalendar — the control the public listing page uses. */
async function pickDay(modal: Locator, target: Date) {
  const cal = modal.getByTestId('mini-calendar');
  const monthName = target.toLocaleDateString('en-US', { month: 'long' });
  const header = cal.locator('span').first();
  for (let i = 0; i < 6; i++) {
    if ((await header.textContent())?.includes(`${monthName} ${target.getFullYear()}`)) break;
    await cal.getByRole('button').nth(1).click();   // next-month chevron
  }
  await cal.getByRole('button', { name: String(target.getDate()), exact: true }).click();
}

/** First selectable day of NEXT month — the move-in calendar disables every day
 *  outside the landlord's preferred contract-start days. */
async function pickFirstOpenDayNextMonth(modal: Locator) {
  const cal = modal.getByTestId('mini-calendar');
  await cal.getByRole('button').nth(1).click();   // next-month chevron
  // Enabled buttons: [0] prev month, [1] next month, then the selectable days.
  await cal.locator('button:not([disabled])').nth(2).click();
}

test.describe.serial('Add Lead — RP captures a lead in the portal', () => {
  let rpToken = '';
  let propertyId = 0;
  let unitId = 0;
  let unitNumber = '';
  let buildingName = '';
  let secondUnitNumber = '';
  let firstLeadId = 0;
  const unitName = `Add-Lead Test ${TS}`;
  const custEmail = `walkin.${TS}@example.com`;
  const custPhone = `+9714${String(TS).slice(-8)}`;

  test.beforeEach(async ({ page }) => { if (rpToken) await setRpCookie(page, rpToken); });

  test('setup — two fresh available units on the RP portfolio', async ({ request }) => {
    rpToken = await loginOtp(request, RP_EMAIL);
    const props = await (await request.get(`${BACKEND}/properties`, { headers: auth(rpToken) })).json() as Array<{ id: number; buildingName: string }>;
    expect(props.length, 'RP must own a property').toBeGreaterThan(0);
    propertyId = props[0].id;
    buildingName = props[0].buildingName;

    const mkUnit = async (num: string) => {
      const res = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
        headers: auth(rpToken),
        data: {
          unitNumber: num, unitName, unitType: 'apartment',
          // NB: units.ejari_fee_fils is a misnomer — it holds WHOLE AED, so 220 = AED 220.
          rentalPrice: 120000, securityDeposit: 6000, adminFee: 1000, ejariFeeFils: 220, commission: 6000,
          availability: 'available',
        },
      });
      expect(res.status(), `Unit create: ${res.status()}`).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };
    unitNumber = `AL-${TS}`;
    secondUnitNumber = `CO-${TS}`;
    unitId = await mkUnit(unitNumber);
    await mkUnit(secondUnitNumber);
  });

  test('0. stage 1 opens on the customer, and the rail gates the later stages', async ({ page }) => {
    const modal = await openWizard(page);

    // Stages are listed, and Continue is blocked until the customer is named.
    for (const label of ['Customer', 'Unit', 'Booking', 'Notes']) {
      await expect(modal.getByRole('button', { name: new RegExp(`^\\d?\\s*${label}$`) })).toBeVisible();
    }
    await expect(modal.getByRole('button', { name: /^Continue$/ })).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/00-stage1-customer.png` });

    // Individual is the default; picking Company asks for the company first.
    await modal.getByRole('button', { name: /Company/ }).click();
    await expect(modal.getByPlaceholder('Al Mansoori Trading LLC')).toBeVisible();
    await expect(modal.getByText('Contact person')).toBeVisible();
    await page.waitForTimeout(300);   // let the selection transition settle
    await page.screenshot({ path: `${SHOTS}/01-stage1-company.png` });
  });

  test('1. stage 2 lists available units grouped by building', async ({ page }) => {
    const modal = await openWizard(page);
    await stageCustomer(modal, { name: 'Walk-in Customer', email: custEmail, phone: custPhone });

    await expect(modal.getByRole('heading', { name: /Which unit/i })).toBeVisible();
    await expect(modal.getByText(buildingName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByRole('button', { name: new RegExp(`Unit ${unitNumber}`) })).toBeVisible();
    await expect(modal.getByText(/\d+ available/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/02-stage2-units.png` });
  });

  test('2. schedule-a-viewing creates the lead at viewing_scheduled', async ({ page, request }) => {
    const modal = await openWizard(page);
    await stageCustomer(modal, { name: 'Walk-in Customer', email: custEmail, phone: custPhone });
    await stageUnit(modal, unitNumber);

    // Stage 3 — schedule the visit. The payment summary is shown either way.
    await expect(modal.getByRole('heading', { name: /What happens next/i })).toBeVisible();
    await expect(modal.getByText('Payment summary')).toBeVisible({ timeout: 10_000 });
    await modal.getByRole('button', { name: /Schedule a viewing/i }).click();
    await pickDay(modal, new Date(Date.now() + 3 * 86400_000));
    await modal.getByRole('button', { name: '3:00 PM' }).click();
    await page.screenshot({ path: `${SHOTS}/03-stage3-viewing.png` });
    await next(modal);

    // Stage 4 — source + notes, with the review of what's about to be created.
    await expect(modal.getByRole('heading', { name: /Anything worth noting/i })).toBeVisible();
    await modal.getByRole('button', { name: 'Walk-in', exact: true }).click();
    await modal.getByPlaceholder(/What they asked for/i).fill('Walked in off the street, wants a 2BR from next month.');
    await expect(modal.getByText('Viewing scheduled')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-stage4-notes.png` });

    await modal.getByRole('button', { name: /Create Lead & Book Viewing/i }).click();

    // Lands on the new lead's detail page.
    await page.waitForURL(/\/rental-provider\/dashboard\/leads\/\d+/, { timeout: 15_000 });
    firstLeadId = Number(page.url().split('/').pop());
    expect(firstLeadId).toBeGreaterThan(0);
    await expect(page.locator('.qhead h1')).toContainText(`Lead-${firstLeadId}`, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/05-created-viewing.png`, fullPage: true });

    const lead = await (await request.get(`${BACKEND}/leads/${firstLeadId}`, { headers: auth(rpToken) })).json() as {
      stage: string; source: string; leadEmail: string; customerName: string; viewings?: Array<{ status: string }>;
    };
    expect(lead.stage).toBe('viewing_scheduled');
    expect(lead.source).toBe('walk_in');
    expect(lead.leadEmail).toBe(custEmail);
    expect(lead.customerName).toBe('Walk-in Customer');
    expect(lead.viewings?.[0]?.status).toBe('scheduled');

    // The creation is attributed in the lead's notes log (never "unattributed").
    const notes = await (await request.get(`${BACKEND}/leads/${firstLeadId}/notes`, { headers: auth(rpToken) })).json() as Array<{ body: string; authorRole: string }>;
    expect(notes.some(n => /Lead created in the portal/i.test(n.body))).toBeTruthy();
    expect(notes[0].authorRole).toBe('rental_provider');
  });

  test('3. the same customer + unit is refused with a link to the live lead', async ({ page }) => {
    const modal = await openWizard(page);
    await stageCustomer(modal, { name: 'Walk-in Customer', email: custEmail, phone: custPhone });
    await stageUnit(modal, unitNumber);
    await modal.getByRole('button', { name: /Schedule a viewing/i }).click();
    await pickDay(modal, new Date(Date.now() + 4 * 86400_000));
    await next(modal);
    await modal.getByRole('button', { name: /Create Lead & Book Viewing/i }).click();

    await expect(modal).toContainText(/already has a live lead on this unit/i, { timeout: 10_000 });
    await expect(modal.getByRole('button', { name: /Open the existing lead/i })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-duplicate-guard.png` });
  });

  test('4. book-directly for a COMPANY creates the lead at interested with a plan', async ({ page, request }) => {
    const modal = await openWizard(page);
    await stageCustomer(modal, {
      type: 'company',
      company: `Mansoori Trading ${TS}`,
      name: 'Sara Procurement',
      email: `company.${TS}@example.com`,
      phone: `+9715${String(TS).slice(-8)}`,
    });
    await stageUnit(modal, secondUnitNumber);

    await modal.getByRole('button', { name: /Book directly/i }).click();
    await pickFirstOpenDayNextMonth(modal);
    await modal.getByRole('button', { name: 'Quarterly', exact: true }).click();

    // The unit's payment summary is on the booking stage — the same server-computed
    // figures the customer's booking summary and the generated plan use.
    await expect(modal.getByText('Payment summary')).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByText('Annual rent', { exact: false })).toBeVisible();
    await expect(modal.getByText('Security deposit')).toBeVisible();
    await expect(modal.getByText('Total payable')).toBeVisible();
    // Rent 120,000 + deposit 6,000 + admin 1,000 + registration 220 + commission 6,000
    await expect(modal.getByText('AED 133,220')).toBeVisible();
    await modal.locator('main').evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/07-stage3-direct-top.png` });
    // The payment summary sits under the booking controls.
    await modal.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight * 0.55; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/07-stage3-summary.png` });
    await next(modal);

    await modal.getByRole('button', { name: 'Phone', exact: true }).click();
    await modal.locator('main').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOTS}/07b-stage4-review.png` });
    await modal.getByRole('button', { name: /Create Lead & Build Plan/i }).click();

    await page.waitForURL(/\/rental-provider\/dashboard\/leads\/\d+/, { timeout: 15_000 });
    const leadId = Number(page.url().split('/').pop());
    await expect(page.locator('.qhead h1')).toContainText(`Lead-${leadId}`, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/08-created-interested.png`, fullPage: true });

    const lead = await (await request.get(`${BACKEND}/leads/${leadId}`, { headers: auth(rpToken) })).json() as {
      stage: string; source: string; customerName: string;
      convertedTenant?: { entityType?: string; companyName?: string | null } | null;
      paymentPlan?: { installmentCount: number; rentFils: number } | null;
    };
    expect(lead.stage).toBe('interested');
    expect(lead.source).toBe('phone');
    // A company lead is known by the company, not the person who called.
    expect(lead.customerName).toBe(`Mansoori Trading ${TS}`);
    expect(lead.convertedTenant?.entityType).toBe('company');
    expect(lead.paymentPlan, 'plan auto-generated like the customer Book Now path').toBeTruthy();
    expect(lead.paymentPlan!.installmentCount).toBe(4);
    expect(lead.paymentPlan!.rentFils).toBe(12_000_000);
  });

  test('5. both leads show up in the RP pipeline', async ({ page }) => {
    await page.goto('/rental-provider/dashboard/leads', { waitUntil: 'networkidle' });
    await page.getByPlaceholder(/Search name, email, phone, unit/i).fill(custEmail);
    await expect(page.locator(`#lead-${firstLeadId}`)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/09-pipeline.png`, fullPage: true });
  });
});
