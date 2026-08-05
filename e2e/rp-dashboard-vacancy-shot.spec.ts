import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Occupancy on the landlord dashboard now answers both halves of the question:
// how much of the portfolio is let (total vs occupied vs vacant, the rate), and
// how long the empty units have been empty and what that has cost.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/805c33cb-0228-4607-8196-b05bf084e163/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('vacancy duration and lost income sit on the occupancy card', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // The API is the contract — assert the derived fields before the pixels, so a
  // failure says whether the derivation or the rendering broke.
  const res = await page.request.get('/api/properties/dashboard-stats');
  expect(res.ok()).toBeTruthy();
  const stats = await res.json() as {
    totalUnits: number; occupied: number; available: number; occupancyRate: number;
    vacancy: { units: number; priced: number; neverLeased: number; avgDaysVacant: number; longestDaysVacant: number; lostIncome: number };
    units: Array<{ id: number; availability: string; daysVacant: number | null; basis: string | null; lostIncome: number; rentBasis: string | null; number: string | null }>;
  };
  // eslint-disable-next-line no-console
  console.log('occupancy', stats.totalUnits, stats.occupied, stats.available, stats.occupancyRate);
  // eslint-disable-next-line no-console
  console.log('vacancy', JSON.stringify(stats.vacancy));
  // eslint-disable-next-line no-console
  console.log('vacant units', JSON.stringify(stats.units.filter(u => u.availability === 'available')
    .map(u => ({ id: u.id, days: u.daysVacant, basis: u.basis, lost: u.lostIncome, rentBasis: u.rentBasis }))));

  // Every vacant unit carries a duration; no occupied unit does.
  const vacant = stats.units.filter(u => u.availability === 'available');
  expect(vacant.length).toBe(stats.available);
  expect(stats.vacancy.units).toBe(stats.available);
  for (const u of vacant) expect(u.daysVacant).not.toBeNull();
  for (const u of stats.units.filter(u => u.availability === 'occupied')) {
    expect(u.daysVacant).toBeNull();
    expect(u.lostIncome).toBe(0);
  }
  // The totals are the roll-up of the rows, not a separately-derived number.
  expect(stats.vacancy.lostIncome).toBe(vacant.reduce((s, u) => s + u.lostIncome, 0));
  expect(stats.vacancy.longestDaysVacant).toBe(Math.max(...vacant.map(u => u.daysVacant ?? 0)));

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // The hero carries Refresh only — List Property and New Contract start flows
  // that belong to the pages that own them.
  await expect(page.getByRole('link', { name: 'List Property' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'New Contract' })).toHaveCount(0);

  // The Properties and Units tiles navigate to their pages, in a new tab, so
  // checking a figure never costs the range and horizon set to read it.
  // Scoped to <main>: the shell's sidebar has its own Properties/Units entries
  // pointing at the same routes, and an unscoped by-name lookup finds those.
  const main = page.locator('main');
  const props = main.getByRole('link').filter({ hasText: 'in portfolio' }).first();
  await expect(props).toHaveAttribute('href', '/rental-provider/dashboard/portfolio');
  await expect(props).toHaveAttribute('target', '_blank');
  const unitsTile = main.getByRole('link').filter({ hasText: 'across 9 buildings' }).first();
  await expect(unitsTile).toHaveAttribute('href', '/rental-provider/dashboard/units');
  await expect(unitsTile).toHaveAttribute('target', '_blank');
  // Every link on the page leaves it, so every link opens in a new tab.
  const links = main.locator('a[href]');
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const href = await links.nth(i).getAttribute('href');
    if (!href || href.startsWith('#')) continue;
    await expect(links.nth(i)).toHaveAttribute('target', '_blank');
    await expect(links.nth(i)).toHaveAttribute('rel', /noopener/);
  }

  const body = (await page.locator('body').innerText()).toLowerCase();
  // The occupancy card states the denominator; the vacancy detail is one click
  // away, not on the page. The Units tile no longer repeats the split, and the
  // Vacant KPI tile is gone — the donut legend is the way in.
  expect(body).toContain(`${stats.occupied} of ${stats.totalUnits} units let`);
  expect(body).not.toContain("how long they've been empty");
  expect(body).not.toContain(`${stats.occupied} occupied · ${stats.available} vacant`);

  await page.screenshot({ path: `${SHOTS}/rp-dashboard-vacancy.png`, fullPage: false });

  // "Vacant 6" on the donut legend opens the vacancy detail.
  await page.getByRole('button', { name: `Vacant ${stats.available}` }).click();
  await page.waitForTimeout(1200);
  const dialog = (await page.getByRole('dialog').innerText()).toLowerCase();
  expect(dialog).toContain("how long they've been empty");
  expect(dialog).toContain('foregone');
  // Worst-first: the longest-empty unit is named before the shortest. Matched on
  // the unit LABEL, never on the day count — "7 days" is a substring of both
  // "27 days" and "67 days", so a duration search finds the wrong row first and
  // the assertion fails on a list that is correctly ordered.
  const worst = vacant.reduce((a, b) => ((a.daysVacant ?? 0) >= (b.daysVacant ?? 0) ? a : b));
  const best = vacant.reduce((a, b) => ((a.daysVacant ?? 0) <= (b.daysVacant ?? 0) ? a : b));
  const at = (u: typeof worst) => dialog.indexOf(`unit ${(u.number ?? '').toLowerCase()} ·`);
  expect(at(worst)).toBeGreaterThan(-1);
  expect(at(best)).toBeGreaterThan(-1);
  expect(at(worst)).toBeLessThan(at(best));
  await page.screenshot({ path: `${SHOTS}/rp-dashboard-vacancy-drill.png`, fullPage: false });
});
