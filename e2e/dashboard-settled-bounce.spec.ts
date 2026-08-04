import { test, expect, Page } from '@playwright/test';

/**
 * A bounce that has been made good must stop being billed on the dashboards.
 *
 * The landlord dashboard and the manager's view of it both read
 * /contracts/financial-summary, and it used to sum every non-cancelled rent row
 * in the range — so once a replacement cheque was recorded, the range carried
 * BOTH it and the bounce and the "Receivables" figure billed the same instalment
 * twice (AED 114,250 of phantom receivable on this landlord's 2026).
 *
 * The test does it the way a landlord would: record the replacement, watch the
 * figure, then put the data back. The replacement is deliberately dated OUTSIDE
 * the range under test, so the expected move is exactly the bounce's face value
 * rather than a netting of the two.
 */
const RP_EMAIL = 'kbaalfalasi@gmail.com';   // rental_providers.id = 2
const MGR_EMAIL = 'unibuild00@gmail.com';   // manages RP 2, canViewFinancials

const RANGE = 'from=2025-05-01&to=2025-05-31';
const REPLACEMENT_REF = 'REPL-DASH-E2E';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

/** The landlord's own dashboard figures, and the manager's view of the same. */
async function summaries(page: Page) {
  await signIn(page, RP_EMAIL);
  const rp = await (await page.request.get(`/api/contracts/financial-summary?${RANGE}`)).json();
  await signIn(page, MGR_EMAIL);
  const mgr = await (await page.request.get(`/api/manager/financial-summary?rp=2&${RANGE}`)).json();
  await signIn(page, RP_EMAIL);
  return { rp, mgr } as { rp: Summary; mgr: Summary };
}

interface Summary {
  receivablesInRange: number;
  overdueOrBounced: number;
  chartData: Array<{ month: string; receivable: number; collected: number }>;
}

test('a replaced bounce stops being billed on the landlord and manager dashboards', async ({ page }) => {
  test.setTimeout(180_000);

  await signIn(page, RP_EMAIL);

  // A bounced rent cheque, due inside the range, with nothing recorded against it.
  const recv = await (await page.request.get('/api/contracts/receivables')).json() as Array<
    { id: number; contractId: number; amount: number; dueDate: string; status: string }>;
  const bounce = recv.find(r => r.status === 'overdue' && r.dueDate?.slice(0, 7) === '2025-05' && r.amount > 0);
  expect(bounce, 'expected a bounced May-2025 rent cheque to work with').toBeTruthy();

  const before = await summaries(page);
  expect(before.rp.receivablesInRange).toBe(before.mgr.receivablesInRange);
  expect(before.rp.receivablesInRange).toBeGreaterThan(bounce!.amount);

  // Record what the customer handed over, dated outside the range.
  const created = await page.request.post(`/api/contracts/${bounce!.contractId}/payments`, {
    data: {
      description: 'E2E replacement for a bounced cheque',
      amount: bounce!.amount,
      paymentType: 'rental_income',
      paymentMethod: 'bank_transfer',
      chequeNumber: REPLACEMENT_REF,
      // Outside the range under test, and not yet due: a replacement dated in the
      // past would be overdue in its own right and the arrears count would not
      // move, which is correct behaviour but tests nothing about the bounce.
      transactionDate: '2026-12-01',
      replacesPaymentId: bounce!.id,
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  try {
    const after = await summaries(page);

    // The bounce leaves the receivable — and takes nothing else with it.
    expect(after.rp.receivablesInRange).toBe(before.rp.receivablesInRange - bounce!.amount);
    // The manager sees the same number as the landlord, before and after.
    expect(after.mgr.receivablesInRange).toBe(after.rp.receivablesInRange);
    // …and it stops being chased.
    expect(after.rp.overdueOrBounced).toBe(before.rp.overdueOrBounced - 1);

    // The chart is the same figure drawn per month, so it has to agree.
    const bar = (s: Summary) => s.chartData.reduce((t, c) => t + c.receivable, 0);
    expect(bar(after.rp)).toBe(bar(before.rp) - bounce!.amount);
  } finally {
    // Put the clone back — a fabricated cheque left behind would distort the very
    // dashboards this checks. The row is pending, so DELETE accepts it.
    const rows = await (await page.request.get('/api/contracts/receivables')).json() as Array<
      { id: number; contractId: number; chequeNumber: string | null }>;
    const mine = rows.find(r => r.chequeNumber === REPLACEMENT_REF);
    if (mine) {
      const del = await page.request.delete(`/api/contracts/${mine.contractId}/payments/${mine.id}`);
      expect(del.ok()).toBeTruthy();
    }
  }

  const restored = await summaries(page);
  expect(restored.rp.receivablesInRange).toBe(before.rp.receivablesInRange);
  expect(restored.rp.overdueOrBounced).toBe(before.rp.overdueOrBounced);
});
