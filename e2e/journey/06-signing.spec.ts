/**
 * STEP 6 — Complete the lease: landlord countersigns, customer signs from the
 * magic-link portal.
 *
 * Reading the portal token out of the DB stands in for clicking the link in
 * the email; the signing itself is done through the real portal UI.
 */
import { test, expect } from '@playwright/test';
import {
  RP, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, signBlock,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('06a — landlord countersigns the contract', async ({ page }) => {
  shotPrefix(6);
  const { contractId } = readState();
  expect(contractId, 'contract from step 05').toBeTruthy();

  beginStep('6a. Lease signing — landlord');

  await login(page, RP);
  act('landlord', 'Signed in via OTP', RP);

  // The pipeline tracker: the milestones this product reports activity on
  await page.goto('/rental-provider/dashboard/operations');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1800);
  const headers = await page.locator('thead th, table th').allInnerTexts();
  const milestones = headers.map((h) => h.replace(/\s+/g, ' ').trim()).filter(Boolean);
  console.log('  → pipeline tracker milestones:', JSON.stringify(milestones));
  writeState({ pipelineMilestones: milestones });
  await shot(page, 'operations-tracker');
  act('landlord', 'Reviewed the operations pipeline tracker');

  await page.goto(`/rental-provider/dashboard/operations/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await shot(page, 'operation-signatures');

  const t = await page.locator('body').innerText();
  const journey = [...new Set((t.match(/\n(Issue|Sign|Contract Registration|Utility|Move-in|Active)\n/g) ?? []).map((s) => s.trim()))];
  console.log('  → activation journey:', JSON.stringify(journey));
  writeState({ activationJourney: journey });

  // Send the customer their signing link — the real notification path
  const send = page.locator('button').filter({ hasText: /Send signing link/ }).first();
  if (await send.isVisible().catch(() => false)) {
    await send.click();
    await page.waitForTimeout(2500);
    act('landlord', 'Sent the customer their contract signing link', 'magic-link portal');
    await shot(page, 'signing-link-sent');
  }

  const already = q(`SELECT COUNT(*) FROM contract_signatures WHERE tenancy_contract_id=${contractId} AND role='landlord'`);
  if (already !== '0') {
    console.log('  → landlord already signed; skipping');
  } else {
    const ok = await signBlock(page, /Sign as Landlord/, 'Khalifa Ahmad Rashed Almulla Alfalasi');
    expect(ok, 'landlord could complete the signature block').toBe(true);
    act('landlord', 'Signed the contract as landlord', 'drew signature + accepted e-signature consent');
    await shot(page, 'landlord-signed');
  }

  const sigs = q(`SELECT COALESCE(string_agg(role || '/' || method, ', '), '(none)') FROM contract_signatures WHERE tenancy_contract_id=${contractId}`);
  console.log('  → signatures:', sigs);
  expect(sigs).toContain('landlord');

  endStep();
});

test('06b — customer signs from the magic-link portal', async ({ page }) => {
  const { contractId } = readState();
  beginStep('6b. Lease signing — customer');

  const token = q(`SELECT token FROM tenant_portal_tokens
                   WHERE tenancy_contract_id=${contractId} AND revoked=false AND signer_role='tenant'
                   ORDER BY id DESC LIMIT 1`);
  expect(token, 'a portal signing token was issued for the customer').toBeTruthy();
  writeState({ portalToken: token });
  console.log(`  → portal token: ${token.slice(0, 8)}…`);

  await page.goto(`/portal/${token}/contract/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'portal-contract');
  act('customer', 'Opened the magic-link portal and read the contract', `CID-${contractId}`);

  const already = q(`SELECT COUNT(*) FROM contract_signatures WHERE tenancy_contract_id=${contractId} AND role IN ('tenant','customer')`);
  if (already !== '0') {
    console.log('  → customer already signed; skipping');
  } else {
    const ok = await signBlock(page, /Sign contract/, 'Dev Customer');
    expect(ok, 'customer could complete the signature block').toBe(true);
    act('customer', 'Signed the tenancy contract', 'drew signature + accepted e-signature consent');
    await shot(page, 'portal-signed');
    await surface(page, 'after customer signature');
  }

  // Signature evidence the product captures
  const evidence = q(`SELECT role || ' | method=' || method
                             || ' | via=' || COALESCE(signed_via,'∅')
                             || ' | ip=' || COALESCE(ip_address,'∅')
                             || ' | consent=' || consent_given
                             || ' | terms_hash=' || CASE WHEN terms_hash IS NULL THEN '∅' ELSE 'yes' END
                             || ' | ua=' || CASE WHEN user_agent IS NULL THEN '∅' ELSE 'yes' END
                      FROM contract_signatures WHERE tenancy_contract_id=${contractId} ORDER BY id`);
  console.log('──── SIGNATURE EVIDENCE\n' + evidence.split('\n').map((l) => `   · ${l}`).join('\n'));
  writeState({ signatureEvidence: evidence.split('\n') });

  const status = q(`SELECT status FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → contract status after both signatures:', status);
  writeState({ statusAfterSigning: status });

  endStep();
});
