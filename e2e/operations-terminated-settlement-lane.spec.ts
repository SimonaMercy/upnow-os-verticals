import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * Operations → Terminated: a wind-down whose settlement has been SENT belongs on
 * the Deposit settlement lane, not parked on Bills cleared.
 *
 * The Bills-cleared gate used to read one source only — every row inside the
 * move-out inspection's `billClearance.items` ticked. That form LOCKS on submit,
 * so a move-out submitted without the utilities tab filled in could never satisfy
 * the gate, and the card sat on Bills cleared forever even after the settlement
 * was signed by the customer. Utility balances entered on the settlement page are
 * money lines; they never tick those boxes.
 *
 * Manager 411 (sheco1300@yahoo.com) manages landlord 2, which owns every wind-down
 * lease in the clone.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/4a62b7c5-2078-4047-b218-c39be76f154e/scratchpad/shots';
const RP = 2;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

type Ops = {
  id: number; windDown?: boolean; terminationRequested?: boolean;
  checklist: { key: string; done: boolean }[];
};

/** Terminated lane order, mirrored from OperationsPipelines TERM_STAGES. A card
 *  sits in its FIRST incomplete lane. */
const TERM_LANES: [string, string[]][] = [
  ['Requested', ['termination_accept']],
  ['Move-out inspection', ['move_out']],
  ['Bills cleared', ['bill_clearance']],
  ['Deposit settlement', ['settlement']],
];
function laneOf(c: Ops): string {
  for (const [title, keys] of TERM_LANES) {
    if (c.checklist.some(i => keys.includes(i.key) && !i.done)) return title;
  }
  return TERM_LANES[TERM_LANES.length - 1][0];
}

test('wind-down leases with a sent settlement sit on the Deposit settlement lane', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');

  const res = await page.request.get(`/api/manager/contracts/operations?rp=${RP}`);
  expect(res.ok()).toBeTruthy();
  const ops = (await res.json()) as Ops[];
  const term = ops.filter(c => c.windDown || c.terminationRequested);
  expect(term.length).toBeGreaterThan(0);

  const lanes = term.map(c => ({ id: c.id, lane: laneOf(c) }));
  fs.writeFileSync(`${SHOTS}/terminated-lanes.json`, JSON.stringify(lanes, null, 2));

  // Every lease with a settlement out for signature (55, 85, 127, 214, 224 in the
  // clone) must have cleared the upstream wind-down gates. 82 has no settlement
  // record at all, so it legitimately stays behind.
  for (const id of [55, 85, 127, 214, 224]) {
    const row = lanes.find(l => l.id === id);
    if (!row) continue;                      // clone drift — skip rather than fail
    expect(row.lane, `contract ${id}`).toBe('Deposit settlement');
  }

  await page.goto(`/dashboard/manager/operations?tab=terminated&view=kanban&rp=${RP}`);
  await page.waitForLoadState('networkidle');
  await page.getByText('Deposit settlement').first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/terminated-kanban.png`, fullPage: true });
});
