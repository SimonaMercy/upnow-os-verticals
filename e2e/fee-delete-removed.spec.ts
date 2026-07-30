/**
 * Fee rows (Management Fee + Third Party) must offer Edit but NOT Delete —
 * on a NEW lease and on a RENEWAL alike. Untracked; mirrored to scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/ops-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

async function auditFees(page: Page, id: number, tag: string) {
  await page.goto(`/dashboard/manager/operations/${id}?rp=2`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  const feeTable = page.locator('table.ptable').filter({ hasText: 'Fee' }).last();
  const txt = (await feeTable.innerText()).replace(/\n+/g, ' | ');
  console.log(`\n[${tag} #${id}] ${txt.slice(0, 700)}`);
  const del = feeTable.getByRole('button', { name: /Delete/ });
  const edit = feeTable.getByRole('button', { name: /Edit/ });
  console.log(`[${tag} #${id}] Delete buttons=${await del.count()}  Edit buttons=${await edit.count()}`);
  expect(await del.count(), `${tag} #${id} has no Delete`).toBe(0);
  await feeTable.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/fees-${tag}-${id}.png` });
  return { del: await del.count(), edit: await edit.count() };
}

test('fee rows: no Delete on new lease or renewal', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, 'sheco1300@yahoo.com');
  await auditFees(page, 394, 'new');       // new lease
  await auditFees(page, 392, 'renewal');   // renewal child of 391
});
