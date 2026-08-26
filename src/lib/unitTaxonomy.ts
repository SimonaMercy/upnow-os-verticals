/**
 * Unit-type taxonomy helpers — the single source of truth for which unit types
 * are "residential". Bedrooms / bathrooms are only meaningful for residential
 * units; on a retail shop, office, warehouse, plot, etc. they are nonsensical
 * (and were historically written as phantom `1`/`1` defaults by the unit form).
 *
 * Mirrors the `UnitType` groupings in the backend `src/shared/enums.ts` and the
 * lists in `components/upnow/UnitFormModal.tsx` (which re-exports the array below
 * so there is exactly one residential list across the frontend).
 */
export const RESIDENTIAL_UNIT_TYPES: string[] = [
  'apartment', 'villa', 'villa_compound', 'townhouse', 'penthouse',
  'studio', 'duplex_loft', 'room', 'bed_space', 'holiday_home',
  // Accommodation types are offered under residential + commercial. They are
  // listed here so the bed / furnishing fields show, but they are NOT exempt —
  // both also appear in COMMERCIAL_UNIT_TYPES below, so they resolve to 5% rent
  // VAT. Commercial for tax, residential for form fields.
  'labour_accommodation', 'staff_accommodation',
];

/** Land / plot unit types — a bare plot has none of the built-space attributes
 * (no floor, view, kitchen, washroom, furnishing). Mirrors `LAND` in enums.ts. */
export const LAND_UNIT_TYPES: string[] = [
  'residential_land', 'commercial_land', 'industrial_land',
  'mixed_use_land', 'agricultural_land', 'labour_accommodation_land',
];

/**
 * True when **bedrooms** and **furnishing** should be shown / stored for this
 * unit type — i.e. it is residential. Bedrooms / furnished-state are nonsensical
 * on a shop, office, warehouse or plot. A missing/unknown type is treated as
 * residential so we never hide real bed counts on legacy rows that lack a
 * unit_type (real commercial units always carry a concrete non-residential type).
 */
export function isResidentialUnitType(unitType: string | null | undefined): boolean {
  return !unitType || RESIDENTIAL_UNIT_TYPES.includes(unitType);
}

/** True for land / plot unit types. */
export function isLandUnitType(unitType: string | null | undefined): boolean {
  return !!unitType && LAND_UNIT_TYPES.includes(unitType);
}

/**
 * True when **bathrooms / washrooms** apply — every built space (residential
 * homes, shops, offices, warehouses) has them, but a bare plot of land does not.
 * Bathrooms are NOT residential-only: the move-in inspection template turns a
 * commercial unit's bathroom count into "Staff washroom" / "Washroom N" areas,
 * so commercial / industrial counts must be preserved on write.
 */
export function unitHasBathrooms(unitType: string | null | undefined): boolean {
  return !isLandUnitType(unitType);
}

/** Unit types that attract COMMERCIAL fee/VAT treatment (5% rent VAT) — the
 *  commercial bucket plus workspaces + venues. Mirrors COMMERCIAL_UNIT_TYPES in
 *  the backend `src/shared/enums.ts`.
 *
 *  The accommodation types are here AND in RESIDENTIAL_UNIT_TYPES above, on
 *  purpose: an accommodation block is let to a business to house its workforce,
 *  so the rent is VATable, but the unit still has beds and so keeps the
 *  residential form fields. Commercial for tax, residential for form fields. */
export const COMMERCIAL_UNIT_TYPES: string[] = [
  'retail_shop', 'showroom', 'office_fitted', 'office_shell_core', 'restaurant_fnb', 'clinic_medical',
  'coworking_desk', 'private_office', 'meeting_room', 'day_office',
  'event_hall', 'wedding_venue', 'conference_hall', 'private_dining', 'outdoor_venue',
  'labour_accommodation', 'staff_accommodation',
];

/** Unit types that attract INDUSTRIAL fee/VAT treatment (5% rent VAT). */
export const INDUSTRIAL_UNIT_TYPES: string[] = [
  'warehouse', 'open_yard', 'storage_unit', 'cold_storage', 'logistics_facility',
];

/**
 * Derive the fee/VAT space category from a unit's TYPE alone. Residential rent is
 * VAT-exempt; commercial / industrial rent is VATable (5%). A missing/unknown type
 * defaults to residential (the exempt, safe default). Mirrors
 * `deriveSpaceCategoryFromUnitType` in the backend `src/shared/enums.ts`.
 */
export function deriveSpaceCategoryFromUnitType(
  unitType: string | null | undefined,
): 'residential' | 'commercial' | 'industrial' {
  if (!unitType) return 'residential';
  if (INDUSTRIAL_UNIT_TYPES.includes(unitType)) return 'industrial';
  if (COMMERCIAL_UNIT_TYPES.includes(unitType)) return 'commercial';
  return 'residential';
}

/**
 * Effective fee/VAT category for a unit — the SINGLE chokepoint, mirroring the
 * backend `effectiveSpaceCategory`. For every property category EXCEPT mixed_use,
 * the property's own space_category wins; a MIXED-USE building (which holds both
 * residential and commercial units) resolves PER UNIT from the unit type
 * (residential = exempt, commercial = 5% VAT).
 */
export function effectiveSpaceCategory(
  unitType: string | null | undefined,
  propertySpaceCategory?: string | null,
): string {
  if (propertySpaceCategory && propertySpaceCategory !== 'mixed_use') return propertySpaceCategory;
  return deriveSpaceCategoryFromUnitType(unitType);
}

/** True when the rent is VAT-able (commercial / industrial) — i.e. not residential. */
export function isRentVatable(
  unitType: string | null | undefined,
  propertySpaceCategory?: string | null,
): boolean {
  return effectiveSpaceCategory(unitType, propertySpaceCategory) !== 'residential';
}
