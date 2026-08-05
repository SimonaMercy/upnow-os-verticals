import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// The landlord KPI strip is Receivables · Properties · Units.
// "Active Orders" is gone: it counted every lease whose term OVERLAPPED the
// selected range — a stock presented under a range filter, so "This Month" read
// 105 on RP 2 when only 15 leases actually start in August. The Occupancy % card
// is gone too; the donut below states the same split. Renewals moved to the
// second row, where the other queues live.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/960b0bda-8a22-4cd1-a090-3281dae246f9/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('landlord KPI strip carries no Active Orders tile', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  await expect(page.getByText('Active Orders')).toHaveCount(0);
  await expect(page.getByText(/across \d+ assets?/)).toHaveCount(0);

  // First row, in order: Receivables · Properties · Units. Matched on CONTENT,
  // never on Tailwind classes — a class-selector for the strip broke the moment
  // the grid was re-flowed, which is exactly the change this test exists to
  // cover.
  // Lower-cased: innerText applies CSS text-transform, so the KPI labels come
  // back SHOUTING and a case-sensitive match would miss them.
  const body = (await page.locator('body').innerText()).toLowerCase();
  const at = (s: string) => body.indexOf(s);
  expect(at('receivables · this month')).toBeGreaterThan(-1);
  expect(at('buildings in portfolio')).toBeGreaterThan(at('receivables · this month'));
  // Units is the third tile. It no longer states the occupied/vacant split — the
  // Occupancy donut below says it three ways already — so it is identified by
  // the portfolio size line it carries instead.
  expect(at('across 9 buildings')).toBeGreaterThan(at('buildings in portfolio'));
  expect(body).not.toContain('107 occupied · 6 vacant');
  // The Occupancy PERCENTAGE card is gone. Identified by its old sub-line, since
  // the donut below still carries the word "Occupancy" and states the same split.
  await expect(page.getByText(/vacant of \d+ units/)).toHaveCount(0);
  // Renewals survived the move to the second row, and its sent/pending split has
  // to ADD UP to the headline. It could not before: the KPI excluded every lease
  // whose renewal existed, which is exactly what "sent" means, so `sent` was
  // pinned at 0 while 23 offers were actually out.
  // The card is the clickable element itself (it opens the drill-down), so take
  // it by role — a `div` text filter lands on the inner label node, which holds
  // no numbers.
  // Renewals is no longer a KpiMini with a sent/pending subline — it is the
  // Upcoming Renewals card, and its four states must PARTITION the headline.
  // Read from the API and checked against the rendered card, so a card that
  // silently drops a state cannot pass.
  const ex = await page.request.get('/api/contracts/dashboard-extras?window=90');
  const { renewalBuckets, upcomingRenewals } = await ex.json() as {
    renewalBuckets: Record<string, number>;
    upcomingRenewals: Array<{ bucket: string }>;
  };
  console.log('renewal buckets:', JSON.stringify(renewalBuckets));
  const sum = Object.values(renewalBuckets).reduce((a, b) => a + b, 0);
  expect(sum).toBe(upcomingRenewals.length);
  const card = page.locator('main div').filter({ hasText: /^Upcoming Renewals/ }).first();
  await expect(card).toContainText(`${sum} leases coming up`);
  for (const label of ['Renewed', 'Notice Sent', 'Notice due', 'Vacating']) {
    await expect(card).toContainText(label);
  }

  await page.screenshot({ path: `${SHOTS}/rp-dashboard-kpis.png` });
});
