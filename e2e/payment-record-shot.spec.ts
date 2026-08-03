/**
 * Payment Record - Monthly: asserts August 2026 reproduces the landlord's own
 * "08. August 2026 Payment Record.pdf" line for line, then shoots the page.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/ca4953b5-951b-4f70-9a66-fcfcc71b72ee/scratchpad/shots';
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}
const aed = (f: number) => (f / 100).toLocaleString('en-AE', { maximumFractionDigits: 0 });

test('August 2026 matches the landlord sheet', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const d = await (await page.request.get('/api/reports/payment-record?year=2026')).json() as any;
  const aug = d.rows.find((r: any) => r.month === '2026-08');
  expect(aug, 'August 2026 present').toBeTruthy();

  console.log('AUGUST 2026 — leases', aug.leases, '| cheques', aug.cheques, '| total', aed(aug.totalFils));
  console.log('  rent', aed(aug.rentFils), '| admin', aed(aug.adminFils), '| registration', aed(aug.registrationFils),
    '| deposit', aed(aug.depositFils), '| commission', aed(aug.commissionFils),
    '| third party', aed(aug.othersFils), '| service charge', aed(aug.serviceChargeFils));

  // The landlord's summary box, to the dirham.
  expect(aug.leases).toBe(11);
  expect(aug.cheques).toBe(74);
  expect(aug.totalFils).toBe(999_050_00);
  expect(aug.rentFils).toBe(910_000_00);
  expect(aug.adminFils).toBe(9_250_00);
  expect(aug.registrationFils).toBe(2_800_00);
  expect(aug.depositFils).toBe(4_250_00);
  expect(aug.commissionFils).toBe(4_250_00);
  expect(aug.othersFils).toBe(63_500_00);
  expect(aug.serviceChargeFils).toBe(5_000_00);
  // Buckets must reconcile with the month total.
  const parts = aug.rentFils + aug.adminFils + aug.registrationFils + aug.depositFils
    + aug.commissionFils + aug.othersFils + aug.serviceChargeFils;
  expect(parts).toBe(aug.totalFils);
  // Detail lines must sum to the header.
  expect(aug.items.reduce((s: number, i: any) => s + i.amountFils, 0)).toBe(aug.totalFils);
  expect(aug.items.length).toBe(aug.cheques);
  // Every line carries a reference — that is the rule the report is built on.
  expect(aug.items.every((i: any) => !!i.chequeNumber)).toBeTruthy();

  console.log('  year total:', aed(d.totals.totalFils), 'across', d.totals.cheques, 'cheques /', d.totals.leases, 'leases');
  console.log('  months:', d.rows.map((r: any) => `${r.month}=${aed(r.totalFils)}`).join('  '));

  await page.goto('/rental-provider/dashboard/reports/payment-record');
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${SHOTS}/payment-record.png`, fullPage: true });
});
