import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

// Property management is parked for the next development cycle, so the "Property
// management" leasing model is hidden from the add & edit property form. A
// building already saved as managed must still show it, so an edit can't
// silently reclassify the record.
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/fe2215ba-1d5e-4a25-9712-2345b5b9b210/scratchpad/shots';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('add & edit property hide the Property management leasing model', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1200 });
  await signIn(page, 'kbaalfalasi@gmail.com');

  const res = await page.request.get('/api/properties');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const props = (body.properties ?? body) as Array<{ id: number; buildingName: string; leasingType: string | null }>;
  console.log('PROPS', props.map(p => `${p.id}|${p.buildingName}|${p.leasingType ?? 'direct'}`).join('\n'));

  // ── Add ──────────────────────────────────────────────────────────────────
  await page.goto('/rental-provider/dashboard/portfolio?add=1');
  await expect(page.getByText('Leasing model')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Direct lease/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sub-lease/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Property management/ })).toHaveCount(0);
  await page.getByText('Leasing model').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/property-add-leasing.png`, fullPage: false });

  // ── Edit, a normal (non-managed) building ────────────────────────────────
  const plain = props.find(p => (p.leasingType ?? 'direct') !== 'management');
  expect(plain, 'need a non-managed property').toBeTruthy();
  await page.goto('/rental-provider/dashboard/portfolio');
  // Card → details popup → Edit, the route a user actually takes.
  await page.getByText(plain!.buildingName.trim(), { exact: false }).first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByText('Edit Property', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Direct lease/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sub-lease/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Property management/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Direct lease/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/property-edit-leasing.png`, fullPage: false });

  const managed = props.find(p => p.leasingType === 'management');
  console.log('MANAGED-FIXTURE', managed ? `${managed.id} ${managed.buildingName}` : 'none in this DB');

  // ── Edit, a building already classified as managed ───────────────────────
  // No managed building exists in this DB, so the list response is stubbed
  // rather than the dev data mutated. A managed record must still show its own
  // option, so editing one can't silently reclassify it as direct.
  await page.route(u => new URL(u).pathname === '/api/properties', async route => {
    const r = await route.fetch();
    const j = await r.json();
    const list = (j.properties ?? j) as Array<Record<string, unknown>>;
    if (list[0]) list[0].leasingType = 'management';
    await route.fulfill({ response: r, json: j });
  });
  await page.goto('/rental-provider/dashboard/portfolio');
  await page.getByText(String(props[0].buildingName).trim(), { exact: false }).first().click();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByText('Edit Property', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: /Property management/ })).toBeVisible();
  await page.getByRole('button', { name: /Direct lease/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/property-edit-leasing-legacy-managed.png`, fullPage: false });
});
