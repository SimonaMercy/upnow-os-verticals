/**
 * PAGE-LENS audit: what Cash Management and Cheques Management actually SHOW
 * and CLAIM. Captures the description paragraph, the KPI tile strip, the table
 * headers, the year-picker options and screenshots — for the default year and
 * for a year the picker offers but the report has no data for.
 *
 * Untracked working spec; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b3c3a712-8558-4890-bf12-df4741a749a6/scratchpad/lens';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

async function probe(page: Page, slug: string, year: number, tag: string) {
  await page.goto(`/rental-provider/dashboard/reports/${slug}?year=${year}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // The longest <p> above the filter card is the report description.
    const ps = Array.from(document.querySelectorAll('p')).map(txt).filter(t => t.length > 120);
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      label: s.getAttribute('aria-label') ?? '',
      options: Array.from(s.options).map(o => o.textContent?.trim() ?? ''),
      value: s.value,
    }));
    // KPI tiles: label (uppercase 10px) + value
    const tiles = Array.from(document.querySelectorAll('div.rounded-2xl.border')).flatMap(d => {
      const l = d.querySelector('p.uppercase');
      const v = l?.nextElementSibling;
      return l && v ? [`${txt(l)} = ${txt(v)}`] : [];
    });
    const heads = Array.from(document.querySelectorAll('table thead th')).map(txt);
    const bodyRows = document.querySelectorAll('table tbody tr').length;
    const foot = Array.from(document.querySelectorAll('table tfoot tr')).map(r =>
      Array.from(r.querySelectorAll('td')).map(txt).join(' | '));
    const noData = txt(document.body).includes('No matching records found');
    return { description: ps, selects, tiles, heads, bodyRows, foot, noData };
  });

  console.log(`\n########## ${slug} · ${year} ##########`);
  console.log('DESCRIPTION:', JSON.stringify(info.description, null, 1));
  console.log('FILTERS:', JSON.stringify(info.selects));
  console.log('TILES:', info.tiles.join('  ||  '));
  console.log('HEADERS:', info.heads.join(' · '));
  console.log('BODY ROWS:', info.bodyRows, 'NO-DATA STATE:', info.noData);
  console.log('FOOT:', info.foot.map(f => f.slice(0, 400)).join('\n      '));

  await page.screenshot({ path: `${SHOTS}/${tag}-top.png` });
  await page.evaluate(() => window.scrollBy(0, 900));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${tag}-mid.png` });
}

test('page lens: what the two collection pages show and claim', async ({ page }) => {
  test.setTimeout(420_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1900, height: 1250 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await probe(page, 'rent-collection', 2026, 'cash-2026');
  await probe(page, 'cheques-management', 2026, 'cheq-2026');
  // A year the Cheques picker offers but has nothing for.
  await probe(page, 'cheques-management', 2024, 'cheq-2024');
  // A year Cash offers (from availableYears) that Cheques does not.
  await probe(page, 'rent-collection', 2024, 'cash-2024');
});
