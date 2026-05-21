import { test, expect, type APIRequestContext } from '@playwright/test';

const BACKEND = 'http://localhost:3001/api';
const SUPER_ADMIN_EMAIL = 'superadmin@upnow.ae';
const SUPER_ADMIN_PASSWORD = 'ChangeMe2026!';

const TS = Date.now();
const RP_EMAIL = `rp.smoke.${TS}@upnow.ae`;
const TENANT_EMAIL = `tenant.smoke.${TS}@upnow.ae`;
const PASSWORD = 'Test1234!';

async function loginAndGetToken(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${BACKEND}/auth/login`, { data: { email, password } });
  expect(res.ok(), `Login failed for ${email}: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { access_token?: string };
  expect(body.access_token).toBeTruthy();
  return body.access_token as string;
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

test.describe.serial('Smoke: RP -> Tenant -> Viewing -> Contract issue', () => {
  let adminToken = '';
  let rpToken = '';
  let tenantToken = '';

  let rpProfileId = 0;
  let tenantProfileId = 0;
  let propertyId = 0;
  let unitId = 0;
  let leadId = 0;
  let viewingId = 0;
  let contractId = 0;

  test('runs full workflow and validates reflection points', async ({ request, page }) => {
    // 1) Register rental provider and complete profile details (KYC inputs)
    const rpRegister = await request.post(`${BACKEND}/auth/register/rental-provider`, {
      data: { email: RP_EMAIL, password: PASSWORD, phone: '+971501111111' },
    });
    expect(rpRegister.status()).toBe(201);
    rpToken = ((await rpRegister.json()) as { access_token: string }).access_token;
    expect(rpToken).toBeTruthy();

    const rpUpdate = await request.patch(`${BACKEND}/profiles/rental-provider/me`, {
      headers: authHeaders(rpToken),
      data: {
        entityType: 'company',
        companyName: `Smoke Estates ${TS}`,
        contactAddress: 'Business Bay, Dubai, UAE',
        bankAccountName: 'Smoke Estates LLC',
        bankIban: 'AE070331234567890123456',
        tradeLicenseNumber: `TL-${TS}`,
        authorizedSignatoryName: 'Smoke Signatory',
      },
    });
    expect(rpUpdate.ok(), `RP profile update failed: ${rpUpdate.status()}`).toBeTruthy();

    const rpMe = await request.get(`${BACKEND}/profiles/rental-provider/me`, {
      headers: { Authorization: `Bearer ${rpToken}` },
    });
    expect(rpMe.ok()).toBeTruthy();
    const rpMeBody = (await rpMe.json()) as {
      profile: { id: number; companyName: string | null; entityType: string; complianceStatus: string };
    };
    rpProfileId = rpMeBody.profile.id;
    expect(rpMeBody.profile.companyName).toContain('Smoke Estates');
    expect(rpMeBody.profile.entityType).toBe('company');

    // Create a KYC document record (simulates uploaded KYC evidence)
    const rpDoc = await request.post(`${BACKEND}/documents`, {
      headers: authHeaders(rpToken),
      data: {
        ownerType: 'rental_provider',
        ownerId: rpProfileId,
        category: 'identity',
        documentKey: 'emirates_id',
        displayName: 'Emirates ID',
        fileUrl: `http://localhost:3001/uploads/smoke-emirates-id-${TS}.pdf`,
        mimeType: 'application/pdf',
      },
    });
    expect(rpDoc.status()).toBe(201);

    // 2) Admin approves RP KYC/compliance
    adminToken = await loginAndGetToken(request, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);

    const approve = await request.patch(`${BACKEND}/profiles/rental-provider/${rpProfileId}/compliance`, {
      headers: authHeaders(adminToken),
      data: {
        complianceStatus: 'compliant',
        complianceNotes: 'Smoke test approval after details review',
      },
    });
    expect(approve.ok(), `Compliance approve failed: ${approve.status()}`).toBeTruthy();

    const rpKyc = await request.get(`${BACKEND}/profiles/rental-provider/me/kyc-status`, {
      headers: { Authorization: `Bearer ${rpToken}` },
    });
    expect(rpKyc.ok()).toBeTruthy();
    const rpKycBody = (await rpKyc.json()) as { isCompliant?: boolean; complianceStatus?: string };
    expect(rpKycBody.complianceStatus).toBe('compliant');
    expect(rpKycBody.isCompliant).toBe(true);

    // 3) RP lists 1 property and 1 unit, then publishes listing
    const createProperty = await request.post(`${BACKEND}/properties`, {
      headers: authHeaders(rpToken),
      data: {
        buildingName: `Smoke Tower ${TS}`,
        fullAddress: 'Business Bay, Dubai, UAE',
        spaceCategory: 'residential',
        numberOfFloors: '20',
        propertyDescription: 'Smoke test property',
        hasGym: true,
        hasPool: true,
        hasParking: true,
      },
    });
    expect(createProperty.status()).toBe(201);
    const property = (await createProperty.json()) as { id: number; buildingName: string; fullAddress?: string | null };
    propertyId = property.id;

    const createUnit = await request.post(`${BACKEND}/properties/${propertyId}/units`, {
      headers: authHeaders(rpToken),
      data: {
        unitNumber: `U-${TS}`,
        unitName: `Smoke Apt ${TS}`,
        unitType: 'apartment',
        floor: '10',
        bedrooms: 2,
        bathrooms: 2,
        rentalPrice: 8500000,
        availability: 'available',
        description: '2BR smoke test apartment',
      },
    });
    expect(createUnit.status()).toBe(201);
    const unit = (await createUnit.json()) as { id: number; unitName?: string | null; bedrooms?: number | null; rentalPrice?: number | null };
    unitId = unit.id;

    const toggleListing = await request.patch(`${BACKEND}/properties/${propertyId}/units/${unitId}/toggle-listing`, {
      headers: { Authorization: `Bearer ${rpToken}` },
    });
    expect(toggleListing.ok(), `Toggle listing failed: ${toggleListing.status()}`).toBeTruthy();

    // Reflection check #1: backend public listing detail
    const publicUnit = await request.get(`${BACKEND}/listings/units/${unitId}`);
    expect(publicUnit.ok()).toBeTruthy();
    const publicUnitBody = (await publicUnit.json()) as {
      unit: { id: number; unitName?: string | null; bedrooms?: number | null; rentalPrice?: number | string | null; isListed?: boolean };
      property: { buildingName?: string | null; fullAddress?: string | null };
    };
    expect(publicUnitBody.unit.id).toBe(unitId);
    expect(publicUnitBody.unit.unitName).toBe(`Smoke Apt ${TS}`);
    expect(publicUnitBody.unit.bedrooms).toBe(2);
    expect(Number(publicUnitBody.unit.rentalPrice ?? 0)).toBe(8500000);
    expect(publicUnitBody.property.buildingName).toBe(`Smoke Tower ${TS}`);

    // Reflection check #2: frontend listing page loads and shows building/unit info
    await page.goto(`/listings/units/${unitId}`);
    await expect(page.getByText(`Smoke Tower ${TS}`)).toBeVisible();
    await expect(page.getByRole('heading', { name: `Smoke Apt ${TS}` })).toBeVisible();

    // 4) New tenant registers and books viewing
    const tenantRegister = await request.post(`${BACKEND}/auth/register/customer`, {
      data: { email: TENANT_EMAIL, password: PASSWORD, phone: '+971502222222' },
    });
    expect(tenantRegister.status()).toBe(201);
    tenantToken = ((await tenantRegister.json()) as { access_token: string }).access_token;
    expect(tenantToken).toBeTruthy();

    const bookViewing = await request.post(`${BACKEND}/leads/viewings`, {
      headers: authHeaders(tenantToken),
      data: {
        unitId,
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
        notes: 'Tenant wants a quiet building',
        desiredMoveIn: '2026-08-01',
        occupantsAdults: 2,
        occupantsChildren: 1,
        occupantsPets: 0,
        occupantsDetails: 'Couple with one child',
      },
    });
    expect(bookViewing.status()).toBe(201);
    const bookingBody = (await bookViewing.json()) as {
      lead: { id: number; notes?: string | null; convertedTenantId?: number };
      viewing: { id: number; status: string; notes?: string | null };
    };
    leadId = bookingBody.lead.id;
    viewingId = bookingBody.viewing.id;
    tenantProfileId = Number(bookingBody.lead.convertedTenantId);

    expect(bookingBody.viewing.status).toBe('scheduled');
    expect(bookingBody.viewing.notes ?? '').toContain('Occupants: 2 adults, 1 child, 0 pets');

    // 5) RP completes viewing
    const completeViewing = await request.patch(`${BACKEND}/leads/viewings/${viewingId}/status`, {
      headers: authHeaders(rpToken),
      data: { status: 'completed', notes: 'Viewing completed successfully' },
    });
    expect(completeViewing.ok(), `Complete viewing failed: ${completeViewing.status()}`).toBeTruthy();

    const myViewings = await request.get(`${BACKEND}/leads/my-viewings`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect(myViewings.ok()).toBeTruthy();
    const viewings = (await myViewings.json()) as Array<{ id: number; status: string }>;
    const updatedViewing = viewings.find((v) => v.id === viewingId);
    expect(updatedViewing?.status).toBe('completed');

    // 6) Tenant applies after viewing
    const apply = await request.post(`${BACKEND}/leads/my-viewings/${viewingId}/apply`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect(apply.ok(), `Apply failed: ${apply.status()}`).toBeTruthy();

    // 7) RP issues contract
    const startDate = '2026-08-01';
    const endDate = '2027-07-31';
    const createContract = await request.post(`${BACKEND}/contracts`, {
      headers: authHeaders(rpToken),
      data: {
        unitId,
        tenantId: tenantProfileId,
        contractStartDate: startDate,
        contractEndDate: endDate,
        annualRent: 8500000,
        securityDepositAmount: 500000,
        numberOfInstallments: 4,
        modeOfPayment: 'cheque',
        adminFee: 5000,
        ejariFee: 220,
        notes: `Created from smoke lead ${leadId}`,
      },
    });
    expect(createContract.status()).toBe(201);
    const contractBody = (await createContract.json()) as { id: number; status?: string };
    contractId = contractBody.id;

    const issue = await request.patch(`${BACKEND}/contracts/${contractId}/issue`, {
      headers: { Authorization: `Bearer ${rpToken}` },
    });
    expect(issue.ok(), `Issue contract failed: ${issue.status()}`).toBeTruthy();
    const issueBody = (await issue.json()) as { id: number; status: string; contractSent: boolean };
    expect(issueBody.status).toBe('issued');
    expect(issueBody.contractSent).toBe(true);

    const tenantContracts = await request.get(`${BACKEND}/contracts/tenant`, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
    expect(tenantContracts.ok()).toBeTruthy();
    const contracts = (await tenantContracts.json()) as Array<{ id: number; status: string; unit?: { id?: number | null } }>;
    const matched = contracts.find((c) => c.id === contractId);
    expect(matched).toBeTruthy();
    expect(matched?.status).toBe('issued');
    expect(matched?.unit?.id).toBe(unitId);
  });
});
