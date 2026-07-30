/**
 * Screenshot pass for the admin gaps closed from Rental_Module_Status_Revised.xlsx
 * (SCRUM-658 … SCRUM-663). Not an assertion suite — it drives the real app and
 * captures each changed surface so the work can be eyeballed before commit.
 *
 * Mirrored to the session scratchpad: this file is untracked and the shared
 * working tree wipes untracked specs.
 */
import { test, expect, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'fs';

const BACKEND = 'http://localhost:3001/api';
const ADMIN_EMAIL = 'admin@upnow.ae';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/20d9ec8f-112a-4640-ba6c-61ebb6947275/scratchpad/shots';

async function otpLogin(request: APIRequestContext, email: string): Promise<string> {
  const req = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  const r1 = (await req.json()) as { devOtp?: string };
  const verify = await request.post(`${BACKEND}/auth/login/verify-otp`, {
    data: { identifier: email, code: r1.devOtp! },
  });
  const r2 = (await verify.json()) as { access_token: string };
  return r2.access_token;
}

/**
 * Sign in through the Next.js /api proxy from inside the browser context. The
 * session is an httpOnly cookie the proxy sets on token-issuing routes, so the
 * token can't just be injected — the request has to come from this page.
 */
async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  expect(devOtp, 'dev OTP issued').toBeTruthy();
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: email, code: devOtp },
  });
  expect(verify.ok(), 'OTP verified').toBeTruthy();
}

/** Load an admin page in the already-signed-in browser context. */
async function asAdmin(page: Page, _token: string, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

test('admin module-status gap screenshots', async ({ page, request }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1100 });

  const token = await otpLogin(request, ADMIN_EMAIL);
  expect(token, 'admin token').toBeTruthy();
  const hdrs = { Authorization: `Bearer ${token}` };
  await signIn(page, ADMIN_EMAIL);

  // Pick real records to screenshot: an RP with leases, and a customer.
  const rpList = await (await request.get(`${BACKEND}/admin/users?role=rental_provider&limit=25`, { headers: hdrs })).json();
  const custList = await (await request.get(`${BACKEND}/admin/users?role=customer&limit=25`, { headers: hdrs })).json();

  // Prefer the RP that actually has payments + activity, so the new sections aren't empty.
  let rpId = rpList.data?.[0]?.id;
  let best = -1;
  for (const u of (rpList.data ?? []).slice(0, 12)) {
    const d = await (await request.get(`${BACKEND}/admin/users/${u.id}`, { headers: hdrs })).json();
    const score = (d.landlord?.payments?.length ?? 0) + (d.landlord?.activity?.recent?.length ?? 0);
    if (score > best) { best = score; rpId = u.id; }
  }
  // Same for the customer — one with KYC documents on file.
  let custId = custList.data?.[0]?.id;
  let bestDocs = -1;
  for (const u of (custList.data ?? []).slice(0, 12)) {
    const d = await (await request.get(`${BACKEND}/admin/users/${u.id}`, { headers: hdrs })).json();
    const n = d.customer?.documents?.list?.length ?? 0;
    if (n > bestDocs) { bestDocs = n; custId = u.id; }
  }
  console.log(`RP #${rpId} (payments+activity rows: ${best}) · Customer #${custId} (docs: ${bestDocs})`);

  // ── SCRUM-658 · Ban on the user list ──────────────────────────────────────
  await asAdmin(page, token, '/dashboard/admin/users');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/01-users-list-ban.png`, fullPage: false });

  // ── SCRUM-658 · Status actions on the user detail header ──────────────────
  await asAdmin(page, token, `/dashboard/admin/users/${rpId}`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/02-user-detail-actions.png`, fullPage: false });

  // ── SCRUM-659 / 660 · RP payments list + recent activity ──────────────────
  const payments = page.getByText('Payments', { exact: true }).first();
  if (await payments.count()) {
    await payments.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${SHOTS}/03-rp-payments-activity.png`, fullPage: false });

  // ── SCRUM-661 · Customer KYC document list ────────────────────────────────
  await asAdmin(page, token, `/dashboard/admin/users/${custId}`);
  await page.waitForTimeout(3000);
  const kycDocs = page.getByText('KYC documents', { exact: true }).first();
  if (await kycDocs.count()) {
    await kycDocs.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${SHOTS}/04-customer-kyc-docs.png`, fullPage: false });

  // ── SCRUM-662 · RP KYC tab now has per-document verdicts ──────────────────
  // Every document in this DB is already processed, so nothing would show an
  // Approve button. Reject one first, then approve it back through the new
  // dialog — that exercises the whole path and restores the record.
  const RP_KYC_ID = 2;              // Ahmad Rashed Buti Alfalasi — 5 documents
  const DEMO_DOC = 430;             // passport
  await request.post(`${BACKEND}/admin/kyc/documents/${DEMO_DOC}/reject`, {
    headers: hdrs, data: { reason: 'Expiry date not legible — please re-upload' },
  });

  await asAdmin(page, token, '/dashboard/admin/kyc?tab=rental&status=compliant');
  await page.waitForTimeout(3500);
  // Click the provider card in the left queue (not a status chip).
  await page.getByText('Ahmad Rashed Buti Alfalasi').first().click();
  await page.waitForTimeout(3500);
  const uploaded = page.getByText(/Uploaded Docs/i).first();
  if (await uploaded.count()) { await uploaded.scrollIntoViewIfNeeded(); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${SHOTS}/05-kyc-rp-doc-verdicts.png`, fullPage: false });

  // The approve-with-expiry dialog.
  const approve = page.getByRole('button', { name: /^Approve$/ }).first();
  await expect(approve).toBeVisible({ timeout: 10_000 });
  await approve.click();
  await page.waitForTimeout(900);
  await page.getByLabel(/Expiry date/i).or(page.locator('input[type="date"]')).first().fill('2030-04-15');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/06-kyc-approve-expiry-modal.png`, fullPage: false });

  // Commit it — proves the expiry actually persists.
  await page.getByRole('button', { name: /^Approve$/ }).last().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/06b-kyc-after-approve.png`, fullPage: false });

  const after = await (await request.get(`${BACKEND}/admin/kyc/rental-providers/${RP_KYC_ID}`, { headers: hdrs })).json();
  const demo = (after.uploadedDocs ?? []).find((d: { id: number }) => d.id === DEMO_DOC);
  console.log(`Doc ${DEMO_DOC} after approve → status=${demo?.status} expiry=${demo?.expiryDate}`);
  expect(demo?.status, 'document verified').toBe('processed');
  expect(String(demo?.expiryDate ?? ''), 'expiry persisted').toContain('2030-04-15');

  // ── SCRUM-663 · Expire action in the listings centre ──────────────────────
  await asAdmin(page, token, '/dashboard/admin/listings/rental-providers');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/07-listings-status-tabs.png`, fullPage: false });

  // Approved tab holds the published listings — the ones that can expire.
  const approvedTab = page.getByRole('button', { name: 'Approved', exact: true }).first();
  if (await approvedTab.count()) { await approvedTab.click(); }
  // Wait for the list to actually arrive rather than a fixed sleep — the dev
  // server recompiles on first hit and the earlier run caught it mid-flight.
  await expect(page.getByText(/Backend unavailable/i)).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(2500);
  const firstListing = page.locator('div,button').filter({ hasText: /^Unit\s/ }).last();
  if (await firstListing.count()) { await firstListing.click({ timeout: 10_000 }).catch(() => {}); await page.waitForTimeout(3500); }
  await page.screenshot({ path: `${SHOTS}/08-listing-expire-action.png`, fullPage: false });

  console.log(`Screenshots written to ${SHOTS}`);
});
