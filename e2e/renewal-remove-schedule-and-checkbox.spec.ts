/**
 * Customer space v-6 (renewal_offered) — the renewal offer now shows the SAME
 * Payment Summary card the RP/manager reads (PaymentPlanCard over the canonical
 * segregatedPlan grouping) directly under the contract preview, and no longer
 * carries the old per-installment "Payment schedule · N payments" table or the
 * payment-readiness checkbox.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/a78187e4-8a7c-414e-b19d-32998b9132c0/scratchpad/renewal-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('space v-6 renewal offer mirrors the landlord Payment Summary', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1280, height: 1400 });
  await signIn(page, 'dev@upnow.ae');
  await page.goto('/dashboard/customer/spaces/v2/v-6');
  await page.waitForLoadState('networkidle');

  // The shared summary must be on screen, otherwise the absence assertions below
  // would pass vacuously. It only renders on the renewal Terms and Cheques
  // steps; the fixture advances as the RP works it, so skip loudly rather than
  // assert nothing.
  await expect(page.getByText('My Spaces').first()).toBeVisible({ timeout: 30_000 });
  const onStep = await page.getByText('Payment Summary').first().isVisible().catch(() => false);
  test.skip(!onStep, 'v-6 has advanced past the renewal steps that render the Payment Summary');

  // Gone from the shared summary, whichever renewal step is showing: the old
  // look-alike schedule, the readiness gate, the rent headline.
  await expect(page.getByText(/Payment schedule ·/)).toHaveCount(0);
  await expect(page.getByTestId('renewal-payment-ready')).toHaveCount(0);
  await expect(page.getByText('New annual rent')).toHaveCount(0);
  await expect(page.getByText('Currently paying')).toHaveCount(0);

  // On the Terms step specifically, Accept must no longer be gated behind the
  // deleted checkbox. Once the offer has been accepted the step is gone, so
  // only assert it while it is actually rendered.
  const accept = page.getByRole('button', { name: /Accept renewal terms/ });
  if (await accept.count()) await expect(accept).toBeEnabled();

  // Present: the shared Payment Summary, with the same segregated groups and
  // grand total the manager sees on Operations for CID-392.
  await expect(page.getByText('Payment Summary').first()).toBeVisible();
  await expect(page.getByText('Contract CID-392')).toBeVisible();
  await expect(page.getByText('Rental Income')).toBeVisible();
  await expect(page.getByText('Management Fee')).toBeVisible();
  await expect(page.getByText('Third Party')).toBeVisible();
  await expect(page.getByText('AED 101,300.00')).toBeVisible();
  // Renewals never re-collect the deposit — no Security Deposit group.
  await expect(page.getByText('Security Deposit', { exact: true })).toHaveCount(0);

  // Header meta matches the landlord's card — including Community, which the
  // viewing-derived unit doesn't carry (it has to come off the contract).
  await expect(page.getByText('Ahmad Rashed Buti Alfalasi')).toBeVisible();
  await expect(page.getByText('Community')).toBeVisible();
  await expect(page.getByText('Al Raffa', { exact: true })).toBeVisible();
  // "Paid by" only renders when the rows carry a payment method — the customer
  // payload had to start sending it.
  await expect(page.getByText('Paid by').first()).toBeVisible();
  await expect(page.getByText('Cheque').first()).toBeVisible();

  // On the Terms step the summary belongs UNDER the contract preview, not above
  // it. The preview link only exists on that step.
  const preview = page.getByTestId('renewal-preview-contract');
  if (await preview.count()) {
    const previewY = (await preview.boundingBox())!.y;
    const summaryY = (await page.getByText('Payment Summary').first().boundingBox())!.y;
    expect(summaryY).toBeGreaterThan(previewY);
  }

  await page.screenshot({ path: `${SHOTS}/space-v6-renewal.png`, fullPage: true });
});
