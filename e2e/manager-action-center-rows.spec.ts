import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Every Action Center card reads the same way: units grouped under their
// building, each against the one state that says what is owed on it, and each
// row clicking through to the screen that CLEARS it — Operations for a pipeline
// step, the lease itself for money owed or a settlement.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/960b0bda-8a22-4cd1-a090-3281dae246f9/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

/** Card title → where its rows must point. */
const ROUTES: Array<[string, RegExp]> = [
  ['Leads to progress',            /\/dashboard\/manager\/leads\/\d+/],
  ['Awaiting Signature',           /\/dashboard\/manager\/operations\/\d+/],
  ['Registration Pending',         /\/dashboard\/manager\/operations\/\d+/],
  ['Renewals to raise',            /\/dashboard\/manager\/operations\/\d+\?.*action=renew/],
  ['Renewal Offers — Awaiting Reply', /\/dashboard\/manager\/operations\/\d+/],
  ['Termination Requests',         /\/dashboard\/manager\/operations\/\d+/],
  ['Bounced Cheques',              /\/dashboard\/manager\/contracts\/\d+/],
  ['Overdue Cheques',              /\/dashboard\/manager\/contracts\/\d+/],
  ['Settlement Pending',           /\/dashboard\/manager\/contracts\/\d+\/settlement/],
  ['Delayed Follow-ups',           /\/dashboard\/manager\/tenants\/\d+/],
  // Both document cards send the manager to the customer's KYC page — that is
  // where a lapsed identity doc is actually replaced.
  ['Expired Documents',            /\/dashboard\/manager\/tenants\/\d+/],
  ['Expiry Not Recorded',          /\/dashboard\/manager\/tenants\/\d+/],
];

test('every bucket is grouped unit rows that click to the right screen', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 2400 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  for (const [title, hrefPattern] of ROUTES) {
    const card = page.locator('div.bg-white.rounded-2xl').filter({ hasText: new RegExp(title) }).last();
    const count = Number((await card.locator('> div').first().innerText()).split('\n').pop());
    if (!count) { console.log(`${title}: empty, skipped`); continue; }

    // Grouped under a heading, and every row is a link.
    const heads = await card.locator('.mgr-bucket-list div.sticky').allInnerTexts();
    const links = card.locator('.mgr-bucket-list a');
    expect(heads.length).toBeGreaterThan(0);
    expect(await links.count()).toBeGreaterThan(0);
    expect(await links.first().getAttribute('href')).toMatch(hrefPattern);

    // A label and a state, and nothing else — the detailed row's date column
    // ("issued 22 Jun 2026" etc.) must be gone. The renewal-offers card is the
    // ONE exception: an unanswered offer is read against a deadline, so it
    // carries a third line with the deadline month and the offered term.
    const row = await links.first().innerText();
    const lines = row.split('\n').filter(Boolean);
    if (title.startsWith('Renewal Offers')) {
      expect(lines.length).toBe(3);
      expect(lines[1]).toMatch(/^Ends [A-Z][a-z]{2} \d{4} · \d{1,2} [A-Z][a-z]{2} \d{2} – \d{1,2} [A-Z][a-z]{2} \d{2}$/);
    } else {
      expect(lines.length).toBe(2);
    }
    console.log(`${title}: ${count} in ${heads.length} group(s) →`, JSON.stringify(row.replace(/\n/g, ' | ')));
  }

  await page.screenshot({ path: `${SHOTS}/action-center-all.png`, fullPage: true });
});
