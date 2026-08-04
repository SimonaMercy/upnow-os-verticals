/**
 * Propose renewal on lease 26 (unit BLOCK-A, Avenue Accommodation — a
 * leasing_type='sub' property whose unit carries "Sub-lease charge (20%)" +
 * "5% VAT on sub-lease"). The lease itself was imported with four bare
 * "Rent cheque (scanned)" rental_income rows and NO 'other' charge rows, so
 * before this change the renewal had nothing to carry and the sub-lease lines
 * never reached the Planned schedule.
 *
 * Shoots the Additional charges block and the Planned schedule, and prints
 * every row of both so the amounts can be checked against the new net rent.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/50e59027-2325-4f51-bde0-924bdb4365b4/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('the unit sub-lease charge reaches the renewal planned schedule', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // The API first — the unit's configured charges must be on the payload.
  const detail = await page.request.get('/api/contracts/26');
  expect(detail.ok()).toBeTruthy();
  const body = await detail.json() as {
    annualRent: number;
    unit: { number: string; additionalPayments?: { label: string; amount: number; vat?: number }[] };
    payments: { paymentType: string; description: string }[];
  };
  console.log('UNIT           :', body.unit.number);
  console.log('ANNUAL RENT    :', body.annualRent);
  console.log('UNIT CHARGES   :', JSON.stringify(body.unit.additionalPayments ?? []));
  console.log('LEASE "other"  :', body.payments.filter(p => p.paymentType === 'other').length, 'row(s)');

  await page.goto('/rental-provider/dashboard/operations/26');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: /Propose renewal/i }).first().click();
  await page.waitForTimeout(1500);

  const modal = page.locator('.modal.xl');
  await expect(modal).toBeVisible();

  // Every "Additional charges" row: description + amount + due date.
  const charges = await modal.evaluate((m) => {
    const heading = Array.from(m.querySelectorAll('p')).find(p => /Additional charges/i.test(p.textContent ?? ''));
    const rows: string[][] = [];
    let n = heading?.parentElement?.nextElementSibling ?? null;
    while (n) {
      const inputs = Array.from(n.querySelectorAll('input')) as HTMLInputElement[];
      if (inputs.length >= 3) rows.push(inputs.map(i => i.value));
      else if (rows.length) break;
      n = n.nextElementSibling;
    }
    return rows;
  });
  console.log('\n=== Additional charges · Third Party ===');
  charges.forEach(r => console.log('  ', r.join('  |  ')));

  // Every Planned schedule line, as rendered by SegregatedPlanView.
  await modal.getByText('Planned schedule').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const plan = await modal.evaluate((m) => {
    const h = Array.from(m.querySelectorAll('p')).find(p => (p.textContent ?? '').trim() === 'Planned schedule');
    const out: string[] = [];
    let n = h?.nextElementSibling ?? null;
    while (n) {
      const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      n = n.nextElementSibling;
    }
    return out;
  });
  console.log('\n=== Planned schedule ===');
  plan.forEach(l => console.log('  ', l));

  await modal.screenshot({ path: `${SHOTS}/renewal-modal.png` });
  await modal.locator('.mb').evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(600);
  await modal.screenshot({ path: `${SHOTS}/renewal-schedule.png` });

  // The sub-lease pass-through must be offered, at 20% of the NEW net rent.
  expect(charges.some(r => /sub[-\s]?lease/i.test(r[0]))).toBeTruthy();
});

/**
 * The other side of the same seed: lease 155 (unit 85, Shed-2) ALREADY bills
 * "Sub-lease charge (20%)" 28,000 + "5% VAT on sub-lease" 1,400 as its own
 * 'other' rows, and the unit configures the same two at 29,000 / 1,450. The
 * unit copy must be suppressed — the lease's rows win — so the renewal offers
 * exactly two sub-lease lines, not four.
 */
test('a lease already billing sub-lease is not offered the unit copy as well', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  await page.goto('/rental-provider/dashboard/operations/155');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /Propose renewal/i }).first().click();
  await page.waitForTimeout(1500);

  const modal = page.locator('.modal.xl');
  await expect(modal).toBeVisible();
  const charges = await modal.evaluate((m) => {
    const heading = Array.from(m.querySelectorAll('p')).find(p => /Additional charges/i.test(p.textContent ?? ''));
    const rows: string[][] = [];
    let n = heading?.parentElement?.nextElementSibling ?? null;
    while (n) {
      const inputs = Array.from(n.querySelectorAll('input')) as HTMLInputElement[];
      if (inputs.length >= 3) rows.push(inputs.map(i => i.value));
      else if (rows.length) break;
      n = n.nextElementSibling;
    }
    return rows;
  });
  console.log('\n=== lease 155 · Additional charges ===');
  charges.forEach(r => console.log('  ', r.join('  |  ')));

  expect(charges.filter(r => /sub[-\s]?leas/i.test(r[0])).length).toBe(2);
});
