/**
 * Move-in stop on Operations: the checklist is a read-out (no dead "Undo"
 * buttons), the signature row reads "Manager / Landlord Sign", and there is no
 * "upload the move-in document instead" escape hatch — progress comes from the
 * inspection workspace.
 *
 * Runs against a lease whose move-in is still PENDING (394's is now complete, and
 * a completed stop renders the "Move-in complete" panel with no checklist).
 * Untracked; mirrored to the session scratchpad.
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
test('move-in stop: no Undo, no upload-instead', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(S, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/operations/393?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  // Select the Move-in stop explicitly — once every step is complete the page
  // opens on Active, so relying on the default stop makes this flaky.
  const moveIn = page.getByText('Move-in', { exact: true });
  if (await moveIn.count()) { await moveIn.first().click(); await page.waitForTimeout(1500); }
  const undo = await page.getByRole('button', { name: /^Undo$/ }).count();
  const upl  = await page.getByRole('button', { name: /Upload move-in document/i }).count();
  const rows = await page.locator('.chkrow').allInnerTexts();
  console.log(`Undo=${undo} · upload-move-in=${upl} · chkrows=${JSON.stringify(rows.map(r => r.replace(/\n+/g, ' | ')))}`);
  expect(undo, 'no dead Undo buttons').toBe(0);
  expect(upl, 'no upload-move-in-document option').toBe(0);
  expect(rows.some(r => r.includes('Manager / Landlord Sign')), 'signature row renamed').toBe(true);
  expect(rows.some(r => r.includes('You counter-signed')), 'old label gone').toBe(false);
  await page.locator('.chkrow').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${S}/movein-stop.png` });
});
