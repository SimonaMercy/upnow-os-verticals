import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * The payments table groups every replacement under the bounced cheque it pays
 * off, so a property manager can see at a glance that the extra rent lines are
 * that bounce arriving in pieces — not additional rent.
 *
 * Contract 181 is the case that motivated it: a 17,500 cheque bounced on 15 Jun
 * 2026 and was settled by 10,000 + 7,500 — and the 10,000 is DATED 12 Jun, three
 * days BEFORE the bounce, so in due-date order it sorted above the row it
 * replaces.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/c9f3f014-58d7-483a-b908-b85a517c9ad1/scratchpad/shots';

const RP_EMAIL = 'kbaalfalasi@gmail.com';   // rental_providers.id = 2, owns contract 181
const CONTRACT = 181;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('replacements sit under the bounce they settle, not at their own due date', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });

  await signIn(page, RP_EMAIL);
  await page.goto(`/rental-provider/dashboard/contracts/${CONTRACT}/v2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // The rent schedule is the first payments table on the record.
  //
  // Waiting on the GROUP MARKER, not on a row's description. This used to wait
  // for the text "Rent cheque", which is contract DATA rather than behaviour —
  // contract 181's rows are labelled "Instalment N" in the current book, so the
  // spec failed on a clone refresh while the grouping it tests was working
  // perfectly. A test of the nesting should key on the nesting.
  const rows = page.locator('table.ptable').first().locator('tbody tr');
  await expect(rows.locator('css=.replarrow').first()).toBeVisible({ timeout: 20_000 });

  const classes = await rows.evaluateAll(rs => rs.map(r => (r as HTMLElement).className));
  const kidIdx = classes.map((c, i) => (c.includes('replkid') ? i : -1)).filter(i => i >= 0);
  expect(kidIdx.length, 'both payments against the bounce are nested').toBe(2);

  // Nested rows follow their parent immediately, and the parent is the bounce.
  const headIdx = kidIdx[0] - 1;
  expect(classes[headIdx]).toContain('replgrp');
  expect(classes[headIdx]).not.toContain('replkid');
  expect(kidIdx[1]).toBe(kidIdx[0] + 1);
  await expect(rows.nth(headIdx)).toContainText(/Bounced/i);
  await expect(rows.nth(headIdx)).toContainText('001395');

  // The nested rows carry the replacement money and say what they are.
  await expect(rows.nth(kidIdx[0])).toContainText('Replacement');
  await expect(rows.nth(kidIdx[1])).toContainText('Replacement');
  const kidText = (await rows.nth(kidIdx[0]).innerText()) + (await rows.nth(kidIdx[1]).innerText());
  expect(kidText).toContain('10,000');
  expect(kidText).toContain('7,500');

  // Instalment numbering skips the replacements — four rent cheques, 1..4.
  const numbers = await rows.evaluateAll(rs => rs
    .filter(r => !(r as HTMLElement).className.includes('replkid'))
    .map(r => r.querySelector('td')?.textContent?.trim() ?? '')
    .filter(t => /^\d+$/.test(t)));
  expect(numbers).toEqual(['1', '2', '3', '4']);

  await rows.nth(headIdx).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/bounce-group.png` });
  await page.screenshot({ path: `${SHOTS}/bounce-group-full.png`, fullPage: true });
});
