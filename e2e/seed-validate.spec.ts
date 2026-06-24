/**
 * SEED VALIDATION — one full chain against the running clone DB.
 *
 * Proves the selectors/flow for: RP register → onboarding KYC (real upload) →
 * approve (psql) → property+unit (UI wizard, Places mocked) → publish →
 * customer register (UI) + KYC → contract (API, BUG-16 workaround).
 *
 * Run with: E2E_DB=upnow_prod_clone npx playwright test e2e/seed-validate.spec.ts
 * Once green, the full 4x4 seeding spec reuses these helpers.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  registerProviderViaUi, registerCustomerViaUi,
  captureDevOtp, fillOtp, readDevOtpFromPage,
  pdfFile, pngFile, q,
} from './full-cycle/helpers';

const TS = Date.now().toString(36);
const RP_EMAIL = `rp.ind.${TS}@e2e.upnow.test`;
const CUST_PHONE = '509' + String(Date.now()).slice(-6);

// ─── Google Places / Maps mocks (from 04-rp-portfolio) ──────────────────────
const PROP_NAME = `Seed Tower ${TS}`;
const MOCK_AUTOCOMPLETE = {
  suggestions: [{ placePrediction: {
    placeId: 'ChIJSeedValidate',
    structuredFormat: { mainText: { text: PROP_NAME }, secondaryText: { text: 'Al Raffa, Dubai, United Arab Emirates' } },
    types: ['establishment', 'point_of_interest'],
  } }],
};
const MOCK_PLACE_DETAILS = {
  displayName: { text: PROP_NAME },
  formattedAddress: `${PROP_NAME}, Street 2A, Al Raffa, Bur Dubai, Dubai, United Arab Emirates`,
  location: { latitude: 25.2567, longitude: 55.2934 },
  addressComponents: [
    { types: ['establishment', 'point_of_interest'], longText: PROP_NAME },
    { types: ['route'], longText: 'Street 2A' },
    { types: ['neighborhood'], longText: 'Al Raffa' },
    { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Bur Dubai' },
    { types: ['administrative_area_level_1', 'political'], longText: 'Dubai' },
    { types: ['country', 'political'], longText: 'United Arab Emirates' },
  ],
};
async function mockPlaces(page: Page) {
  await page.route('**/api/places/autocomplete', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AUTOCOMPLETE) }));
  await page.route('**/api/places/autocomplete/street', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) }));
  await page.route('**/api/places/details/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLACE_DETAILS) }));
  await page.route('**/api/building-cache/lookup**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/maps/key', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) }));
  await page.route('https://maps.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked */' }));
  await page.route('**://*.mapbox.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
}

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test('one full chain: RP→onboard→approve→property→publish→customer→contract', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPlaces(page);

  // ── 1. Register RP (Individual) via UI ────────────────────────────────────
  await registerProviderViaUi(page, 'rental-provider', RP_EMAIL);

  // ── 2. Onboarding — Individual: name + phone OTP + nationality + EID upload ─
  await page.goto('/rental-provider/dashboard/onboarding');
  await expect(page.getByRole('heading', { name: 'Account Type' })).toBeVisible({ timeout: 20_000 });
  await page.getByText('Individual Landlord').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByPlaceholder('Your full legal name')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('Your full legal name').fill('Ishaan Individual');
  await page.getByPlaceholder('50 123 4567').fill('50' + String(Date.now()).slice(-7));
  const otp = await captureDevOtp(page, '/auth/otp/request', () => page.getByRole('button', { name: /send code/i }).click());
  await expect(page.getByPlaceholder('6-digit code')).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder('6-digit code').fill(otp);
  await page.getByRole('button', { name: /^Verify$/ }).click();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.locator('select').first().selectOption('Emirati');
  await page.getByRole('button', { name: /save.*continue/i }).click();

  // Documents — upload Emirates ID (the only required doc for Individual)
  await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 10_000 });
  const eidRow = page.locator('[class*="docRow"]').filter({ hasText: 'Emirates ID' }).first();
  await eidRow.getByRole('button', { name: /upload/i }).click();
  await page.locator('input[type="file"]').first().setInputFiles(pdfFile('emirates-id.pdf'));
  await expect(eidRow.getByText('Uploaded', { exact: false })).toBeVisible({ timeout: 20_000 });

  // Submit for review
  const submitBtn = page.getByRole('button', { name: /submit for review/i }).first();
  await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
  await submitBtn.click();
  await expect(page.getByText(/under review/i)).toBeVisible({ timeout: 15_000 });

  // ── 3. Approve via psql (admin gate) ──────────────────────────────────────
  const rpUserId = Number(q(`SELECT id FROM users WHERE email='${RP_EMAIL}'`));
  expect(rpUserId).toBeGreaterThan(0);
  q(`UPDATE rental_providers SET compliance_status='compliant', account_type_confirmed_at=COALESCE(account_type_confirmed_at, now()) WHERE user_id=${rpUserId}`);
  const rpId = Number(q(`SELECT id FROM rental_providers WHERE user_id=${rpUserId}`));
  expect(rpId).toBeGreaterThan(0);

  // Dashboard now reachable
  await page.goto('/rental-provider/dashboard');
  await expect(page).toHaveURL(/\/rental-provider\/dashboard/, { timeout: 20_000 });

  // ── 4. Create property + 1 unit via UI wizard ─────────────────────────────
  await page.goto('/rental-provider/dashboard/portfolio/add');
  const categorySelect = page.locator('select').filter({ has: page.locator('option[value="venues"]') });
  await categorySelect.waitFor({ state: 'visible', timeout: 60_000 });
  await categorySelect.selectOption('residential');
  await page.getByPlaceholder('Type a building name, tower or street…').fill('seed tower');
  await page.locator('button[type="button"]').filter({ hasText: /united arab emirates/i }).first().click();
  await expect(page.getByText('Fields auto-filled')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder('e.g. Marina Heights')).toHaveValue(PROP_NAME, { timeout: 30_000 });

  const row = page.locator('div[id^="unit-card-"]').nth(0);
  await row.getByPlaceholder('e.g. Spacious 2BR Apartment with Balcony in Al Raffa').fill('Seed Unit 1BR');
  await row.locator('select').nth(0).selectOption('apartment');
  await row.getByPlaceholder('e.g. 101, G-02').fill('SEED-101');
  await row.getByPlaceholder('e.g. G, 1, 2…').fill('1');
  await row.locator('select').nth(1).selectOption('1');
  await row.locator('select').nth(2).selectOption('1');
  await row.locator('select').nth(3).selectOption('Fully Furnished');
  await row.getByPlaceholder('e.g. 1200').fill('78');
  await row.getByPlaceholder('e.g. 85000').fill('85000');
  await page.getByRole('button', { name: /Save Property \+ 1 Unit/ }).click();
  await expect(page.getByText('All done!')).toBeVisible({ timeout: 90_000 });

  const propertyId = Number(q(`SELECT id FROM properties WHERE building_name='${PROP_NAME}' ORDER BY id DESC LIMIT 1`));
  expect(propertyId).toBeGreaterThan(0);
  const unitId = Number(q(`SELECT id FROM units WHERE property_id=${propertyId} AND unit_number='SEED-101'`));
  expect(unitId).toBeGreaterThan(0);

  // ── 5. Publish the unit (submit-listing via API + psql approve) ───────────
  const sub = await page.request.patch(`/api/properties/${propertyId}/units/${unitId}/submit-listing`, { data: {} });
  // submit-listing may 200 or be a no-op; we then force-publish via psql (admin approve gate)
  q(`UPDATE units SET listing_status='published', is_listed=true, availability='available' WHERE id=${unitId}`);
  expect(q(`SELECT listing_status FROM units WHERE id=${unitId}`)).toBe('published');

  // ── 6. Register a customer via UI + complete KYC (API PATCH /auth/me) ──────
  const custCtx = await browser.newContext();
  const custPage = await custCtx.newPage();
  await registerCustomerViaUi(custPage, CUST_PHONE);
  const custKyc = await custPage.request.patch('/api/auth/me', {
    data: { firstName: 'Cara', lastName: 'Customerone', emiratesIdNumber: '784-1990-1234567-1', nationality: 'Emirati', gender: 'female', dateOfBirth: '1990-05-05' },
  });
  expect(custKyc.ok(), `customer KYC patch: ${custKyc.status()} ${await custKyc.text()}`).toBeTruthy();
  const custEmail = q(`SELECT email FROM users WHERE phone LIKE '%${CUST_PHONE}%' ORDER BY id DESC LIMIT 1`);
  expect(custEmail, 'customer email resolvable').toBeTruthy();
  await custPage.close(); await custCtx.close();

  // ── 7. Create contract (API, BUG-16 workaround) as the RP ─────────────────
  const tenantRes = await page.request.post('/api/contracts/tenants', {
    data: { name: 'Cara Customerone', email: custEmail, phone: CUST_PHONE },
  });
  expect(tenantRes.ok(), `tenant create/link: ${tenantRes.status()} ${await tenantRes.text()}`).toBeTruthy();
  const tenant = (await tenantRes.json()) as { tenantId: number; userId: number; existed?: boolean };
  expect(tenant.tenantId).toBeGreaterThan(0);

  const rent = Number(q(`SELECT rental_price::float8 FROM units WHERE id=${unitId}`));
  const deposit = Number(q(`SELECT COALESCE(security_deposit,0)::float8 FROM units WHERE id=${unitId}`));
  const adminFee = Number(q(`SELECT COALESCE(admin_fee,0)::float8 FROM units WHERE id=${unitId}`));
  const ejariFee = Number(q(`SELECT COALESCE(ejari_fee,0)::float8 FROM units WHERE id=${unitId}`));
  const cRes = await page.request.post('/api/contracts', {
    data: {
      unitId, tenantId: tenant.tenantId,
      contractStartDate: '2026-08-01', contractEndDate: '2027-07-31',
      annualRent: rent, securityDepositAmount: deposit, adminFee, ejariFee,
      numberOfInstallments: 4, modeOfPayment: 'cheque',
    },
  });
  expect(cRes.status(), `contract create: ${await cRes.text()}`).toBe(201);
  const contract = (await cRes.json()) as { id: number };
  expect(contract.id).toBeGreaterThan(0);

  // verify tenant KYC shows on the contract
  const eidOnContract = q(`SELECT u.emirates_id_number FROM tenancy_contracts c JOIN tenants t ON t.id=c.tenant_id JOIN users u ON u.id=t.user_id WHERE c.id=${contract.id}`);
  console.log(`\n=== VALIDATION OK ===\nRP user=${rpUserId} rp=${rpId} email=${RP_EMAIL}\nproperty=${propertyId} unit=${unitId} (published)\ncustomer email=${custEmail} EID-on-contract=${eidOnContract}\nCONTRACT id=${contract.id} → /rental-provider/dashboard/contracts/${contract.id}/v2\n`);
  expect(eidOnContract).toContain('784');

  await ctx.close();
});
