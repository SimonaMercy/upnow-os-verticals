import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// SP-86 — visual check of the three live-tracking surfaces on the local clone:
// technician presence bar + heartbeat, customer tracker map, provider live map.
// Requires: BE :3001 (EXPOSE_DEV_OTP), FE :3000, and env SP86_BOOKING / SP86_TECH / SP86_CUST / SP86_SP
// pointing at a booking currently en_route (the runner's BK, flipped back for the shot).
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/62147de8-91c0-4f72-a319-938e5dee1b2b/scratchpad/shots';
const BK = process.env.SP86_BOOKING!;
const TECH = process.env.SP86_TECH!;
const CUST = process.env.SP86_CUST!;
const SP = process.env.SP86_SP!;
// Naif, Dubai (the runner books at 25.2740, 55.3080) — start ~1.5 km away.
const START = { latitude: 25.2860, longitude: 55.3140 };

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('SP-86 surfaces', async ({ browser }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });

  // 1 · Technician: presence bar, go available, open the live job (heartbeat with a fix)
  const techCtx = await browser.newContext({ geolocation: START, permissions: ['geolocation'], viewport: { width: 420, height: 900 } });
  const tech = await techCtx.newPage();
  await signIn(tech, TECH);
  await tech.goto('/dashboard/technician/jobs', { waitUntil: 'networkidle' });
  await tech.waitForTimeout(1500);
  await tech.screenshot({ path: `${SHOTS}/01-tech-offline.png` });
  const goAvail = tech.getByRole('button', { name: /Go available/ });
  if (await goAvail.count()) { await goAvail.click(); await tech.waitForTimeout(2500); }
  await tech.screenshot({ path: `${SHOTS}/02-tech-on-job.png` });
  await tech.getByRole('button').filter({ hasText: new RegExp(`BK-${BK}`) }).first().click();
  await tech.waitForTimeout(2000);
  // If the job is still Assigned, set off (en_route) — that is what triggers the planned route (SP-86b)
  const onMyWay = tech.getByRole('button', { name: /On my way/ });
  if (await onMyWay.count()) { await onMyWay.click(); await tech.waitForTimeout(3000); }
  await tech.screenshot({ path: `${SHOTS}/03-tech-job-detail.png`, fullPage: true });
  // move along the road: SP86_LADDER="lat,lng;lat,lng;…" (points ON the planned route), one per heartbeat (30 s)
  const ladder = (process.env.SP86_LADDER ?? '25.2790,55.3100').split(';').map((s) => s.split(',').map(Number));
  for (const [latitude, longitude] of ladder) { await techCtx.setGeolocation({ latitude, longitude }); await tech.waitForTimeout(31_000); }

  // 2 · Customer: tracker in My Services
  const custCtx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const cust = await custCtx.newPage();
  await signIn(cust, CUST);
  await cust.goto('/dashboard/customer/services', { waitUntil: 'networkidle' });
  await cust.waitForTimeout(1500);
  await cust.getByText(`BK-${BK}`).first().click();
  await cust.waitForTimeout(6000);
  await cust.getByText(/is on the way|has arrived|arriving now|Live tracking starts/).first().scrollIntoViewIfNeeded();
  await cust.mouse.wheel(0, 140);
  await cust.waitForTimeout(1500);
  await cust.screenshot({ path: `${SHOTS}/04-customer-tracker.png`, fullPage: false });

  // 3 · Provider: live map
  const spCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const sp = await spCtx.newPage();
  await signIn(sp, SP);
  await sp.goto('/dashboard/service-provider/live', { waitUntil: 'networkidle' });
  await sp.waitForTimeout(6000);
  await sp.screenshot({ path: `${SHOTS}/05-sp-live-map.png`, fullPage: false });
  const force = sp.getByRole('button', { name: /Force offline/ }).first();
  if (await force.count()) { await force.click(); await sp.waitForTimeout(2500); }
  await sp.screenshot({ path: `${SHOTS}/06-sp-live-map-forced-offline.png`, fullPage: false });

  // Technician side reflects the override on its next tick
  await tech.waitForTimeout(32_000);
  await tech.screenshot({ path: `${SHOTS}/07-tech-forced-offline.png` });
  await techCtx.close(); await custCtx.close(); await spCtx.close();
});
