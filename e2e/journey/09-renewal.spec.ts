/**
 * STEP 9 — Propose a renewal on the same lease and take it through to the
 * customer's decision.
 */
import { test, expect } from '@playwright/test';
import {
  RP, CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, q, clickAny, png,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('09a — landlord proposes a renewal', async ({ page }) => {
  shotPrefix(9);
  const { contractId } = readState();
  expect(contractId).toBeTruthy();

  beginStep('9a. Renewal — landlord proposes');

  await login(page, RP);
  act('landlord', 'Signed in via OTP', RP);

  await page.goto(`/rental-provider/dashboard/operations/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'active-lease');
  act('landlord', 'Opened the active tenancy', `CID-${contractId}`);

  const propose = page.locator('button, a').filter({ hasText: /Propose renewal/ }).first();
  await expect(propose, 'active lease offers a renewal').toBeVisible({ timeout: 10_000 });
  await propose.click();
  await page.waitForTimeout(3000);
  await shot(page, 'renewal-draft-form');

  // Report the renewal form's own fields
  const fields = await page.locator('input:visible, select:visible').evaluateAll((els) =>
    els.map((e) => {
      const el = e as HTMLInputElement;
      return `${el.tagName.toLowerCase()}[${el.type ?? ''}] ${el.placeholder || el.name || el.id || ''} = ${el.value ?? ''}`.trim();
    }),
  );
  console.log('\n──── RENEWAL FORM FIELDS\n' + fields.map((f) => `   · ${f}`).join('\n'));

  // Bump the rent for the renewal term
  const rent = page.locator('input[type="number"]:visible').first();
  if (await rent.isVisible().catch(() => false)) {
    await rent.fill('99000');
    await rent.blur();
    act('landlord', 'Set the renewal rent', 'AED 99,000 (was 95,000)');
  } else {
    gap('Renewal', 'no rent field on the renewal draft form');
  }
  await page.waitForTimeout(1000);
  await shot(page, 'renewal-filled');

  const saved = await clickAny(page, [/Save renewal draft/]);
  expect(saved, 'renewal draft can be saved').toBeTruthy();
  act('landlord', 'Saved the renewal draft');
  await page.waitForTimeout(4000);
  await shot(page, 'renewal-draft-saved');
  await surface(page, 'after saving renewal draft');

  const renewal = q(`SELECT COALESCE((SELECT id || ' | ' || status || ' | ' || annual_rent || ' | ' || contract_start_date
                                      FROM tenancy_contracts WHERE parent_contract_id=${contractId} AND contract_type='renewal'
                                      ORDER BY id DESC LIMIT 1), '(no renewal contract)')`);
  console.log('  → renewal contract:', renewal);
  const renewalId = renewal.split(' | ')[0];
  if (/^\d+$/.test(renewalId)) writeState({ renewalContractId: Number(renewalId) });

  endStep();
});

test('09b — landlord sends the renewal to the customer', async ({ page }) => {
  const { contractId } = readState();
  beginStep('9b. Renewal — sent to customer');

  await login(page, RP);
  await page.goto(`/rental-provider/dashboard/operations/${contractId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'renewal-pending');
  await surface(page, 'lease with a renewal draft');

  const text = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  const i = text.indexOf('WORKING ON THIS STEP');
  console.log('\n──── RENEWAL STEP\n' + text.slice(i > 0 ? i : 0, (i > 0 ? i : 0) + 2000));

  // The send control is labelled with the customer's own name
  // ("Send to Dev Customer"), not a generic "Send renewal".
  const sent = await clickAny(page, [/Send to Dev Customer/, /^Send to /, /Send renewal/, /Share renewal/]);
  if (sent) {
    act('landlord', `Sent the renewal offer to the customer via "${sent}"`);
    await page.waitForTimeout(4000);
    await shot(page, 'renewal-sent');
    await surface(page, 'after sending the renewal');
  } else {
    gap('Renewal', 'no action to send the renewal offer to the customer');
  }

  const { renewalContractId } = readState();
  if (renewalContractId) {
    console.log('  → renewal contract:', q(`SELECT status || ' | sent=' || contract_sent FROM tenancy_contracts WHERE id=${renewalContractId}`));
  }
  console.log('  → parent renewal_status:', q(`SELECT COALESCE(renewal_status,'∅') FROM tenancy_contracts WHERE id=${contractId}`));
  endStep();
});

test('09c — customer reviews and accepts the renewal', async ({ page }) => {
  const { contractId, renewalContractId, leadId } = readState();
  beginStep('9c. Renewal — customer decides');

  await login(page, CUSTOMER);
  act('customer', 'Signed in via OTP', CUSTOMER);

  await page.goto('/dashboard/customer/spaces');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await shot(page, 'customer-spaces-renewal');

  // The space keeps the key it was created with (v-<leadId>); the card just
  // flips to "Renewal Offered".
  await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await shot(page, 'customer-renewal-offer');
  await surface(page, 'customer renewal offer');
  act('customer', 'Reviewed the renewal offer', 'AED 99,000 for 2 Aug 2027 – 1 Aug 2028');

  const text = (await page.locator('body').innerText()).replace(/\n{3,}/g, '\n\n');
  const i = text.indexOf('YOU ARE HERE') >= 0 ? 0 : 0;
  console.log('\n──── CUSTOMER RENEWAL VIEW\n' + text.slice(i, i + 3000));

  // Acceptance is gated: preview the contract, then confirm the payments are
  // ready. Only then does "Accept renewal terms" enable.
  const preview = page.getByTestId('renewal-preview-contract');
  if (await preview.isVisible().catch(() => false)) {
    await preview.click().catch(() => {});
    await page.waitForTimeout(2500);
    act('customer', 'Previewed the renewal contract before accepting');
    // The preview may open in a new tab — come back to the space.
    const pages = page.context().pages();
    if (pages.length > 1) {
      await shot(pages[pages.length - 1], 'renewal-contract-preview');
      await pages[pages.length - 1].close();
    }
    await page.bringToFront();
    await page.waitForTimeout(1000);
  }

  const pdc = page.getByTestId('renewal-pdc-input');
  if (await pdc.isVisible().catch(() => false)) {
    await pdc.setInputFiles(png('renewal-cheques.png')).catch(() => {});
    await page.waitForTimeout(2500);
    act('customer', 'Attached the renewal payment references');
  }

  const ready = page.getByTestId('renewal-payment-ready');
  if (await ready.isVisible().catch(() => false)) {
    if ((await ready.getAttribute('type')) === 'checkbox') {
      await ready.check().catch(() => {});
    } else {
      await ready.click().catch(() => {});
    }
    await page.waitForTimeout(2000);
    act('customer', 'Confirmed their renewal payments are ready');
    await shot(page, 'renewal-payments-ready');
  }

  const accepted = await clickAny(page, [
    /Accept renewal terms/, /Accept renewal/, /Accept & continue/, /^Accept$/,
  ]);
  if (accepted) {
    act('customer', `Accepted the renewal via "${accepted}"`);
    await page.waitForTimeout(4000);
    await shot(page, 'renewal-accepted');
    await surface(page, 'after accepting the renewal');
  } else {
    gap('Renewal', 'customer had no visible action to accept the renewal offer');
  }

  console.log('  → parent renewal_status:', q(`SELECT COALESCE(renewal_status,'∅') || ' / accepted=' || COALESCE(renewal_accepted::text,'∅') FROM tenancy_contracts WHERE id=${contractId}`));
  if (renewalContractId) {
    console.log('  → renewal contract:', q(`SELECT status FROM tenancy_contracts WHERE id=${renewalContractId}`));
  }
  endStep();
});
