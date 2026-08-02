import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * Settings → Notifications → Customer Correspondence: the addresses CC'd on
 * every customer email, so the landlord holds what the customer holds.
 * Screenshots the card empty, with chips, and saved, and asserts the list
 * survives a reload (i.e. it really persisted).
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/e42a4c6e-4fb5-464c-8ca7-a16b2678b8d0/scratchpad/shots-cc';
const RP_EMAIL = 'khalifa.almulla@hotmail.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

const ccInput = (page: Page) => page.getByPlaceholder(/press Enter to add/);

test('RP settings — customer correspondence CC list', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, RP_EMAIL);

  await page.goto('/rental-provider/dashboard/settings?tab=notifications', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await expect(page.getByText('Customer Correspondence')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-cc-empty.png` });

  // Enter adds a chip; a second address stacks alongside it.
  await ccInput(page).fill('leasing@almulla-properties.ae');
  await ccInput(page).press('Enter');
  await ccInput(page).fill('accounts@almulla-properties.ae');
  await ccInput(page).press('Enter');
  await expect(page.getByText('leasing@almulla-properties.ae')).toBeVisible();
  await expect(page.getByText('accounts@almulla-properties.ae')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-cc-chips.png` });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/will be copied on every customer email/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}/03-cc-saved.png` });

  // It persisted, not just echoed into local state.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await expect(page.getByText('leasing@almulla-properties.ae')).toBeVisible();
  await expect(page.getByText('accounts@almulla-properties.ae')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-cc-reloaded.png` });

  // Invalid input is rejected before it can reach an email header.
  await ccInput(page).fill('not-an-email');
  await ccInput(page).press('Enter');
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-cc-invalid.png` });

  // Removing a chip and saving leaves only the remaining address.
  await ccInput(page).fill('');
  await page.getByRole('button', { name: 'Remove accounts@almulla-properties.ae' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/This address will be copied/)).toBeVisible({ timeout: 15_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await expect(page.getByText('leasing@almulla-properties.ae')).toBeVisible();
  await expect(page.getByText('accounts@almulla-properties.ae')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/06-cc-removed.png` });
});
