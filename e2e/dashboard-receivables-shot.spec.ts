/**
 * RP dashboard Receivables KPI vs the Cash Management sheet.
 *
 * Every range preset is now a whole number of calendar months over the same
 * earning-lease set the sheet uses, so each preset's figure must equal the sum of
 * the sheet's columns for those months. Shoots each preset and asserts it.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/c43677d9-1ef7-4171-ac82-c038c12c56ef/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

/** The presets, as the dashboard now builds them (whole months). */
const PRESETS: Array<{ label: string; from: string; to: string }> = [
  { label: 'This Month', from: '2026-08-01', to: '2026-08-31' },
  { label: 'Last Month', from: '2026-07-01', to: '2026-07-31' },
  { label: 'Last 3M',    from: '2026-06-01', to: '2026-08-31' },
  { label: 'Last 6M',    from: '2026-03-01', to: '2026-08-31' },
  { label: 'This Year',  from: '2026-01-01', to: '2026-12-31' },
  { label: 'All Time',   from: '2000-01-01', to: '2100-12-31' },
];

test('every dashboard range reconciles to Cash Management', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // The sheet: month columns and their totals, straight from the report.
  const cm = await (await page.request.get('/api/reports/rent-receivable')).json();
  const months: string[] = cm.monthKeys;
  const cols: number[] = cm.columnTotals;
  expect(months.length).toBe(cols.length);
  console.log('CM months:', months.join(' · '));
  console.log('CM total (cleared+pending):', cm.totals.totalFils / 100);

  for (const p of PRESETS) {
    const fin = await (await page.request.get(
      `/api/contracts/financial-summary?from=${p.from}&to=${p.to}`)).json();
    // Same window, read off the sheet's own columns.
    const expected = months.reduce((s, key, i) => {
      const first = `${key}-01`;
      return first >= p.from && first <= p.to ? s + cols[i] : s;
    }, 0);
    console.log(`${p.label.padEnd(11)} ${p.from}..${p.to}  dashboard=${fin.receivablesInRange}  sheet=${expected / 100}`);
    expect(Math.round(expected / 100), `${p.label} must equal the sheet's columns`)
      .toBe(fin.receivablesInRange);
    // The chart under the KPI has to add up to the KPI beside it.
    const chartSum = (fin.chartData as Array<{ receivable: number }>)
      .reduce((s, r) => s + r.receivable, 0);
    expect(chartSum, `${p.label} chart must sum to the KPI`).toBe(fin.receivablesInRange);
    // The split the tile opens into has to BE the headline, not approximate it.
    const s = fin.receivablesSplit;
    expect(s.collected.amount + s.overdue.amount + s.due.amount,
      `${p.label} split must equal the KPI`).toBe(fin.receivablesInRange);
    expect(fin.receivableCheques.length)
      .toBe(s.collected.count + s.overdue.count + s.due.count);
    // Nothing stamped "overdue" may be dated in the future, and vice versa.
    const today = '2026-08-04';
    for (const c of fin.receivableCheques as Array<{ state: string; dueDate: string }>) {
      if (c.state === 'overdue') expect(c.dueDate < today).toBeTruthy();
      if (c.state === 'due') expect(c.dueDate >= today).toBeTruthy();
    }
    console.log(`            collected=${s.collected.amount} (${s.collected.count})  overdue=${s.overdue.amount} (${s.overdue.count})  due=${s.due.amount} (${s.due.count})`);
  }

  // All Time is the sheet's own grand total — no window at all.
  const all = await (await page.request.get(
    '/api/contracts/financial-summary?from=2000-01-01&to=2100-12-31')).json();
  expect(all.receivablesInRange).toBe(Math.round(cm.totals.totalFils / 100));

  // …and the page itself.
  await page.goto('/rental-provider/dashboard');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  for (const p of PRESETS) {
    await page.getByRole('button', { name: p.label, exact: true }).click();
    await page.waitForTimeout(2000);
    const hero = (await page.locator('text=/Receivables ·/').first()
      .locator('xpath=..').innerText()).replace(/\n/g, ' ');
    console.log(`HERO ${p.label}: ${hero}`);
    await page.screenshot({ path: `${SHOTS}/dash-${p.label.replace(/\s+/g, '-').toLowerCase()}.png` });
  }

  // The tile opens into the cheques behind it.
  await page.getByRole('button', { name: 'This Month', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.locator('text=/RECEIVABLES ·/i').first().locator('xpath=ancestor::*[@role="button"][1]').click();
  await page.waitForTimeout(1200);
  const drillHead = await page.locator('h2, h3').filter({ hasText: /Receivables ·/ }).first().innerText();
  console.log('DRILL TITLE:', drillHead);
  const groups = await page.evaluate(() =>
    Array.from(document.querySelectorAll('p, h4, div'))
      .map(e => (e.textContent ?? '').trim())
      .filter(t => /^(Overdue|Not yet due|Collected) · \d+ — AED/.test(t)));
  console.log('DRILL GROUPS:', [...new Set(groups)].join('  |  '));
  expect(groups.length).toBeGreaterThan(0);
  await page.screenshot({ path: `${SHOTS}/dash-receivables-drill.png`, fullPage: true });
});
