import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/2a299e2c-8e1d-4e46-bf19-20e0128f77fd/scratchpad/shots';
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}
// Manager (not landlord) working CID-181 — the 17,500 bounce paid in two parts.
// Rows: 454 = the bounce, 2957 = 10,000, 2958 = 7,500, 452/453 = ordinary
// cleared instalments that must NOT be linkable to it.
test('manager links an already-recorded payment; unrelated instalments are refused', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1250 });
  await signIn(page, 'unibuild00@gmail.com');

  // Free up 7,500 of the bounce so the guards below have room to be the reason
  // a link is refused (a fully-covered bounce is refused for that reason alone).
  const unlink = await page.request.patch('/api/contracts/181/payments/2958?rp=2', { data: { replacesPaymentId: null } });
  expect(unlink.ok()).toBeTruthy();

  // Guard 1 — an instalment collected BEFORE the cheque bounced is not the money
  // that replaced it. This is the dangerous one: 452 is an ordinary cleared
  // instalment whose money is already spoken for, and attributing it here would
  // settle the bounce on paper with nothing behind it.
  const early = await page.request.patch('/api/contracts/181/payments/452?rp=2', { data: { replacesPaymentId: 454 } });
  expect(early.status()).toBe(400);
  expect(JSON.stringify(await early.json())).toMatch(/cannot be the money that replaced it/i);

  // Guard 2 — a payment larger than the shortfall belongs to something else too.
  const tooBig = await page.request.patch('/api/contracts/181/payments/455?rp=2', { data: { replacesPaymentId: 454 } });
  expect(tooBig.status()).toBe(400);
  expect(JSON.stringify(await tooBig.json())).toMatch(/only needs AED 7,500 more/i);

  await page.goto('/dashboard/manager/contracts/181/v2?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/20-manager-linked-state.png`, fullPage: true });

  // Both part-payments are CLEARED, so they carry the link affordance (a cleared
  // row has no Edit button at all).
  const linked = page.getByRole('button', { name: /^Linked$/ });
  await expect(linked.first()).toBeVisible({ timeout: 20_000 });
  expect(await linked.count()).toBe(1); // 10,000 still linked; 7,500 freed above

  await expect(page.getByText(/Part-replaced/i).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/22-manager-part-replaced.png`, fullPage: true });

  // Guard 2: with only 7,500 left owed, a 17,500 instalment is not even offered.
  const row2958 = page.locator('tr', { hasText: '7,500' }).filter({ hasText: 'Partial payment' }).first();
  await row2958.getByRole('button', { name: /Link to bounce/i }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/21-manager-link-panel.png` });
  const sel = page.locator('select').filter({ hasText: 'No — an ordinary cheque' }).first();
  const opts = await sel.locator('option').allTextContents();
  expect(opts.join(' | ')).toMatch(/7,500 still owed/);
  expect(opts).toHaveLength(2); // "No" + the one bounce it may legally pay

  await sel.selectOption({ index: 1 });
  await page.getByRole('button', { name: /Save link/i }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/24-manager-restored.png`, fullPage: true });
  expect(await page.getByRole('button', { name: /^Linked$/ }).count()).toBe(2);
  await expect(page.getByText(/Part-replaced/i)).toHaveCount(0);
});
