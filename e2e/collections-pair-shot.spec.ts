/**
 * Cash Management and Cheques Management, side by side — what the landlord
 * actually sees on the two pages they asked to have aligned. Shoots both, at
 * the top and scrolled into the matrix, and prints the header figures each
 * page puts in front of the reader.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b3c3a712-8558-4890-bf12-df4741a749a6/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('the two collection reports as the landlord sees them', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  for (const slug of ['rent-collection', 'cheques-management']) {
    await page.goto(`/rental-provider/dashboard/reports/${slug}?year=2026`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);

    // The summary strip — what the page asserts before any row is read.
    const tiles = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll('*').forEach(() => {});
      // Grab every short label/value pair rendered above the table.
      const table = document.querySelector('table');
      const walk = (n: Element) => {
        const t = (n.textContent ?? '').trim();
        if (t && t.length < 60 && n.children.length === 0) out.push(t);
      };
      const scope = table?.closest('main') ?? document.body;
      let stop = false;
      const rec = (n: Element) => {
        if (stop) return;
        if (n === table) { stop = true; return; }
        if (n.children.length === 0) walk(n); else Array.from(n.children).forEach(rec);
      };
      rec(scope);
      return out;
    });
    console.log(`\n===== ${slug} =====`);
    console.log(tiles.join(' | '));

    // Column headers actually rendered.
    const heads = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table thead th')).map(th => (th.textContent ?? '').trim()));
    console.log('HEADERS:', heads.join(' · '));

    const rowCount = await page.locator('table tbody tr').count();
    console.log('BODY ROWS:', rowCount);

    // Filter controls on offer.
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, select')).map(b => (b.textContent ?? '').trim())
        .filter(t => t && t.length < 40).slice(0, 40));
    console.log('CONTROLS:', controls.join(' | '));

    await page.screenshot({ path: `${SHOTS}/${slug}-top.png` });
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/${slug}-mid.png` });
  }
});
