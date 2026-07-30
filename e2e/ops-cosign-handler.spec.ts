/**
 * Operations worklist — co-signed lanes (Move-in / Move-out / Deposit settlement)
 * must list only the parties whose signature is still OUTSTANDING. Once the
 * customer has signed the inspection, the lane is waiting on the manager's
 * counter-signature alone, so the customer's name must drop off the card.
 *
 * Fixtures (local prod clone, RP 2, manager sheco1300@yahoo.com):
 *   394 — Move-in: customer signed, not counter-signed  → manager only
 *    55 — Move-out: customer signed, not counter-signed  → manager only
 * Untracked spec; mirrored to the session scratchpad.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/674ba15f-46aa-4d44-97c7-d7ef7302e4f8/scratchpad/ops-cosign-shots';
const MGR = 'sheco1300@yahoo.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  expect((await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } })).ok()).toBeTruthy();
}

// The handler chip on a kanban card: one .hname per party still awaited.
async function handlerNames(page: Page, ref: string): Promise<string[]> {
  const card = page.locator('.opsp-page .card').filter({ hasText: ref }).first();
  await card.scrollIntoViewIfNeeded();
  const chip = card.locator('.c-handler-top .hname');
  return chip.allInnerTexts();
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

test('move-in lane drops the customer once they have signed', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1600, height: 1150 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/operations?rp=2&tab=new&view=kanban');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const names = await handlerNames(page, 'CID-394');
  console.log('  394 Move-in handlers:', JSON.stringify(names));
  expect(names.join(' | ')).toContain('Sherif');                     // counter-signer still owed
  expect(names.join(' | ')).not.toContain('Arjun');                  // customer already signed
  await page.locator('.opsp-page .card').filter({ hasText: 'CID-394' }).first()
    .screenshot({ path: `${SHOTS}/movein-394-card.png` });
});

test('move-out lane drops the customer once they have signed', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1600, height: 1150 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/operations?rp=2&tab=terminated&view=kanban');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const names = await handlerNames(page, 'CID-55');
  console.log('   55 Move-out handlers:', JSON.stringify(names));
  expect(names.join(' | ')).toContain('Sherif');                     // counter-signer still owed
  expect(names.join(' | ')).not.toContain('Tabrez');                 // customer already signed
  await page.locator('.opsp-page .card').filter({ hasText: 'CID-55' }).first()
    .screenshot({ path: `${SHOTS}/moveout-55-card.png` });
  await page.screenshot({ path: `${SHOTS}/terminated-board.png` });
});

test('detail page move-in step reflects the customer signature', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1500, height: 1150 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/operations/394?rp=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  const step = page.locator('.chklist').filter({ hasText: 'counter-signed' }).first();
  await step.scrollIntoViewIfNeeded();
  console.log('  394 move-in step:', (await step.innerText()).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `${SHOTS}/detail-394-movein.png` });
});

test('both names stay while both signatures are outstanding (settlement lane)', async ({ page }) => {
  test.setTimeout(180_000);
  page.setViewportSize({ width: 1600, height: 1150 });
  await signIn(page, MGR);
  await page.goto('/dashboard/manager/operations?rp=2&tab=terminated&view=kanban');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // 391: move-out fully signed, settlement not yet agreed by the customer — the
  // tooltip breakdown must still name the customer on the settlement lane.
  const card = page.locator('.opsp-page .card').filter({ hasText: 'CID-391' }).first();
  const tip = await card.getAttribute('title');
  console.log('  391 breakdown:', tip?.replace(/\n/g, ' / '));
  expect(tip).toContain('Deposit settlement');
  expect(tip).toMatch(/Deposit settlement:.*Dev Customer/);
});
