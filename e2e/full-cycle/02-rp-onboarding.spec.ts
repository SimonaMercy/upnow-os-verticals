import { test, expect, Page, Locator } from '@playwright/test';
import {
  captureDevOtp,
  expectUploadServed,
  fillOtp,
  loginViaUi,
  pdfFile,
  pngFile,
  q,
  readState,
  registerProviderViaUi,
  uniqEmail,
  uniqPhone,
  writeState,
} from './helpers';

/**
 * 02 — Rental Provider registration + full onboarding wizard, through the UI.
 *
 *  - individual entity: account type → details (inline phone OTP) → EID upload
 *    → submit → "under review" screen
 *  - gate: while compliance is pending_review every RP dashboard page bounces
 *    back to /rental-provider/dashboard/onboarding
 *  - company entity (landlord company): business step + shareholders step
 *    (2 shareholders summing 100%, each with a real EID upload) + trade license
 *
 * Wizard source: src/app/rental-provider/dashboard/onboarding/page.tsx
 *
 * IMPORTANT flow fact: verifying the phone calls AuthContext.refresh(), which
 * re-runs the profile-load effect and RESETS fullName and the account-type
 * selection from server values. So: verify the phone FIRST, then type
 * names / pick the company account type.
 */

// Registration emails must be unique per *invocation* (uniqEmail alone is only
// unique per cycle, and this spec registers fresh users — reruns would collide).
const RUN_TAG = Date.now().toString(36).slice(-5);

const ONBOARDING_URL = /\/rental-provider\/dashboard\/onboarding/;

async function waitForWizard(page: Page) {
  // hero renders only once the profile GET resolved (loadState === 'form')
  await expect(
    page.getByRole('heading', { name: /set up your/i }),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Drive the inline phone-OTP block in the "Your Details" section.
 * Waits for the post-verify profile refetch (triggered by refresh()) so the
 * caller can safely fill other fields afterwards without them being reset.
 */
async function verifyPhoneInline(page: Page, phone: string) {
  await page.getByPlaceholder('50 123 4567').fill(phone);
  const otp = await captureDevOtp(page, '/auth/otp/request', () =>
    page.getByRole('button', { name: /send code/i }).click(),
  );
  await fillOtp(page, otp); // single "6-digit code" input — fillOtp handles it
  const profileRefetch = page
    .waitForResponse(
      (r) =>
        r.url().includes('/profiles/rental-provider/me') &&
        r.request().method() === 'GET' &&
        r.ok(),
      { timeout: 30_000 },
    )
    .catch(() => null);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 20_000 });
  await profileRefetch; // effect re-run after refresh()
  await page.waitForTimeout(800); // let the effect's setState wave settle
}

/**
 * Click an upload trigger (doc-row button or shareholder tile), feed the
 * native file chooser a real file, and wait for the metadata POST /documents
 * to succeed (upload-url + PUT happen in between).
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

function submitButton(page: Page): Locator {
  // sticky bottom action bar (the Documents section has a twin button)
  return page.locator('[class*="actionBar"]').getByRole('button', { name: /submit for review/i });
}

test.describe.serial('02 rental-provider onboarding', () => {
  test('individual RP registers via UI and lands on the onboarding wizard', async ({ page }) => {
    const rpEmail = uniqEmail(`rp${RUN_TAG}`);
    await registerProviderViaUi(page, 'rental-provider', rpEmail);
    // /verify-email goes via legacy /dashboard/rental-provider/onboarding → 308
    await page.waitForURL(ONBOARDING_URL, { timeout: 60_000 });
    await waitForWizard(page);

    const rpUserId = Number(q(`SELECT id FROM users WHERE email='${rpEmail}'`));
    expect(rpUserId, 'rp user row').toBeGreaterThan(0);
    const rpProfileId = Number(q(`SELECT id FROM rental_providers WHERE user_id=${rpUserId}`));
    expect(rpProfileId, 'rp profile row auto-created at registration').toBeGreaterThan(0);
    // fresh profile: not yet submitted, compliance pending
    expect(q(`SELECT account_type_confirmed_at IS NULL FROM rental_providers WHERE id=${rpProfileId}`)).toBe('t');
    expect(q(`SELECT compliance_status FROM rental_providers WHERE id=${rpProfileId}`)).toBe('pending_review');

    writeState({ rpEmail, rpUserId, rpProfileId });
  });

  test('individual completes the wizard — details with inline phone OTP, EID upload, submit → under review', async ({
    page,
  }) => {
    const s = readState();
    await loginViaUi(page, s.rpEmail);
    await page.waitForURL(ONBOARDING_URL, { timeout: 90_000 });
    await waitForWizard(page);

    // ── Step 1: Account Type — Individual Landlord (explicit click) ──
    await page.getByText('Individual Landlord', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // ── Step 2: Your Details ──
    await expect(page.getByPlaceholder('Your full legal name')).toBeVisible();
    const rpPhone = uniqPhone();
    await verifyPhoneInline(page, rpPhone);

    // fill ONLY after phone verify (refresh() resets fullName from the server)
    const rpFullName = 'Rashid Cyclelord';
    await page.getByPlaceholder('Your full legal name').fill(rpFullName);
    await page.locator('select:visible').selectOption('Emirati');
    await page.getByRole('button', { name: /save & continue/i }).click();

    // ── Step 3: Documents — Emirates ID is the one required doc ──
    const eidRow = page.locator('[class*="docRow"]').filter({ hasText: 'Emirates ID' }).first();
    await expect(eidRow).toBeVisible();
    await uploadDoc(page, eidRow.getByRole('button', { name: /upload/i }), pngFile('rp-eid.png'));
    await expect(eidRow.getByText('Uploaded', { exact: true })).toBeVisible();

    // ── Submit ──
    const submit = submitButton(page);
    await expect(submit, 'submit unlocks once required docs are on the server checklist').toBeEnabled({
      timeout: 20_000,
    });
    const patched = page.waitForResponse(
      (r) =>
        r.url().includes('/profiles/rental-provider/me') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
      { timeout: 30_000 },
    );
    await submit.click();
    await patched;
    await expect(page.getByRole('heading', { name: /under review/i })).toBeVisible({ timeout: 30_000 });

    // ── DB truths ──
    expect(q(`SELECT entity_type FROM rental_providers WHERE id=${s.rpProfileId}`)).toBe('individual');
    expect(q(`SELECT compliance_status FROM rental_providers WHERE id=${s.rpProfileId}`)).toBe('pending_review');
    expect(q(`SELECT account_type_confirmed_at IS NOT NULL FROM rental_providers WHERE id=${s.rpProfileId}`)).toBe('t');
    expect(q(`SELECT nationality FROM rental_providers WHERE id=${s.rpProfileId}`)).toBe('Emirati');
    expect(q(`SELECT name FROM users WHERE id=${s.rpUserId}`)).toBe(rpFullName);
    expect(q(`SELECT phone_verified FROM users WHERE id=${s.rpUserId}`)).toBe('t');

    // EID upload round-trips through the local-disk store + :3010 proxy
    const fileUrl = q(
      `SELECT file_url FROM documents WHERE owner_type='rental_provider'
         AND owner_id=${s.rpProfileId} AND document_key='emirates_id'
       ORDER BY id DESC LIMIT 1`,
    );
    expect(fileUrl, 'emirates_id document row').toBeTruthy();
    await expectUploadServed(page, new URL(fileUrl).pathname);

    writeState({ rpFullName, rpPhone });
  });

  test('gate: portfolio bounces back to onboarding while compliance is pending_review', async ({
    page,
  }) => {
    const s = readState();
    await loginViaUi(page, s.rpEmail);
    await page.goto('/rental-provider/dashboard/portfolio');
    await page.waitForURL(ONBOARDING_URL, { timeout: 90_000 });
    // and the onboarding page itself shows the under-review waiting screen
    await expect(page.getByRole('heading', { name: /under review/i })).toBeVisible({ timeout: 30_000 });
  });

  // ── Company entity ─────────────────────────────────────────────────────────
  // The wizard keeps everything client-side until the final PATCH, so the
  // fill + submit tests must share one live page (shared context below).
  test.describe.serial('company entity (landlord company)', () => {
    let coPage: Page;

    test.beforeAll(async ({ browser }, testInfo) => {
      const ctx = await browser.newContext({
        baseURL: (testInfo.project.use as { baseURL?: string }).baseURL,
      });
      coPage = await ctx.newPage();
    });

    test.afterAll(async () => {
      await coPage?.context().close().catch(() => {});
    });

    test('company RP registers and fills the wizard — business, 2 shareholders @100%, trade license', async () => {
      const page = coPage;
      const rpCompanyEmail = uniqEmail(`rpco${RUN_TAG}`);
      await registerProviderViaUi(page, 'rental-provider', rpCompanyEmail);
      await page.waitForURL(ONBOARDING_URL, { timeout: 60_000 });
      await waitForWizard(page);

      const rpCompanyUserId = Number(q(`SELECT id FROM users WHERE email='${rpCompanyEmail}'`));
      const rpCompanyProfileId = Number(
        q(`SELECT id FROM rental_providers WHERE user_id=${rpCompanyUserId}`),
      );
      expect(rpCompanyProfileId).toBeGreaterThan(0);
      writeState({ rpCompanyEmail, rpCompanyUserId, rpCompanyProfileId });

      // Verify the phone FIRST — refresh() after OTP verify re-runs the profile
      // effect and resets the account-type selection to the server value
      // (still 'individual'), which would silently drop a company selection.
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByPlaceholder('Your full legal name')).toBeVisible();
      const rpCompanyPhone = uniqPhone();
      await verifyPhoneInline(page, rpCompanyPhone);

      // ── now pick Landlord Company via the stepper ──
      await page.getByRole('button', { name: /account type/i }).click();
      await page.getByText('Landlord Company', { exact: true }).click();
      // company selection adds Business + Shareholders steps
      await expect(page.getByRole('button', { name: /shareholders/i })).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();

      // ── Your Information ──
      const contactName = 'Fatima Cotester';
      await page.getByPlaceholder('Your full legal name').fill(contactName);
      await page.getByRole('button', { name: /save & continue/i }).click();

      // ── Business ──
      const rpCompanyName = `Cycle Estates LLC ${RUN_TAG}`;
      await page.getByPlaceholder('Registered business name').fill(rpCompanyName);
      await page.getByPlaceholder('e.g. 1234567').fill('TL-998877');
      await page.locator('select:visible').selectOption('Dubai DED');
      await page.getByRole('button', { name: /save & continue/i }).click();

      // ── Shareholders: 2 shareholders summing 100%, each with an EID upload ──
      const plus = page.locator('[class*="stepperNum"] button').last();
      await plus.click();
      await plus.click();
      const blocks = page.locator('[class*="shBlock"]');
      await expect(blocks).toHaveCount(2);

      const holders = [
        { name: 'Omar Cycleholder', nat: 'Emirati', pct: '60', file: 'sh1-eid.png' },
        { name: 'Lina Cycleholder', nat: 'Indian', pct: '40', file: 'sh2-eid.png' },
      ];
      for (let i = 0; i < holders.length; i++) {
        const b = blocks.nth(i);
        await b.getByPlaceholder('Full legal name', { exact: true }).fill(holders[i].name);
        await b.locator('select').selectOption(holders[i].nat);
        await b.getByPlaceholder('51').fill(holders[i].pct);
        const eidTile = b.locator('[class*="docMini"]').filter({ hasText: 'Emirates ID' }).first();
        await uploadDoc(page, eidTile, pngFile(holders[i].file));
        await expect(b.getByText(holders[i].file)).toBeVisible();
      }
      await expect(page.getByText(/fully declared/)).toBeVisible();
      await page.getByRole('button', { name: /save & continue/i }).click();

      // ── Documents: Trade License is required for a landlord company ──
      const tlRow = page.locator('[class*="docRow"]').filter({ hasText: 'Trade License' }).first();
      await expect(tlRow).toBeVisible();
      await uploadDoc(page, tlRow.getByRole('button', { name: /upload/i }), pdfFile('trade-license.pdf'));
      await expect(tlRow.getByText('Uploaded', { exact: true })).toBeVisible();

      // shareholder EIDs really landed in the documents table (sh_<id>_emirates_id)
      const shDocCount = Number(
        q(`SELECT count(*) FROM documents WHERE owner_type='rental_provider'
             AND owner_id=${rpCompanyProfileId}
             AND document_key LIKE 'sh_%' AND document_key LIKE '%emirates_id'`),
      );
      expect(shDocCount, 'both shareholder EID uploads persisted').toBe(2);

      writeState({ rpCompanyName, rpCompanyPhone });
    });

    test('company RP submits for review — shareholders + business persist, under-review screen shows', async () => {
      const page = coPage;
      const s = readState();

      // all 5 steps are complete at this point, so the sticky submit must unlock
      const submit = submitButton(page);
      await expect(submit, 'submit unlocks once all steps incl. trade license are done').toBeEnabled({
        timeout: 20_000,
      });
      const patched = page.waitForResponse(
        (r) =>
          r.url().includes('/profiles/rental-provider/me') &&
          r.request().method() === 'PATCH' &&
          r.ok(),
        { timeout: 30_000 },
      );
      await submit.click();
      await patched;
      await expect(page.getByRole('heading', { name: /under review/i })).toBeVisible({ timeout: 30_000 });

      // ── DB truths: company profile persisted with shareholders ──
      expect(q(`SELECT entity_type FROM rental_providers WHERE id=${s.rpCompanyProfileId}`)).toBe('company');
      expect(q(`SELECT company_type FROM rental_providers WHERE id=${s.rpCompanyProfileId}`)).toBe('landlord');
      expect(q(`SELECT company_name FROM rental_providers WHERE id=${s.rpCompanyProfileId}`)).toBe(
        s.rpCompanyName,
      );
      expect(q(`SELECT trade_license_number FROM rental_providers WHERE id=${s.rpCompanyProfileId}`)).toBe(
        'TL-998877',
      );
      expect(
        Number(q(`SELECT jsonb_array_length(shareholders) FROM rental_providers WHERE id=${s.rpCompanyProfileId}`)),
      ).toBe(2);
      expect(
        q(`SELECT account_type_confirmed_at IS NOT NULL FROM rental_providers WHERE id=${s.rpCompanyProfileId}`),
      ).toBe('t');
    });
  });
});
