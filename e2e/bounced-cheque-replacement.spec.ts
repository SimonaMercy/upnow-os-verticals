import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * A bounced cheque that has been replaced must stop showing as open work.
 *
 * Walks the real flow on the landlord dashboard: read the "overdue / bounced"
 * KPI, record the replacement cheque on the lease that carries the bounce, and
 * confirm the KPI (and the manager's Action Center, which reads the same rule
 * through a different query) both drop by exactly one.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/2a299e2c-8e1d-4e46-bf19-20e0128f77fd/scratchpad/shots';

const RP_EMAIL = 'kbaalfalasi@gmail.com';   // rental_providers.id = 2
const MGR_EMAIL = 'unibuild00@gmail.com';   // manages RP 2, canManageCollections

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

/** Rent cheques the landlord is still being chased for. */
async function overdueOrBounced(page: Page): Promise<number> {
  const res = await page.request.get('/api/contracts/financial-summary');
  expect(res.ok()).toBeTruthy();
  const body = await res.json() as { overdueOrBounced?: number };
  return Number(body.overdueOrBounced ?? -1);
}

/** Contract ids on the manager's cheque buckets for RP 2. Bounced and overdue
 *  are separate cards — a replaced bounce has to drop off BOTH, so this checks
 *  the union rather than picking one. */
async function managerChequeBucket(page: Page): Promise<number[]> {
  const res = await page.request.get('/api/manager/action-center?rp=2');
  expect(res.ok()).toBeTruthy();
  const body = await res.json() as {
    chequesBounced?: { items?: Array<{ id: number }> };
    chequesOverdue?: { items?: Array<{ id: number }> };
  };
  return [...(body.chequesBounced?.items ?? []), ...(body.chequesOverdue?.items ?? [])].map(i => i.id);
}

test('a replaced bounce drops off the landlord KPI and the manager action list', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });

  await signIn(page, RP_EMAIL);

  // Pick a bounced rent cheque that has no replacement yet.
  const recv = await page.request.get('/api/contracts/receivables');
  const rows = await recv.json() as Array<{ id: number; contractId: number; amount: number; chequeNumber: string | null; status: string }>;
  const target = rows.find(r => r.status === 'overdue' && r.chequeNumber && r.contractId);
  expect(target, 'expected a bounced/overdue rent cheque to work with').toBeTruthy();

  const before = await overdueOrBounced(page);
  expect(before).toBeGreaterThan(0);

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/01-dashboard-before.png` });

  // Record the replacement through the UI the landlord actually uses.
  await page.goto(`/rental-provider/dashboard/contracts/${target!.contractId}/v2`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const record = page.getByRole('button', { name: /Record replacement/i }).first();
  await expect(record).toBeVisible({ timeout: 20_000 });
  await record.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/02-bounced-row-action.png` });
  await record.click();

  const modal = page.locator('.modal').first();
  await expect(modal).toBeVisible();
  // The popup opens pre-filled (full face value) and pre-linked to the bounce.
  // (Labels here are plain siblings, not htmlFor-bound — target the input.)
  await modal.locator('input[placeholder*="Cheque #"]').fill('REPL-E2E-01');
  await page.screenshot({ path: `${SHOTS}/03-replacement-popup.png` });
  await modal.getByRole('button', { name: /Save payment/i }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/04-linked-rows.png` });

  // The ledger keeps the bounce as history, labelled with what settled it.
  await expect(page.getByText(/Replaced by cheque REPL-E2E-01/i).first()).toBeVisible({ timeout: 15_000 });

  const after = await overdueOrBounced(page);
  expect(after).toBe(before - 1);

  await page.goto('/rental-provider/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/05-dashboard-after.png` });

  // Same rule, a different query: the manager's bucket must agree. The lease
  // drops off only if this was its LAST open cheque, so compare against what the
  // receivables list still says is owed on it rather than assuming.
  const stillOpenOnLease = (rows as Array<{ contractId: number; id: number; status: string }>)
    .filter(r => r.contractId === target!.contractId && r.status === 'overdue' && r.id !== target!.id).length;

  await signIn(page, MGR_EMAIL);
  const bucketIds = await managerChequeBucket(page);
  expect(bucketIds.includes(target!.contractId)).toBe(stillOpenOnLease > 0);

  await page.goto('/dashboard/manager?rp=2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/06-manager-dashboard.png`, fullPage: true });

  // Put the data back. This runs against a clone of production, so a test that
  // banked a fabricated cheque on every run would quietly distort the very
  // dashboards it is checking. The row is pending, so DELETE accepts it.
  await signIn(page, RP_EMAIL);
  const created = (await (await page.request.get('/api/contracts/receivables')).json() as Array<{ id: number; chequeNumber: string | null; contractId: number }>)
    .find(r => r.chequeNumber === 'REPL-E2E-01');
  if (created) {
    const del = await page.request.delete(`/api/contracts/${created.contractId}/payments/${created.id}`);
    expect(del.ok()).toBeTruthy();
  }
  expect(await overdueOrBounced(page)).toBe(before);
});
