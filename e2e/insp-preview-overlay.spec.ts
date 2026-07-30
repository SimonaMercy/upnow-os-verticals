/**
 * Preview on the inspection workspace shows the SAME canvas report the customer
 * reads — for the manager, the landlord and the magic-link inspector alike (all
 * three render the one v2 page). Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/preview-shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

async function openPreview(page: Page, url: string, tag: string) {
  // Preview only exists while the report is still open — once the customer has
  // signed, the page itself IS the preview and the button is removed.
  await page.goto(url);
  const btn = page.getByRole('button', { name: /Preview/ });
  await btn.waitFor({ timeout: 40_000 });
  const before = page.context().pages().length;
  await btn.click();
  await page.getByText('Exactly what the customer sees').waitFor({ timeout: 40_000 });
  // The report is rasterised to <canvas>, same as the customer portal. Scope to
  // the overlay — the inspector page has its own signature-pad canvas behind it.
  const overlay = page.locator('div.fixed.inset-0').filter({ hasText: 'Exactly what the customer sees' });
  const canvas = overlay.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(2200);
  const box = await canvas.boundingBox();
  console.log(`[${tag}] canvas ${Math.round(box!.width)}x${Math.round(box!.height)}  newTabs=${page.context().pages().length - before}`);
  expect(page.context().pages().length - before, `${tag}: preview stays in-app`).toBe(0);
  await page.screenshot({ path: `${SHOTS}/preview-${tag}.png` });
}

test('preview overlay: manager, landlord, inspector magic link', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1050 });

  await signIn(page, 'sheco1300@yahoo.com');
  await openPreview(page, '/dashboard/manager/contracts/394/inspection/v2?type=move_out&rp=2', 'manager');

  await signIn(page, 'kbaalfalasi@gmail.com');
  await openPreview(page, '/rental-provider/dashboard/contracts/394/inspection/v2?type=move_out', 'landlord');

  // NOTE: the inspector magic link is scoped to move_in, whose report is already
  // customer-signed — there the page IS the preview and the button is removed by
  // design, so that path is covered by insp-signed-view-countersign.spec.ts.
});
