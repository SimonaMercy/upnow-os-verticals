/**
 * Maintenance routing (MAINTENANCE_ROUTING_SPEC_2026-08-30) — the Phase A loop:
 * link a provider + set a covered rule (API), raise a request as the customer,
 * then prove the UI: the card lands on Operations → Maintenance, the detail
 * page shows stage/coverage/timeline, the Settings → Maintenance tab renders,
 * and the customer's lease page tracks the request.
 *
 * Runs against the local stack (dev OTP login, worktree BE on :3031 via
 * PLAYWRIGHT_BASE_URL). Data assumption, per repo precedent: the customer
 * asrar@apienergy.me holds a live lease with RP kbaalfalasi@gmail.com.
 * Cleans up through the API (cancel / unlink / delete rules).
 */
import { test, expect, Page } from '@playwright/test';
import { execSync } from 'node:child_process';

/** The app's database on the local stack (the worktree backend's .env). */
const DB = process.env.PGDATABASE ?? 'upnow_prod_clone';
/** First line of psql's tuples-only output (-q drops the INSERT 0 1 command tag). */
const psql = (sql: string) =>
  execSync(`psql -d ${DB} -Atq -v ON_ERROR_STOP=1`, { input: sql, encoding: 'utf8' }).trim().split('\n')[0] ?? '';

/** Cancelled test requests would still LIST on the customer's and landlord's
 *  screens — remove them, and the jobs they routed, outright. Deleting a
 *  request SET NULLs bookings.maintenance_request_id, so the orphaned jobs are
 *  found by the tag in their service name. */
function wipeE2eRequests() {
  const jobs = `SELECT id FROM bookings WHERE source = 'rp_maintenance' AND service_name LIKE '%${TAG}%'`;
  psql(`DELETE FROM maintenance_requests WHERE issue_name LIKE '${TAG}%';
     DELETE FROM booking_assignment_media WHERE booking_id IN (${jobs});
     DELETE FROM escrow_transactions WHERE booking_escrow_id IN (SELECT id FROM booking_escrows WHERE booking_id IN (${jobs}));
     DELETE FROM booking_escrows WHERE booking_id IN (${jobs});
     DELETE FROM service_quote_items WHERE quote_id IN (SELECT id FROM service_quotes WHERE booking_id IN (${jobs}));
     DELETE FROM service_quotes WHERE booking_id IN (${jobs});
     DELETE FROM booking_assignments WHERE booking_id IN (${jobs});
     DELETE FROM booking_events WHERE booking_id IN (${jobs});
     DELETE FROM payment_intents WHERE booking_id IN (${jobs});
     DELETE FROM bookings WHERE id IN (${jobs});`);
}

const RP = 'kbaalfalasi@gmail.com';
const CUSTOMER = 'asrar@apienergy.me';
const TAG = '[E2E-MAINT]';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp',
    { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('a routed request crosses all three surfaces', async ({ browser, page }) => {
  test.setTimeout(300_000);
  await signIn(page, RP);

  // ── arrange (API): linked provider + covered rule, threshold 500 ──
  // A CONTRACTED vendor: the landlord's own team engages without a quote
  // (owner, 31 Aug), and these scenarios exercise the quote / pre-price paths.
  const vendors = (await (await page.request.get('/api/amc/vendors/all')).json()) as { id: number; name: string }[];
  expect(vendors.length).toBeGreaterThan(0);
  const spId = vendors[0].id;
  // DEFAULT, so routing picks this vendor over any link the landlord already
  // holds (Unibuild is linked as the own-team default on the clone).
  expect((await page.request.post('/api/maintenance/links',
    { data: { serviceProviderId: spId, relationship: 'contracted_vendor', isDefault: true } })).ok()).toBeTruthy();
  expect((await page.request.put('/api/maintenance/policies',
    { data: { rules: [{ serviceCategoryId: 3, coverage: 'covered', approvalThresholdAed: 500 }] } })).ok()).toBeTruthy();

  // ── the customer raises a request on their live lease ──
  const custCtx = await browser.newContext();
  const cust = await custCtx.newPage();
  await signIn(cust, CUSTOMER);
  const leases = (await (await cust.request.get('/api/contracts/tenant')).json()) as { id: number; status: string }[];
  const lease = leases.find((l) => ['active', 'issued'].includes(l.status));
  expect(lease, 'customer needs a live lease on the local stack').toBeTruthy();
  const created = await (await cust.request.post('/api/maintenance/my', {
    data: { contractId: lease!.id, serviceCategoryId: 3, title: `${TAG} Kitchen sink leaking`, description: 'constant drip' },
  })).json() as { id: number; ref: string; stage: string; coverage: string };
  expect(created.stage).toBe('requested');
  expect(created.coverage).toBe('covered');

  try {
    // ── RP board: the card sits in the Requested lane ──
    await page.goto('/rental-provider/dashboard/operations?tab=maintenance&view=kanban');
    const card = page.locator('.opsp-page .card').filter({ hasText: created.ref }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText('awaiting quote');
    await page.screenshot({ path: '/tmp/maint-board.png' });

    // ── detail page via the card's Open link ──
    await card.getByRole('link', { name: /open/i }).click();
    await expect(page.getByText(created.ref)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Covered — landlord pays')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByText('Request received')).toBeVisible();
    await expect(page.getByText('Routed to the provider')).toBeVisible();
    await page.screenshot({ path: '/tmp/maint-detail.png', fullPage: true });

    // ── Settings → Maintenance renders the matrix + the link ──
    await page.goto('/rental-provider/dashboard/settings?tab=maintenance');
    await expect(page.getByText('Maintenance coverage')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('manage providers')).toBeVisible();
    // The linked provider is offered in the default-provider select (an
    // <option> is attached, never "visible" to Playwright).
    await expect(page.locator('option', { hasText: vendors[0].name }).first()).toBeAttached();
    await page.screenshot({ path: '/tmp/maint-settings.png', fullPage: true });

    // ── the customer's lease page tracks it ──
    await cust.goto(`/dashboard/customer/contracts/${lease!.id}`);
    // Row-scoped: earlier (cancelled) requests stay listed on the lease page.
    const myRow = cust.locator('li').filter({ hasText: created.ref }).first();
    await expect(myRow).toBeVisible({ timeout: 60_000 });
    await expect(myRow).toContainText('covered by your landlord');
    await cust.screenshot({ path: '/tmp/maint-customer.png', fullPage: true });
  } finally {
    // ── cleanup through the API ──
    const mine = (await (await cust.request.get('/api/maintenance/my')).json()) as { id: number; title: string }[];
    for (const r of mine.filter((r) => r.title.includes(TAG))) {
      await cust.request.post(`/api/maintenance/my/${r.id}/cancel`, { data: {} });
    }
    const pol = (await (await page.request.get('/api/maintenance/policies')).json()) as { defaults: { id: number }[] };
    for (const r of pol.defaults) await page.request.delete(`/api/maintenance/policies/${r.id}`);
    await page.request.delete(`/api/maintenance/links/${spId}`);
    wipeE2eRequests();
    await custCtx.close();
  }
});

/**
 * Phase B — the SP layer prices the job. The linked provider gets a live
 * fixed-price Plumbing item; a COVERED request under the threshold approves
 * itself off that price (no quote), and a CHARGEABLE request placed with that
 * provider is paid to confirm from the customer's lease page.
 */
test('a catalog price skips the quote: covered auto-approves, chargeable is paid to confirm', async ({ browser, page }) => {
  test.setTimeout(300_000);
  await signIn(page, RP);
  const vendors = (await (await page.request.get('/api/amc/vendors/all')).json()) as { id: number; name: string }[];
  expect(vendors.length).toBeGreaterThan(0);
  const spId = vendors[0].id;
  // A leaf under the Plumbing GROUP — the group name is the bridge to the
  // provider's `plumbing` catalog category (maintenance-pricing.util.ts).
  const cats = (await (await page.request.get('/api/maintenance/categories')).json()) as { id: number; name: string; parentId: number | null }[];
  const plumbing = cats.find((c) => c.parentId == null && c.name === 'Plumbing');
  const leaf = cats.find((c) => c.parentId === plumbing?.id);
  expect(leaf, 'the seeded Plumbing group needs at least one item').toBeTruthy();
  const LEAF = leaf!.id;
  const itemId = Number(psql(`INSERT INTO service_catalog (service_provider_id, name, category, pricing_mode, base_price, price_unit, is_available, listing_status, is_from_price)
    VALUES (${spId}, '${TAG} Drain unblocking', 'plumbing', 'fixed', 350, 'fixed', true, 'approved', false) RETURNING id`));
  expect(itemId).toBeGreaterThan(0);
  expect((await page.request.post('/api/maintenance/links',
    { data: { serviceProviderId: spId, relationship: 'contracted_vendor', isDefault: true } })).ok()).toBeTruthy();
  expect((await page.request.put('/api/maintenance/policies',
    { data: { rules: [{ serviceCategoryId: LEAF, coverage: 'covered', approvalThresholdAed: 500 }] } })).ok()).toBeTruthy();

  const custCtx = await browser.newContext();
  const cust = await custCtx.newPage();
  await signIn(cust, CUSTOMER);
  const leases = (await (await cust.request.get('/api/contracts/tenant')).json()) as { id: number; status: string }[];
  const lease = leases.find((l) => ['active', 'issued'].includes(l.status));
  expect(lease, 'customer needs a live lease on the local stack').toBeTruthy();
  const created: { id: number; ref: string }[] = [];

  try {
    // ── covered + AED 350 ≤ 500 threshold → priced from the catalog and auto-approved, no quote ──
    const covered = await (await cust.request.post('/api/maintenance/my', {
      data: { contractId: lease!.id, serviceCategoryId: LEAF, title: `${TAG} Bathroom drain blocked` },
    })).json() as { id: number; ref: string };
    created.push(covered);
    const detail = await (await cust.request.get(`/api/maintenance/my/${covered.id}`)).json() as {
      stage: string; coverage: string; quote: unknown; booking: { status: string; totalAed: number; pricingMode: string };
    };
    expect(detail.coverage).toBe('covered');
    expect(detail.quote).toBeNull();
    expect(detail.booking.pricingMode).toBe('fixed');
    expect(Number(detail.booking.totalAed)).toBe(350);
    expect(detail.booking.status).toBe('assigned');
    expect(detail.stage).toBe('in_progress');

    await page.goto(`/rental-provider/dashboard/maintenance/${covered.id}`);
    await expect(page.getByText('Quote auto-approved (under the threshold)')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Routed to the provider')).toBeVisible();
    await page.screenshot({ path: '/tmp/maint-prepriced-covered.png', fullPage: true });

    // ── chargeable → the customer picks the provider (fixed price shown) and pays to confirm ──
    expect((await page.request.put('/api/maintenance/policies',
      { data: { rules: [{ serviceCategoryId: LEAF, coverage: 'chargeable' }] } })).ok()).toBeTruthy();
    const opts = await (await cust.request.get(`/api/maintenance/my/providers?contractId=${lease!.id}&categoryId=${LEAF}`)).json() as {
      coverage: string; defaultServiceProviderId: number; options: { serviceProviderId: number; source: string; fixedPriceAed: number | null }[];
    };
    expect(opts.coverage).toBe('chargeable');
    expect(opts.defaultServiceProviderId).toBe(spId);
    expect(opts.options.find((o) => o.serviceProviderId === spId)?.fixedPriceAed).toBe(350);

    const chargeable = await (await cust.request.post('/api/maintenance/my', {
      data: { contractId: lease!.id, serviceCategoryId: LEAF, title: `${TAG} Kitchen drain slow`, serviceProviderId: spId },
    })).json() as { id: number; ref: string; stage: string; coverage: string };
    created.push(chargeable);
    expect(chargeable.coverage).toBe('chargeable');
    expect(chargeable.stage).toBe('awaiting_approval');

    await cust.goto(`/dashboard/customer/contracts/${lease!.id}`);
    const row = cust.locator('li').filter({ hasText: chargeable.ref }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText('Pay to confirm');
    await expect(row).toContainText('fixed price AED 350');
    await cust.screenshot({ path: '/tmp/maint-prepriced-pay.png', fullPage: true });
    await row.getByRole('button', { name: /Pay AED 350 to confirm/ }).click();
    await expect(row).toContainText('In progress', { timeout: 60_000 });

    const paid = await (await cust.request.get(`/api/maintenance/my/${chargeable.id}`)).json() as {
      stage: string; booking: { status: string; payer: string };
    };
    expect(paid.booking.status).toBe('assigned');
    expect(paid.booking.payer).toBe('customer');
    expect(paid.stage).toBe('in_progress');

    // ── the landlord dashboard's Maintenance section renders ──
    await page.goto('/rental-provider/dashboard');
    await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible({ timeout: 60_000 });
    // The two KPI cards are links into the board; "Held" alone also matches
    // "Deposits Held" and a caption, so match the card's own label + count.
    await expect(page.getByRole('link', { name: /^Approvals \d/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Held \d/ })).toBeVisible();
  } finally {
    for (const r of created) await cust.request.post(`/api/maintenance/my/${r.id}/cancel`, { data: {} });
    const pol = (await (await page.request.get('/api/maintenance/policies')).json()) as { defaults: { id: number }[] };
    for (const r of pol.defaults) await page.request.delete(`/api/maintenance/policies/${r.id}`);
    await page.request.delete(`/api/maintenance/links/${spId}`);
    psql(`UPDATE bookings SET catalog_item_id = NULL WHERE catalog_item_id = ${itemId}`);
    psql(`DELETE FROM service_catalog WHERE id = ${itemId}`);
    wipeE2eRequests();
    await custCtx.close();
  }
});
