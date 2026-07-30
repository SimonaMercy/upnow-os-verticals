/**
 * STEP 2 — Customer completes their side in My Spaces: identity + supporting
 * documents, personal details, then submits the pack for review.
 */
import { test, expect } from '@playwright/test';
import {
  CUSTOMER, login, shot, shotPrefix, surface, readState, writeState,
  beginStep, act, endStep, gap, png, pdf, q,
} from './helpers';

test.describe.configure({ mode: 'serial' });

test('02 — customer uploads documents and submits for review', async ({ page }) => {
  shotPrefix(2);
  const { leadId } = readState();
  expect(leadId, 'lead from step 01').toBeTruthy();

  beginStep('2. Customer documents & KYC');

  await login(page, CUSTOMER);
  act('customer', 'Signed in via OTP', CUSTOMER);

  await page.goto('/dashboard/customer/spaces');
  await page.waitForLoadState('networkidle');
  await shot(page, 'spaces-list');
  act('customer', 'Opened My Spaces');

  await page.goto(`/dashboard/customer/spaces/v2/v-${leadId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await shot(page, 'space-docs-step');

  // The customer-facing journey model
  const body = await page.locator('body').innerText();
  const stops = (body.match(/\n(Booked|Docs|Payment|Sign|Registration|Utility|Move-in|Active)\n/g) ?? [])
    .map((s) => s.trim());
  console.log('  → customer journey stops:', JSON.stringify(stops));
  writeState({ customerJourneyStops: stops });

  /** Doc name = label text up to the Required/Optional pill (the hint may also say "Required"). */
  const scanSlots = () =>
    page.locator('input[type="file"]').evaluateAll((els) =>
      els.map((e) => {
        // The row is a [data-doc-key] div; the <label> wraps only the action pill.
        const t = ((e as HTMLInputElement).closest('[data-doc-key]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        const m = t.match(/^(.*?)(Required|Optional)/);
        return {
          name: (m ? m[1] : t).trim(),
          required: m?.[2] === 'Required',
          done: /Replace|Approved|awaiting review/i.test(t),
        };
      }),
    );

  const slots = await scanSlots();
  console.log(`\n──── UPLOAD SLOTS (${slots.length})`);
  slots.forEach((d) => console.log(`   · ${d.required ? 'REQUIRED' : 'optional'} — ${d.name}`));
  expect(slots.length, 'customer is offered upload slots').toBeGreaterThan(0);

  // Upload the required set; re-locate by name because finishing them re-renders the list
  for (const slot of slots.filter((s) => s.required && !s.done)) {
    const isPdfish = /tenancy|contract|salary|bank|statement|trade|licence|license/i.test(slot.name);
    const input = page.locator('[data-doc-key]', { hasText: slot.name }).locator('input[type="file"]').first();
    await input.setInputFiles(isPdfish ? pdf('doc.pdf') : png('doc.png'), { timeout: 20_000 });
    act('customer', 'Uploaded document', slot.name);
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(1500);
  await shot(page, 'docs-uploaded');

  // Personal details — OCR is gated off, so these are entered by hand
  const pdCard = page.getByTestId('personal-details');
  const pdState = await pdCard.getAttribute('data-state').catch(() => null);
  console.log('  → personal-details card state:', pdState);
  await shot(page, 'personal-details-card');

  const editToggle = page.locator('button').filter({ hasText: /Something not right\? Edit details/ }).first();
  if (await editToggle.isVisible().catch(() => false)) {
    await editToggle.click();
    await page.waitForTimeout(800);
    act('customer', 'Opened "Edit details"', 'read-only chips had to be unlocked');
    gap('Documents / KYC',
      'The personal-details card shows a green "Provided" pill while the submit gate is still blocked '
      + 'on a missing Emirates ID number; the fields only unlock behind a small "Something not right?" link.');
  }

  const setField = async (labelRe: RegExp, value: string) => {
    const f = pdCard.locator('label, div').filter({ hasText: labelRe }).last().locator('input').first();
    if (await f.isVisible().catch(() => false)) {
      await f.fill(value); await f.blur(); await page.waitForTimeout(900);
    }
  };
  await setField(/first name/i, 'Dev');
  await setField(/last name/i, 'Customer');
  await setField(/nationality/i, 'United Arab Emirates');
  const eid = page.getByPlaceholder(/784-/).first();
  if (await eid.isVisible().catch(() => false)) {
    await eid.fill('784-1990-1234567-1');
    await eid.blur();
    await page.waitForTimeout(1200);
    act('customer', 'Entered personal details', 'name, nationality, Emirates ID number');
    gap('Documents / KYC', 'Personal details (name, nationality, Emirates ID) are PATCHed to /auth/me with no audit row.');
  }
  await shot(page, 'personal-details-filled');

  // Submit the pack
  const submit = page.locator('button')
    .filter({ hasText: /Submit documents for review|Upload all required docs|Enter your name/ }).first();
  const label = (await submit.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  console.log('  → submit reads:', JSON.stringify(label), 'enabled:', await submit.isEnabled().catch(() => false));

  if (await submit.isEnabled().catch(() => false)) {
    await submit.click();
    act('customer', 'Submitted documents for review');
    await page.waitForTimeout(2500);
    await shot(page, 'docs-submitted');
    gap('Documents / KYC',
      '"Submit documents for review" is localStorage-only (writeDocsSubmitted) — no server call, no audit '
      + 'row, no signal to the landlord, and the milestone is lost on another device.');
  } else {
    await shot(page, 'docs-submit-blocked');
    gap('Documents / KYC', `customer could not submit: "${label}"`);
  }

  console.log('  → docs on file:', q(`SELECT count(*) FROM documents WHERE owner_type='customer' AND owner_id=115 AND deleted_at IS NULL`));
  await surface(page, 'after submitting documents');
  endStep();
});
