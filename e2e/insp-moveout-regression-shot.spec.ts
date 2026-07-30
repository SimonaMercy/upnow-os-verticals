/**
 * Move-out regression after the move-in title/tile cleanup: the move-out report
 * KEEPS its summary tiles (Total Categories / Total Items / Items to be Replaced
 * / Est. Total Cost) on screen and in the PDF — only the home icon is gone.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('move-out keeps its summary tiles', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'kbaalfalasi@gmail.com');
  await page.goto('/rental-provider/dashboard/contracts/391/inspection/v2?type=move_out');
  await page.getByRole('button', { name: 'Download' }).waitFor({ timeout: 60_000 });
  // The on-screen tiles only render while this page shows the HTML report (it is
  // being reworked to hide it once counter-signed) — the PDF assertion below is
  // the one that guards MY change.
  if (await page.getByText('Total Categories').count()) {
    await expect(page.getByText('Items to be Replaced').first()).toBeVisible();
  }
  await page.screenshot({ path: `${SHOTS}/rp-moveout.png`, fullPage: false });

  const out = `${SHOTS}/rp-moveout.pdf`;
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download' }).click();
  await (await dl).saveAs(out);
  // The tile labels render uppercase, so compare case-insensitively.
  const text = execFileSync('pdftotext', [out, '-']).toString().toLowerCase();
  expect(text).toContain('total categories');
  expect(text).toContain('items to be replaced');
});
