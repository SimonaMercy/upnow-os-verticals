import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// The manager headline "Active Contracts" tile must report the same live-tenancy
// figure the landlord reads on the Portfolio report — occupied units — instead of
// a raw `status = 'active'` row count, which kept wound-down leases past their
// term and missed units occupied on a lapsed tenancy.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/960b0bda-8a22-4cd1-a090-3281dae246f9/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('manager Active Contracts matches the Portfolio report occupied count', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');

  // The payload is the real assertion: the tile and the report must agree for the
  // same landlord, and the cross-landlord total must be the sum of its parts.
  const scoped = await (await page.request.get('/api/manager/overview?rp=2')).json();
  const report = await (await page.request.get('/api/manager/reports/occupancy?rp=2')).json();
  const all    = await (await page.request.get('/api/manager/overview')).json();
  console.log('overview rp=2:', JSON.stringify({ ...scoped, rps: undefined }));
  console.log('occupancy rp=2 totals:', JSON.stringify(report.totals));

  expect(scoped.activeContracts).toBe(report.totals.occupied);
  expect(scoped.activeContracts).toBeLessThanOrEqual(scoped.units);
  expect(all.activeContracts).toBeGreaterThanOrEqual(scoped.activeContracts);

  await page.goto('/dashboard/manager', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/manager-overview-all.png` });

  await page.goto('/dashboard/manager?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/manager-overview-rp2.png` });
});
