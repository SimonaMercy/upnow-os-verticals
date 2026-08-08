import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Ban is retired: no button on either admin surface, and the API refuses the
// status outright. Suspend stays as the one lock-out.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/508ee768-fca6-4f1a-adbe-d3abd9fcd8da/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('ban is gone from the UI and rejected by the API', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'admin@upnow.ae');

  await page.goto('/dashboard/admin/users');
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });

  await expect(page.getByRole('button', { name: 'Ban' })).toHaveCount(0);
  expect(await page.getByRole('button', { name: 'Suspend' }).count()).toBeGreaterThan(0);

  // A real table with the four asked-for columns, in order.
  // innerText comes back upper-cased by the header's `uppercase` class.
  const headers = (await page.locator('thead th').allInnerTexts()).filter(Boolean).map((h) => h.toLowerCase());
  console.log('columns:', JSON.stringify(headers));
  expect(headers).toEqual(['details', 'status', 'last active', 'action']);

  // Role badge is gone — the tab already says the role.
  await expect(page.locator('tbody td').getByText('Rental Provider', { exact: true })).toHaveCount(0);
  // Approved landlords no longer carry a stale KYC Pending badge.
  await expect(page.getByText('KYC Pending')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/users-table.png`, fullPage: true });

  // Detail page: Suspend only.
  await page.goto('/dashboard/admin/users/286');
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Ban' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/user-detail-no-ban.png` });

  // The API refuses `banned` even if something else tries to send it.
  const res = await page.request.patch('/api/admin/users/437/status', { data: { status: 'banned' } });
  console.log('PATCH status=banned →', res.status(), (await res.text()).slice(0, 160));
  expect(res.status()).toBe(400);

  // Suspend still works end to end.
  const ok = await page.request.patch('/api/admin/users/437/status', { data: { status: 'suspended' } });
  expect(ok.ok()).toBeTruthy();
  const back = await page.request.patch('/api/admin/users/437/status', { data: { status: 'active' } });
  expect(back.ok()).toBeTruthy();
});
