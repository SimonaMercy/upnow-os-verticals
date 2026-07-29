/**
 * STEP 12 — The reported chain, end to end.
 *
 *   manager replaces an expired KYC doc twice  →  two copies exist
 *   manager rejects                            →  customer still cannot upload
 *
 * Mechanism under test:
 *  · onUploadDoc builds `${key}_${Date.now()}`, so the backend's
 *    UNIQUE(owner_type, owner_id, document_key) upsert can never match and each
 *    "Replace" stacks another row.
 *  · onRejectDoc rejects only the single "freshest" row for the base.
 *  · computeExpiredRenewalKyc flags a base only when NO copy is both unexpired
 *    and unrejected — so one surviving dated copy hides the rejection from the
 *    customer entirely.
 */
import { test, expect } from '@playwright/test';
import {
  MANAGER, CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, qRows, clickAny, png,
} from './helpers';

test.describe.configure({ mode: 'serial' });
const RP_SCOPE = 2;
/** Comfortably in the future, so each replacement reads as a valid copy. */
const FUTURE_EXPIRY = '2031-12-31';

function eidRows(renewalId: number, tenantId = 115) {
  return qRows(`
    SELECT id, owner_type, document_key, status, COALESCE(expiry_date::text,'-')
    FROM documents
    WHERE ((owner_type='customer' AND owner_id=${tenantId})
        OR (owner_type='tenancy_contract' AND owner_id=${renewalId}))
      AND deleted_at IS NULL
      AND (document_key ILIKE '%emirates%' OR document_key ILIKE '%eid%')
    ORDER BY id`);
}
function dump(label: string, renewalId: number) {
  const rows = eidRows(renewalId);
  console.log(`\n──── EMIRATES ID COPIES ${label} (${rows.length})`);
  rows.forEach(([id, owner, key, status, exp]) =>
    console.log(`   · #${id} ${owner.padEnd(17)} ${key.padEnd(34)} ${status.padEnd(10)} expiry=${exp}`));
  return rows;
}
async function flagged(page: import('@playwright/test').Page, id: number) {
  const res = await page.request.get(`/api/contracts/${id}`);
  const b = res.ok() ? await res.json().catch(() => ({} as any)) : {};
  return (b?.expiredKycDocKeys ?? []) as string[];
}

test('12 — replace twice then reject: does the rejection reach the customer?', async ({ page }) => {
  shotPrefix(12);
  const { renewalContractId, leadId } = readState();
  expect(renewalContractId).toBeTruthy();

  beginStep('12. Renewal KYC — duplicate copies hide the rejection');

  const before = dump('BEFORE', renewalContractId);

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);

  // Accept every native prompt so rejection is not silently aborted (11a).
  page.on('dialog', (d) => d.accept('Expired copy — please upload a current Emirates ID.'));

  /* ── 12a. Replace the Emirates ID twice, each with a valid expiry ───── */
  for (const pass of [1, 2]) {
    // The Upload control lives in the Documents block of the operations/contract
    // detail page, not on /contracts/:id/documents.
    await page.goto(`/dashboard/manager/operations/${renewalContractId}?rp=${RP_SCOPE}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    const docsBlock = page.locator('text=/Documents \\(/').first();
    await docsBlock.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    if (pass === 1) { await shot(page, 'documents-drawer'); await surface(page, 'contract documents'); }

    const upload = await clickAny(page, [/Upload document/, /Upload/]);
    if (!upload) { gap('Renewal KYC', 'no Upload control on the contract documents page'); break; }
    await page.waitForTimeout(1500);

    // Pick the Emirates ID document type
    const typeSel = page.locator('select:visible').first();
    if (await typeSel.isVisible().catch(() => false)) {
      const opts = await typeSel.locator('option').allInnerTexts();
      const match = opts.find((o) => /emirates/i.test(o));
      if (match) await typeSel.selectOption({ label: match });
      console.log(`  → doc type set to: ${match ?? '(none matched)'}`);
    }

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(png(`eid-replacement-${pass}.png`)).catch(() => {});
    await page.waitForTimeout(800);

    const expiry = page.locator('input[type="date"]:visible').first();
    if (await expiry.isVisible().catch(() => false)) {
      await expiry.fill(FUTURE_EXPIRY);
      console.log(`  → expiry set to ${FUTURE_EXPIRY}`);
    }
    await shot(page, `upload-modal-${pass}`);

    const submitted = await clickAny(page, [/Upload document/, /^Upload$/, /Save/, /Submit/, /Add/]);
    await page.waitForTimeout(4000);
    act('manager', `Replaced the Emirates ID (${pass} of 2)`, `submitted via "${submitted}"`);
  }

  const afterReplace = dump('AFTER TWO REPLACES', renewalContractId);
  const added = afterReplace.length - before.length;
  console.log(`  → rows added by two replaces: ${added}`);
  if (added >= 2) {
    gap('Renewal KYC — duplicates',
      `Two "Replace" actions on ONE document produced ${added} additional rows. onUploadDoc builds `
      + '`${key}_${Date.now()}`, so the UNIQUE(owner_type, owner_id, document_key) upsert never matches '
      + 'and every replace stacks a copy instead of superseding the old one.');
  }

  /* ── 12b. Reject on the renewal panel ───────────────────────────────── */
  const flaggedBefore = await flagged(page, renewalContractId);
  console.log('  → flagged before reject:', JSON.stringify(flaggedBefore));

  await page.goto(`/dashboard/manager/operations/${renewalContractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'renewal-panel');

  const reject = page.locator('button:visible').filter({ hasText: /Reject/ }).first();
  if (await reject.isVisible().catch(() => false)) {
    await reject.scrollIntoViewIfNeeded().catch(() => {});
    await reject.click();
    await page.waitForTimeout(4000);
    act('manager', 'Rejected the Emirates ID on the renewal KYC panel');
  } else {
    gap('Renewal KYC', 'no Reject control on the renewal panel after the replaces');
  }
  await shot(page, 'after-reject');

  const afterReject = dump('AFTER REJECT', renewalContractId);
  const rejectedCount = afterReject.filter((r) => r[3] === 'rejected').length;
  const survivingValid = afterReject.filter((r) => r[3] !== 'rejected' && r[4] !== '-').length;
  console.log(`  → rejected copies: ${rejectedCount} · surviving dated+unrejected copies: ${survivingValid}`);

  const flaggedAfter = await flagged(page, renewalContractId);
  console.log('  → flagged after reject:', JSON.stringify(flaggedAfter));

  /* ── 12c. What can the customer actually do? ────────────────────────── */
  await login(page, CUSTOMER);
  await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'customer-view');
  await surface(page, 'customer renewal documents');

  const inputs = await page.locator('input[type="file"]').count();
  const body = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  console.log(`  → CUSTOMER: file inputs = ${inputs}`);
  const idx = body.indexOf('RENEWAL STEP');
  console.log('     ' + body.slice(idx, idx + 500).replace(/\n/g, ' | '));

  writeState({ dupAdded: added, rejectedCount, survivingValid, flaggedAfter, customerInputs: inputs });

  if (!flaggedAfter.includes('emirates_id') && rejectedCount > 0) {
    gap('Renewal KYC — rejection hidden',
      `The Emirates ID was rejected but the base is no longer flagged (expiredKycDocKeys = `
      + `${JSON.stringify(flaggedAfter)}). ${survivingValid} dated, unrejected duplicate(s) still satisfy `
      + 'the backend check, so the customer is never asked to re-upload.');
  }
  if (inputs === 0 && rejectedCount > 0) {
    gap('Renewal KYC — customer blocked',
      'After the rejection the customer has NO upload control on the renewal documents step.');
  }

  endStep();
});
