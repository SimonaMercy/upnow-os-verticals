/**
 * STEP 8 — Move-in inspection: the manager walks the unit and submits the
 * inspection, the customer signs it in their portal, the manager counter-signs,
 * and the lease goes Active.
 */
import { test, expect } from '@playwright/test';
import {
  MANAGER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny, signBlock,
} from './helpers';

test.describe.configure({ mode: 'serial' });
const RP_SCOPE = 2;

const CATEGORIES = ['Doors', 'Kitchen', 'Keys & Access'];

test('08a — manager fills and submits the move-in inspection', async ({ page }) => {
  shotPrefix(8);
  const { contractId } = readState();
  expect(contractId).toBeTruthy();

  beginStep('8a. Move-in inspection — manager submits');

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);

  await page.goto(`/dashboard/manager/contracts/${contractId}/inspection/v2?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'inspection-blank');
  act('manager', 'Opened the move-in inspection report');

  // ── Build the component list from the restoration list ──────────────────
  const addCat = page.locator('button').filter({ hasText: /Add Additional Category/ }).first();
  await expect(addCat, 'inspection offers a way to add components').toBeVisible({ timeout: 10_000 });
  await addCat.click();
  await page.waitForTimeout(1500);
  await shot(page, 'add-category-open');

  for (const c of CATEGORIES) {
    const btn = page.locator('button').filter({ hasText: new RegExp(`^${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(400);
    }
  }
  act('manager', 'Added inspection categories', CATEGORIES.join(', '));
  await clickAny(page, [/^Done$/]);
  await page.waitForTimeout(2000);
  await shot(page, 'categories-added');

  // ── Each category starts empty: pull its components from the restoration list ──
  const addComp = page.locator('button').filter({ hasText: /Add sub-category \/ component/ });
  const nCats = await addComp.count();
  console.log(`  → categories awaiting components: ${nCats}`);
  for (let i = 0; i < nCats; i++) {
    // The list re-renders as rows are added, so re-resolve the first empty one.
    const btn = page.locator('button').filter({ hasText: /Add sub-category \/ component/ }).nth(0);
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click();
    await page.waitForTimeout(1500);
    if (i === 0) {
      await shot(page, 'component-picker');
      await surface(page, 'component picker');
    }
    // Components render inline as priced buttons ("Door Frame  AED 180.00/item").
    const options = page.locator('button:visible').filter({ hasText: /AED\s[\d,]+\.\d{2}\// });
    const optCount = await options.count();
    console.log(`     picker offers ${optCount} priced components`);
    if (optCount) {
      const label = (await options.nth(0).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      await options.nth(0).click().catch(() => {});
      console.log(`     + ${label}`);
      await page.waitForTimeout(500);
    }
    await clickAny(page, [/^Done$/]);
    await page.waitForTimeout(1200);
  }
  await shot(page, 'components-added');

  // ── Inspector name + condition per row + notes ──────────────────────────
  const inspectedBy = page.getByPlaceholder(/Inspected by/i).first();
  if (await inspectedBy.isVisible().catch(() => false)) {
    await inspectedBy.fill('Sherif Mohamed Atef');
    await inspectedBy.blur();
    act('manager', 'Recorded who inspected the unit', 'Sherif Mohamed Atef');
  }

  // Condition selects — set everything to the "good" end of the scale
  const selects = page.locator('select:visible');
  const nSel = await selects.count();
  console.log(`  → condition controls: ${nSel}`);
  for (let i = 0; i < nSel; i++) {
    await selects.nth(i).selectOption({ label: 'Good' }).catch(async () => {
      await selects.nth(i).selectOption({ index: 1 }).catch(() => {});
    });
  }
  if (nSel) act('manager', 'Set the condition on every inspected component', 'Good');

  const notes = page.getByPlaceholder(/Overall notes/i).first();
  if (await notes.isVisible().catch(() => false)) {
    await notes.fill('Unit handed over clean and in good order. Keys issued at move-in.');
    await notes.blur();
    act('manager', 'Added overall inspection notes');
  }
  await page.waitForTimeout(1000);
  await shot(page, 'inspection-filled');

  // ── Submit to the customer for signature ────────────────────────────────
  // Save a draft first — until this lands, everything the manager entered
  // lives only in client state.
  const draft = page.locator('button:visible').filter({ hasText: /Save draft/ }).last();
  if (await draft.isVisible().catch(() => false)) {
    await draft.scrollIntoViewIfNeeded().catch(() => {});
    await draft.click();
    await page.waitForTimeout(3000);
    act('manager', 'Saved the inspection draft');
    console.log('  → after draft, move_in_inspection is',
      q(`SELECT CASE WHEN move_in_inspection IS NULL THEN 'NULL' ELSE 'set' END FROM tenancy_contracts WHERE id=${contractId}`));
  }
  await shot(page, 'inspection-draft-saved');

  const submit = page.locator('button:visible').filter({ hasText: /Submit to Tenant/ }).last();
  await expect(submit, 'inspection can be submitted to the customer').toBeVisible();
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  await submit.click({ timeout: 15_000 }).catch((e) => console.log('  ⚠ submit click:', String(e).slice(0, 90)));
  await page.waitForTimeout(2000);

  // Submitting opens a confirm dialog ("the report is locked from further
  // editing") — the action only lands once that is confirmed.
  await shot(page, 'submit-confirm-dialog');
  // The dialog is the only container holding BOTH Cancel and Submit to Tenant.
  const dialog = page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: 'Cancel', exact: true }) })
    .filter({ has: page.getByRole('button', { name: /Submit to Tenant/ }) })
    .last();
  const confirm = dialog.getByRole('button', { name: /Submit to Tenant/ }).last();
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
    await page.waitForTimeout(4000);
    act('manager', 'Confirmed the submission dialog');
  } else {
    gap('Move-in inspection', 'submission confirm dialog never resolved');
  }
  act('manager', 'Submitted the move-in inspection to the customer for signature');
  await shot(page, 'inspection-submitted');
  await surface(page, 'after submitting inspection');

  const insp = q(`SELECT CASE WHEN move_in_inspection IS NULL THEN 'null'
                              ELSE COALESCE(move_in_inspection->>'rpSubmittedAt','∅') END
                  FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → move_in_inspection.rpSubmittedAt:', insp);
  writeState({ moveInSubmittedAt: insp });

  endStep();
});

test('08b — customer signs the move-in inspection in the portal', async ({ page }) => {
  const { contractId } = readState();
  beginStep('8b. Move-in inspection — customer signs');

  // The generic contract token does NOT expose the move-in signature block:
  // the portal gates it on purpose === 'move_in'. The manager has to issue a
  // dedicated move-in link first.
  await login(page, MANAGER);
  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const sent = await clickAny(page, [/Send move-in link/]);
  expect(sent, 'manager can issue a move-in signing link').toBeTruthy();
  await page.waitForTimeout(3000);
  act('manager', 'Sent the customer a move-in signing link');
  await shot(page, 'movein-link-sent');

  const token = q(`SELECT token FROM tenant_portal_tokens
                   WHERE tenancy_contract_id=${contractId} AND revoked=false AND purpose='move_in'
                   ORDER BY id DESC LIMIT 1`);
  expect(token, 'a move-in portal token was issued').toBeTruthy();
  writeState({ moveInToken: token });
  console.log(`  → move-in token: ${token.slice(0, 8)}…`);

  await page.context().clearCookies();
  await page.goto(`/portal/${token}/contract/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'portal-inspection');
  await surface(page, 'portal move-in inspection');
  act('customer', 'Opened the move-in inspection in the portal');

  const ok = await signBlock(page, /Sign move-in/, 'Dev Customer');
  if (ok) {
    act('customer', 'Signed the move-in inspection');
    await shot(page, 'portal-inspection-signed');
  } else {
    gap('Move-in inspection', 'customer could not sign the inspection from the portal');
    console.log('\n──── PORTAL TEXT\n' + (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n').slice(0, 2500));
  }

  const sig = q(`SELECT COALESCE(move_in_inspection->>'tenantSig','∅') FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → tenantSig:', sig === '∅' ? '∅ not signed' : `captured (${sig.length} chars of PNG)`);
  endStep();
});

test('08c — manager counter-signs and the lease goes Active', async ({ page }) => {
  const { contractId } = readState();
  beginStep('8c. Move-in inspection — manager counter-signs');

  // Counter-signing happens through the inspector magic link, not the
  // authenticated inspection workspace.
  await login(page, MANAGER);
  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await shot(page, 'movein-after-customer-signed');

  const sent = await clickAny(page, [/Send inspector link/]);
  expect(sent, 'manager can issue an inspector counter-sign link').toBeTruthy();
  await page.waitForTimeout(3000);
  act('manager', 'Issued the inspection-manager (inspector) link');

  const inspToken = q(`SELECT token FROM tenant_portal_tokens
                       WHERE tenancy_contract_id=${contractId} AND revoked=false AND signer_role='inspector'
                       ORDER BY id DESC LIMIT 1`);
  expect(inspToken, 'an inspector token was issued').toBeTruthy();
  writeState({ inspectorToken: inspToken });
  console.log(`  → inspector token: ${inspToken.slice(0, 8)}…`);

  await page.context().clearCookies();
  await page.goto(`/portal/${inspToken}/contract/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3500);
  await shot(page, 'inspection-countersign');
  await surface(page, 'inspector portal — counter-sign');

  const ok = await signBlock(page, /Counter-sign inspection|Counter-sign move-in/, 'Sherif Mohamed Atef');
  if (ok) {
    act('manager', 'Counter-signed the move-in inspection', 'acting for the landlord');
    await shot(page, 'inspection-countersigned');
  } else {
    gap('Move-in inspection', 'manager could not counter-sign the inspection');
    console.log('\n──── PORTAL\n' + (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n').slice(0, 2000));
  }

  await login(page, MANAGER);

  await page.goto(`/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await shot(page, 'after-movein');

  const state = q(`SELECT status || ' | active=' || contract_active
                          || ' | moveInCounterSig=' || CASE WHEN move_in_inspection->>'rpCounterSig' IS NULL
                                                            THEN '∅' ELSE 'captured' END
                   FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → contract state:', state);
  writeState({ afterMoveIn: state });

  endStep();
});
