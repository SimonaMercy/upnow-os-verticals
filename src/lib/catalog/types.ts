/** Shapes of the MarketSpace declarations synced into marketspace.generated.ts. */

export type MsVerticalId =
  | 'spaces' | 'services' | 'experiences' | 'memberships' | 'programs' | 'health' | 'insurance';

export interface MsOption { v: string; l: string }

export interface MsFilterDef {
  id: string;
  /** select | multi | toggle | date | range | seg */
  type: string;
  label: string;
  options: MsOption[];
  unit: string | null;
  required: boolean;
  many: boolean;
  /** Listing attribute the filter reads, when it differs from `id`. */
  field: string | null;
}

export interface MsLeadField {
  key: string;
  label: string;
  /** date | seg | chips | select | text | num */
  type: string;
  options: string[];
}

export interface MsOffer {
  id: string;
  label: string;
  icon: string | null;
  h1: string;
  short: string | null;
  sub: string | null;
  /** Price basis as shown to customers, e.g. "AED / year or month". */
  basis: string | null;
  /** Primary call to action, e.g. "Request a viewing". */
  action: string | null;
  /** Declared customer lifecycle (next steps). Empty = not yet specified. */
  flow: string[];
  providerTypes: string[];
  /** Filter ids shown in the search bar; the rest are optional filters. */
  searchFields: string[];
  permit: string | null;
  flags: { lease: boolean; perSqft: boolean; people: boolean; coverage: boolean; late: boolean };
  images: string[];
  leadForm: MsLeadField[];
  filters: MsFilterDef[];
}

export interface MsVertical {
  id: MsVerticalId;
  label: string;
  icon: string;
  blurb: string;
  offers: MsOffer[];
}
