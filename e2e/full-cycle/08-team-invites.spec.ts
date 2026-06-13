import { test, expect, Page, BrowserContext } from '@playwright/test';
import {
  safeLoginViaUi,
  safeAdminLogin,
  q,
  inviteTokenFor,
  readState,
  writeState,
  uniqEmail,
  uniqPhone,
} from './helpers';

/**
 * 08 — Team invites: RP invites a manager → manager accepts → manager portal,
 * permission edits, admin oversight. All through the UI except the two
 * sanctioned escapes (DB token read = clicking the email link, and one
 * page.request fallback mirroring 07's BUG-16 workaround).
 *
 *   1. BUG-20 (expected fail): the TeamPanel invite modal always posts all 19
 *      snake_case permission flags in `metadata`, but the backend whitelist
 *      (ManagerMetaDto) only knows 12 — with forbidNonWhitelisted:true the
 *      POST /invitations is rejected 400, so NO manager can ever be invited
 *      through the UI.
 *   2. Fallback (green): same endpoint with ONLY whitelisted flags → 201.
 *      Writes state.managerEmail.
 *   3. Accept page (green): logged-out manager opens /invite/<token>, signs up,
 *      proxy stores the JWT cookie, account + per-landlord permission row land
 *      in the DB. Writes state.managerUserId.
 *   4. BUG-21 (expected fail): the accept success screen redirects to
 *      /dashboard — a route that does not exist → the freshly joined manager's
 *      first screen is a 404.
 *   5. Manager portal (green): scope bar, landlord card, nav items gated by the
 *      granted flags, RP's property visible on /dashboard/manager/properties.
 *   6. BUG-22 (expected fail): individual landlords (companyName NULL) are
 *      shown as "Landlord #<id>" everywhere in the manager portal — the
 *      manager cannot tell who they work for.
 *   7. Permission revoke (green): RP toggles "Schedule & manage viewings" OFF
 *      in the TeamPanel slide-over → persists in DB + on reload, and the
 *      manager's "Leads" nav item disappears.
 *   8. Admin oversight (green): /dashboard/admin/team lists the manager under
 *      the inviting RP with the exact granted permission chips.
 */

const S = readState();
const RP_EMAIL: string = S.rpEmail;
const RP_PROFILE_ID: number = S.rpProfileId;
const RP_FULL_NAME: string = S.rpFullName;
const PROPERTY_NAME: string = S.propertyName; // current name (07 renames it)

const MGR_FIRST = 'Mira';
const MGR_LAST = 'Manager';
const MGR_NAME = `${MGR_FIRST} ${MGR_LAST}`;
const MGR_PASSWORD = 'ManagerPass123!';

// The 4 permissions we grant (all inside the backend's 12-flag whitelist).
// Granted → nav shows: Leads (canManageViewings), Properties + Units
// (canListProperties). NOT granted → hidden: Customers/Contract
// (canManageAgreements), Security Deposits (canManageDeposits), Reports
// (canViewReports), AMC & Vendors (canManageMaintenance).
const GRANTED_META = {
  can_list_properties: true,
  can_edit_properties: true,
  can_manage_viewings: true,
  can_manage_documents: true,
};

// ─── RP settings → Team tab helpers ──────────────────────────────────────────

async function openTeamTab(page: Page) {
  await page.goto('/rental-provider/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'Team', exact: true }).click();
  await expect(
    page.getByText('Manage the asset managers working under your account.'),
  ).toBeVisible({ timeout: 30_000 });
}

/** Permission toggle (role=switch inside a <label> that carries the text). */
function permSwitch(scope: ReturnType<Page['locator']>, label: string) {
  return scope.locator('label').filter({ hasText: label }).getByRole('switch');
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('08 team invites: RP → manager → admin oversight', () => {
  let rpContext: BrowserContext;
  let rpPage: Page;
  let mgrContext: BrowserContext;
  let mgrPage: Page;

  const managerEmail = uniqEmail('mgr');
  let managerUserId = 0;
  // What the manager portal + admin oversight render for this landlord:
  // companyName when present, otherwise the "Landlord #<id>" fallback (BUG-22).
  let expectedRpName = '';

  test.beforeAll(async ({ browser }) => {
    expect(RP_EMAIL, 'state.rpEmail from spec 02/03').toBeTruthy();
    expect(RP_PROFILE_ID, 'state.rpProfileId from spec 02/03').toBeGreaterThan(0);
    expect(PROPERTY_NAME, 'state.propertyName from spec 04/07').toBeTruthy();

    expectedRpName = q(
      `SELECT COALESCE(company_name, 'Landlord #' || id::text) FROM rental_providers WHERE id=${RP_PROFILE_ID}`,
    );

    rpContext = await browser.newContext();
    rpPage = await rpContext.newPage();
    await safeLoginViaUi(rpPage, RP_EMAIL, /\/rental-provider\/dashboard/);

    // Fresh logged-out context for the invitee (the RP session must survive
    // for the permission-revoke test later).
    mgrContext = await browser.newContext();
    mgrPage = await mgrContext.newPage();
  });

  test.afterAll(async () => {
    await rpContext?.close();
    await mgrContext?.close();
  });

  // ── 1. Manager invite through the Team modal (BUG-20 FIXED: DTO accepts all 19 flags) ──

  test('RP sends a manager invite through the Team modal', async () => {
    await openTeamTab(rpPage);
    await rpPage.getByRole('button', { name: 'Invite Manager' }).click();
    const dlg = rpPage.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Invite Manager' })).toBeVisible();

    await dlg.locator('#rp-inv-firstName').fill(MGR_FIRST);
    await dlg.locator('#rp-inv-lastName').fill(MGR_LAST);
    await dlg.locator('#rp-inv-email').fill(managerEmail);

    // Grant the 4 permissions (each toggle is role=switch labelled by its text)
    for (const label of [
      'View properties',
      'Edit property details',
      'Schedule & manage viewings',
      'Upload & manage documents',
    ]) {
      const sw = permSwitch(dlg, label);
      await sw.click();
      await expect(sw).toHaveAttribute('aria-checked', 'true');
    }

    const posted = rpPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/invitations' &&
        r.request().method() === 'POST' &&
        r.ok(),
      { timeout: 15_000 },
    );
    await dlg.getByRole('button', { name: 'Send Invite' }).click();
    await posted;

    await expect(rpPage.getByRole('dialog')).toHaveCount(0);
    await expect(rpPage.getByText(managerEmail).first()).toBeVisible({ timeout: 15_000 });
    expect(
      q(`SELECT status FROM invitations WHERE email='${managerEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe('pending');
  });

  // ── 2. Pending invite has the right metadata (API path kept as a regression
  //       for partial-flag payloads — only used when test 1 didn't create one) ──

  test('pending manager invite carries the granted permission metadata', async () => {
    const existing = q(
      `SELECT id FROM invitations WHERE email='${managerEmail}' AND status='pending' ORDER BY id DESC LIMIT 1`,
    );
    if (!existing) {
      // Standalone run: create the invite via the same endpoint the modal calls,
      // with a partial (subset) metadata payload — must also be accepted.
      const res = await rpPage.request.post('/api/invitations', {
        data: {
          email: managerEmail,
          firstName: MGR_FIRST,
          lastName: MGR_LAST,
          role: 'manager',
          metadata: GRANTED_META,
        },
      });
      expect(res.status(), await res.text()).toBe(201);
    }

    // DB: pending invite with our metadata
    expect(
      q(
        `SELECT status || '|' || (metadata->>'can_list_properties') || '|' || (metadata->>'can_manage_viewings')
         FROM invitations WHERE email='${managerEmail}' AND status='pending' ORDER BY id DESC LIMIT 1`,
      ),
    ).toBe('pending|true|true');

    // UI: the pending invite shows on the Team tab (.first() — on a re-run the
    // already-accepted manager ALSO shows the same email under Active Managers)
    await openTeamTab(rpPage);
    await expect(rpPage.getByText(managerEmail).first()).toBeVisible({ timeout: 30_000 });

    writeState({ managerEmail });
  });

  // ── 3. Accept the invite (logged-out, fresh context) ────────────────────────

  test('manager accepts the invite: account created, permissions stored, session cookie set', async () => {
    // DB token read = clicking the link in the invite email (email is disabled)
    const token = inviteTokenFor(managerEmail);
    await mgrPage.goto(`/invite/${token}`);
    await expect(mgrPage.getByRole('heading', { name: "You're invited!" })).toBeVisible({
      timeout: 60_000,
    });
    // Permission summary reflects the invite metadata
    await expect(mgrPage.getByText('Your permissions')).toBeVisible();
    await expect(mgrPage.getByText('List properties', { exact: true })).toBeVisible();
    await expect(mgrPage.getByText('Manage viewings', { exact: true })).toBeVisible();

    await mgrPage.locator('#acc-firstName').fill(MGR_FIRST);
    await mgrPage.locator('#acc-lastName').fill(MGR_LAST);
    await mgrPage.locator('#acc-phone').fill(uniqPhone());
    await mgrPage.locator('#acc-password').fill(MGR_PASSWORD);
    await mgrPage.locator('#acc-confirmPassword').fill(MGR_PASSWORD);

    const accepted = mgrPage.waitForResponse(
      (r) => r.url().includes(`/invitations/${token}/accept`) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await mgrPage.getByRole('button', { name: 'Accept Invite & Join' }).click();
    const resp = await accepted;
    expect(resp.status(), await resp.text()).toBe(201);

    await expect(mgrPage.getByText('Welcome to UpNow!')).toBeVisible({ timeout: 15_000 });
    // The success screen pushes to the ROLE home after 1.5s (BUG-21 fixed)
    await mgrPage.waitForURL(/\/dashboard\/manager/, { timeout: 15_000 });

    // Proxy stored the JWT as an httpOnly cookie → the session works
    const me = await mgrPage.request.get('/api/auth/me');
    expect(me.ok(), `GET /api/auth/me → ${me.status()}`).toBe(true);
    expect(JSON.stringify(await me.json())).toContain('"manager"');

    // DB: user + invite + per-landlord permission row
    managerUserId = Number(q(`SELECT id FROM users WHERE email='${managerEmail}'`));
    expect(managerUserId).toBeGreaterThan(0);
    expect(q(`SELECT role FROM users WHERE id=${managerUserId}`)).toBe('manager');
    expect(
      q(`SELECT status FROM invitations WHERE token='${token}'`),
      'invite consumed',
    ).toBe('accepted');
    expect(
      q(
        `SELECT concat_ws('|', can_list_properties::text, can_edit_properties::text,
                can_manage_viewings::text, can_manage_documents::text,
                can_manage_agreements::text, can_manage_deposits::text, can_view_reports::text)
         FROM manager_permissions
         WHERE manager_user_id=${managerUserId} AND rental_provider_id=${RP_PROFILE_ID}`,
      ),
      'granted flags true, ungranted false',
    ).toBe('true|true|true|true|false|false|false');

    writeState({ managerUserId });
  });

  // ── 4. BUG-21: the post-accept landing page is a 404 ────────────────────────

  test('post-accept redirect lands on a real dashboard (BUG-21: /dashboard route does not exist)', async () => {
    // Reproduce exactly what the accept flow's redirect renders:
    await mgrPage.goto('/dashboard');
    // FAILS: the default Next 404 page renders.
    await expect(
      mgrPage.getByText(/this page could not be found/i),
      'the post-accept landing route must not 404',
    ).toHaveCount(0);
    // Unreached: a role-aware redirect would show the manager overview.
    await expect(mgrPage.getByRole('heading', { name: /Welcome back/ })).toBeVisible({
      timeout: 30_000,
    });
  });

  // ── 5. Manager portal: scoping + permission-gated nav + RP data ─────────────

  test('manager portal is scoped to the inviting landlord and the nav follows granted permissions', async () => {
    // Negative nav assertions are only meaningful once /manager/my-rps resolved
    const permsLoaded = mgrPage.waitForResponse(
      (r) => r.url().includes('/manager/my-rps') && r.ok(),
      { timeout: 60_000 },
    );
    await mgrPage.goto('/dashboard/manager');
    await permsLoaded;

    await expect(mgrPage.getByRole('heading', { name: `Welcome back, ${MGR_NAME}` })).toBeVisible({
      timeout: 60_000,
    });
    await expect(mgrPage.getByText('Managing properties for 1 landlord')).toBeVisible({
      timeout: 30_000,
    });
    // Scope bar (manager layout chrome; the LandlordSwitcher dropdown itself
    // only renders for managers with 2+ landlords)
    await expect(mgrPage.getByText('Acting for')).toBeVisible();

    // "Your Landlords" card identifies the inviting RP with its granted perms
    const llCard = mgrPage.locator('div.rounded-2xl').filter({ hasText: expectedRpName }).first();
    await expect(llCard).toBeVisible({ timeout: 30_000 });
    await expect(llCard.getByText('List Properties', { exact: true })).toBeVisible();
    await expect(llCard.getByText('Manage Viewings', { exact: true })).toBeVisible();

    // Nav gating: granted flags → visible; withheld flags → hidden
    await expect(mgrPage.getByRole('link', { name: 'Properties', exact: true })).toBeVisible();
    await expect(mgrPage.getByRole('link', { name: 'Leads', exact: true })).toBeVisible();
    await expect(mgrPage.getByRole('link', { name: 'Units', exact: true })).toBeVisible();
    await expect(mgrPage.getByRole('link', { name: 'Security Deposits', exact: true })).toHaveCount(0);
    await expect(mgrPage.getByRole('link', { name: 'Customers', exact: true })).toHaveCount(0);
    await expect(mgrPage.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);

    // The RP's property is visible on the manager Properties page
    await mgrPage.goto('/dashboard/manager/properties');
    await expect(mgrPage.getByRole('heading', { name: 'Managed properties' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      mgrPage.locator('[class*="propName"]').filter({ hasText: PROPERTY_NAME }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  // ── 6. BUG-22: individual landlords are nameless in the manager portal ──────

  test('manager portal names the individual landlord (BUG-22: shows "Landlord #id" when companyName is NULL)', async () => {
    const companyName = q(
      `SELECT COALESCE(company_name,'') FROM rental_providers WHERE id=${RP_PROFILE_ID}`,
    );
    test.skip(companyName !== '', 'RP has a company name — the nameless fallback does not reproduce');
    expect(RP_FULL_NAME, 'state.rpFullName from spec 02').toBeTruthy();
    await mgrPage.goto('/dashboard/manager');
    await expect(mgrPage.getByRole('heading', { name: `Welcome back, ${MGR_NAME}` })).toBeVisible({
      timeout: 60_000,
    });
    // FAILS: the card says "Landlord #<rpProfileId>", not the landlord's name.
    await expect(
      mgrPage.getByText(RP_FULL_NAME).first(),
      'landlord card identifies the individual RP by name',
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── 7. RP revokes a permission; manager nav follows ─────────────────────────

  test('RP toggles "Schedule & manage viewings" off: persists in DB + on reload, manager loses the Leads nav', async () => {
    await openTeamTab(rpPage);
    // Active manager row opens the permissions slide-over
    await rpPage.getByRole('button').filter({ hasText: managerEmail }).first().click();
    const panel = rpPage.locator('div.fixed.inset-0').filter({ hasText: 'Edit permissions' });
    await expect(panel.getByText(MGR_NAME)).toBeVisible({ timeout: 30_000 });

    const viewingsSwitch = permSwitch(panel, 'Schedule & manage viewings');
    await expect(viewingsSwitch).toHaveAttribute('aria-checked', 'true'); // granted at invite

    const patched = rpPage.waitForResponse(
      (r) =>
        r.url().includes(`/managers/${managerUserId}/permissions`) &&
        r.request().method() === 'PATCH',
      { timeout: 20_000 },
    );
    await viewingsSwitch.click();
    const resp = await patched;
    expect(resp.ok(), `PATCH /managers/${managerUserId}/permissions → ${resp.status()}: ${await resp.text()}`).toBe(true);

    // DB round-trip — only the toggled flag changed
    expect(
      q(
        `SELECT concat_ws('|', can_manage_viewings::text, can_list_properties::text, can_manage_documents::text)
         FROM manager_permissions
         WHERE manager_user_id=${managerUserId} AND rental_provider_id=${RP_PROFILE_ID}`,
      ),
    ).toBe('false|true|true');

    // UI round-trip: fresh load → reopen the panel → the toggle stayed off
    await openTeamTab(rpPage);
    await rpPage.getByRole('button').filter({ hasText: managerEmail }).first().click();
    const panel2 = rpPage.locator('div.fixed.inset-0').filter({ hasText: 'Edit permissions' });
    await expect(permSwitch(panel2, 'Schedule & manage viewings')).toHaveAttribute(
      'aria-checked',
      'false',
      { timeout: 30_000 },
    );
    await expect(permSwitch(panel2, 'View properties')).toHaveAttribute('aria-checked', 'true');

    // Manager side: a full reload re-fetches /manager/my-rps → Leads disappears
    const permsLoaded = mgrPage.waitForResponse(
      (r) => r.url().includes('/manager/my-rps') && r.ok(),
      { timeout: 60_000 },
    );
    await mgrPage.goto('/dashboard/manager');
    await permsLoaded;
    await expect(mgrPage.getByRole('link', { name: 'Properties', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(mgrPage.getByRole('link', { name: 'Leads', exact: true })).toHaveCount(0);
  });

  // ── 8. Admin oversight ───────────────────────────────────────────────────────

  test('admin team oversight shows the manager under the inviting RP with exact granted permissions', async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    try {
      await safeAdminLogin(adminPage);
      await adminPage.goto('/dashboard/admin/team');
      await expect(adminPage.getByRole('heading', { name: 'Team', exact: true })).toBeVisible({
        timeout: 60_000,
      });

      // Managers tab is the default; our manager's card carries name + email
      const card = adminPage.locator('div.rounded-2xl').filter({ hasText: managerEmail }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText(MGR_NAME)).toBeVisible();
      await expect(card.getByText('1 landlord', { exact: true })).toBeVisible();
      await expect(card.getByText('active')).toBeVisible();

      // Expand → the landlord block with the exact permission chips
      await card.locator('div.cursor-pointer').first().click();
      await expect(card.getByText(expectedRpName)).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText('3 permissions')).toBeVisible(); // after the revoke in test 7
      await expect(card.getByText('List Properties', { exact: true })).toBeVisible();
      await expect(card.getByText('Edit Properties', { exact: true })).toBeVisible();
      await expect(card.getByText('Manage Documents', { exact: true })).toBeVisible();
      // Revoked in test 7 — must NOT appear as a granted chip
      await expect(card.getByText('Manage Viewings', { exact: true })).toHaveCount(0);
    } finally {
      await adminContext.close();
    }
  });
});
