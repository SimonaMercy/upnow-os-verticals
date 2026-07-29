/**
 * STEP 4 — Customer reviews the shared payment plan and submits a payment
 * reference for every line.
 */
import { test, expect } from '@playwright/test';
import {
  CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, png, q,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('04 — customer reviews the plan and submits payment confirmation', async ({ page }) => {
  shotPrefix(4);
  const { leadId } = readState();
  expect(leadId).toBeTruthy();

  beginStep('4. Customer payment confirmation');

  await login(page, CUSTOMER);
  act('customer', 'Signed in via OTP', CUSTOMER);

  await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await shot(page, 'payment-plan');
  act('customer', 'Reviewed the shared payment plan');

  const total = await page.locator('text=/GRAND TOTAL/').first()
    .locator('xpath=..').innerText().catch(() => '');
  console.log('  → plan total on screen:', total.replace(/\s+/g, ' ').slice(0, 80));

  // One reference per payment; the trailing input is the bulk box, so stop before it
  const inputs = page.locator('input[type="file"]');
  const n = (await inputs.count()) - 1;
  console.log(`  → per-payment reference slots: ${n}`);
  expect(n, 'a reference slot per payment').toBeGreaterThan(0);

  for (let i = 0; i < n; i++) {
    await inputs.nth(i).setInputFiles(png(`payment-ref-${i}.png`), { timeout: 20_000 })
      .catch((e) => console.log(`   ⚠ slot ${i}: ${String(e).slice(0, 70)}`));
    act('customer', 'Attached a payment reference', `payment ${i + 1} of ${n}`);
    await page.waitForTimeout(1800);
  }
  await page.waitForTimeout(1500);
  await shot(page, 'payment-refs-attached');

  const confirm = page.locator('button').filter({ hasText: /I.ve made the payments/i }).first();
  expect(await confirm.isEnabled().catch(() => false), 'customer can confirm payments').toBe(true);
  await confirm.click();
  act('customer', 'Confirmed the payments were made');
  await page.waitForTimeout(3500);
  await shot(page, 'payments-confirmed');
  await surface(page, 'after confirming payments');

  const stage = q(`SELECT stage FROM leads WHERE id=${leadId}`);
  console.log('  → lead stage:', stage, '· lead_cheques:', q(`SELECT count(*) FROM lead_cheques WHERE lead_id=${leadId}`));
  expect(stage).toBe('cheques_submitted');
  writeState({ leadStageAfterStep4: stage });

  gap('Payment confirmation',
    'Each reference is audited as lead.cheque.upload but against entity `viewing`, not the lead or the '
    + 'cheque row — so the trail does not point at the record it created.');
  endStep();
});
