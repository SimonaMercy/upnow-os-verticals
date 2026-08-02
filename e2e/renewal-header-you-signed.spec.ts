/**
 * Manager contract detail (394, rp=2): the header action row no longer carries a
 * "You signed" pill — the pipeline's signature stop and the signatures section
 * already state who signed, and "you" was the wrong actor in a manager's view.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const S = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/1ef864e2-eb06-463e-a38d-02b3528471a1/scratchpad/renewal-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('contract header has no "You signed" pill', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(S, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/contracts/394/v2?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  expect(await page.getByText('You signed').count(), '"You signed" pill removed').toBe(0);
  await page.screenshot({ path: `${S}/contract-header.png` });
});
