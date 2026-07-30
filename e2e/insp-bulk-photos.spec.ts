/**
 * Bulk photo upload on the move-in / move-out inspection form: the manager /
 * landlord / inspector picks MANY images at once instead of attaching them row
 * by row. Uploads 3 images, checks they persist across a reload.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/preview-shots';
const TMP = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/imgs';

// 1×1 PNGs, three distinct colours.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

test('bulk photo upload on the inspection form', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const files = ['a.png', 'b.png', 'c.png'].map((n) => { const f = `${TMP}/${n}`; fs.writeFileSync(f, PNG); return f; });

  page.setViewportSize({ width: 1400, height: 1000 });
  await signIn(page, 'sheco1300@yahoo.com');
  // move_out on 394 is still an open draft, so the editable form renders.
  await page.goto('/dashboard/manager/contracts/394/inspection/v2?type=move_out&rp=2');
  const box = page.getByRole('button', { name: 'Add photos' });
  await box.waitFor({ timeout: 40_000 });
  console.log('bulk box:', (await box.innerText()).trim());

  // ONE picker call carrying all three files = the bulk path.
  await page.locator('input[type="file"][multiple]').last().setInputFiles(files);
  await expect(page.getByText(/^Photos \(3\)$/)).toBeVisible({ timeout: 60_000 });
  console.log('after upload heading:', await page.getByText(/^Photos \(\d+\)$/).innerText());
  await page.getByText(/^Photos \(3\)$/).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/bulk-photos.png` });

  // Persisted? Reload and count again.
  await page.reload();
  await expect(page.getByText(/^Photos \(3\)$/)).toBeVisible({ timeout: 60_000 });
  const thumbs = await page.locator('img').count();
  console.log('after reload: heading =', await page.getByText(/^Photos \(\d+\)$/).innerText(), '· imgs on page =', thumbs);
});
