/**
 * Contract 394 on the manager route — nothing has cleared on this lease, so no
 * RCP receipt number exists yet; every page should fall back to the PLAN REF
 * (PP-2-2026-00104), never the year-less RCP-CID-394-* label.
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

test('contract 394 manager receipts', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, 'sheco1300@yahoo.com');

  for (const kind of ['all', 'deposit', 'vat', 'rental']) {
    await page.goto(`/dashboard/manager/contracts/394/print/receipt?rp=2&kind=${kind}`);
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${SHOTS}/394-mgr-${kind}.png`, fullPage: true });
    const bar = (await page.getByText(/— (RCP|PP|CID)/).first().textContent().catch(() => null)) ?? '(combined)';
    console.log(`394 ${kind.padEnd(8)} ${bar.trim()}`);
  }
});
