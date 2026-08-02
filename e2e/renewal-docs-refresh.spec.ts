/**
 * Renewal "Quick paperwork refresh" — the customer step, end to end.
 *
 * Covers the four defects reported against it:
 *   1. A replaced copy stayed amber/"Replace" forever. The customer cannot set an
 *      expiry date (the API ignores a customer-supplied one by design), so a copy
 *      flagged only for a missing expiry is the RP's to clear — it must read green.
 *   2. Emirates ID was asked for as ONE combined file; every other surface collects
 *      it as two slots, Front and Back.
 *   3. Refreshing a document filed under a legacy key (`visa`) wrote a NEW key
 *      (`uae_visa`), leaving the same document on file twice.
 *   4. There was no submit control at all — once everything was refreshed the step
 *      simply sat there with nothing to press.
 *
 * Runs against the local prod-clone fixture (renewal 363, tenant 94), which it
 * MUTATES — it replaces the visa document and stamps the submission. resetFixture()
 * below puts both back before each run, so the spec is repeatable.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { execFileSync } from 'node:child_process';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/** Put the visa document and the submission stamp back the way they were. Pinned to
 *  the local prod-clone by name — the guard aborts rather than touch anything else. */
function resetFixture() {
  execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], {
    input: `
      BEGIN;
      DO $$ BEGIN
        IF current_database() <> 'upnow_prod_clone' THEN
          RAISE EXCEPTION 'refusing to run against %', current_database();
        END IF;
      END $$;
      -- Visa: genuinely expired, so the customer owes a fresh copy.
      UPDATE documents SET
        status='expired', expiry_date='2026-01-15', mime_type='application/pdf', display_name='Visa',
        s3_key='kyc/customer/94/visa/attZ1af1o6nY55SYd.pdf',
        file_url='https://storage.googleapis.com/upnow-uploads-upnow-application/kyc/customer/94/visa/attZ1af1o6nY55SYd.pdf'
      WHERE id=1546;
      -- Emirates ID: a single legacy COMBINED scan, on file but undated — so it is the
      -- RP's to date, not the customer's to replace. Drop any side rows a previous run
      -- created so the fixture starts back at "combined only".
      UPDATE documents SET status='attached', expiry_date=NULL, deleted_at=NULL WHERE id=2383;
      DELETE FROM documents
       WHERE owner_type='customer' AND owner_id=94
         AND document_key IN ('emirates_id_front','emirates_id_back');
      UPDATE tenancy_contracts SET renewal_docs_submitted_at=NULL WHERE id=363;
      COMMIT;
    `,
    stdio: ['pipe', 'ignore', 'inherit'],
  });
}

test.beforeAll(resetFixture);

const BACKEND = 'http://localhost:3001/api';
const EMAIL = 'shafioptom@gmail.com';
const RP_EMAIL = 'kbaalfalasi@gmail.com';
const SHOTS = 'e2e/__shots__/renewal-docs';
const RENEWAL_ID = 363;

async function loginOtp(request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  return ((await r2.json()) as { access_token: string }).access_token;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const setCookie = (page: Page, token: string) =>
  page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);

type Doc = { id: number; documentKey: string; status?: string; expiryDate?: string | null; fileUrl?: string | null };
const myDocs = async (request: APIRequestContext, token: string): Promise<Doc[]> =>
  ((await (await request.get(`${BACKEND}/documents/my`, { headers: auth(token) })).json()) as { documents: Doc[] }).documents;

const renewal = async (request: APIRequestContext, token: string) =>
  ((await (await request.get(`${BACKEND}/contracts/tenant`, { headers: auth(token) })).json()) as Record<string, unknown>[])
    .find(c => c.id === RENEWAL_ID)!;

test('the step reads honestly, splits the Emirates ID, and can be submitted', async ({ page, request }) => {
  const token = await loginOtp(request, EMAIL);
  await setCookie(page, token);

  // ── The backend must tell the customer WHY each base is flagged ──────────
  const rc = await renewal(request, token);
  expect(rc.expiredKycDocKeys, 'both bases flagged').toEqual(expect.arrayContaining(['emirates_id', 'visa']));
  // Defect 1: the EID is flagged only for a missing expiry — not the customer's to fix.
  expect(rc.kycExpiryMissingKeys).toEqual(['emirates_id']);

  await page.goto('http://localhost:3000/dashboard/customer/spaces/v2/c-107');
  await expect(page.getByText('DOCUMENTS TO REFRESH')).toBeVisible({ timeout: 20000 });

  // Defect 2: Emirates ID is two slots, matching KYC_DOCS everywhere else.
  await expect(page.getByText('Emirates ID — Front')).toBeVisible();
  await expect(page.getByText('Emirates ID — Back')).toBeVisible();

  // Defect 1: a copy on file awaiting only the RP's date reads as done, not "Replace me".
  await expect(page.getByText('On file ✓ — your rental provider will confirm its expiry date')).toHaveCount(2);
  // The genuinely-expired visa is the only thing still owed. Every owed row carries
  // the SAME instruction, whatever made it owed.
  await expect(page.getByText('Upload new copy')).toHaveCount(1);

  // Defect 4: the submit control exists, and is correctly held until the visa is in.
  const submit = page.getByRole('button', { name: /Submit for review/i });
  await expect(submit).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/1-outstanding.png`, fullPage: true });

  // ── Refresh the visa through the real upload path ────────────────────────
  const before = await myDocs(request, token);
  const visaBefore = before.filter(d => /visa/i.test(d.documentKey));
  expect(visaBefore.map(d => d.documentKey), 'starts on the legacy key').toEqual(['visa']);

  // ── Replacing ONE side of the Emirates ID must not complete the other ────
  // The base goes "undated" the moment a fresh side lands, and the back row used to
  // borrow the old combined scan as its cover — so a single upload turned both sides
  // green and could carry the whole step to "submitted for review".
  await page.setInputFiles(
    'label:has-text("Emirates ID — Front") input[type=file]',
    { name: 'eid-front.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') },
  );
  await expect(page.locator('label:has-text("Emirates ID — Back")')).toContainText('Upload new copy', { timeout: 20000 });
  await expect(submit, 'one side in, the other still owed').toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/1b-one-eid-side.png`, fullPage: true });

  await page.setInputFiles(
    'label:has-text("Emirates ID — Back") input[type=file]',
    { name: 'eid-back.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') },
  );
  // Both sides in ⇒ the legacy combined scan is fully superseded and retired.
  await expect(page.locator('label:has-text("Emirates ID — Back")')).toContainText('On file ✓', { timeout: 20000 });
  const eidRows = (await myDocs(request, token)).filter(d => /emirates/i.test(d.documentKey));
  expect(eidRows.map(d => d.documentKey).sort(), 'no third, redundant EID row')
    .toEqual(['emirates_id_back', 'emirates_id_front']);

  await page.setInputFiles(
    'label:has-text("UAE Visa / Residency") input[type=file]',
    { name: 'visa.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') },
  );
  // The fresh copy is registered undated, so the reload comes back with the visa in
  // kycExpiryMissingKeys too and all three rows read as done.
  await expect(page.getByText('On file ✓ — your rental provider will confirm its expiry date'))
    .toHaveCount(3, { timeout: 20000 });

  // Defect 3: the refresh REPLACED the legacy row — one visa on file, not two.
  const after = await myDocs(request, token);
  const visaAfter = after.filter(d => /visa/i.test(d.documentKey));
  expect(visaAfter.map(d => d.documentKey), 'still exactly one visa document').toEqual(['visa']);
  expect(visaAfter[0].id, 'same row, replaced in place').toBe(visaBefore[0].id);

  // Defect 4: with everything in, submit unlocks and hands the step over.
  await expect(submit).toBeEnabled();
  await page.screenshot({ path: `${SHOTS}/2-ready.png`, fullPage: true });
  await submit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/2b-submit-button.png`, clip: { x: 676, y: 340, width: 604, height: 380 } });
  await submit.click();
  await expect(page.getByText('Documents submitted for review')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: `${SHOTS}/3-submitted.png`, fullPage: true });

  const done = await renewal(request, token);
  expect(done.renewalDocsSubmittedAt, 'stamp is durable').toBeTruthy();
  // The step must NOT advance on the customer's say-so — only the RP's accept does.
  expect(done.renewalDocsAcceptedAt).toBeNull();

  // ── The RP's side of the same step sees the hand-over ────────────────────
  const rpToken = await loginOtp(request, RP_EMAIL);
  const rpView = await (await request.get(`${BACKEND}/contracts/${RENEWAL_ID}`, { headers: auth(rpToken) })).json() as Record<string, unknown>;
  expect(rpView.renewalDocsSubmittedAt, 'RP is told the customer finished').toBe(done.renewalDocsSubmittedAt);
  // The same expired/undated split the customer's rows are drawn from.
  expect(rpView).toHaveProperty('kycExpiryMissingKeys');
  expect(rpView.renewalDocsAcceptedAt, 'still the RP\'s call to make').toBeNull();
});
