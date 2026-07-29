/**
 * STEP 5 — Landlord verifies the payment references and the lead converts
 * into a tenancy contract.
 */
import { test, expect } from '@playwright/test';
import {
  RP, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('05 — landlord verifies payments and the contract is issued', async ({ page }) => {
  shotPrefix(5);
  const { leadId, unitId } = readState();
  expect(leadId).toBeTruthy();

  beginStep('5. Landlord verifies payment → contract');

  await login(page, RP);
  act('landlord', 'Signed in via OTP', RP);

  await page.goto(`/rental-provider/dashboard/leads/${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await shot(page, 'lead-cheques-submitted');
  await surface(page, 'lead at payment confirmation');

  const before = q(`SELECT stage FROM leads WHERE id=${leadId}`);
  console.log('  → stage before:', before);

  // One control does review + approve + convert in a single step
  const clicked = await clickAny(page, [/Payment review & approve/i, /Payment Review & Approve/]);
  expect(clicked, 'landlord can review and approve the payments').toBeTruthy();
  act('landlord', `Reviewed and approved the payments via "${clicked}"`);
  await page.waitForTimeout(4000);
  await shot(page, 'payments-approved');

  const stage = q(`SELECT stage FROM leads WHERE id=${leadId}`);
  console.log('  → stage after:', stage);
  expect(stage).toBe('converted');

  const contractId = q(`SELECT id FROM tenancy_contracts
                        WHERE unit_id=${unitId} AND tenant_id=115
                        ORDER BY id DESC LIMIT 1`);
  expect(contractId, 'a tenancy contract was created').toBeTruthy();
  writeState({ contractId: Number(contractId) });
  console.log('  → contract:', q(`SELECT id || ' | ' || status || ' | ' || contract_start_date || ' → ' || contract_end_date || ' | rent ' || annual_rent FROM tenancy_contracts WHERE id=${contractId}`));

  await page.goto(`/rental-provider/dashboard/operations/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await shot(page, 'contract-issued');

  gap('Contract issued',
    'Converting the lead writes two lead.transition rows and nothing else — there is no contract.created '
    + 'event, and the per-payment approvals the landlord just made are not individually recorded.');
  endStep();
});
