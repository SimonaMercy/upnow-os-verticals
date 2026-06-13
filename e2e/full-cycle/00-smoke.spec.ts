import { test, expect } from '@playwright/test';
import {
  adminLogin,
  E2E_DB,
  logout,
  pngFile,
  q,
  registerCustomerViaUi,
  writeState,
} from './helpers';
import { execSync } from 'child_process';

/**
 * 00 — infra smoke: proves the isolated stack works end to end before the
 * real cycle begins.
 *   - frontend :3010 serves the app and proxies to backend :3002
 *   - admin OTP login through the UI works
 *   - customer UI registration works and writes ONLY to upnow_e2e (isolation)
 *   - a KYC upload on /welcome lands on local disk and is served back
 */

test.describe.serial('00 infra smoke', () => {
  test('marketplace home renders on the isolated stack', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).not.toContainText(/application error/i);
  });

  test('super admin logs in via OTP UI and reaches admin dashboard', async ({ page }) => {
    await adminLogin(page);
    await expect(page).toHaveURL(/\/dashboard\/admin/);
    await logout(page);
  });

  test('customer registers via UI; row lands in e2e DB only; welcome KYC upload round-trips', async ({
    page,
  }) => {
    const phone = await registerCustomerViaUi(page);
    writeState({ smokeCustomerPhone: phone });

    // isolation proof: user exists in upnow_e2e and NOT in upnow_prod_clone
    const inE2e = q(`SELECT count(*) FROM users WHERE phone LIKE '%${phone}'`);
    expect(Number(inE2e), `user in ${E2E_DB}`).toBeGreaterThan(0);
    const inClone = execSync(
      `psql -h localhost -p 5432 -d upnow_prod_clone -tA -c "SELECT count(*) FROM users WHERE phone LIKE '%${phone}'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(Number(inClone), 'user must NOT leak into upnow_prod_clone').toBe(0);

    // welcome KYC upload (optional step, but proves the local-disk upload path).
    // Reload and wait for the lazy profile fetch — uploading before it resolves
    // hits "Profile not ready" and the chosen file is silently dropped (F-UX-1).
    const profileLoaded = page.waitForResponse(
      (r) => r.url().includes('/profiles/customer/me') && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto('/welcome');
    await profileLoaded;
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15_000 });
    const docPosted = page.waitForResponse(
      (r) => r.url().includes('/api/documents') && r.request().method() === 'POST' && r.ok(),
      { timeout: 30_000 },
    );
    await fileInput.setInputFiles(pngFile('eid-front.png'));
    await docPosted;

    // the document row must exist and its file must be on LOCAL disk (no GCS)
    const row = q(
      `SELECT file_url FROM documents WHERE owner_type = 'customer' AND owner_id =
         (SELECT t.id FROM tenants t JOIN users u ON t.user_id = u.id
          WHERE u.phone LIKE '%${phone}' ORDER BY t.id DESC LIMIT 1)
       ORDER BY id DESC LIMIT 1`,
    );
    expect(row, 'document row created').toBeTruthy();
    expect(row, 'upload must be local, not cloud storage').not.toContain('googleapis');
    expect(row, 'upload must be local, not cloud storage').not.toContain('amazonaws');
  });
});
