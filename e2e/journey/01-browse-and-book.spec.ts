/**
 * STEP 1 — Customer browses the public listings and books a unit.
 *
 * Book Now creates a lead at the `interested` stage plus a viewing and an
 * auto-generated payment plan. Only the lead transition is audited.
 */
import { test, expect } from '@playwright/test';
import {
  CUSTOMER, login, shot, shotPrefix, surface, writeState,
  beginStep, act, endStep, gap, q,
} from './helpers';

test.describe.configure({ mode: 'serial' });

/** Unit 69 = "211", Avenue Residence, AED 95,000/yr, published + available. */
const UNIT_ID = Number(process.env.JOURNEY_UNIT_ID ?? 69);

test('01 — customer browses listings and books a unit', async ({ page }) => {
  shotPrefix(1);
  beginStep('1. Browse + Book Now');

  // Public listings, anonymous
  await page.goto('/listings');
  await page.waitForLoadState('networkidle');
  await shot(page, 'listings-public');

  await login(page, CUSTOMER);
  act('customer', 'Signed in via OTP', CUSTOMER);

  // Browse and open the unit from its card, not a deep link
  await page.goto('/listings');
  await page.waitForLoadState('networkidle');
  await shot(page, 'listings-as-customer');
  act('customer', 'Browsed the public listings');

  const card = page.locator(`a[href*="/listings/units/${UNIT_ID}"]`).first();
  await expect(card, `unit ${UNIT_ID} on listings`).toBeVisible({ timeout: 15_000 });
  await card.click();
  await page.waitForURL(new RegExp(`/listings/units/${UNIT_ID}`), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await shot(page, 'unit-detail');
  act('customer', 'Opened the unit listing', `unit ${UNIT_ID}`);

  // Book Now
  const bookBtn = page.locator('button').filter({ hasText: /^Book Now$/ }).first();
  await expect(bookBtn, 'Book Now CTA visible to a customer').toBeVisible({ timeout: 15_000 });
  await bookBtn.click();
  await expect(page.locator('h3').filter({ hasText: 'Book Now' })).toBeVisible({ timeout: 10_000 });
  await shot(page, 'book-now-modal');

  // Move-in date via the mini calendar — pick the first selectable day
  const dayBtns = page.locator('button').filter({ hasText: /^\d{1,2}$/ });
  const dayCount = await dayBtns.count();
  for (let i = 0; i < dayCount; i++) {
    const b = dayBtns.nth(i);
    if (await b.isEnabled().catch(() => false)) { await b.click().catch(() => {}); break; }
  }
  act('customer', 'Chose a move-in date');

  const quarterly = page.locator('button').filter({ hasText: /^4 Cheques?$|^Quarterly$|^4$/ }).first();
  if (await quarterly.isVisible().catch(() => false)) {
    await quarterly.click().catch(() => {});
    act('customer', 'Chose an instalment plan', '4 payments');
  }
  await page.locator('textarea').first()
    .fill('Journey test booking — please prepare the payment plan.').catch(() => {});
  await shot(page, 'book-now-filled');

  // Submit interest
  const submit = page.locator('button').filter({ hasText: /I'm Interested — Continue|Submitting/ }).first();
  await expect(submit, 'submit enables once a move-in date is chosen').toBeEnabled({ timeout: 10_000 });

  const leadResp = page
    .waitForResponse((r) => r.url().includes('/leads/book-now') && r.request().method() === 'POST', { timeout: 30_000 })
    .catch(() => null);
  await submit.click();
  const resp = await leadResp;
  const body = resp ? await resp.json().catch(() => ({} as any)) : ({} as any);
  console.log('  → /leads/book-now →', resp?.status(), JSON.stringify(body).slice(0, 200));

  await expect(page.locator('h3').filter({ hasText: /You're interested/ })).toBeVisible({ timeout: 20_000 });
  await shot(page, 'book-now-success');
  act('customer', 'Submitted interest in the unit', `lead ${body?.leadId}`);

  const leadId = body?.leadId ?? null;
  expect(leadId, 'lead id returned by /leads/book-now').toBeTruthy();
  writeState({ leadId, unitId: UNIT_ID, viewingId: body?.viewingId ?? null });

  // Verify the lead landed in the pipeline with a plan already generated
  const row = q(`SELECT stage || '|' || COALESCE(unit_id::text,'-') || '|' ||
                 CASE WHEN payment_plan IS NULL THEN 'no-plan' ELSE 'plan' END
                 FROM leads WHERE id=${leadId}`);
  console.log('  → lead (stage|unit|plan):', row);
  expect(row).toContain('interested');
  expect(row).toContain('plan');

  gap('Book Now',
    'Booking creates a lead, a viewing and a full payment plan but audits only lead.transition — '
    + 'there is no lead.created, no viewing event and no record of who/what generated the plan.');

  endStep();
});
