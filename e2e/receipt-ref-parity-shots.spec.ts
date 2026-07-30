/**
 * Receipt reference parity — RP / manager / customer must print the SAME issued
 * numbers (PP-<rp>-<year>-<nnnnn> plan, RCP-<rp>-<year>-<nnnnn> receipts), and the
 * security deposit must show its REAL number instead of the year-less
 * RCP-CID-<id>-DEP fallback.
 *
 * Contract 214 is the fixture: plan PP-2-2026-00013, five payment receipts, and a
 * register-booked deposit (security_deposits.id 31 → RCP-2-2025-00024) — the case
 * that used to be dropped entirely by the frontend refs shaper.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page, Browser } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/7697c093-c986-4a44-bce4-ef68a95dd4b5/scratchpad/receipt-shots';

const RP_EMAIL = 'kbaalfalasi@gmail.com';
const MGR_EMAIL = 'sheco1300@yahoo.com';
const CUST_EMAIL = 'mitulgarala@gmail.com';
const CID = 214;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: email, code: devOtp },
  });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

/** The viewer's title bar carries the number the PDF header prints. */
async function shot(page: Page, url: string, name: string): Promise<string> {
  await page.goto(url);
  // Wait for the rasterised PDF page, not just the shell.
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  // The viewer's title bar, not the surrounding dashboard chrome (the RP/manager
  // routes render a sidebar whose own <p> elements come first in the DOM).
  const title = (await page.getByText(/RECEIPT — /).first().textContent()) ?? '';
  return title.trim();
}

test('receipt reference parity across RP, manager and customer', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(420_000);
  fs.mkdirSync(SHOTS, { recursive: true });

  const titles: Record<string, string> = {};
  const open = async (email: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1150 } });
    const page = await ctx.newPage();
    await signIn(page, email);
    return { ctx, page };
  };

  // ── RP ───────────────────────────────────────────────────────────────────────
  const rp = await open(RP_EMAIL);
  titles['rp-deposit'] = await shot(rp.page, `/rental-provider/dashboard/contracts/${CID}/print/receipt?kind=deposit`, 'rp-deposit');
  titles['rp-rental'] = await shot(rp.page, `/rental-provider/dashboard/contracts/${CID}/print/receipt?kind=rental`, 'rp-rental');
  await rp.ctx.close();

  // ── Manager (re-exports the RP route) ────────────────────────────────────────
  const mgr = await open(MGR_EMAIL);
  titles['mgr-deposit'] = await shot(mgr.page, `/dashboard/manager/contracts/${CID}/print/receipt?rp=2&kind=deposit`, 'mgr-deposit');
  titles['mgr-rental'] = await shot(mgr.page, `/dashboard/manager/contracts/${CID}/print/receipt?rp=2&kind=rental`, 'mgr-rental');
  await mgr.ctx.close();

  // ── Customer ─────────────────────────────────────────────────────────────────
  const cust = await open(CUST_EMAIL);
  titles['cust-deposit'] = await shot(cust.page, `/dashboard/customer/contracts/${CID}/print/receipt?kind=deposit`, 'cust-deposit');
  titles['cust-rental'] = await shot(cust.page, `/dashboard/customer/contracts/${CID}/print/receipt?kind=rental`, 'cust-rental');
  await cust.ctx.close();

  console.log('\n─── receipt header numbers ───');
  for (const [k, v] of Object.entries(titles)) console.log(`${k.padEnd(14)} ${v}`);

  // The deposit's real, year-wise number — on every side, never the derived label.
  for (const k of ['rp-deposit', 'mgr-deposit', 'cust-deposit']) {
    expect(titles[k], `${k} prints the issued deposit receipt number`).toContain('RCP-2-2025-00024');
    expect(titles[k], `${k} has no derived label`).not.toContain('CID-');
  }
  // Rental income is an aggregate statement → the plan number, identically.
  for (const k of ['rp-rental', 'mgr-rental', 'cust-rental']) {
    expect(titles[k], `${k} prints the issued plan number`).toContain('PP-2-2026-00013');
  }
});
