/**
 * Customer space → the left-hand payment summary schedule must follow the SHARED
 * payment schedule order (lib/paymentPlan comparePaymentSchedule) — rent
 * instalments in date order, then Contract Registration → Admin → Commission →
 * custom charges — not a flat due-date sort that interleaves the one-off fees
 * into the rent runway.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('payment runway follows the plan order', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1500 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/spaces/v2/v-62');
  await page.getByText('Payment summary').waitFor({ timeout: 60_000 });

  const rows = page.locator('p', { hasText: /^(Instalment \d|Admin Fee|Contract Registration Fee|Commission)/ });
  const labels = (await rows.allInnerTexts()).map(t => t.trim());
  console.log('runway order:', JSON.stringify(labels));

  // Every rent row prints uniformly as "Instalment N" — never the stored mix of
  // "Rental Instalment 1 of 4" + "Installment 2".
  expect(labels.filter(l => /^Instalment \d+$/.test(l))).toEqual(['Instalment 1', 'Instalment 2', 'Instalment 3', 'Instalment 4']);

  const idx = (re: RegExp) => labels.findIndex(l => re.test(l));
  const inst1 = idx(/^Instalment 1$/);
  const inst4 = idx(/^Instalment 4$/);
  const ejari = idx(/^Contract Registration Fee/);
  const admin = idx(/^Admin Fee/);
  const comm  = idx(/^Commission/);
  for (const [n, i] of Object.entries({ inst1, inst4, ejari, admin, comm })) {
    expect(i, `${n} present`).toBeGreaterThanOrEqual(0);
  }
  // Every rent instalment precedes every one-off charge…
  expect(inst4).toBeLessThan(ejari);
  // …and the charges run Contract Registration → Admin → Commission.
  expect(ejari).toBeLessThan(admin);
  expect(admin).toBeLessThan(comm);
  expect(inst1).toBeLessThan(inst4);

  await page.screenshot({ path: `${SHOTS}/payment-schedule-order.png`, fullPage: false });
});
