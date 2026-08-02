/**
 * Manager Operations 363 — the header chain (property → unit) and the info-bar
 * customer must be real links on the manager side too, each landing on the
 * manager's own landlord-scoped page. Untracked; mirrored to the scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/bdf32fd5-ecfb-459c-879b-574b01cb2cd7/scratchpad/ops-links';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

test('manager ops 363 — property / unit / customer are clickable', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'sheco1300@yahoo.com');
  await page.goto('/dashboard/manager/operations/363?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);

  const propertyLink = page.locator('.hsub a.chain-link').first();
  const unitLink = page.locator('.hsub a.chain-link').nth(1);
  const customerLink = page.locator('.infobar a.chain-link[title="Open customer details"]').first();

  await expect(propertyLink).toBeVisible();
  await expect(unitLink).toBeVisible();
  await expect(customerLink).toBeVisible();

  const propertyHref = await propertyLink.getAttribute('href');
  const unitHref = await unitLink.getAttribute('href');
  const customerHref = await customerLink.getAttribute('href');
  console.log({ propertyHref, unitHref, customerHref });

  expect(propertyHref).toMatch(/^\/dashboard\/manager\/properties\?rp=\d+&property=\d+$/);
  expect(unitHref).toMatch(/^\/dashboard\/manager\/units\?rp=\d+&q=.+$/);
  expect(customerHref).toMatch(/^\/dashboard\/manager\/tenants\/\d+\?rp=\d+$/);

  await page.screenshot({ path: `${SHOTS}/ops-363-header.png`, clip: { x: 0, y: 0, width: 1500, height: 420 } });

  // Each destination must actually render its target, not a permission wall.
  await page.goto(propertyHref!);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/dest-property.png`, fullPage: false });

  await page.goto(unitHref!);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/dest-unit.png`, fullPage: false });

  await page.goto(customerHref!);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/dest-customer.png`, fullPage: false });
});
