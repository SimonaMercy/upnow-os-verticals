/**
 * UpNow vertical / subcategory catalog — the single entry point for the 7 verticals and
 * 35 subcategories across marketplace and OS.
 *
 * Declarations (labels, price basis, filters, lead form, lifecycle) come from MarketSpace via
 * `scripts/sync-marketspace-catalog.mjs`. What this file adds is the *backend binding*: which
 * subcategories the production API can actually serve today. Anything without a binding is
 * shown as "Coming soon" — never backed by demo data (owner decision, Oct 2026: only Spaces and
 * Services are integrated until the backend supports the other verticals).
 */
import { MS_VERTICALS } from './marketspace.generated';
import type { MsOffer, MsVertical, MsVerticalId } from './types';
import type { BookingModel } from '@/lib/os/bookings/types';

export type { MsFilterDef, MsLeadField, MsOffer, MsOption, MsVertical, MsVerticalId } from './types';

/**
 * How a subcategory reaches real data.
 *  - `units`:    public unit listings, `GET /listings/units` filtered by `category` (property
 *                spaceCategory) or by one or more `spaceTypes` (unit types from unitTaxonomy).
 *  - `services`: the public service catalog, `GET /catalog/public`, filtered to these category codes.
 *  - `null`:     no backend support yet → Coming soon.
 */
export type BackendBinding =
  | { kind: 'units'; category?: string; spaceTypes?: string[] }
  | { kind: 'services'; categoryCodes: string[] }
  | null;

const BINDINGS: Record<string, BackendBinding> = {
  // Spaces — unit types per src/lib/unitTaxonomy.ts
  'spaces.residential': { kind: 'units', category: 'residential' },
  'spaces.commercial':  { kind: 'units', category: 'commercial' },
  'spaces.industrial':  { kind: 'units', category: 'industrial' },
  'spaces.land':        { kind: 'units', category: 'land' },
  'spaces.holiday':     { kind: 'units', spaceTypes: ['holiday_home'] },
  'spaces.venue':       { kind: 'units', spaceTypes: ['event_hall', 'wedding_venue', 'conference_hall', 'private_dining', 'outdoor_venue'] },
  // spaces.court / spaces.yacht: no unit type exists for courts or vessels yet.

  // Services — category codes from GET /catalog/public (verified against staging, Oct 2026)
  'services.cleaning': { kind: 'services', categoryCodes: ['home_cleaning'] },
  'services.ac':       { kind: 'services', categoryCodes: ['ac_services'] },
  'services.handyman': { kind: 'services', categoryCodes: ['handyman', 'plumbing', 'electrical', 'painting'] },
  // services.haircut / photography / design / makeup: no catalog category yet.
};

/** Verticals the backend supports at all. The rest render as Coming soon end to end. */
export const LIVE_VERTICALS: readonly MsVerticalId[] = ['spaces', 'services'];

export const VERTICALS: readonly MsVertical[] = MS_VERTICALS;
export const VORDER: readonly MsVerticalId[] = MS_VERTICALS.map((v) => v.id);

export const subKey = (vertical: MsVerticalId, offerId: string) => `${vertical}.${offerId}`;

export function verticalOf(id: string): MsVertical | undefined {
  return MS_VERTICALS.find((v) => v.id === id);
}

export function offerOf(vertical: string, offerId: string): MsOffer | undefined {
  return verticalOf(vertical)?.offers.find((o) => o.id === offerId);
}

export function bindingOf(vertical: string, offerId: string): BackendBinding {
  return BINDINGS[`${vertical}.${offerId}`] ?? null;
}

export function isVerticalLive(vertical: string): boolean {
  return (LIVE_VERTICALS as readonly string[]).includes(vertical);
}

export function isOfferLive(vertical: string, offerId: string): boolean {
  return isVerticalLive(vertical) && bindingOf(vertical, offerId) !== null;
}

/**
 * Subcategories that also have PREVIEW listings in the browser-only booking engine
 * (src/lib/os/bookings — short stays, venues, courts, yacht charters; no backend yet).
 * Separate from isOfferLive on purpose: "live" means the production API serves the
 * subcategory; "preview" means demonstration listings bookable at /book (no real payment).
 */
const PREVIEW_MODELS: Record<string, BookingModel> = {
  'spaces.holiday': 'shortstay',
  'spaces.venue': 'venue',
  'spaces.court': 'court',
  'spaces.yacht': 'charter',
};

/** The preview booking model behind a subcategory, or null. */
export function previewModelOf(vertical: string, offerId: string | null | undefined): BookingModel | null {
  return offerId ? PREVIEW_MODELS[`${vertical}.${offerId}`] ?? null : null;
}

/** True when the subcategory has preview (demonstration) listings at /book. */
export function isOfferPreview(vertical: string, offerId: string): boolean {
  return previewModelOf(vertical, offerId) !== null;
}

/** Service catalog codes the marketplace taxonomy claims; anything else is shown as "More services". */
export const MAPPED_SERVICE_CODES: ReadonlySet<string> = new Set(
  Object.values(BINDINGS).flatMap((b) => (b?.kind === 'services' ? b.categoryCodes : [])),
);

export const SUBCATEGORY_COUNT = MS_VERTICALS.reduce((n, v) => n + v.offers.length, 0);
