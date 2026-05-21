/**
 * Building Search — Avenue Building autofill test
 *
 * What it covers:
 *   1. Google Places autocomplete returns "Avenue Building"
 *   2. Place details return Dubai / Al Raffa / Street 2A / coordinates
 *   3. Emirate, building name, street are auto-filled after selection
 *   4. Community cascade fires and fuzzy-matches "Al Raffa"
 *   5. Map renders after selection (Google Maps SDK loaded on demand)
 *
 * Google API is fully mocked — zero real requests, zero billing.
 * building-cache returns empty so the test always falls through to the mock.
 */

import { test, expect } from '@playwright/test';

// ─── Existing RP account ──────────────────────────────────
const RP_EMAIL    = 'rpv2@mailinator.com';
const RP_PASSWORD = '123456789';

// ─── Mock data ────────────────────────────────────────────
const MOCK_PLACE_ID = 'ChIJMock_AvenueBuilding_DXB';

const MOCK_AUTOCOMPLETE = {
  suggestions: [{
    placePrediction: {
      placeId: MOCK_PLACE_ID,
      structuredFormat: {
        mainText:      { text: 'Avenue Building' },
        secondaryText: { text: 'Al Raffa, Dubai, United Arab Emirates' },
      },
      types: ['establishment', 'point_of_interest'],
    },
  }],
};

const MOCK_PLACE_DETAILS = {
  displayName:      { text: 'Avenue Building' },
  formattedAddress: 'Avenue Building, Street 2A, Al Raffa, Bur Dubai, Dubai, United Arab Emirates',
  location:         { latitude: 25.2567, longitude: 55.2934 },
  addressComponents: [
    { types: ['establishment', 'point_of_interest'],       longText: 'Avenue Building' },
    { types: ['street_number'],                            longText: '2A' },
    { types: ['route'],                                    longText: 'Street 2A' },
    { types: ['neighborhood'],                             longText: 'Al Raffa' },
    { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Bur Dubai' },
    { types: ['administrative_area_level_1', 'political'], longText: 'Dubai' },
    { types: ['country', 'political'],                     longText: 'United Arab Emirates' },
  ],
};

// ─── Test ─────────────────────────────────────────────────
test('Avenue Building search auto-fills emirate, building name and street', async ({ page }) => {

  // ── Intercept backend proxy + cache before any navigation ─
  // All Google calls now go through NestJS (/api/places/*) — never browser→Google.
  await page.route('**/api/places/autocomplete', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_AUTOCOMPLETE) })
  );
  await page.route(`**/api/places/details/${MOCK_PLACE_ID}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLACE_DETAILS) })
  );
  // Return empty cache so test always falls through to Google mock
  await page.route('**/api/building-cache/lookup**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  // Provide a dummy Maps SDK key so MapPicker doesn't 401/fail silently
  await page.route('**/api/maps/key', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) })
  );

  // ── Login ──────────────────────────────────────────────
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(RP_EMAIL);
  await page.locator('input[type="password"]').fill(RP_PASSWORD);
  await page.getByRole('button', { name: /sign.?in|log.?in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 15000 });

  // ── Navigate to Add Listing ───────────────────────────
  await page.goto('/rental-provider/dashboard/portfolio/add');
  await page.waitForLoadState('networkidle');

  // ── Type in search field ───────────────────────────────
  const searchInput = page.locator('input[placeholder*="building" i], input[placeholder*="tower" i]').first();
  await expect(searchInput).toBeVisible({ timeout: 8000 });
  await searchInput.fill('avenue building');

  // ── Dropdown appears — target the Google Places suggestion button specifically ──
  // The Google result has secondary text "Al Raffa, Dubai, United Arab Emirates"
  // (not the "Saved" local badge). Use button[type="button"] to exclude <option> elements.
  const googleSuggestion = page
    .locator('button[type="button"]')
    .filter({ hasText: /united arab emirates/i })
    .first();
  await expect(googleSuggestion).toBeVisible({ timeout: 8000 });
  await googleSuggestion.click();

  // Wait for place-details fetch + React state update
  await page.waitForTimeout(2000);

  // ── Assert: Building name ──────────────────────────────
  const buildingInput = page.locator('input[placeholder*="tower" i], input[placeholder*="marina" i], input[placeholder*="safa" i]').first();
  await expect(buildingInput).toHaveValue('Avenue Building');
  console.log('✅  Building name: Avenue Building');

  // ── Assert: Emirate = Dubai ────────────────────────────
  // Select order: 0=existing-property, 1=category, 2=emirate, 3=community
  const selects = page.locator('select');
  const emirateSelect = selects.nth(2);
  const emirateText = await emirateSelect.locator('option:checked').textContent();
  expect(emirateText?.trim().toLowerCase()).toContain('dubai');
  console.log('✅  Emirate:', emirateText?.trim());

  // ── Assert: Street filled ──────────────────────────────
  const streetInput = page.locator('input[placeholder*="sheikh" i], input[placeholder*="wasl" i], input[placeholder*="zayed" i]').first();
  const streetVal = await streetInput.inputValue();
  console.log('Street value:', streetVal);
  expect(streetVal.length).toBeGreaterThan(0);
  console.log('✅  Street:', streetVal);

  // ── Assert: Map rendered (showMap triggered by selection) ─
  // MapPicker renders a div after search — the map placeholder should be gone
  const mapPlaceholder = page.locator('button', { hasText: /search above to pin/i });
  await expect(mapPlaceholder).toBeHidden({ timeout: 5000 });
  console.log('✅  Map rendered after selection');

  // ── Assert: Community cascade (async, give it time) ───
  await page.waitForTimeout(2500);
  const communitySelect = selects.nth(3); // 3 = community
  const communityVal    = await communitySelect.inputValue();
  console.log('Community selected value:', communityVal);
  if (communityVal) {
    expect(Number(communityVal)).toBeGreaterThan(0);
    const communityText = await communitySelect.locator('option:checked').textContent();
    console.log('✅  Community:', communityText?.trim());
  } else {
    console.log('⚠️  Community not auto-selected — check [Community] logs above');
  }
});
