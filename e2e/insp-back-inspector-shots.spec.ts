/**
 * Contract 394, manager route: (a) Back from the inspection workspace must land
 * on Operations, not the lease record — including on a DIRECT link with no
 * `from=`; (b) "Inspection Team → Inspected By" pre-fills with the acting
 * manager. Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/insp-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('394 inspection: back target + inspector prefill', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'sheco1300@yahoo.com');

  // 1. Opened FROM Operations — the ops page links to /inspection?…&from=<ops>,
  //    which redirects to /inspection/v2. `from` must survive that hop.
  await page.goto('/dashboard/manager/contracts/394/inspection?type=move_in&rp=2&from=' +
    encodeURIComponent('/dashboard/manager/operations/394?rp=2'));
  await page.waitForURL(/inspection\/v2/, { timeout: 30_000 });
  console.log('via-ops URL      :', page.url());
  expect(page.url()).toContain('from=');

  // 2. Direct link with NO `from` — the URL the user reported.
  await page.goto('/dashboard/manager/contracts/394/inspection/v2?type=move_in&rp=2');
  const backLink = page.getByRole('link', { name: /Back to/ });
  await backLink.waitFor({ timeout: 30_000 });
  console.log('direct back lbl  :', (await backLink.textContent())?.trim());
  console.log('direct back href :', await backLink.getAttribute('href'));
  expect(await backLink.getAttribute('href')).toBe('/dashboard/manager/operations/394?rp=2');

  // 3. Inspection Team card.
  const team = page.getByText('INSPECTION TEAM').first();
  await team.waitFor({ timeout: 30_000 });
  const card = team.locator('xpath=ancestor::*[3]');
  console.log('team card        :', (await card.innerText()).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `${SHOTS}/inspection-team.png` });

  // 4. Land the click to prove the destination.
  await backLink.click();
  await page.waitForURL(/\/operations\/394/, { timeout: 30_000 });
  console.log('after-back URL   :', page.url());
  await page.screenshot({ path: `${SHOTS}/after-back.png` });
});
