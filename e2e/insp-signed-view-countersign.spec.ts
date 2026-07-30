/**
 * Once the CUSTOMER has signed, the inspection workspace shows the finished
 * report as the customer reads it (canvas) and offers the counter-signature —
 * on the inspector magic link AND in the manager dashboard.
 * Read-only: does NOT actually counter-sign 394. Untracked; mirrored to scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/3267b0f4-3e06-4294-bf84-7f64a4d7c790/scratchpad/preview-shots';
const INSPECTOR_TOKEN = '1412547ae69dcf87424027c7727b267a59c69d2f02c0b3ab';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

async function assertSignedView(page: Page, url: string, tag: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(2200);
  const box = await canvas.boundingBox();
  // The editable workspace must be gone — its inputs/Add-category chrome too.
  const addCat = await page.getByRole('button', { name: /Add Additional Category/i }).count();
  const signBtn = page.getByRole('button', { name: /Sign inspection/i });
  const hasSign = await signBtn.count();
  console.log(`[${tag}] canvas ${Math.round(box!.width)}x${Math.round(box!.height)} · editable-chrome=${addCat} · counter-sign btn=${hasSign}`);
  expect(addCat, `${tag}: no editable chrome once signed`).toBe(0);
  expect(hasSign, `${tag}: counter-sign available`).toBeGreaterThan(0);
  await signBtn.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/signed-${tag}.png` });
}

test('signed inspection: customer view + counter-sign, both actors', async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 1000 });

  await signIn(page, 'sheco1300@yahoo.com');
  await assertSignedView(page, '/dashboard/manager/contracts/394/inspection/v2?type=move_in&rp=2', 'manager');

  await page.context().clearCookies();
  await assertSignedView(page, `/portal/${INSPECTOR_TOKEN}/contract/394/inspection?type=move_in`, 'inspector-magiclink');
});

test('authenticated counter-sign endpoint: authorized + sequence-guarded', async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  const s = await ctx.post('http://localhost:3000/api/auth/login', { data: { email: 'sheco1300@yahoo.com' } });
  const { devOtp } = await s.json() as { devOtp?: string };
  await ctx.post('http://localhost:3000/api/auth/login/verify-otp', { data: { identifier: 'sheco1300@yahoo.com', code: devOtp } });

  // 359 is NOT customer-signed → the shared sequence guard must reject, which
  // proves the route exists and the manager passed authz (not 401/403/404).
  const r = await ctx.post('http://localhost:3000/api/contracts/359/inspection/counter-sign', {
    data: { type: 'move_in', signatureImage: 'data:image/png;base64,iVBORw0KGgo=', signatoryName: 'Sherif Mohamed Atef', consent: true },
  });
  const body = await r.json();
  console.log('counter-sign on unsigned 359 →', r.status(), JSON.stringify(body.message));
  expect(r.status()).toBe(400);
  expect(String(body.message)).toMatch(/submitted|sign/i);
  await ctx.dispose();
});
