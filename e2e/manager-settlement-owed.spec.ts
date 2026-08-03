import { test, expect, Page } from '@playwright/test';

/**
 * Settlement debts — an ended lease still holding the customer's deposit —
 * belong to the FINAL SETTLEMENT flow and nowhere else: the dashboard's
 * Settlement Pending card lists them, and each one links to that lease's Final
 * Settlement page, where the refund is recorded.
 *
 * They are deliberately absent from the Operations board. Operations tracks work
 * on LIVE leases; an ended one has no pipeline left. Carrying the debt there as
 * well put two cards for the same unit side by side — a cancelled renewal child
 * next to the parent lease still winding down, same unit and same customer —
 * which reads as a duplicate rather than as two pieces of work.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

type Ops = { id: number; status: string; windDown?: boolean; terminationRequested?: boolean };

test('settlement debts live in the Final Settlement flow, never on Operations', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'sheco1300@yahoo.com');

  const ac = await (await page.request.get('/api/manager/action-center?days=90')).json();
  const pending = ac.settlementPending as {
    count: number;
    items: { id: number; unit?: string; deposit?: string; rpId?: number; status?: string }[];
  };
  const totalHeld = pending.items.reduce((s, i) => s + Number(i.deposit ?? 0), 0);
  console.log('SETTLEMENT PENDING', pending.count, 'AED held', totalHeld);

  // Ended EITHER WAY. `SETTLEMENT_OWED_SQL` covers terminated AND expired,
  // because nothing in the expiry path opens a settlement — a lease that simply
  // ran out leaves the deposit sitting there with no prompt anywhere. Asserting
  // terminated-only would pass on an empty list and hide exactly that: on this
  // book all 20 of these debts (AED 94,000, back to 2023) are `expired`.
  expect(pending.count, 'no settlement debts surfaced at all').toBeGreaterThan(0);
  const held = pending.items.filter(i => Number(i.deposit ?? 0) > 0);
  expect(held.length, 'a debt was listed holding no money').toBe(pending.items.length);

  // Operations carries LIVE leases only — no ended lease may reach the board,
  // whether or not it still owes a deposit.
  const ops: Ops[] = [];
  for (const rp of [1, 2]) ops.push(...(await (await page.request.get(`/api/manager/contracts/operations?rp=${rp}`)).json()));
  const endedOnOps = ops.filter(c => c.status === 'expired' || c.status === 'terminated');
  console.log('ENDED LEASES ON OPERATIONS', endedOnOps.length,
              JSON.stringify(endedOnOps.map(c => `${c.id}:${c.status}`)));
  expect(endedOnOps, 'an ended lease reached the Operations board').toEqual([]);

  // No debt may appear on both surfaces — that pairing is what looked like a
  // duplicate card on the unit.
  const opsIds = new Set(ops.map(c => c.id));
  const onBoth = pending.items.filter(i => opsIds.has(i.id)).map(i => i.id);
  expect(onBoth, `contracts on both the debt list and Operations: ${onBoth}`).toEqual([]);

  // Every remaining Terminated-tab card is a live lease winding down.
  const term = ops.filter(c => c.windDown || c.terminationRequested);
  for (const c of term) expect(c.status, `contract ${c.id} on Terminated`).toBe('active');

  // And the debt links to the page that clears it.
  const first = pending.items[0];
  if (first) {
    await page.goto(`/dashboard/manager/contracts/${first.id}/settlement?rp=${first.rpId}`);
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain(`/contracts/${first.id}/settlement`);
    console.log('FINAL SETTLEMENT PAGE OK for contract', first.id);
  }
});

test('the Operations Terminated tab shows one card per winding-down lease', async ({ page }) => {
  test.setTimeout(180_000);
  const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/4a62b7c5-2078-4047-b218-c39be76f154e/scratchpad/shots';
  page.setViewportSize({ width: 1700, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');

  const ops: Ops[] = await (await page.request.get('/api/manager/contracts/operations?rp=2')).json();
  const term = ops.filter(c => c.windDown || c.terminationRequested);
  const ids = term.map(c => c.id).sort((a, b) => a - b);
  console.log('TERMINATED TAB CONTRACTS', JSON.stringify(ids));
  // Contract 349 — the cancelled renewal child of 214 on Unit 320, zero deposit,
  // same customer still on the parent — is the card that read as a duplicate.
  expect(ids).not.toContain(349);

  await page.goto('/dashboard/manager/operations?rp=2&tab=terminated&view=kanban');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/operations-terminated.png`, fullPage: true });
  await expect(page.getByText('Deposit settlement').first()).toBeVisible();
});
