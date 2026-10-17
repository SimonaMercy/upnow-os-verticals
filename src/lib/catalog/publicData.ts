/**
 * Real public marketplace data for the catalog's live subcategories.
 *
 * Reads only existing public endpoints through the same-origin /api proxy:
 *   GET /listings/units     — published units (Spaces)
 *   GET /catalog/public     — admin-configured service catalog (Services)
 *   GET /locations/emirates, /locations/emirates/:id/communities, /listings/locations
 * Nothing here falls back to demo data: an empty or failed response renders an empty state.
 */
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { serviceFallbackImg, serviceImg } from '@/lib/serviceImages';
import { isQuoteMode } from '@/lib/homeServices/statusView';
import { calloutCopy } from '@/lib/homeServices/copy';
import type { BackendBinding } from './index';

/** One marketplace card, whatever it came from. */
export interface MarketCard {
  key: string;
  title: string;
  meta: string;
  price: string;
  per: string;
  img: string | null;
  /** Shown if `img` fails to load (local /marketspace image), before the icon placeholder. */
  fallback?: string | null;
  badge?: string;
  href: string;
}

// ---- units ------------------------------------------------------------------

interface ListingItem {
  unit: {
    id: number; propertyId?: number | null; planLabel?: string | null; unitName: string | null; unitType: string | null; bedrooms: number | null;
    unitSizeSqft: number | string | null; rentalPrice: number | string | null; facilities?: string | null;
  };
  property: {
    buildingName: string | null; fullAddress: string | null; spaceCategory?: string | null;
    emirate?: { nameEn: string } | null; community?: { nameEn: string } | null;
  };
  coverPhotoUrl: string | null;
}

/** GET /listings/units returns rent as an AED decimal string (e.g. "60000.00"), not fils. */
function rentLabel(val: number | string | null | undefined): string {
  if (val == null || val === '') return 'Price on request';
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 'Price on request';
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(n);
}

function rentPer(facilities: string | null | undefined): string {
  try {
    const t = facilities ? JSON.parse(facilities)?.leaseTerms?.rentalType : null;
    if (t === 'monthly') return '/month';
    if (t === 'daily' || t === 'nightly') return '/night';
  } catch { /* malformed facilities JSON — fall through */ }
  return '/year';
}

/**
 * Picture for a unit that has no uploaded photo. Same category gallery the unit detail page
 * (src/app/listings/units/[id]/ListingPageClient.tsx, CATEGORY_IMAGES) shows for a unit without
 * media, so the card matches what the visitor sees on click. Rotated by unit id for variety.
 */
const UNSPLASH = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=70&auto=format&fit=crop`;
const UNIT_STOCK: Record<string, string[]> = {
  residential: ['1545324418-cc1a3fa10c00', '1502672260266-1c1ef2d93688', '1560448204-e02f11c3d0e2', '1484154218962-a197022b5858'],
  commercial: ['1497366216548-37526070297c', '1497366811353-6870744d04b2', '1524758631624-e2822e304c36', '1568992687947-868a62a9f521'],
  industrial: ['1586528116311-ad8dd3c8310d', '1504307651254-35680f356dfd', '1553697388-94e804e2f0f6', '1601598851547-4302969d0614'],
};
/** Local (same-origin) last resort if the stock image cannot load. */
const UNIT_LOCAL: Record<string, string> = {
  residential: '/marketspace/images/apt3.jpg', commercial: '/marketspace/images/office1.jpg',
  industrial: '/marketspace/images/wh3.jpg', land: '/marketspace/images/aerial1.jpg',
};

/** Relative upload paths go through the /uploads rewrite (next.config); absolute URLs as-is. */
function photoUrl(url: string): string {
  return /^(https?:)?\/\//.test(url) || url.startsWith('/') ? url : `/uploads/${url}`;
}

function unitCard({ unit, property, coverPhotoUrl }: ListingItem): MarketCard {
  const loc = [property.community?.nameEn, property.emirate?.nameEn].filter(Boolean).join(', ')
    || property.fullAddress || 'UAE';
  const size = unit.unitSizeSqft ? `${Number(unit.unitSizeSqft).toLocaleString('en-AE', { maximumFractionDigits: 0 })} sqft` : null;
  // Bedroom counts only for residential unit types (unitTaxonomy is the single source of truth).
  const beds = isResidentialUnitType(unit.unitType) && unit.bedrooms ? `${unit.bedrooms} bed` : null;
  const cat = (property.spaceCategory ?? 'residential').toLowerCase();
  const pool = UNIT_STOCK[cat];
  const local = UNIT_LOCAL[cat] ?? UNIT_LOCAL.residential;
  return {
    key: `u${unit.id}`,
    title: unit.unitName || property.buildingName || 'Listing',
    meta: [beds, size, loc].filter(Boolean).join(' · '),
    price: rentLabel(unit.rentalPrice),
    per: rentPer(unit.facilities),
    // The real cover photo when the unit has one; otherwise the category picture the detail page uses.
    img: coverPhotoUrl ? photoUrl(coverPhotoUrl) : pool ? UNSPLASH(pool[unit.id % pool.length]) : local,
    fallback: local,
    href: `/listings/units/${unit.id}`,
  };
}

/**
 * Variety over raw order: units with a real photo first, at most 2 per property and one per
 * floor-plan variant on the first pass, then fill with unseen variants, then anything left.
 * Nothing is dropped from the data — this only decides which `limit` units a rail shows.
 */
function pickVaried(items: ListingItem[], limit: number): ListingItem[] {
  const ranked = [...items].sort((a, b) => Number(!!b.coverPhotoUrl) - Number(!!a.coverPhotoUrl));
  const prop = (it: ListingItem) => it.unit.propertyId ?? it.property.buildingName ?? it.unit.id;
  const variant = (it: ListingItem) =>
    `${prop(it)}|${it.unit.unitType}|${it.unit.bedrooms}|${it.unit.planLabel ?? Math.round(Number(it.unit.unitSizeSqft) / 25)}`;
  const out: ListingItem[] = [];
  const taken = new Set<number>();
  const perProp = new Map<unknown, number>();
  const seenVariant = new Set<string>();
  const take = (it: ListingItem) => {
    out.push(it); taken.add(it.unit.id); seenVariant.add(variant(it));
    perProp.set(prop(it), (perProp.get(prop(it)) ?? 0) + 1);
  };
  const passes: ((it: ListingItem) => boolean)[] = [
    (it) => (perProp.get(prop(it)) ?? 0) < 2 && !seenVariant.has(variant(it)),
    (it) => !seenVariant.has(variant(it)),
    () => true,
  ];
  for (const ok of passes) {
    for (const it of ranked) {
      if (out.length >= limit) return out;
      if (!taken.has(it.unit.id) && ok(it)) take(it);
    }
  }
  return out;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json() as Promise<T>;
}

/** Rows fetched per query to choose a varied rail from (the endpoint's page-size cap). */
const UNIT_POOL = 50;

/** Units for one units-binding. Multiple spaceTypes are fetched in parallel and merged. */
export async function fetchUnitCards(
  binding: Extract<NonNullable<BackendBinding>, { kind: 'units' }>,
  limit: number,
  signal?: AbortSignal,
): Promise<{ cards: MarketCard[]; total: number }> {
  const queries = binding.spaceTypes?.length
    ? binding.spaceTypes.map((t) => `spaceType=${encodeURIComponent(t)}`)
    : [binding.category ? `category=${encodeURIComponent(binding.category)}` : ''];
  const pages = await Promise.all(queries.map((q) =>
    getJson<{ items?: ListingItem[]; total?: number }>(`/api/listings/units?limit=${Math.max(limit, UNIT_POOL)}&${q}`, signal)
      .catch((e) => { if ((e as Error).name === 'AbortError') throw e; return { items: [], total: 0 }; }),
  ));
  const cards = pickVaried(pages.flatMap((p) => p.items ?? []), limit).map(unitCard);
  return { cards, total: pages.reduce((n, p) => n + (p.total ?? p.items?.length ?? 0), 0) };
}

/** URL of the existing listings search for a units-binding (spaceType search takes one type). */
export function unitsSearchHref(binding: Extract<NonNullable<BackendBinding>, { kind: 'units' }>, extra?: URLSearchParams): string {
  const p = new URLSearchParams(extra);
  if (binding.category) p.set('category', binding.category);
  if (binding.spaceTypes?.length === 1) p.set('spaceType', binding.spaceTypes[0]);
  const qs = p.toString();
  return `/listings${qs ? `?${qs}` : ''}`;
}

// ---- services -----------------------------------------------------------------

export interface PublicCatalogService {
  code: string; name: string; pricingMode: string; priceUnit: string;
  basePrice: number | null; isEmergency: boolean;
  estimatedDuration: number | null; estimatedDurationMax: number | null;
  packages: { id: number }[]; packageGroupLabel: string | null; imageUrl?: string | null;
  minCalloutCharge?: number | string | null;
}
export interface PublicCatalogCategory { code: string; name: string; imageUrl?: string | null; services: PublicCatalogService[] }

export async function fetchServiceCatalog(signal?: AbortSignal): Promise<PublicCatalogCategory[]> {
  const d = await getJson<{ categories?: PublicCatalogCategory[] }>('/api/catalog/public', signal);
  return d.categories ?? [];
}

// Same price reading as the existing landing page / services catalog (catalog basePrice is AED).
function svcPrice(sv: PublicCatalogService): { price: string; per: string } {
  // Quote services: the same inspection wording as /services ("Free inspection" / "Inspection AED 99").
  if (isQuoteMode(sv.pricingMode) || sv.basePrice == null) return { price: calloutCopy(sv.minCalloutCharge).short, per: '' };
  return {
    price: `From ${new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(sv.basePrice))}`,
    per: sv.priceUnit === 'per_hour' ? '/hour' : '',
  };
}

function svcMeta(catName: string, sv: PublicCatalogService): string {
  if (sv.packages.length > 0) return `${catName} · ${sv.packages.length} ${(sv.packageGroupLabel || 'package').toLowerCase()} options`;
  if (sv.estimatedDuration) {
    const f = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
    const max = sv.estimatedDurationMax && sv.estimatedDurationMax !== sv.estimatedDuration ? `–${f(sv.estimatedDurationMax)}` : '';
    return `${catName} · ${f(sv.estimatedDuration)}${max}`;
  }
  return `${catName} · Vetted, licensed providers`;
}

export function serviceCards(categories: PublicCatalogCategory[], codes: ReadonlySet<string> | null, limit: number): MarketCard[] {
  return categories
    .filter((c) => (codes ? codes.has(c.code) : true))
    .flatMap((c) => c.services.map((sv, i) => {
      const { price, per } = svcPrice(sv);
      return {
        key: `s${sv.code}`,
        title: sv.name,
        meta: svcMeta(c.name, sv),
        price,
        per,
        img: serviceImg(sv.code, c.code, i, sv.imageUrl),
        fallback: serviceFallbackImg(c.code),
        badge: sv.isEmergency ? '24/7' : undefined,
        href: `/services/book/${sv.code}`,
      } satisfies MarketCard;
    }))
    .slice(0, limit);
}

// ---- locations ----------------------------------------------------------------

export interface LocationSuggestion { label: string; community: string | null; emirateSlug: string; emirateName: string }

export async function fetchLocationSuggestions(signal?: AbortSignal): Promise<LocationSuggestion[]> {
  const emirates = await getJson<{ id: number; nameEn: string; slug: string }[]>('/api/locations/emirates', signal);
  const lists = await Promise.all(emirates.map((em) =>
    getJson<{ nameEn: string }[]>(`/api/locations/emirates/${em.id}/communities`, signal).catch(() => []),
  ));
  return [
    ...emirates.map((em) => ({ label: em.nameEn, community: null, emirateSlug: em.slug, emirateName: em.nameEn })),
    ...lists.flatMap((cs, i) => cs.map((c) => ({
      label: `${c.nameEn}, ${emirates[i].nameEn}`, community: c.nameEn, emirateSlug: emirates[i].slug, emirateName: emirates[i].nameEn,
    }))),
  ];
}

/** Places that currently have published listings (communities first). */
export async function fetchListedAreas(signal?: AbortSignal): Promise<string[]> {
  const rows = await getJson<{ label: string; kind: string }[]>('/api/listings/locations?country=AE', signal);
  return rows.filter((r) => r.kind === 'community').map((r) => r.label);
}
