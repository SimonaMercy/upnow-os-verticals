/**
 * E2E — a COMPANY customer's tenancy journey asks for COMPANY paperwork.
 *
 * Regression for the bug where a company tenant was shown the individual pack:
 * "Personal details / filled from your Emirates ID", Emirates ID + Passport as
 * the required trio, and Employment Letter / Bank Statement / Marriage
 * Certificate as supporting docs — with nothing about the company at all.
 *
 * A company must see: its own name + trade licence, the company's licence pack,
 * and the identity of the AUTHORISED SIGNATORY (not "your" Emirates ID).
 *
 * Needs a customer whose tenant profile is entity_type = 'company' with a lead;
 * override with E2E_COMPANY_CUSTOMER / E2E_COMPANY_SPACE.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const CUSTOMER_EMAIL = process.env.E2E_COMPANY_CUSTOMER ?? 'upnow@mailinator.com';
const SPACE_KEY = process.env.E2E_COMPANY_SPACE ?? 'v-55';
const SHOTS = 'test-results/company-journey';

async function loginAs(page: Page, request: APIRequestContext, email: string): Promise<string> {
  const r1 = await request.post(`${BACKEND}/auth/login`, { data: { email } });
  expect(r1.ok(), `OTP step-1 for ${email}: ${r1.status()}`).toBeTruthy();
  const otp = ((await r1.json()) as { devOtp?: string }).devOtp;
  expect(otp, 'devOtp missing — backend must be non-production').toBeTruthy();
  const r2 = await request.post(`${BACKEND}/auth/login/verify-otp`, { data: { identifier: email, code: otp } });
  const token = ((await r2.json()) as { access_token: string }).access_token;
  await page.context().addCookies([{ name: 'upnow_token', value: token, domain: 'localhost', path: '/' }]);
  return token;
}

test.describe('Company customer — documents step', () => {
  test('asks for the company + its signatory, never personal-only paperwork', async ({ page, request }) => {
    const token = await loginAs(page, request, CUSTOMER_EMAIL);

    // The profile really is a company — otherwise this test proves nothing.
    const me = await (await request.get(`${BACKEND}/documents/my`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json() as { entityType?: string; companyName?: string | null };
    expect(me.entityType, 'fixture customer must be a company').toBe('company');

    await page.goto(`/dashboard/customer/spaces/v2/${SPACE_KEY}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 1 · The tenancy is named after the COMPANY, with its trade licence.
    const companyCard = page.getByTestId('company-details');
    await expect(companyCard).toBeVisible({ timeout: 15_000 });
    await expect(companyCard).toContainText('Company details');
    await expect(companyCard).toContainText(/Trade licence no/i);
    // Issuing authority is a picker of UAE authorities by their short code —
    // not free text that every customer spells differently.
    const authority = companyCard.locator('select');
    await expect(authority).toBeVisible();
    await expect(authority.locator('optgroup')).toHaveCount(4);
    // Options are SHORT CODES — a native select is as wide as its longest
    // option, so full authority names would push the field off its column.
    await expect(authority.locator('option', { hasText: /^DED Dubai$/ })).toHaveCount(1);
    const longest = Math.max(...(await authority.locator('option').allInnerTexts()).map(t => t.length));
    expect(longest, 'option labels must stay short').toBeLessThan(20);
    // …and the field itself never spills out of the card.
    const cardBox = await companyCard.boundingBox();
    const selBox = await authority.boundingBox();
    expect(selBox!.x + selBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    // The name may be a read-only chip (complete profile) or a prefilled input
    // (licence still missing) — accept either.
    if (me.companyName) {
      const input = companyCard.locator('input').first();
      if (await input.count()) await expect(input).toHaveValue(me.companyName);
      else await expect(companyCard).toContainText(me.companyName);
    }
    await page.screenshot({ path: `${SHOTS}/01-company-details.png` });

    // 2 · No personal-details card: the tenancy is with the COMPANY, and the
    //     person signing is captured by their Signatory Emirates ID upload.
    await expect(page.getByTestId('personal-details')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/Filled automatically from your Emirates ID/i);

    // 3 · The document pack is the company's.
    const body = page.locator('body');
    await expect(body).toContainText(/Company & signatory documents/i);
    await expect(body).toContainText('Trade License');
    await expect(body).toContainText(/Signatory Emirates ID — Front/i);
    await expect(body).toContainText(/MOA \/ Establishment Card/i);

    // 4 · …and never the individual-only rows.
    await expect(body).not.toContainText(/Marriage Certificate/i);
    await expect(body).not.toContainText(/Employment \/ Salary Certificate/i);
    await expect(body).not.toContainText(/Bank Statement \/ Pay Slip/i);

    await page.getByText(/Company & signatory documents/i).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/02-company-documents.png` });
  });
});
