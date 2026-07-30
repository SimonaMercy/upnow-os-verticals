/**
 * Screenshots the admin customer + manager detail pages after pulling across the
 * information the RP side already held. Picks the richest real records so the
 * new sections aren't empty.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';

const BACKEND = 'http://localhost:3001/api';
const ADMIN_EMAIL = 'admin@upnow.ae';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/20d9ec8f-112a-4640-ba6c-61ebb6947275/scratchpad/shots2';

async function otpLogin(request: APIRequestContext, email: string): Promise<string> {
  const req = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const { devOtp } = (await req.json()) as { devOtp?: string };
  const verify = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: devOtp },
  });
  return ((await verify.json()) as { access_token: string }).access_token;
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: email, code: devOtp },
  });
  expect(verify.ok(), 'signed in').toBeTruthy();
}

test('admin customer + manager parity screenshots', async ({ page, request }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1400 });

  const token = await otpLogin(request, ADMIN_EMAIL);
  const hdrs = { Authorization: `Bearer ${token}` };
  await signIn(page, ADMIN_EMAIL);

  // Customer 298 — 4 tenancies and 13 journal notes, the richest in this DB, so
  // the financial summary and notes journal render with real content.
  const custId = 298;
  const bestC = 'pinned';

  // Richest manager: most landlords + permissions.
  const mgrList = await (await request.get(`${BACKEND}/admin/users?role=manager&limit=40`, { headers: hdrs })).json();
  let mgrId = mgrList.data?.[0]?.id, bestM = -1;
  for (const u of (mgrList.data ?? []).slice(0, 25)) {
    const d = await (await request.get(`${BACKEND}/admin/users/${u.id}`, { headers: hdrs })).json();
    const m = d.manager;
    if (!m) continue;
    const granted = Object.values(m.allPermissions ?? {}).filter(Boolean).length;
    const score = (m.landlords?.length ?? 0) * 5 + granted;
    if (score > bestM) { bestM = score; mgrId = u.id; }
  }
  console.log(`Customer #${custId} (score ${bestC}) · Manager #${mgrId} (score ${bestM})`);

  // ── Customer ──
  await page.goto(`/dashboard/admin/users/${custId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/01-customer-top.png` });
  const finPanel = page.getByText('Financial summary', { exact: true }).first();
  if (await finPanel.count()) { await finPanel.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${SHOTS}/02-customer-financials-notes.png` });
  const occ = page.getByText('Additional occupants', { exact: true }).first();
  if (await occ.count()) { await occ.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${SHOTS}/03-customer-docs-occupants.png` });

  // ── Manager ──
  await page.goto(`/dashboard/admin/users/${mgrId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const authPanel = page.getByText('Authority footprint', { exact: true }).first();
  if (await authPanel.count()) { await authPanel.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${SHOTS}/04-manager-permissions.png` });
  const lords = page.getByText('Landlords worked for', { exact: true }).first();
  if (await lords.count()) { await lords.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${SHOTS}/05-manager-per-landlord.png` });

  console.log(`Screenshots written to ${SHOTS}`);
});
