/**
 * Where a maintenance request is (migration 0267). A request is not only a
 * unit's: restoration of a vacant unit, a leak in a corridor, the electric
 * room — every scope routes through the same pipeline.
 *
 *   unit             a specific unit, occupied or vacant
 *   common_area      shared spaces — corridor, lobby, parking, roof, facade…
 *   building_system  plant & services — electric room, pumps, lift, fire fighting…
 *
 * The place lists below are SUGGESTIONS for the picker; the backend stores
 * whatever label the landlord types (free text, 120 chars).
 */
export type MaintenanceScope = 'unit' | 'common_area' | 'building_system';

/** 0268 — what kind of building a property is (mirrors backend shared/building-form.ts). */
export type BuildingForm =
  | 'apartment_building' | 'villa' | 'villa_compound' | 'accommodation'
  | 'warehouse' | 'commercial_building' | 'land' | 'workspace' | 'venue';

/** GET /maintenance/property-profile/:id — the form + the places it offers per scope. */
export interface PropertyProfile {
  propertyId: number; buildingName: string; spaceCategory: string;
  form: BuildingForm; formLabel: string; derivedForm: BuildingForm; override: BuildingForm | null;
  floors: number | null; amenities: string[];
  commonLabel: string; commonHint: string;
  forms: { key: BuildingForm; label: string }[];
}

/** A category row as GET /maintenance/categories returns it (0268 fields optional for older payloads). */
export interface MaintenanceCategoryRow {
  id: number; name: string; parentId: number | null; own?: boolean; oneTime?: boolean;
  audience?: 'tenant' | 'landlord'; scopes?: string[] | null; buildingForms?: string[] | null; systemKey?: string | null;
}

/** Does this leaf apply to the scope being raised, on this building form? NULL lists mean "everywhere". */
export function categoryFits(c: MaintenanceCategoryRow, scope: MaintenanceScope, form: BuildingForm | null): boolean {
  if (c.scopes && c.scopes.length && !c.scopes.includes(scope)) return false;
  if (form && c.buildingForms && c.buildingForms.length && !c.buildingForms.includes(form)) return false;
  return true;
}

export const SCOPE_LABEL: Record<MaintenanceScope, string> = {
  unit: 'Unit',
  common_area: 'Common area',
  building_system: 'Building system',
};

export const SCOPE_HINT: Record<MaintenanceScope, string> = {
  unit: 'A specific unit — occupied or vacant (restoration, make-ready, anything before the next tenant).',
  common_area: 'Shared spaces of the building — corridors, lobby, staircases, parking, roof, facade, gate…',
  building_system: 'Plant and services — electric room, pump room, water tank, lift, generator, fire fighting, CCTV…',
};

export interface MaintenanceLocationBits {
  scope?: MaintenanceScope | string | null;
  locationLabel?: string | null;
  unit?: { unitNumber: string | null; unitName: string | null } | null;
  property?: { buildingName: string | null } | null;
}

/** "Unit 8" / "Corridor, 3rd floor" — the place itself, without the building. */
export function maintenancePlace(r: MaintenanceLocationBits): string {
  if (r.scope && r.scope !== 'unit') return r.locationLabel?.trim() || SCOPE_LABEL[r.scope as MaintenanceScope] || '—';
  return r.unit?.unitNumber ? `Unit ${r.unit.unitNumber}` : (r.unit?.unitName ?? '—');
}

/** "Unit 8 · Avenue Residence" / "Electric room · Avenue Residence". */
export function maintenanceLocation(r: MaintenanceLocationBits): string {
  return [maintenancePlace(r), r.property?.buildingName ?? null].filter(Boolean).join(' · ') || '—';
}

/** What the Customer column says when there is no occupant on the request. */
export function maintenanceNoCustomerLabel(scope?: string | null): string {
  if (scope === 'common_area') return 'Common area — no occupant';
  if (scope === 'building_system') return 'Building system — no occupant';
  return 'Vacant unit';
}
