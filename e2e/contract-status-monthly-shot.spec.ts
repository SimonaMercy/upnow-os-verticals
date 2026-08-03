import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Contract Status - Monthly — the landlord's monthly contract-status sheet for a
// whole year. RP 2 (kbaalfalasi@gmail.com, user 286) has cycles in all 12 months of
// 2026, so the page exercises every status (renewed / for signature / pending /
// move-out) and the Contract Registration split.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/cd6e04d1-6f4a-40a3-a54d-163e90f6ff30/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('contract status by month renders every month with the division', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1700, height: 1400 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  // The payload first — totals and the August division get asserted below.
  const res = await page.request.get('/api/reports/contract-status?year=2026');
  expect(res.ok()).toBeTruthy();
  const data = await res.json();
  fs.writeFileSync(`${SHOTS}/contract-status-2026.json`, JSON.stringify(data, null, 2));
  const months = data.rows as Array<Record<string, number | string>>;
  console.log('TOTALS', JSON.stringify(data.totals));
  // Rent only counts where a cheque backs it; the rest is carried as unsecured.
  for (const m of data.rows as Array<{ items: { installments: number | null; annualRentFils: number | null }[]; annualRentFils: number; unsecuredRentFils: number }>) {
    const whole = m.items.reduce((s, i) => s + (i.annualRentFils ?? 0), 0);
    const unsecured = m.items.filter(i => i.installments === null).reduce((s, i) => s + (i.annualRentFils ?? 0), 0);
    expect(m.annualRentFils).toBe(whole);            // the total is the total
    expect(m.unsecuredRentFils).toBe(unsecured);     // and the exposure is a subset of it
    expect(m.unsecuredRentFils).toBeLessThanOrEqual(m.annualRentFils);
    const sum = (k: string) => m.items.reduce((s, i: Record<string, number | null>) => s + (Number(i[k]) || 0), 0);
    const mm = m as unknown as Record<string, number>;
    expect(mm.collectedFils).toBe(sum('collectedFils'));
    expect(mm.overdueFils).toBe(sum('overdueFils'));
    expect(mm.upcomingFils).toBe(sum('upcomingFils'));
  }
  const aug = data.rows.find((r: { month: string }) => r.month === '2026-08');
  console.log('AUG', JSON.stringify({ ...aug, items: undefined }));
  console.log('AUG-LINES', aug.items.map((i: Record<string, unknown>) =>
    [i.unitLabel, i.annualRentFils, i.collectedFils, i.overdueFils, i.upcomingFils].join('|')).join('\n'));
  expect(months).toHaveLength(12);
  const summed = months.reduce((s, m) => s + Number(m.contracts), 0);
  expect(summed).toBe(Number(data.totals.contracts));
  // Every line carries a status and (except move-outs) a registration state.
  for (const m of months) {
    for (const it of (m as unknown as { items: Record<string, unknown>[] }).items) {
      expect(['renewed', 'for_signature', 'pending', 'move_out']).toContain(it.status);
      if (it.status === 'move_out') {
        expect(it.ejari).toBeNull();
        expect(it.customerSigned).toBeNull();
        expect(it.signatures).toBeNull();
      } else {
        expect(['completed', 'pending', 'not_applicable']).toContain(it.ejari);
        expect(['signed', 'pending']).toContain(it.customerSigned);
        expect(['signed', 'pending']).toContain(it.landlordSigned);
        // Blank until the cycle has actually reached the signature step.
        if (['not_started', 'draft', 'notice_sent'].includes(String(it.stage))) expect(it.signatures).toBeNull();
        else expect(['signed', 'awaiting_customer', 'awaiting_landlord', 'awaiting_both']).toContain(it.signatures);
        expect(['new', 'renewal', 'amendment']).toContain(it.leaseType);
      }
      // A line only shows a cheque count when cheques are actually on file.
      if (it.installments !== null) expect(Number(it.installments)).toBeGreaterThan(0);
    }
  }

  await page.goto('/rental-provider/dashboard/reports/contract-status', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await expect(page.getByText('Contract Status - Monthly').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-contract-status-months.png`, fullPage: true });

  // August — the month the landlord's own sheet covers.
  const august = page.getByText('August 2026', { exact: true }).first();
  await august.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/02-contract-status-august.png` });

  // The state filters narrow the sheet AND the figures that describe it.
  const missing = await (await page.request.get('/api/reports/contract-status?year=2026&cheques=missing')).json();
  expect(missing.totals.installments).toBe(0);
  expect(missing.totals.contracts).toBe(data.totals.awaitingCheques);
  console.log('AWAITING-CHEQUES', missing.totals.contracts);
  const custOnly = await (await page.request.get('/api/reports/contract-status?year=2026&signature=customer_only')).json();
  console.log('CUSTOMER-ONLY', custOnly.totals.contracts, 'landlordSigned=', custOnly.totals.landlordSigned);
  expect(custOnly.totals.landlordSigned).toBe(0);
  const noticed = await (await page.request.get('/api/reports/contract-status?year=2026&stage=notice_sent')).json();
  console.log('NOTICE-SENT', noticed.totals.contracts);
  const stages = data.rows.flatMap((r: { items: { stage: string }[] }) => r.items)
    .reduce((a: Record<string, number>, i: { stage: string }) => ({ ...a, [i.stage]: (a[i.stage] ?? 0) + 1 }), {});
  console.log('STAGES', JSON.stringify(stages));
  await page.goto('/rental-provider/dashboard/reports/contract-status?cheques=missing', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/03-contract-status-filters.png` });

  // Single-month view — the whole report scoped to August.
  const augOnly = await (await page.request.get('/api/reports/contract-status?year=2026&month=8')).json();
  expect(augOnly.rows).toHaveLength(1);
  expect(augOnly.rows[0].month).toBe('2026-08');
  expect(augOnly.totals.contracts).toBe(aug.contracts);
  await page.goto('/rental-provider/dashboard/reports/contract-status?month=8', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/04-august-only.png`, fullPage: true });
});
