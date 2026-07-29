/**
 * STEP 3 — Landlord works the lead: approve the customer's documents, then
 * share the payment plan.
 */
import { test, expect } from '@playwright/test';
import {
  RP, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('03 — landlord approves documents and shares the payment plan', async ({ page }) => {
  shotPrefix(3);
  const { leadId } = readState();
  expect(leadId).toBeTruthy();

  beginStep('3. Landlord works the lead');

  await login(page, RP);
  act('landlord', 'Signed in via OTP', RP);

  await page.goto('/rental-provider/dashboard/leads');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  await shot(page, 'leads-list');
  act('landlord', 'Opened the Leads pipeline');

  const gotoLead = async () => {
    await page.goto(`/rental-provider/dashboard/leads/${leadId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
  };
  const stage = () => q(`SELECT stage FROM leads WHERE id=${leadId}`);

  await gotoLead();
  await shot(page, 'lead-interested');

  // The landlord-side journey model (compare with the customer's 8 stops)
  const labels = await page
    .locator('text=/^(Viewing|Interested|Documents|Payment plan|Payment confirmation|Converted)$/')
    .allInnerTexts();
  console.log('  → landlord lead journey:', JSON.stringify([...new Set(labels)]));
  writeState({ landlordLeadJourney: [...new Set(labels)] });

  // 3a — approve the KYC documents (skipped on a re-run past this stage)
  if (stage() === 'interested' || stage() === 'documents_collection') {
    const approve = page.locator('button').filter({ hasText: /^Approve documents/ }).first();
    expect(await approve.isVisible().catch(() => false), 'lead offers document approval').toBe(true);
    await approve.click();
    await page.waitForTimeout(3000);
    act('landlord', 'Approved the customer KYC documents');
    await shot(page, 'docs-approved');
    console.log('  → stage after approve:', stage());
  } else {
    console.log(`  → documents already approved (stage ${stage()}); skipping`);
  }

  // …but nothing was actually verified
  const verified = q(`SELECT count(*) FROM documents
                      WHERE owner_type='customer' AND owner_id=115 AND deleted_at IS NULL
                        AND verified_by_user_id IS NOT NULL`);
  const events = q(`SELECT count(*) FROM document_verification_events e
                    JOIN documents d ON d.id=e.document_id
                    WHERE d.owner_type='customer' AND d.owner_id=115 AND e.action='verified'`);
  console.log(`  → documents marked verified: ${verified} · verified events: ${events}`);
  if (verified === '0') {
    gap('Document review',
      '"Approve documents" advances the lead but verifies nothing: documents stay `attached`, '
      + 'verified_by_user_id stays NULL, no approval event is written, and the contract page still '
      + 'lists every KYC doc as "Pending review". The tracker\'s "KYC VERIFIED" column is never fed.');
  }

  // 3b — share the payment plan
  await gotoLead();
  await shot(page, `stage-${stage()}`);
  const shared = await clickAny(page, [/Share plan with customer/, /Share payment plan/]);
  expect(shared, 'landlord can share the payment plan').toBeTruthy();
  act('landlord', `Shared the payment plan via "${shared}"`);
  await page.waitForTimeout(3500);
  await shot(page, 'plan-shared');
  await surface(page, 'after sharing the plan');

  const finalStage = stage();
  console.log('  → lead stage:', finalStage);
  expect(finalStage).toBe('payment_plan_shared');
  writeState({ leadStageAfterStep3: finalStage });

  gap('Payment plan', 'Sharing the plan with the customer records no dispatch/notification event.');
  endStep();
});
