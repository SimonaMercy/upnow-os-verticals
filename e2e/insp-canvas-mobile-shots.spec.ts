/**
 * The inspection report must render as ONE scaled document (pdf.js canvas), the
 * same way the tenancy contract does — not a responsive HTML layout that reflows
 * on a phone. Checked on the customer preview and the magic-link portal, at both
 * a phone and a desktop viewport.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/760e5977-65d7-446a-94a2-29b4c6412acf/scratchpad/insp-compare';
// Move-in magic link for contract 394 (tenant signer) — the inspection review surface.
const PORTAL = '39dd4af6870cce1ca5aa463de71b5a913934df569fcd4406';
const IPHONE = { width: 390, height: 844 };

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const start = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await start.json()) as { devOtp?: string };
  const verify = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(verify.ok(), `signed in as ${email}`).toBeTruthy();
}

/** The document is drawn onto <canvas>; wait for one with real pixels. */
async function waitForDocCanvas(page: Page) {
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 200 && c.height > 200;
  }, undefined, { timeout: 90_000 });
  return page.locator('canvas').first();
}

test('customer inspection renders as a document canvas (mobile + desktop)', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await signIn(page, 'tttt@mailinator.com');

  for (const [label, vp] of [['mobile', IPHONE], ['desktop', { width: 1400, height: 1000 }]] as const) {
    await page.setViewportSize(vp);
    await page.goto('/dashboard/customer/contracts/394/inspection?type=move_in');
    const canvas = await waitForDocCanvas(page);
    const box = (await canvas.boundingBox())!;
    console.log(`customer ${label}: canvas ${Math.round(box.width)}x${Math.round(box.height)} (viewport ${vp.width})`);
    // Fit-to-width: the page never overflows horizontally.
    expect(box.width).toBeLessThanOrEqual(vp.width);
    // A4 portrait aspect (~1.414) — proves it's the document, not a reflowed layout.
    expect(box.height / box.width).toBeGreaterThan(1.3);
    expect(box.height / box.width).toBeLessThan(1.55);
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollW, 'no horizontal page scroll').toBeLessThanOrEqual(vp.width + 1);
    await page.screenshot({ path: `${SHOTS}/canvas-customer-${label}.png`, fullPage: false });
  }

  // The report itself is now ONLY the canvas document — no HTML report table.
  await expect(page.getByText('Component Inspection Details')).toHaveCount(0);
  // Signing lives in its own card below the document (or its signed confirmation).
  const signCard = page.getByRole('heading', { name: 'Your Signature' });
  const signedNote = page.getByText(/You have signed|Both parties have signed/);
  expect(await signCard.count() + await signedNote.count(),
    'signing card or signed confirmation below the document').toBeGreaterThan(0);
});

test('magic-link portal renders the inspection as a document canvas (mobile)', async ({ page }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize(IPHONE);
  await page.goto(`/portal/${PORTAL}/contract/394`);
  const canvas = await waitForDocCanvas(page);
  const box = (await canvas.boundingBox())!;
  console.log(`portal mobile: canvas ${Math.round(box.width)}x${Math.round(box.height)}`);
  expect(box.width).toBeLessThanOrEqual(IPHONE.width);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW, 'no horizontal page scroll').toBeLessThanOrEqual(IPHONE.width + 1);
  await page.screenshot({ path: `${SHOTS}/canvas-portal-mobile.png`, fullPage: false });
});
