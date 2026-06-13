import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
import {
  loginViaUi,
  pngFile,
  pdfFile,
  q,
  readState,
  writeState,
  runId,
  expectUploadServed,
} from './helpers';

/**
 * 04 — RP builds a portfolio through the UI (RP 8 / rpEmail, compliant since spec 03):
 *   1. /portfolio/add wizard: residential property (Places mocked → Dubai / Al Raffa)
 *      + 2 units with REAL photo uploads + a floor-plan PDF on unit 1.
 *   2. /portfolio "Add unit" → UnitFormModal creates a 3rd unit (floor-plan PDF +
 *      lease terms + amenities), then reopen-edit uploads a photo (photos only
 *      exist inside Edit — by design) and asserts photo + floor plan serve.
 *   3. 2nd property via wizard, then marked STANDALONE in PropertyFormModal edit
 *      (the toggle only exists there) + property-level title-deed PDF upload.
 *   4. BUG-05 (expected fail): unit edit wipes lease terms when amenities are set.
 *   5. BUG-06 (expected fail): furnishing is never persisted anywhere.
 */

const S = readState();
const RP_EMAIL: string = S.rpEmail;
// Per-invocation suffix so re-runs never create ambiguous duplicate names.
const RUN_TAG = Math.random().toString(36).slice(2, 7);
const PROP_NAME = `E2E Tower ${runId()} ${RUN_TAG}`;
const VILLA_NAME = `E2E Villa ${runId()} ${RUN_TAG}`;
const UNIT_NAMES = [
  `Marina Breeze Suite ${RUN_TAG}`,
  `Skyline Loft ${RUN_TAG}`,
  `Garden Corner Flat ${RUN_TAG}`,
];
const UNIT_NUMBERS = ['E2E-101', 'E2E-102', 'E2E-103'];

// ─── Google Places / Maps mocks (pattern from e2e/building-search-autofill.spec.ts) ───
const MOCK_PLACE_ID = 'ChIJMock_E2ETower_DXB';

const MOCK_AUTOCOMPLETE = {
  suggestions: [
    {
      placePrediction: {
        placeId: MOCK_PLACE_ID,
        structuredFormat: {
          mainText: { text: PROP_NAME },
          secondaryText: { text: 'Al Raffa, Dubai, United Arab Emirates' },
        },
        types: ['establishment', 'point_of_interest'],
      },
    },
  ],
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

async function mockExternalServices(page: Page) {
  await page.route('**/api/places/autocomplete', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AUTOCOMPLETE) }),
  );
  await page.route('**/api/places/autocomplete/street', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) }),
  );
  await page.route('**/api/places/details/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLACE_DETAILS) }),
  );
  await page.route('**/api/building-cache/lookup**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/api/maps/key', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) }),
  );
  // External SDKs — never let the test browser hit Google/Mapbox for real.
  await page.route('https://maps.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* mocked maps sdk */' }),
  );
  await page.route('**://*.mapbox.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

// ─── wizard helpers ───────────────────────────────────────────────────────────

/** Expanded unit card on /portfolio/add: selects are [0]=type [1]=bed [2]=bath [3]=furnishing. */
async function fillWizardUnit(
  page: Page,
  row: Locator,
  opts: {
    name: string; unitType: string; unitNumber: string; floor: string;
    bedrooms: string; bathrooms: string; furnishing: string;
    sizeSqm: string; rent: string; view?: string; amenities?: string[];
    photo?: string; floorPlanPdf?: string;
  },
) {
  await row.getByPlaceholder('e.g. Spacious 2BR Apartment with Balcony in Al Raffa').fill(opts.name);
  await row.locator('select').nth(0).selectOption(opts.unitType);
  await row.getByPlaceholder('e.g. 101, G-02').fill(opts.unitNumber);
  await row.getByPlaceholder('e.g. G, 1, 2…').fill(opts.floor);
  await row.locator('select').nth(1).selectOption(opts.bedrooms);
  await row.locator('select').nth(2).selectOption(opts.bathrooms);
  await row.locator('select').nth(3).selectOption(opts.furnishing);
  if (opts.view) {
    await row.getByPlaceholder('e.g. Sea View, Marina View…').fill(opts.view);
    await page.keyboard.press('Escape'); // close the typeahead dropdown
  }
  await row.getByPlaceholder('e.g. 1200').fill(opts.sizeSqm);
  await row.getByPlaceholder('e.g. 85000').fill(opts.rent); // WHOLE AED — auto-calcs the fee box
  for (const a of opts.amenities ?? []) {
    await row.getByRole('button', { name: a, exact: true }).click();
  }
  if (opts.photo) {
    await row.locator('input[type="file"][multiple]').setInputFiles(pngFile(opts.photo));
    await expect(row.getByText('(1/20)')).toBeVisible();
    await expect(row.locator('img').first()).toBeVisible();
  }
  if (opts.floorPlanPdf) {
    await row.locator('input[type="file"]:not([multiple])').setInputFiles(pdfFile(opts.floorPlanPdf));
    await expect(row.getByText(opts.floorPlanPdf)).toBeVisible();
  }
}

/** Property card header on /portfolio (CSS-module class fragments). */
function propHeader(page: Page, name: string) {
  return page.locator('[class*="propH"]').filter({ hasText: name }).first();
}

/** Expand a property card by clicking its chevron (the name span opens a details modal instead). */
async function expandProperty(page: Page, name: string) {
  await propHeader(page, name).locator('[class*="chev"]').click();
}

/** The single open overlay modal (UnitFormModal / PropertyFormModal share this shell). */
function modal(page: Page) {
  return page.locator('div.fixed.inset-0');
}

/** Open the Edit-unit modal for a unit row identified by its unit number. */
async function openUnitEdit(page: Page, unitNumber: string) {
  const numBtn = page.getByRole('button', { name: unitNumber, exact: true });
  await expect(numBtn).toBeVisible();
  // parent of the unit-number button is the row div — Edit lives there
  await numBtn.locator('xpath=..').locator('button[title="Edit unit"]').click();
  await expect(modal(page).getByRole('heading', { name: 'Edit Unit' })).toBeVisible();
}

// ─── suite ─────────────────────────────────────────────────────────────────────

test.describe.serial('04 RP portfolio: wizard, unit modal, standalone + deeds', () => {
  let context: BrowserContext;
  let page: Page;
  let propertyId = 0;
  let villaId = 0;
  const unitIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    expect(RP_EMAIL, 'state.rpEmail from spec 02/03').toBeTruthy();
    context = await browser.newContext();
    page = await context.newPage();
    await mockExternalServices(page);
    await loginViaUi(page, RP_EMAIL, /\/rental-provider\/dashboard/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('wizard creates a residential property with 2 units, photos and a floor plan', async () => {
    await page.goto('/rental-provider/dashboard/portfolio/add');

    // Category — the only select containing the 'venues' option
    const categorySelect = page.locator('select').filter({ has: page.locator('option[value="venues"]') });
    await categorySelect.waitFor({ state: 'visible', timeout: 60_000 });
    await categorySelect.selectOption('residential');

    // Building search (Places fully mocked) → autofill emirate/community/street/name
    await page.getByPlaceholder('Type a building name, tower or street…').fill('e2e tower');
    const suggestion = page
      .locator('button[type="button"]')
      .filter({ hasText: /united arab emirates/i })
      .first();
    await suggestion.click();
    await expect(page.getByText('Fields auto-filled')).toBeVisible();

    const emirateSelect = page
      .locator('select')
      .filter({ has: page.locator('option:text-is("Sharjah")') })
      .first();
    await expect(emirateSelect.locator('option:checked')).toHaveText('Dubai');
    const communitySelect = page
      .locator('select')
      .filter({ has: page.locator('option:text-is("Al Raffa")') })
      .first();
    await expect(communitySelect.locator('option:checked')).toHaveText('Al Raffa', { timeout: 30_000 });
    await expect(page.getByPlaceholder('e.g. Marina Heights')).toHaveValue(PROP_NAME);
    await expect(page.getByPlaceholder('e.g. Sheikh Zayed Road, Al Wasl Road…')).toHaveValue('Street 2A');

    // Unit 1 — photo + floor-plan PDF staged
    const rows = page.locator('div[id^="unit-card-"]');
    await fillWizardUnit(page, rows.nth(0), {
      name: UNIT_NAMES[0], unitType: 'apartment', unitNumber: UNIT_NUMBERS[0], floor: '1',
      bedrooms: '1', bathrooms: '1', furnishing: 'Fully Furnished',
      sizeSqm: '78', rent: '85000', view: 'Sea View',
      amenities: ['Balcony', 'Central A/C'],
      photo: 'unit-101.png', floorPlanPdf: 'plan-101.pdf',
    });

    // Unit 2
    await page.getByRole('button', { name: 'Add another unit' }).click();
    await expect(rows).toHaveCount(2);
    await fillWizardUnit(page, rows.nth(1), {
      name: UNIT_NAMES[1], unitType: 'apartment', unitNumber: UNIT_NUMBERS[1], floor: '2',
      bedrooms: '2', bathrooms: '2', furnishing: 'Unfurnished',
      sizeSqm: '104', rent: '112000',
      photo: 'unit-102.png',
    });

    // Save everything
    await page.getByRole('button', { name: /Save Property \+ 2 Units/ }).click();
    await expect(page.getByText('All done!')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(`${PROP_NAME} + 2 units saved.`)).toBeVisible();
    await expect(page.getByText('Some rows had errors')).toHaveCount(0);

    // DB: property, units, real photo + floor-plan files
    propertyId = Number(q(`SELECT id FROM properties WHERE building_name='${PROP_NAME}' ORDER BY id DESC LIMIT 1`));
    expect(propertyId).toBeGreaterThan(0);
    expect(q(`SELECT space_category::text || '|' || COALESCE(community_id::text,'') FROM properties WHERE id=${propertyId}`)).toBe('residential|370'); // Al Raffa
    for (const num of [UNIT_NUMBERS[0], UNIT_NUMBERS[1]]) {
      const id = Number(q(`SELECT id FROM units WHERE property_id=${propertyId} AND unit_number='${num}'`));
      expect(id, `unit ${num} created`).toBeGreaterThan(0);
      unitIds.push(id);
    }
    expect(q(`SELECT rental_price::int FROM units WHERE id=${unitIds[0]}`)).toBe('85000'); // WHOLE AED, not fils
    const mediaCount = Number(q(`SELECT count(*) FROM unit_media WHERE unit_id IN (${unitIds.join(',')})`));
    expect(mediaCount, 'one photo per wizard unit').toBe(2);
    const photoUrl = q(`SELECT url FROM unit_media WHERE unit_id=${unitIds[0]} ORDER BY id DESC LIMIT 1`);
    await expectUploadServed(page, new URL(photoUrl).pathname);
    const planUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='unit' AND owner_id=${unitIds[0]} AND document_key='floor_plan' ORDER BY id DESC LIMIT 1`,
    );
    expect(planUrl, 'floor-plan document for unit 1').toBeTruthy();
    await expectUploadServed(page, new URL(planUrl).pathname);

    // UI: portfolio lists the property and both units
    await page.getByRole('button', { name: 'Go to Portfolio' }).click();
    await page.waitForURL(/\/rental-provider\/dashboard\/portfolio/);
    await expect(propHeader(page, PROP_NAME)).toBeVisible({ timeout: 60_000 });
    await expandProperty(page, PROP_NAME);
    await expect(page.getByRole('button', { name: UNIT_NUMBERS[0], exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: UNIT_NUMBERS[1], exact: true })).toBeVisible();
    await expect(page.getByText('AED 85,000').first()).toBeVisible();

    writeState({ propertyId, propertyName: PROP_NAME, unitIds: [...unitIds], unitNames: [...UNIT_NAMES], unitNumbers: [...UNIT_NUMBERS] });
  });

  test('Add-unit modal creates a 3rd unit with floor plan + lease terms; reopen-edit adds a photo', async () => {
    await page.goto('/rental-provider/dashboard/portfolio');
    await expect(propHeader(page, PROP_NAME)).toBeVisible({ timeout: 60_000 });
    await expandProperty(page, PROP_NAME);
    await page.getByRole('button', { name: 'Add unit', exact: true }).click();

    const m = modal(page);
    await expect(m.getByRole('heading', { name: 'Add Unit' })).toBeVisible();
    await m.getByPlaceholder('e.g. Spacious 2BR Apartment with Balcony in Al Raffa').fill(UNIT_NAMES[2]);
    await m.locator('select').nth(0).selectOption('apartment');
    await m.getByPlaceholder('e.g. 101, G-02').fill(UNIT_NUMBERS[2]);
    await m.locator('select').nth(1).selectOption('2');           // bedrooms
    await m.locator('select').nth(2).selectOption('1');           // bathrooms
    await m.locator('select').nth(3).selectOption('Fully Furnished'); // furnishing (BUG-06 probe)
    await m.getByPlaceholder('e.g. 1200').fill('950');            // sq.ft in the modal
    await m.getByPlaceholder('e.g. 85000').fill('78000');         // WHOLE AED
    // Lease terms (BUG-05 probe — must survive future edits)
    await m.getByPlaceholder('12', { exact: true }).fill('24');
    await m.getByPlaceholder('60', { exact: true }).fill('90');
    await m.getByPlaceholder('e.g. 5', { exact: true }).fill('5');
    // Amenities
    await m.getByRole('button', { name: 'Gym', exact: true }).click();
    await m.getByRole('button', { name: 'Parking', exact: true }).click();
    // Floor-plan PDF (file inputs accepting pdf: [0]=floor plan, [1]=per-unit title deed)
    await m.locator('input[type="file"][accept^="application/pdf"]').nth(0).setInputFiles(pdfFile('plan-103.pdf'));
    await expect(m.getByText('plan-103.pdf')).toBeVisible();

    const unitPosted = page.waitForResponse(
      (r) => r.url().includes(`/properties/${propertyId}/units`) && r.request().method() === 'POST' && r.ok(),
    );
    const planPosted = page.waitForResponse(
      (r) => r.url().includes('/floor-plan') && r.request().method() === 'POST' && r.ok(),
    );
    await m.getByRole('button', { name: 'Add Unit', exact: true }).click();
    await unitPosted;
    await planPosted;
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: UNIT_NUMBERS[2], exact: true })).toBeVisible();

    const unitId3 = Number(q(`SELECT id FROM units WHERE property_id=${propertyId} AND unit_number='${UNIT_NUMBERS[2]}'`));
    expect(unitId3).toBeGreaterThan(0);
    unitIds.push(unitId3);
    // lease terms persisted at CREATE time (the wipe only happens on edit — BUG-05)
    const facilities = q(`SELECT facilities FROM units WHERE id=${unitId3}`);
    expect(facilities).toContain('"minLeaseMonths":24');
    expect(facilities).toContain('"noticePeriodDays":90');
    expect(facilities).toContain('Gym');

    // Reopen in EDIT mode — photos can only be managed here (PhotosSection)
    await openUnitEdit(page, UNIT_NUMBERS[2]);
    const edit = modal(page);
    const planLink = edit.getByRole('link', { name: /A floor plan is already attached/ });
    await expect(planLink).toBeVisible();
    const planHref = await planLink.getAttribute('href');
    expect(planHref).toBeTruthy();
    await expectUploadServed(page, new URL(planHref!, 'http://localhost:3010').pathname);

    const photoPosted = page.waitForResponse(
      (r) => r.url().includes(`/units/${unitId3}/media`) && r.request().method() === 'POST' && r.ok(),
    );
    await edit.locator('input[type="file"][accept="image/png,image/jpeg,image/webp"]').setInputFiles(pngFile('unit-103.png'));
    await photoPosted;
    const thumb = edit.locator('img').first();
    await expect(thumb).toBeVisible();
    const thumbSrc = await thumb.getAttribute('src');
    await expectUploadServed(page, new URL(thumbSrc!, 'http://localhost:3010').pathname);
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal(page)).toHaveCount(0);

    expect(Number(q(`SELECT count(*) FROM unit_media WHERE unit_id=${unitId3}`))).toBe(1);
    writeState({ unitIds: [...unitIds] });
  });

  test('2nd property marked standalone in edit modal carries a property-level title deed', async () => {
    // Create the 2nd property through the wizard (modal create is not reachable:
    // the portfolio "Add property" button routes to the wizard).
    await page.goto('/rental-provider/dashboard/portfolio/add');
    const categorySelect = page.locator('select').filter({ has: page.locator('option[value="venues"]') });
    await categorySelect.waitFor({ state: 'visible', timeout: 60_000 });
    await categorySelect.selectOption('residential');

    const emirateSelect = page
      .locator('select')
      .filter({ has: page.locator('option:text-is("Sharjah")') })
      .first();
    await expect(emirateSelect).toBeEnabled({ timeout: 30_000 }); // UAE auto-selected as country
    await emirateSelect.selectOption({ label: 'Dubai' });
    await page.getByPlaceholder('e.g. Marina Heights').fill(VILLA_NAME);
    await page.getByPlaceholder('e.g. Sheikh Zayed Road, Al Wasl Road…').fill('E2E Villa Street');

    const rows = page.locator('div[id^="unit-card-"]');
    await fillWizardUnit(page, rows.nth(0), {
      name: `Whole Villa ${RUN_TAG}`, unitType: 'villa', unitNumber: 'V-01', floor: 'G',
      bedrooms: '4', bathrooms: '4', furnishing: 'Unfurnished',
      sizeSqm: '400', rent: '250000',
    });
    await page.getByRole('button', { name: /Save Property \+ 1 Unit/ }).click();
    await expect(page.getByText('All done!')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Some rows had errors')).toHaveCount(0);

    villaId = Number(q(`SELECT id FROM properties WHERE building_name='${VILLA_NAME}' ORDER BY id DESC LIMIT 1`));
    expect(villaId).toBeGreaterThan(0);

    // Mark standalone in EDIT mode (the toggle only exists in PropertyFormModal) + title deed
    await page.getByRole('button', { name: 'Go to Portfolio' }).click();
    await page.waitForURL(/\/rental-provider\/dashboard\/portfolio/);
    await expect(propHeader(page, VILLA_NAME)).toBeVisible({ timeout: 60_000 });
    await propHeader(page, VILLA_NAME).locator('button[title="Edit property"]').click();

    const m = modal(page);
    await expect(m.getByRole('heading', { name: 'Edit Property' })).toBeVisible();
    await m.locator('input[type="checkbox"]').check(); // Standalone unit
    await m.locator('input[type="file"]').setInputFiles(pdfFile('title-deed.pdf'));
    await expect(m.getByText('title-deed.pdf')).toBeVisible();

    const patched = page.waitForResponse(
      (r) => r.url().includes(`/properties/${villaId}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    const deedRecorded = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/documents' && r.request().method() === 'POST' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;
    await deedRecorded;
    await expect(modal(page)).toHaveCount(0);

    // DB: standalone flag + title-deed document row; file actually serves
    expect(q(`SELECT is_standalone_unit FROM properties WHERE id=${villaId}`)).toBe('t');
    const deedUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='property' AND owner_id=${villaId} AND document_key='title_deed' ORDER BY id DESC LIMIT 1`,
    );
    expect(deedUrl, 'title-deed document row created').toBeTruthy();
    await expectUploadServed(page, new URL(deedUrl).pathname);

    // UI: standalone properties hide the "Add unit" button
    await expandProperty(page, VILLA_NAME);
    await expect(page.getByRole('button', { name: 'V-01', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add unit', exact: true })).toHaveCount(0);

    writeState({
      standalonePropertyId: villaId,
      standalonePropertyName: VILLA_NAME,
      standaloneUnitId: Number(q(`SELECT id FROM units WHERE property_id=${villaId} AND unit_number='V-01'`)),
    });
  });

  test('unit edit preserves lease terms (BUG-05: wiped when amenities are set)', async () => {
    const unitId3 = unitIds[2];
    await page.goto('/rental-provider/dashboard/portfolio');
    await expect(propHeader(page, PROP_NAME)).toBeVisible({ timeout: 60_000 });
    await expandProperty(page, PROP_NAME);
    await openUnitEdit(page, UNIT_NUMBERS[2]);

    const m = modal(page);
    // Save without touching anything — a no-op edit must not lose data
    const patched = page.waitForResponse(
      (r) => r.url().includes(`/units/${unitId3}`) && r.request().method() === 'PATCH' && r.ok(),
    );
    await m.getByRole('button', { name: 'Save Changes' }).click();
    await patched;

    const facilities = q(`SELECT facilities FROM units WHERE id=${unitId3}`);
    expect(facilities, 'lease terms survive a no-op edit').toContain('minLeaseMonths'); // FAILS: wiped to plain amenities array
    // Display half of the same bug: the edit form never shows the saved lease terms
    await page.reload();
    await expandProperty(page, PROP_NAME);
    await openUnitEdit(page, UNIT_NUMBERS[2]);
    await expect(modal(page).getByPlaceholder('12', { exact: true })).toHaveValue('24');
  });

  test('furnishing persists across unit edit (BUG-06: never stored anywhere)', async () => {
    await page.goto('/rental-provider/dashboard/portfolio');
    await expect(propHeader(page, PROP_NAME)).toBeVisible({ timeout: 60_000 });
    await expandProperty(page, PROP_NAME);
    // Unit 3 was created with furnishing 'Fully Furnished' in the modal
    await openUnitEdit(page, UNIT_NUMBERS[2]);
    const furnishingSelect = modal(page)
      .locator('select')
      .filter({ has: page.locator('option:text-is("Fully Furnished")') })
      .first();
    await expect(furnishingSelect.locator('option:checked')).toHaveText('Fully Furnished'); // FAILS: always 'Unfurnished'
  });
});
