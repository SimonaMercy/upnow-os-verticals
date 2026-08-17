// SP-103 · seed a demo roster on the local clone and screenshot the two surfaces.
// Standalone (not the Playwright test runner) so it can target a worktree FE on another port.
//   FE=http://localhost:3010 node e2e/sp103-shifts-shot.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const FE = process.env.FE ?? 'http://localhost:3010';
const BE = process.env.BE ?? 'http://localhost:3001/api';
const SP_EMAIL = process.env.SP103_SP ?? 'e2e-sp-20260816092822@sptest.local';
const SHOTS = process.env.SHOTS ?? '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/ea65b4aa-b24d-49c6-8115-569d36e6694f/scratchpad/shots';
fs.mkdirSync(SHOTS, { recursive: true });

async function api(method, path, body, token) {
  const res = await fetch(BE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function token(email) {
  const s = await api('POST', '/auth/login', { email });
  const v = await api('POST', '/auth/login/verify-otp', { identifier: email, code: s.body.devOtp });
  if (!v.body?.access_token) throw new Error(`login failed ${email}: ${JSON.stringify(v.body)}`);
  return v.body.access_token;
}
const at = (offsetDays, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(h, m, 0, 0); return d.toISOString(); };
const monday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); const dow = (d.getDay() + 6) % 7; return -dow; };

const SP = await token(SP_EMAIL);
const roster = (await api('GET', '/service-provider/shifts', undefined, SP)).body;
const tech = roster.technicians[0];
const techEmail = process.env.SP103_TECH;
const mon = monday();

// Seed only if this week is empty for the technician (idempotent-ish demo)
const thisWeek = roster.shifts.filter((s) => s.technicianId === tech.id);
if (!thisWeek.length) {
  const mk = (d, h1, h2, extra = {}) => api('POST', '/service-provider/shifts', { technicianId: tech.id, shiftStartAt: at(mon + d, h1), shiftEndAt: at(mon + d, h2), ...extra }, SP);
  const r0 = await mk(0, 9, 18, { zones: ['Dubai'], breakStartAt: at(mon, 13), breakEndAt: at(mon, 13, 30) });
  await mk(1, 9, 18, { zones: ['Dubai', 'Sharjah'] });
  await mk(2, 8, 16, { zones: ['Abu Dhabi'], notes: 'Client site in Khalifa City — bring ladder' });
  await mk(2, 14, 20, { zones: ['Dubai'] }); // → conflict on Wed
  await mk(3, 9, 18, { zones: ['Ajman', 'Umm Al Quwain'] });
  await mk(4, 9, 15, { zones: ['Dubai'], isEmergencyRoster: true });
  await mk(5, 18, 23, { isEmergencyRoster: true, zones: ['Dubai'] });
  // Confirm Mon + Tue on the technician's behalf
  if (r0.body?.id) await api('POST', `/service-provider/shifts/${r0.body.id}/confirm`, {}, SP);
  console.log('seeded demo roster for', tech.name);
} else {
  console.log(`week already has ${thisWeek.length} shifts for ${tech.name}; not seeding`);
}

const browser = await chromium.launch();
async function signIn(page, email) {
  await page.goto(`${FE}/login`);
  const s = await page.request.post(`${FE}/api/auth/login`, { data: { email } });
  const { devOtp } = await s.json();
  const v = await page.request.post(`${FE}/api/auth/login/verify-otp`, { data: { identifier: email, code: devOtp } });
  if (!v.ok()) throw new Error(`signIn ${email} ${v.status()}`);
}

// 1 · Provider roster page
const sp = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
await signIn(sp, SP_EMAIL);
await sp.goto(`${FE}/dashboard/service-provider/schedule`, { waitUntil: 'networkidle', timeout: 180_000 });
await sp.waitForSelector('text=Rostered hours', { timeout: 60_000 });
await sp.waitForTimeout(800);
await sp.screenshot({ path: `${SHOTS}/sp103-roster.png`, fullPage: true });
// open the conflicted shift
const conflictChip = sp.locator('button[title^="Overlaps"]').first();
if (await conflictChip.count()) {
  await conflictChip.click();
  await sp.waitForSelector('text=Overlaps another shift', { timeout: 15_000 });
  await sp.waitForTimeout(400);
  await sp.screenshot({ path: `${SHOTS}/sp103-roster-conflict-drawer.png`, fullPage: false });
  await sp.keyboard.press('Escape').catch(() => {});
  await sp.locator('button[aria-label="Close"]').first().click().catch(() => {});
}
// add-shift drawer
await sp.locator('text=Add shift').first().click();
await sp.waitForSelector('text=Repeat weekly', { timeout: 15_000 });
await sp.waitForTimeout(300);
await sp.screenshot({ path: `${SHOTS}/sp103-roster-add-drawer.png`, fullPage: false });
// Settings → Team link
await sp.goto(`${FE}/dashboard/service-provider/settings?tab=team`, { waitUntil: 'networkidle', timeout: 120_000 });
await sp.waitForTimeout(800);
await sp.screenshot({ path: `${SHOTS}/sp103-team-link.png`, fullPage: false });

// 2 · Technician "My shifts" + home tile
if (techEmail) {
  const tp = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  await signIn(tp, techEmail);
  await tp.goto(`${FE}/dashboard/technician/schedule`, { waitUntil: 'networkidle', timeout: 180_000 });
  await tp.waitForSelector('text=Hours ahead', { timeout: 60_000 });
  await tp.waitForTimeout(600);
  await tp.screenshot({ path: `${SHOTS}/sp103-tech-shifts.png`, fullPage: true });
  await tp.goto(`${FE}/dashboard/technician`, { waitUntil: 'networkidle', timeout: 120_000 });
  await tp.waitForSelector('text=Next shift', { timeout: 60_000 });
  await tp.waitForTimeout(600);
  await tp.screenshot({ path: `${SHOTS}/sp103-tech-home.png`, fullPage: false });
}
await browser.close();
console.log('shots in', SHOTS);
