/**
 * UAE trade-licence issuing authorities.
 *
 * Stored on the tenant / rental-provider profile as the SHORT CODE (e.g.
 * "DED Dubai", "DMCC") — that's what appears on the licence itself and what the
 * Ejari / contract paperwork quotes. The long name is only ever a label, so the
 * picker reads clearly without bloating the stored value.
 *
 * Free text was the previous behaviour; `authorityLabel` keeps any legacy value
 * displayable, and the picker offers "Other" so an authority not listed here
 * (new free zone, offshore registrar) can still be typed in.
 */

export interface LicenseAuthority {
  /** Stored value — the short code as printed on the licence. */
  code: string;
  /** Full name, shown beside the code in the picker. */
  name: string;
  /** Grouping in the dropdown. */
  group: 'Mainland (DED)' | 'Dubai free zones' | 'Abu Dhabi free zones' | 'Other emirates';
}

export const LICENSE_AUTHORITIES: LicenseAuthority[] = [
  // ── Mainland — one economic department per emirate ────────────────────────
  { code: 'DED Dubai',      name: 'Dubai Department of Economy & Tourism',       group: 'Mainland (DED)' },
  { code: 'DED Abu Dhabi',  name: 'Abu Dhabi Department of Economic Development', group: 'Mainland (DED)' },
  { code: 'DED Sharjah',    name: 'Sharjah Economic Development Department',      group: 'Mainland (DED)' },
  { code: 'DED Ajman',      name: 'Ajman Department of Economic Development',     group: 'Mainland (DED)' },
  { code: 'DED RAK',        name: 'Ras Al Khaimah Department of Economic Development', group: 'Mainland (DED)' },
  { code: 'DED Fujairah',   name: 'Fujairah Department of Industry & Economy',    group: 'Mainland (DED)' },
  { code: 'DED UAQ',        name: 'Umm Al Quwain Department of Economic Development', group: 'Mainland (DED)' },

  // ── Dubai free zones ──────────────────────────────────────────────────────
  { code: 'DMCC',   name: 'Dubai Multi Commodities Centre',   group: 'Dubai free zones' },
  { code: 'JAFZA',  name: 'Jebel Ali Free Zone Authority',    group: 'Dubai free zones' },
  { code: 'DAFZA',  name: 'Dubai Airport Free Zone Authority', group: 'Dubai free zones' },
  { code: 'DIFC',   name: 'Dubai International Financial Centre', group: 'Dubai free zones' },
  { code: 'IFZA',   name: 'International Free Zone Authority', group: 'Dubai free zones' },
  { code: 'DSO',    name: 'Dubai Silicon Oasis Authority',    group: 'Dubai free zones' },
  { code: 'DWC',    name: 'Dubai World Central',              group: 'Dubai free zones' },
  { code: 'Meydan', name: 'Meydan Free Zone',                 group: 'Dubai free zones' },
  { code: 'DHCC',   name: 'Dubai Healthcare City',            group: 'Dubai free zones' },
  { code: 'DDA',    name: 'Dubai Development Authority (Media / Internet City)', group: 'Dubai free zones' },

  // ── Abu Dhabi free zones ──────────────────────────────────────────────────
  { code: 'ADGM',      name: 'Abu Dhabi Global Market',        group: 'Abu Dhabi free zones' },
  { code: 'KEZAD',     name: 'Khalifa Economic Zones Abu Dhabi', group: 'Abu Dhabi free zones' },
  { code: 'Masdar',    name: 'Masdar City Free Zone',          group: 'Abu Dhabi free zones' },
  { code: 'twofour54', name: 'Media Zone Authority — twofour54', group: 'Abu Dhabi free zones' },

  // ── Other emirates ────────────────────────────────────────────────────────
  { code: 'SHAMS',     name: 'Sharjah Media City',                    group: 'Other emirates' },
  { code: 'SAIF Zone', name: 'Sharjah Airport International Free Zone', group: 'Other emirates' },
  { code: 'HFZA',      name: 'Hamriyah Free Zone Authority',          group: 'Other emirates' },
  { code: 'SPC',       name: 'Sharjah Publishing City',               group: 'Other emirates' },
  { code: 'RAKEZ',     name: 'Ras Al Khaimah Economic Zone',          group: 'Other emirates' },
  { code: 'RAK ICC',   name: 'RAK International Corporate Centre',    group: 'Other emirates' },
  { code: 'AFZ',       name: 'Ajman Free Zone',                       group: 'Other emirates' },
  { code: 'UAQ FTZ',   name: 'Umm Al Quwain Free Trade Zone',         group: 'Other emirates' },
  { code: 'FFZ',       name: 'Fujairah Free Zone',                    group: 'Other emirates' },
  { code: 'Creative City', name: 'Fujairah Creative City',            group: 'Other emirates' },
];

export const LICENSE_AUTHORITY_GROUPS = [
  'Mainland (DED)', 'Dubai free zones', 'Abu Dhabi free zones', 'Other emirates',
] as const;

/** Options grouped for a native <optgroup> select. */
export function licenseAuthorityGroups(): { group: string; items: LicenseAuthority[] }[] {
  return LICENSE_AUTHORITY_GROUPS.map(group => ({
    group,
    items: LICENSE_AUTHORITIES.filter(a => a.group === group),
  }));
}

/** True when the stored value is one of the known codes (so the picker can tell
 *  a listed authority from a legacy free-text one and fall back to "Other"). */
export function isKnownAuthority(value?: string | null): boolean {
  const v = (value ?? '').trim();
  return !!v && LICENSE_AUTHORITIES.some(a => a.code === v);
}

/** "DED Dubai — Dubai Department of Economy & Tourism", or the raw value for a
 *  legacy / free-text authority. */
export function authorityLabel(value?: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  const hit = LICENSE_AUTHORITIES.find(a => a.code === v);
  return hit ? `${hit.code} — ${hit.name}` : v;
}
