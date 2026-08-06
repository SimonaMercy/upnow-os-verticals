import type { EjariContractData } from '@/components/contract/EjariContractPdf';

/**
 * Map the RP-side contract detail (`GET /api/contracts/:id`) + its separate
 * signatures into the shared EjariContractData the contract renderer expects.
 * Shared by the print page and the documents binder so the rendered Agreement
 * is identical everywhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toEjari(c: any, signatures: any[]): EjariContractData {
  return {
    ref: c.ref,
    startDate: c.startDate,
    endDate: c.endDate,
    createdAt: c.createdAt,
    annualRent: c.annualRent,
    contractValue: c.contractValue ?? null,
    listedRent: c.listedRent ?? null,
    discountType: c.discountType ?? null,
    discountAmount: c.discountAmount ?? null,
    // Effective held deposit (chain-resolved on renewals) → falls back to the field.
    securityDepositAmount: c.securityDepositHeld ?? c.securityDepositAmount ?? null,
    modeOfPayment: c.modeOfPayment ?? null,
    utilityAccountNumber: c.utilityAccountNumber ?? null,
    numberOfInstallments: c.numberOfInstallments ?? null,
    customClauses: c.customClauses ?? [],
    notes: c.notes ?? null,
    landlord: {
      name: c.landlord?.name ?? null,
      bankAccountName: c.landlord?.bankAccountName ?? null,
      email: c.landlord?.email ?? null,
      phone: c.landlord?.phone ?? null,
      entityType: c.landlord?.entityType ?? null,
      companyName: c.landlord?.companyName ?? null,
      nationality: c.landlord?.nationality ?? null,
      emiratesId: c.landlord?.emiratesId ?? null,
      licenseNumber: c.landlord?.licenseNumber ?? null,
      licenseAuthority: c.landlord?.licenseAuthority ?? null,
      // Power of Attorney: when set, the POA holder's phone is shown as the lessor's.
      hasPoa: c.landlord?.hasPoa ?? null,
      poaPersonName: c.landlord?.poaPersonName ?? null,
      poaPersonPhone: c.landlord?.poaPersonPhone ?? null,
    },
    tenant: {
      name: c.tenant?.name ?? null,
      email: c.tenant?.email ?? null,
      phone: c.tenant?.phone ?? null,
      companyName: c.tenant?.companyName ?? null,
      nationality: c.tenant?.nationality ?? null,
      passportNumber: c.tenant?.passportNumber ?? null,
      emiratesId: c.tenant?.emiratesId ?? null,
      licenseNumber: c.tenant?.licenseNumber ?? null,
      licenseAuthority: c.tenant?.licenseAuthority ?? null,
    },
    property: {
      buildingName: c.property?.buildingName ?? null,
      fullAddress: c.property?.fullAddress ?? null,
      community: c.property?.community ?? null,
      emirate: c.property?.emirate ?? null,
      city: c.property?.city ?? null,
      subCommunity: c.property?.subCommunity ?? null,
      plotNumber: c.property?.plotNumber ?? null,
      makaniNumber: c.property?.makaniNumber ?? null,
      sewerageNumber: c.property?.sewerageNumber ?? null,
      premisesNumber: c.property?.premisesNumber ?? null,
      spaceCategory: c.property?.spaceCategory ?? null,
    },
    unit: {
      number: c.unit?.number ?? null,
      name: c.unit?.name ?? null,
      type: c.unit?.type ?? null,
      floor: c.unit?.floor ?? null,
      sizeSqm: c.unit?.sizeSqm ?? null,
      dewaPremiseNumber: c.unit?.dewaPremiseNumber ?? null,
      sewerageNumber: c.unit?.sewerageNumber ?? null,
      bedrooms: c.unit?.bedrooms ?? null,
    },
    signatures: (Array.isArray(signatures) ? signatures : []).map((s) => ({
      role: s.role,
      signatureImage: s.signatureImage ?? null,
      signedAt: s.signedAt,
      method: s.method,
    })),
  };
}
