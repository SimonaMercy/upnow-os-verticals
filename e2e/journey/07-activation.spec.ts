/**
 * STEP 7 — Activate the lease. After both signatures the activation journey
 * still runs Contract Registration → Utility → Move-in → Active.
 *
 * Driven by the MANAGER, who operates the landlord's portfolio: managers never
 * sign the tenancy contract itself, but they do run registration, utility and
 * the move-in inspection.
 */
import { test, expect } from '@playwright/test';
import {
  MANAGER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny, pdf,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** RP 2 = Ahmad Rashed Buti Alfalasi — manager pages need an explicit landlord scope. */
const RP_SCOPE = 2;

test('07 — manager completes registration and utility', async ({ page }) => {
  shotPrefix(7);
  const { contractId } = readState();
  expect(contractId).toBeTruthy();

  beginStep('7. Activation — registration & utility (manager)');

  await login(page, MANAGER);
  act('manager', 'Signed in via OTP', MANAGER);

  await page.goto(`/dashboard/manager/operations?rp=${RP_SCOPE}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await shot(page, 'manager-operations');
  act('manager', 'Opened the operations pipeline', `landlord scope rp=${RP_SCOPE}`);

  const opUrl = `/dashboard/manager/operations/${contractId}?rp=${RP_SCOPE}`;
  const goOp = async () => {
    await page.goto(opUrl);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
  };

  /** Which activation stop the page says it is working on. */
  const currentStop = async () => {
    const t = await page.locator('body').innerText();
    const m = t.match(/WORKING ON THIS STEP\s*\n\s*(.+)/);
    return m ? m[1].trim() : '(unknown)';
  };

  await goOp();
  await shot(page, 'manager-operation-detail');

  // Walk the activation journey while the manager can act on it. Registration
  // and Utility share the same two controls: attach-and-register, or mark the
  // artefact as already on file (imported / paper leases).
  for (let round = 1; round <= 4; round++) {
    await goOp();
    const stop = await currentStop();
    console.log(`\n════ ACTIVATION ROUND ${round} — working on: ${stop}`);
    await shot(page, `stop-${stop.replace(/\W+/g, '-').toLowerCase()}`);

    if (/move-in/i.test(stop)) {
      console.log('  → reached the move-in inspection (handled in step 08)');
      await surface(page, 'move-in step');
      break;
    }
    if (/active/i.test(stop)) break;

    // Attach the artefact this stop expects. Each step owns its own hidden
    // input, so the file must go through THAT button's file chooser — writing
    // to `input[type=file]` directly lands on whichever input renders first
    // (the Ejari one) regardless of which step is open.
    const name = /registration/i.test(stop) ? 'ejari-certificate.pdf' : 'utility-activation.pdf';
    const uploadBtn = page.locator('button:visible').filter({ hasText: /Upload & register/ }).first();

    let clicked: string | null = null;
    if (await uploadBtn.isVisible().catch(() => false)) {
      const chooser = page.waitForEvent('filechooser', { timeout: 15_000 }).catch(() => null);
      await uploadBtn.click();
      const fc = await chooser;
      if (fc) {
        await fc.setFiles(pdf(name));
        clicked = 'Upload & register';
        act('manager', `Attached ${name}`, `for the "${stop}" step`);
      }
    }
    if (!clicked) {
      clicked = await clickAny(page, [/Mark as already on file/]);
    }
    if (!clicked) {
      gap(stop, 'no action available to complete this activation step');
      await surface(page, `blocked at ${stop}`);
      break;
    }
    act('manager', `Completed "${stop}" via "${clicked}"`);
    await page.waitForTimeout(4000);
    await shot(page, `after-${stop.replace(/\W+/g, '-').toLowerCase()}`);

    await goOp();
    if ((await currentStop()) === stop) {
      // Uploading the artefact alone does not always tick the step off — the
      // utility stop only completes when utilityStatus flips to "verified",
      // and the RP/manager upload path never sets it. Fall back to the other
      // control the UI offers.
      gap(stop, `uploading the document did not advance the step — "${clicked}" leaves it open`);
      const marked = await clickAny(page, [/Mark as already on file/]);
      if (marked) {
        act('manager', `Marked "${stop}" as already on file`, 'the only control that actually advances this step');
        await page.waitForTimeout(4000);
        await shot(page, `after-mark-${stop.replace(/\W+/g, '-').toLowerCase()}`);
        await goOp();
      }
      if ((await currentStop()) === stop) {
        gap(stop, 'step could not be completed at all — activation journey blocked here');
        break;
      }
    }
  }

  const state = q(`SELECT status || ' | active=' || contract_active
                          || ' | ejari=' || ejari_status
                          || ' | dewa=' || dewa_status
                   FROM tenancy_contracts WHERE id=${contractId}`);
  console.log('  → contract state:', state);
  writeState({ afterRegistrationUtility: state });

  endStep();
});
