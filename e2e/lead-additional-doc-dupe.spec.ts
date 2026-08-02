/**
 * Lead → Interested (documents) step: requesting an additional document whose
 * name maps onto a KYC slot we ALREADY collect (e.g. "UAE Visa / Residence
 * Visa" ⇢ the `uae_visa` supporting slot) must NOT draw a second full row with
 * its own View / approve / reject / Replace buttons. The checklist row above is
 * the single place to act on that document; the request row only records the ask.
 *
 * Fixture: local prod clone, RP 2, manager sheco1300@yahoo.com, lead 8.
 * Untracked spec; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/8e922334-74ba-48d2-8d26-ae77587ddfcf/scratchpad/lead-doc-dupe';
const MGR = 'sheco1300@yahoo.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

test('a requested doc that maps to an existing slot renders once', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1280, height: 1400 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/leads/8?rp=2');
  await page.waitForLoadState('networkidle');

  const panel = page.locator('.docitem');
  await expect(panel.first()).toBeVisible();

  // Ask for the UAE visa — the same document the supporting checklist collects.
  const search = page.getByPlaceholder('Search or type a document name');
  await search.click();
  await search.fill('UAE Visa / Residency');
  await search.press('Enter');

  // Exactly one row carries the document's actions; the request row is a stub.
  const actionable = page.locator('.docitem').filter({ hasText: 'UAE Visa' }).filter({ has: page.getByRole('button', { name: 'View' }) });
  await expect(actionable).toHaveCount(1);

  // The stub reads under the CHECKLIST's label, so both rows name one document.
  const stub = page.locator('.docitem').filter({ hasText: 'already in the checklist above' });
  await expect(stub).toHaveCount(1);
  await expect(stub).toContainText('UAE Visa / Residency');

  await page.screenshot({ path: `${SHOTS}/requested-existing-slot.png`, fullPage: true });
});

test('identity documents carry an expiry field the RP fills in at review', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1280, height: 1400 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/leads/8?rp=2');
  await page.waitForLoadState('networkidle');

  // Every expiring identity / licence copy gets a date control; nothing is
  // pre-selected, so the calendar never suggests a date the RP didn't choose.
  const trigger = page.getByRole('button', { name: 'Passport expiry date', exact: true });
  await expect(trigger).toBeVisible();
  // Start undated whatever a previous run left behind.
  const clear = page.getByRole('button', { name: 'Clear Passport expiry date' });
  if (await clear.count()) { await clear.click(); await expect(clear).toHaveCount(0); }
  await expect(trigger).toHaveText(/DD-MM-YYYY/);

  // An undated copy cannot be approved — neither the row's tick (when the doc is
  // still pending, so a tick is drawn at all) nor the step as a whole.
  const row = page.locator('.docitem').filter({ hasText: 'Passport' }).first();
  const tick = row.locator('.mini-btn.ok');
  if (await tick.count()) await expect(tick).toBeDisabled();
  await expect(page.getByRole('button', { name: /Approve documents/ })).toBeDisabled();

  // Year is a dropdown, not a month-by-month walk — an expiry is years out.
  await trigger.click();
  const pop = page.getByRole('dialog', { name: 'Passport expiry date' });
  await pop.locator('select').last().selectOption('2031');
  const save = page.waitForResponse(r => /\/api\/documents\/\d+$/.test(r.url()) && r.request().method() === 'PATCH');
  await pop.locator('.rdp-day_button', { hasText: /^15$/ }).first().click();
  expect((await save).ok()).toBeTruthy();

  await expect(trigger).toHaveText(/2031/);
  if (await tick.count()) await expect(tick).toBeEnabled();

  // The date is on the document, not just in the page's head.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Passport expiry date', exact: true })).toHaveText(/2031/);

  await page.screenshot({ path: `${SHOTS}/expiry-on-lead-docs.png`, fullPage: true });
});
