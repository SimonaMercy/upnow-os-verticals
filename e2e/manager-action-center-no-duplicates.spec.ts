/**
 * The Action Center lists each tenancy ONCE.
 *
 * A renewal that was cancelled is stored as `terminated` + `termination_method`
 * = 'cancelled', wearing the same accepted-response and effective-date markers a
 * real termination wears — so the wind-down buckets counted it as an ending
 * tenancy on top of the lease that was genuinely ending. Unit 303 appeared twice
 * under "Move-outs (inspection due)": the lease ending now, and the term starting
 * Nov 2026 that had been called off. Settlement Pending carried two more of them
 * (units 105 and 303), quoting the chain's deposit against a lease nobody lived in.
 *
 * This walks EVERY bucket rather than the two that were reported, so the next
 * bucket to grow a wind-down predicate is covered by the same guard.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

const MANAGER = 'sheco1300@yahoo.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

/** Cancelled renewals on the fixture landlord, straight from the clone. */
const cancelledLeaseIds = (): number[] =>
  execFileSync('psql', ['-h', 'localhost', '-p', '5432', '-d', 'upnow_prod_clone', '-At', '-c',
    `SELECT id FROM tenancy_contracts WHERE rental_provider_id = 2 AND termination_method = 'cancelled'`])
    .toString().trim().split('\n').filter(Boolean).map(Number);

type Item = { id: number; tenant?: string; unit?: string | null };
type Bucket = { count: number; items: Item[] };

test('no bucket lists one tenancy twice, and none carries a cancelled renewal', async ({ page }) => {
  await signIn(page, MANAGER);

  const res = await page.request.get('/api/manager/action-center?days=90&rp=2');
  const body = (await res.json()) as Record<string, Bucket>;
  const buckets = Object.entries(body).filter(([, v]) => v && Array.isArray(v.items) && v.items.length);

  const cancelled = cancelledLeaseIds();
  expect(cancelled.length, 'fixture must still hold cancelled renewals to prove anything').toBeGreaterThan(0);

  for (const [name, bucket] of buckets) {
    // A lease-keyed bucket (one with units) must never name the same unit for
    // the same customer twice — that is one tenancy, however many lease records
    // the renewal chain holds.
    if (bucket.items[0].unit) {
      const seen = new Map<string, number[]>();
      for (const i of bucket.items) {
        const key = `${i.tenant}|${i.unit}`;
        seen.set(key, [...(seen.get(key) ?? []), i.id]);
      }
      const dupes = [...seen].filter(([, ids]) => ids.length > 1);
      expect(dupes, `${name} lists a tenancy more than once: ${JSON.stringify(dupes)}`).toEqual([]);
    }
    // …and no bucket may carry a lease that was cancelled before it ever ran.
    const phantom = bucket.items.filter(i => cancelled.includes(i.id)).map(i => i.id);
    expect(phantom, `${name} carries cancelled lease(s) ${phantom.join(', ')}`).toEqual([]);
  }
});
