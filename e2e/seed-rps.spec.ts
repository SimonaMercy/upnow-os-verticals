/**
 * SEED — 4 RP account-type cases, each with a property + 2 units (published)
 * and 2 contracts booked by KYC'd customers. 8 contracts total.
 *
 * UI-driven where the platform allows:
 *   • RP registration + onboarding KYC (real document uploads)  — UI
 *   • Customer registration                                     — UI
 *   • Property creation (PropertyFormModal, Places mocked)      — UI (API fallback)
 *   • Unit creation (/units/add)                                — UI (API fallback)
 * Unavoidable escapes (platform constraints, flagged in output):
 *   • RP compliance approval + listing publish — psql (admin gate)
 *   • Contract creation — API (the UI wizard's Create button 400s: BUG-16)
 *   • Customer KYC fields — PATCH /auth/me (the exact call the profile UI makes)
 *
 * Run: E2E_DB=upnow_prod_clone npx playwright test e2e/seed-rps.spec.ts --workers=1
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  registerProviderViaUi, registerCustomerViaUi,
  captureDevOtp, q, pdfFile,
} from './full-cycle/helpers';

const STAMP = Date.now().toString(36);
const EMIRATE_ID = 1;       // Dubai
const COMMUNITY_ID = 370;   // Al Raffa
const results: string[] = [];

type Acct = 'individual' | 'landlord' | 'brokerage' | 'agents';
interface RpCase {
  key: Acct; title: string; fullName: string; eid: string; // lessor's Emirates ID
  company?: string; parentBrokerage?: string;
  docs: string[]; // required KYC doc row labels
}
const RP_CASES: RpCase[] = [
  { key: 'individual', title: 'Individual Landlord', fullName: 'Ishaan Individual', eid: '784-1985-1234567-1', docs: ['Emirates ID'] },
  { key: 'landlord',   title: 'Landlord Company',    fullName: 'Lena Landlord', eid: '784-1986-2345678-2', company: 'Landlord Holdings LLC', docs: ['Trade License'] },
  { key: 'brokerage',  title: 'Property Management',       fullName: 'Bilal Broker', eid: '784-1987-3456789-3', company: 'Bright Brokerage LLC', docs: ['Trade License', 'Property Management License'] },
  { key: 'agents',     title: 'Property Management Agent', fullName: 'Aaliya Agent', eid: '784-1988-4567890-4', company: 'Apex Agents LLC', parentBrokerage: 'Bright Brokerage LLC',
    docs: ['Trade License', 'Agent Registration Certificate', 'Agency Agreement with Parent Firm'] },
];

interface Cust { phone: string; first: string; last: string; eid: string; nationality: string; email?: string; }
// Phones must be PURELY NUMERIC (the form rejects non-digits). Derive 9-digit
// UAE mobiles from the clock, offset per-customer so they're unique.
const PHONE_BASE = Date.now();
const numPhone = (i: number) => '5' + String(PHONE_BASE + i).slice(-8);
const CUSTOMERS: Cust[] = [
  { phone: numPhone(11), first: 'Cara', last: 'Customerone', eid: '784-1990-1111111-1', nationality: 'Emirati' },
  { phone: numPhone(22), first: 'Daniya', last: 'Customertwo', eid: '784-1991-2222222-2', nationality: 'Indian' },
  { phone: numPhone(33), first: 'Eshan', last: 'Customerthree', eid: '784-1992-3333333-3', nationality: 'Pakistani' },
  { phone: numPhone(44), first: 'Farah', last: 'Customerfour', eid: '784-1993-4444444-4', nationality: 'British' },
];

// ─── Places mock (per page; parametrised by the property name) ───────────────
async function mockPlaces(page: Page, propName: string) {
  const autocomplete = { suggestions: [{ placePrediction: {
    placeId: `ChIJ_${propName.replace(/\W/g, '')}`,
    structuredFormat: { mainText: { text: propName }, secondaryText: { text: 'Al Raffa, Dubai, United Arab Emirates' } },
    types: ['establishment', 'point_of_interest'],
  } }] };
  const details = {
    displayName: { text: propName },
    formattedAddress: `${propName}, Street 2A, Al Raffa, Bur Dubai, Dubai, United Arab Emirates`,
    location: { latitude: 25.2567, longitude: 55.2934 },
    addressComponents: [
      { types: ['establishment', 'point_of_interest'], longText: propName },
      { types: ['route'], longText: 'Street 2A' },
      { types: ['neighborhood'], longText: 'Al Raffa' },
      { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Bur Dubai' },
      { types: ['administrative_area_level_1', 'political'], longText: 'Dubai' },
      { types: ['country', 'political'], longText: 'United Arab Emirates' },
    ],
  };
  await page.route('**/api/places/autocomplete', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(autocomplete) }));
  await page.route('**/api/places/autocomplete/street', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) }));
  await page.route('**/api/places/details/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(details) }));
  await page.route('**/api/building-cache/lookup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/maps/key', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) }));
  await page.route('https://maps.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' }));
  await page.route('**://*.mapbox.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

// ─── RP onboarding via UI (all 4 account types) ─────────────────────────────
async function onboardRp(page: Page, c: RpCase) {
  await page.goto('/rental-provider/dashboard/onboarding');
  await expect(page.getByRole('heading', { name: 'Account Type' })).toBeVisible({ timeout: 30_000 });
  await page.getByText(c.title, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Details
  await expect(page.getByPlaceholder('Your full legal name')).toBeVisible({ timeout: 15_000 });
  await page.getByPlaceholder('Your full legal name').fill(c.fullName);
  await page.getByPlaceholder('50 123 4567').fill('50' + String(Date.now()).slice(-7));
  const otp = await captureDevOtp(page, '/auth/otp/request', () => page.getByRole('button', { name: /send code/i }).click());
  await expect(page.getByPlaceholder('6-digit code')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('6-digit code').fill(otp);
  await page.getByRole('button', { name: /^Verify$/ }).click();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 10_000 });
  if (c.key === 'individual') {
    await page.locator('select').first().selectOption('Emirati');
    // Lessor's Emirates ID → shows on the contract as the landlord EID.
    await page.getByPlaceholder('784-XXXX-XXXXXXX-X').fill(c.eid);
  }
  await page.getByRole('button', { name: /save.*continue/i }).click();

  // Business (companies)
  if (c.key !== 'individual') {
    await expect(page.getByPlaceholder('Registered business name')).toBeVisible({ timeout: 15_000 });
    await page.getByPlaceholder('Registered business name').fill(c.company!);
    await page.getByPlaceholder('e.g. 1234567').fill(`TL-${STAMP}-${c.key}`);
    await page.locator('select').first().selectOption('Dubai DED');
    if (c.key === 'agents') await page.getByPlaceholder(/search registered brokerages/i).fill(c.parentBrokerage!);
    // Signatory Emirates ID → the company's lessor EID on the contract.
    await page.getByPlaceholder('784-XXXX-XXXXXXX-X').fill(c.eid);
    await page.getByRole('button', { name: /save.*continue/i }).click();
  }
  // Shareholders (landlord + brokerage only) — 0 is allowed
  if (c.key === 'landlord' || c.key === 'brokerage') {
    await expect(page.getByRole('heading', { name: 'Shareholders' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /save.*continue/i }).click();
  }

  // Documents — upload each required doc
  await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 15_000 });
  for (const label of c.docs) {
    const row = page.locator('[class*="docRow"]').filter({ hasText: label }).first();
    await row.getByRole('button', { name: /upload/i }).click();
    await page.locator('input[type="file"]').first().setInputFiles(pdfFile(`${c.key}-${label.replace(/\W/g, '')}.pdf`));
    await expect(row.getByText('Uploaded', { exact: false })).toBeVisible({ timeout: 25_000 });
  }
  const submit = page.getByRole('button', { name: /submit for review/i }).first();
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await expect(page.getByText(/under review/i)).toBeVisible({ timeout: 20_000 });
}

// ─── Property via UI modal (Places-autofill); falls back to API ─────────────
async function createProperty(page: Page, propName: string, plot: string, makani: string): Promise<number> {
  try {
    await page.goto('/rental-provider/dashboard/portfolio?add=1');
    await expect(page.getByRole('heading', { name: 'Add Property' })).toBeVisible({ timeout: 30_000 });
    // Category is a required select that Places autofill does NOT set.
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Select category' }) }).first().selectOption('residential');
    const search = page.getByPlaceholder('Type a building name, tower or street…');
    await search.click();
    await search.fill(propName.slice(0, 12));
    // Wait for the (mocked) Google Places suggestion, then pick it → autofills geo.
    const sugg = page.locator('ul li button').filter({ hasText: new RegExp(propName.slice(0, 8), 'i') }).first();
    await sugg.waitFor({ state: 'visible', timeout: 12_000 });
    await sugg.click();
    // Force the building name so the DB lookup by building_name is deterministic.
    const bname = page.getByPlaceholder('e.g. Al Safa Tower, Palm Residences');
    await expect(bname).toBeVisible({ timeout: 15_000 });
    await bname.fill(propName);
    // Plot No. + Makani No. → render on the contract/Ejari doc.
    await page.getByPlaceholder('e.g. PLOT-12345').fill(plot);
    await page.getByPlaceholder('e.g. 1234567890').fill(makani);
    await page.getByRole('button', { name: 'Add Property', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Add Property' })).toBeHidden({ timeout: 20_000 });
  } catch (e) {
    results.push(`   ⚠ property "${propName}" UI modal failed → API fallback: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    await page.request.post('/api/properties', {
      data: { buildingName: propName, spaceCategory: 'residential', emirateId: EMIRATE_ID, communityId: COMMUNITY_ID, fullAddress: `${propName}, Al Raffa, Dubai`, plotNumber: plot, makaniNumber: makani },
    });
  }
  // settle then resolve id
  for (let i = 0; i < 10; i++) {
    const id = Number(q(`SELECT id FROM properties WHERE building_name='${propName}' ORDER BY id DESC LIMIT 1`) || 0);
    if (id) return id;
    await page.waitForTimeout(500);
  }
  throw new Error(`property ${propName} not created`);
}

// ─── 2 units via UI (/units/add); falls back to API per unit ────────────────
async function createUnits(page: Page, propId: number, propName: string, nums: string[]): Promise<number[]> {
  let uiOk = false;
  try {
    await page.goto('/rental-provider/dashboard/units/add');
    // Select the property (units-only flow)
    const propSelect = page.locator('select').filter({ has: page.locator('option', { hasText: propName.slice(0, 10) }) }).first();
    await propSelect.selectOption({ label: new RegExp(propName.slice(0, 10)) as unknown as string }).catch(async () => {
      // fallback: pick by value matching the id
      await page.locator('select').first().selectOption(String(propId));
    });
    const cards = page.locator('div[id^="unit-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < nums.length; i++) {
      if (i > 0) { await page.getByRole('button', { name: /Add another unit/i }).click(); }
      const card = cards.nth(i);
      await card.getByPlaceholder('e.g. Spacious 2BR Apartment with Balcony in Al Raffa').fill(`${propName} ${nums[i]}`);
      await card.locator('select').nth(0).selectOption('apartment');      // unit type
      await card.getByPlaceholder('e.g. 101, G-02').fill(nums[i]);
      await card.getByPlaceholder('e.g. 1234567').fill('203456' + (i + 1)); // Utility Premises No. (DEWA)
      await card.getByPlaceholder('e.g. 1200').fill('90');                // size
      await card.getByPlaceholder('e.g. 85000').fill('95000');           // rent
    }
    await page.getByRole('button', { name: new RegExp(`Save ${nums.length} Unit`) }).click();
    await expect(page.getByText('All done!')).toBeVisible({ timeout: 60_000 });
    uiOk = true;
  } catch {
    results.push(`   ⚠ units for "${propName}" UI failed → API fallback`);
  }
  const ids: number[] = [];
  for (const num of nums) {
    let id = Number(q(`SELECT id FROM units WHERE property_id=${propId} AND unit_number='${num}' LIMIT 1`) || 0);
    if (!id && !uiOk) {
      await page.request.post(`/api/properties/${propId}/units`, {
        data: { unitName: `${propName} ${num}`, unitType: 'apartment', unitNumber: num, bedrooms: 1, bathrooms: 1, premiseNumber: '20345' + num.replace(/\D/g, ''),
          unitSizeSqm: 90, unitSizeSqft: 969, rentalPrice: 95000, securityDeposit: 4750, adminFee: 4750, ejariFeeFils: 220, commission: 4750 },
      });
      id = Number(q(`SELECT id FROM units WHERE property_id=${propId} AND unit_number='${num}' LIMIT 1`) || 0);
    }
    expect(id, `unit ${num}`).toBeGreaterThan(0);
    ids.push(id);
  }
  return ids;
}

async function publishUnit(page: Page, propId: number, unitId: number) {
  await page.request.patch(`/api/properties/${propId}/units/${unitId}/submit-listing`, { data: {} }).catch(() => {});
  q(`UPDATE units SET listing_status='published', is_listed=true, availability='available' WHERE id=${unitId}`);
}

async function createContract(rp: APIRequestContext, unitId: number, cust: Cust): Promise<number> {
  const t = await rp.post('/api/contracts/tenants', { data: { name: `${cust.first} ${cust.last}`, email: cust.email, phone: cust.phone } });
  expect(t.ok(), `tenant link: ${t.status()} ${await t.text()}`).toBeTruthy();
  const tenantId = ((await t.json()) as { tenantId: number }).tenantId;
  const rent = Number(q(`SELECT rental_price::float8 FROM units WHERE id=${unitId}`));
  const dep = Number(q(`SELECT COALESCE(security_deposit,0)::float8 FROM units WHERE id=${unitId}`));
  const adminFee = Number(q(`SELECT COALESCE(admin_fee,0)::float8 FROM units WHERE id=${unitId}`));
  const ejariFee = Number(q(`SELECT COALESCE(ejari_fee,0)::float8 FROM units WHERE id=${unitId}`));
  const c = await rp.post('/api/contracts', {
    data: { unitId, tenantId, contractStartDate: '2026-08-01', contractEndDate: '2027-07-31',
      annualRent: rent, securityDepositAmount: dep, adminFee, ejariFee, numberOfInstallments: 4, modeOfPayment: 'cheque' },
  });
  expect(c.status(), `contract: ${await c.text()}`).toBe(201);
  return ((await c.json()) as { id: number }).id;
}

// ─── Suite ──────────────────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial', timeout: 300_000 });

test.describe('Seed 4 RP cases + 8 contracts', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    // Create 4 customers via UI + KYC (resolve their emails for tenant linking).
    for (const cust of CUSTOMERS) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await registerCustomerViaUi(p, cust.phone);
      const kyc = await p.request.patch('/api/auth/me', {
        data: { firstName: cust.first, lastName: cust.last, emiratesIdNumber: cust.eid, nationality: cust.nationality, gender: 'other' },
      });
      expect(kyc.ok(), `customer KYC ${cust.first}: ${kyc.status()}`).toBeTruthy();
      cust.email = q(`SELECT email FROM users WHERE phone LIKE '%${cust.phone}%' ORDER BY id DESC LIMIT 1`);
      expect(cust.email, `email for ${cust.first}`).toBeTruthy();
      await p.close(); await ctx.close();
    }
    results.push(`✓ 4 customers created+KYC: ${CUSTOMERS.map(c => `${c.first}(${c.email})`).join(', ')}`);
  });

  for (let i = 0; i < RP_CASES.length; i++) {
    const c = RP_CASES[i];
    test(`${c.title}`, async ({ browser }) => {
      const email = `rp.${c.key}.${STAMP}@e2e.upnow.test`;
      const propName = `${c.title} Tower ${STAMP}`;
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await mockPlaces(page, propName);

      await registerProviderViaUi(page, 'rental-provider', email);
      await onboardRp(page, c);

      // Approve (admin gate → psql)
      const uid = Number(q(`SELECT id FROM users WHERE email='${email}'`));
      q(`UPDATE rental_providers SET compliance_status='compliant', account_type_confirmed_at=COALESCE(account_type_confirmed_at, now()) WHERE user_id=${uid}`);
      const rpId = Number(q(`SELECT id FROM rental_providers WHERE user_id=${uid}`));
      await page.goto('/rental-provider/dashboard');
      await expect(page).toHaveURL(/\/rental-provider\/dashboard/, { timeout: 20_000 });

      // Property + 2 units + publish
      const plot = `${591 + i}-${1230 + i}`;
      const makani = String(3243587110 + i);
      const propId = await createProperty(page, propName, plot, makani);
      const unitNums = [`${c.key.toUpperCase()}-101`, `${c.key.toUpperCase()}-102`];
      const unitIds = await createUnits(page, propId, propName, unitNums);
      for (const u of unitIds) await publishUnit(page, propId, u);

      // 2 contracts with 2 customers (rotate so all 4 customers get used across RPs)
      const custA = CUSTOMERS[(i * 2) % 4];
      const custB = CUSTOMERS[(i * 2 + 1) % 4];
      const cid1 = await createContract(page.request, unitIds[0], custA);
      const cid2 = await createContract(page.request, unitIds[1], custB);

      results.push(
        `✓ ${c.title}\n   RP: ${email} (rp=${rpId}) · property=${propId} "${propName}"\n` +
        `   CID-${cid1} ↔ ${custA.first} ${custA.last} · /rental-provider/dashboard/contracts/${cid1}/v2\n` +
        `   CID-${cid2} ↔ ${custB.first} ${custB.last} · /rental-provider/dashboard/contracts/${cid2}/v2`,
      );
      await ctx.close();
    });
  }

  test.afterAll(() => {
    console.log('\n\n══════════ SEED SUMMARY ══════════\n' + results.join('\n') + '\n══════════════════════════════════\n');
  });
});
