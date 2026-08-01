import { test, expect, Page } from '@playwright/test';

/**
 * A renewal whose PDCs were never confirmed must SAY so, not claim the opposite.
 *
 * CID-103 (Unit 207) presented as "Cheques collected" with a green "Post-dated
 * cheques confirmed" tick while `pdc_confirmed` was false in the database. The
 * Cheques stop inherited doneness from `tenantSigned && landlordSigned`, on the
 * assumption that signing implies collection. That breaks for a lease signed via
 * the import/blessing path (exempt from the PDC gate, see activateContract) and
 * then demoted back to ISSUED by resetEjariForRedo: signed, un-activated,
 * pdcConfirmed=false. The journey read 5/6 "ready to activate" while
 * _autoActivateRenewalOnEjari silently refused for the very reason the page hid.
 *
 * Asserted against whichever contract is currently in that shape, because the
 * shape is the bug — the RP can clear any individual record at any time (103 was
 * cleared by hand minutes after this was first written).
 */
const CANDIDATES = [341, 103];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('a renewal with unconfirmed PDCs never reads as collected', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'kbaalfalasi@gmail.com');

  // Find a renewal still in the stuck shape: not activated, PDCs unconfirmed.
  let target: number | null = null;
  for (const id of CANDIDATES) {
    const r = await page.request.get(`/api/contracts/${id}`);
    if (!r.ok()) continue;
    const c = await r.json();
    if (c.contractType === 'renewal' && c.status === 'issued' && c.pdcConfirmed === false) { target = id; break; }
  }
  test.skip(target === null, 'no renewal is currently in the unconfirmed-PDC shape');

  await page.goto(`/rental-provider/dashboard/operations/${target}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const body = page.locator('body');
  // The claim the RP must never see over an unset flag.
  await expect(body).not.toContainText('Renewal cheques collected.');
  await expect(body).not.toContainText('Post-dated cheques confirmed');
  await expect(body).not.toContainText('All records complete');
  // The step is surfaced as outstanding, and named.
  await expect(body).toContainText('Cheques / PDC');
  await expect(body).toContainText(/steps? need attention/);

  await page.screenshot({ path: 'e2e/__shots__/renewal-pdc-missing.png', fullPage: true });
});
