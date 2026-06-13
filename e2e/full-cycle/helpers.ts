import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/* ------------------------------------------------------------------ *
 *  Shared infrastructure for the full-cycle UI suite.
 *
 *  Every business flow is driven through the UI. The only non-UI
 *  escapes are:
 *    - devOtp read from the dev-mode API response / on-page box
 *      (substitute for receiving a real SMS/email)
 *    - psql reads of invite/portal tokens (substitute for clicking a
 *      link inside a real email — DISABLE_EMAIL=true in this stack)
 * ------------------------------------------------------------------ */

export const E2E_DB = process.env.E2E_DB ?? 'upnow_e2e';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@upnow.ae';
export const STATE_FILE = path.join(__dirname, '.state.json');

// ---------- cross-spec state -----------------------------------------------

export type State = Record<string, any>;

export function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(patch: State): State {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/** Stable per-cycle id — created on first use, persisted in .state.json. */
export function runId(): string {
  const s = readState();
  if (s.runId) return s.runId;
  const id = Date.now().toString(36);
  writeState({ runId: id });
  return id;
}

export const uniqEmail = (tag: string) => `${tag}.${runId()}@e2e.upnow.test`;

/** Unique UAE mobile in local digits (5xxxxxxxx) — forms default to +971. */
export function uniqPhone(): string {
  const s = readState();
  const n = (s.phoneSeq ?? 0) + 1;
  writeState({ phoneSeq: n });
  // 50 + 7 digits derived from runId time + sequence — unique per cycle
  const base = (parseInt(runId(), 36) % 9_000_000) + 1_000_000 + n * 17;
  return `50${String(base).slice(0, 7)}`;
}

// ---------- DB glue (email-link substitutes + assertions) ------------------

/** Single-value psql query against the e2e database. */
export function q(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return execSync(`psql -h localhost -p 5432 -d ${E2E_DB} -tA -c ${JSON.stringify(oneLine)}`, {
    encoding: 'utf8',
  }).trim();
}

export function inviteTokenFor(email: string): string {
  const token = q(
    `SELECT token FROM invitations WHERE email='${email}' AND status='pending' ORDER BY id DESC LIMIT 1`,
  );
  expect(token, `pending invitation for ${email}`).toBeTruthy();
  return token;
}

// ---------- OTP mechanics ---------------------------------------------------

/** Fill the 6 single-digit OTP boxes used on /login, /verify, /verify-email. */
export async function fillOtp(page: Page, code: string) {
  const boxes = page.locator('input[inputmode="numeric"]:visible');
  await boxes.first().waitFor({ state: 'visible' });
  const n = await boxes.count();
  if (n >= 6) {
    // focus each box explicitly and type its single digit — the screens'
    // auto-advance/redistribution onChange logic races with bulk typing
    for (let i = 0; i < 6; i++) {
      const box = boxes.nth(i);
      await box.fill('');
      await box.click();
      await page.keyboard.type(code[i]);
    }
  } else {
    await boxes.first().fill(code);
  }
}

/**
 * Run `trigger` and capture `devOtp` from the matching API response.
 * Falls back to the on-page amber "Your OTP" box if the response had none.
 */
export async function captureDevOtp(
  page: Page,
  urlPart: string,
  trigger: () => Promise<unknown>,
): Promise<string> {
  const respPromise = page
    .waitForResponse(
      (r) => r.url().includes(urlPart) && r.request().method() === 'POST',
      { timeout: 20_000 },
    )
    .catch(() => null);
  await trigger();
  const resp = await respPromise;
  if (resp) {
    const body = await resp.json().catch(() => ({} as any));
    if (body?.devOtp) return String(body.devOtp);
  }
  // fallback: dev box on the page (verify pages use a font-mono <p>, login uses [class*=devOtp] b)
  const box = page.locator('p.font-mono, [class*="devOtp"] b').first();
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  const text = (await box.innerText()).replace(/\D/g, '');
  expect(text, 'dev OTP visible on page').toMatch(/^\d{6}$/);
  return text;
}

/** Read the dev OTP that is already rendered on the current page. */
export async function readDevOtpFromPage(page: Page): Promise<string> {
  const url = new URL(page.url());
  const fromQuery = url.searchParams.get('devOtp');
  if (fromQuery && /^\d{6}$/.test(fromQuery)) return fromQuery;
  const box = page.locator('p.font-mono, [class*="devOtp"] b').first();
  await box.waitFor({ state: 'visible', timeout: 10_000 });
  const text = (await box.innerText()).replace(/\D/g, '');
  expect(text, 'dev OTP visible on page').toMatch(/^\d{6}$/);
  return text;
}

// ---------- auth flows (all through the UI) ---------------------------------

/**
 * OTP login through /login. Returns once the URL leaves /login.
 * `identifier` may be an email or a local phone (5xxxxxxxx).
 */
export async function loginViaUi(page: Page, identifier: string, expectUrl?: RegExp) {
  await page.goto('/login');
  const id = page.getByPlaceholder(/you@example\.com/i).first();
  await id.waitFor({ state: 'visible' });
  await id.fill(identifier);
  const otp = await captureDevOtp(page, '/auth/login', () =>
    page.locator('button[type="submit"]:visible').first().click(),
  );
  await fillOtp(page, otp);
  const verifyBtn = page.locator('button[type="submit"]:visible').first();
  if (await verifyBtn.isEnabled().catch(() => false)) await verifyBtn.click();
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 });
  if (expectUrl) await page.waitForURL(expectUrl, { timeout: 30_000 });
}

export async function adminLogin(page: Page) {
  await loginViaUi(page, ADMIN_EMAIL, /\/dashboard\/admin/);
}

/**
 * loginViaUi, but tolerant of the OTP auto-submit race (added by spec 05;
 * additive — loginViaUi itself is unchanged): the login form auto-verifies
 * once the 6th OTP digit lands, so the explicit Verify click inside
 * loginViaUi can hit a button that detaches mid-click. If that throws but
 * the navigation away from /login still happens, the login succeeded.
 */
export async function safeLoginViaUi(page: Page, identifier: string, expectUrl?: RegExp) {
  try {
    await loginViaUi(page, identifier, expectUrl);
  } catch {
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 });
    if (expectUrl) await page.waitForURL(expectUrl, { timeout: 30_000 });
  }
}

/** adminLogin with the same auto-submit race tolerance. */
export async function safeAdminLogin(page: Page) {
  await safeLoginViaUi(page, ADMIN_EMAIL, /\/dashboard\/admin/);
}

export async function logout(page: Page) {
  // clearing the httpOnly cookie via the proxy logout endpoint, then land on /login
  await page.request.post('/api/auth/logout').catch(() => {});
  await page.context().clearCookies();
  await page.goto('/login');
}

/**
 * Customer self-registration: /register/customer (phone only) → /verify OTP → /welcome.
 * Returns the local phone digits used.
 */
export async function registerCustomerViaUi(page: Page, phone = uniqPhone()): Promise<string> {
  await page.goto('/register/customer');
  await page.getByTestId('customer-register-phone').fill(phone);
  await captureDevOtp(page, '/auth/register/customer', () =>
    page.getByRole('button', { name: /create account/i }).click(),
  );
  await page.waitForURL(/\/verify/, { timeout: 30_000 });
  const otp = await readDevOtpFromPage(page);
  await fillOtp(page, otp);
  const submit = page.locator('button[type="submit"]:visible, button:has-text("Verify"):visible').first();
  if (await submit.isVisible().catch(() => false)) {
    if (await submit.isEnabled().catch(() => false)) await submit.click();
  }
  await page.waitForURL(/\/welcome|\/$/, { timeout: 30_000 });
  return phone;
}

/**
 * Provider self-registration (rental-provider | service-provider):
 * email form → /verify-email OTP → onboarding redirect.
 */
export async function registerProviderViaUi(
  page: Page,
  kind: 'rental-provider' | 'service-provider',
  email: string,
): Promise<void> {
  await page.goto(`/register/${kind}`);
  const emailInput = page.locator('input[type="email"]:visible').first();
  await emailInput.fill(email);
  await captureDevOtp(page, `/auth/register/${kind}`, () =>
    page.getByRole('button', { name: /create account/i }).click(),
  );
  await page.waitForURL(/\/verify-email/, { timeout: 30_000 });
  const otp = await readDevOtpFromPage(page);
  await fillOtp(page, otp);
  const verifyBtn = page.getByRole('button', { name: /verify/i }).first();
  if (await verifyBtn.isVisible().catch(() => false)) await verifyBtn.click();
  await page.waitForURL(/onboarding/, { timeout: 45_000 });
}

// ---------- file fixtures (in-memory, no disk needed) ------------------------

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function pngFile(name = 'photo.png') {
  return { name, mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64') };
}

const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj
4 0 obj<</Length 44>>stream
BT /F1 12 Tf 20 100 Td (UpNow E2E test) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
trailer<</Size 5/Root 1 0 R>>
startxref
0
%%EOF`;

export function pdfFile(name = 'document.pdf') {
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(MINIMAL_PDF) };
}

// ---------- misc -------------------------------------------------------------

/** Wait for a sonner toast containing `text` (success or error). */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/** Assert a /uploads/... URL actually serves bytes through the frontend proxy. */
export async function expectUploadServed(page: Page, uploadPath: string) {
  const res = await page.request.get(uploadPath);
  expect(res.status(), `GET ${uploadPath}`).toBe(200);
  const body = await res.body();
  expect(body.length).toBeGreaterThan(0);
}
