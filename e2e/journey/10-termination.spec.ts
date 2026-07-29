/**
 * STEP 10 — End the tenancy: terminate the lease, run the move-out inspection
 * and settle the deposit.
 */
import { test, expect } from '@playwright/test';
import {
  RP, MANAGER, CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny, signBlock, png, pdf,
} from './helpers';

test.describe.configure({ mode: 'serial' });
const RP_SCOPE = 2;

/** Effective end date for the early termination. */
const EFFECTIVE = '2026-10-31';

test('10a — landlord terminates the lease', async ({ page }) => {
  shotPrefix(10);
  const { contractId } = readState();
  expect(contractId).toBeTruthy();

  beginStep('10a. Termination');

  await login(page, RP);
  act('landlord', 'Signed in via OTP', RP);

  await page.goto(`/rental-provider/dashboard/operations/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'lease-before-termination');

  const terminate = page.locator('button, a').filter({ hasText: /Terminate directly/ }).first();
  await expect(terminate, 'lease offers a direct termination').toBeVisible({ timeout: 10_000 });
  await terminate.click();
  await page.waitForTimeout(2500);
  await shot(page, 'termination-form');

  // Reason + effective date
  const reason = page.getByPlaceholder(/Why are you ending this contract/i).first();
  await expect(reason, 'termination asks for a reason').toBeVisible({ timeout: 10_000 });
  await reason.fill('Journey test — customer relocating; ending the tenancy early by mutual agreement.');
  act('landlord', 'Recorded the termination reason');

  const date = page.locator('input[type="date"]:visible').last();
  if (await date.isVisible().catch(() => false)) {
    await date.fill(EFFECTIVE);
    await date.blur();
    act('landlord', 'Set the termination effective date', EFFECTIVE);
  }
  await page.waitForTimeout(1000);
  await shot(page, 'termination-filled');

  // The submit is the disabled-until-filled one inside the form
  const submit = page.locator('button:visible').filter({ hasText: /Terminate directly/ }).last();
  await expect(submit, 'terminate enables once reason + date are set').toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await page.waitForTimeout(2500);

  // A confirm dialog may follow
  await shot(page, 'termination-confirm');
  const dialogConfirm = page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
    .filter({ has: page.getByRole('button', { name: /Terminate/ }) })
    .last()
    .getByRole('button', { name: /Terminate/ })
    .last();
  if (await dialogConfirm.isVisible().catch(() => false)) {
    await dialogConfirm.click();
    await page.waitForTimeout(4000);
    act('landlord', 'Confirmed the termination dialog');
  }
  act('landlord', 'Terminated the lease directly', `effective ${EFFECTIVE}`);
  await page.waitForTimeout(3000);
  await shot(page, 'terminated');
  await surface(page, 'after termination');

  const state = q(`SELECT status || ' | active=' || contract_active
                          || ' | requested_by=' || COALESCE(termination_requested_by_role,'∅')
                          || ' | effective=' || COALESCE(termination_effective_date::text,'∅')
                   FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → contract after termination:', state);
  writeState({ afterTermination: state });

  endStep();
});

test('10b — manager runs the move-out inspection', async ({ page }) => {
  const { contractId } = readState();
  beginStep('10b. Move-out inspection');

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);

  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'wind-down-step');
  await surface(page, 'wind-down step');

  const text = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  const i = text.indexOf('WORKING ON THIS STEP');
  const j = text.indexOf('Contract details');
  console.log('\n──── WIND-DOWN STEP\n' + text.slice(i > 0 ? i : 0, j > 0 ? j : 2500));

  // The move-out inspection has its own workspace, seeded from the move-in report
  await page.goto(`/dashboard/manager/contracts/${contractId}/inspection/v2?type=move_out&rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'moveout-workspace');
  await surface(page, 'move-out inspection workspace');
  act('manager', 'Opened the move-out inspection workspace');

  const wtext = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  console.log('\n──── MOVE-OUT WORKSPACE\n' + wtext.slice(wtext.indexOf('MOVE'), wtext.indexOf('MOVE') + 2500));

  const inspectedBy = page.getByPlaceholder(/Inspected by/i).first();
  if (await inspectedBy.isVisible().catch(() => false)) {
    await inspectedBy.fill('Sherif Mohamed Atef');
    await inspectedBy.blur();
    act('manager', 'Recorded who carried out the move-out inspection');
  }
  const notes = page.getByPlaceholder(/Overall notes/i).first();
  if (await notes.isVisible().catch(() => false)) {
    await notes.fill('Unit returned in good order. Keys handed back. No deductions proposed.');
    await notes.blur();
    act('manager', 'Added move-out condition notes');
  }
  await page.waitForTimeout(1000);
  await shot(page, 'moveout-filled');

  const draft = page.locator('button:visible').filter({ hasText: /Save draft/ }).last();
  if (await draft.isVisible().catch(() => false)) {
    await draft.click();
    await page.waitForTimeout(3000);
    act('manager', 'Saved the move-out inspection draft');
  }

  const submit = page.locator('button:visible').filter({ hasText: /Submit to Tenant/ }).last();
  if (await submit.isVisible().catch(() => false)) {
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    await submit.click().catch(() => {});
    await page.waitForTimeout(2000);
    const confirm = page
      .locator('div')
      .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Submit to Tenant/ }) })
      .last()
      .getByRole('button', { name: /Submit to Tenant/ })
      .last();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await page.waitForTimeout(4000);
    }
    act('manager', 'Submitted the move-out inspection to the customer');
    await shot(page, 'moveout-submitted');
  } else {
    gap('Move-out inspection', 'no submit control on the move-out workspace');
  }

  const st = q(`SELECT CASE WHEN move_out_inspection IS NULL THEN 'null'
                            ELSE COALESCE(move_out_inspection->>'rpSubmittedAt','∅') END
                FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → move_out_inspection.rpSubmittedAt:', st);

  endStep();
});

test('10c — customer signs the move-out inspection', async ({ page }) => {
  const { contractId } = readState();
  beginStep('10c. Move-out inspection — customer signs');

  await login(page, MANAGER);
  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const sent = await clickAny(page, [/Send move-out link/]);
  expect(sent, 'manager can issue a move-out signing link').toBeTruthy();
  await page.waitForTimeout(3000);
  act('manager', 'Sent the customer a move-out signing link');

  const token = q(`SELECT token FROM tenant_portal_tokens
                   WHERE tenancy_contract_id=${contractId} AND revoked=false AND purpose='move_out'
                   ORDER BY id DESC LIMIT 1`);
  expect(token, 'a move-out portal token was issued').toBeTruthy();
  writeState({ moveOutToken: token });

  await page.context().clearCookies();
  await page.goto(`/portal/${token}/contract/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'portal-moveout');
  await surface(page, 'portal move-out');
  act('customer', 'Opened the move-out inspection in the portal');

  const ok = await signBlock(page, /Sign move-out/, 'Dev Customer');
  if (ok) {
    act('customer', 'Signed the move-out inspection');
    await shot(page, 'portal-moveout-signed');
  } else {
    gap('Move-out inspection', 'customer could not sign the move-out inspection');
  }
  endStep();
});

test('10d — manager counter-signs the move-out inspection', async ({ page }) => {
  const { contractId } = readState();
  beginStep('10d. Move-out inspection — manager counter-signs');

  await login(page, MANAGER);
  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const sent = await clickAny(page, [/Send inspector link/]);
  expect(sent, 'manager can issue an inspector link').toBeTruthy();
  await page.waitForTimeout(3000);
  act('manager', 'Issued the inspector counter-sign link');

  const token = q(`SELECT token FROM tenant_portal_tokens
                   WHERE tenancy_contract_id=${contractId} AND revoked=false AND signer_role='inspector'
                   ORDER BY id DESC LIMIT 1`);
  expect(token).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/portal/${token}/contract/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'moveout-countersign');

  const ok = await signBlock(page, /Counter-sign inspection|Counter-sign move-out/, 'Sherif Mohamed Atef');
  if (ok) {
    act('manager', 'Counter-signed the move-out inspection', 'acting for the landlord');
    await shot(page, 'moveout-countersigned');
  } else {
    gap('Move-out inspection', 'manager could not counter-sign the move-out inspection');
  }

  const st = q(`SELECT CASE WHEN move_out_inspection->>'rpCounterSig' IS NULL THEN '∅' ELSE 'captured' END
                FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → move-out counter-signature:', st);
  endStep();
});

test('10e — settle the deposit and close the tenancy', async ({ page }) => {
  const { contractId } = readState();
  beginStep('10e. Deposit settlement');

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);

  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'after-moveout');
  await surface(page, 'wind-down after move-out');

  const text = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  const i = text.indexOf('WORKING ON THIS STEP');
  console.log('\n──── CURRENT WIND-DOWN STEP\n' + text.slice(i > 0 ? i : 0, (i > 0 ? i : 0) + 2000));

  // Settlement has its own page
  await page.goto(`/dashboard/manager/contracts/${contractId}/settlement?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'settlement-worksheet');
  await surface(page, 'deposit settlement worksheet');
  act('manager', 'Opened the deposit settlement worksheet');

  const stext = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  console.log('\n──── SETTLEMENT\n' + stext.slice(0, 2500));

  // Explain the settlement, then sign it as the landlord's representative.
  const notes = page.getByPlaceholder(/Explain the deductions/i).first();
  if (await notes.isVisible().catch(() => false)) {
    await notes.fill('Unit returned in good condition at move-out. No deductions. Security deposit refunded in full by bank transfer.');
    await notes.blur();
    act('manager', 'Explained the deposit handling on the settlement');
  }

  const draft = page.locator('button:visible').filter({ hasText: /Save draft/ }).first();
  if (await draft.isVisible().catch(() => false)) {
    await draft.click();
    await page.waitForTimeout(3000);
    act('manager', 'Saved the settlement draft');
  }
  await shot(page, 'settlement-filled');

  const signed = await signBlock(page, /Sign settlement/, 'Sherif Mohamed Atef');
  if (signed) {
    act('manager', 'Signed the deposit settlement');
    await shot(page, 'settlement-signed');
  } else {
    gap('Settlement', 'settlement could not be signed by the manager');
  }

  const sent = await clickAny(page, [/Send to customer/]);
  if (sent) {
    act('manager', 'Sent the settlement to the customer');
    await page.waitForTimeout(4000);
    await shot(page, 'settlement-sent');
    await surface(page, 'after sending the settlement');
  } else {
    gap('Settlement', 'no action to send the settlement to the customer');
  }

  const state = q(`SELECT status || ' | active=' || contract_active FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → contract:', state);
  console.log('  → settlement row:', q(`SELECT COALESCE((SELECT status FROM contract_settlements WHERE tenancy_contract_id=${contractId} ORDER BY id DESC LIMIT 1),'(none)')`));
  writeState({ afterSettlement: state });
  endStep();
});

test('10f — customer signs the settlement and the tenancy closes', async ({ page }) => {
  const { contractId } = readState();
  beginStep('10f. Settlement — customer signs');

  // Sending the settlement does not mint a settlement-purpose token — the
  // customer reaches it on their existing tenant link.
  const token = q(`SELECT token FROM tenant_portal_tokens
                   WHERE tenancy_contract_id=${contractId} AND revoked=false AND signer_role='tenant'
                   ORDER BY id DESC LIMIT 1`);
  expect(token).toBeTruthy();

  await page.goto(`/portal/${token}/contract/${contractId}/settlement`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'portal-settlement');
  act('customer', 'Followed the settlement link');

  const rejected = await page.locator('text=/This link is for move-out only|link is for/i').first().isVisible().catch(() => false);
  if (rejected) {
    gap('Settlement',
      'Sending the settlement mints no settlement-scoped portal token; the customer\'s live '
      + 'move-out link is refused by the settlement page ("This link is for move-out only").');
    // Fall back to the authenticated customer surface
    const { leadId } = readState();
    await login(page, CUSTOMER);
    await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await shot(page, 'customer-space-settlement');
    await surface(page, 'customer space at settlement');
    act('customer', 'Opened My Spaces to look for the settlement');
    const body = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
    console.log('\n──── CUSTOMER SPACE\n' + body.slice(0, 2500));
  }

  // The authenticated My Spaces route does work — "Agree to settlement".
  const agreed = await clickAny(page, [/Agree to settlement/, /Accept settlement/]);
  if (agreed) {
    act('customer', `Opened the settlement agreement via "${agreed}"`);
    await page.waitForTimeout(3000);
    await shot(page, 'settlement-agree');
    await surface(page, 'settlement agreement');
  }

  // Agreement is a single confirmation, not a signature block — the customer's
  // acceptance is recorded as "YOU AGREED" on the settlement card.
  const body = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  if (/YOU AGREED|You agreed on/i.test(body)) {
    act('customer', 'Agreed to the deposit settlement');
    await shot(page, 'settlement-agreed-by-customer');

    // Capture what the customer is actually shown as owing.
    const owed = body.match(/You still owe\s*\n?\s*(AED [\d,\.]+)/i)?.[1]
              ?? body.match(/Maintenance charges\s*\n?\s*(−|-)?\s*(AED [\d,\.]+)/i)?.[2];
    if (owed) {
      console.log('  → settlement balance shown to the customer:', owed);
      writeState({ settlementBalanceShown: owed });
      gap('Settlement',
        `Settlement auto-seeded maintenance charges from the move-out inspection and shows the customer `
        + `"You still owe ${owed}", even though the manager recorded "no deductions" in the notes.`);
    }
  } else {
    gap('Settlement', 'customer could not complete the settlement agreement');
    console.log('\n──── PAGE\n' + body.slice(0, 2000));
  }

  console.log('  → final contract state:', q(`SELECT status || ' | active=' || contract_active FROM tenancy_contracts WHERE id=${contractId}`));
  endStep();
});
