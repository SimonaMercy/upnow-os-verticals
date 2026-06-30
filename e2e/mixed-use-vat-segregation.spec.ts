/**
 * mixed-use-vat-segregation.spec.ts
 *
 * End-to-end proof of the Mixed-use VAT/fee SEGREGATION, cross-checked against the
 * money rules in docs/PAYMENTS_REFERENCE.md.
 *
 * The bug it guards: a `mixed_use` property holds BOTH residential and commercial
 * units, but VAT/fees used to resolve from the single property-level
 * space_category — so every unit in the building got one blanket rate. The fix
 * resolves the EFFECTIVE category PER UNIT (effectiveSpaceCategory), so a
 * residential unit is rent-VAT-EXEMPT and a commercial unit carries 5% — in the
 * SAME building.
 *
 * Cross-references (PAYMENTS_REFERENCE.md):
 *   §3.4  Rent VAT is two-part: contracts.rent_vat_rate (%) + payments.vat_amount
 *         per cheque; annual_rent is NET.
 *   §1    payments.amount_paid is GROSS (net + VAT); the serializer exposes it as
 *         `amount`, with `vatAmount` the embedded VAT portion.
 *   §2    getContractById returns rent rows in `payments[]` (rental_income).
 *
 * API-driven (no browser/seed dependency): registers a fresh RP via the dev OTP
 * flow, configures its Residential + Commercial fee rules, builds a mixed-use
 * building with one apartment + one office, issues a contract for each, and
 * asserts the VAT each cheque carries.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const BACKEND = 'http://localhost:3001/api';
const TS = Date.now();

/** The DB the running backend is bound to (read from upnow-backend/.env) so the
 *  psql compliance-bypass targets the same database. Defaults to the dev clone. */
function backendDbName(): string {
  try {
    const m = readFileSync(`${process.cwd()}/../upnow-backend/.env`, 'utf8').match(/^DB_NAME=(.+)$/m);
    return m ? m[1].trim() : 'upnow_prod_clone';
  } catch { return 'upnow_prod_clone'; }
}
const DB = backendDbName();
const RP_EMAIL = `rp.mixeduse.${TS}@upnow.ae`;
const RP_PHONE = `+97150${String(TS).slice(-7)}`;
const TENANT_EMAIL = `tenant.mixeduse.${TS}@upnow.ae`;

const hdrs = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** Register an RP, verify its OTP, then mark it compliant directly in the DB —
 *  write actions (fee-rules, properties, units, contracts) are gated until the
 *  rental account is verified. The psql bypass is the standard dev approach
 *  (mirrors full-ui-workflow.spec). Returns the RP access token. */
async function registerAndApproveRp(request: APIRequestContext): Promise<string> {
  const reg = await request.post(`${BACKEND}/auth/register/rental-provider`, {
    data: { email: RP_EMAIL, phone: RP_PHONE },
  });
  expect(reg.status(), `RP register: ${await reg.text()}`).toBe(201);
  const body = (await reg.json()) as { access_token: string; devOtp?: string };
  const token = body.access_token;
  if (body.devOtp) {
    await request.post(`${BACKEND}/auth/otp/verify`, { headers: hdrs(token), data: { code: body.devOtp } });
  }
  // Approve compliance so the backend's verification gate lets writes through.
  execSync(
    `psql ${DB} -c "UPDATE rental_providers SET compliance_status='compliant' ` +
    `WHERE user_id=(SELECT id FROM users WHERE email='${RP_EMAIL}')"`,
    { stdio: 'pipe' },
  );
  return token;
}

/** Full per-category fee-rule set; rent VAT applicable only when asked (commercial). */
function feeRuleSet(rentVatApplicable: boolean) {
  return [
    { feeType: 'ejari_fee',        valueType: 'fixed_aed',  value: 250,  vatApplicable: false, vatRate: 0, isActive: true },
    { feeType: 'admin_fee',        valueType: 'fixed_aed',  value: 1000, vatApplicable: true,  vatRate: 5, isActive: true },
    { feeType: 'commission',       valueType: 'percentage', value: 5,    vatApplicable: true,  vatRate: 5, isActive: true },
    { feeType: 'security_deposit', valueType: 'percentage', value: 5,    vatApplicable: false, vatRate: 0, isActive: true },
    { feeType: 'rent_vat',         valueType: 'percentage', value: 0,    vatApplicable: rentVatApplicable, vatRate: rentVatApplicable ? 5 : 0, isActive: true },
  ];
}

let rpToken: string;
let tenantId: number;
let mixedPropId: number;
let apartmentUnitId: number;
let officeUnitId: number;
// Fetched contracts (created once in beforeAll to avoid overlap-guard collisions).
let aptContract: any;
let officeContract: any;

const rentRows = (c: any) => (c.payments as any[]).filter((p) => p.paymentType === 'rental_income');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  rpToken = await registerAndApproveRp(request);

  // 1. Configure the RP's Residential (rent VAT exempt) + Commercial (5%) rules.
  for (const [cat, vat] of [['residential', false], ['commercial', true]] as const) {
    const r = await request.put(`${BACKEND}/fee-rules`, {
      headers: hdrs(rpToken),
      data: { spaceCategory: cat, rules: feeRuleSet(vat) },
    });
    expect(r.ok(), `fee-rules ${cat}: ${await r.text()}`).toBeTruthy();
  }

  // 2. A MIXED-USE building.
  const prop = await request.post(`${BACKEND}/properties`, {
    headers: hdrs(rpToken),
    data: { buildingName: `Mixed Tower ${TS}`, spaceCategory: 'mixed_use', fullAddress: 'Downtown, Dubai' },
  });
  expect(prop.status(), `property: ${await prop.text()}`).toBe(201);
  mixedPropId = ((await prop.json()) as { id: number }).id;

  // 3a. A RESIDENTIAL unit (apartment) in that mixed-use building.
  const apt = await request.post(`${BACKEND}/properties/${mixedPropId}/units`, {
    headers: hdrs(rpToken),
    data: { unitNumber: `APT-${TS}`, unitType: 'apartment', rentalPrice: 100000, unitSizeSqft: 1000, bedrooms: 2, bathrooms: 2 },
  });
  expect(apt.status(), `apartment: ${await apt.text()}`).toBe(201);
  apartmentUnitId = ((await apt.json()) as { id: number }).id;

  // 3b. A COMMERCIAL unit (fitted office) in the SAME mixed-use building.
  const off = await request.post(`${BACKEND}/properties/${mixedPropId}/units`, {
    headers: hdrs(rpToken),
    data: { unitNumber: `OFF-${TS}`, unitType: 'office_fitted', rentalPrice: 200000, unitSizeSqft: 1500, floor: '5' },
  });
  expect(off.status(), `office: ${await off.text()}`).toBe(201);
  officeUnitId = ((await off.json()) as { id: number }).id;

  // 4. A customer to issue both contracts to.
  const ten = await request.post(`${BACKEND}/contracts/tenants`, {
    headers: hdrs(rpToken),
    data: { name: 'Mixed Use Tenant', email: TENANT_EMAIL },
  });
  expect(ten.ok(), `tenant: ${await ten.text()}`).toBeTruthy();
  tenantId = ((await ten.json()) as { tenantId: number }).tenantId;

  // 5. Issue a contract for each unit (4 equal rent cheques over a 1-year term).
  const makeContract = async (unitId: number, annualRent: number) => {
    const res = await request.post(`${BACKEND}/contracts`, {
      headers: hdrs(rpToken),
      data: {
        unitId, tenantId,
        contractStartDate: '2027-01-01', contractEndDate: '2027-12-31',
        annualRent, numberOfInstallments: 4, modeOfPayment: 'cheque',
      },
    });
    expect(res.ok(), `create contract unit ${unitId}: ${await res.text()}`).toBeTruthy();
    const id = ((await res.json()) as { id: number }).id;
    const get = await request.get(`${BACKEND}/contracts/${id}`, { headers: hdrs(rpToken) });
    expect(get.ok(), `get contract ${id}`).toBeTruthy();
    return await get.json();
  };
  aptContract = await makeContract(apartmentUnitId, 100000);
  officeContract = await makeContract(officeUnitId, 200000);
});

test('residential unit in a mixed-use building → rent VAT EXEMPT (0%)', () => {
  // effectiveSpaceCategory(apartment) = residential → exempt.
  expect(Number(aptContract.rentVatRate)).toBe(0);
  expect(Number(aptContract.annualRent)).toBe(100000); // PAYMENTS_REFERENCE §3.4 — annual_rent is NET

  const rent = rentRows(aptContract);
  expect(rent.length).toBe(4);
  for (const r of rent) {
    expect(Number(r.vatAmount)).toBe(0);   // no VAT
    expect(Number(r.amount)).toBe(25000);  // 100000 / 4 — gross == net when exempt
  }
});

test('commercial unit in the SAME mixed-use building → 5% rent VAT on every cheque', () => {
  // effectiveSpaceCategory(office_fitted) = commercial → 5%.
  expect(Number(officeContract.rentVatRate)).toBe(5);
  expect(Number(officeContract.annualRent)).toBe(200000); // annual_rent stays NET (§3.4)

  const rent = rentRows(officeContract);
  expect(rent.length).toBe(4);
  for (const r of rent) {
    // net per cheque = 200000 / 4 = 50000; VAT = 50000 × 5% = 2500.
    expect(Number(r.vatAmount)).toBe(2500);
    // amount_paid is GROSS = net + VAT (PAYMENTS_REFERENCE §1).
    expect(Number(r.amount)).toBe(52500);
  }
});

test('the reported bug is fixed: two units in ONE building get DIFFERENT tax classes', () => {
  // Both units belong to the SAME mixed-use building (mixedPropId), with the same
  // RP and the same fee-rule config — yet the residential unit is exempt and the
  // commercial unit is taxed. This is exactly what the single property-level
  // space_category could NOT express (it would force one rate on both).
  expect(mixedPropId).toBeTruthy();
  expect(Number(aptContract.rentVatRate)).toBe(0);   // residential → exempt
  expect(Number(officeContract.rentVatRate)).toBe(5); // commercial → 5%
  expect(Number(aptContract.rentVatRate)).not.toBe(Number(officeContract.rentVatRate));
  // And the per-cheque VAT differs in lock-step (0 vs 2500 on each cheque).
  expect(rentRows(aptContract).every((r) => Number(r.vatAmount) === 0)).toBe(true);
  expect(rentRows(officeContract).every((r) => Number(r.vatAmount) === 2500)).toBe(true);
});

test('VAT reconciliation: gross − vat == net, and Σvat == annual_rent × rate (§3.4)', () => {
  for (const c of [aptContract, officeContract]) {
    const rate = Number(c.rentVatRate);
    const rent = rentRows(c);
    const grossTotal = rent.reduce((s, r) => s + Number(r.amount), 0);
    const vatTotal = rent.reduce((s, r) => s + Number(r.vatAmount), 0);
    const netTotal = grossTotal - vatTotal;
    // Net collected over the schedule reconciles to the NET annual rent.
    expect(netTotal).toBe(Number(c.annualRent));
    // VAT collected reconciles to annual_rent × rate.
    expect(vatTotal).toBe(Math.round((Number(c.annualRent) * rate) / 100));
    // Per-row: gross − vat is the net cheque, never negative.
    for (const r of rent) expect(Number(r.amount) - Number(r.vatAmount)).toBeGreaterThan(0);
  }
});
