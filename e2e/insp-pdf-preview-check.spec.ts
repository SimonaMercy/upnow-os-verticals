/**
 * Move-in inspection PDF (the RP/manager Preview / Download output): neutral
 * "INSPECTION REPORT" title, no home icon, no descriptive subtitle, no
 * Total Categories / Total Items / Items Flagged tiles, and no "Per Door"
 * category sub-label — it must read exactly like the on-screen report.
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

test('manager move-in PDF: neutral title, no tiles, no sub-labels', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });

  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/contracts/394/inspection/v2?type=move_in&rp=2');
  // Anchor on the export control, not the on-screen report markup — this page's
  // layout is being reworked and hides the HTML report once counter-signed.
  await page.getByRole('button', { name: 'Download' }).waitFor({ timeout: 60_000 });

  const out = `${SHOTS}/manager-movein.pdf`;
  const dl = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Download' }).click();
  await (await dl).saveAs(out);
  execFileSync('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', out, out.replace(/\.pdf$/, '')]);
  // Tile / date-box labels render uppercase, so compare case-insensitively.
  const text = execFileSync('pdftotext', [out, '-']).toString().toLowerCase();

  expect(text).toContain('inspection report');
  expect(text).not.toContain('move-in inspection report');
  expect(text).not.toContain('detailed inspection of property');
  expect(text).not.toContain('total categories');
  expect(text).not.toContain('total items');
  expect(text).not.toContain('items flagged');
  expect(text).not.toContain('per door');
  expect(text).toContain('inspection type');
});
