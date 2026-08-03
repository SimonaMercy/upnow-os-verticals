import { test, expect, Page } from '@playwright/test';

/**
 * Settlement debts: an ended lease still holding the customer's deposit must
 * appear BOTH on the dashboard's Settlement Pending card and on the Operations
 * Terminated tab, where the manager records the refund that closes it. The two
 * come from one shared predicate, so this asserts they are the same set.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

type Ops = {
  id: number; status: string; windDown?: boolean; terminationRequested?: boolean;
  checklist: { key: string; done: boolean }[];
};

test('unsettled deposits appear on both the dashboard and Operations', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'sheco1300@yahoo.com');

  const ac = await (await page.request.get('/api/manager/action-center?days=90')).json();
  const pending = ac.settlementPending as {
    count: number;
    items: { id: number; unit?: string; deposit?: string; date?: string; rpId?: number }[];
  };
  const totalHeld = pending.items.reduce((s, i) => s + Number(i.deposit ?? 0), 0);
  console.log('SETTLEMENT PENDING', pending.count, 'AED held', totalHeld);
  console.log('SAMPLE', JSON.stringify(pending.items.slice(0, 4)));

  // Every flagged lease actually holds money — the old bucket flagged closed
  // leases that never took a deposit.
  for (const i of pending.items) expect(Number(i.deposit ?? 0)).toBeGreaterThan(0);

  // Operations must carry the same leases, in the Deposit-settlement lane.
  const ops: Ops[] = [];
  for (const rp of [1, 2]) ops.push(...(await (await page.request.get(`/api/manager/contracts/operations?rp=${rp}`)).json()));
  const endedOnOps = ops.filter(c => c.status === 'expired' || c.status === 'terminated');
  console.log('ENDED LEASES NOW ON OPERATIONS', endedOnOps.length);

  expect(endedOnOps.map(c => c.id).sort((a, b) => a - b))
    .toEqual(pending.items.map(i => i.id).sort((a, b) => a - b));

  // They ride the Terminated tab, and settlement is their ONLY open step —
  // a finished lease can't be sent back for a move-out inspection.
  for (const c of endedOnOps) {
    expect(c.windDown, `contract ${c.id} not on the Terminated tab`).toBeTruthy();
    expect(c.checklist.map(i => i.key)).toEqual(['settlement']);
    expect(c.checklist[0].done).toBe(false);
  }

  // And the card links to the page that clears it.
  const first = pending.items[0];
  await page.goto(`/dashboard/manager/contracts/${first.id}/settlement?rp=${first.rpId}`);
  await page.waitForLoadState('networkidle');
  expect(page.url()).toContain(`/contracts/${first.id}/settlement`);
  console.log('SETTLEMENT PAGE OK for contract', first.id);
});

test('the Operations Terminated tab shows the settlement debts', async ({ page }) => {
  test.setTimeout(180_000);
  const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/eab98470-dc27-4270-b9fe-efe90a682182/scratchpad/shots';
  page.setViewportSize({ width: 1700, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/operations?rp=2&tab=terminated&view=kanban');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/operations-terminated.png`, fullPage: true });
  await expect(page.getByText('Deposit settlement').first()).toBeVisible();
  // The board defaults to the CURRENT year; these debts are from 2024-25 and
  // must show anyway, so the count has to include them without touching filters.
  const tab = page.getByText('TERMINATED', { exact: false }).first();
  console.log('TERMINATED TAB:', (await tab.locator('..').innerText()).replace(/\n/g, ' '));
  const laneCount = await page.locator('text=/^CID-/').count();
  console.log('CARDS ON TERMINATED TAB:', laneCount);
  expect(laneCount).toBeGreaterThanOrEqual(20);
});
