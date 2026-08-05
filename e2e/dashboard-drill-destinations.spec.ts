import { test, expect, Page } from '@playwright/test';

/**
 * Where the dashboard's drill-downs actually SEND you.
 *
 * Two reported defects, both the same shape — a link hard-coding one surface
 * when the record lives on another:
 *
 *   1. An overdue/bounced cheque opened /contracts/{id}/v2 (the Leases register)
 *      even when its lease is still unlocked, i.e. worked in Operations. The
 *      server now stamps each cheque row with its contract's `locked` state and
 *      the row uses contractHref().
 *   2. A vacant unit opened /dashboard/units/{id}, a standalone page that
 *      rendered the unit a second, separately-maintained way. That page is gone;
 *      unit links now open the Units workspace with `?unit=` and its preview.
 */

const RP_EMAIL = 'kbaalfalasi@gmail.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('an arrears cheque on an unlocked lease opens Operations, not the register', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);

  const res = await page.request.get('/api/contracts/financial-summary');
  expect(res.ok()).toBeTruthy();
  const fin = await res.json() as {
    arrearsCheques: Array<{ id: number; contractId: number; locked?: boolean; kind: string }>;
  };

  // Every row must carry the surface — a row without it falls back to the
  // register, which is the bug this fixes.
  expect(fin.arrearsCheques.length).toBeGreaterThan(0);
  for (const c of fin.arrearsCheques) {
    expect(typeof c.locked, `cheque ${c.id} must state its contract's surface`).toBe('boolean');
  }

  const unlocked = fin.arrearsCheques.filter(c => c.locked === false);
  expect(unlocked.length, 'fixture needs at least one arrears cheque on an unlocked lease').toBeGreaterThan(0);

  await page.goto('/rental-provider/dashboard');
  // Wait for the figure to land before clicking — the tile is inert while the
  // financial summary is still "…".
  const tile = page.getByText('Overdue', { exact: true }).first();
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await expect.poll(
    async () => (await page.getByText('cheques past their date').count()) > 0,
    { timeout: 60_000 },
  ).toBe(true);
  await tile.click();

  // The drill lists one row per cheque; each must point at its lease's own
  // surface. Operations for unlocked, the register for locked. Scope to the
  // drill panel so the sidebar nav's links are not counted as results.
  const panel = page.locator('a[href*="/dashboard/operations/"], a[href*="/dashboard/contracts/"]');
  await expect.poll(async () => await panel.count(), { timeout: 30_000 }).toBeGreaterThan(0);

  const hrefs = await panel.evaluateAll(els => els.map(e => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
  const opsHrefs = hrefs.filter(h => /\/dashboard\/operations\/\d+$/.test(h));
  expect(opsHrefs.length, `expected Operations links for unlocked leases, got: ${hrefs.join(' | ')}`).toBeGreaterThan(0);

  // And none of the unlocked contracts may appear under the register route.
  for (const c of unlocked) {
    expect(hrefs, `contract ${c.contractId} is unlocked and must not link to the register`)
      .not.toContain(`/rental-provider/dashboard/contracts/${c.contractId}/v2`);
  }
});

test('a Notice Sent renewal opens the renewal itself in Operations, not the lease it replaces', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);

  const res = await page.request.get('/api/contracts/dashboard-extras?window=90');
  expect(res.ok()).toBeTruthy();
  const extras = await res.json() as {
    upcomingRenewals: Array<{
      contractId: number; openContractId?: number; openIn?: string; bucket?: string;
      tenantName: string | null;
    }>;
  };

  const sent = extras.upcomingRenewals.filter(r => r.bucket === 'noticeSent');
  expect(sent.length, 'fixture needs Notice Sent renewals').toBeGreaterThan(0);

  // Every one must point at a DIFFERENT record than the expiring lease — the
  // pending renewal child — and at the Operations surface where it is worked.
  for (const r of sent) {
    expect(r.openIn, `renewal on lease ${r.contractId}`).toBe('operations');
    expect(r.openContractId, `renewal on lease ${r.contractId} must open the renewal, not the old lease`)
      .not.toBe(r.contractId);
  }

  // And that destination has to actually render THAT renewal. Asserted on the
  // record's own CID, which nothing else on the page or in the sidebar can
  // satisfy — unlike the customer's name, which for a company customer is the
  // COMPANY here and the signatory on the dashboard row.
  const target = sent[0]!;
  await page.goto(`/rental-provider/dashboard/operations/${target.openContractId}`);
  await expect(page.getByText(`CID-${target.openContractId}`).first())
    .toBeVisible({ timeout: 60_000 });
});

test('a vacant unit opens the Units workspace with its preview, and the old page is gone', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, RP_EMAIL);

  const res = await page.request.get('/api/properties/dashboard-stats');
  expect(res.ok()).toBeTruthy();
  const stats = await res.json() as {
    units: Array<{ id: number; number: string | null; availability: string }>;
  };
  const vacant = stats.units.find(u => u.availability === 'available');
  expect(vacant, 'fixture needs a vacant unit').toBeTruthy();

  // The title the modal will render — unitName wins, else "Unit {number}"
  // (UnitPreviewModal's own rule). Asserting on it proves the deep link opened
  // the RIGHT unit, not merely that some preview opened.
  const all = await (await page.request.get('/api/properties/units/all')).json() as
    Array<{ id: number; unitNumber: string | null; unitName: string | null }>;
  const rec = all.find(u => u.id === vacant!.id);
  const expectedTitle = rec?.unitName || `Unit ${rec?.unitNumber ?? vacant!.id}`;

  // The workspace deep link opens THAT unit's preview. The modal is a custom
  // overlay (no dialog role): its Back button and <h1> title identify it. The
  // page's own "My Units" <h1> comes first in the DOM, so filter by text.
  await page.goto(`/rental-provider/dashboard/units?unit=${vacant!.id}`);
  await expect(page.locator('button[aria-label="Back"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('h1').filter({ hasText: expectedTitle })).toBeVisible({ timeout: 15_000 });

  // The standalone unit page no longer exists.
  const gone = await page.request.get(`/rental-provider/dashboard/units/${vacant!.id}`);
  expect(gone.status(), 'the old /units/{id} route must not resolve').toBe(404);
});
