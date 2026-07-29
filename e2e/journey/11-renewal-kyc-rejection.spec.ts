/**
 * STEP 11 — Renewal KYC rejection path (reported bug, 28 Jul 2026).
 *
 * Reported: at the renewal KYC stage a manager replaces an expired document,
 * the replace runs twice and TWO documents appear; the manager then rejects,
 * and the customer still has no way to upload a replacement.
 *
 * The manager's renewal review panel offers, per KYC base: View · expiry date ·
 * Approve · Reject. What the customer is asked to re-upload is driven entirely by
 * the backend's `expiredKycDocKeys`, which flags a base only when NO copy of it is
 * both unexpired and unrejected. This spec drives reject (with and without an
 * expiry recorded first) and reports whether the customer regains an upload slot.
 */
import { test, expect } from '@playwright/test';
import {
  MANAGER, CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, qRows, clickAny, png,
} from './helpers';

test.describe.configure({ mode: 'serial' });
const RP_SCOPE = 2;

function kycRows(renewalId: number, tenantId = 115) {
  return qRows(`
    SELECT id, owner_type, document_key, status, COALESCE(expiry_date::text,'-')
    FROM documents
    WHERE ((owner_type='customer' AND owner_id=${tenantId})
        OR (owner_type='tenancy_contract' AND owner_id=${renewalId}))
      AND deleted_at IS NULL
      AND (document_key ILIKE '%emirates%' OR document_key ILIKE '%eid%'
        OR document_key ILIKE '%passport%' OR document_key ILIKE '%visa%')
    ORDER BY id`);
}
function dumpKyc(label: string, renewalId: number) {
  const rows = kycRows(renewalId);
  console.log(`\n──── KYC DOCS ${label} (${rows.length})`);
  rows.forEach(([id, owner, key, status, exp]) =>
    console.log(`   · #${id} ${owner.padEnd(17)} ${key.padEnd(30)} ${status.padEnd(10)} expiry=${exp}`));
  return rows;
}

/** What the backend is telling the customer to re-upload right now. */
async function flaggedBases(page: import('@playwright/test').Page, renewalId: number) {
  // relative → goes through the FE proxy so the session cookie is sent
  const res = await page.request.get(`/api/contracts/${renewalId}`);
  if (!res.ok()) return { expired: ['(api ' + res.status() + ')'], missingExpiry: [] as string[] };
  const b = await res.json().catch(() => ({} as any));
  return { expired: b?.expiredKycDocKeys ?? [], missingExpiry: b?.kycExpiryMissingKeys ?? [] };
}

/** Open the customer's space and report whether an upload affordance exists. */
async function customerCanUpload(page: import('@playwright/test').Page, label: string) {
  const { leadId } = readState();
  await login(page, CUSTOMER);
  await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, `customer-${label}`);

  const inputs = await page.locator('input[type="file"]').count();
  const body = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  const waiting = /under review|awaiting|we.re reviewing|with your rental provider/i.test(body);
  console.log(`  → CUSTOMER [${label}]: file inputs = ${inputs} · shows "waiting" copy = ${waiting}`);
  const head = body.slice(body.indexOf('RENEWAL'), body.indexOf('RENEWAL') + 700);
  console.log('     ' + head.replace(/\n/g, ' | ').slice(0, 420));
  return { inputs, waiting };
}

test('11a — manager rejects a renewal KYC doc; can the customer re-upload?', async ({ page }) => {
  shotPrefix(11);
  const { renewalContractId } = readState();
  expect(renewalContractId, 'renewal contract from step 09').toBeTruthy();

  const gate = q(`SELECT CASE WHEN renewal_docs_accepted_at IS NULL THEN 'not-accepted' ELSE 'accepted' END
                  FROM tenancy_contracts WHERE id=${renewalContractId}`);
  expect(gate, 'renewal still awaiting documents').toBe('not-accepted');

  beginStep('11a. Renewal KYC — reject, then check the customer');

  dumpKyc('BEFORE', renewalContractId);

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);
  console.log('  → flagged before:', JSON.stringify(await flaggedBases(page, renewalContractId)));

  await page.goto(`/dashboard/manager/operations/${renewalContractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'renewal-docs-step');

  // Rejection is gated on a NATIVE window.prompt(). Anything that returns null —
  // Cancel, or Chrome's "prevent this page from creating additional dialogs"
  // after the first one — makes onRejectDoc return early and silently do nothing.
  let prompts = 0;
  page.on('dialog', async (d) => {
    prompts += 1;
    console.log(`  → native ${d.type()} #${prompts}: "${d.message().slice(0, 70)}…"`);
    await d.accept('Copy is expired — please upload a current Emirates ID.');
  });

  const reject = page.locator('button:visible').filter({ hasText: /Reject/ }).first();
  expect(await reject.isVisible().catch(() => false), 'reviewer can reject a renewal KYC doc').toBe(true);
  await reject.scrollIntoViewIfNeeded().catch(() => {});
  await reject.click();
  await page.waitForTimeout(4000);
  console.log(`  → native dialogs raised: ${prompts}`);
  act('manager', 'Rejected the Emirates ID on the renewal KYC step');
  await shot(page, 'after-reject');

  dumpKyc('AFTER REJECT', renewalContractId);
  const flagged = await flaggedBases(page, renewalContractId);
  console.log('  → flagged after reject:', JSON.stringify(flagged));
  writeState({ flaggedAfterReject: flagged });

  const seen = await customerCanUpload(page, 'after-reject');
  if (seen.inputs === 0) {
    gap('Renewal KYC rejection',
      'The manager rejected the Emirates ID but the customer has NO upload control — '
      + `expiredKycDocKeys = ${JSON.stringify(flagged.expired)}. The rejection does not reach the customer.`);
  } else {
    console.log('  ✓ the customer does get an upload slot after a plain reject');
  }

  endStep();
});
