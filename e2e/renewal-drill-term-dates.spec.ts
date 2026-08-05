import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// A renewal row in the dashboard drill names the TERM BEING OFFERED, both ends
// of it. It gave the expiring lease's end date alone ("Ends 31 Aug 2026 ·
// Ahmed") — a year behind the notice the manager actually sent, and filed under
// the month the OLD term ends rather than the month the renewal starts, which is
// what the Renewal Forecast report counts.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/8197ee80-1464-4c1e-8b6e-0da2c4456ee8/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('the Notice Sent drill shows each lease term start → end', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // The payload carries both terms now — the row cannot render either otherwise.
  const res = await page.request.get('/api/contracts/dashboard-extras');
  expect(res.ok()).toBeTruthy();
  const extras = await res.json() as {
    upcomingRenewals: Array<{
      startDate?: string | null; endDate: string; bucket?: string;
      renewalStartDate?: string | null; renewalEndDate?: string | null;
    }>;
  };
  const sent = extras.upcomingRenewals.filter(r => r.bucket === 'noticeSent');
  expect(sent.length).toBeGreaterThan(0);
  for (const r of sent) {
    expect(r.startDate, JSON.stringify(r)).toBeTruthy();
    // A sent notice HAS a renewal record, and its term is the one after the
    // expiring lease — never the expiring lease's own dates.
    expect(r.renewalStartDate, JSON.stringify(r)).toBeTruthy();
    expect(r.renewalEndDate, JSON.stringify(r)).toBeTruthy();
    expect(String(r.renewalStartDate) > String(r.endDate), JSON.stringify(r)).toBeTruthy();
  }

  await page.goto('/rental-provider/dashboard');
  await page.getByText('Notice Sent', { exact: true }).first().click();

  const overlay = page.getByText(/Notice Sent · \d+ — next \d+ days/).first();
  await expect(overlay).toBeVisible({ timeout: 30_000 });

  // Every row reads "Renews <start> → <end> · <customer>", never the old "Ends …".
  // Dates render in the browser's locale, so match loosely on the arrow.
  const subtitles = await page.locator('p', { hasText: /^Renews .*\d{4} → .*\d{4} · / }).all();
  expect(subtitles.length).toBe(sent.length);
  await expect(page.locator('p', { hasText: /^Ends .*\d{4} · / })).toHaveCount(0);

  // Grouped by the month the RENEWAL starts — leases ending 31 Aug sit under
  // September, the month the Renewal Forecast report counts them in.
  const monthOf = (iso: string) => iso.slice(0, 7);
  const expectedMonths = new Set(sent.map(r => monthOf(String(r.renewalStartDate))));
  for (const m of expectedMonths) {
    const label = new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const n = sent.filter(r => monthOf(String(r.renewalStartDate)) === m).length;
    await expect(page.getByText(`Renewals starting ${label} · ${n}`)).toBeVisible();
  }

  await page.screenshot({ path: `${SHOTS}/notice-sent-term-dates.png`, fullPage: false });
});
