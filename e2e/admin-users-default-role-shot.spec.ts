import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// User Management always filters to one role — no "All" tab — and lands on
// Rental Providers.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/508ee768-fca6-4f1a-adbe-d3abd9fcd8da/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('user management lands on Rental Providers with no All tab', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'admin@upnow.ae');

  await page.goto('/dashboard/admin/users');
  await expect(page.getByRole('heading', { name: 'User Management' })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });

  await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/role=rental_provider/);

  // The filter really applied: the row count matches the subtitle's role count.
  const subtitle = await page.locator('h1 + p, h1 ~ p').first().innerText();
  const rows = await page.locator('tbody tr').count();
  console.log(`subtitle: ${subtitle}, rows: ${rows}`);
  expect(subtitle).toMatch(new RegExp(`^${rows} rental provider`));

  await page.screenshot({ path: `${SHOTS}/users-default-rental-providers.png`, fullPage: true });

  // A retired ?role= link (the old All view) falls back to the default tab.
  await page.goto('/dashboard/admin/users?role=');
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveURL(/role=rental_provider/);

  // Other tabs still switch, and the subtitle counts that role.
  await page.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveURL(/role=customer/);
  await page.screenshot({ path: `${SHOTS}/users-customers-tab.png`, fullPage: true });
});
