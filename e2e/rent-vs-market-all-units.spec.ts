/**
 * Rent vs Asking must cover the WHOLE portfolio — the units with no counting
 * lease were silently missing, so the table read as if the portfolio were fully
 * let. Asserts row count == the Portfolio report's unit count, then shoots it.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/22c401af-f228-4628-82f8-67c72175f42c/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}
const aed = (f: number) => (f / 100).toLocaleString('en-AE', { maximumFractionDigits: 0 });

test('Rent vs Asking lists every portfolio unit, leased or not', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1300 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const rvm = await (await page.request.get('/api/reports/rent-vs-market')).json() as any;
  // The Portfolio page (/reports/portfolio) is the occupancy endpoint.
  const pf = await (await page.request.get('/api/reports/occupancy?occupancy=all')).json() as any;
  const t = rvm.totals;
  const units = rvm.rows.flatMap((r: any) => r.items);
  console.log('portfolio units', pf.totals.units, '| market', aed(pf.totals.marketRentFils),
    '| rvm portfolioUnits', t.portfolioUnits, '| buildings', rvm.rows.length, '| units', units.length);
  console.log('leased', t.units, '| vacant', t.vacantUnits, '| no lease', t.notLeasedUnits);
  console.log('annual rent', aed(t.currentRentFils), '| market', aed(t.marketRentFils), '| uplift', aed(t.upliftFils));
  for (const r of rvm.rows) {
    console.log(` ${r.buildingName}: ${r.units}u (${r.leasedUnits}/${r.vacantUnits}/${r.notLeasedUnits})`,
      '| rent', aed(r.currentRentFils), '| market', aed(r.marketRentFils), '| uplift', aed(r.upliftFils));
  }

  // The two reports must agree on how many units exist, and on Market Price.
  expect(t.portfolioUnits).toBe(pf.totals.units);
  expect(t.marketRentFils).toBe(pf.totals.marketRentFils);
  // Every unit is listed under exactly one building: leased + vacant + not-leased.
  expect(t.units + t.vacantUnits + t.notLeasedUnits).toBe(t.portfolioUnits);
  expect(units.length).toBe(t.portfolioUnits);
  expect(new Set(units.map((u: any) => u.unitId)).size).toBe(units.length);
  expect(new Set(rvm.rows.map((r: any) => r.propertyId)).size).toBe(rvm.rows.length);

  // Every section header equals the units beneath it, and the sections sum to
  // the tiles — the whole point of a grouped report.
  for (const r of rvm.rows) {
    expect(r.items.length).toBe(r.units);
    expect(r.leasedUnits + r.vacantUnits + r.notLeasedUnits).toBe(r.units);
    expect(r.items.reduce((s: number, u: any) => s + u.currentRentFils, 0)).toBe(r.currentRentFils);
    expect(r.items.reduce((s: number, u: any) => s + u.marketRentFils, 0)).toBe(r.marketRentFils);
    expect(r.items.reduce((s: number, u: any) => s + u.upliftFils, 0)).toBe(r.upliftFils);
  }
  const sum = (k: string) => rvm.rows.reduce((s: number, r: any) => s + r[k], 0);
  expect(sum('currentRentFils')).toBe(t.currentRentFils);
  expect(sum('marketRentFils')).toBe(t.marketRentFils);
  expect(sum('upliftFils')).toBe(t.upliftFils);
  expect(sum('vacantUnits')).toBe(t.vacantUnits);
  expect(sum('notLeasedUnits')).toBe(t.notLeasedUnits);
  expect(sum('notEarning')).toBe(t.notEarning);
  expect(sum('inRenewal')).toBe(t.inRenewal);
  expect(sum('holdingOver')).toBe(t.holdingOver);
  // The two ways of counting the same unearning units must agree on the total.
  expect(t.notEarning).toBe(t.vacantUnits + t.notLeasedUnits);
  expect(t.units + t.notEarning).toBe(t.portfolioUnits);

  // Rent-roll order: buildings A→Z, units by unit number inside.
  const names = rvm.rows.map((r: any) => r.buildingName);
  expect(names).toEqual([...names].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  for (const r of rvm.rows) {
    const leasedLabels = r.items.filter((u: any) => u.gapFils !== null || u.position === 'no_benchmark')
      .map((u: any) => u.unitLabel);
    expect(leasedLabels).toEqual([...leasedLabels].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  }

  // A unit earning nothing states WHY, from its own open lease.
  const UNLEASED = ['in_renewal', 'draft_lease', 'lease_issued', 'lease_active',
    'holding_over', 'vacant', 'not_leased'];
  for (const r of rvm.rows) {
    for (const u of r.items.filter((u: any) => UNLEASED.includes(u.position))) {
      expect(u.currentRentFils).toBe(0);
      expect(u.gapFils).toBeNull();
      expect(u.upliftFils).toBe(0);
    }
    // ...and they sit at the foot of their own building.
    const isUnleased = r.items.map((u: any) => UNLEASED.includes(u.position));
    const lastLeased = isUnleased.lastIndexOf(false);
    const firstUnleased = isUnleased.indexOf(true);
    if (firstUnleased >= 0 && lastLeased >= 0) expect(firstUnleased).toBeGreaterThan(lastLeased);
  }
  const byPosition: Record<string, string[]> = {};
  for (const u of units.filter((u: any) => UNLEASED.includes(u.position))) {
    (byPosition[u.position] ??= []).push(`${u.unitLabel}${u.contractRef ? ` (${u.contractRef})` : ''}`);
  }
  for (const [p, list] of Object.entries(byPosition)) console.log(` ${p}:`, list.join(', '));
  expect(byPosition['in_renewal']?.length).toBe(t.inRenewal);
  expect(byPosition['holding_over']?.length).toBe(t.holdingOver);
  expect(units.filter((u: any) => UNLEASED.includes(u.position)).length).toBe(t.notEarning);

  await page.goto('/rental-provider/dashboard/reports/rent-vs-market');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/rvm-top.png` });
  // The dashboard scrolls an inner pane, not the window.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('*')]
      .find(e => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible');
    if (el) el.scrollTop = el.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/rvm-bottom.png` });

  // Searching narrows the units inside each section AND recomputes the section
  // header from what is left — so Units/Annual Rent/Market/Uplift on the bar
  // always equal the rows under it.
  await page.getByPlaceholder('Search rows…').fill('vacant');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/rvm-search-vacant.png` });
  // The units the landlord flagged: a renewal drafted and never proceeded.
  await page.getByPlaceholder('Search rows…').fill('renewal');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/rvm-search-renewal.png` });
  await page.getByPlaceholder('Search rows…').fill('');
  await page.waitForTimeout(400);
});
