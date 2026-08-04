/**
 * Rent We Are Owed — asserts the report's own arithmetic before shooting it.
 *
 * The whole point of this report is that the numbers add up in a way the
 * calendar-year reports cannot: months sum to Total, Total is Cleared + Pending
 * with no bounce inside it, and Total + the unreplaced bounce reconciles against
 * contracted annual rent. If any of those drift the report is worthless, so they
 * are assertions rather than eyeballing.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b3c3a712-8558-4890-bf12-df4741a749a6/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}
const aed = (f: number) => (f / 100).toLocaleString('en-AE', { maximumFractionDigits: 0 });

test('Rent We Are Owed adds up, and the bounce is never double-counted', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const d = await (await page.request.get('/api/reports/rent-receivable')).json() as any;
  const t = d.totals;
  console.log('units', t.units, '| months', d.months.length, d.months[0], '->', d.months[d.months.length - 1]);
  console.log('annual rent', aed(t.annualRentFils), '| total', aed(t.totalFils),
    '| cleared', aed(t.clearedFils), '| pending', aed(t.pendingFils));
  console.log('bounced owed', aed(t.bouncedOwedFils), '| replaced', aed(t.bouncedReplacedFils));
  console.log('late', aed(t.lateFils), '| not yet due', aed(t.notYetDueFils));

  // Total is cleared + pending — a bounce is NEVER inside it.
  expect(t.totalFils).toBe(t.clearedFils + t.pendingFils);

  // Month columns sum across to Total. A bounce is excluded from both, so this
  // holds only because the cell excludes it too.
  const colSum = (d.columnTotals as number[]).reduce((a, b) => a + b, 0);
  expect(colSum).toBe(t.totalFils);

  // Every row's cells sum to its own Total.
  for (const r of d.rows as any[]) {
    const cells = (r.cells as any[]).reduce((s, c) => s + c.amountFils, 0);
    expect(cells, `${r.unitLabel} cells vs total`).toBe(r.totalFils);
    expect(r.totalFils).toBe(r.clearedFils + r.pendingFils);
  }

  // Cumulative is the running total and lands on Total.
  expect(d.cumulative[d.cumulative.length - 1]).toBe(t.totalFils);

  // Late + not-yet-due partition the money, rather than being lumped together.
  expect(t.lateFils + t.notYetDueFils + t.receivedToDateFils).toBe(t.totalFils);

  // Everything receivable = Total + the bounce nobody replaced.
  expect(t.receivableFils).toBe(t.totalFils + t.bouncedOwedFils);

  // …and that reconciles against contracted annual rent to within the known
  // data fault (Unit 201 carries 1,000 more in cheques than its rent).
  // Unit 201 (CID-23) carries AED 61,100 of cheques against AED 60,100 of rent —
  // a data fault for the property manager, not a reporting one. Anything beyond
  // a couple of thousand across 103 leases means the report has drifted.
  const drift = t.receivableFils - t.annualRentFils;
  console.log('receivable vs annual rent →', aed(drift));
  expect(Math.abs(drift)).toBeLessThanOrEqual(2_000_00);

  // A replaced bounce is reported but must never be added into anything.
  expect(t.bouncedReplacedFils).toBeGreaterThan(0);

  await page.goto('/rental-provider/dashboard/reports/rent-receivable');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const heads = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table thead th')).map(th => (th.textContent ?? '').trim()));
  console.log('TRAILING COLUMNS:', heads.slice(-5).join(' · '));
  expect(heads).toContain('Total');
  expect(heads.some(h => h.includes('still owed'))).toBeTruthy();
  expect(heads.some(h => h.includes('replaced'))).toBeTruthy();
  expect(heads).not.toContain('YTD Expected');

  await page.screenshot({ path: `${SHOTS}/rent-receivable-top.png` });
});
