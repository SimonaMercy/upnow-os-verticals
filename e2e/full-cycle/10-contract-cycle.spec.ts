import { test, expect, Page, Locator, BrowserContext } from '@playwright/test';
import {
  safeLoginViaUi,
  q,
  readState,
  writeState,
  uniqEmail,
  uniqPhone,
} from './helpers';

/**
 * 10 — Tenancy contract lifecycle, end-to-end through the UI.
 *
 * Everything runs as the individual RP (state.rpEmail) except where noted.
 * A brand-new customer is created INLINE inside the /contracts/new wizard,
 * then the contract on unit E2E-103 (state.unitIds[2] = 118) is walked through
 * the whole product lifecycle:
 *
 *   1. Wizard (optimistic, BUG-16 expected fail): inline new customer +
 *      unit E2E-103 + dates → Create Contract → POST /contracts 400s because
 *      the wizard forwards the unit's fee values as strings ("4005.00").
 *   2. API fallback (BUG-16 workaround, same endpoint, NUMERIC fees) —
 *      records state.contractId. Documents that POST /contracts creates the
 *      row born ISSUED (contracts.service.ts:1200) — the Issue step is
 *      auto-complete; there is no UI way to ever see the "Issue contract"
 *      action for wizard-created contracts.
 *   3. BUG-24 (expected fail): the Issue step's only rollback affordance,
 *      "Revert to draft", PATCHes /api/contracts/:id/revert — a route that
 *      does not exist in the backend (404). The UI swallows the error and
 *      optimistically flips to Draft locally, lying to the RP; a reload
 *      shows Issued again and the DB row never changed.
 *   4. RP countersigns through the v2 Sign modal using the typed-name
 *      fallback (no canvas needed) → contract_signatures row with
 *      actor_user_id = RP user.
 *   5. The Sign step's "Send signing link" control generates the tenant
 *      magic link — token captured from the API response + the on-page
 *      readonly input (email substitute; DISABLE_EMAIL stack).
 *   6. LOGGED-OUT context: tenant opens /portal/<token>/contract/<id>,
 *      reviews the rendered Dubai contract (filled-template iframe), ticks
 *      the I-have-read box, draws a canvas signature (mouse automation,
 *      precedent: e2e/move-in-journey.spec.ts) and signs.
 *   7. Payments: first instalment cheque marked Cleared via the status
 *      select, then "Confirm PDC received" (requires status=issued).
 *   8. Activate via the Active waypoint → "Activate tenancy now".
 *   9. DB invariants: contract active, unit 118 occupied + delisted,
 *      4 instalment payments, unit_rent_history row opened.
 *  10. The inline-created tenant HAS a login (createTenant provisions a
 *      customer user account) — email-OTP login → /dashboard/customer/contracts
 *      shows the Active contract card.
 *  11. The RP print page renders the filled Dubai tenancy PDF.
 *  12. Idempotent reload: signatures + active state survive a fresh load and
 *      every workflow-rollback affordance is frozen (no Undo / Revert).
 *
 * Lessons honoured from spec 07: POST /contracts needs NUMERIC fee fields
 * (BUG-16); numeric round-trips look like "5432.00" (compare via Number());
 * bounded waits on responses that are expected to fail; q() is the
 * email-substitute / DB-assert escape hatch; first page compile can take
 * 15–30s so first-visibility waits are generous.
 */

const S = readState();
const RP_EMAIL: string = S.rpEmail;
const RP_USER_ID: number = S.rpUserId;
const RP_NAME: string = S.rpFullName ?? 'Rashid Cyclelord';
const PROPERTY_ID: number = S.propertyId;
const UNIT3_ID: number = S.unitIds?.[2]; // 118 — E2E-103 (116 is the published listing; 117 carries spec 07's contract)
const UNIT3_NUMBER: string = S.unitNumbers?.[2]; // 'E2E-103'

const TENANT2_FIRST = 'Tina';
const TENANT2_LAST = 'Tenanttwo';
const TENANT2_NAME = `${TENANT2_FIRST} ${TENANT2_LAST}`;
const tenant2Email = uniqEmail('tenant2'); // stable per cycle (runId-derived)

// 12-month lease: ends the day before the anniversary.
const START_DATE = '2026-08-01';
const END_DATE = '2027-07-31';
const INSTALMENTS = 4;

// ─── DB lookups (idempotency across re-runs + email substitutes) ─────────────

function dbTenant2Id(): number {
  return Number(
    q(`SELECT t.id FROM tenants t JOIN users u ON u.id=t.user_id
       WHERE u.email='${tenant2Email}' ORDER BY t.id DESC LIMIT 1`) || 0,
  );
}

function dbTenant2UserId(): number {
  return Number(q(`SELECT id FROM users WHERE email='${tenant2Email}'`) || 0);
}

function dbContractId(): number {
  const t = dbTenant2Id();
  if (!t) return 0;
  return Number(
    q(`SELECT id FROM tenancy_contracts WHERE unit_id=${UNIT3_ID} AND tenant_id=${t}
       ORDER BY id DESC LIMIT 1`) || 0,
  );
}

function requireContractId(): number {
  const cid = Number(readState().contractId || 0) || dbContractId();
  expect(cid, 'contract id from the create tests (state.contractId)').toBeGreaterThan(0);
  return cid;
}

const contractStatus = (cid: number) =>
  q(`SELECT status FROM tenancy_contracts WHERE id=${cid}`);
const sigCount = (cid: number, role: 'landlord' | 'tenant') =>
  Number(q(`SELECT count(*) FROM contract_signatures WHERE tenancy_contract_id=${cid} AND role='${role}'`));

// ─── Page helpers ─────────────────────────────────────────────────────────────

/** Open the v2 lifecycle page and wait for the contract header to render. */
async function openV2(page: Page, cid: number) {
  await page.goto(`/rental-provider/dashboard/contracts/${cid}/v2`);
  await expect(page.getByRole('heading', { name: new RegExp(`CID-${cid}\\b`) }))
    .toBeVisible({ timeout: 90_000 });
}

/** Click a QuestMap waypoint by its short label (Issue / Sign / Ejari / Utility / Move-in / Active). */
async function selectStep(page: Page, short: string) {
  await page
    .locator('.qmap svg text')
    .filter({ hasText: new RegExp(`^${short}$`) })
    .first()
    .click();
}

/** Draw a small zig-zag on a signature canvas via real pointer events
 *  (same technique as e2e/move-in-journey.spec.ts UI-T1). */
async function drawSignature(pg: Page, canvas: Locator) {
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'signature canvas is measurable').toBeTruthy();
  const { x, y, width, height } = box!;
  await pg.mouse.move(x + width * 0.15, y + height * 0.45);
  await pg.mouse.down();
  await pg.mouse.move(x + width * 0.4, y + height * 0.7, { steps: 10 });
  await pg.mouse.move(x + width * 0.65, y + height * 0.3, { steps: 10 });
  await pg.mouse.move(x + width * 0.85, y + height * 0.55, { steps: 10 });
  await pg.mouse.up();
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('10 contract lifecycle: wizard → sign (RP + tenant portal) → payments → activate', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    expect(RP_EMAIL, 'state.rpEmail from spec 02/03').toBeTruthy();
    expect(PROPERTY_ID, 'state.propertyId from spec 04').toBeGreaterThan(0);
    expect(UNIT3_ID, 'state.unitIds[2] from spec 04').toBeGreaterThan(0);
    context = await browser.newContext();
    page = await context.newPage();
    await safeLoginViaUi(page, RP_EMAIL, /\/rental-provider\/dashboard/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // ── 1. Wizard with a NEW inline customer — Create is known-broken ───────────

  test('wizard: inline new customer + unit E2E-103 → Create Contract (BUG-16: fee fields sent as strings, POST /contracts 400s)', async () => {
    const existing = dbContractId();
    if (existing) {
      writeState({ contractId: existing, tenant2Id: dbTenant2Id(), tenant2UserId: dbTenant2UserId(), tenant2Email });
      test.skip(true, 're-run: contract already exists from a previous invocation');
    }

    await page.goto('/rental-provider/dashboard/contracts/new');
    // Property select doubles as the page-ready signal (first compile is slow).
    const propertySelect = page
      .locator('select')
      .filter({ has: page.locator('option:text-is("Select property…")') });
    await expect(propertySelect).toBeVisible({ timeout: 90_000 });

    // — Inline NEW customer (account-ful: backend provisions a customer user) —
    await page.getByRole('button', { name: /Customer not listed/ }).click();
    // exact:true — the tenant search box's placeholder ("Type name or email…")
    // would otherwise substring-match 'Email'.
    await page.getByPlaceholder('Full name', { exact: true }).fill(TENANT2_NAME);
    await page.getByPlaceholder('Email', { exact: true }).fill(tenant2Email);
    await page.getByPlaceholder('Phone (optional)', { exact: true }).fill(uniqPhone());
    const created = page.waitForResponse(
      (r) => r.url().includes('/api/contracts/tenants') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create customer' }).click();
    const createdResp = await created;
    expect(createdResp.status(), await createdResp.text()).toBe(201);
    const body = (await createdResp.json()) as { tenantId: number; userId: number; existed: boolean };
    expect(body.tenantId).toBeGreaterThan(0);
    // Persist immediately — the rest of this test is expected to fail (BUG-16),
    // but the customer is real and later tests need them.
    writeState({ tenant2Email, tenant2Id: body.tenantId, tenant2UserId: body.userId });

    // Wizard now shows the selected customer + the docs-link affordance.
    await expect(page.getByText(`✓ ${TENANT2_NAME}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send documents upload link' })).toBeVisible();

    // — Property + unit (E2E-103 / unit 118 — 116 stays untouched/published) —
    await propertySelect.selectOption(String(PROPERTY_ID));
    const unitBtn = page.getByRole('button', { name: new RegExp(`Unit ${UNIT3_NUMBER}`) });
    await expect(unitBtn).toBeVisible({ timeout: 30_000 });
    await unitBtn.click();

    // — Dates: RP has no preferred start days → plain date inputs; the end
    //   date auto-fills to the day before the 12-month anniversary. —
    await page.locator('input[type="date"]').first().fill(START_DATE);
    await expect(page.locator('input[type="date"]').nth(1)).toHaveValue(END_DATE);

    // Unit pricing panel proves fees were loaded (they're what poisons the POST).
    await expect(page.getByText('Unit Pricing')).toBeVisible();

    const posted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/contracts' && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Create Contract' }).click();
    const resp = await posted;
    // FAILS here: 400 wall of raw class-validator text ("securityDepositAmount
    // must be a number conforming to the specified constraints", adminFee…, ejariFee…).
    expect(resp.status(), await resp.text()).toBe(201);

    // Unreached while BUG-16 stands:
    await expect(page.getByRole('heading', { name: 'Contract Created' })).toBeVisible({ timeout: 30_000 });
    const cid = dbContractId();
    expect(cid).toBeGreaterThan(0);
    writeState({ contractId: cid });
  });

  // ── 2. API fallback — same endpoint, numeric fees (BUG-16 workaround) ───────

  test('fallback: contract via API with NUMERIC fees (BUG-16 workaround) — row is born ISSUED with auto instalments', async () => {
    const existing = dbContractId();
    if (existing) {
      writeState({ contractId: existing });
      test.skip(true, 're-run: contract already exists');
    }
    const tenant2Id = Number(readState().tenant2Id || 0) || dbTenant2Id();
    expect(tenant2Id, 'tenant2 created by the wizard test').toBeGreaterThan(0);

    // Mirror exactly what the wizard WOULD send, but typed as numbers — the
    // unit's stored fees, read back from the DB (values are per-run: spec 07's
    // BUG-10 recalculated them to 5% of its randomized rent).
    const rent = Number(q(`SELECT rental_price::float8 FROM units WHERE id=${UNIT3_ID}`));
    const deposit = Number(q(`SELECT COALESCE(security_deposit,0)::float8 FROM units WHERE id=${UNIT3_ID}`));
    const adminFee = Number(q(`SELECT COALESCE(admin_fee,0)::float8 FROM units WHERE id=${UNIT3_ID}`));
    const ejariFee = Number(q(`SELECT COALESCE(ejari_fee,0)::float8 FROM units WHERE id=${UNIT3_ID}`));
    expect(rent, 'unit 118 has a rental price').toBeGreaterThan(0);

    const res = await page.request.post('/api/contracts', {
      data: {
        unitId: UNIT3_ID,
        tenantId: tenant2Id,
        contractStartDate: START_DATE,
        contractEndDate: END_DATE,
        annualRent: rent,
        securityDepositAmount: deposit,
        adminFee,
        ejariFee,
        numberOfInstallments: INSTALMENTS,
        modeOfPayment: 'cheque',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const createdContract = (await res.json()) as { id: number };
    expect(createdContract.id).toBeGreaterThan(0);
    writeState({ contractId: createdContract.id });
    const cid = createdContract.id;

    // Money is WHOLE AED on the contracts API; numerics round-trip as "80123.00".
    expect(Number(q(`SELECT annual_rent::float8 FROM tenancy_contracts WHERE id=${cid}`))).toBe(rent);
    // Born ISSUED (not pending) — contracts.service.ts:1200 sets status at create,
    // so the v2 "Issue" step is already complete (see BUG-24 test next).
    expect(contractStatus(cid)).toBe('issued');
    // Even-split instalments were auto-created (no lead plan).
    expect(
      q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND payment_type='rental_income'`),
    ).toBe(String(INSTALMENTS));
    expect(
      q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND cheque_status='pending'`),
    ).toBe(String(INSTALMENTS));
  });

  // ── 3. BUG-24: "Revert to draft" is dead (no backend route; UI lies) ────────

  test('Issue step: "Revert to draft" actually reverts (BUG-24: PATCH /contracts/:id/revert has no backend route; UI flips locally and lies)', async () => {
    const cid = requireContractId();
    test.skip(contractStatus(cid) === 'active', 're-run: contract already active — workflow is frozen and the revert affordance is hidden');
    test.fail(
      true,
      'BUG-24: the v2 Issue step offers "Revert to draft" but PATCH /api/contracts/:id/revert 404s (route does not exist); the onRevertToDraft catch silently flips ONLY local state to Draft, so the page lies and a reload shows Issued again. Compounded by POST /contracts creating rows born ISSUED, the Issue action itself is unreachable.',
    );

    await openV2(page, cid);
    // The contract is born issued → the Issue waypoint is already complete.
    await selectStep(page, 'Issue');
    await expect(page.getByRole('heading', { name: 'Contract issued.' })).toBeVisible();
    await expect(page.getByText('Issued to customer')).toBeVisible();

    const reverted = page.waitForResponse(
      (r) => r.url().includes(`/contracts/${cid}/revert`) && r.request().method() === 'PATCH',
      { timeout: 20_000 },
    );
    await page.getByRole('button', { name: 'Revert to draft' }).click();
    const resp = await reverted;

    // The optimistic lie: the page now renders the Draft state with a live
    // "Issue contract to <tenant>" button…
    await expect(page.getByRole('heading', { name: 'Issue this contract.' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Issue contract to/ })).toBeVisible();
    // …while the server never heard of it:
    expect(contractStatus(cid), 'DB status is untouched by the dead revert').toBe('issued');
    // FAILS: the route the button calls does not exist (404).
    expect(resp.ok(), `PATCH /api/contracts/${cid}/revert → ${resp.status()} (no such backend route)`).toBe(true);

    // Unreached while BUG-24 stands — the display half: a reload forgets the "draft".
    await page.reload();
    await expect(page.getByRole('heading', { name: new RegExp(`CID-${cid}\\b`) })).toBeVisible({ timeout: 60_000 });
    await selectStep(page, 'Issue');
    await expect(page.getByRole('button', { name: /Issue contract to/ })).toHaveCount(0);
  });

  // ── 4. RP countersigns via the Sign modal (typed-name fallback) ─────────────

  test('RP signs as landlord through the sign modal using the typed-name fallback', async () => {
    const cid = requireContractId();
    test.skip(sigCount(cid, 'landlord') > 0, 're-run: landlord signature already on file');

    await openV2(page, cid);
    // Issue is done → the auto-selected step is Sign.
    await expect(page.getByRole('heading', { name: 'Capture both signatures.' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('awaiting customer')).toBeVisible();

    // "Sign now" on the landlord ChkRow opens the SignModal (scoped — the page
    // ALSO renders an inline landlord pad with identical buttons below).
    await page.getByRole('button', { name: 'Sign now' }).click();
    const modal = page.locator('.mscrim .modal');
    await expect(modal.getByText('Signing as Landlord')).toBeVisible();

    // Typed-name fallback — no canvas automation needed for the RP side.
    await modal.getByRole('button', { name: 'Type name' }).click();
    const nameInput = modal.locator('.field input');
    await nameInput.fill(RP_NAME);

    const signed = page.waitForResponse(
      (r) => r.url().includes(`/contracts/${cid}/sign`) && r.request().method() === 'POST',
    );
    await modal.getByRole('button', { name: 'Sign as Landlord' }).click();
    const resp = await signed;
    expect(resp.status(), await resp.text()).toBe(201);

    // Modal closes, page reloads its data, header celebrates.
    await expect(page.getByText('You signed')).toBeVisible({ timeout: 30_000 });

    // DB: the signature row records WHO clicked (actor_user_id, spec'd in
    // the signature-actor work) + method online + the typed name.
    expect(
      q(`SELECT role || '|' || method || '|' || signatory_name || '|' || COALESCE(actor_user_id::text,'')
         FROM contract_signatures WHERE tenancy_contract_id=${cid} AND role='landlord'
         ORDER BY id DESC LIMIT 1`),
    ).toBe(`landlord|online|${RP_NAME}|${RP_USER_ID}`);
  });

  // ── 5. Tenant magic link from the Sign step ──────────────────────────────────

  test('Sign step generates the tenant signing magic link (captured from the UI — email substitute)', async () => {
    const cid = requireContractId();
    test.skip(
      contractStatus(cid) === 'active' || sigCount(cid, 'tenant') > 0,
      're-run: tenant already signed / contract active — the signing-link control is no longer shown',
    );
    const tenant2Id = Number(readState().tenant2Id || 0) || dbTenant2Id();

    await openV2(page, cid);
    await expect(page.getByText('Customer contract signing link')).toBeVisible({ timeout: 30_000 });

    const generated = page.waitForResponse(
      (r) => r.url().includes('/api/portal/generate') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send signing link' }).click();
    const resp = await generated;
    expect(resp.status(), await resp.text()).toBe(201);
    const body = (await resp.json()) as { token: string; link: string; email: string | null };
    expect(body.token, 'portal token issued').toMatch(/^[0-9a-f]{20,}$/);
    expect(body.link).toContain(`/portal/${body.token}/contract/${cid}`);
    // The link would be EMAILED to the tenant — DISABLE_EMAIL stack, so the
    // returned address + on-page link box are the email substitute.
    expect(body.email).toBe(tenant2Email);

    // The link is also shown on the page for copy/share (host-agnostic check —
    // the backend builds it from its FRONTEND_URL config).
    await expect(page.locator('.acard input[readonly]').first()).toHaveValue(
      new RegExp(`/portal/${body.token}/contract/${cid}`),
    );

    // DB: token row is scoped to this tenant + contract, purpose 'contract'.
    expect(
      q(`SELECT purpose || '|' || signer_role || '|' || tenant_id || '|' || tenancy_contract_id || '|' || revoked
         FROM tenant_portal_tokens WHERE token='${body.token}'`),
    ).toBe(`contract|tenant|${tenant2Id}|${cid}|false`);

    writeState({ portalToken: body.token });
  });

  // ── 6. Tenant reviews + signs on the no-login portal ────────────────────────

  test('logged-out tenant reviews the contract on the portal and signs it (canvas)', async ({ browser }) => {
    const cid = requireContractId();
    const token =
      readState().portalToken ||
      q(`SELECT token FROM tenant_portal_tokens
         WHERE tenancy_contract_id=${cid} AND purpose='contract' AND signer_role='tenant' AND revoked=false
         ORDER BY id DESC LIMIT 1`);
    expect(token, 'portal token from the previous test (state.portalToken / tenant_portal_tokens)').toBeTruthy();
    const alreadySigned = sigCount(cid, 'tenant') > 0;

    // Fresh context = genuinely logged out (no upnow_token cookie).
    const ctx = await browser.newContext();
    try {
      const pg = await ctx.newPage();
      await pg.goto(`/portal/${token}/contract/${cid}`);
      await expect(pg.getByRole('heading', { name: `Your tenancy contract — CID-${cid}` }))
        .toBeVisible({ timeout: 90_000 });

      // Review-before-sign: the actual contract document renders (Dubai →
      // filled official DLD template served in an iframe).
      await expect(pg.locator('iframe[title="Tenancy Contract"]')).toBeVisible({ timeout: 60_000 });
      await expect(pg.getByText('Sign the contract')).toBeVisible();

      if (alreadySigned) {
        await expect(pg.getByText('You have signed this contract.')).toBeVisible();
        test.skip(true, 're-run: tenant already signed — portal correctly shows the signed state');
      }

      // The sign gate: must confirm reading, name, and a drawn signature.
      await pg.getByRole('checkbox', { name: /I have read the contract/ }).check();
      const nameBox = pg.getByPlaceholder('Full name');
      await nameBox.fill(TENANT2_NAME);
      await drawSignature(pg, pg.locator('canvas'));

      const signed = pg.waitForResponse(
        (r) => r.url().includes(`/portal/${token}/contracts/${cid}/sign`) && r.request().method() === 'POST',
      );
      await pg.getByRole('button', { name: 'Sign contract' }).click();
      const resp = await signed;
      expect(resp.status(), await resp.text()).toBe(201);
      await expect(pg.getByText('You have signed this contract.')).toBeVisible({ timeout: 30_000 });

      // DB: tenant signature attributed to the tenant's own user account.
      const tenant2UserId = Number(readState().tenant2UserId || 0) || dbTenant2UserId();
      expect(
        q(`SELECT role || '|' || method || '|' || signatory_name || '|' || COALESCE(actor_user_id::text,'')
           FROM contract_signatures WHERE tenancy_contract_id=${cid} AND role='tenant'
           ORDER BY id DESC LIMIT 1`),
      ).toBe(`tenant|online|${TENANT2_NAME}|${tenant2UserId}`);
      expect(
        q(`SELECT signature_image IS NOT NULL FROM contract_signatures
           WHERE tenancy_contract_id=${cid} AND role='tenant' ORDER BY id DESC LIMIT 1`),
        'drawn signature image stored',
      ).toBe('t');
    } finally {
      await ctx.close();
    }
  });

  // ── 7. Payments: cheque tagging + PDC confirmation ──────────────────────────

  test('RP marks instalment 1 cleared and confirms PDC collection', async () => {
    const cid = requireContractId();
    const alreadyCleared = Number(
      q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND cheque_status='cleared'`),
    );
    const pdcDone = q(`SELECT pdc_confirmed FROM tenancy_contracts WHERE id=${cid}`) === 't';

    await openV2(page, cid);
    // Sign step is complete now — both names on file (must select the Sign
    // waypoint: with signing done the page auto-selects the next open step).
    await selectStep(page, 'Sign');
    await expect(page.locator('.acard').getByRole('heading', { name: 'Both parties have signed.' }))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.acard').getByText(`${TENANT2_NAME} signed`)).toBeVisible();

    // Inline payments section (CEO doctrine: everything on the page, no drawer).
    const paySec = page.locator('.sec').filter({ has: page.getByText('Rental instalments') });
    await expect(paySec.getByText(`Rental Instalment 1 of ${INSTALMENTS}`)).toBeVisible({ timeout: 30_000 });
    await expect(paySec.locator('tbody tr')).toHaveCount(INSTALMENTS);

    if (!alreadyCleared) {
      const patched = page.waitForResponse(
        (r) => r.url().includes(`/contracts/${cid}/payments/`) && r.request().method() === 'PATCH',
      );
      await paySec.locator('tbody select').first().selectOption('cleared');
      const resp = await patched;
      expect(resp.ok(), `PATCH payment status → ${resp.status()}`).toBe(true);
      expect(
        q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND cheque_status='cleared'`),
      ).toBe('1');
    }

    if (!pdcDone) {
      // Confirm PDC is only legal while the contract is ISSUED.
      expect(contractStatus(cid), 'PDC confirmation happens pre-activation').toBe('issued');
      const confirmed = page.waitForResponse(
        (r) => r.url().includes(`/contracts/${cid}/confirm-pdc`) && r.request().method() === 'PATCH',
      );
      await page.getByRole('button', { name: /Confirm PDC received/ }).click();
      const resp = await confirmed;
      expect(resp.ok(), `PATCH confirm-pdc → ${resp.status()}`).toBe(true);
    }

    await expect(page.getByText(/PDC collection confirmed/)).toBeVisible({ timeout: 30_000 });
    expect(q(`SELECT pdc_confirmed FROM tenancy_contracts WHERE id=${cid}`)).toBe('t');
  });

  // ── 8. Activate ──────────────────────────────────────────────────────────────

  test('RP activates the tenancy from the Active step', async () => {
    const cid = requireContractId();
    test.skip(contractStatus(cid) === 'active', 're-run: contract already active');

    await openV2(page, cid);
    // Jump to the Active waypoint — Ejari/Utility/Move-in are deliberately left
    // open (the product allows "go live now, backfill later").
    await selectStep(page, 'Active');
    await expect(page.getByRole('heading', { name: 'Activate the tenancy.' })).toBeVisible();
    await expect(page.getByText('Still open')).toBeVisible(); // ejari / utility / move-in

    const activated = page.waitForResponse(
      (r) => r.url().includes(`/contracts/${cid}/activate`) && r.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Activate tenancy now' }).click();
    const resp = await activated;
    expect(resp.ok(), `PATCH activate → ${resp.status()}`).toBe(true);

    // The step card flips to the live-tenancy management surface.
    await expect(page.getByRole('heading', { name: 'This tenancy is live.' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Record payment' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request termination' })).toBeVisible();
  });

  // ── 9. Post-activation invariants (always run) ──────────────────────────────

  test('verification: contract active, unit 118 occupied + delisted, instalments + rent history on file', async () => {
    const cid = requireContractId();

    expect(
      q(`SELECT status || '|' || contract_active FROM tenancy_contracts WHERE id=${cid}`),
    ).toBe('active|true');

    // Activation flips the unit to occupied and pulls it off the listings.
    expect(
      q(`SELECT availability || '|' || is_listed FROM units WHERE id=${UNIT3_ID}`),
    ).toBe('occupied|false');

    // Instalment schedule exists, with the cheque we cleared.
    expect(
      q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND payment_type='rental_income'`),
    ).toBe(String(INSTALMENTS));
    expect(
      Number(q(`SELECT count(*) FROM payments WHERE tenancy_contract_id=${cid} AND cheque_status='cleared'`)),
    ).toBeGreaterThanOrEqual(1);

    // Both parties signed exactly once.
    expect(sigCount(cid, 'landlord')).toBe(1);
    expect(sigCount(cid, 'tenant')).toBe(1);

    // Activation opens a unit_rent_history row for this contract, and the
    // unit's listed price is re-anchored to the contracted rent.
    expect(
      Number(q(`SELECT count(*) FROM unit_rent_history WHERE contract_id=${cid}`)),
    ).toBeGreaterThanOrEqual(1);
    expect(Number(q(`SELECT rental_price::float8 FROM units WHERE id=${UNIT3_ID}`))).toBe(
      Number(q(`SELECT annual_rent::float8 FROM tenancy_contracts WHERE id=${cid}`)),
    );
  });

  // ── 10. Customer side: the inline tenant HAS a login ────────────────────────

  test('customer logs in (email OTP) and sees the active contract under /dashboard/customer/contracts', async ({ browser }) => {
    const cid = requireContractId();
    // The inline wizard customer is NOT account-less: POST /contracts/tenants
    // provisions an active customer user, so the OTP login works directly.
    const ctx = await browser.newContext();
    try {
      const pg = await ctx.newPage();
      await safeLoginViaUi(pg, tenant2Email);
      await pg.goto('/dashboard/customer/contracts');

      const card = pg.locator(`a[href="/dashboard/customer/contracts/${cid}"]`);
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(card.getByText(`CID-${cid}`)).toBeVisible();
      await expect(card.getByText('Active', { exact: true })).toBeVisible();
      await expect(card.getByText(`Unit ${UNIT3_NUMBER}`)).toBeVisible();
      // Money: list shows WHOLE-AED annual rent (regex — value is per-run).
      await expect(card.getByText(/AED\s?[\d,]+\s?\/\s?year/)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  // ── 11. Print page renders ───────────────────────────────────────────────────

  test('contract print page renders the filled Dubai tenancy PDF', async () => {
    const cid = requireContractId();
    await page.goto(`/rental-provider/dashboard/contracts/${cid}/print`);
    // Dubai contract → pdf-lib fills the official DLD template and serves it in
    // an iframe (template + font fetch can take a while on first compile).
    await expect(page.locator('iframe[title="Tenancy Contract"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Failed to load contract')).toHaveCount(0);
  });

  // ── 12. Idempotent reload: state survives, workflow is frozen ───────────────

  test('idempotent reload: v2 shows both signatures + active state; rollback affordances are frozen', async () => {
    const cid = requireContractId();
    await openV2(page, cid);
    const acard = page.locator('.acard');

    // Sign step: both rows on, and post-activation the checkrows are LOCKED —
    // no Undo buttons that could silently un-sign the record.
    await selectStep(page, 'Sign');
    await expect(acard.getByRole('heading', { name: 'Both parties have signed.' })).toBeVisible({ timeout: 30_000 });
    await expect(acard.getByText(`${TENANT2_NAME} signed`)).toBeVisible();
    await expect(acard.getByText('Landlord signed')).toBeVisible();
    await expect(acard.getByRole('button', { name: 'Undo' })).toHaveCount(0);
    // The tenant signing-link block is gone too (workflow frozen).
    await expect(page.getByText('Customer contract signing link')).toHaveCount(0);

    // Issue step: complete, and the dead "Revert to draft" (BUG-24) is now
    // hidden entirely because the lifecycle is terminal.
    await selectStep(page, 'Issue');
    await expect(acard.getByRole('heading', { name: 'Contract issued.' })).toBeVisible();
    await expect(acard.getByRole('button', { name: 'Revert to draft' })).toHaveCount(0);

    // Active step: live-tenancy management remains available.
    await selectStep(page, 'Active');
    await expect(acard.getByRole('heading', { name: 'This tenancy is live.' })).toBeVisible();
    await expect(acard.getByRole('button', { name: 'Record payment' })).toBeVisible();

    // Header still attributes the RP's signature after a cold load.
    await expect(page.getByText('You signed')).toBeVisible();
  });
});
