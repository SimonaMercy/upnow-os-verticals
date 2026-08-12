import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';

/**
 * RP settings — the landlord's own documents (KYC Documents card + the
 * Authorized Signatory & Power of Attorney card) can be saved as clean files.
 * Uploads a POA deed if the slot is empty, then asserts each Download button
 * really calls documents/:id/download and the browser saves a file.
 */
const SHOTS = '/private/tmp/claude-501/-Users-muhammadzeeshan-Documents-UpNow-Business-Decision-Reports/f6f6b690-796a-42cd-a3e1-dec492e21a2e/scratchpad/shots-poa';
const RP_EMAIL = 'kbaalfalasi@gmail.com'; // rental_providers.id = 2 — has_poa = true

// Smallest thing a PDF reader will accept — enough to upload and download back.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  const s = await page.request.post('/api/auth/login', { data: { email } });
  const { devOtp } = (await s.json()) as { devOtp?: string };
  const v = await page.request.post('/api/auth/login/verify-otp', { data: { identifier: email, code: devOtp } });
  expect(v.ok()).toBeTruthy();
}

test('RP settings — KYC + POA documents are downloadable', async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  page.setViewportSize({ width: 1500, height: 1100 });
  await signIn(page, RP_EMAIL);

  await page.goto('/rental-provider/dashboard/settings', { waitUntil: 'networkidle' });
  const poaCard = page.locator('form').filter({ hasText: 'Authorized Signatory & Power of Attorney' });
  await expect(poaCard).toBeVisible();
  await poaCard.scrollIntoViewIfNeeded();
  // Innermost div holding the deed's row (the outer ones wrap the whole pack).
  const poaRow = poaCard.locator('div', { has: page.getByText('Power of Attorney (POA)', { exact: true }) }).last();
  await expect(poaRow).toBeVisible({ timeout: 15_000 });

  // Put a deed on file if the slot is empty — a download needs a document id.
  if (await poaCard.getByTitle('Download Power of Attorney (POA)').count() === 0) {
    await poaRow.getByRole('button', { name: /Upload|Replace/ }).click();
    await poaCard.locator('input[type=file]').setInputFiles({ name: 'poa-deed.pdf', mimeType: 'application/pdf', buffer: PDF });
  }

  const downloadBtn = poaCard.getByTitle('Download Power of Attorney (POA)');
  await expect(downloadBtn).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/01-poa-row-download.png` });

  // It hits the authorised endpoint and the browser actually saves a file.
  const [apiRes, download] = await Promise.all([
    page.waitForResponse(r => /\/api\/documents\/\d+\/download/.test(r.url())),
    page.waitForEvent('download'),
    downloadBtn.click(),
  ]);
  expect(apiRes.status()).toBe(200);
  expect(await download.failure()).toBeNull();
  await download.saveAs(`${SHOTS}/poa-downloaded.pdf`);
  expect(fs.statSync(`${SHOTS}/poa-downloaded.pdf`).size).toBeGreaterThan(0);

  // Same button inside the in-screen viewer.
  await poaRow.getByRole('button', { name: 'View', exact: true }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.getByTitle('Download Power of Attorney (POA)')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-poa-viewer-download.png` });
  await page.keyboard.press('Escape');

  // The KYC Documents card above offers the same download on every doc on file.
  const kycCard = page.locator('div.bg-white').filter({ hasText: 'Upload your identity and licensing documents' }).last();
  const kycDownloads = kycCard.getByRole('button', { name: /^⬇ Download$/ });
  expect(await kycDownloads.count()).toBeGreaterThan(0);
  const [kycRes, kycFile] = await Promise.all([
    page.waitForResponse(r => /\/api\/documents\/\d+\/download/.test(r.url())),
    page.waitForEvent('download'),
    kycDownloads.first().click(),
  ]);
  expect(kycRes.status()).toBe(200);
  expect(await kycFile.failure()).toBeNull();
  await page.screenshot({ path: `${SHOTS}/03-kyc-downloads.png`, fullPage: true });
});
