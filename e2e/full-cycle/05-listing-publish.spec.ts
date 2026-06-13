import { test, expect, Page } from '@playwright/test';
import {
  expectUploadServed,
  logout,
  q,
  readState,
  safeAdminLogin,
  safeLoginViaUi,
  writeState,
} from './helpers';

/**
 * 05 — listing lifecycle through the UI:
 *   RP submits a unit (draft → pending) → admin approves (→ published) →
 *   the public marketplace shows it; second unit goes submit → admin REJECT →
 *   RP sees the rejected state.
 *
 * Uses the property/units created by 04-rp-portfolio.spec.ts:
 *   state.propertyId / propertyName, state.unitIds[0..2] (E2E-101/102/103).
 */

// ─── shared page helpers ──────────────────────────────────────────────────────

/** Open /portfolio as the logged-in RP and expand the e2e property card. */
async function openPortfolioAndExpand(page: Page, propertyName: string, propertyId: number) {
  const propsLoaded = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/properties' && r.ok(),
    { timeout: 60_000 },
  );
  await page.goto('/rental-provider/dashboard/portfolio');
  await propsLoaded;

  const header = page.locator('[class*="propH"]').filter({ hasText: propertyName });
  await expect(header).toBeVisible({ timeout: 30_000 });

  const unitsLoaded = page.waitForResponse(
    (r) => r.url().includes(`/properties/${propertyId}/units`) && r.ok(),
    { timeout: 30_000 },
  );
  // chevron expands; clicking the NAME span would open the details modal instead
  await header.locator('[class*="chev"]').click();
  await unitsLoaded;
}

/** Unit row container for a given unit number inside the expanded card. */
function unitRow(page: Page, unitNumber: string) {
  return page
    .locator('button[class*="unitNum"]')
    .filter({ hasText: unitNumber })
    .locator('xpath=..');
}

/** RP submits a unit for listing review; asserts the Pending state in the UI + DB. */
async function rpSubmitUnit(page: Page, st: Record<string, any>, idx: number) {
  await openPortfolioAndExpand(page, st.propertyName, st.propertyId);
  const row = unitRow(page, st.unitNumbers[idx]);
  await expect(row).toBeVisible({ timeout: 20_000 });

  const patched = page.waitForResponse(
    (r) =>
      r.url().includes(`/units/${st.unitIds[idx]}/submit-listing`) &&
      r.request().method() === 'PATCH' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await row.getByRole('button', { name: 'Submit', exact: true }).click();
  await patched;

  // pill flips Draft → Pending, Submit is replaced by Withdraw
  await expect(row.locator('[class*="pill"]').first()).toHaveText(/Pending/, { timeout: 20_000 });
  await expect(row.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  expect(q(`SELECT listing_status FROM units WHERE id=${st.unitIds[idx]}`)).toBe('pending');
}

/**
 * Admin reviews the pending submission in /dashboard/admin/listings and
 * approves or rejects it. Both actions go through a native confirm() dialog.
 */
async function adminDecideListing(
  page: Page,
  st: Record<string, any>,
  idx: number,
  decision: 'Approve' | 'Reject',
) {
  const pendingLoaded = page.waitForResponse(
    (r) => r.url().includes('/admin/listings/pending') && r.ok(),
    { timeout: 60_000 },
  );
  await page.goto('/dashboard/admin/listings');
  await pendingLoaded;

  // left-panel queue card for our unit
  const card = page.locator('button').filter({ hasText: `Unit ${st.unitNumbers[idx]}` });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(st.propertyName);
  await expect(card).toContainText('Pending');

  const detailLoaded = page.waitForResponse(
    (r) => r.url().includes(`/admin/listings/${st.propertyId}/units/${st.unitIds[idx]}`) && r.ok(),
    { timeout: 30_000 },
  );
  await card.click();
  await detailLoaded;

  // detail panel renders the action bar once details are in
  const actionBtn = page.getByRole('button', { name: decision, exact: true });
  await expect(actionBtn).toBeEnabled({ timeout: 20_000 });

  page.on('dialog', (d) => void d.accept()); // native confirm() gate
  const acted = page.waitForResponse(
    (r) =>
      r.url().includes(`/units/${st.unitIds[idx]}/${decision.toLowerCase()}`) &&
      r.request().method() === 'PATCH' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await actionBtn.click();
  await acted;

  // card leaves the approval queue
  await expect(card).toHaveCount(0, { timeout: 20_000 });
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe.serial('05 listing publish lifecycle', () => {
  test('RP submits unit[0] for listing — pill flips to Pending', async ({ page }) => {
    const st = readState();
    await safeLoginViaUi(page, st.rpEmail);
    await rpSubmitUnit(page, st, 0);
  });

  test('admin approves the pending submission — unit becomes published', async ({ page }) => {
    const st = readState();
    await safeAdminLogin(page);
    await adminDecideListing(page, st, 0, 'Approve');

    expect(q(`SELECT listing_status FROM units WHERE id=${st.unitIds[0]}`)).toBe('published');
    expect(q(`SELECT is_listed FROM units WHERE id=${st.unitIds[0]}`)).toBe('t');
    writeState({ publishedUnitId: st.unitIds[0] });
  });

  test('public browse + detail page show the published unit with un-corrupted AED rent and served photos', async ({
    page,
  }) => {
    const st = readState();
    // logged out by default (fresh context). Mute external embeds for determinism.
    await page.route('https://www.openstreetmap.org/**', (r) => r.abort());
    await page.route('https://images.unsplash.com/**', (r) => r.abort());

    // ── browse: free-text search by building name finds the card ──
    await page.goto(`/listings?q=${encodeURIComponent(st.propertyName)}`);
    const cardLink = page.locator(`a[href="/listings/units/${st.unitIds[0]}"]`);
    await expect(cardLink).toBeVisible({ timeout: 30_000 });
    await expect(cardLink).toContainText(st.unitNames[0]); // unit display name
    await expect(cardLink).toContainText(st.propertyName); // building name
    // 85000 WHOLE AED — must render 85,000 (not the ÷100-corrupted 850)
    await expect(cardLink).toContainText('AED 85,000');

    // ── detail page ──
    await page.goto(`/listings/units/${st.unitIds[0]}`);
    await expect(page.getByRole('heading', { name: st.unitNames[0] })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(st.propertyName).first()).toBeVisible(); // inquiry panel provider block
    await expect(page.getByText('Annual Rent', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('AED 85,000').first()).toBeVisible();
    await expect(page.getByText('AED 850', { exact: true })).toHaveCount(0); // ÷100 guard
    await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();

    // gallery hero is the real uploaded unit photo — must serve through the proxy
    const heroImg = page.locator(`img[alt="${st.unitNames[0]}"]`).first();
    await expect(heroImg).toBeVisible();
    const src = await heroImg.getAttribute('src');
    expect(src, 'gallery hero img src').toBeTruthy();
    expect(src!).toContain('/uploads/'); // real upload, not an unsplash fallback
    await expectUploadServed(page, new URL(src!, 'http://localhost:3010').pathname);
  });

  test('browse card cover photo URL actually serves (real upload, not broken)', async ({
    page,
  }) => {
    const st = readState();
    await page.route('https://images.unsplash.com/**', (r) => r.abort());
    await page.goto(`/listings?q=${encodeURIComponent(st.propertyName)}`);
    const cardLink = page.locator(`a[href="/listings/units/${st.unitIds[0]}"]`);
    await expect(cardLink).toBeVisible({ timeout: 30_000 });

    const img = cardLink.locator('img').first();
    const src = await img.getAttribute('src');
    expect(src, 'card cover img src').toBeTruthy();
    // the unit HAS a real photo, so the card must not fall back to a stock image
    expect(src!).not.toContain('unsplash');
    const res = await page.request.get(src!);
    expect(res.status(), `GET ${src}`).toBe(200);
  });

  test('unit[1]: RP submits → admin rejects → RP sees Rejected + Resubmit', async ({ page }) => {
    const st = readState();

    // 1) RP submits the second unit
    await safeLoginViaUi(page, st.rpEmail);
    await rpSubmitUnit(page, st, 1);
    await logout(page);

    // 2) admin rejects it
    await safeAdminLogin(page);
    await adminDecideListing(page, st, 1, 'Reject');
    expect(q(`SELECT listing_status FROM units WHERE id=${st.unitIds[1]}`)).toBe('rejected');
    expect(q(`SELECT is_listed FROM units WHERE id=${st.unitIds[1]}`)).toBe('f');
    await logout(page);

    // 3) RP sees the rejected state on the portfolio row
    await safeLoginViaUi(page, st.rpEmail);
    await openPortfolioAndExpand(page, st.propertyName, st.propertyId);
    const row = unitRow(page, st.unitNumbers[1]);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('[class*="pill"]').first()).toHaveText(/Rejected/);
    await expect(row.getByRole('button', { name: 'Resubmit', exact: true })).toBeVisible();

    // a rejected unit must NOT appear on the public marketplace
    expect(
      q(
        `SELECT count(*) FROM units WHERE id=${st.unitIds[1]} AND listing_status='published'`,
      ),
    ).toBe('0');
    writeState({ rejectedUnitId: st.unitIds[1] });
  });

  test('RP can resubmit a rejected listing via the Resubmit button', async ({ page }) => {
    const st = readState();
    await safeLoginViaUi(page, st.rpEmail);
    await openPortfolioAndExpand(page, st.propertyName, st.propertyId);
    const row = unitRow(page, st.unitNumbers[1]);
    await expect(row).toBeVisible({ timeout: 20_000 });

    const respPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/units/${st.unitIds[1]}/submit-listing`) &&
        r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    await row.getByRole('button', { name: 'Resubmit', exact: true }).click();
    const resp = await respPromise;

    // resubmission should be accepted and flip the row back to Pending
    expect(resp.status(), 'resubmit request should succeed').toBeLessThan(400);
    await expect(row.locator('[class*="pill"]').first()).toHaveText(/Pending/, {
      timeout: 15_000,
    });
  });
});
