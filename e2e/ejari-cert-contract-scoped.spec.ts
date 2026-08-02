/**
 * The Contract Registration certificate must be offered ONLY against the lease
 * it was uploaded onto, and therefore only once that lease is registered.
 *
 * `/documents/my` merges the customer's docs across EVERY contract they hold, so
 * an unscoped `documentKey.startsWith('ejari')` surfaced one lease's certificate
 * on another lease's space — including spaces still mid-payment, and renewals
 * whose own registration had not happened yet.
 *
 * Fixture: dev@upnow.ae holds ONE certificate, on contract 391 (unit 217).
 *   v-6 → unit 217: renewal (child 392) in flight over the live lease 391.
 *   v-8 → unit Shed-8: a different lease entirely, awaiting payment confirmation.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('certificate is scoped to the lease that owns it', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1280, height: 1400 });
  await signIn(page, 'dev@upnow.ae');

  // Guard the fixture: exactly one certificate, and it belongs to contract 391.
  const body = await (await page.request.get('/api/documents/my')).json();
  const certs = (body?.documents ?? []).filter((d: { documentKey: string; fileUrl?: string }) =>
    /^ejari/i.test(d.documentKey) && !!d.fileUrl);
  expect(certs).toHaveLength(1);
  expect(certs[0].ownerType).toBe('tenancy_contract');
  expect(certs[0].ownerId).toBe(391);

  // Anchored on the page chrome, not a step headline: these fixtures advance as
  // the RP works them, and the scoping rule holds at every step.
  const loaded = () => expect(page.getByText('My Spaces').first()).toBeVisible({ timeout: 30_000 });

  // A DIFFERENT lease: it owns no certificate, so none is offered at any step.
  await page.goto('/dashboard/customer/spaces/v2/v-8');
  await page.waitForLoadState('networkidle');
  await loaded();
  await expect(page.getByText('Download Contract Registration Certificate')).toHaveCount(0);
  await expect(page.getByText('Contract Registration Certification')).toHaveCount(0);

  // The renewal child 392 owns NO certificate document — note it carries
  // ejariStatus 'registered' without one, which is exactly why the download has
  // to key off the document rather than the status.
  await page.goto('/dashboard/customer/spaces/v2/v-6');
  await page.waitForLoadState('networkidle');
  await loaded();
  await expect(page.getByText('Download Contract Registration Certificate')).toHaveCount(0);

  // ...but the live lease 391, which DOES own it, still offers it on the same page.
  await expect(page.getByText('Contract Registration Certification')).toHaveCount(1);
});
