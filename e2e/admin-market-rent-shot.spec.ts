import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Market rent (asking) on the admin landlord page, and the earning-unit
// denominator on Annual recurring rent. RP 2 (user 286) is the case that
// exposed the problem: earning units exceeding occupied units, with nothing on
// the page explaining the difference.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/95f933ee-6ff0-4c77-b08a-51c7146febc2/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('market rent and the earning-unit denominator', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 900 });
  await signIn(page, 'admin@upnow.ae');

  const res = await page.request.get('/api/admin/users/286');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    landlord: { insights: { financials: { marketRent: number; earningUnits: number; unitsAwaitingActivation: number; annualRecurringRent: number }, occupancy: { totalUnits: number; occupiedUnits: number } } };
  };
  const f = body.landlord.insights.financials;
  const o = body.landlord.insights.occupancy;
  console.log('financials:', JSON.stringify({ ...f, occupied: o.occupiedUnits, totalUnits: o.totalUnits }));

  // Σ units.rental_price across all 113 units — reconciled against psql. Stable:
  // it moves only when someone re-prices a unit.
  expect(f.marketRent).toBe(9852000);

  // Everything else is asserted as a RELATIONSHIP, not a figure. Annual rent
  // moves whenever a lease is activated — it shifted twice while this was being
  // written — and a spec pinned to a snapshot would fail on someone else's
  // ordinary work rather than on a regression.
  expect(f.earningUnits).toBeGreaterThan(0);
  expect(f.annualRecurringRent).toBeGreaterThan(0);
  // Asking must exceed contracted; if they collapse, one is being derived from
  // the other.
  expect(f.marketRent).toBeGreaterThan(f.annualRecurringRent);
  // The denominator reconciles: earning = occupied + those on confirmed cheques.
  expect(f.earningUnits).toBe(o.occupiedUnits + f.unitsAwaitingActivation);

  await page.goto('/dashboard/admin/users/286', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await expect(page.getByText('Market rent (asking)').first()).toBeVisible();
  await expect(page.getByText(/\d+ earning/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/20-market-rent-kpi.png` });
});
