/**
 * Listing quality — ONE scorer shared by Catalogue › Units & listings and the Add-units
 * wizard ("Preview & validate" + live preview), so the score a provider sees while creating
 * a unit is the score the Units page shows afterwards.
 *
 * Modelled on the UAE portals (see reports/Marketplace provider OS best practices.md,
 * "Listing quality is a scored checklist"):
 *  - Bayut Profolio shows a green / orange / red Listing Quality Score; the fixes are concrete
 *    (better images, add a floor plan) and a floor plan is required for a "perfect" score —
 *    https://www.bayut.com/agentportal/announcements/floor-plans-mandatory-to-get-a-perfect-quality-score/
 *  - Property Finder scores a percentage from a title of at most 40 characters, a description
 *    (up to 1,000 chars), a full location, 10 high-quality photos and amenities —
 *    https://propertyfinder.bh/blog/achieve-100-quality-score ; SuperAgent needs an average
 *    above 85% — https://www.propertyfinder.ae/partnerhub/super-agent/
 *  - Bayut rejects listings missing beds, baths, area, price, title, description or type —
 *    https://support.bayut.com/hc/en-us/articles/13282874790034-Why-is-my-listing-rejected
 * Neither portal publishes weights, so the weights below are UpNow's own (they sum to 100).
 * Bands: green ≥ 85 (PF SuperAgent bar) · amber 60–84 · red < 60.
 *
 * Only fields the units API actually returns are scored (checked against
 * GET /properties/:pid/units, /properties/floor-plans and /properties/:pid/units/:id/media on
 * staging). Not scored because the payload has no such data: listing location completeness
 * (property-level, not on the units payloads), photo quality / resolution, permit (Trakheesi)
 * number, verification badge age, Arabic copy (nameAr / descriptionAr exist but are optional).
 */
import { isLandUnitType, isResidentialUnitType, unitHasRooms } from '@/lib/unitTaxonomy';

export type QualityBand = 'green' | 'amber' | 'red';
/** Where the provider fixes an item — matches the Add-units wizard step ids. */
export type QualitySection = 'details' | 'pricing' | 'amenities' | 'media';

export interface QualityCheck {
  key: string;
  label: string;
  weight: number;
  /** null = data not known yet (e.g. photo count still loading) — left out of the score. */
  pass: boolean | null;
  /** What we saw, e.g. "3 photos" or "176 characters". */
  detail: string;
  /** One line on how to fix it. */
  fix: string;
  section: QualitySection;
}

export interface ListingQuality {
  /** 0–100, rounded; computed over the applicable checks whose data is known. */
  score: number;
  band: QualityBand;
  bandLabel: 'Good' | 'Needs work' | 'Low quality';
  /** Kit Pill / bar tone for the band. */
  tone: 'primary' | 'amber' | 'danger';
  /** Every applicable check, in display order. */
  checks: QualityCheck[];
  /** Failed checks, heaviest first — the "what's missing" list. */
  missing: QualityCheck[];
  /** True while some check's data is unknown (photo count not loaded). */
  pending: boolean;
}

/** Normalised input. Build it with qualityInputFromUnit (API unit) or directly (wizard form). */
export interface ListingQualityInput {
  /** The listing title customers see — `unitName` on the unit. */
  title: string | null | undefined;
  unitNumber?: string | null;
  description: string | null | undefined;
  /** Unit photos (media rows of type photo). null = not loaded yet. */
  photoCount: number | null;
  hasFloorPlan: boolean;
  /** Pass false when the property hides per-unit floor plans (standalone unit). */
  floorPlanApplicable?: boolean;
  unitType: string | null | undefined;
  rent: number | string | null | undefined;
  sizeSqft: number | string | null | undefined;
  /** 0 / "Studio" counts as set. */
  bedrooms: number | string | null | undefined;
  rooms?: number | string | null | undefined;
  bathrooms: number | string | null | undefined;
  amenityCount: number;
}

export const QUALITY_GOOD = 85;
export const QUALITY_OK = 60;
export const TITLE_MIN = 12;
export const TITLE_MAX = 80;
export const DESCRIPTION_MIN = 300;
export const PHOTOS_GOOD = 5;
export const PHOTOS_BEST = 10;
export const AMENITIES_MIN = 3;

// Contact details customers must not see — they reach the provider through UpNow.
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|ae|net|org|io|co)\b)/i;
export const hasContactDetails = (text: string | null | undefined) =>
  !!text && (PHONE_RE.test(text) || EMAIL_RE.test(text) || LINK_RE.test(text));

/** Unit types where a floor plan does not apply (bare land, yards, desks, beds, outdoor). */
const NO_FLOOR_PLAN = new Set(['open_yard', 'bed_space', 'coworking_desk', 'outdoor_venue']);
export const floorPlanApplies = (unitType: string | null | undefined) =>
  !isLandUnitType(unitType) && !NO_FLOOR_PLAN.has(unitType ?? '');

const num = (v: number | string | null | undefined) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const isSet = (v: number | string | null | undefined) =>
  v != null && v !== '' && (String(v).toLowerCase() === 'studio' || num(v) != null);

export function bandOf(score: number): Pick<ListingQuality, 'band' | 'bandLabel' | 'tone'> {
  if (score >= QUALITY_GOOD) return { band: 'green', bandLabel: 'Good', tone: 'primary' };
  if (score >= QUALITY_OK) return { band: 'amber', bandLabel: 'Needs work', tone: 'amber' };
  return { band: 'red', bandLabel: 'Low quality', tone: 'danger' };
}

export function scoreListing(i: ListingQualityInput): ListingQuality {
  const title = (i.title ?? '').trim();
  const titleIsNumber = !!title && !!i.unitNumber && title === i.unitNumber.trim();
  const titleSet = !!title && !titleIsNumber;
  const desc = (i.description ?? '').trim();
  const photos = i.photoCount;
  const residential = isResidentialUnitType(i.unitType);
  const rooms = unitHasRooms(i.unitType);
  const fpApplies = (i.floorPlanApplicable ?? true) && floorPlanApplies(i.unitType);
  const rent = num(i.rent);
  const size = num(i.sizeSqft);
  const contact = hasContactDetails(desc);

  const checks: QualityCheck[] = [
    { key: 'title', label: 'Listing title', weight: 8, section: 'details',
      pass: titleSet, detail: titleSet ? `“${title}”` : titleIsNumber ? 'Same as the unit number' : 'No title',
      fix: 'Give the unit a title customers will read, e.g. “Spacious 2BR with pool view”.' },
    { key: 'titleLength', label: `Title ${TITLE_MIN}–${TITLE_MAX} characters`, weight: 4, section: 'details',
      pass: titleSet && title.length >= TITLE_MIN && title.length <= TITLE_MAX,
      detail: title ? `${title.length} characters` : 'No title',
      fix: `Aim for ${TITLE_MIN}–${TITLE_MAX} characters (Property Finder recommends 40 or fewer).` },
    { key: 'description', label: `Description of ${DESCRIPTION_MIN}+ characters`, weight: 15, section: 'amenities',
      pass: desc.length >= DESCRIPTION_MIN, detail: desc ? `${desc.length} characters` : 'No description',
      fix: 'Describe the layout, finishes, view, building facilities and what is nearby.' },
    { key: 'noContact', label: 'No phone numbers, emails or links in the description', weight: 8, section: 'amenities',
      pass: !contact, detail: contact ? 'Contact details found' : 'Clean',
      fix: 'Remove contact details — customers reach you through UpNow.' },
    { key: 'photos', label: `At least ${PHOTOS_GOOD} photos`, weight: 15, section: 'media',
      pass: photos == null ? null : photos >= PHOTOS_GOOD, detail: photos == null ? 'Checking…' : `${photos} photo${photos === 1 ? '' : 's'}`,
      fix: `Add at least ${PHOTOS_GOOD} photos; the first one is the cover.` },
    { key: 'photosBest', label: `${PHOTOS_BEST} or more photos`, weight: 7, section: 'media',
      pass: photos == null ? null : photos >= PHOTOS_BEST, detail: photos == null ? 'Checking…' : `${photos} photo${photos === 1 ? '' : 's'}`,
      fix: `Listings with ${PHOTOS_BEST}+ photos get the best score on the portals.` },
  ];
  if (fpApplies) checks.push({ key: 'floorPlan', label: 'Floor plan', weight: 10, section: 'media',
    pass: i.hasFloorPlan, detail: i.hasFloorPlan ? 'Attached' : 'Missing',
    fix: 'Attach a floor plan — Bayut requires one for a perfect score.' });
  checks.push(
    { key: 'rent', label: 'Annual rent set', weight: 12, section: 'pricing',
      pass: rent != null && rent > 0, detail: rent != null && rent > 0 ? `AED ${rent.toLocaleString('en-AE')}` : 'Not set',
      fix: 'Set the asking annual rent.' },
    { key: 'size', label: 'Size set', weight: 8, section: 'details',
      pass: size != null && size > 0, detail: size != null && size > 0 ? `${size.toLocaleString('en-AE')} sq.ft` : 'Not set',
      fix: 'Enter the unit size in square feet.' },
  );
  if (residential) {
    checks.push(rooms
      ? { key: 'rooms', label: 'Rooms set', weight: 4, section: 'details',
          pass: isSet(i.rooms), detail: isSet(i.rooms) ? `${i.rooms} rooms` : 'Not set', fix: 'Enter the number of rooms.' }
      : { key: 'bedrooms', label: 'Bedrooms set', weight: 4, section: 'details',
          pass: isSet(i.bedrooms), detail: isSet(i.bedrooms) ? (num(i.bedrooms) === 0 || String(i.bedrooms).toLowerCase() === 'studio' ? 'Studio' : `${i.bedrooms} BR`) : 'Not set',
          fix: 'Enter the number of bedrooms (Studio counts).' },
    { key: 'bathrooms', label: 'Bathrooms set', weight: 4, section: 'details',
      pass: isSet(i.bathrooms), detail: isSet(i.bathrooms) ? `${i.bathrooms} bath` : 'Not set', fix: 'Enter the number of bathrooms.' });
  }
  checks.push({ key: 'amenities', label: `At least ${AMENITIES_MIN} amenities`, weight: 5, section: 'amenities',
    pass: i.amenityCount >= AMENITIES_MIN, detail: `${i.amenityCount} selected`, fix: 'Tick the amenities the unit and building offer.' });

  const known = checks.filter(c => c.pass != null);
  const total = known.reduce((n, c) => n + c.weight, 0);
  const earned = known.reduce((n, c) => n + (c.pass ? c.weight : 0), 0);
  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  const missing = checks.filter(c => c.pass === false).sort((a, b) => b.weight - a.weight);
  return { score, ...bandOf(score), checks, missing, pending: known.length < checks.length };
}

/** Amenities live in the unit's `facilities` JSON (bare array, or { amenities: [...] }). */
export function amenityCountOf(facilities: string | null | undefined): number {
  if (!facilities) return 0;
  try {
    const p = JSON.parse(facilities);
    if (Array.isArray(p)) return p.length;
    return p && typeof p === 'object' && Array.isArray(p.amenities) ? p.amenities.length : 0;
  } catch { return 0; }
}

/** A unit as GET /properties/:pid/units (or /manager/properties/:pid/units) returns it. */
export interface QualityUnitLike {
  unitName: string | null;
  unitNumber?: string | null;
  unitType: string | null;
  description: string | null;
  facilities: string | null;
  rentalPrice: number | string | null;
  unitSizeSqft: number | string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  rooms?: number | null;
  floorPlanUrl?: string | null;
}

/**
 * Score a unit from the units API. The floor plan is stored per layout, so pass the layout's
 * `floorPlanUrl` (GET /properties/floor-plans → plans[]); `photoCount` comes from the unit's
 * media (GET /properties/:pid/units/:id/media), null while it loads. Pass
 * `floorPlanApplicable: false` for a standalone property (no separate per-unit floor plan).
 */
export function scoreUnit(u: QualityUnitLike, ctx: { photoCount: number | null; layoutFloorPlanUrl?: string | null; floorPlanApplicable?: boolean }): ListingQuality {
  return scoreListing({
    title: u.unitName, unitNumber: u.unitNumber ?? null, description: u.description,
    photoCount: ctx.photoCount, hasFloorPlan: !!(u.floorPlanUrl || ctx.layoutFloorPlanUrl), floorPlanApplicable: ctx.floorPlanApplicable,
    unitType: u.unitType, rent: u.rentalPrice, sizeSqft: u.unitSizeSqft,
    bedrooms: u.bedrooms, rooms: u.rooms ?? null, bathrooms: u.bathrooms,
    amenityCount: amenityCountOf(u.facilities),
  });
}
