/**
 * Customer space, LIVE tenancy: the left column carries the contract's payment
 * summary (money terms + every instalment with its status) in place of the
 * journey map, the right column no longer repeats the runway, and the lease
 * toolbox (Preview / Request Termination) sits at the top.
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

test('live tenancy shows a payment summary rail', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1500 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/spaces/v2/c-394');
  await page.getByText('Payment summary').waitFor({ timeout: 60_000 });

  // Journey map is gone once the tenancy is live.
  await expect(page.getByText('Your tenancy journey')).toHaveCount(0);
  // …and so is the right-hand runway section.
  await expect(page.getByText('Payment runway')).toHaveCount(0);

  // Schedule + total only — no progress tracker, and nothing the Tenancy Pass says.
  const rail = page.locator('div', { has: page.getByText('Payment summary') }).last();
  await expect(page.getByText('Upcoming', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Cleared', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Total', { exact: true })).toBeVisible();
  for (const gone of [/% collected/, /^Collected$/, /^Remaining$/, /^Contract value$/, /Quarterly rent/, /One-off charges/]) {
    await expect(page.getByText(gone)).toHaveCount(0);
  }
  // Annual rent stays on the Tenancy Pass — the rail does not repeat it.
  expect(await rail.getByText(/Annual rent/i).count(), 'annual rent not duplicated in rail').toBe(0);
  // The security deposit is a schedule row, listed first.
  await expect(page.getByText('Security deposit', { exact: true })).toBeVisible();

  // Every instalment, each with its own status.
  const sched = page.locator('p', { hasText: /^Instalment \d+$/ });
  await expect(sched).toHaveCount(4);
  const statuses = await page.locator('p', { hasText: /·\s*(Cleared|Upcoming)/i }).allInnerTexts();
  console.log('schedule lines:', JSON.stringify(statuses.map(s => s.replace(/\s+/g, ' ').trim())));
  expect(statuses.length).toBeGreaterThanOrEqual(8);   // deposit + 4 instalments + 3 charges

  // Request Termination sits BELOW the payment summary, in the same left column.
  const order = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      summary: txt.indexOf('PAYMENT SUMMARY'),
      total: txt.indexOf('Total'),
      terminate: txt.indexOf('Request Termination'),
    };
  });
  console.log('dom order:', JSON.stringify(order));
  expect(order.terminate).toBeGreaterThan(order.summary);
  expect(order.terminate).toBeGreaterThan(order.total);
  // The wrapper card and lease reference are gone from the toolbox.
  await expect(page.getByText('Lease toolbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Request Termination/i })).toBeVisible();
  // The tenancy contract lives in Documents — not offered again in the toolbox.
  await expect(page.getByText('Preview Tenancy Contract')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/active-payment-rail.png`, fullPage: false });
});
