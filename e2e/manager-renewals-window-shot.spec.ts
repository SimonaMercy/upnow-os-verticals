import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// The "Renewals window" select drives BOTH renewal buckets — Renewals to raise
// and Renewal Offers — Awaiting Reply — via /manager/action-center?days=N. They
// are one queue split by whether the offer went out, so both are bounded on the
// parent lease's end date and neither may sit fixed while the control moves.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/960b0bda-8a22-4cd1-a090-3281dae246f9/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('Renewals window select re-scopes the renewals bucket', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');

  await page.goto('/dashboard/manager?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const select = page.locator('select');
  await expect(select).toHaveValue('90');

  /** A bucket card's rendered heading + count badge, read off the DOM. */
  const bucketText = async (heading: RegExp) =>
    (await page.locator('div').filter({ hasText: heading }).last().innerText()).slice(0, 90);

  const seenOffers: number[] = [];
  for (const d of ['30', '60', '90', '180']) {
    const wait = page.waitForResponse(r => r.url().includes(`days=${d}`) && r.status() === 200);
    await select.selectOption(d);
    const payload = await (await wait).json();
    await page.waitForTimeout(1200);
    // Both labels carry the selected window, so each card names its own scope.
    await expect(page.getByText(`Renewals to raise (≤${d}d)`)).toBeVisible();
    await expect(page.getByText(`Renewal Offers — Awaiting Reply (≤${d}d)`)).toBeVisible();
    seenOffers.push(payload.renewalOffersOut.count);
    console.log(`days=${d} →`, JSON.stringify(await bucketText(/^Renewals to raise/)),
                JSON.stringify(await bucketText(/^Renewal Offers/)));
    await page.screenshot({ path: `${SHOTS}/renewals-window-${d}.png` });
  }

  // The whole point of the fix: widening the window can only ever ADD offers, and
  // the count must actually move rather than sit at the unbounded total.
  expect(seenOffers).toEqual([...seenOffers].sort((a, b) => a - b));
  expect(seenOffers[0]).toBeLessThan(seenOffers[seenOffers.length - 1]);

  // The offers card is the one bucket read a building at a time: every row is a
  // unit label and the state of its answer, gathered under a building heading.
  await select.selectOption('90');
  await page.waitForResponse(r => r.url().includes('days=90') && r.status() === 200);
  await page.waitForTimeout(1200);

  // The card ROOT, not the header row inside it — the grouped list is a sibling
  // of the header, so a `.last()` text filter lands too deep to see it.
  const card = page.locator('div.bg-white.rounded-2xl')
    .filter({ hasText: 'Renewal Offers — Awaiting Reply' }).last();
  const text = await card.innerText();
  // The building headings are the sticky bar at the top of each group.
  const heads = card.locator('.mgr-bucket-list div.sticky');
  const buildings = await heads.allInnerTexts();
  console.log('groups:', JSON.stringify(buildings));
  expect(buildings.length).toBeGreaterThan(1);               // grouped, not one flat list
  expect(text).toMatch(/Awaiting reply/);
  // Rows carry the unit and the status and nothing else — no offered term, no
  // customer name, no "current ends" date.
  expect(text).not.toMatch(/current ends/);

  // Screenshot the card scrolled to the end too, so every group is evidenced.
  await card.screenshot({ path: `${SHOTS}/offers-grouped-top.png` });
  await card.locator('.mgr-bucket-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(500);
  await card.screenshot({ path: `${SHOTS}/offers-grouped-bottom.png` });
});
