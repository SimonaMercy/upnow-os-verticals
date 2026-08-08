/**
 * Add Property — Community / Area list must never come up empty
 *
 * The bug: picking a Google result re-drove the cascade with `setLoadCommsFor(null)`
 * followed by `setLoadCitiesFor(<same emirate>)`. Same value ⇒ the city effect never
 * re-ran ⇒ nothing ever re-requested the communities, so the list the null had just
 * wiped stayed empty. Reproduces whenever the emirate was already selected — which is
 * always, because the search itself selects it.
 *
 * Covers:
 *   1. Emirate picked manually → full Dubai community list loads
 *   2. Google pick whose neighbourhood matches nothing in the DB → list SURVIVES
 *   3. Second Google pick in the same emirate → list still there
 *   4. Ajman (8 municipal sectors, no auto-selectable city) → emirate-wide fallback
 *
 * Google is fully mocked — zero real requests, zero billing.
 */

import { test, expect, type Page } from '@playwright/test';

const RP_EMAIL = process.env.RP_EMAIL ?? 'kbaalfalasi@gmail.com';

const PLACE_DXB   = 'ChIJMock_NoMatchTower_DXB';
const PLACE_DXB_2 = 'ChIJMock_SecondTower_DXB';
const PLACE_AJM   = 'ChIJMock_NoMatchTower_AJM';

/** A neighbourhood that exists in no UAE community table, so the fuzzy match must fail. */
const UNKNOWN_AREA = 'Qqz Nonexistent Quarter';

const autocomplete = (placeId: string, main: string, secondary: string) => ({
  suggestions: [{
    placePrediction: {
      placeId,
      structuredFormat: { mainText: { text: main }, secondaryText: { text: secondary } },
      types: ['establishment', 'point_of_interest'],
    },
  }],
});

const details = (name: string, emirate: string) => ({
  displayName:      { text: name },
  formattedAddress: `${name}, ${UNKNOWN_AREA}, ${emirate}, United Arab Emirates`,
  location:         { latitude: 25.2567, longitude: 55.2934 },
  addressComponents: [
    { types: ['establishment', 'point_of_interest'],       longText: name },
    { types: ['route'],                                    longText: 'Street 9Z' },
    { types: ['neighborhood'],                             longText: UNKNOWN_AREA },
    { types: ['administrative_area_level_1', 'political'], longText: emirate },
    { types: ['country', 'political'],                     longText: 'United Arab Emirates' },
  ],
});

/** Everything is scoped to the slide-over — the portfolio page behind it has a
 *  "Search building, area, emirate…" filter that would otherwise win. */
const modal = (page: Page) => page.locator('.slideover-panel');

/** Selects found by their own placeholder option, not a positional index. */
function communitySelect(page: Page) {
  return modal(page).locator('select').filter({ hasText: /Select Community|Select Emirate first/ }).first();
}
function emirateSelect(page: Page) {
  return modal(page).locator('select').filter({ hasText: 'Select Emirate' })
    .filter({ hasNotText: /Select Community|Select Emirate first/ }).first();
}

async function optionCount(page: Page) {
  // minus the leading placeholder <option value="">
  return (await communitySelect(page).locator('option').count()) - 1;
}

async function pickGoogleResult(page: Page, query: string) {
  await modal(page).locator('input[placeholder*="building name" i]').first().fill(query);
  const suggestion = modal(page).locator('button[type="button"]')
    .filter({ hasText: /united arab emirates/i }).first();
  await expect(suggestion).toBeVisible({ timeout: 8000 });
  await suggestion.click();
  await page.waitForLoadState('networkidle');
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/places/autocomplete', async route => {
    const body = route.request().postDataJSON() as { input?: string };
    const q = (body?.input ?? '').toLowerCase();
    const mock = q.includes('ajman')
      ? autocomplete(PLACE_AJM, 'Nomatch Tower Ajman', `${UNKNOWN_AREA}, Ajman, United Arab Emirates`)
      : q.includes('second')
        ? autocomplete(PLACE_DXB_2, 'Second Tower', `${UNKNOWN_AREA}, Dubai, United Arab Emirates`)
        : autocomplete(PLACE_DXB, 'Nomatch Tower', `${UNKNOWN_AREA}, Dubai, United Arab Emirates`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock) });
  });
  await page.route(`**/api/places/details/${PLACE_DXB}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(details('Nomatch Tower', 'Dubai')) }));
  await page.route(`**/api/places/details/${PLACE_DXB_2}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(details('Second Tower', 'Dubai')) }));
  await page.route(`**/api/places/details/${PLACE_AJM}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(details('Nomatch Tower Ajman', 'Ajman')) }));
  // Empty building-cache so every search falls through to the Google mock
  await page.route('**/api/building-cache/lookup**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/maps/key', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'test-maps-key' }) }));

  // Sign-in is email → 6-digit OTP; dev returns the code inline.
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email: RP_EMAIL } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: RP_EMAIL, code: devOtp },
  });
  expect(verify.ok(), 'signed in').toBeTruthy();

  await page.goto('/rental-provider/dashboard/portfolio');
  await page.getByRole('button', { name: /add property/i }).first().click();
  await expect(emirateSelect(page)).toBeVisible({ timeout: 10000 });
});

test('community list survives a Google pick that matches no known community', async ({ page }) => {
  // 1 — manual emirate pick loads the full Dubai list
  await emirateSelect(page).selectOption({ label: 'Dubai' });
  await expect.poll(() => optionCount(page), { timeout: 10000 }).toBeGreaterThan(100);
  const baseline = await optionCount(page);

  // 2 — Google pick in the SAME emirate, neighbourhood matches nothing
  await pickGoogleResult(page, 'nomatch tower');
  await expect(modal(page).locator('input[placeholder*="safa" i]').first())
    .toHaveValue('Nomatch Tower');
  await expect.poll(() => optionCount(page), { timeout: 10000 }).toBe(baseline);
  await expect(communitySelect(page)).toBeEnabled();
  await expect(communitySelect(page)).toHaveValue('');   // nothing auto-matched

  // 3 — a second pick must not wipe it either
  await pickGoogleResult(page, 'second tower');
  await expect.poll(() => optionCount(page), { timeout: 10000 }).toBe(baseline);

  // 4 — and the list is actually usable
  await communitySelect(page).selectOption({ label: 'Al Barsha' });
  await expect(communitySelect(page)).not.toHaveValue('');
});

test('editing an existing property still shows its saved community', async ({ page }) => {
  // The mount cascade now drives communities off the city load rather than
  // requesting them itself — an edit must still resolve the saved selection.
  // :visible matters — row and grid layouts both render a pencil, only one is shown.
  await page.goto('/rental-provider/dashboard/portfolio');
  const pencil = page.locator('button[aria-label="Edit property"]:visible').first();
  await expect(pencil).toBeVisible({ timeout: 15000 });
  await pencil.click();
  await expect(modal(page).getByRole('heading', { name: 'Edit Property' })).toBeVisible({ timeout: 10000 });

  await expect.poll(() => optionCount(page), { timeout: 10000 }).toBeGreaterThan(10);
  await expect(communitySelect(page)).not.toHaveValue('');
  // …and the name resolved, not just the id
  const label = await communitySelect(page).locator('option:checked').textContent();
  expect(label?.trim()).not.toBe('Select Community');
});

test('Ajman falls back to the emirate-wide community list', async ({ page }) => {
  // Ajman is split into 8 municipal sectors, so no city auto-selects and the
  // city-scoped request has nothing to key on.
  await emirateSelect(page).selectOption({ label: 'Ajman' });
  await expect.poll(() => optionCount(page), { timeout: 10000 }).toBeGreaterThan(10);
  await expect(communitySelect(page)).toBeEnabled();

  // Picking a community back-fills the sector it belongs to
  const first = await communitySelect(page).locator('option').nth(1).textContent();
  await communitySelect(page).selectOption({ label: first!.trim() });
  const sector = page.locator('select').filter({ hasText: 'Select City / Sector' }).first();
  await expect(sector).not.toHaveValue('');
});
