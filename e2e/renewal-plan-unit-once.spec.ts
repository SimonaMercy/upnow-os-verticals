import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Renewal Plan - Yearly counted renewal EVENTS, not units: a short term that both
// commenced and fell due inside the year landed in two month cells. Renewals read
// 108 against 107 occupied units, so a reader adding Renewals + Total Vacant came
// out one ABOVE Total Units. Each occupied unit must now occupy at most one cell —
// its renewal-due month, or its commencement month when the due month is outside
// the year — which is what the report's own description has always claimed.
//
// RP 2 (kbaalfalasi@gmail.com, user 286) is the landlord the discrepancy showed on.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/0081a2d3-9892-4f78-9938-f15f455029db/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

interface Row { label: string; cells: number[]; cellItems: { contractId: number }[][]; total: number; vacant: number; totalUnits: number }

test('each occupied unit lands in at most one renewal month', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const res = await page.request.get('/api/reports/renewal-vacancy?year=2026');
  expect(res.ok()).toBeTruthy();
  const data = (await res.json()) as { rows: Row[]; columnTotals: number[]; totals: { leased: number; vacant: number; totalUnits: number } };
  fs.writeFileSync(`${SHOTS}/renewal-vacancy-2026.json`, JSON.stringify(data, null, 2));
  const { leased, vacant, totalUnits } = data.totals;
  const occupied = totalUnits - vacant;
  console.log('TOTALS', JSON.stringify({ ...data.totals, occupied }));

  // The defect itself: no contract may appear in two month cells of one row.
  for (const row of data.rows) {
    const seen = new Map<number, number>();
    row.cellItems.forEach((items, mi) => {
      for (const it of items) {
        const first = seen.get(it.contractId);
        expect(
          first,
          `${row.label}: CID-${it.contractId} counted in month ${first} and again in ${mi}`,
        ).toBeUndefined();
        seen.set(it.contractId, mi);
      }
    });
    // Cell counts and the drill-down lists must be the same thing.
    row.cells.forEach((n, mi) => expect(row.cellItems[mi]).toHaveLength(n));
    // Months add up to the row's Renewals, and it can never exceed the row's
    // occupied units now that it is a unit count.
    expect(row.cells.reduce((s, n) => s + n, 0)).toBe(row.total);
    expect(row.total).toBeLessThanOrEqual(row.totalUnits - row.vacant);
  }

  // …and the same at the footer, where the reader was doing the arithmetic.
  expect(data.columnTotals.reduce((s, n) => s + n, 0)).toBe(leased);
  expect(leased).toBeLessThanOrEqual(occupied);
  expect(data.rows.reduce((s, r) => s + r.vacant, 0)).toBe(vacant);
  expect(data.rows.reduce((s, r) => s + r.totalUnits, 0)).toBe(totalUnits);

  // Renewal Plan - Monthly is the same pool, so its Renewals tile must agree.
  const monthly = await page.request.get('/api/reports/renewal-forecast?year=2026');
  expect(monthly.ok()).toBeTruthy();
  const md = (await monthly.json()) as { totals: { totalLeases: number; inProgress: number; notStarted: number } };
  console.log('MONTHLY TOTALS', JSON.stringify(md.totals));
  expect(md.totals.totalLeases).toBe(leased);
  expect(md.totals.inProgress + md.totals.notStarted).toBe(md.totals.totalLeases);

  await page.goto('/rental-provider/dashboard/reports/renewal-vacancy');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Renewal Plan - Yearly').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/renewal-plan-yearly.png`, fullPage: true });
});
