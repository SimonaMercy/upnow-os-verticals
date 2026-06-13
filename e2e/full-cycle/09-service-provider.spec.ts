import { test, expect, Page, Locator } from '@playwright/test';
import {
  captureDevOtp,
  expectUploadServed,
  fillOtp,
  inviteTokenFor,
  logout,
  pdfFile,
  pngFile,
  q,
  readState,
  registerProviderViaUi,
  safeAdminLogin,
  safeLoginViaUi,
  uniqEmail,
  uniqPhone,
  writeState,
} from './helpers';

/**
 * 09 — Service Provider: registration + 6-step onboarding wizard + admin
 *      verification (Service tab) + technician invite/accept, all through the UI.
 *
 * Wizard (src/app/dashboard/(dashboard)/service-provider/onboarding/page.tsx):
 *   0 Phone (inline OTP)  → 1 Business basics (entityType PATCH sets
 *   accountTypeConfirmedAt, service-provider.service.ts:42-45) → 2 Service
 *   categories → 3 Service area (emirates) → 4 Owner details (EID number /
 *   nationality combobox / react-day-picker DOB) → 5 Documents
 *   (KycDocumentsPanel; individual SP requires emirates_id + bank_statement,
 *   document-requirements.ts SP_INDIVIDUAL).
 *
 * Flow facts derived from source (relied on below):
 *  - Registration auto-creates the service_providers row as entity_type
 *    'individual' with account_type_confirmed_at NULL (auth.service.ts:191).
 *  - SP uploads are NOT self-verified: documents.service.ts:403 reviewerRoles
 *    = [rental_provider, manager, admin, super_admin] — service_provider is
 *    excluded, so SP docs land status='attached' (pending review).
 *  - users.kyc_status flips unverified → pending_review on the first doc
 *    upload (documents.controller.ts:177), which is what drives the
 *    "Under review / Verification in progress" banner on
 *    /dashboard/service-provider (page.tsx KycStatusBanner). The AuthContext
 *    user is stale right after the wizard (last refresh() was at phone
 *    verify), so the banner needs one full page load to appear.
 *  - The wizard init effect (onboarding/page.tsx:1229-1261) never marks step 5
 *    as completed, so revisiting after submit resumes at the Documents step
 *    with everything persisted — never an empty wizard.
 *
 * Admin KYC sources: src/app/dashboard/(dashboard)/admin/kyc/page.tsx —
 * Service tab SpContentPanel is summary-only ("Full KYC review — coming
 * soon"), there is NO verify/compliance control for SPs → BUG-23 (xfail).
 *
 * Team: src/app/dashboard/(dashboard)/service-provider/team/page.tsx (invite
 * modal #inv-* inputs), src/app/invite/[token]/page.tsx (accept form #acc-*).
 * Accept creates user role=technician + technicians row linked to the SP
 * (invitations.service.ts:205-214) and logs the invitee in via the proxy
 * cookie; the post-accept router.push('/dashboard') has no page → BUG-21.
 */

// Registration emails must be unique per *invocation* (uniqEmail alone is only
// unique per cycle; reruns of this spec register fresh users).
const RUN_TAG = Date.now().toString(36).slice(-5);

const SP_ONBOARDING_URL = /\/dashboard\/service-provider\/onboarding/;

const SP_BUSINESS_NAME = `Cycle Fix Services ${RUN_TAG}`;
const SP_OWNER_NAME = 'Saif Cyclefixer';
const SP_EID_NUMBER = '784-1992-7654321-3';

// ---------- private utilities (this spec only) -------------------------------

/** Wait for the wizard chrome (renders once AuthContext user resolved). */
async function waitForWizard(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Complete your provider profile' }),
  ).toBeVisible({ timeout: 90_000 });
}

/** The current step's h2 (each STEPS[n].subtitle is unique). */
function stepHeading(page: Page, subtitle: string) {
  return page.getByRole('heading', { name: subtitle });
}

/**
 * Click the step's "Save & continue" and wait for the wizard's
 * PATCH /profiles/service-provider/me to succeed (every step 1-4 persists
 * server-side before advancing).
 */
async function saveStep(page: Page) {
  const patched = page.waitForResponse(
    (r) =>
      r.url().includes('/profiles/service-provider/me') &&
      r.request().method() === 'PATCH' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: /save & continue/i }).click();
  await patched;
}

/** A KycDocumentsPanel checklist row (Tailwind rounded-2xl border-2 card). */
function docRow(page: Page, displayName: string): Locator {
  return page.locator('div.rounded-2xl.border-2').filter({ hasText: displayName }).first();
}

/**
 * Click an Upload trigger, feed the native file chooser a REAL file, and wait
 * for the metadata POST /api/documents to succeed (upload-url + PUT happen in
 * between — all against the local-disk store).
 */
async function uploadDoc(
  page: Page,
  trigger: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const chooser = page.waitForEvent('filechooser', { timeout: 20_000 });
  const posted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/api/documents') &&
      r.request().method() === 'POST' &&
      r.ok(),
    { timeout: 60_000 },
  );
  await trigger.click();
  await (await chooser).setFiles(file);
  await posted;
}

/** Drive the team-page "Invite Technician" modal end-to-end. */
async function sendTechInvite(
  page: Page,
  email: string,
  firstName: string,
  lastName: string,
) {
  await page.goto('/dashboard/service-provider/team');
  await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Invite Technician' }).click();
  await expect(page.getByRole('heading', { name: 'Invite Technician' })).toBeVisible();
  await page.locator('#inv-firstName').fill(firstName);
  await page.locator('#inv-lastName').fill(lastName);
  await page.locator('#inv-email').fill(email);
  const posted = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith('/api/invitations') &&
      r.request().method() === 'POST' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: 'Send Invite' }).click();
  await posted;
}

/** Fill + submit the public /invite/[token] accept form. Returns at the success screen. */
async function acceptInvite(
  page: Page,
  token: string,
  firstName: string,
  lastName: string,
) {
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: /you.re invited/i })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('strong', { hasText: 'Technician' })).toBeVisible();
  // RHF useForm defaultValues are '' — the invite-prefilled DOM defaultValue is
  // NOT picked up on submit, so every field must be typed explicitly.
  await page.locator('#acc-firstName').fill(firstName);
  await page.locator('#acc-lastName').fill(lastName);
  await page.locator('#acc-phone').fill(uniqPhone());
  await page.locator('#acc-password').fill('E2eTech!Pass99');
  await page.locator('#acc-confirmPassword').fill('E2eTech!Pass99');
  const accepted = page.waitForResponse(
    (r) =>
      r.url().includes(`/invitations/${token}/accept`) &&
      r.request().method() === 'POST' &&
      r.ok(),
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: /accept invite & join/i }).click();
  await accepted;
  await expect(page.getByText('Welcome to UpNow!')).toBeVisible({ timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('09 service-provider full cycle', () => {
  test('SP registers via UI and lands on the onboarding wizard (fresh individual profile auto-created)', async ({
    page,
  }) => {
    const spEmail = uniqEmail(`sp${RUN_TAG}`);
    await registerProviderViaUi(page, 'service-provider', spEmail);
    // /verify-email → /dashboard/service-provider/onboarding
    await page.waitForURL(SP_ONBOARDING_URL, { timeout: 90_000 });
    await waitForWizard(page);
    // fresh SP starts on step 0 — phone verification
    await expect(stepHeading(page, 'Verify your mobile number')).toBeVisible({ timeout: 30_000 });

    const spUserId = Number(q(`SELECT id FROM users WHERE email='${spEmail}'`));
    expect(spUserId, 'sp user row').toBeGreaterThan(0);
    expect(q(`SELECT role FROM users WHERE id=${spUserId}`)).toBe('service_provider');

    const spProfileId = Number(q(`SELECT id FROM service_providers WHERE user_id=${spUserId}`));
    expect(spProfileId, 'sp profile row auto-created at registration').toBeGreaterThan(0);
    // fresh profile: account type not yet confirmed, compliance pending
    expect(q(`SELECT entity_type FROM service_providers WHERE id=${spProfileId}`)).toBe('individual');
    expect(q(`SELECT account_type_confirmed_at IS NULL FROM service_providers WHERE id=${spProfileId}`)).toBe('t');
    expect(q(`SELECT compliance_status FROM service_providers WHERE id=${spProfileId}`)).toBe('pending_review');

    writeState({ spEmail, spUserId, spProfileId });
  });

  test('SP completes all 6 wizard steps — phone OTP, business basics, categories, area, owner details, real doc uploads → dashboard shows the verification-in-progress banner', async ({
    page,
  }) => {
    const s = readState();
    await safeLoginViaUi(page, s.spEmail);
    await page.goto('/dashboard/service-provider/onboarding');
    await waitForWizard(page);

    // ── Step 0: Phone + inline OTP ──
    await expect(stepHeading(page, 'Verify your mobile number')).toBeVisible({ timeout: 30_000 });
    const spPhone = uniqPhone();
    await page.getByPlaceholder('+971 50 123 4567').fill(spPhone);
    const otp = await captureDevOtp(page, '/auth/otp/request', () =>
      page.getByRole('button', { name: /send verification code/i }).click(),
    );
    await fillOtp(page, otp); // single 6-digit [inputmode=numeric] box
    await page.getByRole('button', { name: /verify & continue/i }).click();

    // ── Step 1: Business basics (individual) ──
    // BusinessBasicsStep mounts after the post-verify refresh; wait for its form.
    await expect(stepHeading(page, 'Tell us about your business')).toBeVisible({ timeout: 45_000 });
    const bizName = page.getByPlaceholder('e.g. Al Noor Technical Services');
    await expect(bizName).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /sole trader \/ freelancer/i }).click();
    await bizName.fill(SP_BUSINESS_NAME);
    await page.getByPlaceholder('Full legal name').fill(SP_OWNER_NAME);
    await saveStep(page); // PATCH entityType → sets account_type_confirmed_at

    // ── Step 2: Service categories (≥1) ──
    await expect(stepHeading(page, 'What do you offer?')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Cleaning', exact: true }).click();
    await page.getByRole('button', { name: 'Pest Control', exact: true }).click();
    await saveStep(page);

    // ── Step 3: Service area (≥1 emirate) ──
    await expect(stepHeading(page, 'Where do you operate?')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Dubai', exact: true }).click();
    await page.getByRole('button', { name: 'Sharjah', exact: true }).click();
    await saveStep(page);

    // ── Step 4: Owner details — EID number, nationality combobox, DOB picker ──
    await expect(stepHeading(page, 'Personal information')).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder('784-1990-1234567-8').fill(SP_EID_NUMBER);

    // nationality: type-ahead input + option list (onMouseDown handler)
    await page.getByPlaceholder('Search nationality…').fill('Filipino');
    await page.getByRole('button', { name: 'Filipino', exact: true }).click();

    // DOB: react-day-picker v9 with captionLayout="dropdown" — two <select>s
    // labelled "Choose the Year"/"Choose the Month", day cells are .rdp-day_button
    await page.getByRole('button', { name: /select your date of birth/i }).click();
    await page.getByLabel('Choose the Year').selectOption('1992');
    await page.getByLabel('Choose the Month').selectOption({ label: 'May' });
    await page.locator('button.rdp-day_button').filter({ hasText: /^15$/ }).first().click();
    await expect(page.getByRole('button', { name: /15 May 1992/ })).toBeVisible();
    await saveStep(page);

    // ── Step 5: Documents — individual SP requires Emirates ID + Bank Statement ──
    await expect(stepHeading(page, 'Upload your KYC files')).toBeVisible({ timeout: 30_000 });
    const eidRow = docRow(page, 'Emirates ID');
    await expect(eidRow).toBeVisible({ timeout: 30_000 });
    await uploadDoc(page, eidRow.getByRole('button', { name: /upload/i }), pngFile('sp-eid.png'));
    // SP uploads are NOT self-verified (unlike RP/manager/admin) → 'attached'
    await expect(eidRow.getByText(/pending review/i)).toBeVisible({ timeout: 20_000 });

    const bankRow = docRow(page, 'Bank Statement');
    await expect(bankRow).toBeVisible();
    await uploadDoc(
      page,
      bankRow.getByRole('button', { name: /upload/i }),
      pdfFile('sp-bank-statement.pdf'),
    );
    await expect(bankRow.getByText(/pending review/i)).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText('All required done ✓')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Go to my dashboard' }).click();

    // wizard complete → router.replace to the SP dashboard
    await page.waitForURL((u) => new URL(String(u)).pathname === '/dashboard/service-provider', {
      timeout: 60_000,
    });

    // The banner keys off user.kycStatus === 'pending_review', which only
    // flipped in the DB at the first doc upload — the in-memory AuthContext
    // user is stale until a full page load, so reload before asserting.
    await page.reload();
    await expect(page.getByText('Under review', { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Verification in progress')).toBeVisible();

    // ── DB truths ──
    expect(q(`SELECT entity_type FROM service_providers WHERE id=${s.spProfileId}`)).toBe('individual');
    expect(
      q(`SELECT account_type_confirmed_at IS NOT NULL FROM service_providers WHERE id=${s.spProfileId}`),
    ).toBe('t');
    expect(q(`SELECT business_name FROM service_providers WHERE id=${s.spProfileId}`)).toBe(SP_BUSINESS_NAME);
    expect(q(`SELECT owner_name FROM service_providers WHERE id=${s.spProfileId}`)).toBe(SP_OWNER_NAME);
    expect(q(`SELECT service_categories FROM service_providers WHERE id=${s.spProfileId}`)).toBe(
      'cleaning,pest_control',
    );
    expect(q(`SELECT service_category FROM service_providers WHERE id=${s.spProfileId}`)).toBe('cleaning');
    expect(q(`SELECT emirates_served FROM service_providers WHERE id=${s.spProfileId}`)).toBe('dubai,sharjah');
    expect(q(`SELECT emirates_id_number FROM service_providers WHERE id=${s.spProfileId}`)).toBe(SP_EID_NUMBER);
    expect(q(`SELECT nationality FROM service_providers WHERE id=${s.spProfileId}`)).toBe('Filipino');
    expect(q(`SELECT date_of_birth::text FROM service_providers WHERE id=${s.spProfileId}`)).toBe('1992-05-15');
    expect(q(`SELECT compliance_status FROM service_providers WHERE id=${s.spProfileId}`)).toBe('pending_review');
    expect(q(`SELECT phone_verified FROM users WHERE id=${s.spUserId}`)).toBe('t');
    expect(q(`SELECT kyc_status FROM users WHERE id=${s.spUserId}`)).toBe('pending_review');

    // both uploads persisted as 'attached' (SP is not a self-verifying role)
    expect(
      q(`SELECT count(*) FROM documents WHERE owner_type='service_provider'
           AND owner_id=${s.spProfileId} AND status='attached'
           AND document_key IN ('emirates_id','bank_statement')`),
    ).toBe('2');

    // the EID file round-trips through the local-disk store + :3010 proxy
    const fileUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='service_provider'
         AND owner_id=${s.spProfileId} AND document_key='emirates_id'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(fileUrl, 'emirates_id document row').toBeTruthy();
    await expectUploadServed(page, new URL(fileUrl).pathname);

    writeState({ spPhone, spBusinessName: SP_BUSINESS_NAME });
  });

  test('negative: revisiting onboarding after submit resumes the persisted state (uploads + saved fields), not an empty wizard', async ({
    page,
  }) => {
    const s = readState();
    await safeLoginViaUi(page, s.spEmail);
    await page.goto('/dashboard/service-provider/onboarding');
    await waitForWizard(page);

    // steps 0-4 are recognised as complete from the server; the wizard resumes
    // at Documents (the only step its init can never auto-complete)
    await expect(page.getByText(/5 of 6\s*steps complete/)).toBeVisible({ timeout: 30_000 });
    await expect(stepHeading(page, 'Upload your KYC files')).toBeVisible();

    // earlier uploads are still on the checklist — Replace offered, not Upload
    const eidRow = docRow(page, 'Emirates ID');
    await expect(eidRow.getByText(/pending review/i)).toBeVisible({ timeout: 30_000 });
    await expect(eidRow.getByRole('button', { name: /replace/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go to my dashboard' })).toBeEnabled();

    // completed steps stay reachable with their saved values
    await page.getByRole('button', { name: /business basics/i }).click();
    await expect(page.getByPlaceholder('e.g. Al Noor Technical Services')).toHaveValue(
      s.spBusinessName,
      { timeout: 30_000 },
    );
    await expect(page.getByPlaceholder('Full legal name')).toHaveValue(SP_OWNER_NAME);
  });

  test('admin Service tab: SP queued as Pending Review with its profile data — but the panel is review-less and docs stay attached', async ({
    page,
  }) => {
    const s = readState();
    await safeAdminLogin(page);

    await page.goto('/dashboard/admin/kyc?tab=service');
    const card = page.locator('button').filter({ hasText: s.spEmail }).first();
    await expect(card, 'SP card in the Service tab queue').toBeVisible({ timeout: 90_000 });
    await expect(card.getByText('Pending Review')).toBeVisible();
    await card.click();

    // split panel renders from the list payload (no detail fetch for SPs)
    await expect(page.getByRole('heading', { name: s.spBusinessName })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('individual', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('cleaning', { exact: true }).first()).toBeVisible();

    // current state of the product: explicit "coming soon" placeholder where
    // the review actions should be (see BUG-23 xfail test below)
    await expect(page.getByText('Full KYC review — coming soon')).toBeVisible();

    // nothing changed server-side by viewing: docs still pending, SP still pending
    expect(
      q(`SELECT count(*) FROM documents WHERE owner_type='service_provider'
           AND owner_id=${s.spProfileId} AND status='attached'`),
    ).toBe('2');
    expect(q(`SELECT compliance_status FROM service_providers WHERE id=${s.spProfileId}`)).toBe(
      'pending_review',
    );
  });

  test('admin can verify SP documents / record a compliance decision from the Service tab', async ({
    page,
  }) => {
    test.fail(
      true,
      'BUG-23: the admin Service tab has NO KYC review UI for service providers — SpContentPanel (src/app/dashboard/(dashboard)/admin/kyc/page.tsx:623-672) renders a summary grid plus a hard-coded "Full KYC review — coming soon" footer (page.tsx:661-669): no uploaded-documents list, no Verify button, no Mark Compliant/Request Action bar (unlike RpContentPanel:587-616), and no SP full-page review route exists. The backend is ready and unused: PATCH /admin/kyc/service-providers/:id/compliance (admin.controller.ts:165) and POST /admin/kyc/documents/:id/verify (admin.controller.ts:222). Since SP uploads are NOT self-verified (documents.service.ts:403 reviewerRoles excludes service_provider), every SP is stuck forever: docs status=attached, compliance_status=pending_review, dashboard banner "Under review" permanently. Repro: register+onboard an SP (this spec), admin → /dashboard/admin/kyc?tab=service → select the SP — no document rows, no verify/approve control anywhere.',
    );
    const s = readState();
    await safeAdminLogin(page);
    await page.goto('/dashboard/admin/kyc?tab=service');
    const card = page.locator('button').filter({ hasText: s.spEmail }).first();
    await expect(card).toBeVisible({ timeout: 90_000 });
    await card.click();
    await expect(page.getByRole('heading', { name: s.spBusinessName })).toBeVisible({
      timeout: 30_000,
    });

    // an admin reviewing a pending SP needs to SEE the uploaded documents…
    await expect(
      page.getByText(/bank statement/i).first(),
      'SP uploaded documents listed for review',
    ).toBeVisible({ timeout: 8_000 });
    // …and act on them / the profile
    const reviewControl = page.getByRole('button', { name: /verify|approve|mark compliant/i }).first();
    await expect(reviewControl, 'a Verify/Approve/Mark-Compliant control for the SP').toBeVisible({
      timeout: 8_000,
    });

    // (unreachable until BUG-23 is fixed) — acting must flip the DB state
    await reviewControl.click();
    await expect
      .poll(
        () =>
          q(`SELECT count(*) FROM documents WHERE owner_type='service_provider'
               AND owner_id=${s.spProfileId} AND status='processed'`),
        { timeout: 15_000 },
      )
      .not.toBe('0');
  });

  test('SP invites a technician from the team page — invite listed as pending', async ({
    page,
  }) => {
    const s = readState();
    const technicianEmail = uniqEmail(`tech${RUN_TAG}`);
    await safeLoginViaUi(page, s.spEmail);

    await sendTechInvite(page, technicianEmail, 'Tariq', 'Cycletech');

    // modal closes, pending list refetches
    await expect(page.getByText('Pending Invites (1)')).toBeVisible({ timeout: 30_000 });
    const inviteRow = page.locator('div.rounded-2xl').filter({ hasText: technicianEmail }).last();
    await expect(inviteRow).toBeVisible();
    await expect(inviteRow.getByText('pending', { exact: true })).toBeVisible();
    await expect(inviteRow.getByText(/expires in 7 days/i)).toBeVisible();

    // DB truths
    expect(
      q(`SELECT status FROM invitations WHERE email='${technicianEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe('pending');
    expect(
      q(`SELECT role FROM invitations WHERE email='${technicianEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe('technician');
    expect(
      q(`SELECT invited_by_user_id FROM invitations WHERE email='${technicianEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe(String(s.spUserId));

    writeState({ technicianEmail });
  });

  test('technician accepts via /invite/<token> (logged out) — account created as technician, linked to the SP, can reach the technician dashboard', async ({
    page,
  }) => {
    const s = readState();
    const token = inviteTokenFor(s.technicianEmail);

    await logout(page); // accept must happen unauthenticated
    await acceptInvite(page, token, 'Tariq', 'Cycletech');

    // ── DB truths: user + role profile + parent linkage + invite consumed ──
    const technicianUserId = Number(q(`SELECT id FROM users WHERE email='${s.technicianEmail}'`));
    expect(technicianUserId, 'technician user row').toBeGreaterThan(0);
    expect(q(`SELECT role FROM users WHERE id=${technicianUserId}`)).toBe('technician');
    expect(q(`SELECT parent_account_id FROM users WHERE id=${technicianUserId}`)).toBe(String(s.spUserId));
    expect(q(`SELECT invited_by_user_id FROM users WHERE id=${technicianUserId}`)).toBe(String(s.spUserId));
    expect(
      q(`SELECT service_provider_id FROM technicians WHERE user_id=${technicianUserId}`),
    ).toBe(String(s.spProfileId));
    expect(q(`SELECT status FROM technicians WHERE user_id=${technicianUserId}`)).toBe('active');
    expect(
      q(`SELECT status FROM invitations WHERE email='${s.technicianEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe('accepted');
    expect(
      q(`SELECT accepted_by_user_id FROM invitations WHERE email='${s.technicianEmail}' ORDER BY id DESC LIMIT 1`),
    ).toBe(String(technicianUserId));

    // Let the page's 1.5s router.push fire before navigating ourselves (the
    // auto-redirect target is broken — covered by the BUG-21 xfail test below).
    await page
      .waitForURL((u) => new URL(String(u)).pathname.startsWith('/dashboard'), { timeout: 15_000 })
      .catch(() => {});

    // The accept response set the session cookie via the proxy — the technician
    // is logged in and their dashboard renders.
    await page.goto('/dashboard/technician');
    await expect(page.getByRole('heading', { name: /welcome, tariq/i })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText('Your assigned jobs and schedule.')).toBeVisible();

    writeState({ technicianUserId });
  });

  test('SP team list shows the technician as active; the invite is no longer pending', async ({
    page,
  }) => {
    const s = readState();
    await safeLoginViaUi(page, s.spEmail);
    await page.goto('/dashboard/service-provider/team');

    await expect(page.getByText('Active Technicians (1)')).toBeVisible({ timeout: 90_000 });
    const techRow = page.locator('div.rounded-2xl').filter({ hasText: s.technicianEmail }).last();
    await expect(techRow).toBeVisible();
    await expect(techRow.getByText('Tariq Cycletech')).toBeVisible();
    await expect(techRow.getByText('active', { exact: true })).toBeVisible();

    // the accepted invite left the pending list (section unmounts when empty)
    await expect(page.getByText(/Pending Invites/)).toBeHidden({ timeout: 30_000 });

    expect(
      q(`SELECT count(*) FROM technicians WHERE service_provider_id=${s.spProfileId}`),
    ).toBe('1');
  });

  test('after accepting, the auto-redirect lands the technician on their dashboard', async ({
    page,
  }) => {
    const s = readState();
    const technician2Email = uniqEmail(`tech2${RUN_TAG}`);

    // second invite → fresh token (the first was consumed by the green test)
    await safeLoginViaUi(page, s.spEmail);
    await sendTechInvite(page, technician2Email, 'Tess', 'Cyclelander');
    writeState({ technician2Email });
    const token = inviteTokenFor(technician2Email);

    await logout(page);
    await acceptInvite(page, token, 'Tess', 'Cyclelander');

    // the success screen promises "Redirecting to your dashboard…" — for a
    // technician that is /dashboard/technician
    await expect(page).toHaveURL(/\/dashboard\/technician/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /welcome, tess/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});
