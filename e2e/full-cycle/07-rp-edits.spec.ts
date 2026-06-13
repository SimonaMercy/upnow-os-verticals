import { test, expect, Page, BrowserContext } from '@playwright/test';
import {
  safeLoginViaUi,
  q,
  readState,
  writeState,
  runId,
  uniqEmail,
  uniqPhone,
} from './helpers';

/**
 * 07 — EDIT flows: the create-vs-edit consistency hotspot. Everything runs as
 * the individual RP (state.rpEmail). Pattern per test: change → save → REOPEN
 * (fresh load) → assert a true round-trip.
 *
 *   1. Property edit via PropertyFormModal (property 13):
 *      a. name/plot round-trip (green)
 *      b. BUG-09 (expected fail): street never loads back into the edit form
 *         and full_address is recomposed WITHOUT it on every save.
 *   2. Unit edit via UnitFormModal (unit 118 E2E-103 — NOT published 116):
 *      a. custom deposit + view + lease terms persist on save (green)
 *      b. BUG-05 (expected fail, already filed): lease terms never shown on reopen
 *      c. BUG-10 (expected fail): changing rent silently clobbers stored custom fees
 *      d. BUG-11 (expected fail): cleared text fields are never actually cleared
 *      e. BUG-12 (expected fail): bedrooms=Studio never persists on an existing unit
 *   3. Tenant record (create via CustomerForm → detail page → edit):
 *      a. create customer (green) — writes state.tenant1Email / state.tenant1Id
 *      b. BUG-13 (expected fail): customer without a contract is unreachable (403 detail, absent from list)
 *      c. contract via /contracts/new wizard puts the customer in scope (green)
 *      d. EID/nationality/gender/DOB edit round-trips (green)
 *      e. BUG-14 (expected fail): clearing the email is silently ignored (asymmetric with other fields)
 *   4. RP profile page:
 *      a. no-change save does not corrupt rental_providers columns (green)
 *      b. BUG-15 (expected fail): page cross-wires poaPersonName := authorizedSignatoryName —
 *         turning POA OFF leaves the stale poa_person_name behind.
 */

const S = readState();
const RP_EMAIL: string = S.rpEmail;
const RP_PROFILE_ID: number = S.rpProfileId;
const PROPERTY_ID: number = S.propertyId;
const UNIT3_ID: number = S.unitIds?.[2]; // 118 — Garden Corner Flat
const UNIT3_NUMBER: string = S.unitNumbers?.[2]; // E2E-103
const UNIT2_NUMBER: string = S.unitNumbers?.[1]; // E2E-102 — contract target (unit 117)
const UNIT2_ID: number = S.unitIds?.[1]; // 117
const RUN_TAG = Math.random().toString(36).slice(2, 7);

// ─── External-service mocks (same pattern as spec 04) ────────────────────────
async function mockExternalServices(page: Page) {
  await page.route('**/api/places/autocomplete', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) }),
  );
  await page.route('**/api/places/autocomplete/street', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) }),
  );
  await page.route('**/api/places/details/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/building-cache/lookup**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/maps/key', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) }),
  );
  await page.route('https://maps.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked maps sdk */' }),
  );
  await page.route('**://*.mapbox.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// ─── Portfolio page helpers (selector techniques from spec 04) ───────────────
function propHeader(page: Page, name: string) {
  return page.locator('[class*="propH"]').filter({ hasText: name }).first();
}

async function expandProperty(page: Page, name: string) {
  await propHeader(page, name).locator('[class*="chev"]').click();
}

/** The single open overlay modal (UnitFormModal / PropertyFormModal share this shell). */
function modal(page: Page) {
  return page.locator('div.fixed.inset-0');
}

async function openUnitEdit(page: Page, unitNumber: string) {
  const numBtn = page.getByRole('button', { name: unitNumber, exact: true });
  await expect(numBtn).toBeVisible();
  await numBtn.locator('xpath=..').locator('button[title="Edit unit"]').click();
  await expect(modal(page).getByRole('heading', { name: 'Edit Unit' })).toBeVisible();
}

async function openPropertyEdit(page: Page, name: string) {
  await propHeader(page, name).locator('button[title="Edit property"]').click();
  const m = modal(page);
  await expect(m.getByRole('heading', { name: 'Edit Property' })).toBeVisible();
  // Wait for the async location cascade to backfill Community — saving before it
  // resolves would recompose fullAddress without the community (separate from BUG-09).
  const communitySelect = m
    .locator('select')
    .filter({ has: page.locator('option:text-matches("Select community", "i")') })
    .first();
  await expect
    .poll(
      async () => ((await communitySelect.locator('option:checked').textContent()) ?? '').trim(),
      { timeout: 30_000 },
    )
    .not.toMatch(/select community|^$/i);
  return m;
}

/** Fresh portfolio load + expand — guarantees the reopen sees server state. */
async function reloadAndExpand(page: Page, propName: string) {
  await page.goto('/rental-provider/dashboard/portfolio');
  await expect(propHeader(page, propName)).toBeVisible({ timeout: 60_000 });
  await expandProperty(page, propName);
  await expect(page.getByRole('button', { name: UNIT3_NUMBER, exact: true })).toBeVisible({ timeout: 30_000 });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('07 RP edit flows: property, unit, tenant, profile', () => {
  let context: BrowserContext;
  let page: Page;
  // Property is renamed in test 1 — track the live name for later tests/runs.
  let propName: string = S.propertyName;
  const newPropName = `E2E Tower ${runId()} ${RUN_TAG}ed`;
  const plotNumber = `PLOT-${RUN_TAG.toUpperCase()}`;
  const STREET = 'Street 2A';
  // Unit 118 financials for this run
  const CUSTOM_DEPOSIT = '5432';
  const NEW_RENT = String(80_000 + (parseInt(RUN_TAG, 36) % 900) + 100); // unique per invocation
  // Tenant created in test 3
  const tenant1Email = uniqEmail('tenant1');
  const tenant1First = 'Tara';
  const tenant1Last = 'Tenantone';
  let tenant1Phone = '';
  let tenant1Id = 0;

  test.beforeAll(async ({ browser }) => {
    expect(RP_EMAIL, 'state.rpEmail from spec 02/03').toBeTruthy();
    expect(PROPERTY_ID, 'state.propertyId from spec 04').toBeGreaterThan(0);
    expect(UNIT3_ID, 'state.unitIds[2] from spec 04').toBeGreaterThan(0);
    context = await browser.newContext();
    page = await context.newPage();
    await mockExternalServices(page);
    await safeLoginViaUi(page, RP_EMAIL, /\/rental-provider\/dashboard/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ── 1a. Property edit: name + plot round-trip ───────────────────────────────

  test('property edit round-trips name and plot number', async () => {
    await page.goto('/rental-provider/dashboard/portfolio');
    await expect(propHeader(page, propName)).toBeVisible({ timeout: 60_000 });

    const m = await openPropertyEdit(page, propName);
    await m.getByPlaceholder('e.g. Al Safa Tower, Palm Residences').fill(newPropName);
    await m.getByPlaceholder('e.g. PLOT-12345').fill(plotNumber);
    // Re-type the street so full_address carries it after THIS save — gives 1b a
    // clean baseline (the field comes up empty on edit; that is BUG-09's display half).
    await m.getByPlaceholder('e.g. Sheikh Zayed Road, Al Wasl Road…').fill(STREET);

    const patched = page.waitForResponse(
      (r) => r.url().includes(`/properties/${PROPERTY_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);
    propName = newPropName;
    writeState({ propertyName: newPropName });

    // DB round-trip
    expect(q(`SELECT building_name FROM properties WHERE id=${PROPERTY_ID}`)).toBe(newPropName);
    expect(q(`SELECT plot_number FROM properties WHERE id=${PROPERTY_ID}`)).toBe(plotNumber);
    expect(
      q(`SELECT full_address FROM properties WHERE id=${PROPERTY_ID}`),
      'full_address contains the street typed during this save',
    ).toContain(STREET);

    // UI round-trip: fresh load → reopen → all editable fields retained
    await page.reload();
    await expect(propHeader(page, newPropName)).toBeVisible({ timeout: 60_000 });
    const m2 = await openPropertyEdit(page, newPropName);
    await expect(m2.getByPlaceholder('e.g. Al Safa Tower, Palm Residences')).toHaveValue(newPropName);
    await expect(m2.getByPlaceholder('e.g. PLOT-12345')).toHaveValue(plotNumber);
    await expect(m2.getByText('Residential')).toBeVisible(); // category locked
    await expect(m2.locator('input[type="checkbox"]')).not.toBeChecked(); // not standalone
    await m2.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);
  });

  // ── 1b. BUG-09: street wiped from full_address on every property edit ───────

  test('property edit preserves the street (BUG-09: street not prefilled, full_address recomposed without it)', async () => {
    await page.goto('/rental-provider/dashboard/portfolio');
    await expect(propHeader(page, propName)).toBeVisible({ timeout: 60_000 });
    expect(
      q(`SELECT full_address FROM properties WHERE id=${PROPERTY_ID}`),
      'precondition: street present before the no-op edit',
    ).toContain(STREET);

    const m = await openPropertyEdit(page, propName);
    // No-op edit: touch nothing, just save.
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/properties/${PROPERTY_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);

    // FAILS: full_address is now "Al Raffa, Dubai" — the street is gone.
    expect(
      q(`SELECT full_address FROM properties WHERE id=${PROPERTY_ID}`),
      'a no-op property edit must not lose the street from full_address',
    ).toContain(STREET);
    // Display half of the same bug (unreached while the above fails):
    const m2 = await openPropertyEdit(page, propName);
    await expect(m2.getByPlaceholder('e.g. Sheikh Zayed Road, Al Wasl Road…')).toHaveValue(STREET);
  });

  // ── 2a. Unit edit: deposit / view / lease terms persist on save ─────────────

  test('unit edit persists custom deposit, view and lease terms to the DB', async () => {
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m = modal(page);

    await m.getByPlaceholder('e.g. 10000').fill(CUSTOM_DEPOSIT); // Security Deposit (custom ≠ 5%)
    await m.getByPlaceholder('e.g. Sea View, Marina View…').fill('Garden View');
    await page.keyboard.press('Escape'); // close the view typeahead
    await m.getByPlaceholder('12', { exact: true }).fill('24'); // Min. Lease
    await m.getByPlaceholder('60', { exact: true }).fill('90'); // Notice Period
    await m.getByPlaceholder('e.g. 5', { exact: true }).fill('5'); // Rent Escalation

    const patched = page.waitForResponse(
      (r) => r.url().includes(`/units/${UNIT3_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);

    expect(q(`SELECT security_deposit::int FROM units WHERE id=${UNIT3_ID}`)).toBe(CUSTOM_DEPOSIT);
    expect(q(`SELECT view FROM units WHERE id=${UNIT3_ID}`)).toBe('Garden View');
    const facilities = q(`SELECT facilities FROM units WHERE id=${UNIT3_ID}`);
    expect(facilities).toContain('"minLeaseMonths":24');
    expect(facilities).toContain('"noticePeriodDays":90');
    expect(facilities).toContain('Gym'); // amenities from creation kept

    // Reopen — the fields that DO round-trip
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m2 = modal(page);
    // API returns numerics as "5432.00" — both forms are a correct round-trip
    await expect(m2.getByPlaceholder('e.g. 10000')).toHaveValue(new RegExp(`^${CUSTOM_DEPOSIT}(\\.00)?$`));
    await expect(m2.getByPlaceholder('e.g. Sea View, Marina View…')).toHaveValue('Garden View');
    await m2.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);
  });

  // ── 2b. BUG-05 (already filed): lease terms invisible on reopen ─────────────

  test('unit edit shows stored lease terms on reopen (BUG-05)', async () => {
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m = modal(page);
    // FAILS: inputs are empty although facilities holds {"leaseTerms":{...24/90/5}}
    await expect(m.getByPlaceholder('12', { exact: true })).toHaveValue('24');
    await expect(m.getByPlaceholder('60', { exact: true })).toHaveValue('90');
    await expect(m.getByPlaceholder('e.g. 5', { exact: true })).toHaveValue('5');
  });

  // ── 2c. BUG-10: rent change silently clobbers stored custom fees ────────────

  test('changing rent keeps stored custom fees (BUG-10: auto-recalc overwrites them)', async () => {
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m = modal(page);
    await expect(m.getByPlaceholder('e.g. 10000')).toHaveValue(new RegExp(`^${CUSTOM_DEPOSIT}(\\.00)?$`)); // custom fee on file

    await m.getByPlaceholder('e.g. 85000').fill(NEW_RENT); // change ONLY the rent
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/units/${UNIT3_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);

    // The rent itself round-trips fine…
    expect(q(`SELECT rental_price::int FROM units WHERE id=${UNIT3_ID}`)).toBe(NEW_RENT);
    // …but the stored CUSTOM deposit must survive a rent-only edit. FAILS:
    // it is overwritten with round(rent*0.05) (admin fee + commission too).
    expect(
      q(`SELECT security_deposit::int FROM units WHERE id=${UNIT3_ID}`),
      'stored custom security deposit survives a rent-only edit',
    ).toBe(CUSTOM_DEPOSIT);
  });

  // ── 2d. BUG-11: cleared text fields are never cleared ───────────────────────

  test('clearing the view field actually clears it after save (BUG-11)', async () => {
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m = modal(page);
    await expect(m.getByPlaceholder('e.g. Sea View, Marina View…')).toHaveValue('Garden View');

    await m.getByPlaceholder('e.g. Sea View, Marina View…').fill(''); // clear it
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/units/${UNIT3_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);

    // FAILS: the DB still holds 'Garden View' — the clear was silently dropped.
    expect(
      q(`SELECT COALESCE(view, '') FROM units WHERE id=${UNIT3_ID}`),
      'cleared view is persisted as empty/null',
    ).toBe('');
  });

  // ── 2e. BUG-12: Studio never persists on an existing unit ───────────────────

  test('setting bedrooms to Studio round-trips (BUG-12: Studio is dropped from the PATCH)', async () => {
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    const m = modal(page);
    const bedroomsSelect = m.locator('select').nth(1);
    await expect(bedroomsSelect.locator('option:checked')).toHaveText('2 BR'); // created as 2BR

    await bedroomsSelect.selectOption('Studio');
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/units/${UNIT3_ID}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await expect(modal(page)).toHaveCount(0);

    // FAILS: bedrooms stays 2 in the DB and the reopened form still shows "2 BR".
    await reloadAndExpand(page, propName);
    await openUnitEdit(page, UNIT3_NUMBER);
    await expect(
      modal(page).locator('select').nth(1).locator('option:checked'),
      'Studio survives save + reopen',
    ).toHaveText('Studio');
  });

  // ── 3a. Create a customer through the Customers page ────────────────────────

  test('RP creates a customer via CustomerForm; account + tenant rows land in the DB', async () => {
    tenant1Phone = uniqPhone();
    await page.goto('/rental-provider/dashboard/tenants');
    await page.getByRole('button', { name: 'Add Customer' }).click();
    await expect(page.getByRole('heading', { name: 'Add a new customer' })).toBeVisible();

    await page.getByPlaceholder('First name').fill(tenant1First);
    await page.getByPlaceholder('Last name').fill(tenant1Last);
    await page.getByPlaceholder('email@example.com').fill(tenant1Email);
    await page.getByPlaceholder('+9715…').fill(tenant1Phone);

    const created = page.waitForResponse(
      (r) => r.url().includes('/contracts/tenants') && r.request().method() === 'POST' && r.ok(),
    );
    await page.getByRole('button', { name: 'Create customer' }).click();
    const body = (await (await created).json()) as { tenantId: number; userId: number; existed: boolean };
    tenant1Id = body.tenantId;
    expect(tenant1Id).toBeGreaterThan(0);

    // The product flow pushes straight into the contract wizard, prefilled.
    await page.waitForURL(/\/contracts\/new\?tenantId=/, { timeout: 30_000 });

    // DB: user + tenant rows
    expect(
      q(`SELECT u.name || '|' || u.email || '|' || u.role
         FROM tenants t JOIN users u ON u.id=t.user_id WHERE t.id=${tenant1Id}`),
    ).toBe(`${tenant1First} ${tenant1Last}|${tenant1Email}|customer`);
    if (!body.existed) {
      expect(q(`SELECT COALESCE(phone,'') FROM users WHERE id=${body.userId}`)).toBe(tenant1Phone);
    }

    writeState({ tenant1Email, tenant1Id, tenant1UserId: body.userId });
  });

  // ── 3b. BUG-13: a contract-less customer is unreachable ─────────────────────

  test('freshly created customer is reachable on the Customers pages (BUG-13: orphaned until a contract exists)', async () => {
    const hasContract = Number(
      q(`SELECT count(*) FROM tenancy_contracts WHERE tenant_id=${tenant1Id} AND rental_provider_id=${RP_PROFILE_ID}`),
    );
    test.skip(hasContract > 0, 're-run: the customer already holds a contract from a previous invocation, the dead-end no longer reproduces');

    // Not in the list (the list is built from /contracts)…
    await page.goto('/rental-provider/dashboard/tenants');
    await expect(page.getByText(/customers? found/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('cell', { name: `${tenant1First} ${tenant1Last}` })).toHaveCount(0);

    // …and the detail page rejects the RP who just created them. FAILS:
    await page.goto(`/rental-provider/dashboard/tenants/${tenant1Id}`);
    await expect(
      page.getByRole('heading', { name: `${tenant1First} ${tenant1Last}` }),
      'the RP can open the customer they just created',
    ).toBeVisible({ timeout: 20_000 });
  });

  // ── 3c. Contract wizard puts the customer in scope ──────────────────────────

  test('contract wizard creates a contract for the new customer (unlocks the detail page)', async () => {
    const existing = q(
      `SELECT id FROM tenancy_contracts WHERE tenant_id=${tenant1Id} AND rental_provider_id=${RP_PROFILE_ID} ORDER BY id LIMIT 1`,
    );
    if (existing) {
      writeState({ tenant1ContractId: Number(existing) });
      test.skip(true, 're-run: contract already exists from a previous invocation');
    }

    await page.goto(
      `/rental-provider/dashboard/contracts/new?tenantId=${tenant1Id}&tenantName=${encodeURIComponent(`${tenant1First} ${tenant1Last}`)}`,
    );
    // Tenant arrives prefilled (locked card)
    await expect(page.getByText('Pre-filled from lead')).toBeVisible({ timeout: 60_000 });

    // Property + unit (E2E-102 / unit 117 — keeps the published unit 116 clean)
    const propertySelect = page.locator('select').filter({ has: page.locator('option:text-is("Select property…")') });
    await propertySelect.selectOption(String(PROPERTY_ID));
    const unitBtn = page.getByRole('button', { name: new RegExp(`Unit ${UNIT2_NUMBER}`) });
    await expect(unitBtn).toBeVisible({ timeout: 30_000 });
    await unitBtn.click();

    // Start date — RP has no preferred start days, so this is a plain date input;
    // the end date auto-fills to +12 months.
    await page.locator('input[type="date"]').first().fill('2026-07-01');
    // 12-month lease ends the day before the anniversary
    await expect(page.locator('input[type="date"]').nth(1)).toHaveValue('2027-06-30');

    const posted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/contracts' && r.request().method() === 'POST' && r.ok(),
      { timeout: 15_000 }, // BUG-16: the POST comes back 400, so this never matches
    );
    await page.getByRole('button', { name: 'Create Contract' }).click();
    await posted;
    await expect(page.getByRole('heading', { name: 'Contract Created' })).toBeVisible({ timeout: 30_000 });

    const contractId = Number(
      q(`SELECT id FROM tenancy_contracts WHERE tenant_id=${tenant1Id} AND rental_provider_id=${RP_PROFILE_ID} ORDER BY id DESC LIMIT 1`),
    );
    expect(contractId).toBeGreaterThan(0);
    expect(q(`SELECT annual_rent::int FROM tenancy_contracts WHERE id=${contractId}`)).toBe('112000'); // unit 117's listed rent, WHOLE AED
    writeState({ tenant1ContractId: contractId });
  });

  test('fallback: contract via API with NUMERIC fees (BUG-16 workaround, unlocks tenant detail)', async () => {
    const existing = q(
      `SELECT id FROM tenancy_contracts WHERE tenant_id=${tenant1Id} AND rental_provider_id=${RP_PROFILE_ID} ORDER BY id LIMIT 1`,
    );
    if (existing) {
      writeState({ tenant1ContractId: Number(existing) });
      test.skip(true, 're-run: contract already exists');
    }
    // Same endpoint the wizard calls — but with numbers, proving BUG-16 is purely
    // the payload's string typing (page.request carries the RP session cookie).
    const res = await page.request.post('/api/contracts', {
      data: {
        unitId: UNIT2_ID,
        tenantId: tenant1Id,
        contractStartDate: '2026-08-01',
        contractEndDate: '2027-07-31',
        annualRent: 112000,
        securityDepositAmount: 5600,
        adminFee: 5600,
        ejariFee: 220,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const contractId = Number(
      q(`SELECT id FROM tenancy_contracts WHERE tenant_id=${tenant1Id} AND rental_provider_id=${RP_PROFILE_ID} ORDER BY id DESC LIMIT 1`),
    );
    expect(contractId).toBeGreaterThan(0);
    writeState({ tenant1ContractId: contractId });
  });

  // ── 3d. Tenant edit round-trip (EID / nationality / gender / DOB) ───────────

  test('customer edit round-trips EID, nationality, gender and DOB', async () => {
    await page.goto(`/rental-provider/dashboard/tenants/${tenant1Id}`);
    await expect(page.getByRole('heading', { name: `${tenant1First} ${tenant1Last}` })).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit customer' })).toBeVisible();
    // Names prefilled from the create
    await expect(page.getByPlaceholder('First name')).toHaveValue(tenant1First);
    await expect(page.getByPlaceholder('Last name')).toHaveValue(tenant1Last);

    await page.getByPlaceholder('784-YYYY-NNNNNNN-D').fill('784-1990-1234567-1');
    await page.getByPlaceholder('e.g. Emirati').fill('Pakistani');
    await page
      .locator('select')
      .filter({ has: page.locator('option:text-is("Female")') })
      .selectOption('female');
    await page.locator('input[type="date"]').fill('1990-05-15');

    const patched = page.waitForResponse(
      (r) => r.url().includes(`/contracts/tenants/${tenant1Id}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'Save changes' }).click();
    await patched;

    // DB round-trip
    expect(
      q(`SELECT u.emirates_id_number || '|' || u.nationality || '|' || u.gender || '|' || to_char(u.date_of_birth,'YYYY-MM-DD')
         FROM tenants t JOIN users u ON u.id=t.user_id WHERE t.id=${tenant1Id}`),
    ).toBe('784-1990-1234567-1|Pakistani|female|1990-05-15');

    // UI round-trip after a hard reload
    await page.reload();
    await expect(page.getByRole('heading', { name: `${tenant1First} ${tenant1Last}` })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('784-1990-1234567-1')).toBeVisible();
    await expect(page.getByText('Pakistani')).toBeVisible();
    await expect(page.getByText('Female', { exact: true })).toBeVisible();
    await expect(page.getByText('15 May 1990')).toBeVisible();
  });

  // ── 3e. BUG-14 (FIXED): clearing the email shows an explicit error ──────────

  test('clearing the customer email shows an explicit error instead of silently keeping it', async () => {
    await page.goto(`/rental-provider/dashboard/tenants/${tenant1Id}`);
    await expect(page.getByRole('heading', { name: `${tenant1First} ${tenant1Last}` })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByPlaceholder('email@example.com')).toHaveValue(tenant1Email);

    await page.getByPlaceholder('email@example.com').fill(''); // clear email

    // The fix blocks the save client-side with a clear message — no PATCH fires.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      page.getByText(/Email cannot be removed/i),
      'cleared email is rejected with explicit feedback',
    ).toBeVisible({ timeout: 5_000 });

    // The stored email is untouched.
    expect(
      q(`SELECT u.email FROM tenants t JOIN users u ON u.id=t.user_id WHERE t.id=${tenant1Id}`),
    ).toBe(tenant1Email);
  });

  // ── 4a. RP profile: a no-change save must not corrupt the profile row ───────

  const PROFILE_SIG_SQL = `
    SELECT concat_ws('|',
      COALESCE(poa_person_name,'~'), COALESCE(poa_person_phone,'~'), COALESCE(poa_person_email,'~'),
      has_poa::text, COALESCE(authorized_signatory_name,'~'),
      COALESCE(company_name,'~'), COALESCE(company_type,'~'), COALESCE(parent_brokerage_name,'~'),
      COALESCE(trade_license_number,'~'), COALESCE(trade_license_authority,'~'),
      COALESCE(nationality,'~'), COALESCE(gender::text,'~'), COALESCE(date_of_birth::text,'~'),
      COALESCE(emirates_id_number,'~'), COALESCE(passport_number,'~'),
      COALESCE(contact_address,'~'), COALESCE(legal_notices_address,'~'),
      COALESCE(bank_account_name,'~'), COALESCE(bank_iban,'~'), COALESCE(bank_name,'~'),
      entity_type::text)
    FROM rental_providers WHERE id=${RP_PROFILE_ID}`;

  test('profile no-change save leaves every rental_providers column untouched', async () => {
    const before = q(PROFILE_SIG_SQL);
    const nameBefore = q(`SELECT name FROM users WHERE email='${RP_EMAIL}'`);

    const profileLoaded = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'GET' && r.ok(),
    );
    await page.goto('/rental-provider/dashboard/profile');
    await profileLoaded;
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible({ timeout: 60_000 });

    // Capture BOTH parallel PATCHes regardless of status so a 4xx is diagnosable
    const profilePatch = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    const authPatch = page
      .waitForResponse((r) => r.url().includes('/auth/me') && r.request().method() === 'PATCH', {
        timeout: 30_000,
      })
      .catch(() => null);
    await page.getByRole('button', { name: 'Save profile' }).click();
    const pResp = await profilePatch;
    expect(pResp.ok(), `PATCH /profiles/rental-provider/me → ${pResp.status()}: ${await pResp.text()}`).toBe(true);
    const aResp = await authPatch;
    if (aResp) expect(aResp.ok(), `PATCH /auth/me → ${aResp.status()}: ${await aResp.text()}`).toBe(true);
    await expect(page.getByText('Profile saved successfully.')).toBeVisible();

    expect(q(PROFILE_SIG_SQL), 'no-change save must not null/cross-write any profile column').toBe(before);
    expect(q(`SELECT name FROM users WHERE email='${RP_EMAIL}'`)).toBe(nameBefore);
  });

  test('profile save works once gender is chosen; stored nationality prefills; row not corrupted', async () => {
    const nameBefore = q(`SELECT name FROM users WHERE email='${RP_EMAIL}'`);

    const profileLoaded = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'GET' && r.ok(),
    );
    await page.goto('/rental-provider/dashboard/profile');
    await profileLoaded;
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible({ timeout: 60_000 });

    // Stored nationality (demonym 'Emirati') must round-trip into the select
    const natSelect = page.locator('select').filter({ has: page.locator('option:text-is("Select nationality…")') });
    await expect(natSelect).toHaveValue('Emirati');

    // Work around BUG-17 by giving the only-blocking field a value
    const genderSelect = page.locator('select').filter({ has: page.locator('option:text-is("Male")') }).first();
    await genderSelect.selectOption('male');

    const patched = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: 'Save profile' }).click();
    const resp = await patched;
    expect(resp.ok(), `PATCH /profiles/rental-provider/me → ${resp.status()}: ${await resp.text()}`).toBe(true);
    await expect(page.getByText('Profile saved successfully.')).toBeVisible();

    // Only gender changed; nationality survives, name untouched
    expect(q(`SELECT nationality FROM rental_providers WHERE id=${RP_PROFILE_ID}`)).toBe('Emirati');
    expect(q(`SELECT gender FROM rental_providers WHERE id=${RP_PROFILE_ID}`)).toBe('male');
    expect(q(`SELECT name FROM users WHERE email='${RP_EMAIL}'`)).toBe(nameBefore);
  });

  // ── 4b. BUG-15: poaPersonName cross-wired to authorizedSignatoryName ────────

  test('turning POA off clears the POA person name (BUG-15: stale name remains via cross-wire)', async () => {
    const SIGNATORY = `Sami Signatory ${RUN_TAG}`;

    const profileLoaded = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'GET' && r.ok(),
    );
    await page.goto('/rental-provider/dashboard/profile');
    await profileLoaded;
    await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible({ timeout: 60_000 });

    // Turn POA ON and fill the signatory block — this is the only UI that writes these fields.
    const poaToggle = page.getByRole('checkbox', { name: /acting as authorized signatory/i });
    if (!(await poaToggle.isChecked())) await poaToggle.check();
    await page.getByPlaceholder('Full name of the person acting on your behalf').fill(SIGNATORY);
    await page.getByPlaceholder('+971 50 123 4567').fill('+971501239876');
    await page.getByPlaceholder('signatory@example.com').fill(`poa.${runId()}@e2e.upnow.test`);

    const patched1 = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'Save profile' }).click();
    await patched1;
    await expect(page.getByText('Profile saved successfully.')).toBeVisible();
    expect(q(`SELECT has_poa::text || '|' || COALESCE(poa_person_name,'~') FROM rental_providers WHERE id=${RP_PROFILE_ID}`))
      .toBe(`true|${SIGNATORY}`);

    // Now turn POA OFF and save — "someone else acts on my behalf" is no longer true.
    await poaToggle.uncheck();
    const patched2 = page.waitForResponse(
      (r) => r.url().includes('/profiles/rental-provider/me') && r.request().method() === 'PATCH' && r.ok(),
    );
    await page.getByRole('button', { name: 'Save profile' }).click();
    await patched2;

    expect(q(`SELECT has_poa::text FROM rental_providers WHERE id=${RP_PROFILE_ID}`)).toBe('false');
    // Phone/email are nulled when POA is off — but the NAME is not. FAILS:
    expect(
      q(`SELECT COALESCE(poa_person_name,'') FROM rental_providers WHERE id=${RP_PROFILE_ID}`),
      'poa_person_name cleared when POA is turned off (onboarding semantics)',
    ).toBe('');
  });
});
