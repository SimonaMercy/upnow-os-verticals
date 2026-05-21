/**
 * RP Onboarding — all 4 account type flows.
 *
 * Verifies for each rental-provider account type:
 *   1. "Banking Details" section is NOT present anywhere (was removed).
 *   2. "Authorised signatory name" field is NOT present anywhere (was removed).
 *   3. Emirates ID badge is "Required" for Individual, "Optional" for all
 *      company types (after the authorised-signatory field was removed).
 *   4. Each company sub-type shows only its expected document list.
 *
 * Account types tested:
 *   Individual Landlord | Landlord Company | Brokerage Company | Agents Company
 *
 * Prerequisites:
 *   - Backend on http://localhost:3001 (NODE_ENV != 'production')
 *   - Frontend on http://localhost:3000
 *
 * Uses serial mode so all 4 tests share one registered browser context
 * (saves re-registering for every case).
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// ─── Shared context (one registered RP user for all 4 tests) ─────────────────

let ctx: BrowserContext;
let page: Page;

function uniqueEmail(prefix: string) {
  return `${prefix}_${Date.now()}@test.upnow.ae`;
}

// ─── Describe block ───────────────────────────────────────────────────────────

test.describe.serial('RP Onboarding — 4 account types', () => {

  // Register one RP user once, then pre-verify the phone via API.
  // All 4 tests share this authenticated context.
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    ctx  = await browser.newContext();
    page = await ctx.newPage();

    // 1. Register via UI (httpOnly cookie set through Next.js proxy)
    const email = uniqueEmail('rp_ob');
    await page.goto('/register/rental-provider');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/verify-email/, { timeout: 10_000 });
    const devOtp = new URL(page.url()).searchParams.get('devOtp');
    expect(devOtp, 'devOtp must be present in URL (dev mode only)').toBeTruthy();

    await page.locator('input[inputmode="numeric"]').first().click();
    await page.keyboard.type(devOtp!, { delay: 30 });
    await page.getByRole('button', { name: /verify email|create account|continue/i }).click();
    await expect(page).toHaveURL(/rental-provider|onboarding/, { timeout: 15_000 });

    // 2. Pre-verify phone via API (same cookie → same session)
    //    This prevents the Details section from blocking on the OTP widget.
    await page.request.patch('/api/auth/me', { data: { phone: '501234567' } });
    const otpReq = await page.request.post('/api/auth/otp/request', { data: {} });
    expect(otpReq.ok(), `/api/auth/otp/request failed: ${otpReq.status()}`).toBeTruthy();
    const { devOtp: phoneOtp } = (await otpReq.json()) as { devOtp: string };
    expect(phoneOtp).toMatch(/^\d{6}$/);
    const verifyRes = await page.request.post('/api/auth/otp/verify', { data: { code: phoneOtp } });
    expect(verifyRes.ok(), `/api/auth/otp/verify failed: ${verifyRes.status()}`).toBeTruthy();
  });

  test.afterAll(async () => {
    await page.close();
    await ctx.close();
  });

  // ─── Shared helpers ─────────────────────────────────────────────────────────

  /** Navigate to the onboarding page and wait for the Account Type section. */
  async function goOnboarding() {
    await page.goto('/rental-provider/dashboard/onboarding');
    // The stepper label "Account Type" is always visible once the page loads.
    await expect(page.getByRole('heading', { name: 'Account Type' })).toBeVisible({ timeout: 12_000 });
  }

  /**
   * Assert that neither removed field appears anywhere on the current page.
   * Both assertions are NOT-visible so they pass even if text is in collapsed
   * (locked) sections that don't render to the DOM.
   */
  async function assertRemovedFields() {
    await expect(page.getByText('Banking Details')).not.toBeVisible();
    await expect(page.getByText(/Authorised signatory name/i)).not.toBeVisible();
  }

  /**
   * Fill the Details / "Your Info" section and click Save & continue.
   * Phone is already pre-verified, so the Verified badge should auto-show.
   * @param nationality  Pass a value for Individual flows (company flows skip it).
   */
  async function fillDetails(nationality?: string) {
    // Wait for the section to become active
    await expect(page.getByPlaceholder('Your full legal name')).toBeVisible({ timeout: 8_000 });

    await page.getByPlaceholder('Your full legal name').fill('Test Onboarding User');

    // Expect pre-verified phone to show Verified badge (exact match avoids
    // catching the heroDesc text "Get verified to start collecting…")
    await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 8_000 });

    if (nationality) {
      await page.locator('select').first().selectOption(nationality);
    }

    // Confirm removed fields are absent on this section too
    await assertRemovedFields();

    await page.getByRole('button', { name: /save.*continue/i }).click();
  }

  /**
   * Fill the Business Details section and click Save & continue.
   * @param isAgent         If true, also fills "Parent brokerage" field.
   * @param parentBrokerage Name to type for agents (free-text).
   */
  async function fillBusiness(isAgent = false, parentBrokerage?: string) {
    await expect(page.getByPlaceholder('Registered business name')).toBeVisible({ timeout: 8_000 });

    await page.getByPlaceholder('Registered business name').fill('Test Corp LLC');
    await page.getByPlaceholder('e.g. 1234567').fill('TL-99999');
    // Trade licence authority — first <select> that contains "Dubai DED" as an option
    await page.locator('select').first().selectOption('Dubai DED');

    if (isAgent && parentBrokerage) {
      await page.getByPlaceholder(/search registered brokerages/i).fill(parentBrokerage);
    }

    await assertRemovedFields();

    await page.getByRole('button', { name: /save.*continue/i }).click();
  }

  /**
   * Assert the Emirates ID document row carries the expected badge.
   *
   * Looks for the exact span text "Emirates ID" inside a document row,
   * then reads the full text of the sibling container to verify the badge.
   *
   * The DOM structure (from SectionKyc):
   *   <div class="docRow">
   *     <div class="docRowMeta">
   *       <div class="docRowTop">
   *         <span class="docRowName">Emirates ID</span>
   *         <span class="badge badgeReq|badgeOpt">Required|Optional</span>
   *       </div>
   *     </div>
   *   </div>
   */
  async function assertEmiratesIdBadge(expected: 'Required' | 'Optional') {
    const eidSpan = page.getByText('Emirates ID', { exact: true }).first();
    await expect(eidSpan).toBeVisible({ timeout: 8_000 });
    // Parent div = docRowTop which holds both the name and the badge
    const docRowTopText = await eidSpan.locator('..').textContent();
    expect(
      docRowTopText,
      `Expected Emirates ID row to contain badge "${expected}" but got: "${docRowTopText}"`,
    ).toContain(expected);
  }

  // ─── Test 1: Individual Landlord ────────────────────────────────────────────

  test('01 — Individual Landlord: no removed fields; Emirates ID required', async () => {
    await goOnboarding();

    // Account Type section is active — Individual should be selected by default
    await expect(page.getByText('Individual Landlord').first()).toBeVisible();
    await assertRemovedFields();

    // Advance to Details
    await page.getByRole('button', { name: 'Continue' }).click();

    // Details section (individual = "Your Details")
    await fillDetails('Emirati');

    // Individual has no Business or Shareholders sections, so Documents is next
    await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 8_000 });
    await assertRemovedFields();

    // Emirates ID MUST be required for individuals
    await assertEmiratesIdBadge('Required');

    // Sanity: no company-only docs visible
    await expect(page.getByText('Trade License')).not.toBeVisible();
    await expect(page.getByText('Brokerage License')).not.toBeVisible();
  });

  // ─── Test 2: Landlord Company ───────────────────────────────────────────────

  test('02 — Landlord Company: no removed fields; Emirates ID optional; no brokerage licence', async () => {
    await goOnboarding();

    // Select Landlord Company card
    await page.getByText('Landlord Company').first().click();
    await assertRemovedFields();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Details — company mode shows "Your Information"
    await fillDetails(); // no nationality needed for company

    // Business Details
    await expect(page.getByRole('heading', { name: 'Business Details' })).toBeVisible({ timeout: 8_000 });
    await fillBusiness();

    // Shareholders (0 — button enabled even with zero shareholders)
    await expect(page.getByRole('heading', { name: 'Shareholders' })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /save.*continue/i }).click();

    // KYC Documents
    await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 8_000 });
    await assertRemovedFields();

    // Emirates ID must be OPTIONAL (no longer mandatory after signatory field removal)
    await assertEmiratesIdBadge('Optional');

    // Trade License must be required
    const tradeLicSpan = page.getByText('Trade License', { exact: true }).first();
    await expect(tradeLicSpan).toBeVisible();
    const tradeLicBadge = await tradeLicSpan.locator('..').textContent();
    expect(tradeLicBadge).toContain('Required');

    // No brokerage-specific docs
    await expect(page.getByText('Brokerage License', { exact: true })).not.toBeVisible();
    await expect(page.getByText('Broker Registration Number Certificate')).not.toBeVisible();
  });

  // ─── Test 3: Brokerage Company ──────────────────────────────────────────────

  test('03 — Brokerage Company: no removed fields; Emirates ID optional; brokerage licence required', async () => {
    await goOnboarding();

    await page.getByText('Brokerage Company').first().click();
    await assertRemovedFields();
    await page.getByRole('button', { name: 'Continue' }).click();

    await fillDetails();

    await expect(page.getByRole('heading', { name: 'Business Details' })).toBeVisible({ timeout: 8_000 });
    await fillBusiness();

    // Shareholders (0)
    await expect(page.getByRole('heading', { name: 'Shareholders' })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /save.*continue/i }).click();

    // KYC Documents
    await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 8_000 });
    await assertRemovedFields();
    await assertEmiratesIdBadge('Optional');

    // Brokerage License must appear and be Required
    const brokLicSpan = page.getByText('Brokerage License', { exact: true }).first();
    await expect(brokLicSpan).toBeVisible();
    const brokLicBadge = await brokLicSpan.locator('..').textContent();
    expect(brokLicBadge).toContain('Required');

    // No Agents-only docs
    await expect(page.getByText('Broker Registration Number Certificate')).not.toBeVisible();
    await expect(page.getByText('Agency Agreement with Parent Brokerage')).not.toBeVisible();
  });

  // ─── Test 4: Agents Company ─────────────────────────────────────────────────

  test('04 — Agents Company: no removed fields; Emirates ID optional; BRN + agency agreement required', async () => {
    await goOnboarding();

    await page.getByText('Agents Company').first().click();
    await assertRemovedFields();
    await page.getByRole('button', { name: 'Continue' }).click();

    await fillDetails();

    // Business — agents also need "Parent brokerage" field
    await expect(page.getByRole('heading', { name: 'Business Details' })).toBeVisible({ timeout: 8_000 });
    await fillBusiness(true, 'Test Parent Brokerage Co');

    // Agents have NO Shareholders section — jump straight to KYC Documents
    await expect(page.getByRole('heading', { name: 'KYC Documents' })).toBeVisible({ timeout: 8_000 });
    await assertRemovedFields();
    await assertEmiratesIdBadge('Optional');

    // Broker Registration Number Certificate must be Required
    const brnSpan = page.getByText('Broker Registration Number Certificate').first();
    await expect(brnSpan).toBeVisible();
    const brnBadge = await brnSpan.locator('..').textContent();
    expect(brnBadge).toContain('Required');

    // Agency Agreement must be Required
    const agencySpan = page.getByText('Agency Agreement with Parent Brokerage').first();
    await expect(agencySpan).toBeVisible();
    const agencyBadge = await agencySpan.locator('..').textContent();
    expect(agencyBadge).toContain('Required');

    // No Brokerage License (that's for brokerage type, not agents)
    await expect(page.getByText('Brokerage License', { exact: true })).not.toBeVisible();
  });

});
