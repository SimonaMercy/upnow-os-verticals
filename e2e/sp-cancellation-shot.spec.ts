import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// SP-135 / SP-138 — visual check of the new admin surfaces: the platform
// cancellation card (editable tiers, grace, fee recipient) and the booking
// drill-down's Cancel & refund panel with its policy preview.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/b4b37c3d-de90-4219-afd9-f8632a63e10d/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('admin cancellation card + drill-down cancel panel', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1400 });
  await signIn(page, 'admin@upnow.ae');

  await page.goto('/dashboard/admin/catalog', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const head = page.getByText('Launch & cancellation', { exact: true }).first();
  await expect(head).toBeVisible();
  const card = head.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await card.screenshot({ path: `${SHOTS}/01-admin-cancellation-card.png` });
  await expect(page.getByText('Retained fee goes to')).toBeVisible();

  // Booking 2 exists on the clone (completed) — panel hidden; booking 1 is
  // cancelled after the earlier drive. Use whichever shows the header; the
  // panel button only appears on cancellable statuses, so also assert that.
  await page.goto('/dashboard/admin/operations/2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/02-admin-drilldown-completed.png`, fullPage: false });
  await expect(page.getByRole('button', { name: /Cancel & refund/ })).toHaveCount(0);
});
