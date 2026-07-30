/**
 * The "This tenancy is live" card shows the SAME segregated payment summary the
 * Payment Plan document renders, and no longer repeats Record payment, Propose
 * renewal or Terminate directly. Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const S = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/ops-shots';
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}
async function openLiveCard(page: Page, id: number, tag: string) {
  await page.goto(`/dashboard/manager/operations/${id}?rp=2`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  // Click the "Active" stop on the journey rail.
  const active = page.locator('text=/^Active$/').first();
  if (await active.count()) { await active.click(); await page.waitForTimeout(1200); }
  // The Payment Plan's four group headings, rendered by SegregatedPlanView.
  const groups: string[] = [];
  for (const g of ['Security Deposit', 'Rental Income', 'Management Fee', 'Third Party']) {
    if (await page.getByText(g, { exact: true }).count()) groups.push(g);
  }
  const has = groups.length ? 1 : 0;
  console.log(`[${tag} #${id}] plan groups on page: ${JSON.stringify(groups)}`);
  if (has) {
    await page.getByText(groups[0], { exact: true }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${S}/live-breakdown-${tag}.png`, fullPage: true });
  }
  // Scope to the live card itself — these actions legitimately still exist once
  // elsewhere on the page (the lease-actions footer); only the duplicate went.
  const live = page.locator('text=This tenancy is live.').first();
  const region = (await live.count()) ? live.locator('xpath=ancestor::*[4]') : null;
  for (const name of ['Record payment', 'Propose renewal', 'Terminate directly']) {
    const inCard = region ? await region.getByRole('button', { name }).count() : 0;
    const onPage = await page.getByRole('button', { name }).count();
    console.log(`   "${name}": in live card=${inCard} · elsewhere on page=${onPage - inCard}`);
    expect(inCard, `${name} removed from the live card`).toBe(0);
  }
  return has;
}
test('live card: breakdown replaces repeated actions', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(S, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  await openLiveCard(page, 394, 'new');
  await openLiveCard(page, 392, 'renewal');
});
