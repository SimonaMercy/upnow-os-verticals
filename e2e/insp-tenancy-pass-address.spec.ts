/**
 * Customer space → Tenancy Pass: the location line under "Unit <n>" must show a
 * real address (Community, Emirate — else the property's street address), not the
 * bare em dash it printed when the contract list omitted community/emirate.
 *
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

for (const key of ['v-62', 'c-394']) {
  test(`tenancy pass shows the address on ${key}`, async ({ page }) => {
    test.setTimeout(180_000);
    fs.mkdirSync(SHOTS, { recursive: true });
    page.setViewportSize({ width: 1400, height: 1100 });
    await signIn(page, 'tttt@mailinator.com');
    await page.goto(`/dashboard/customer/spaces/v2/${key}`);
    await page.getByText('Unit 317').first().waitFor({ timeout: 60_000 });

    // The location line sits directly under "Unit <n>", beside the map pin:
    // "Community, Emirate" when known, else the property's street address.
    const loc = page.getByText(/al raffa/i).first();
    await expect(loc).toBeVisible();
    console.log(`${key} location line:`, JSON.stringify((await loc.innerText()).trim()));
    await page.screenshot({ path: `${SHOTS}/tenancy-pass-${key}.png`, fullPage: false });
  });
}
