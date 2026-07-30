/**
 * Request Termination opens a dialog that must sit ON TOP of the page. It is
 * triggered from inside the sticky payment-summary rail, which establishes its own
 * stacking context — before the Modal was portalled to <body>, the tenancy pass
 * painted straight over the dialog.
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

test('termination dialog renders above the page', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page, 'tttt@mailinator.com');
  await page.goto('/dashboard/customer/spaces/v2/c-394');
  await page.getByText('Payment summary').waitFor({ timeout: 60_000 });

  await page.getByRole('button', { name: /Request Termination/i }).click();
  const dialog = page.getByRole('heading', { name: 'Request early termination' });
  await expect(dialog).toBeVisible();

  // Portalled out of the sticky rail, and the palette rides along so every
  // var(--…) border / background / button colour still resolves.
  const styling = await page.evaluate(() => {
    const host = [...document.body.children].find(el => el.textContent?.includes('Request early termination'));
    if (!host) return null;
    const overlay = host.querySelector('div') as HTMLElement | null;
    const card = overlay?.firstElementChild as HTMLElement | null;
    const header = card?.firstElementChild as HTMLElement | null;
    const footer = card?.lastElementChild as HTMLElement | null;
    const cs = (el: HTMLElement | null | undefined) => (el ? getComputedStyle(el) : null);
    return {
      portalled: host.parentElement === document.body,
      overlayPosition: cs(overlay)?.position ?? null,
      cardBg: cs(card)?.backgroundColor ?? null,
      headerBorder: cs(header)?.borderBottomColor ?? null,
      footerBorder: cs(footer)?.borderTopColor ?? null,
    };
  });
  console.log('modal styling:', JSON.stringify(styling));
  expect(styling?.portalled, 'overlay is a direct child of <body>').toBeTruthy();
  expect(styling?.overlayPosition).toBe('fixed');
  // Palette resolved: the card is white and the header/footer rules are visible.
  expect(styling?.cardBg).toBe('rgb(255, 255, 255)');
  expect(styling?.headerBorder).toBe('rgb(232, 230, 224)');
  expect(styling?.footerBorder).toBe('rgb(232, 230, 224)');
  // The primary action is present and painted (it is var(--brick) on the danger path).
  const send = page.getByRole('button', { name: /Send request/i });
  await expect(send).toBeVisible();
  const sendBg = await send.evaluate(el => getComputedStyle(el).backgroundColor);
  console.log('send button bg:', sendBg);
  expect(sendBg).toBe('rgb(200, 73, 44)');

  // Nothing paints over the dialog: the element at the dialog's centre is inside it.
  const box = (await dialog.boundingBox())!;
  const onTop = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest('h3')?.textContent ?? el?.textContent?.slice(0, 40) ?? null;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  console.log('topmost element at dialog centre:', JSON.stringify(onTop));
  expect(onTop).toContain('Request early termination');

  await page.screenshot({ path: `${SHOTS}/termination-modal.png`, fullPage: false });
});
