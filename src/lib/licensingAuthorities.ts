/**
 * UAE trade-licensing authorities — shared option list for company KYC.
 *
 * Used to populate "License Authority" dropdowns (e.g. company tenants) so the
 * value stored on the profile is consistent and matches what the tenancy /
 * Ejari contract prints as the licensing authority. Mirrors the list used on
 * the RP profile page; "Other" lets a free-zone outside the list be recorded.
 */
export const LICENSING_AUTHORITIES = [
  'DED Dubai',
  'Abu Dhabi Department of Economic Development',
  'Sharjah Economic Development Department',
  'Ajman Department of Economic Development',
  'Ras Al Khaimah Economic Zone (RAKEZ)',
  'Fujairah Free Zone',
  'Umm Al Quwain DED',
  'DIFC (Dubai International Financial Centre)',
  'ADGM (Abu Dhabi Global Market)',
  'JAFZA (Jebel Ali Free Zone)',
  'DMCC (Dubai Multi Commodities Centre)',
  'Dubai Silicon Oasis Authority',
  'Dubai Airport Free Zone (DAFZA)',
  'Abu Dhabi Free Zone Authority (ADFZA)',
  'Sharjah Free Zone Authority (SHAMS)',
  'Other',
] as const;

export type LicensingAuthority = (typeof LICENSING_AUTHORITIES)[number];
