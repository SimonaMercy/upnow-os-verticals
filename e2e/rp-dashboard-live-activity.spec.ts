import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Recent Activity and Upcoming Renewals are gone from the landlord dashboard;
// a live feed of what the landlord's MANAGERS are doing stands in their place
// and re-reads every 5 seconds.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/805c33cb-0228-4607-8196-b05bf084e163/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('live manager activity replaces Recent Activity and Upcoming Renewals', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const res = await page.request.get('/api/reports/manager-activity');
  expect(res.ok()).toBeTruthy();
  const feed = await res.json() as {
    generatedAt: string;
    window: string[];
    managers: Array<{
      userId: number; name: string | null; lastAt: string | null; dayTotals: Array<{ day: string; count: number }>;
      entries: Array<{ id: number; at: string; firstAt: string; day: string; label: string; category: string; repeats?: number; changes: unknown[] | null; subject: string | null; contractId: number | null }>;
    }>;
  };
  // eslint-disable-next-line no-console
  console.log('managers', JSON.stringify(feed.managers.map(m => ({ who: m.name, n: m.entries.length, last: m.lastAt }))));

  // One lane per roster manager, each bounded by the limit, each newest-first,
  // and never a machine-minted row (those fire on every page READ, so on a
  // 5-second poll they would be most of what the feed shows).
  // The window is the CURRENT day only — one date, and it is today in Dubai.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  expect(feed.window).toEqual([today]);
  expect(feed.managers.length).toBe(2);
  const names = feed.managers.map(m => m.name);
  expect(new Set(names).size).toBe(names.length);
  for (const m of feed.managers) {
    expect(m.entries.length).toBeLessThanOrEqual(20);
    // Nothing from any other day leaks in.
    for (const e of m.entries) expect(e.day).toBe(today);
    const times = m.entries.map(e => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const e of m.entries) {
      expect(e.label).toBeTruthy();
      expect(e.label.toLowerCase()).not.toContain('upload link');
    }
    // lastAt is "last seen doing anything", NOT bounded by today's window — a
    // manager who worked yesterday must still report when, or the panel says
    // "nothing yet" about someone who has been working all week.
    if (m.entries.length) expect(m.lastAt).toBe(m.entries[0].at);
    else expect(m.lastAt === null || Date.parse(m.lastAt) < Date.parse(`${today}T00:00:00+04:00`)).toBe(true);
    for (const e of m.entries) {
      // Every row carries what the report's section renders: a Dubai day to sit
      // under, a category chip, and a run span whose start is <= its end.
      expect(e.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.category).toBeTruthy();
      expect(Date.parse(e.firstAt)).toBeLessThanOrEqual(Date.parse(e.at));
      // A collapsed run never spans two days.
      expect(e.day).toBe(new Date(e.firstAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }));
    }
  }
  // At least one manager has worked at some point, so lastAt survives the
  // today-only window rather than coming back null for everyone.
  expect(feed.managers.some(m => m.lastAt !== null)).toBe(true);
  // Busiest first: whoever acted most recently leads.
  const lasts = feed.managers.map(m => m.lastAt ?? '');
  expect(lasts).toEqual([...lasts].sort().reverse());
  // generatedAt is the server's read time, which is what the ages are measured
  // against — it must be at or after every entry.
  const newest = Math.max(...feed.managers.flatMap(m => m.entries.map(e => Date.parse(e.at))));
  expect(Date.parse(feed.generatedAt)).toBeGreaterThanOrEqual(newest);

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).toContain('manager activity \u2014 date by date');
  expect(body).toContain('refreshes every 5s');
  // Today's header is on the page for EVERY manager — including one who has
  // done nothing today, who must read "no activity" rather than vanish.
  const days = feed.window;
  const heading = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AE',
    { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
  for (const d of days) expect(body).toContain(heading(d));
  expect(body).not.toContain('recent activity');
  // "Upcoming Renewals" is back as a heading, but as the four-state BREAKDOWN
  // card, not the list of five leases that used to sit here — assert the shape,
  // not the absence of the words.
  expect(body).toContain('renewed');
  expect(body).toContain('notice sent');
  expect(body).toContain('notice due');
  expect(body).toContain('vacating');
  // Each manager has their own named column.
  for (const m of feed.managers) expect(body).toContain((m.name ?? '').toLowerCase());

  // It actually polls: count the requests over a 12-second window. At 5s that is
  // two more reads on top of the mount read.
  let polls = 0;
  page.on('request', r => { if (r.url().includes('/manager-activity')) polls++; });
  await page.waitForTimeout(12_000);
  // eslint-disable-next-line no-console
  console.log('polls in 12s:', polls);
  expect(polls).toBeGreaterThanOrEqual(2);

  // Clicking a row opens what changed — the report section's drill-down. Guarded
  // on there BEING a row: the panel is today-only, so on a quiet day it is
  // legitimately empty and an unconditional click would fail the suite for a
  // correct render. The empty state is asserted instead.
  const rows = page.getByTitle('See what changed');
  if (await rows.count() > 0) {
    await rows.first().click();
    await page.waitForTimeout(600);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/rp-dashboard-activity-changes.png`, fullPage: false });
    await page.getByRole('dialog').getByLabel('Close').click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } else {
    // Every manager still has a column and today's heading, reading "no activity".
    expect(feed.managers.every(m => m.entries.length === 0)).toBe(true);
    expect(body).toContain('no activity');
    // …and an idle manager still says when they were last seen.
    expect(body).toContain('nothing today · last seen');
  }

  await page.screenshot({ path: `${SHOTS}/rp-dashboard-live-activity.png`, fullPage: false });
});
