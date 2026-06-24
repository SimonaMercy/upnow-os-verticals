/**
 * Regression checks for two reported onboarding bugs:
 *
 * Case 2 — selecting a company account type silently reverted to
 *          "Individual Landlord" after the phone OTP was verified
 *          (verifyPhoneOtp → refresh() → load effect re-hydrated the form
 *          from the persisted default). Fixed with a one-time hydrate guard.
 *
 * This spec registers a fresh RP, picks "Landlord Company", verifies the
 * phone, and asserts the account type is STILL "Landlord Company" (and that
 * the company-only "Business Details" step is reachable).
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

let ctx: BrowserContext;
let page: Page;

const uniqueEmail = (p: string) => `${p}_${Date.now()}@test.upnow.ae`;
// Unique 9-digit UAE mobile per run so reruns never collide on a reused number.
const uniquePhone = () => '50' + String(Date.now()).slice(-7);

test.describe.serial('RP onboarding — account-type persistence after phone verify', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    ctx = await browser.newContext();
    page = await ctx.newPage();

    const email = uniqueEmail('rp_bugfix');
    await page.goto('/register/rental-provider');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/verify-email/, { timeout: 10_000 });
    const devOtp = new URL(page.url()).searchParams.get('devOtp');
    expect(devOtp, 'devOtp must be present (dev mode)').toBeTruthy();
    await page.locator('input[inputmode="numeric"]').first().click();
    await page.keyboard.type(devOtp!, { delay: 30 });
    await page.getByRole('button', { name: /verify email|create account|continue/i }).click();
    await expect(page).toHaveURL(/rental-provider|onboarding/, { timeout: 15_000 });
  });

  test.afterAll(async () => { await page.close(); await ctx.close(); });

  test('Landlord Company stays selected through phone verification', async () => {
    await page.goto('/rental-provider/dashboard/onboarding');
    await expect(page.getByRole('heading', { name: 'Account Type' })).toBeVisible({ timeout: 12_000 });

    // 1. Pick "Landlord Company" (a company type — NOT the default individual).
    await page.getByText('Landlord Company').first().click();

    // The selected card carries the active class — assert it's the company one.
    const landlordCard = page.locator('div').filter({ hasText: /^Landlord Company/ }).first();
    await expect(landlordCard).toBeVisible();

    // Move to Details.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByPlaceholder('Your full legal name')).toBeVisible({ timeout: 8_000 });
    await page.getByPlaceholder('Your full legal name').fill('Bugfix Co Owner');

    // 2. Verify phone via the UI OTP widget. This is the action that used to
    //    trigger refresh() → reset the account type back to Individual.
    //    Read the dev OTP straight off the network response (deterministic —
    //    avoids racing the on-screen banner render under dev-server load).
    await page.getByPlaceholder('50 123 4567').fill(uniquePhone());
    const [otpResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/auth/otp/request') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /send code/i }).click(),
    ]);
    const { devOtp: code } = (await otpResp.json()) as { devOtp?: string };
    expect(code, 'dev OTP code in /auth/otp/request response').toBeTruthy();
    await expect(page.getByPlaceholder('6-digit code')).toBeVisible({ timeout: 8_000 });
    await page.getByPlaceholder('6-digit code').fill(code!);
    await page.getByRole('button', { name: /^Verify$/ }).click();
    await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 8_000 });

    // 3. THE ASSERTION: account type must STILL be "Landlord Company".
    //    Go back to the Account Type step and confirm the company card is the
    //    active one, and that the company-only "Business" step exists in the
    //    stepper (it would be absent if we'd reverted to Individual).
    await page.getByRole('button', { name: /^Account Type$/ }).click();

    // The stepper must contain "Business" — a company-only section. If the type
    // had reverted to Individual, this step would not exist.
    await expect(page.getByText('Business', { exact: true })).toBeVisible({ timeout: 8_000 });

    // And the Landlord Company card must be the selected one. The active card
    // is the only one with an inner filled radio; assert via aria/text proximity
    // by re-reading the account grid: the selected card has class active.
    const activeCardText = await page.locator('[class*="acct"][class*="active"]').first().textContent();
    expect(activeCardText, `selected card was: ${activeCardText}`).toContain('Landlord Company');
  });
});

/**
 * Case 1 — an RP the admin marked ACTION_REQUIRED could not resubmit a
 * corrected account type; the backend threw "Cannot change entity type after
 * KYC review has started." The guard now only locks COMPLIANT / PAUSED.
 *
 * This test drives it through the live backend API (cookie carried by
 * page.request via the Next proxy) and flips compliance_status with psql to
 * stand in for the admin "mark action required" action.
 */
import { execFileSync } from 'child_process';

const DB = process.env.DB_NAME || 'upnow_prod_clone';

function setComplianceStatus(rpId: number, status: string) {
  execFileSync('psql', [
    '-d', DB,
    '-c', `UPDATE rental_providers SET compliance_status='${status}' WHERE id=${rpId};`,
  ], { stdio: 'pipe' });
}

/** True when psql + the local DB are reachable (skips this block in CI). */
function psqlAvailable(): boolean {
  try {
    execFileSync('psql', ['-d', DB, '-c', 'SELECT 1;'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

test.describe.serial('RP onboarding — action_required can resubmit a new account type', () => {
  let c2: BrowserContext;
  let p2: Page;
  let rpId: number;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.skip(!psqlAvailable(), 'psql/local DB not reachable — skipping (covered by backend unit test)');
    c2 = await browser.newContext();
    p2 = await c2.newPage();

    const email = uniqueEmail('rp_case1');
    await p2.goto('/register/rental-provider');
    await p2.getByLabel('Email address').fill(email);
    await p2.getByRole('button', { name: 'Create account' }).click();
    await expect(p2).toHaveURL(/\/verify-email/, { timeout: 10_000 });
    const devOtp = new URL(p2.url()).searchParams.get('devOtp');
    await p2.locator('input[inputmode="numeric"]').first().click();
    await p2.keyboard.type(devOtp!, { delay: 30 });
    await p2.getByRole('button', { name: /verify email|create account|continue/i }).click();
    await expect(p2).toHaveURL(/rental-provider|onboarding/, { timeout: 15_000 });

    // Verify phone via API (same cookie/session).
    await p2.request.patch('/api/auth/me', { data: { phone: uniquePhone() } });
    const otpReq = await p2.request.post('/api/auth/otp/request', { data: {} });
    const { devOtp: phoneOtp } = (await otpReq.json()) as { devOtp: string };
    await p2.request.post('/api/auth/otp/verify', { data: { code: phoneOtp } });

    const meRes = await p2.request.get('/api/profiles/rental-provider/me');
    const me = (await meRes.json()) as { profile: { id: number } };
    rpId = me.profile.id;
    expect(rpId).toBeGreaterThan(0);
  });

  test.afterAll(async () => { await p2.close(); await c2.close(); });

  test('first submit as Individual, then admin marks action_required, then resubmit as Landlord Company', async () => {
    // 1. First submission as Individual → sets accountTypeConfirmedAt.
    const sub1 = await p2.request.patch('/api/profiles/rental-provider/me', {
      data: { entityType: 'individual', nationality: 'Emirati' },
    });
    expect(sub1.ok(), `individual submit failed: ${sub1.status()} ${await sub1.text()}`).toBeTruthy();

    // 2. Admin marks the account "action required".
    setComplianceStatus(rpId, 'action_required');

    // 3. Resubmit with a DIFFERENT entity type — this used to 400.
    const resubmit = await p2.request.patch('/api/profiles/rental-provider/me', {
      data: {
        entityType: 'company',
        companyType: 'landlord',
        companyName: 'Resubmit Holdings LLC',
        tradeLicenseNumber: 'TL-55555',
        tradeLicenseAuthority: 'Dubai DED',
      },
    });
    const body = await resubmit.text();
    expect(
      resubmit.ok(),
      `resubmit as company should succeed but got ${resubmit.status()}: ${body}`,
    ).toBeTruthy();
    expect(body).not.toContain('Cannot change entity type');

    // 4. Confirm it persisted as a company WITH its company details (name
    //    included) and that the stale individual nationality was cleared —
    //    the two account types must stay cleanly separate.
    const after = await p2.request.get('/api/profiles/rental-provider/me');
    const { profile } = (await after.json()) as {
      profile: { entityType: string; companyType: string; companyName: string; nationality: string | null };
    };
    expect(profile.entityType).toBe('company');
    expect(profile.companyType).toBe('landlord');
    expect(profile.companyName).toBe('Resubmit Holdings LLC');
    expect(profile.nationality, 'individual nationality should be cleared on company switch').toBeNull();
  });

  test('once COMPLIANT, entity-type change is still locked', async () => {
    setComplianceStatus(rpId, 'compliant');
    const blocked = await p2.request.patch('/api/profiles/rental-provider/me', {
      data: { entityType: 'individual' },
    });
    expect(blocked.status(), 'compliant accounts must reject entity-type changes').toBe(400);
    expect(await blocked.text()).toContain('Cannot change entity type');
  });
});
