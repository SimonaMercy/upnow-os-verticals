import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// SCRUM-699 — record parity on the manager admin page. Manager 411 holds ACTIVE
// grants for two landlords (RP 1 + RP 2), so every row must name which landlord
// it belongs to; that ambiguity is the reason the landlord page's shape cannot
// simply be reused unchanged.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/95f933ee-6ff0-4c77-b08a-51c7146febc2/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('manager page carries the landlord record lists', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'admin@upnow.ae');

  // Read the payload directly — the counts are the real assertion.
  const res = await page.request.get('/api/admin/users/411');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    manager: {
      records: {
        scopedToLandlords: number;
        properties: unknown[]; units: unknown[]; customers: unknown[];
        leases: unknown[]; payments: unknown[]; documents: unknown[];
      };
      attributed: { recent: unknown[] };
    };
  };
  const r = body.manager.records;
  console.log('records:', JSON.stringify({
    scopedToLandlords: r.scopedToLandlords,
    properties: r.properties.length, units: r.units.length,
    customers: r.customers.length, leases: r.leases.length,
    payments: r.payments.length, documents: r.documents.length,
    activity: body.manager.attributed.recent.length,
  }));

  expect(r.scopedToLandlords).toBe(2);
  expect(r.properties.length).toBe(10);   // matches psql
  expect(r.units.length).toBe(114);       // matches psql
  expect(r.documents.length).toBe(9);     // matches psql
  expect(r.leases.length).toBeGreaterThan(0);
  expect(r.payments.length).toBeGreaterThan(0);
  expect(body.manager.attributed.recent.length).toBeGreaterThan(0);

  await page.goto('/dashboard/admin/users/411', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  for (const [i, title] of [
    'Buildings & units', 'Customers', 'Leases', 'Payments', 'Landlord documents', 'Recent activity',
  ].entries()) {
    const heading = page.getByText(title, { exact: true }).last();
    await expect(heading).toBeVisible();
    await heading.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/1${i}-manager-${title.replace(/[^a-z]/gi, '-').toLowerCase()}.png` });
  }
});
