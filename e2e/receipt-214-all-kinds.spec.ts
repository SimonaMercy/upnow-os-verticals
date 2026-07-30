/**
 * Contract 214 = the "after money lands" state (cheques + deposit cleared), so it
 * shows what CID-394 will look like once its cheques clear. Captures every segment
 * on the manager route.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/7697c093-c986-4a44-bce4-ef68a95dd4b5/scratchpad/receipt-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('contract 214 every receipt segment', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  page.on('console', m => { if (m.type() === 'error') console.log('  console.error:', m.text().slice(0, 200)); });
  page.on('pageerror', e => console.log('  pageerror:', String(e).slice(0, 200)));
  await signIn(page, 'sheco1300@yahoo.com');

  // Management Fee is deliberately absent on 214 — it has no admin/commission fee
  // row (only rent + ejari), so that page and its tab correctly do not exist.
  for (const kind of ['vat']) {
    await page.goto(`/dashboard/manager/contracts/214/print/receipt?rp=2&kind=${kind}`, { waitUntil: 'domcontentloaded' });
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => console.log(`  ${kind}: no canvas`));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/214-mgr-${kind}.png` });
    const bar = (await page.getByText(/— (RCP|PP)/).first().textContent().catch(() => null)) ?? '(none)';
    console.log(`214 ${kind.padEnd(11)} ${bar.trim()}`);
  }
});
