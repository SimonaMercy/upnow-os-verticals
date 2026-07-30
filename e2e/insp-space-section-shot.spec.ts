/**
 * Customer space v-62 — locate the move-in "Inspection report" summary section.
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

for (const email of ['tttt@mailinator.com', 'dev@upnow.ae']) {
  test(`space v-62 as ${email}`, async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    page.setViewportSize({ width: 1400, height: 1400 });
    await signIn(page, email);
    await page.goto('/dashboard/customer/spaces/v2/v-62');
    await page.waitForLoadState('networkidle');
    const hit = await page.getByText('Inspection report', { exact: true }).count();
    console.log(`${email}: "Inspection report" headings = ${hit}`);
    if (hit) await page.getByText('Inspection report', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/space-v62-${email.split('@')[0]}.png`, fullPage: false });
  });
}
