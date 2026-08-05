/**
 * Payments ledger — Rental Income scope and year basis.
 *
 * Two rules this page kept getting wrong, both now asserted:
 *
 *  1. SCOPE. The ledger reports the EARNING LEASE SET — one live lease per unit,
 *     `EARNING_LEASE_IDS_SQL`, the same set Cash Management, Cheques Management
 *     and the dashboard Receivables KPI use. It used to report the ACTIVE-CUSTOMER
 *     set, which swept in every term a current customer had ever held (RP 2: 189
 *     expired leases / AED 12.45M and 33 leases that had not started / AED 3.01M)
 *     while silently dropping AED 797,650 on 7 fully-ended customers. Rental Income
 *     read AED 24.2M against a book of AED 7.08M.
 *
 *  2. PERIOD. A year selection buckets each payment by the period it falls DUE —
 *     its tax point, the basis Payment Grouping and Fee & VAT use. It used to match
 *     any row whose lease TERM overlapped the year, which is not a period basis:
 *     once the ledger holds only live leases, every lease overlaps the current year
 *     and "2026" quietly meant "all years".
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';

const RP = 'kbaalfalasi@gmail.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok())
    .toBeTruthy();
}

type Row = {
  paymentType: string;
  contractId: number | null;
  contractRef: string;
  amount: number;
  status: string;
  transactionDate: string | null;
  countsTowardTotals?: boolean;
  excludedReason?: string | null;
};

const counts = (r: Row) => r.countsTowardTotals !== false;
const rentTotal = (rows: Row[]) =>
  rows.filter(r => r.paymentType === 'rental_income' && counts(r)).reduce((s, r) => s + r.amount, 0);

test('Rental Income reports the earning-lease book, not every lease a current customer ever held', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, RP);

  const rows: Row[] = await (await page.request.get('/api/contracts/payments')).json();
  // Cheques Management runs the same earning rule and publishes the contracted
  // figure that rule produces — the anchor both surfaces have to agree on.
  const cheques = await (await page.request.get('/api/reports/cheques-management')).json();
  const book = cheques.totals.annualRentFils / 100;

  const rent = rows.filter(r => r.paymentType === 'rental_income');
  const income = rentTotal(rows);
  console.log(`Rental Income ${income}  ·  annual-rent book ${book}  ·  ${rent.length} rent rows`);

  // ── SCOPE ────────────────────────────────────────────────────────────────
  // Not a single rent row may sit outside the lease set Cheques Management lists.
  // This is the assertion that fails the moment the active-customer rule returns.
  const bookLeases = new Set<number>(
    (cheques.rows as Array<{ contractId: number }>).map(r => Number(r.contractId)).filter(id => id > 0),
  );
  const strays = [...new Set(rent.map(r => r.contractId).filter((id): id is number => id != null))]
    .filter(id => !bookLeases.has(id));
  expect(strays, `rent rows on leases outside the earning book: ${strays.join(', ')}`).toEqual([]);

  // ── AMOUNT ───────────────────────────────────────────────────────────────
  // The ledger sums PAYMENTS and the book sums CONTRACTED rent, so the two differ
  // only by genuine schedule drift — rent recorded against a lease whose
  // annual_rent disagrees with it. On the clone that is AED 20,000 across two
  // leases that carry a 10,000 rent row against annual_rent = 0. A scope
  // regression moves this by millions, which is what the bound is here to catch.
  const drift = income - book;
  console.log(`drift ledger − book: ${drift}`);
  expect(Math.abs(drift), 'ledger must track the contracted book within schedule drift')
    .toBeLessThan(book * 0.05);

  // Excluded rows stay LISTED — the page is a ledger — and out of the total.
  const excluded = rent.filter(r => !counts(r));
  console.log('excluded rent rows:', excluded.map(r => `${r.contractRef} ${r.amount} ${r.excludedReason}`).join(' · '));
  for (const r of excluded) expect(['cancelled', 'bounce-replaced', 'bounced-owed']).toContain(r.excludedReason);

  // ── STATUS ───────────────────────────────────────────────────────────────
  // Cancelled and bounced money never sits inside a subtotal, whether or not the
  // bounce was made good. `paymentBasisSplit` keeps an UNCOVERED bounce in (it is
  // still a supply, so Fee & VAT and Payment Grouping must count it) — this page
  // takes it back out, which is the only reason it can tie to Cash Management.
  for (const r of rows.filter(counts)) {
    expect(['cancelled', 'bounced'], `${r.contractRef} ${r.amount} must not count`).not.toContain(r.status);
  }
});

test('Rental Income equals Cash Management, to the dirham', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, RP);

  const rows: Row[] = await (await page.request.get('/api/contracts/payments')).json();
  const cm = await (await page.request.get('/api/reports/rent-receivable')).json();

  // Cash Management's cleared + pending IS this page's Rental Income. The gap
  // used to be one cheque: CID-167 / CHQ-000007, AED 14,500, returned 9 Jul 2026
  // and never replaced — reported there beside the total, counted here inside it.
  console.log(`payments ${rows.filter(r => r.paymentType === 'rental_income' && counts(r)).reduce((s, r) => s + r.amount, 0)}`
    + `  ·  cash management ${cm.totals.totalFils / 100}  ·  bounced still owed ${cm.totals.bouncedOwedFils / 100}`);
  expect(rentTotal(rows), 'Rental Income must equal Cash Management cleared + pending')
    .toBe(cm.totals.totalFils / 100);
});

test('the year filter buckets a payment by the period it falls due', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, RP);
  const rows: Row[] = await (await page.request.get('/api/contracts/payments')).json();

  // What each year is worth on the DUE-DATE basis — what the page must now show.
  const dueYear = (r: Row) => (r.transactionDate ? Number(r.transactionDate.slice(0, 4)) : null);
  const byYear = new Map<number, number>();
  for (const r of rows.filter(r => r.paymentType === 'rental_income' && counts(r))) {
    const y = dueYear(r);
    if (y != null) byYear.set(y, (byYear.get(y) ?? 0) + r.amount);
  }
  const all = rentTotal(rows);
  console.log('rent by due year:', [...byYear].sort().map(([y, v]) => `${y}=${v}`).join(' · '));

  // A year must be a genuine SLICE. Under the old lease-term rule every live lease
  // overlapped the current year, so the current year equalled the whole book.
  const thisYear = new Date().getFullYear();
  expect(byYear.get(thisYear) ?? 0, 'a single year must not equal the whole book').toBeLessThan(all);
  expect([...byYear.values()].reduce((s, v) => s + v, 0), 'the years must partition the book').toBe(all);

  await page.goto('/rental-provider/dashboard/payments');
  const card = page.locator('button', { has: page.getByText('Rental Income', { exact: true }) }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });

  const fmt = (v: number) => new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED',
    minimumFractionDigits: Math.round(v) !== v ? 2 : 0,
    maximumFractionDigits: Math.round(v) !== v ? 2 : 0,
  }).format(v);

  const picker = page.getByLabel('Filter payments by year');
  for (const [y, expected] of [...byYear].sort((a, b) => a[0] - b[0])) {
    await picker.selectOption(String(y));
    await expect(card, `${y} must show only the rent due in ${y}`).toContainText(fmt(expected), { timeout: 15_000 });
    console.log(`${y} → ${fmt(expected)}`);
  }
  await picker.selectOption('all');
  await expect(card).toContainText(fmt(all));
});
