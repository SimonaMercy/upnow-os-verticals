/**
 * Executive Cashflow after the Cash Management alignment — shoots the page and
 * prints the header tiles, the month grid and the reconciliation panels, then
 * asserts the arithmetic the report now claims:
 *   • Expected = Received + Pending on every month (no bounce inside it)
 *   • Late + Not yet due + Received-to-date = Expected
 *   • the year's Expected equals the Cash Management sheet's columns for that
 *     same year, and units / annual rent match it exactly
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/251815fc-9de7-4e06-97b2-959facf19c93/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('executive cashflow reads from the cash management sheet', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/reports/executive-cashflow?year=2026');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/exec-cashflow-top.png`, fullPage: false });
  await page.screenshot({ path: `${SHOTS}/exec-cashflow-full.png`, fullPage: true });

  const tiles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main p, body p'))
      .map(p => (p.textContent ?? '').trim()).filter(t => t && t.length < 40).slice(0, 40));
  console.log('TILES:', tiles.join(' | '));

  const heads = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table thead th')).map(th => (th.textContent ?? '').trim()));
  console.log('HEADERS:', heads.join(' · '));

  const panels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table')).slice(1).map(t =>
      Array.from(t.querySelectorAll('tr')).map(r =>
        Array.from(r.querySelectorAll('td')).map(c => (c.textContent ?? '').trim()).join(' = ')).join(' | ')));
  console.log('PANELS:\n' + panels.join('\n'));

  // ── the arithmetic, from the endpoints themselves ──────────────────────────
  const cash = await (await page.request.get('/api/reports/executive-cashflow?year=2026')).json();
  const cm = await (await page.request.get('/api/reports/rent-receivable')).json();

  for (const r of cash.rows) {
    expect(r.expectedFils, `${r.label}: expected = received + pending`)
      .toBe(r.receivedFils + r.pendingFils);
  }
  const t = cash.totals;
  expect(t.lateFils + t.notYetDueFils + t.ytdReceivedFils).toBe(t.expectedFils);
  expect(t.receivableFils).toBe(t.expectedFils + t.bouncedOwedFils);

  // The same year, read across the Cash Management sheet instead of down it.
  const idx = cm.monthKeys
    .map((m: string, i: number) => [m, i] as const)
    .filter(([m]: readonly [string, number]) => m.startsWith('2026'))
    .map(([, i]: readonly [string, number]) => i);
  let cmExpected = 0, cmCleared = 0;
  for (const row of cm.rows) {
    for (const i of idx) {
      cmExpected += row.cells[i].amountFils;
      for (const q of row.cells[i].cheques) if (q.status === 'cleared') cmCleared += q.amountFils;
    }
  }
  expect(t.expectedFils, 'the year equals Cash Management’s 2026 columns').toBe(cmExpected);
  expect(t.receivedFils).toBe(cmCleared);
  expect(t.units).toBe(cm.totals.units);
  expect(t.annualRentFils).toBe(cm.totals.annualRentFils);
  console.log('RECONCILED expected/received/units/annualRent against Cash Management');
});
