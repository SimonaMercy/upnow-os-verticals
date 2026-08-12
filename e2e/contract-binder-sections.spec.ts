/**
 * SCRUM-789 — the RP decides a document's SECTION, and the section decides where
 * the document LIVES.
 *
 *   Customer KYC → filed against the customer (owner_type 'customer'), so it
 *                  shows in the profile's KYC cards AND in every lease binder of
 *                  theirs.
 *   Tenancy      → filed against the lease, so it shows on that lease only, and
 *                  on the profile under "History Documents".
 *
 * The catalogue still carries a per-type DEFAULT, but it is only what the upload
 * form pre-selects; `documents.section` (migration 0204) holds the actual answer
 * and always wins. Rows predating the column stay NULL and keep resolving from
 * the default, then from the binder's historic key matchers — which is why the
 * load-bearing assertion here is a NEGATIVE one: over the five contracts the
 * ticket names, nothing moved pane.
 *
 * Read-only against the local prod-clone apart from one reversible re-file,
 * restored in `finally`.
 */
import { execFileSync } from 'node:child_process';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const RP_EMAIL = 'kbaalfalasi@gmail.com';
const SHOTS = 'e2e/__shots__/binder-sections';
/** The contracts named in the ticket's acceptance: 364 is a new lease, the rest
 *  are renewals at three different stages (active / issued / pending). */
const CONTRACTS = [360, 364, 367, 393, 354];

/** Read-only psql against the local clone ONLY. */
const query = (sql: string): string =>
  execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-At', '-c', sql]).toString().trim();

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing — is EXPOSE_DEV_OTP on locally?').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  return ((await r2.json()) as { access_token: string }).access_token;
}
const setCookie = (page: Page, token: string) =>
  page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

const navLabels = async (page: Page, pane: 0 | 1) =>
  (await page.locator('section').nth(pane).locator('button').allInnerTexts()).map(l => l.replace(/^⚠\s*/, '').trim());

const openBinder = async (page: Page, contractId: number) => {
  await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${contractId}/documents`);
  await expect(page.getByText('All documents')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Tenant & KYC')).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30000 });
};

/** Wording that describes the CUSTOMER. A chip reading any of this on the right
 *  is a KYC document that fell out of the pane it belongs to. */
const KYC_WORDING = /Emirates ID|Passport|Visa|Dependant|Guarantor|Partner|Third party|POA holder|Trade License|Memorandum|Bank Statement|Salary|Marriage|Labour|Establishment/i;
/** Wording that belongs to the LEASE. A chip reading any of this on the left is
 *  tenancy paperwork that wandered into the customer's pack. */
const TENANCY_WORDING = /Payment plan|Payment Confirmation|Receipts|Agreement|Contract Registration|Utility|Move-out|Final Settlement|Other documents/i;

test.describe('nothing already on file moved', () => {
  for (const id of CONTRACTS) {
    test(`contract ${id} — every document still reads on the side it always did`, async ({ page, request }) => {
      await setCookie(page, await loginOtp(request, RP_EMAIL));
      await openBinder(page, id);

      const left = await navLabels(page, 0);
      const right = await navLabels(page, 1);
      // Both panes render. A binder that silently emptied one side would still
      // satisfy the two cross-checks below, so assert the content exists first.
      expect(left.length, `contract ${id} KYC pane is empty`).toBeGreaterThan(0);
      expect(right, `contract ${id} rental pane is empty`).toContain('Payment plan');

      expect(right.filter(l => KYC_WORDING.test(l)),
        `contract ${id}: customer documents leaked into the rental pane`).toEqual([]);
      expect(left.filter(l => TENANCY_WORDING.test(l)),
        `contract ${id}: lease paperwork leaked into the KYC pane`).toEqual([]);

      await page.screenshot({ path: `${SHOTS}/binder-${id}.png`, fullPage: false });
    });
  }

  test('every document on the five contracts is still undeclared', async () => {
    // 0204 adds the column with NO backfill: the guarantee above holds because
    // nothing has a stored section yet, so every row still resolves from the
    // catalogue default and the key matchers. If a future migration backfills
    // this, the assertions above stop testing what they claim to.
    const declared = query(
      `SELECT count(*) FROM documents WHERE section IS NOT NULL AND deleted_at IS NULL
         AND (owner_type = 'tenancy_contract' AND owner_id IN (${CONTRACTS.join(',')}))`);
    expect(declared).toBe('0');
  });

  /**
   * A name with no slot of its own still lands in "Other documents" rather than
   * being guessed onto a pane. 354 and 360 carry the two `legal` edge cases in
   * real data — an undertaking and an NOC. `legal` defaults to KYC (a POA, an MOA
   * and a marriage certificate are all legal papers about the customer), so
   * without the explicit override on those two entries these would have jumped
   * into the customer's pack.
   */
  // 354's guarantor also files an "Undertaking from Guarantor", which correctly
  // reads in the KYC pane — so match the letter by its full name.
  for (const [id, doc] of [[354, /Undertaking Letter/i], [360, /NOC|No Objection/i]] as const) {
    test(`contract ${id} — a document with no named slot stays in "Other documents"`, async ({ page, request }) => {
      await setCookie(page, await loginOtp(request, RP_EMAIL));
      await openBinder(page, id);

      expect(await navLabels(page, 1)).toContain('Other documents');
      const other = page.locator('#r-other');
      await expect(other).toHaveCount(1);
      const text = await other.innerText();
      expect(text, `contract ${id}: the loose document is not in the bin`).toMatch(doc);
      expect(KYC_WORDING.test(text)).toBe(false);
      expect((await navLabels(page, 0)).filter(l => doc.test(l))).toEqual([]);
    });
  }
});

test.describe('the upload form asks where the document goes', () => {
  /** The Documents card's own header — the checklist rows below it carry their
   *  own "Upload" buttons, so an unscoped one matches several. */
  const docsHeader = (page: Page) => page.locator('.sech').filter({ hasText: /Documents \(/ });
  const openUpload = async (page: Page, id: number) => {
    await page.goto(`http://localhost:3000/rental-provider/dashboard/contracts/${id}/v2`);
    await expect(docsHeader(page)).toBeVisible({ timeout: 30000 });
    await docsHeader(page).getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Upload a document')).toBeVisible();
  };

  test('the document type is searchable and grouped by section', async ({ page, request }) => {
    await setCookie(page, await loginOtp(request, RP_EMAIL));
    await openUpload(page, 364);

    const combo = page.getByTestId('up-doctype');
    const menu = page.locator('#v2-doctype-menu');
    await combo.click();
    // Browsing with an empty query shows both groups. Scoped to the menu: the
    // "File under" control below carries the same two words.
    await expect(menu.getByText('Customer KYC', { exact: true })).toBeVisible();
    await expect(menu.getByText('Tenancy documents', { exact: true })).toBeVisible();

    // Searching narrows it — the point of the change, with ~60 types on the list.
    await combo.fill('passp');
    const shown = await menu.locator('button').allInnerTexts();
    expect(shown.map(s => s.trim())).toEqual(
      expect.arrayContaining(['Passport', 'Passport-size Photo', 'Third Party Passport']));
    expect(shown.some(s => /Payment Confirmation/.test(s))).toBe(false);
    await page.screenshot({ path: `${SHOTS}/upload-type-search.png` });

    // A query matching only lease paperwork drops the KYC heading entirely.
    await combo.fill('cheque');
    await expect(menu.getByText('Customer KYC', { exact: true })).toHaveCount(0);
    await expect(menu.getByText('Tenancy documents', { exact: true })).toBeVisible();
  });

  test('picking a type pre-selects its section, and the RP can override it', async ({ page, request }) => {
    await setCookie(page, await loginOtp(request, RP_EMAIL));
    await openUpload(page, 364);

    const combo = page.getByTestId('up-doctype');
    const kyc = page.getByTestId('up-section-kyc');
    const tenancy = page.getByTestId('up-section-tenancy');

    // A passport defaults to the customer's pack…
    await combo.click();
    await combo.fill('Passport');
    await page.locator('#v2-doctype-menu').getByRole('button', { name: 'Passport', exact: true }).click();
    await expect(kyc).toBeChecked();

    // …and the RP can still say this one belongs to the lease.
    await tenancy.check();
    await expect(tenancy).toBeChecked();
    await expect(page.getByText(/rather than the usual Customer KYC for Passport/)).toBeVisible();

    // A deliberate choice survives changing the document type — otherwise the
    // pre-select would silently undo what they just said.
    await combo.click();
    await combo.fill('Emirates ID');
    await page.locator('#v2-doctype-menu').getByRole('button', { name: 'Emirates ID', exact: true }).click();
    await expect(tenancy).toBeChecked();

    // A lease document defaults the other way in a fresh form.
    await page.reload();
    await docsHeader(page).getByRole('button', { name: 'Upload' }).click();
    await combo.click();
    await combo.fill('Contract Registration');
    await page.locator('#v2-doctype-menu').getByRole('button', { name: 'Contract Registration Certificate', exact: true }).click();
    await expect(page.getByTestId('up-section-tenancy')).toBeChecked();
    await page.screenshot({ path: `${SHOTS}/upload-form-arranged.png` });
  });

  test('the document name is free text, defaulting to the type', async ({ page, request }) => {
    await setCookie(page, await loginOtp(request, RP_EMAIL));
    await openUpload(page, 364);

    const combo = page.getByTestId('up-doctype');
    await combo.click();
    await combo.fill('NOC');
    await page.locator('#v2-doctype-menu').getByRole('button', { name: 'NOC (No Objection Certificate)', exact: true }).click();

    const name = page.getByTestId('up-docname');
    await expect(name).toHaveValue('');
    await expect(page.getByText(/Leave the name blank to file it as .NOC \(No Objection Certificate\)./)).toBeVisible();
    // One catalogue type, many real documents — Vehicle NOC vs Property NOC.
    await name.fill('Vehicle NOC');
    await expect(page.getByText('Filed as Vehicle NOC.')).toBeVisible();
  });
});

test.describe('the request picker states the section too', () => {
  test('grouped, and the headings follow the filter', async ({ page, request }) => {
    await setCookie(page, await loginOtp(request, RP_EMAIL));
    await page.goto('http://localhost:3000/rental-provider/dashboard/contracts/364/v2');
    const docsHeader = page.locator('.sech').filter({ hasText: /Documents \(/ });
    await expect(docsHeader).toBeVisible({ timeout: 30000 });
    await docsHeader.getByRole('button', { name: 'Request' }).click();
    await expect(page.getByText(/Request documents from/)).toBeVisible();

    const search = page.getByPlaceholder('Search or type a document name, Enter to add…');
    await search.click();
    await expect(page.getByText('Customer KYC', { exact: true })).toBeVisible();
    await expect(page.getByText('Tenancy documents', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Passport', exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/request-picker-grouped.png` });

    await search.fill('cheque');
    await expect(page.getByText('Customer KYC', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Tenancy documents', { exact: true })).toBeVisible();
  });
});

/**
 * Re-filing MOVES the document, which is the part that is easy to get wrong: the
 * row changes owner, so it leaves one lease and joins the customer's pack. This
 * drives the real button and checks the real consequence on the profile.
 */
test('a re-filed document moves to the customer and back', async ({ page, request }) => {
  const token = await loginOtp(request, RP_EMAIL);
  await setCookie(page, token);

  // Contract 360's NOC: on file, in "Other documents", undeclared.
  const docId = Number(query(
    `SELECT id FROM documents WHERE owner_type = 'tenancy_contract' AND owner_id = 360
       AND document_key LIKE 'noc%' AND deleted_at IS NULL LIMIT 1`));
  expect(docId, 'contract 360 should still hold the NOC this test moves').toBeGreaterThan(0);
  const before = query(`SELECT owner_type || '|' || owner_id || '|' || COALESCE(section::text, 'NULL') FROM documents WHERE id = ${docId}`);
  expect(before).toBe('tenancy_contract|360|NULL');

  try {
    await openBinder(page, 360);
    const other = page.locator('#r-other');
    await other.getByRole('button', { name: /Move to Customer KYC/ }).first().click();

    // It leaves the loose bin and joins the customer's pack, in the same binder.
    await expect(other.getByText(/NOC/)).toHaveCount(0, { timeout: 15000 });
    expect(query(`SELECT owner_type || '|' || owner_id || '|' || section FROM documents WHERE id = ${docId}`))
      .toBe('customer|125|kyc');

    // And — the point of the whole change — it is now on the customer's profile,
    // in the KYC section rather than under History Documents.
    await page.goto('http://localhost:3000/rental-provider/dashboard/tenants/125');
    await expect(page.getByText(/NOC/).first()).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}/refiled-on-profile.png` });
  } finally {
    // Put it back exactly as found: owner, lease and an undeclared section.
    await request.patch(`${BACKEND}/documents/${docId}/section`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { section: 'tenancy', contractId: 360 },
    });
    execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-q', '-c',
      `UPDATE documents SET section = NULL WHERE id = ${docId}`]);
    expect(query(`SELECT owner_type || '|' || owner_id || '|' || COALESCE(section::text, 'NULL') FROM documents WHERE id = ${docId}`))
      .toBe(before);
  }
});
