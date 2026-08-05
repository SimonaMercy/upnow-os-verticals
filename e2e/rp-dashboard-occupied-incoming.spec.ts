import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// An occupied unit whose last term has ENDED and whose next term is signed but
// has not started reads as the INCOMING tenancy, not as the outgoing tenant on a
// lapsed lease. Unit 317 of Avenue Residence is the live case: the old term ran
// out on 28 Feb 2026 and the dashboard was naming that tenant with a red
// "lapsed 158d" badge while the issued, cheques-confirmed lease starting
// 15 Aug 2026 — the only reason the unit reads occupied at all — was filtered
// out of the pick as an unsigned future draft.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/945c51cb-be6d-4cd8-bf26-c856bdb6d8e7/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('an occupied unit held for a signed incoming tenancy names the incoming lease', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const res = await page.request.get('/api/properties/dashboard-stats');
  expect(res.ok()).toBeTruthy();
  const stats = await res.json() as {
    occupied: number;
    units: Array<{
      id: number; number: string | null; availability: string;
      contractId: number | null; tenant: string | null;
      startsOn: string | null; daysToStart: number | null;
      endsOn: string | null; daysToEnd: number | null;
    }>;
  };

  const u317 = stats.units.find(u => u.number === '317');
  expect(u317?.availability).toBe('occupied');
  // eslint-disable-next-line no-console
  console.log('unit 317', JSON.stringify(u317));
  expect(u317?.startsOn).toBe('2026-08-15');
  expect(u317?.endsOn).toBe('2027-08-14');
  expect(u317?.daysToStart).toBeGreaterThan(0);
  expect(u317?.tenant).toContain('Ahmed Farouk');

  // The pending renewal proposals stacked on RUNNING terms must NOT have been
  // let through with it — that exclusion is what keeps 30 of this landlord's
  // units on the term their tenant is actually on.
  const running = stats.units.filter(u => u.availability === 'occupied'
    && (u.daysToStart ?? 0) <= 0 && (u.daysToEnd ?? 0) >= 0);
  expect(running.length).toBeGreaterThan(90);
  // Only a unit whose term has not begun carries a positive daysToStart.
  for (const u of stats.units.filter(u => (u.daysToStart ?? 0) > 0)) {
    expect(u.availability).toBe('occupied');
    expect(u.endsOn! > u.startsOn!).toBeTruthy();
  }

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  // Open the Occupied half of the donut — the drill-down this row lives in.
  await page.getByText('Occupied', { exact: false }).first().click();
  await page.waitForTimeout(1500);
  const panel = page.locator('body');
  // Sorted by term end, so the incoming tenancy sits at the far end of the list
  // — not urgent, which is the point.
  const title317 = panel.getByText('Unit 317').first();
  await title317.scrollIntoViewIfNeeded();
  await expect(title317).toBeVisible();
  const row317 = title317.locator('xpath=ancestor::*[self::a or self::div][2]');
  const text317 = (await row317.innerText()).replace(/\n/g, ' | ');
  // eslint-disable-next-line no-console
  console.log('row 317', text317);
  expect(text317).toContain('Ahmed Farouk');
  expect(text317).toContain('starts Aug 15, 2026');
  expect(text317).toContain('starts in 10 days');
  expect(text317).not.toContain('lapsed');
  // No row anywhere in the list still shows the outgoing tenant's lapsed term.
  await expect(panel.getByText('Sujith Mathew')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/occupied-drill-317.png`, fullPage: false });
});
