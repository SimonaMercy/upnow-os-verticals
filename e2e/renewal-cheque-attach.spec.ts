/**
 * Customer space v-6, renewal Cheques/PDC step — every rent instalment gets its
 * OWN attach control on the Payment Summary row (as the new-lease payment step
 * does), and the bulk "send them all together" drop is still offered alongside.
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

test('renewal cheques step attaches per instalment and still allows bulk', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1280, height: 1500 });
  await signIn(page, 'dev@upnow.ae');
  await page.goto('/dashboard/customer/spaces/v2/v-6');
  await page.waitForLoadState('networkidle');

  // The renewal fixture advances as the RP works it, and once the child's Ejari
  // is registered the router leaves the Cheques step entirely. Skip loudly
  // rather than fail — the routing rule itself is covered, without a browser and
  // without a fixture, in renewal-cheques-state.spec.ts.
  const onStep = await page
    .getByText(/Cheques submitted — rental provider is reviewing|Payment Summary/)
    .first()
    .isVisible()
    .catch(() => false);
  test.skip(!onStep, 'v-6 has advanced past the renewal Cheques step');

  // The control renders an icon + text, so its text node is " Attach" — regex
  // matching (unlike exact-string) does not trim, hence the \s*.
  const anyAttach = /^\s*(Attach|Replace)\s*$/;

  // The "View renewal contract" action was removed from this step, in both the
  // pre-submit and submitted states.
  await expect(page.getByRole('link', { name: /View renewal contract/ })).toHaveCount(0);

  // Once submitted the step becomes a pure status screen, mirroring the
  // new-lease waiting step: message + what was sent, and NO payment plan —
  // re-showing the schedule implies the customer still has to act on it.
  const submitted = await page.getByText(/Cheques submitted — rental provider is reviewing/).count() > 0;

  if (submitted) {
    await expect(page.getByText('Payment Summary')).toHaveCount(0);
    await expect(page.getByText(/GRAND TOTAL/i)).toHaveCount(0);
    await expect(page.getByText(anyAttach)).toHaveCount(0);
    await expect(page.getByTestId('renewal-pdc-input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Submit cheques for review/ })).toHaveCount(0);
    // What was sent is still listed, tagged with the payment it covers.
    await expect(page.getByText('Your uploaded cheques')).toBeVisible();
    await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/space-v6-cheques-submitted.png`, fullPage: true });
    return;
  }

  // Not yet submitted → the plan drives the step.
  await expect(page.getByText('Payment Summary').first()).toBeVisible();

  // 4 rent instalments + Management Fee + Third Party = 6 attach controls.
  // The rental group is the one that was missing per-row controls. A slot that
  // already holds a file reads "Replace", so match either state.
  await expect(page.getByText(anyAttach)).toHaveCount(6);

  // Each rent row carries its own control, in its own table row.
  for (const n of [1, 2, 3, 4]) {
    const row = page.locator('tr', { hasText: `Instalment ${n}` });
    await expect(row.getByText(anyAttach)).toHaveCount(1);
  }

  // Bulk drop still offered.
  await expect(page.getByTestId('renewal-pdc-input')).toHaveCount(1);
  await expect(page.getByText('Or send them all together')).toBeVisible();

  // The control must be ON SCREEN, not parked behind a horizontal scrollbar —
  // that clipping is what made it read as missing in the first place.
  const clipped = await page.evaluate(() => {
    let worst = 0;
    document.querySelectorAll('table').forEach(t => {
      const wrap = t.parentElement as HTMLElement;
      worst = Math.max(worst, wrap.scrollWidth - wrap.clientWidth);
    });
    return worst;
  });
  expect(clipped).toBe(0);
  await expect(page.getByText(anyAttach).first()).toBeInViewport();

  await page.screenshot({ path: `${SHOTS}/space-v6-cheques.png`, fullPage: true });
});
