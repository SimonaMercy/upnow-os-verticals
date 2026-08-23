/**
 * Contract documents binder — the Emirates ID always reads as a fixed pair.
 *
 * Customer 125 (contract 360) holds the two faces (`emirates_id_front` / `_back`)
 * plus a spare bare `emirates_id` capture. There is no "combined" shape: a bare
 * `emirates_id` is a FRONT, exactly as the customer's own profile files it. The
 * pane reads Front, then Back, always — a face nobody uploaded is an empty
 * position, never the other face standing in for both.
 *
 * Case 2 hides both the back face and the e-copy, leaving only a front: the Back
 * position must hold a placeholder that points at the customer profile, NOT the
 * front sliding up into it. Both documents are restored in `finally`.
 *
 * Read-only against the local prod-clone apart from that one reversible hide.
 * Untracked; mirrored to the session scratchpad.
 */
import { execFileSync } from 'node:child_process';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'kbaalfalasi@gmail.com';
const CONTRACT_ID = 360;
const TENANT_ID = 125;
const SHOTS = 'e2e/__shots__/binder-eid';

/** Guarded psql against the local clone ONLY — it aborts on any other database. */
function sql(statement: string) {
  execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: `
      BEGIN;
      DO $$ BEGIN
        IF current_database() <> 'upnow_prod_clone' THEN
          RAISE EXCEPTION 'refusing to run against %', current_database();
        END IF;
      END $$;
      ${statement}
      COMMIT;
    `,
  });
}
/** Read a value back out of the clone. */
const query = (statement: string): string =>
  execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-At', '-c', statement]).toString().trim();

// Hide by soft-deleting — the API rebuilds `fileUrl` from `s3_key`, so blanking the
// URL column does NOT take a document off the page. Restore clears `deleted_at`
// again; the partial unique index on (owner, key) has nothing to collide with,
// since no new active row for those keys is created in between.
const activeState = (ids: number[]): string =>
  query(`SELECT id || '|' || (deleted_at IS NULL) FROM documents WHERE id IN (${ids.join(',')}) ORDER BY id`);
const hideDocs = (ids: number[]) => sql(`UPDATE documents SET deleted_at = now() WHERE id IN (${ids.join(',')});`);
const restoreDocs = (ids: number[]) => sql(`UPDATE documents SET deleted_at = NULL WHERE id IN (${ids.join(',')});`);

/**
 * Which Emirates ID rows this customer holds RIGHT NOW, by shape. Discovered
 * rather than hard-coded: the clone is a live dev database — uploading through
 * the app, replacing a copy or clearing one all change the ids under the spec,
 * and a pinned id turns a passing test into a fixture error. Only the SHAPES
 * matter to what is being tested.
 */
const eidDocs = (tenantId: number): { front?: number; back?: number; combined?: number } => {
  const rows = query(
    `SELECT regexp_replace(document_key, '_[0-9]{6,}$', ''), id
       FROM documents
      WHERE owner_type = 'customer' AND owner_id = ${tenantId}
        AND deleted_at IS NULL AND COALESCE(file_url, '') <> ''
        AND document_key LIKE 'emirates_id%'
      ORDER BY id`).split('\n').filter(Boolean);
  const out: { front?: number; back?: number; combined?: number } = {};
  for (const row of rows) {
    const [key, id] = row.split('|');
    if (key.endsWith('_front')) out.front = Number(id);
    else if (key.endsWith('_back') || /_2$/.test(key)) out.back = Number(id);
    else out.combined = Number(id);
  }
  return out;
};

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing — is EXPOSE_DEV_OTP on locally?').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  return ((await r2.json()) as { access_token: string }).access_token;
}
const setCookie = (page: Page, token: string) =>
  page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

/** The left pane's quick-nav chips, in render order. A chip for a REQUIRED
 *  document that is not on file is prefixed "⚠ " — `leftNavLabels` strips it,
 *  `missingChips` returns exactly those. */
const rawNav = (page: Page) => page.locator('section').first().locator('button').allInnerTexts();
const leftNavLabels = async (page: Page) => (await rawNav(page)).map(l => l.replace(/^⚠\s*/, ''));
const missingChips = async (page: Page) =>
  (await rawNav(page)).filter(l => l.startsWith('⚠')).map(l => l.replace(/^⚠\s*/, ''));

const openBinder = async (page: Page, contractId: number = CONTRACT_ID) => {
  await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${contractId}/documents`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Tenant & KYC')).toBeVisible();
  // Every preview canvas has painted — a card whose file cannot be drawn (the
  // front is a PNG, the e-copy a PDF) would still read "Loading…" here.
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30000 });
};

test('Emirates ID renders Front then Back, and a genuinely missing side is a placeholder', async ({ page, request }) => {
  const token = await loginOtp(request, RP_EMAIL);
  await setCookie(page, token);

  // ── Case 1: both faces on file (plus a redundant e-copy) ────────────────
  await openBinder(page);
  const nav = await leftNavLabels(page);
  expect(nav).toEqual(['Emirates ID — Front', 'Emirates ID — Back', 'Passport', 'UAE Visa / Residency']);
  // The ambiguous bare caption is gone, and the third copy no longer renders.
  expect(nav.filter(l => l === 'Emirates ID')).toHaveLength(0);
  // Nothing is missing here, so nothing is flagged.
  expect(await missingChips(page)).toEqual([]);
  await expect(page.getByText(/documents? missing/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-front-back-pair.png`, fullPage: false });

  // ── Case 2: no back face anywhere → placeholder in the Back position ────
  // Everything that could satisfy the BACK is taken off file: the back face and,
  // if the customer has one, the combined e-copy that contains it.
  const eids = eidDocs(TENANT_ID);
  expect(eids.front, 'fixture needs a front face on file').toBeTruthy();
  const hidden = [eids.back, eids.combined].filter((id): id is number => id != null);
  expect(hidden.length, 'fixture needs a back face (or an e-copy) to take away').toBeGreaterThan(0);
  const before = activeState(hidden);
  try {
    hideDocs(hidden);
    await openBinder(page);
    const nav2 = await leftNavLabels(page);
    expect(nav2.slice(0, 2)).toEqual(['Emirates ID — Front', 'Emirates ID — Back']);
    // Highlighted: the chip is flagged, the card reads "missing · required", and
    // the pane header counts it.
    expect(await missingChips(page)).toEqual(['Emirates ID — Back']);
    await expect(page.getByText('— missing · required')).toBeVisible();
    await expect(page.getByText('1 document missing')).toBeVisible();
    await expect(page.getByRole('link', { name: /Upload from profile/ }))
      .toHaveAttribute('href', `/rental-provider/dashboard/tenants/${TENANT_ID}`);
    await page.screenshot({ path: `${SHOTS}/02-missing-back.png`, fullPage: false });
  } finally {
    restoreDocs(hidden);
  }
  // The fixture is exactly as it was found.
  expect(activeState(hidden)).toBe(before);
});

/**
 * A company tenant's pack leads with the company's OWN papers, and every KYC
 * document is in this pane — the MOA and the power-of-attorney ID used to fall
 * through to "Other documents" on the right.
 *
 * 393 = O H L CONTRACTING L.L.C: trade licence, MOA, both EID faces, POA ID.
 * 367 = SILVER TEA OF DAY CAFETERIA L.L.C: no MOA (placeholder), passport + visa,
 *       and TWO POA IDs.
 */
test('a company reads Trade License · MOA · Authorised Signatory Emirates ID · rest', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));

  await openBinder(page, 393);
  expect(await leftNavLabels(page)).toEqual([
    'Trade License',
    'Memorandum of Association (MOA)',
    'Authorised Signatory Emirates ID — Front',
    'Authorised Signatory Emirates ID — Back',
    'Passport',
    'UAE Visa / Residency',
    'POA holder — Emirates ID',
  ]);
  // A company is identified by its licence, so the signatory's passport and visa
  // are optional — absent, they are shown quietly, not flagged as a gap.
  expect(await missingChips(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/03-company-pack.png` });

  // No MOA on file → its slot still holds its position, flagged optional. The two
  // POA copies are numbered rather than repeating one caption twice.
  await openBinder(page, 367);
  expect(await leftNavLabels(page)).toEqual([
    'Trade License',
    'Memorandum of Association (MOA)',
    'Authorised Signatory Emirates ID — Front',
    'Authorised Signatory Emirates ID — Back',
    'Passport',
    'UAE Visa / Residency',
    'POA holder — Emirates ID',
    'POA holder — Emirates ID — 2',
  ]);
  await expect(page.getByText('— missing · optional')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-company-missing-moa.png` });
});

/**
 * Every customer-KYC document lives in this pane. Contract 354 (individual) holds
 * a combined EID e-copy, passport, visa, a guarantor undertaking and three
 * dependant documents — the last four used to sit in "Other documents", and the
 * dependant papers were dropped from the binder entirely.
 *
 * Its bank statement and marriage certificate are NOT KYC and must stay on the
 * right — 354 is a renewal, where those slots are dropped and both land under
 * "Other documents"; either way they never join the KYC pane.
 */
test('the KYC pane holds every customer-KYC document, and only those', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));

  await openBinder(page, 354);
  expect(await leftNavLabels(page)).toEqual([
    // Only a bare `emirates_id` on file — that key IS the front (same rule as the
    // customer profile), so the BACK holds its own empty position rather than the
    // one scan being captioned as though it showed both faces.
    'Emirates ID — Front',
    'Emirates ID — Back',
    'Passport',
    'UAE Visa / Residency',
    // Supporting docs close the CUSTOMER's pack; this lease is a renewal, so its
    // income document is deliberately absent (re-verification stays on the
    // original lease). The other parties' papers follow.
    'Bank Statement',
    'Marriage Certificate',
    'Undertaking from Guarantor',
    'Dependant Documents',
    'Dependant Documents — 2',
    'Dependant Documents — 3',
  ]);
  // Nothing about the CUSTOMER is left in the rental pack on the right.
  const right = await page.locator('section').nth(1).locator('button').allInnerTexts();
  expect(right.filter(l => /Dependant|Guarantor|Emirates ID|Passport|Visa|Bank Statement|Marriage/.test(l))).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/05-full-kyc-pack.png` });
});

/**
 * The binder is a full-screen takeover, and in the MANAGER portal it was not on
 * top: the sticky "Acting for" scope bar (z-index 40) painted straight over it,
 * covering the first row of jump chips in BOTH panes — the reader saw two of the
 * four KYC keys and none of the rental ones. `toBeVisible` cannot catch that (the
 * chips are laid out and painted, just underneath), so this asks the browser what
 * is actually at the chip's centre.
 */
test('the manager scope bar does not cover the binder', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, 'sheco1300@yahoo.com'));
  await page.goto(`http://localhost:3000/dashboard/manager/contracts/${CONTRACT_ID}/documents?rp=2`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.mgr-scopebar')).toHaveCount(1); // the bar IS on this page

  for (const label of ['Emirates ID — Front', 'Payment plan', 'Agreement']) {
    const chip = page.getByRole('button', { name: label }).first();
    const box = (await chip.boundingBox())!;
    expect(box, `${label} has no box`).toBeTruthy();
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return { tag: el?.tagName ?? '', text: (el?.textContent ?? '').trim().slice(0, 40), inBar: !!el?.closest('.mgr-scopebar') };
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit.inBar, `${label} is behind the scope bar`).toBe(false);
    expect(hit.text, `${label} is covered by something else`).toContain(label);
  }
});

/**
 * Salary certificate, bank statement and marriage certificate describe the
 * CUSTOMER, not the tenancy. They were slots in the rental pack, which filed a
 * payslip among the lease's own paperwork; they now close the KYC pane under
 * their own heading (landlord's call, 11 Aug 2026).
 *
 * Contract 364 holds all three (its salary certificate is filed as
 * `employment_letter`, the journey's wording) plus four occupants.
 */
test('supporting documents close the KYC pane instead of sitting in the rental pack', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));
  await openBinder(page, 364);

  // The customer's pack is whole and first — identity, then what backs it — and
  // only then the dependants (the keys call them occupants and start at 2; the
  // pane numbers them 1..N).
  const left = await leftNavLabels(page);
  expect(left).toEqual([
    'Emirates ID — Front', 'Emirates ID — Back', 'Passport', 'UAE Visa / Residency',
    'Salary Certificate', 'Bank Statement', 'Marriage Certificate',
    'Dependant 1', 'Dependant 2', 'Dependant 3', 'Dependant 4',
  ]);

  const right = await page.locator('section').nth(1).locator('button').allInnerTexts();
  for (const gone of ['Salary Certificate', 'Bank Statement', 'Marriage Certificate']) {
    expect(right, `${gone} must not be in the rental pack`).not.toContain(gone);
  }
  // The lease's own utility proof stays on the right.
  expect(right).toContain('Utility Proof of Payment');
  // Nothing fell through to the loose bin on the way.
  expect(right).not.toContain('Other documents');
});

/**
 * "Other documents" — anything filed against the lease with no named slot — used
 * to be hidden on the no-login landlord view. It holds real contract paperwork
 * (contract 360 carries an NOC), and hiding it meant a document uploaded ONTO the
 * lease was invisible to the party being asked to sign it.
 */
test('the landlord portal shows the same binder sections as the RP view', async ({ page, request }) => {
  await setCookie(page, await loginOtp(request, RP_EMAIL));
  await openBinder(page, CONTRACT_ID);
  const rp = await page.locator('section').nth(1).locator('button').allInnerTexts();
  expect(rp, 'fixture needs a document in the loose bin').toContain('Other documents');

  const token = query(
    `SELECT token FROM tenant_portal_tokens
      WHERE tenancy_contract_id = ${CONTRACT_ID} AND revoked = false
      ORDER BY id DESC LIMIT 1`);
  expect(token, 'fixture needs a live portal token').toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`http://localhost:3000/portal/${token}/contract/${CONTRACT_ID}`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
  const portal = await page.locator('section').nth(1).locator('button').allInnerTexts();
  expect(portal).toEqual(rp);
});
