import { test, expect, Page } from '@playwright/test';
import {
  adminLogin,
  expectUploadServed,
  loginViaUi,
  logout,
  q,
  readState,
  uniqEmail,
  writeState,
} from './helpers';

/**
 * 03 — Admin reviews and approves everything that specs 01/02 left pending.
 *
 *  - individual RP (state rpProfileId): KYC queue → full detail page →
 *    Emirates ID doc is verified (RP uploads are SELF-VERIFIED at upload since
 *    commit bf85d39 — status 'processed', so no Verify button is expected) →
 *    compliance set to compliant via the Compliance Decision panel.
 *  - company RP (state rpCompanyProfileId): same detail page; trade license +
 *    both shareholder EIDs are on file (self-verified) → compliant.
 *    NOTE: because of BUG-02 the company profile was never submitted
 *    (entity_type still 'individual', account_type_confirmed_at NULL) — the
 *    compliance approval still works and is recorded.
 *  - Customers tab: customer docs from spec 01 are listed (status 'attached')
 *    but there is NO UI to verify/approve them → BUG-03 (xfail test).
 *  - Gate lift: the approved individual RP now reaches the RP dashboard.
 *  - Super admin creates a delegated admin who can OTP-login to /dashboard/admin.
 *
 * Page sources read for selectors:
 *   src/app/dashboard/(dashboard)/admin/kyc/page.tsx
 *   src/app/dashboard/(dashboard)/admin/kyc/rental-provider/[id]/page.tsx
 *   src/app/dashboard/(dashboard)/admin/accounts/new/page.tsx
 *   src/components/dashboard/RpOnboardingGate.tsx
 */

// Delegated-admin email must be unique per invocation (re-runs would hit the
// backend's "Email already registered" conflict with a per-cycle uniqEmail).
const RUN_TAG = Date.now().toString(36).slice(-5);

/** Card section on the RP detail page, located by its heading text. */
function detailSection(page: Page, heading: string) {
  return page.locator('div.rounded-xl.p-5').filter({ hasText: heading });
}

/**
 * Drive the "Compliance Decision" panel on
 * /dashboard/admin/kyc/rental-provider/[id]: pick a status, write a note,
 * Save Decision, and wait for the PATCH + refetch.
 */
async function saveComplianceDecision(page: Page, rpId: number, note: string) {
  // the status <select> is the only visible select while profile-edit is closed
  await page.locator('select').selectOption('compliant');
  await page.locator('textarea').fill(note);
  const patched = page.waitForResponse(
    (r) =>
      r.url().includes(`/admin/kyc/rental-providers/${rpId}/compliance`) &&
      r.request().method() === 'PATCH' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Save Decision' }).click();
  await patched;
  // load() refetches and the header badge re-renders with the new status
  await expect(page.getByText('compliant', { exact: true })).toBeVisible({ timeout: 30_000 });
}

test.describe.serial('03 admin approvals', () => {
  test('individual RP: KYC queue → full page → EID already verified (self-verified upload) → mark compliant', async ({
    page,
  }) => {
    const s = readState();
    await adminLogin(page);

    // ── KYC queue, Rental Providers tab (default) — newest first ──
    await page.goto('/dashboard/admin/kyc');
    const rpCard = page.locator('button').filter({ hasText: s.rpEmail }).first();
    await expect(rpCard, 'individual RP card in the queue').toBeVisible({ timeout: 60_000 });

    const detailLoaded = page.waitForResponse(
      (r) =>
        r.url().includes(`/admin/kyc/rental-providers/${s.rpProfileId}`) &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await rpCard.click();
    await detailLoaded;

    // ── open the full detail page via the panel link ──
    await page.getByRole('link', { name: /full page/i }).click();
    await page.waitForURL(new RegExp(`/dashboard/admin/kyc/rental-provider/${s.rpProfileId}$`), {
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: s.rpFullName })).toBeVisible({ timeout: 60_000 });

    // ── Emirates ID document: RP uploads are self-verified at upload
    //    (commit bf85d39) so the checklist row must already be 'processed';
    //    the Verify button only renders for un-verified ('attached') docs.
    //    If one ever shows here, click it — final state must be verified. ──
    const checklist = detailSection(page, 'KYC Document Checklist');
    const eidRow = checklist.locator('div.rounded-lg').filter({ hasText: 'Emirates ID' }).first();
    await expect(eidRow).toBeVisible();
    const verifyBtn = eidRow.getByRole('button', { name: 'Verify' });
    if (await verifyBtn.isVisible().catch(() => false)) {
      const verified = page.waitForResponse(
        (r) => r.url().includes('/verify') && r.request().method() === 'POST' && r.ok(),
        { timeout: 30_000 },
      );
      await verifyBtn.click();
      await verified;
    }
    await expect(eidRow).toContainText(/processed|complete/i);
    expect(
      q(`SELECT status FROM documents WHERE owner_type='rental_provider'
           AND owner_id=${s.rpProfileId} AND document_key='emirates_id'
         ORDER BY id DESC LIMIT 1`),
      'EID document verified',
    ).toBe('processed');

    // ── Compliance Decision → compliant ──
    await saveComplianceDecision(page, s.rpProfileId, 'Approved by e2e admin — EID verified.');

    expect(q(`SELECT compliance_status FROM rental_providers WHERE id=${s.rpProfileId}`)).toBe(
      'compliant',
    );
    // the decision is audit-logged with the acting admin
    expect(
      Number(
        q(`SELECT count(*) FROM audit_logs
             WHERE action_key='rental_provider.compliance_update'
               AND entity_type='rental_provider' AND entity_id=${s.rpProfileId}`),
      ),
    ).toBeGreaterThan(0);

    writeState({ rpApproved: true });
  });

  test('company RP: detail page lists trade license + both shareholder EIDs (self-verified) → mark compliant', async ({
    page,
  }) => {
    const s = readState();
    await adminLogin(page);

    await page.goto(`/dashboard/admin/kyc/rental-provider/${s.rpCompanyProfileId}`);
    await expect(page.getByText(s.rpCompanyEmail).first()).toBeVisible({ timeout: 60_000 });

    // ── all 3 uploads are on file (Document Expiry Management lists every
    //    uploaded doc; the checklist can't show them because of BUG-02 — the
    //    profile is still entity_type='individual', so trade_license/sh_* keys
    //    are not in the individual checklist) ──
    const expiry = detailSection(page, 'Document Expiry Management');
    await expect(expiry.getByText('trade license', { exact: true })).toBeVisible();
    await expect(expiry.getByText(/^sh \d+ \w+ emirates id$/)).toHaveCount(2);

    // self-verified at upload — verified state in DB for all three
    expect(
      q(`SELECT count(*) FROM documents WHERE owner_type='rental_provider'
           AND owner_id=${s.rpCompanyProfileId} AND status='processed'`),
    ).toBe('3');

    // the trade license file actually serves through the :3010 proxy
    const tlUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='rental_provider'
         AND owner_id=${s.rpCompanyProfileId} AND document_key='trade_license'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(tlUrl, 'trade license document row').toBeTruthy();
    await expectUploadServed(page, new URL(tlUrl).pathname);

    // ── Compliance Decision → compliant ──
    await saveComplianceDecision(
      page,
      s.rpCompanyProfileId,
      'Approved by e2e admin — trade license + shareholder EIDs verified.',
    );

    expect(
      q(`SELECT compliance_status FROM rental_providers WHERE id=${s.rpCompanyProfileId}`),
    ).toBe('compliant');

    writeState({ rpCompanyApproved: true });
  });

  test('customers tab: spec-01 customer shows 4 uploaded KYC docs, pending (attached), files served', async ({
    page,
  }) => {
    const s = readState();
    const custEmail = `phone_971${s.customerPhone}@upnow.internal`;
    await adminLogin(page);

    await page.goto('/dashboard/admin/kyc?tab=tenants');
    const card = page.locator('button').filter({ hasText: custEmail }).first();
    await expect(card, 'customer card in the Customers tab').toBeVisible({ timeout: 60_000 });

    const detailLoaded = page.waitForResponse(
      (r) =>
        r.url().includes(`/admin/kyc/tenants/${s.customerTenantId}`) &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await card.click();
    await detailLoaded;

    await expect(page.getByText('Documents (4)')).toBeVisible({ timeout: 30_000 });
    for (const key of ['emirates id front', 'emirates id back', 'passport', 'uae visa']) {
      const row = page.locator('div.rounded-lg').filter({ hasText: key }).first();
      await expect(row, `${key} row`).toBeVisible();
      await expect(row.getByText('attached', { exact: true }), `${key} still pending review`).toBeVisible();
    }

    // a doc file round-trips through the :3010 proxy
    const frontRow = page.locator('div.rounded-lg').filter({ hasText: 'emirates id front' }).first();
    const href = await frontRow.locator('a').getAttribute('href');
    expect(href, 'View link href').toBeTruthy();
    await expectUploadServed(page, new URL(href!).pathname);
  });

  test('customers tab: admin can verify/approve a customer KYC document', async ({ page }) => {
    test.fail(
      true,
      'BUG-03: there is NO admin UI to verify customer KYC documents — the Customers tab detail panel is read-only (status badge + View link only), no Verify/Approve control exists anywhere for customer docs, so customer docs stay "attached" and users.kyc_status stays "pending_review" forever. See e2e/full-cycle/BUGS.md.',
    );
    const s = readState();
    const custEmail = `phone_971${s.customerPhone}@upnow.internal`;
    await adminLogin(page);

    await page.goto('/dashboard/admin/kyc?tab=tenants');
    const card = page.locator('button').filter({ hasText: custEmail }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.click();
    await expect(page.getByText('Documents (4)')).toBeVisible({ timeout: 30_000 });

    // an admin reviewing a pending ('attached') customer document needs a
    // verify control — this is what the flow requires and what's missing
    const verifyControl = page.getByRole('button', { name: /verify|approve/i }).first();
    await expect(verifyControl, 'a Verify/Approve control for customer KYC docs').toBeVisible({
      timeout: 8_000,
    });

    // (unreachable until BUG-03 is fixed) — verifying must flip the doc status
    await verifyControl.click();
    await expect(
      page.locator('div.rounded-lg').filter({ hasText: 'emirates id front' }).first(),
    ).toContainText(/processed|complete|verified/i, { timeout: 15_000 });
    expect(
      q(`SELECT count(*) FROM documents WHERE owner_type='customer'
           AND owner_id=${s.customerTenantId} AND status='processed'`),
    ).not.toBe('0');
  });

  test('gate lift: approved individual RP reaches the dashboard (no onboarding bounce)', async ({
    page,
  }) => {
    const s = readState();
    await loginViaUi(page, s.rpEmail);

    await page.goto('/rental-provider/dashboard');
    // RpOnboardingGate fetches the profile and only renders children when
    // accountTypeConfirmedAt is set AND complianceStatus === 'compliant'
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible({ timeout: 90_000 });
    expect(page.url()).not.toContain('/onboarding');
  });

  test('super admin creates a delegated admin; the delegated admin OTP-logs-in to /dashboard/admin', async ({
    page,
  }) => {
    const admin2Email = uniqEmail(`admin2${RUN_TAG}`);
    await adminLogin(page);

    await page.goto('/dashboard/admin/accounts/new');
    await expect(page.getByRole('heading', { name: 'Create Admin Account' })).toBeVisible({
      timeout: 60_000,
    });
    await page.locator('#email').fill(admin2Email);
    await page.locator('#name').fill('Dana Cycleadmin');
    await page.locator('#firstName').fill('Dana');
    await page.locator('#lastName').fill('Cycleadmin');

    const created = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith('/api/admin/accounts') &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /create admin account/i }).click();
    await created;
    await expect(page.getByText('Admin account created. Redirecting…')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForURL(/\/dashboard\/admin\/accounts$/, { timeout: 30_000 });
    await expect(page.getByText(admin2Email)).toBeVisible({ timeout: 30_000 });

    // DB truths: delegated admin role, active, attributed to the super admin
    expect(q(`SELECT role FROM users WHERE email='${admin2Email}'`)).toBe('admin');
    expect(q(`SELECT status FROM users WHERE email='${admin2Email}'`)).toBe('active');
    expect(
      q(`SELECT u2.email FROM users u JOIN users u2 ON u2.id=u.created_by_user_id
         WHERE u.email='${admin2Email}'`),
    ).toBe('admin@upnow.ae');

    // ── the delegated admin can log in via OTP and reaches the admin dashboard ──
    await logout(page);
    await loginViaUi(page, admin2Email, /\/dashboard\/admin/);
    // delegated admins see 'Admin Dashboard' (super admin sees 'Super Admin Dashboard')
    await expect(page.getByRole('heading', { name: 'Admin Dashboard', exact: true })).toBeVisible({
      timeout: 60_000,
    });

    writeState({ admin2Email });
  });
});
