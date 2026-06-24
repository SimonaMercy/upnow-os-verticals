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
