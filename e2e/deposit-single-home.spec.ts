import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// A security deposit lives in ONE place — the register — and is presented as its
// own section everywhere, never as a payment category (migration 0191).
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/945c51cb-be6d-4cd8-bf26-c856bdb6d8e7/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('the deposit is a register record, in its own section, on every surface', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1300 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // ── The API: no deposit is a payment row any more ───────────────────────
  const ledger = await (await page.request.get('/api/contracts/payments')).json() as Array<{
    id: string; paymentType: string; amount: number; status: string;
  }>;
  const deposits = ledger.filter(r => r.paymentType === 'security_deposit');
  // Every deposit row now comes from the register (`sd_<id>`); a `pm_<id>` row
  // would mean a deposit was read out of the payments table again.
  expect(deposits.length).toBeGreaterThan(0);
  for (const d of deposits) expect(d.id.startsWith('sd_')).toBeTruthy();
  // eslint-disable-next-line no-console
  console.log('deposit rows', deposits.length, 'all register-backed');

  // CID-342 — one of the four leases whose deposit was a cheque until 0191.
  const c342 = await (await page.request.get('/api/contracts/342')).json() as {
    securityDeposit: { depositId: number; amount: number; chequeStatus: string } | null;
    payments: Array<{ paymentType: string }>;
  };
  // eslint-disable-next-line no-console
  console.log('CID-342 deposit', JSON.stringify(c342.securityDeposit));
  expect(c342.securityDeposit?.depositId).toBeTruthy();
  expect(c342.securityDeposit?.amount).toBe(4000);
  expect(c342.payments.some(p => p.paymentType === 'security_deposit')).toBeFalsy();

  // ── The contract page: its own section, with Settle now reachable ────────
  await page.goto('/rental-provider/dashboard/contracts/342/v2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  const depositSection = page.locator('.sec').filter({ hasText: 'Security Deposit' }).first();
  await expect(depositSection).toBeVisible();
  await expect(depositSection.getByText('AED 4,000').first()).toBeVisible();
  // The action that the payment-backed row never had.
  await expect(depositSection.getByRole('link', { name: /Settle/ })).toBeVisible();
  // And it is NOT inside the Payments table any more.
  const paymentsSection = page.locator('.sec').filter({ hasText: 'Rental Income' }).first();
  await expect(paymentsSection.getByText('Security Deposit')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/deposit-contract-section.png`, fullPage: false });

  // ── Operations detail renders the same component, so the same section ────
  await page.goto('/rental-provider/dashboard/operations/342', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await expect(page.locator('.sec').filter({ hasText: 'Security Deposit' }).first()).toBeVisible();
  // The activation-journey card's plan summary carries the deposit too, and its
  // reference/method now come from the register — an em-dash there would mean the
  // plan is still hunting for a deposit payment row that no longer exists.
  const planDepositRow = page.locator('tr').filter({ hasText: 'Security Deposit' })
    .filter({ hasText: '4,000' }).first();
  const rowText = (await planDepositRow.innerText()).replace(/\s+/g, ' ');
  // eslint-disable-next-line no-console
  console.log('ops plan deposit line:', rowText);
  expect(rowText).toContain('7EA88900477E');
  expect(rowText).toContain('Bank transfer');
  await page.screenshot({ path: `${SHOTS}/deposit-operations-detail.png`, fullPage: false });

  // (The empty state and the Add flow live in deposit-add-flow.spec.ts — one spec
  // owns CID-340, so the two cannot race over whether it has a deposit.)

  // ── The Payments ledger: four categories, deposits in their own section ──
  await page.goto('/rental-provider/dashboard/payments', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  const body = (await page.locator('body').innerText());
  expect(body).toContain('Security Deposits');
  expect(body).toContain('Held for the customer, refundable at move-out');
  // The category card is gone — the heading above the ledger no longer offers it.
  const cards = await page.locator('main, body').first().innerText();
  const beforeLedger = cards.slice(0, cards.indexOf('Security Deposits'));
  expect(beforeLedger).toContain('Rental Income');
  expect(beforeLedger).toContain('Third Party');
  await page.screenshot({ path: `${SHOTS}/deposit-payments-ledger.png`, fullPage: false });
  // The deposits section itself, scrolled into view.
  const depositsHeading = page.getByRole('heading', { name: 'Security Deposits' });
  await depositsHeading.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/deposit-payments-section.png`, fullPage: false });
});
