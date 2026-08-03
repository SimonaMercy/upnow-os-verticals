import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Settings → Notifications. The "Notification Preferences" card was never wired
// — local state, no request on toggle, reset on reload, and nothing on the back
// end consumes a preference — so it is hidden (SHOW_NOTIF_PREFS) until it does
// something. What stays is "Customer Correspondence" (CC emails), which saves
// for real. This asserts the hidden card is gone and the working one still
// round-trips its GET.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/fe2215ba-1d5e-4a25-9712-2345b5b9b210/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

/** The Toggle pill sitting on the row whose title is `title`. */
const toggleFor = (page: Page, title: string) =>
  page.getByText(title, { exact: true }).locator('xpath=../..').locator('button');

test('the unwired preferences card is gone; correspondence stays', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1100 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const calls: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/api/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });

  await page.goto('/rental-provider/dashboard/settings?tab=notifications');
  await expect(page.getByText('Customer Correspondence')).toBeVisible({ timeout: 30_000 });
  console.log('LOAD-CALLS', JSON.stringify(calls, null, 1));

  // The parked card and every one of its rows.
  await expect(page.getByText('Notification Preferences')).toHaveCount(0);
  for (const title of ['New Inquiries', 'Cheque Reminders', 'Renewal Alerts', 'Maintenance Updates', 'Platform News']) {
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    await expect(toggleFor(page, title)).toHaveCount(0);
  }

  // The card that stays is the one that really persists.
  await expect(page.getByText('CC on customer emails')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  const prof = await page.request.get('/api/profiles/rental-provider/me');
  expect(prof.ok()).toBeTruthy();
  console.log('PROFILE-CC', JSON.stringify((await prof.json()).ccEmails ?? null));

  await page.screenshot({ path: `${SHOTS}/notif-tab.png`, fullPage: true });
});
