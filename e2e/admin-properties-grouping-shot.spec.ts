import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// The all-properties browser groups Row and Grid under the owning rental
// provider. Shots cover: groups expanded (Row), collapsed headers only, Grid,
// and the provider filter narrowed to a single RP.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/508ee768-fca6-4f1a-adbe-d3abd9fcd8da/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('properties browser groups by rental provider', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, 'admin@upnow.ae');

  await page.goto('/dashboard/admin/properties');
  await expect(page.getByRole('heading', { name: 'All properties' })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });

  // Every group states its provider — the eyebrow label is the grouping proof.
  const eyebrows = page.getByText('Rental provider', { exact: true });
  const groupCount = await eyebrows.count();
  console.log('provider groups rendered:', groupCount);
  expect(groupCount).toBeGreaterThan(0);

  // Header subtitle must agree with the number of group cards on screen.
  const subtitle = await page.locator('h1 + p').innerText();
  console.log('subtitle:', subtitle);
  expect(subtitle).toMatch(new RegExp(`${groupCount} rental provider`));

  await page.screenshot({ path: `${SHOTS}/properties-row-grouped.png`, fullPage: true });

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await page.screenshot({ path: `${SHOTS}/properties-row-collapsed.png`, fullPage: true });
  await page.getByRole('button', { name: 'Expand all' }).click();

  await page.getByRole('button', { name: 'Grid' }).click();
  await page.screenshot({ path: `${SHOTS}/properties-grid-grouped.png`, fullPage: true });

  // Filtering to one provider leaves exactly one group.
  await page.getByRole('button', { name: 'Row' }).click();
  const select = page.getByLabel('Filter by rental provider');
  const secondValue = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(secondValue!);
  await expect(page.getByText('Rental provider', { exact: true })).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/properties-filtered-one-rp.png`, fullPage: true });

  // Map stays flat, and names the owner in the pin card rather than grouping.
  await select.selectOption('all');
  await page.getByRole('button', { name: 'Map' }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/properties-map.png` });

  await page.locator('[aria-label="Avenue Residence"]').first().click();
  await expect(page.getByText('Rental provider', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/properties-map-pin-card.png` });
});
