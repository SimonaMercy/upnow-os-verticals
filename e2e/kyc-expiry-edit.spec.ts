/**
 * Regression: editing a KYC expiry date on the RP customer detail page
 * (/rental-provider/dashboard/tenants/19) used to save on EVERY segment the
 * native date input emitted, and each save called the page's `load()` — which
 * flipped `loading` and swapped the whole page for "Loading customer…", tearing
 * the popup down mid-edit. The date could never be changed.
 *
 * Runs against the local prod clone (customer 19 / RP 2); it restores the date it
 * changes, so the clone is left as it was found. Not part of CI.
 */
import { test, expect, Page } from '@playwright/test';

const RP_EMAIL = 'kbaalfalasi@gmail.com';   // RP 2 — owns customer 19

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', {
    data: { identifier: email, code: devOtp },
  });
  expect(verify.ok(), 'signed in').toBeTruthy();
}

test('RP customer KYC — expiry date can be edited without the page refreshing under it', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1400, height: 1200 });

  await signIn(page, RP_EMAIL);
  await page.goto('/rental-provider/dashboard/tenants/19');
  await page.getByText('Supporting Documents').first().waitFor({ timeout: 60_000 });

  // Passport carries an expiry, so its button opens the slot popup.
  const row = page.getByText('Passport', { exact: true }).first()
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  await row.scrollIntoViewIfNeeded();
  await row.getByRole('button', { name: /Replace|Upload/ }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const input = dialog.locator('input[type="date"]');
  await expect(input).toBeVisible();
  const original = await input.inputValue();

  // Type the new date the way a person does — segment by segment. Every one of
  // these keystrokes fired a save before the fix.
  await input.click();
  await input.pressSequentially('14/03/2029', { delay: 120 });   // dd/mm/yyyy segments

  // The popup survives the edit and the page never drops to its loading state.
  await expect(page.getByText('Loading customer…')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('2029-03-14');

  // It lands on the server (debounce + the silent refresh behind the popup).
  await page.waitForTimeout(2500);
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('2029-03-14');

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Reopen: the new date is what comes back, not the old one.
  await row.getByRole('button', { name: /Replace|Upload/ }).first().click();
  await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue('2029-03-14');

  // Put it back so the local clone is unchanged. Typed, not filled — a direct
  // value assignment bypasses React's value tracker and the edit never registers.
  const [y, m, d] = original.split('-');
  const reopened = page.getByRole('dialog').locator('input[type="date"]');
  await reopened.click();
  await reopened.pressSequentially(`${d}/${m}/${y}`, { delay: 120 });
  await expect(reopened).toHaveValue(original);
  await page.waitForTimeout(1500);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.reload();
  await row.getByRole('button', { name: /Replace|Upload/ }).first().click();
  await expect(page.getByRole('dialog').locator('input[type="date"]')).toHaveValue(original);
});
