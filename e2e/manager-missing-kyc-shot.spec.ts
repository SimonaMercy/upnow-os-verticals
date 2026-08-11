/**
 * Manager dashboard → the "Missing KYC documents" card.
 *
 * The WHOLE checklist gap — mandatory and optional — for customers living in a
 * unit today. Asserts the card matches the API bucket exactly (so it can never
 * quietly drift from the query), that mandatory and optional rows read
 * differently, and that a row lands ON the upload control for the document it
 * names rather than on the customer page.
 *
 * Untracked; mirrored to the session scratchpad.
 */
import { test, expect, type Page } from '@playwright/test';

const SHOTS = 'e2e/__shots__/manager-missing-kyc';
const MANAGER = 'sheco1300@yahoo.com';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('Missing KYC documents card mirrors the API bucket', async ({ page }) => {
  test.setTimeout(180_000); // the row-by-row check walks the whole bucket
  await signIn(page, MANAGER);

  const api = await page.request.get('/api/manager/action-center?days=90&rp=2');
  const { docsMissing } = (await api.json()) as {
    docsMissing: {
      count: number;
      items: { tenant: string; docName: string; tenantId: number; required: boolean; reqKey: string }[];
    };
  };
  expect(docsMissing.count, 'fixture must have something to show').toBeGreaterThan(0);
  // Both weights are represented, or the assertions below prove nothing.
  expect(docsMissing.items.some(i => i.required)).toBeTruthy();
  expect(docsMissing.items.some(i => !i.required)).toBeTruthy();

  await page.goto('/dashboard/manager?rp=2', { waitUntil: 'networkidle' });
  const card = page.locator('div.bg-white.rounded-2xl').filter({ hasText: /Missing KYC documents/ }).last();
  await expect(card).toBeVisible();

  // The count in the header, one group per customer, one row per document.
  expect(Number((await card.locator('> div').first().innerText()).split('\n').pop())).toBe(docsMissing.count);
  const rows = card.locator('.mgr-bucket-list a');
  expect(await rows.count()).toBe(docsMissing.count);
  for (const [i, item] of docsMissing.items.entries()) {
    await expect(rows.nth(i)).toContainText(item.docName);
    await expect(rows.nth(i)).toContainText(item.required ? 'Required · upload' : 'Optional · upload');
    // The row carries the requirement, so the page opens on its upload control.
    expect(await rows.nth(i).getAttribute('href'))
      .toContain(`/dashboard/manager/tenants/${item.tenantId}`);
    expect(await rows.nth(i).getAttribute('href')).toContain(`kyc=${item.reqKey}`);
  }
  await expect(card.locator('.mgr-bucket-list div.sticky').first())
    .toContainText(docsMissing.items[0].tenant);

  await card.screenshot({ path: `${SHOTS}/missing-kyc-card.png` });

  // Following a row opens the upload popup for exactly that document.
  const first = docsMissing.items[0];
  await page.goto(`/dashboard/manager/tenants/${first.tenantId}?rp=2&kyc=${first.reqKey}`);
  const dialog = page.getByRole('heading', { name: new RegExp(`^Upload ${first.docName}`) });
  await expect(dialog).toBeVisible({ timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/kyc-upload-deeplink.png` });
});
