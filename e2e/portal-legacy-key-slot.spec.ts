/**
 * The external upload link must not ask for a document the customer already has.
 *
 * The renewal link asks for `uae_visa`; an imported customer's visa is filed under
 * `visa`. Matching on the canonical key alone missed it, so the request created an
 * empty `uae_visa` placeholder and the link read "UAE Visa / Residency — Required"
 * over a visa the landlord had already approved.
 *
 * Read-only against the live link. Untracked; mirrored to the session scratchpad.
 */
import { test, expect } from '@playwright/test';

const TOKEN = '32cd2204dbd7732c37cdff41d8fc65c4400bd8c389b1c5ab';
const SHOTS = 'e2e/__shots__/renewal-docs';

test('every already-provided document reads as uploaded, not required', async ({ page }) => {
  await page.goto(`http://localhost:3000/portal/${TOKEN}`);
  await expect(page.getByText('Requested documents')).toBeVisible({ timeout: 20000 });

  // All four are on file, so the counter must be complete and nothing amber.
  await expect(page.getByText('4/4 required')).toBeVisible();
  await expect(page.getByText('Required', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Uploaded', { exact: true })).toHaveCount(4);
  // One visa row, not the on-file one plus an empty duplicate slot.
  await expect(page.getByText('UAE Visa / Residency')).toHaveCount(1);

  await page.screenshot({ path: `${SHOTS}/5-portal-link.png`, fullPage: true });
});
