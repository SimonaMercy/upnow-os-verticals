/**
 * mixed-use-ui-flows.spec.ts
 *
 * BROWSER-DRIVEN UI flows for the Mixed-use VAT/fee work — the things a user
 * actually sees and clicks, which API tests don't exercise:
 *
 *   A. Settings → Rules: the standalone "Mixed-use" fee tab is GONE; only
 *      Residential / Commercial / Industrial / Land remain, with the explainer.
 *   B. Units → Edit unit: the fee amounts AUTO-FILL from the RP's rules resolved
 *      PER UNIT (a commercial unit in a mixed-use building gets the Commercial
 *      rates, a residential unit the Residential rates) AND recompute when the
 *      rent changes — the reported "amounts not auto-filling" bug.
 *   C. New Contract: the read-only "Tax treatment" badge reflects the unit
 *      (office → Commercial · 5% VAT, apartment → Residential · VAT exempt).
 *
 * Auth: registers a fresh RP via the dev OTP flow, approves compliance + verifies
 * email via psql (standard dev bypass), and injects the upnow_token cookie so the
 * browser is authenticated. Data is seeded via the API, then driven through the UI.
 */
import { test, expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const BACKEND = 'http://localhost:3001/api';
const TS = Date.now();
const RP_EMAIL = `rp.muui.${TS}@upnow.ae`;
const RP_PHONE = `+97150${String(TS).slice(-7)}`;
const BUILDING = `UI Mixed Tower ${TS}`;
const APT_NO = `APT-${TS}`;
const OFF_NO = `OFF-${TS}`;

const hdrs = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

function backendDbName(): string {
  try {
    const m = readFileSync(`${process.cwd()}/../upnow-backend/.env`, 'utf8').match(/^DB_NAME=(.+)$/m);
    return m ? m[1].trim() : 'upnow_prod_clone';
  } catch { return 'upnow_prod_clone'; }
}
const DB = backendDbName();

// Distinct rates per category so the UI visibly proves per-unit segregation:
//   commercial admin 2000 / ejari 500 / commission 10%  vs
//   residential admin 1000 / ejari 250 / commission 5%.
function feeRuleSet(commercial: boolean) {
  return [
    { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: commercial ? 500 : 250,  vatApplicable: false, vatRate: 0, isActive: true },
    { feeType: 'admin_fee',        valueType: 'fixed_aed',  value: commercial ? 2000 : 1000, vatApplicable: true,  vatRate: 5, isActive: true },
    { feeType: 'commission',       valueType: 'percentage', value: commercial ? 10 : 5,      vatApplicable: true,  vatRate: 5, isActive: true },
    { feeType: 'security_deposit', valueType: 'percentage', value: commercial ? 10 : 5,      vatApplicable: false, vatRate: 0, isActive: true },
    { feeType: 'rent_vat',         valueType: 'percentage', value: 0, vatApplicable: commercial, vatRate: commercial ? 5 : 0, isActive: true },
  ];
}

let rpToken = '';
let mixedPropId = 0;
let apartmentUnitId = 0;
let officeUnitId = 0;

async function authCookie(context: BrowserContext) {
  await context.addCookies([{ name: 'upnow_token', value: rpToken, url: 'http://localhost:3000' }]);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  // 1. Register + OTP-verify the RP.
  const reg = await request.post(`${BACKEND}/auth/register/rental-provider`, { data: { email: RP_EMAIL, phone: RP_PHONE } });
  expect(reg.status(), `register: ${await reg.text()}`).toBe(201);
  const rb = (await reg.json()) as { access_token: string; devOtp?: string };
  rpToken = rb.access_token;
  if (rb.devOtp) await request.post(`${BACKEND}/auth/otp/verify`, { headers: hdrs(rpToken), data: { code: rb.devOtp } });

  // 2. Minimal profile so the dashboard renders without onboarding nags.
  await request.patch(`${BACKEND}/profiles/rental-provider/me`, {
    headers: hdrs(rpToken),
    data: { entityType: 'company', companyName: `MUUI Estates ${TS}`, contactAddress: 'Downtown, Dubai',
            bankAccountName: 'MUUI LLC', bankIban: 'AE070331234567890000077', tradeLicenseNumber: `TL-MUUI-${TS}`,
            authorizedSignatoryName: 'UI Test Signatory' },
  });

  // 3. Approve compliance + verify email + set a name (standard dev psql bypass).
  execSync(
    `psql ${DB} -c "UPDATE users SET email_verified=true, name='MUUI Test RP' WHERE email='${RP_EMAIL}'; ` +
    `UPDATE rental_providers SET compliance_status='compliant' WHERE user_id=(SELECT id FROM users WHERE email='${RP_EMAIL}')"`,
    { stdio: 'pipe' },
  );

  // 4. Configure Residential + Commercial fee rules (distinct rates).
  for (const [cat, comm] of [['residential', false], ['commercial', true]] as const) {
    const r = await request.put(`${BACKEND}/fee-rules`, { headers: hdrs(rpToken), data: { spaceCategory: cat, rules: feeRuleSet(comm) } });
    expect(r.ok(), `fee-rules ${cat}: ${await r.text()}`).toBeTruthy();
  }

  // 5. Mixed-use building with an apartment + an office (NO stored fees → they
  //    auto-fill from the rules on edit).
  const prop = await request.post(`${BACKEND}/properties`, { headers: hdrs(rpToken), data: { buildingName: BUILDING, spaceCategory: 'mixed_use', fullAddress: 'Downtown, Dubai' } });
  expect(prop.status(), `property: ${await prop.text()}`).toBe(201);
  mixedPropId = ((await prop.json()) as { id: number }).id;

  const apt = await request.post(`${BACKEND}/properties/${mixedPropId}/units`, { headers: hdrs(rpToken), data: { unitNumber: APT_NO, unitType: 'apartment', rentalPrice: 100000, unitSizeSqft: 1000, bedrooms: 2, bathrooms: 2 } });
  expect(apt.status(), `apartment: ${await apt.text()}`).toBe(201);
  apartmentUnitId = ((await apt.json()) as { id: number }).id;

  const off = await request.post(`${BACKEND}/properties/${mixedPropId}/units`, { headers: hdrs(rpToken), data: { unitNumber: OFF_NO, unitType: 'office_fitted', rentalPrice: 200000, unitSizeSqft: 1500, floor: '5' } });
  expect(off.status(), `office: ${await off.text()}`).toBe(201);
  officeUnitId = ((await off.json()) as { id: number }).id;
});

// ─── A. Settings → Rules: no Mixed-use tab ──────────────────────────────────
test('Settings → Rules shows no "Mixed-use" fee tab, only Residential/Commercial/etc + explainer', async ({ page, context }) => {
  await authCookie(context);
  await page.goto('/rental-provider/dashboard/settings');
  await page.getByRole('button', { name: /^Rules$/ }).click();

  // The property-type segmented control: Residential & Commercial present…
  await expect(page.getByRole('button', { name: 'Residential', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Commercial', exact: true })).toBeVisible();
  // …but NO standalone "Mixed-use" tab button.
  await expect(page.getByRole('button', { name: 'Mixed-use', exact: true })).toHaveCount(0);
  // …and the explainer that mixed-use uses these rules per unit.
  await expect(page.getByText(/Mixed-use buildings.*use these rules per unit/i)).toBeVisible();
});

// ─── B. Units → Edit: per-unit auto-fill + recompute on rent change ──────────
test('Units → Edit: a COMMERCIAL unit in a mixed-use building auto-fills Commercial rates and recomputes on rent change', async ({ page, context }) => {
  await authCookie(context);
  await page.goto(`/rental-provider/dashboard/units?propertyId=${mixedPropId}`);

  // Open the OFFICE unit's edit modal — each unit row is a [title="View full unit
  // details"] container holding an "Edit unit" button; scope to the office row.
  const officeRow = page.locator('[title="View full unit details"]').filter({ hasText: OFF_NO });
  await officeRow.first().waitFor({ state: 'visible', timeout: 20000 });
  await officeRow.getByTitle('Edit unit').first().click();

  const rent = page.getByPlaceholder('e.g. 85000');
  const deposit = page.getByPlaceholder('e.g. 10000');
  const admin = page.getByPlaceholder('e.g. 5000');
  const commission = page.getByPlaceholder('e.g. 4000');
  await expect(rent).toBeVisible({ timeout: 10000 });

  // On open: blank fees auto-filled from the COMMERCIAL rules (proves per-unit
  // segregation — this unit lives in a mixed-use building). Stored rent serializes
  // with decimals ("200000.00").
  await expect(rent).toHaveValue(/^200000(\.0+)?$/);
  await expect(admin).toHaveValue('2000');        // commercial admin (fixed)
  await expect(commission).toHaveValue('20000');  // 10% of 200000
  await expect(deposit).toHaveValue('20000');     // 10% of 200000

  // Change the rent → the rule-driven fees recompute (the bug was: they didn't).
  await rent.fill('300000');
  await expect(commission).toHaveValue('30000');  // 10% of 300000
  await expect(deposit).toHaveValue('30000');     // 10% of 300000
  await expect(admin).toHaveValue('2000');         // fixed — unchanged
});

test('Units → Edit: a RESIDENTIAL unit in the SAME building auto-fills Residential rates (different from commercial)', async ({ page, context }) => {
  await authCookie(context);
  await page.goto(`/rental-provider/dashboard/units?propertyId=${mixedPropId}`);

  const aptRow = page.locator('[title="View full unit details"]').filter({ hasText: APT_NO });
  await aptRow.first().waitFor({ state: 'visible', timeout: 20000 });
  await aptRow.getByTitle('Edit unit').first().click();

  const rent = page.getByPlaceholder('e.g. 85000');
  const admin = page.getByPlaceholder('e.g. 5000');
  const commission = page.getByPlaceholder('e.g. 4000');
  await expect(rent).toHaveValue(/^100000(\.0+)?$/, { timeout: 10000 });
  // RESIDENTIAL rates (1000 / 5%) — distinct from the office's commercial 2000 / 10%.
  await expect(admin).toHaveValue('1000');       // residential admin (fixed)
  await expect(commission).toHaveValue('5000');  // 5% of 100000
});

// ─── C. New Contract: per-unit tax-treatment badge ──────────────────────────
test('New Contract: tax-treatment badge reflects the unit (office → Commercial 5%, apartment → Residential exempt)', async ({ page, context }) => {
  await authCookie(context);

  await page.goto(`/rental-provider/dashboard/contracts/new?unitId=${officeUnitId}`);
  await expect(page.getByText(/Commercial · 5% VAT/i)).toBeVisible({ timeout: 20000 });

  await page.goto(`/rental-provider/dashboard/contracts/new?unitId=${apartmentUnitId}`);
  await expect(page.getByText(/Residential · VAT exempt/i)).toBeVisible({ timeout: 20000 });
});
