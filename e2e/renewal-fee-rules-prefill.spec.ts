/**
 * Propose renewal, manager side (contract 394, rp=2): the fee fields follow the
 * RP's FEE RULES, not the parent lease's historic figures.
 *
 * RP 2 has commission switched OFF in every category (fee_rules.is_active = false)
 * while lease 394 still carries a 4,750 commission row from before that decision —
 * so the modal must prefill commission as a visible **0**, and keep admin (1,000) /
 * Contract Registration (250) from the same rules.
 *
 * Also pins the renamed rent labels: "Annual Rent", "Contract Value",
 * "Contract Value after discount".
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const S = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/1ef864e2-eb06-463e-a38d-02b3528471a1/scratchpad/renewal-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('renewal fee prefill follows the RP fee rules; commission shows 0', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(S, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'sheco1300@yahoo.com');

  // ?action=renew opens the Propose renewal modal directly.
  await page.goto('/dashboard/manager/operations/394?rp=2&action=renew');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const modal = page.locator('.modal.xl').filter({ hasText: 'Propose renewal' });
  await expect(modal).toBeVisible({ timeout: 30_000 });

  const fieldValue = async (label: string) =>
    modal.locator('.field', { has: page.getByText(label, { exact: true }) }).locator('input').inputValue();

  const commission = await fieldValue('Commission');
  const admin = await fieldValue('Admin fee');
  const ejari = await fieldValue('Contract Registration fee');
  console.log(`commission="${commission}" admin="${admin}" ejari="${ejari}"`);

  // The RP switched commission off → an explicit 0, still visible + editable.
  expect(commission, 'commission prefilled 0 from the rules, NOT the parent 4750').toBe('0');
  await expect(modal.locator('.field', { has: page.getByText('Commission', { exact: true }) }).locator('input')).toBeEditable();
  expect(admin, 'admin fee from the rules').toBe('1000');
  expect(ejari, 'Contract Registration fee from the rules').toBe('250');

  // Renamed labels; Contract Value is its own always-visible field now.
  await expect(modal.getByText('Annual Rent', { exact: true })).toBeVisible();
  await expect(modal.getByText('Contract Value', { exact: true })).toBeVisible();
  expect(await modal.getByText('Listed annual rent (AED)').count(), 'old label gone').toBe(0);
  expect(await modal.getByText('Net annual rent (AED)').count(), 'old label gone').toBe(0);
  // Mode of payment + cheque payee are inherited from the parent lease, not re-asked.
  expect(await modal.getByText('Mode of payment').count(), 'mode of payment removed').toBe(0);
  expect(await modal.getByText(/Cheques payable to/).count(), 'cheque payee removed').toBe(0);

  // "Current contract" reads as labelled facts, not four lines of grey text.
  for (const l of ['Customer', 'Unit', 'Current term', 'Current rent']) {
    await expect(modal.locator('.curcontract').getByText(l, { exact: true })).toBeVisible();
  }
  await expect(modal.locator('.curcontract').getByText('12 months')).toBeVisible();

  // Payment frequency reads as a frequency, not a bare cheque count. The list is
  // still filtered to the plans this RP offers (Settings → Rules; rp 2 = 1/2/4).
  const plan = modal.locator('.field', { has: page.getByText('Payments / Year', { exact: true }) }).locator('select');
  expect(await plan.inputValue()).toBe('4');
  expect((await plan.locator('option').allInnerTexts()).map(t => t.trim()))
    .toEqual(['1 — Annual', '2 — Semi-annual', '4 — Quarterly']);

  await page.screenshot({ path: `${S}/renewal-modal-fees.png`, fullPage: true });

  // Rent-increase readout: typing a new rent shows the % move off the current one.
  const rentInput = modal.locator('.field', { has: page.getByText('Annual Rent', { exact: true }) }).locator('input');
  await rentInput.fill('120000');
  await page.waitForTimeout(600);
  await expect(modal.getByText(/↑ 27\.7%/)).toBeVisible(); // 94,000 → 120,000
  await rentInput.fill('90000');
  await page.waitForTimeout(400);
  await expect(modal.getByText(/↓ 4\.3%/)).toBeVisible();
  await rentInput.fill('120000');
  await page.waitForTimeout(400);

  // With a discount: the value field shows what it's worth in AED, and the
  // Contract Value label itself carries "after discount".
  await modal.locator('.rentcalc select').selectOption('percent');
  await modal.getByLabel('Discount value').fill('10');
  await page.waitForTimeout(600);
  await expect(modal.getByText(/− AED 12,000/)).toBeVisible();
  await expect(modal.getByText('Contract Value after discount', { exact: true })).toBeVisible();
  expect(await modal.getByText(/Net annual rent after discount/).count(), 'old label gone').toBe(0);
  expect(await fieldValue('Contract Value after discount')).toBe('AED 108,000');

  // A percentage rule would follow the rent; commission is OFF, so it stays 0
  // even after the rent moves.
  expect(await fieldValue('Commission'), 'off rule stays 0 as the rent changes').toBe('0');

  await page.screenshot({ path: `${S}/renewal-modal-discounted.png`, fullPage: true });

  // A stray click on the backdrop must NOT bin the form.
  await page.locator('.mscrim').click({ position: { x: 12, y: 12 } });
  await page.waitForTimeout(500);
  await expect(modal, 'backdrop click keeps the modal open').toBeVisible();
  expect(await fieldValue('Annual Rent'), 'entered rent survives the backdrop click').toBe('120000');
});
