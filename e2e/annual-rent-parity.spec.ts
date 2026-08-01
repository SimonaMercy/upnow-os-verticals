import { test, expect, Page } from '@playwright/test';

/**
 * Admin and the landlord's own portfolio must report the SAME annual rent.
 *
 * They did not for a long time: the admin surfaces counted paid-for terms that
 * had not been activated, while the RP portfolio filtered on unit occupancy.
 * Same landlord, same day, AED 6,501,420 against 7,046,420 — a landlord seeing a
 * figure their own admin contradicted. One predicate now (LEASE_COUNTS_SQL:
 * active and not expired), and this asserts the two ends still meet.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('annual rent agrees between admin and the RP portfolio', async ({ page }) => {
  test.setTimeout(120_000);

  await signIn(page, 'admin@upnow.ae');
  const detail = await (await page.request.get('/api/admin/users/286')).json();
  const fin = detail.landlord.insights.financials;
  const occ = detail.landlord.insights.occupancy;

  // The landlord's own view of the same book.
  await signIn(page, 'kbaalfalasi@gmail.com');
  const props = await (await page.request.get('/api/properties')).json();
  const list = Array.isArray(props) ? props : (props.data ?? []);
  const rpRent = list.reduce((s: number, p: { annualRentTotal?: number }) => s + Number(p.annualRentTotal ?? 0), 0);

  expect(rpRent).toBe(fin.annualRecurringRent);

  // Asking rent is a different figure and must NOT collapse into contracted.
  expect(fin.marketRent).toBeGreaterThan(fin.annualRecurringRent);

  // Earning units may EXCEED occupied units — a term with confirmed PDCs earns
  // before its unit flips to occupied. The excess must be exactly the count the
  // page names, so the two figures reconcile instead of merely differing. Fewer
  // earning than occupied would mean an occupancy bug, which is the point of
  // having dropped the occupancy filter rather than letting it mask one.
  expect(fin.earningUnits).toBe(occ.occupiedUnits + fin.unitsAwaitingActivation);
});
