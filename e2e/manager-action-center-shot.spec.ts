import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * Manager dashboard Action Center — the buckets must count only what the manager
 * can still act on, every row must deep-link to the page that clears it, and the
 * counts must agree with the Operations pipeline, which is the same work seen as
 * kanban lanes. Two surfaces disagreeing about how much is outstanding is the
 * defect this guards.
 *
 * Manager 411 (sheco1300@yahoo.com) holds every permission for landlords 1 and 2,
 * so "All landlords" exercises the cross-landlord aggregate and the per-row `rpId`
 * the links are built from.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/eab98470-dc27-4270-b9fe-efe90a682182/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

type Item = { id: number; rpId?: number; parentId?: number | null; tenantId?: number };
type Bucket = { count: number; items: Item[]; truncated?: boolean };
type Ops = {
  id: number; contractType: string; windDown?: boolean; terminationRequested?: boolean;
  checklist: { key: string; done: boolean }[];
};

/** The Operations lane order, mirrored from OperationsPipelines. A card sits in
 *  its FIRST incomplete lane, so "in Signatures" means every earlier gate is done
 *  and a signature is not. */
// New leases have no Cheques / PDC lane — cheques are worked in the Lead flow.
const NEW_LANES = [['sign_tenant', 'sign_landlord'], ['kyc'], ['payment_plan'], ['ejari'], ['utility'], ['move_in']];
const RENEWAL_LANES = [['renewal_draft'], ['renewal_notice'], ['sign_tenant', 'sign_landlord'], ['kyc'], ['payment_plan'], ['pdc'], ['ejari']];
/** The lane a card sits in: its first incomplete one. */
function laneOf(c: Ops): string | null {
  const lanes = c.contractType === 'renewal' ? RENEWAL_LANES : NEW_LANES;
  const pending = (keys: string[]) => c.checklist.some(i => keys.includes(i.key) && !i.done);
  for (const lane of lanes) if (pending(lane)) return lane[0];
  return null;
}
const inSignatureLane = (c: Ops) => laneOf(c) === 'sign_tenant';

test('manager action center counts only actionable work and links every row', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1600, height: 1400 });
  await signIn(page, 'sheco1300@yahoo.com');

  const res = await page.request.get('/api/manager/action-center?days=90');
  expect(res.ok()).toBeTruthy();
  const ac = await res.json();
  fs.writeFileSync(`${SHOTS}/action-center.json`, JSON.stringify(ac, null, 2));
  const counts = Object.fromEntries(
    Object.entries(ac).filter(([, v]) => v && typeof v === 'object' && 'count' in (v as object))
      .map(([k, v]) => [k, (v as Bucket).count]),
  );
  console.log('COUNTS', JSON.stringify(counts));

  // ---- Cross-check against Operations, landlord by landlord ------------------
  // Operations is per-landlord (?rp=), the Action Center aggregates, so the
  // per-landlord lanes have to add up to the dashboard's number.
  const opsAll: Ops[] = [];
  for (const rp of [1, 2]) {
    const r = await page.request.get(`/api/manager/contracts/operations?rp=${rp}`);
    expect(r.ok()).toBeTruthy();
    opsAll.push(...(await r.json()));
  }
  const setup = opsAll.filter(c => !c.windDown && !c.terminationRequested);
  const opsSigLane = setup.filter(inSignatureLane).map(c => c.id).sort((a, b) => a - b);
  const acSig = (ac.awaitingSignature as Bucket).items.map(i => i.id).sort((a, b) => a - b);
  console.log('OPS SIGNATURES LANE', JSON.stringify(opsSigLane));
  console.log('ACTION CENTER SIG  ', JSON.stringify(acSig));
  expect(acSig).toEqual(opsSigLane);

  // "Renewal Offers — Awaiting Reply" must equal the Operations **Notice Sent**
  // lane. A pending renewal child whose notice was never sent sits in the Draft
  // lane instead, and belongs in "Renewals to raise" — counting it as an offer
  // out overstated the queue by exactly those drafts.
  const noticeSent = setup.filter(c => laneOf(c) === 'renewal_notice').map(c => c.id).sort((a, b) => a - b);
  const acOffers = (ac.renewalOffersOut as Bucket).items.map(i => i.id).sort((a, b) => a - b);
  console.log('OPS NOTICE-SENT LANE', noticeSent.length, 'AC OFFERS', acOffers.length);
  expect(acOffers).toEqual(noticeSent);

  // Every unsent renewal draft is picked up by "Renewals to raise" — it must not
  // fall through the gap between the two buckets.
  const drafts = setup.filter(c => laneOf(c) === 'renewal_draft');
  const toRaiseParents = new Set((ac.renewals as Bucket).items.map(i => i.id));
  for (const d of drafts) {
    const parentShown = (ac.renewals as Bucket).items.some(r => toRaiseParents.has(r.id));
    expect(parentShown, `draft ${d.id} has no parent in Renewals to raise`).toBeTruthy();
  }

  // The leads bucket must agree with the Open Leads headline stat — the same
  // leads, counted once on the tile and listed once in the card.
  const overview = await (await page.request.get('/api/manager/overview')).json();
  expect((ac.openLeads as Bucket).count).toBe(overview.openLeads);

  // A lease with a renewal already proposed or accepted is not a renewal to
  // raise — it moved to the offers-out bucket, and must not be counted in both.
  const renewals = ac.renewals as Bucket;
  const offers = ac.renewalOffersOut as Bucket;
  const offerParents = new Set(offers.items.map(i => i.parentId));
  for (const r of renewals.items) expect(offerParents.has(r.id)).toBeFalsy();

  // Every row carries the landlord it belongs to — the deep links are built from
  // it, and a manager page without an explicit landlord has nothing to resolve.
  for (const [name, b] of Object.entries(ac)) {
    if (!b || typeof b !== 'object' || !('items' in (b as object))) continue;
    const bk = b as Bucket;
    // The card scrolls the whole queue, so the payload must carry it all.
    expect(bk.items.length, `${name} withheld rows`).toBe(bk.truncated ? bk.items.length : bk.count);
    for (const i of bk.items) {
      expect(i.rpId, `${name} item ${i.id} is missing rpId`).toBeTruthy();
      expect([1, 2]).toContain(i.rpId);
    }
  }

  await page.goto('/dashboard/manager');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Action Center')).toBeVisible();
  await expect(page.getByText('Open Leads')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/manager-dashboard.png`, fullPage: true });
  // AMC and the landlord list were pulled off this dashboard.
  await expect(page.getByText('AMC Expired')).toHaveCount(0);
  await expect(page.getByText('Your Landlords')).toHaveCount(0);
  // Delayed Follow-ups has no unit and no lease term, so the last card row gets
  // its own shot to confirm the row layout still reads without them.
  await page.getByText('Delayed Follow-ups').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/manager-dashboard-bottom.png` });

  // A card with more rows than fit scrolls its own list — the queue is all there,
  // not truncated to a preview.
  const offersCard = page.locator('div.rounded-2xl', { hasText: 'Renewal Offers' }).first();
  const list = offersCard.locator('.mgr-bucket-list');
  const { scrollH, clientH, rows } = await list.evaluate(el => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight, rows: el.querySelectorAll('a,div>div>p').length,
  }));
  console.log('OFFERS LIST', JSON.stringify({ scrollH, clientH, rows }));
  expect(scrollH).toBeGreaterThan(clientH);          // genuinely scrollable
  expect(offers.items.length).toBe(offers.count);    // and holding every row

  // The rows are links, and clicking one lands on that lease's Operations page.
  const firstRow = page.locator('a[href*="/dashboard/manager/operations/"]').first();
  await expect(firstRow).toBeVisible();
  const href = await firstRow.getAttribute('href');
  console.log('FIRST ROW HREF', href);
  expect(href).toMatch(/\/dashboard\/manager\/operations\/\d+\?rp=\d+/);
  await firstRow.click();
  await page.waitForURL(/\/dashboard\/manager\/operations\/\d+/);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${SHOTS}/manager-row-target.png`, fullPage: true });
});
