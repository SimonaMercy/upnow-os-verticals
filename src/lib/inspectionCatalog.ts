/**
 * Inspection catalog + shared inspection-document helpers (Phase 1).
 *
 * ⚠️ MIRROR of upnow-backend/src/contracts/inspection-catalog.ts — keep the two IN
 * SYNC (verbatim). Dependency-free (pure TS, no node crypto) so the same source runs
 * in Node and the browser. Edit the backend copy, then re-copy here.
 *
 * Single source of truth, imported by the backend scaffold-seeder, the settlement
 * wiring, and (mirrored) the frontend. It holds:
 *   - the document / price-book TypeScript shapes (§2.2 of the design spec),
 *   - the platform-standard price catalog `PLATFORM_PRICE_BOOK_SEED` (§3) — the
 *     figures copied into each RP's editable `inspection_price_book`; these are the
 *     SEED, not the runtime price source,
 *   - the pure metric / severity / defective / charge helpers (§2.3 / §5),
 *   - `resolvePriceBookEntry` (§4.2) — resolve a row's reference price from the RP
 *     price book, falling back to the seed,
 *   - `normalizeInspectionShape` (§2.8) — the side-effect-free read-time gate that
 *     converts legacy room-based `areas[]` (and pre-revision v2) records into the
 *     current `categories[]` v2 shape.
 *
 * Money contract (§1.2): all inspection + price-book money is 2-decimal AED
 * (`NUMERIC(12,2)`), never fils, never integer-forced. Use `round2`, never
 * `Math.round`, so `1.5 sqm × 45 = 67.50` survives.
 */

// ─── Enums / unions ─────────────────────────────────────────────────────────

export type Condition = 'good' | 'fair' | 'poor' | '';
export type Severity = 'none' | 'ok' | 'warn' | 'bad';
export type InspectionPhase = 'move_in' | 'move_out';

export const CANONICAL_CATEGORY_KEYS = [
  'doors', 'closet', 'windows', 'walls_ceiling', 'flooring', 'electrical',
  'kitchen', 'bathroom', 'ac_system', 'balcony_outdoor', 'keys_access', 'deep_cleaning', 'painting', 'other',
] as const;
export type CanonicalCategoryKey = (typeof CANONICAL_CATEGORY_KEYS)[number];
export type CategoryKey = CanonicalCategoryKey | `custom:${string}`;

export type ItemStatus =
  | 'clean' | 'working'                                    // ok
  | 'dirty' | 'scratched' | 'loose' | 'worn_out'          // warn (defective)
  | 'broken' | 'missing' | 'leaking' | 'blocked' | 'not_working'; // bad (defective)

export type UnitOfMeasure = 'item' | 'sqm' | 'sqft' | 'meter' | 'hinge' | 'point' | 'unit' | 'set';

/** Per-component VAT treatment (5%): none (flat) | exclusive (net, +5%) | inclusive (incl. 5%). */
export type VatMode = 'none' | 'exclusive' | 'inclusive';
export const VAT_RATE = 0.05;

// ─── Document shape (§2.2) — jsonb on tenancy_contracts.move_*_inspection ──────

export interface InspectionPhoto { id: string; url: string; caption?: string }

export interface InspectionItem {
  id: string;
  category: CategoryKey;
  sectionId: string;
  componentName: string;
  subCategory?: string;
  location: string;
  isCustom?: boolean;
  isClonedLocation?: boolean;

  // Price-book linkage (R9/R10)
  unitOfMeasure?: UnitOfMeasure;
  variantLabel?: string;
  priceBookEntryId?: number;
  /** VAT treatment, frozen from the RP price book at scaffold time. */
  vatMode?: VatMode;

  // Move-in axis (read-only "before" at move-out)
  inCondition?: Condition;
  inStatus?: ItemStatus;

  // Move-out axis (seeded from move-in)
  outCondition?: Condition;
  outStatus?: ItemStatus;

  // Cost model (§1.1/§1.2) — all 2-dp AED, never fils
  unitCostAed?: number;
  signedUnitCostAed?: number;
  chargedUnitCostAed?: number;
  quantity?: number;
  /** @deprecated pre-revision key; read via `quantityOf`, folded to `quantity` on write (§2.2.1). */
  quantityToReplace?: number;
  totalCostAed?: number;
  totalCostManual?: boolean;

  remarks?: string;
  itemAttachments?: InspectionPhoto[];
  moveInAttachments?: InspectionPhoto[];
}

export interface InspectionCategory {
  sectionId: string;
  key: CategoryKey;
  label: string;
  unitLabel: string;
  count: number;
  countManual?: boolean;
  subCategories?: string[];
  nextCloneSeq?: number;
  nextCustomSeq?: number;
  items: InspectionItem[];
  remarks?: string;
}

export interface UtilityClearance {
  provider: string;
  cleared: boolean;
  outstandingAed?: number;
  outstanding?: string;
  reference?: string;
}

export interface InspectionTotals {
  categories: number;
  items: number;
  defective: number;
  itemsToReplace: number;
  estCostAed: number;
}

export interface InspectionDoc {
  reportGeneratedDate?: string;
  inspectorName?: string;
  inspectorCompany?: string;
  inspectorRole?: string;
  accompaniedBy?: string;
  inspectionDate?: string;
  moveInDate?: string;
  /** Move-out only: the recorded move-out date, editable until the inspection is
   *  approved (counter-signed). Falls back to the contract's termination/end date
   *  when unset. Shown on the report + PDF. */
  moveOutDate?: string;

  categories: InspectionCategory[];

  generalNotes?: string;
  instructionsNote?: string;

  photos?: InspectionPhoto[];
  moveInPhotos?: InspectionPhoto[];

  billClearance?: { items: UtilityClearance[]; certificateUrl?: string; notes?: string };

  tenantSig?: string; tenantSignedAt?: string;
  landlordSig?: string;
  rpSubmittedAt?: string;
  rpCounterSig?: string; rpCounterSignedAt?: string; rpCounterSigName?: string;

  totals?: InspectionTotals;

  _generated?: boolean;
  /** Move-out only: this doc was scaffolded by mirroring the saved move-in report
   *  (§ move-out seeds its component list from move-in). Transient until first save. */
  _seededFromMoveIn?: boolean;
  schemaVersion?: number;
}

// ─── Price-book entity shape (§2.2) — table inspection_price_book (Phase 2) ─────

export interface InspectionPriceBookEntry {
  id: number;
  rentalProviderId: number;
  categoryKey: string;
  subCategory: string | null;
  componentName: string;
  variantLabel: string | null;
  unitOfMeasure: UnitOfMeasure;
  unitPriceAed: number;
  sortOrder: number;
  isActive: boolean;
  proposedPrice?: boolean;
  vatMode?: VatMode;
  createdAt?: Date;
  updatedAt?: Date;
}

// ─── Catalog / seed shape (§2.2 / §3) ──────────────────────────────────────────

export interface PriceBookSeedRow {
  name: string;
  unitOfMeasure: UnitOfMeasure;
  unitPriceAed: number;
  subCategory?: string;
  variantLabel?: string;
  proposedPrice?: boolean;
}
export interface CatalogCategory {
  key: CanonicalCategoryKey;
  label: string;
  unitLabel: string;
  subCategories?: string[];
  statuses: ItemStatus[];
  seed: PriceBookSeedRow[];
}
export type CatalogAliasTable = Record<string, string>;

/** A price resolved from the RP price book (with a DB `id`) or the seed (`id` undefined). */
export interface ResolvedPrice {
  id?: number;
  unitPriceAed: number;
  unitOfMeasure: UnitOfMeasure;
  variantLabel?: string;
  subCategory?: string;
  proposedPrice?: boolean;
  vatMode?: VatMode;
}

// ─── Status metadata (§3 global table) ─────────────────────────────────────────

export const OK_STATUSES: readonly ItemStatus[] = ['clean', 'working'];
export const WARN_STATUSES: readonly ItemStatus[] = ['dirty', 'scratched', 'loose', 'worn_out'];
export const BAD_STATUSES: readonly ItemStatus[] = ['broken', 'missing', 'leaking', 'blocked', 'not_working'];

/** Defective status set = warn ∪ bad (everything except clean/working). §2.3 */
export const DEFECTIVE_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>([
  ...WARN_STATUSES, ...BAD_STATUSES,
]);

export const STATUS_DEFAULT_CONDITION: Record<ItemStatus, Exclude<Condition, ''>> = {
  clean: 'good', working: 'good',
  dirty: 'fair', scratched: 'fair', loose: 'fair', worn_out: 'fair',
  broken: 'poor', missing: 'poor', leaking: 'poor', blocked: 'poor', not_working: 'poor',
};

const ALL_STATUSES: ItemStatus[] = [
  'clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out',
  'broken', 'missing', 'leaking', 'blocked', 'not_working',
];

// ─── The catalog / PLATFORM_PRICE_BOOK_SEED (§3) ───────────────────────────────
// Component names + prices are authoritative (the move-in mockup "standard average
// pricing"). All unitPriceAed are 2-dp AED. Size-varying components carry a default
// `variantLabel`; RPs add more variants in Settings.

export const CATALOG: CatalogCategory[] = [
  {
    key: 'doors', label: 'Doors', unitLabel: 'Per Door',
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out', 'broken', 'missing', 'not_working'],
    seed: [
      { name: 'Door Leaf / Panel Surface', unitOfMeasure: 'item', unitPriceAed: 120.0, variantLabel: 'Standard 2.1×0.9m' },
      { name: 'Door Frame', unitOfMeasure: 'item', unitPriceAed: 180.0 },
      { name: 'Door Handle / Lever', unitOfMeasure: 'item', unitPriceAed: 90.0 },
      { name: 'Door Lock / Cylinder', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Hinges (per hinge)', unitOfMeasure: 'hinge', unitPriceAed: 35.0 },
      { name: 'Door Stopper', unitOfMeasure: 'item', unitPriceAed: 25.0 },
      { name: 'Door Closer (if applicable)', unitOfMeasure: 'item', unitPriceAed: 200.0 },
      { name: 'Threshold / Bottom Seal', unitOfMeasure: 'meter', unitPriceAed: 40.0 },
    ],
  },
  {
    key: 'closet', label: 'Closet', unitLabel: 'Per Item',
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out', 'broken', 'missing', 'not_working'],
    seed: [
      { name: 'Closet Door (Panel)', unitOfMeasure: 'item', unitPriceAed: 150.0 },
      { name: 'Closet Handles', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Hinges (per hinge)', unitOfMeasure: 'item', unitPriceAed: 70.0 },
      { name: 'Closet Lock (if any)', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Shelves', unitOfMeasure: 'item', unitPriceAed: 50.0 },
      { name: 'Hanging Rod', unitOfMeasure: 'item', unitPriceAed: 25.0 },
    ],
  },
  {
    key: 'windows', label: 'Windows', unitLabel: 'Per Window',
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'broken', 'missing', 'not_working'],
    seed: [
      { name: 'Window Glass Panel', unitOfMeasure: 'item', unitPriceAed: 150.0, variantLabel: 'Standard' },
      { name: 'Window Frame', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Sliding Track / Rail', unitOfMeasure: 'meter', unitPriceAed: 70.0 },
      { name: 'Lock / Latch', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Handle', unitOfMeasure: 'item', unitPriceAed: 50.0 },
      { name: 'Rubber Seal / Gasket', unitOfMeasure: 'meter', unitPriceAed: 30.0 },
      { name: 'Insect Screen / Mesh', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Window Stopper', unitOfMeasure: 'item', unitPriceAed: 25.0 },
    ],
  },
  {
    key: 'walls_ceiling', label: 'Walls & Ceiling', unitLabel: 'Per Area',
    statuses: ['clean', 'dirty', 'scratched', 'worn_out', 'broken'],
    seed: [
      { name: 'Paint Finish', unitOfMeasure: 'sqm', unitPriceAed: 80.0 },
      { name: 'Wall Surface (cracks / holes)', unitOfMeasure: 'sqm', unitPriceAed: 150.0 },
      { name: 'Skirting / Baseboard', unitOfMeasure: 'meter', unitPriceAed: 60.0 },
      { name: 'Ceiling Paint', unitOfMeasure: 'sqm', unitPriceAed: 90.0 },
      { name: 'Ceiling Cracks', unitOfMeasure: 'sqm', unitPriceAed: 120.0 },
      { name: 'Cornice / Molding (if any)', unitOfMeasure: 'meter', unitPriceAed: 80.0 },
    ],
  },
  {
    key: 'flooring', label: 'Flooring', unitLabel: 'Per Area',
    statuses: ['clean', 'dirty', 'scratched', 'worn_out', 'broken', 'missing'],
    seed: [
      { name: 'Tiles / Marble / Wood Surface', unitOfMeasure: 'sqm', unitPriceAed: 150.0, variantLabel: 'Ceramic / Standard' },
      { name: 'Grouting (per sq.m. min)', unitOfMeasure: 'sqm', unitPriceAed: 80.0 },
      { name: 'Skirting', unitOfMeasure: 'meter', unitPriceAed: 60.0 },
      { name: 'Floor Level / Alignment (per area)', unitOfMeasure: 'sqm', unitPriceAed: 150.0 },
    ],
  },
  {
    key: 'electrical', label: 'Electrical', unitLabel: 'Per Point',
    statuses: ['working', 'not_working', 'loose', 'broken', 'missing'],
    seed: [
      { name: 'Light Fixtures', unitOfMeasure: 'point', unitPriceAed: 100.0 },
      { name: 'Switches', unitOfMeasure: 'point', unitPriceAed: 40.0 },
      { name: 'Power Sockets', unitOfMeasure: 'point', unitPriceAed: 45.0 },
      { name: 'DB / Circuit Breaker', unitOfMeasure: 'unit', unitPriceAed: 250.0 },
      { name: 'Exhaust Fan', unitOfMeasure: 'unit', unitPriceAed: 150.0 },
    ],
  },
  {
    key: 'kitchen', label: 'Kitchen', unitLabel: 'Per Kitchen',
    subCategories: ['Cabinets', 'Sink Area', 'Countertop'],
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out', 'broken', 'missing', 'leaking', 'not_working'],
    seed: [
      { name: 'Cabinet Body', subCategory: 'Cabinets', unitOfMeasure: 'unit', unitPriceAed: 150.0 },
      { name: 'Cabinet Doors', subCategory: 'Cabinets', unitOfMeasure: 'item', unitPriceAed: 80.0 },
      { name: 'Hinges (per hinge)', subCategory: 'Cabinets', unitOfMeasure: 'hinge', unitPriceAed: 30.0 },
      { name: 'Handles', subCategory: 'Cabinets', unitOfMeasure: 'item', unitPriceAed: 15.0 },
      { name: 'Shelves', subCategory: 'Cabinets', unitOfMeasure: 'item', unitPriceAed: 40.0 },
      { name: 'Sink Basin', subCategory: 'Sink Area', unitOfMeasure: 'item', unitPriceAed: 180.0 },
      { name: 'Faucet / Mixer', subCategory: 'Sink Area', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Drain', subCategory: 'Sink Area', unitOfMeasure: 'item', unitPriceAed: 30.0 },
      { name: 'Flexible Hose', subCategory: 'Sink Area', unitOfMeasure: 'item', unitPriceAed: 30.0 },
      { name: 'Countertop Surface', subCategory: 'Countertop', unitOfMeasure: 'sqm', unitPriceAed: 200.0 },
    ],
  },
  {
    key: 'bathroom', label: 'Bathroom', unitLabel: 'Per Bathroom',
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out', 'broken', 'missing', 'leaking', 'blocked', 'not_working'],
    seed: [
      { name: 'Wash Basin', unitOfMeasure: 'item', unitPriceAed: 180.0 },
      { name: 'Faucet / Mixer', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Toilet Bowl', unitOfMeasure: 'item', unitPriceAed: 250.0 },
      { name: 'Flush System', unitOfMeasure: 'item', unitPriceAed: 90.0 },
      { name: 'Shower Mixer', unitOfMeasure: 'item', unitPriceAed: 150.0 },
      { name: 'Shower Head', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Drainage', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Mirror', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Towel Rail', unitOfMeasure: 'item', unitPriceAed: 80.0 },
      { name: 'Soap Holder', unitOfMeasure: 'item', unitPriceAed: 30.0 },
      { name: 'Toilet Paper Holder', unitOfMeasure: 'item', unitPriceAed: 30.0 },
    ],
  },
  {
    key: 'ac_system', label: 'AC System', unitLabel: 'Per Unit',
    statuses: ['clean', 'working', 'dirty', 'worn_out', 'leaking', 'not_working'],
    seed: [
      { name: 'Indoor Unit / Fan Coil', unitOfMeasure: 'unit', unitPriceAed: 600.0 },
      { name: 'Outdoor Unit / Compressor', unitOfMeasure: 'unit', unitPriceAed: 900.0 },
      { name: 'Remote / Thermostat', unitOfMeasure: 'item', unitPriceAed: 80.0 },
      { name: 'Air Filter', unitOfMeasure: 'item', unitPriceAed: 40.0 },
      { name: 'Grille / Louvers', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Drainage / Condensate', unitOfMeasure: 'item', unitPriceAed: 70.0 },
      { name: 'Cooling Performance', unitOfMeasure: 'unit', unitPriceAed: 150.0 },
    ],
  },
  {
    key: 'balcony_outdoor', label: 'Balcony / Outdoor', unitLabel: 'Per Balcony',
    statuses: ['clean', 'working', 'dirty', 'scratched', 'loose', 'worn_out', 'broken', 'missing', 'blocked'],
    seed: [
      { name: 'Floor Finish', unitOfMeasure: 'sqm', unitPriceAed: 120.0 },
      { name: 'Drain', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Railing', unitOfMeasure: 'meter', unitPriceAed: 250.0 },
      { name: 'Glass Panels (if any)', unitOfMeasure: 'item', unitPriceAed: 250.0 },
    ],
  },
  {
    key: 'deep_cleaning', label: 'Deep Cleaning', unitLabel: 'General',
    statuses: ['clean', 'dirty', 'worn_out'],
    seed: [
      { name: 'Overall deep cleaning status', unitOfMeasure: 'item', unitPriceAed: 300.0 },
    ],
  },
  {
    key: 'painting', label: 'Painting', unitLabel: 'General',
    statuses: ['clean', 'scratched', 'worn_out', 'broken'],
    seed: [
      { name: 'Overall painting status', unitOfMeasure: 'item', unitPriceAed: 500.0 },
    ],
  },
  {
    key: 'keys_access', label: 'Keys & Access', unitLabel: 'Handover Items',
    statuses: ['working', 'not_working', 'loose', 'broken', 'missing'],
    seed: [
      { name: 'Front Door Keys', unitOfMeasure: 'set', unitPriceAed: 150.0 },
      { name: 'Mailbox / Letterbox Key', unitOfMeasure: 'item', unitPriceAed: 80.0 },
      { name: 'Building Access Card', unitOfMeasure: 'item', unitPriceAed: 150.0 },
      { name: 'Gate / Garage Remote', unitOfMeasure: 'item', unitPriceAed: 200.0 },
      { name: 'Parking Remote / FOB', unitOfMeasure: 'item', unitPriceAed: 200.0 },
    ],
  },
  {
    key: 'other', label: 'Other / Accessories', unitLabel: 'Per Item',
    statuses: [...ALL_STATUSES],
    seed: [
      { name: 'Wardrobe / Built-in Storage', unitOfMeasure: 'item', unitPriceAed: 400.0 },
      { name: 'Curtain Rail / Blinds', unitOfMeasure: 'item', unitPriceAed: 80.0 },
      { name: 'Smoke Detector', unitOfMeasure: 'item', unitPriceAed: 60.0 },
      { name: 'Water Meter', unitOfMeasure: 'item', unitPriceAed: 120.0 },
      { name: 'Keys / Access Cards', unitOfMeasure: 'item', unitPriceAed: 50.0 },
      { name: 'Miscellaneous Fixtures', unitOfMeasure: 'item', unitPriceAed: 50.0 },
    ],
  },
];

/** Commercial/industrial extras (§3.11) — seeded into every RP price book under `other`,
 *  but NOT part of the residential Other scaffold list. */
export const COMMERCIAL_OTHER_SEED: PriceBookSeedRow[] = [
  { name: 'Shutter / Roller Door', unitOfMeasure: 'item', unitPriceAed: 500.0 },
  { name: 'Loading Bay', unitOfMeasure: 'item', unitPriceAed: 300.0 },
  { name: 'Fire Exit Signage', unitOfMeasure: 'item', unitPriceAed: 120.0 },
  { name: 'Sprinkler Heads', unitOfMeasure: 'point', unitPriceAed: 90.0 },
];

export const CATALOG_BY_KEY: Record<CanonicalCategoryKey, CatalogCategory> = CATALOG.reduce(
  (acc, c) => { acc[c.key] = c; return acc; },
  {} as Record<CanonicalCategoryKey, CatalogCategory>,
);

/** A flattened seed row carrying its category — one per (category, subCategory?, component, variant?). */
export interface PlatformSeedEntry extends PriceBookSeedRow {
  categoryKey: CanonicalCategoryKey;
  sortOrder: number;
}

/** PLATFORM_PRICE_BOOK_SEED — copied into each RP's inspection_price_book at seed time. */
export const PLATFORM_PRICE_BOOK_SEED: PlatformSeedEntry[] = (() => {
  const out: PlatformSeedEntry[] = [];
  for (const cat of CATALOG) {
    cat.seed.forEach((row, i) => out.push({ ...row, categoryKey: cat.key, sortOrder: i }));
  }
  COMMERCIAL_OTHER_SEED.forEach((row, i) =>
    out.push({ ...row, categoryKey: 'other', sortOrder: CATALOG_BY_KEY.other.seed.length + i }),
  );
  return out;
})();

// ─── Legacy free-text → canonical component alias table (§2.8) ─────────────────
// Keys are normName()-normalized legacy names; values are canonical catalog names.
// Best-effort — the normalizer leaves a row's price/uom undefined on no confident match.

export const CATALOG_ALIAS_TABLE: CatalogAliasTable = {
  'door locks': 'Door Lock / Cylinder',
  'door lock': 'Door Lock / Cylinder',
  'door and locks': 'Door Lock / Cylinder',
  'door and lock': 'Door Lock / Cylinder',
  'main entrance door and lock': 'Door Lock / Cylinder',
  'door leaf': 'Door Leaf / Panel Surface',
  'door panel': 'Door Leaf / Panel Surface',
  hinges: 'Hinges (per hinge)',
  'walls and paint': 'Paint Finish',
  'walls paint': 'Paint Finish',
  walls: 'Paint Finish',
  'wall paint': 'Paint Finish',
  ceiling: 'Ceiling Paint',
  'ceiling paint': 'Ceiling Paint',
  'floor and skirting': 'Tiles / Marble / Wood Surface',
  floor: 'Tiles / Marble / Wood Surface',
  flooring: 'Tiles / Marble / Wood Surface',
  tiles: 'Tiles / Marble / Wood Surface',
  windows: 'Window Glass Panel',
  window: 'Window Glass Panel',
  'windows and locks': 'Window Glass Panel',
  'window glass panel': 'Window Glass Panel',
  lighting: 'Light Fixtures',
  lights: 'Light Fixtures',
  'lights and switches': 'Light Fixtures',
  'light fixtures': 'Light Fixtures',
  'power outlets': 'Power Sockets',
  'power sockets': 'Power Sockets',
  sockets: 'Power Sockets',
  switches: 'Switches',
  'air conditioning': 'Indoor Unit / Fan Coil',
  'ac unit': 'Indoor Unit / Fan Coil',
  ac: 'Indoor Unit / Fan Coil',
  toilet: 'Toilet Bowl',
  'toilet bowl': 'Toilet Bowl',
  wc: 'Toilet Bowl',
  'wash basin': 'Wash Basin',
  basin: 'Wash Basin',
  mirror: 'Mirror',
  'shower head': 'Shower Head',
  drainage: 'Drainage',
  countertop: 'Countertop Surface',
  'countertop surface': 'Countertop Surface',
  'sink basin': 'Sink Basin',
  sink: 'Sink Basin',
  'cabinet doors': 'Cabinet Doors',
  'upper cabinets': 'Cabinet Body',
  'lower cabinets': 'Cabinet Body',
  cabinets: 'Cabinet Body',
  railings: 'Railing',
  railing: 'Railing',
};

// ─── String helpers ────────────────────────────────────────────────────────────

export function slug(s: string): string {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

/** Normalize a free-text component name for alias matching: drop parentheticals,
 *  keep alphanumerics + spaces, collapse whitespace. */
export function normName(s: string): string {
  return (s || '')
    .toString()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')     // drop "(per hinge)", "(if applicable)"
    .replace(/[^a-z0-9]+/g, ' ')    // punctuation/dashes/slashes → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic, cross-environment (Node + browser) string hash → 16 hex chars.
 * Used for legacy-item id synthesis so the same record yields identical ids on
 * every read and in both the backend and the FE mirror (node crypto is avoided).
 * FNV-1a 32-bit run twice (forward + salted) for a low-collision 64-bit-ish value.
 */
export function stableHash(input: string): string {
  const fnv = (str: string, seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const a = fnv(input, 0x811c9dc5);
  const b = fnv(input + 'salt', 0x811c9dc5 ^ 0x9e3779b9);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function canonicalKey(key: string | undefined | null): CanonicalCategoryKey {
  if (key && (CANONICAL_CATEGORY_KEYS as readonly string[]).includes(key)) {
    return key as CanonicalCategoryKey;
  }
  return 'other'; // custom:* and any unknown key resolve to the Other price group (§2.6)
}

// ─── Money / row helpers (§2.3 / §5) ───────────────────────────────────────────

/** 2-dp AED rounding (§1.2). NEVER Math.round — decimal-UoM totals are legitimate. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The filled measure, accepting the legacy `quantityToReplace` key (§2.2.1). */
export function quantityOf(item: Pick<InspectionItem, 'quantity' | 'quantityToReplace'>): number {
  const q = item.quantity ?? item.quantityToReplace ?? 0;
  return Number.isFinite(q) ? Number(q) : 0;
}

/** Move-out override → frozen baseline → RP working price (§1.1). Undefined if none set. */
export function effectiveUnitCost(
  item: Pick<InspectionItem, 'chargedUnitCostAed' | 'signedUnitCostAed' | 'unitCostAed'>,
): number | undefined {
  return item.chargedUnitCostAed ?? item.signedUnitCostAed ?? item.unitCostAed;
}

/** A row carries a real charge iff its total is > 0 (§2.3.1 gate). */
export function isChargeable(item: Pick<InspectionItem, 'totalCostAed'>): boolean {
  return (item.totalCostAed ?? 0) > 0;
}

function phaseCondition(item: InspectionItem, phase: InspectionPhase): Condition {
  if (phase === 'move_out') return item.outCondition ?? item.inCondition ?? '';
  return item.inCondition ?? '';
}
function phaseStatus(item: InspectionItem, phase: InspectionPhase): ItemStatus | undefined {
  if (phase === 'move_out') return item.outStatus ?? item.inStatus;
  return item.inStatus;
}

/**
 * The single canonical defective test (§2.3). Poor-condition OR a defective status
 * OR a priced row (quantity/total > 0). Blank rows are NOT defective.
 */
export function isDefective(item: InspectionItem, phase: InspectionPhase): boolean {
  const cond = phaseCondition(item, phase);
  const status = phaseStatus(item, phase);
  if (cond === 'poor') return true;
  if (status && DEFECTIVE_STATUSES.has(status)) return true;
  if (isChargeable(item) || quantityOf(item) > 0) return true; // priced ⇒ defective (§2.3.1)
  return false;
}

/**
 * Chip colour (§2.3). Grey when unfilled; never claims "bad ⇔ defective" (§2.3.2):
 * a fair-condition-only row is amber (warn) but not defective.
 */
export function severityOf(status?: ItemStatus, condition?: Condition): Severity {
  const cond = condition ?? '';
  if (!status && cond === '') return 'none';
  if (cond === 'poor' || (status && BAD_STATUSES.includes(status))) return 'bad';
  if ((status && WARN_STATUSES.includes(status)) || cond === 'fair') return 'warn';
  if ((status && OK_STATUSES.includes(status)) || cond === 'good') return 'ok';
  return 'none';
}

// ─── Metrics (§5) ──────────────────────────────────────────────────────────────

/**
 * Pure totals over a (normalized) v2 doc. Always iterates items[] — NEVER sums
 * `count` (§2.7). Callers pass a normalized doc; `quantityOf` tolerates the legacy
 * `quantityToReplace` key so an un-normalized doc still totals correctly.
 */
export function computeInspectionTotals(
  doc: Pick<InspectionDoc, 'categories'> | null | undefined,
  phase: InspectionPhase,
): InspectionTotals {
  const categories = doc?.categories ?? [];
  let categoriesWithItems = 0;
  let items = 0;
  let defective = 0;
  let itemsToReplace = 0;
  let estCostAed = 0;

  for (const cat of categories) {
    const rows = cat?.items ?? [];
    if (rows.length > 0) categoriesWithItems += 1;
    for (const item of rows) {
      items += 1;
      if (isDefective(item, phase)) defective += 1;
      itemsToReplace += quantityOf(item);
      if (isChargeable(item)) estCostAed += item.totalCostAed ?? 0;
    }
  }

  return {
    categories: categoriesWithItems,
    items,
    defective,
    itemsToReplace: round2(itemsToReplace),
    estCostAed: round2(estCostAed),
  };
}

/**
 * Recompute a row's total (§5). round2(quantity × effectiveUnitCost); both operands
 * coerced to 0, so never NaN. Honours `totalCostManual` (returns the typed value).
 */
export function computeRowTotal(item: InspectionItem): number {
  if (item.totalCostManual) return round2(item.totalCostAed ?? 0);
  return round2(quantityOf(item) * (effectiveUnitCost(item) ?? 0));
}

// ─── Price resolution (§4.2) ───────────────────────────────────────────────────

function subEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '');
}

function seedEntriesForKey(key: CategoryKey): PlatformSeedEntry[] {
  const canon = canonicalKey(key);
  return PLATFORM_PRICE_BOOK_SEED.filter((r) => r.categoryKey === canon);
}

function seedRowToResolved(r: PlatformSeedEntry): ResolvedPrice {
  return {
    id: undefined,
    unitPriceAed: r.unitPriceAed,
    unitOfMeasure: r.unitOfMeasure,
    variantLabel: r.variantLabel,
    subCategory: r.subCategory,
    proposedPrice: r.proposedPrice,
    vatMode: 'none',
  };
}

function entryToResolved(e: InspectionPriceBookEntry): ResolvedPrice {
  return {
    id: e.id,
    unitPriceAed: e.unitPriceAed,
    unitOfMeasure: e.unitOfMeasure,
    variantLabel: e.variantLabel ?? undefined,
    subCategory: e.subCategory ?? undefined,
    proposedPrice: e.proposedPrice,
    vatMode: e.vatMode ?? 'none',
  };
}

/**
 * Resolve a component's reference price. Prefers the RP price book (returns a DB
 * `id`), else falls back to PLATFORM_PRICE_BOOK_SEED (`id` undefined → the caller
 * must NOT set a `priceBookEntryId`). When `variant` is given it is preferred; else
 * the default (lowest sortOrder / first) variant is returned. §4.2.
 */
export function resolvePriceBookEntry(
  priceBook: InspectionPriceBookEntry[] | null | undefined,
  key: CategoryKey,
  subCategory: string | null | undefined,
  componentName: string,
  variant?: string | null,
): ResolvedPrice | undefined {
  const dbRows = (priceBook ?? []).filter(
    (e) =>
      e.isActive &&
      e.categoryKey === key &&
      e.componentName === componentName &&
      (subCategory == null || subEq(e.subCategory, subCategory)),
  );
  if (dbRows.length > 0) {
    const chosen =
      (variant != null && dbRows.find((e) => (e.variantLabel ?? undefined) === variant)) ||
      [...dbRows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)[0];
    return entryToResolved(chosen);
  }

  const seedRows = seedEntriesForKey(key).filter(
    (r) => r.name === componentName && (subCategory == null || subEq(r.subCategory, subCategory)),
  );
  if (seedRows.length > 0) {
    const chosen =
      (variant != null && seedRows.find((r) => (r.variantLabel ?? undefined) === variant)) ||
      [...seedRows].sort((a, b) => a.sortOrder - b.sortOrder)[0];
    return seedRowToResolved(chosen);
  }
  return undefined;
}

/**
 * Legacy fuzzy resolve by free-text name (§2.8 back-fill). Normalizes + alias-maps
 * the raw name to a canonical component, then resolves its price. Returns undefined
 * on no confident match (the normalizer then leaves the row's price/uom undefined).
 * If the matched component has multiple variants, `variantLabel` is left undefined
 * (inspector chooses at move-out).
 */
export function resolvePriceByName(
  priceBook: InspectionPriceBookEntry[] | null | undefined,
  key: CategoryKey,
  rawName: string,
): ResolvedPrice | undefined {
  const n = normName(rawName);
  if (!n) return undefined;
  const canonicalName = CATALOG_ALIAS_TABLE[n];

  // Candidate component names available for this key (DB + seed).
  const dbNames = (priceBook ?? [])
    .filter((e) => e.isActive && e.categoryKey === key)
    .map((e) => e.componentName);
  const seedNames = seedEntriesForKey(key).map((r) => r.name);
  const allNames = Array.from(new Set([...dbNames, ...seedNames]));

  const matched =
    allNames.find((name) => name === canonicalName) ??
    allNames.find((name) => normName(name) === n) ??
    (canonicalName ? allNames.find((name) => normName(name) === normName(canonicalName)) : undefined);
  if (!matched) return undefined;

  // How many variants does the matched component have (DB rows first, else seed)?
  const dbVariants = (priceBook ?? []).filter(
    (e) => e.isActive && e.categoryKey === key && e.componentName === matched,
  );
  const variantCount =
    dbVariants.length > 0
      ? dbVariants.length
      : seedEntriesForKey(key).filter((r) => r.name === matched).length;

  const resolved = resolvePriceBookEntry(priceBook, key, undefined, matched, undefined);
  if (!resolved) return undefined;
  // Multiple variants → let the inspector choose the size later (§2.8).
  if (variantCount > 1) return { ...resolved, id: undefined, variantLabel: undefined };
  return resolved;
}

// ─── Legacy normalization (§2.8) ───────────────────────────────────────────────

const LEGACY_KEY_RULES: { test: RegExp; key: CanonicalCategoryKey }[] = [
  { test: /\bcloset|\bwardrobe/i, key: 'closet' },
  { test: /\bdoor/i, key: 'doors' },
  { test: /\bwindow/i, key: 'windows' },
  { test: /\b(ac|a\/c|split|air\s*condition)/i, key: 'ac_system' },
  { test: /\bbath|\btoilet|\bwc\b|\bwashroom/i, key: 'bathroom' },
  { test: /\bkitchen|\bpantry/i, key: 'kitchen' },
  { test: /\bfloor|\btile/i, key: 'flooring' },
  { test: /\bwall|\bceiling|\bpaint/i, key: 'walls_ceiling' },
  { test: /\bbalcon|\bterrace/i, key: 'balcony_outdoor' },
  { test: /\bswitch|\bsocket|\belectric|\blight/i, key: 'electrical' },
];

/** Keyword heuristic (§2.8): legacy area/item name → CategoryKey. Defaults to 'other'. */
export function legacyKeyFromName(...names: (string | undefined)[]): CanonicalCategoryKey {
  const hay = names.filter(Boolean).join(' ');
  for (const rule of LEGACY_KEY_RULES) if (rule.test.test(hay)) return rule.key;
  return 'other';
}

function mapLegacyCondition(c: unknown): Condition {
  if (c === 'G' || c === 'good') return 'good';
  if (c === 'F' || c === 'fair') return 'fair';
  if (c === 'D' || c === 'poor') return 'poor';
  return '';
}

const CLONE_ID_RE = /:clone:(\d+)$/;
const CUSTOM_ID_RE = /:custom:(\d+)$/;

function seqFromItems(items: InspectionItem[], re: RegExp): number {
  let max = 0;
  for (const it of items) {
    const m = re.exec(it.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

const EMPTY_DOC: InspectionDoc = { categories: [], schemaVersion: 2 };

/**
 * The single read-time entry gate (§2.8). Converts a legacy `areas[]` record OR a
 * pre-revision v2 record into the current v2 `categories[]` shape. SIDE-EFFECT-FREE
 * (§2.8.1): pure `(doc, priceBook?) → doc`, never writes, never seeds. `priceBook`
 * (the RP's rows) is used only for price/uom/variant back-fill; when absent, falls
 * back to PLATFORM_PRICE_BOOK_SEED. Never throws.
 */
export function normalizeInspectionShape(
  doc: unknown,
  priceBook?: InspectionPriceBookEntry[] | null,
): InspectionDoc {
  if (!isObj(doc)) return { ...EMPTY_DOC };
  const anyDoc = doc as Record<string, unknown>;

  if (Array.isArray(anyDoc.categories)) return normalizeV2(anyDoc, priceBook);
  if (Array.isArray(anyDoc.areas)) return normalizeLegacyAreas(anyDoc, priceBook);
  return { ...EMPTY_DOC };
}

function backfillPrice(
  item: InspectionItem,
  key: CategoryKey,
  priceBook: InspectionPriceBookEntry[] | null | undefined,
): void {
  if (item.unitCostAed != null) return; // already priced — leave as-is
  const resolved = resolvePriceByName(priceBook, key, item.componentName);
  if (!resolved) return; // no confident match → leave undefined (do NOT collapse to Other default)
  item.unitCostAed = resolved.unitPriceAed;
  item.unitOfMeasure = resolved.unitOfMeasure;
  if (resolved.subCategory != null && item.subCategory == null) item.subCategory = resolved.subCategory;
  if (resolved.variantLabel != null && item.variantLabel == null) item.variantLabel = resolved.variantLabel;
  if (resolved.id != null && item.priceBookEntryId == null) item.priceBookEntryId = resolved.id;
}

function normalizeV2(
  anyDoc: Record<string, unknown>,
  priceBook: InspectionPriceBookEntry[] | null | undefined,
): InspectionDoc {
  const rawCats = (anyDoc.categories as unknown[]) ?? [];
  const categories: InspectionCategory[] = rawCats.filter(isObj).map((rc) => {
    const cat = rc as Partial<InspectionCategory> & Record<string, unknown>;
    const key = (cat.key as CategoryKey) ?? 'other';
    const canon = canonicalKey(key);
    const catalog = CATALOG_BY_KEY[canon];
    const sectionId = (cat.sectionId as string) || `${key}:0`;
    const rawItems = Array.isArray(cat.items) ? (cat.items as unknown[]) : [];

    const items: InspectionItem[] = rawItems.filter(isObj).map((ri, idx) => {
      const raw = ri as Partial<InspectionItem> & Record<string, unknown>;
      const componentName = (raw.componentName as string) ?? '';
      const item: InspectionItem = {
        ...(raw as InspectionItem),
        componentName,
        category: (raw.category as CategoryKey) ?? key,
        sectionId: (raw.sectionId as string) ?? sectionId,
        location: (raw.location as string) ?? '',
        id: (raw.id as string) || stableHash(`${canon}|${raw.location ?? ''}|${componentName}|${idx}`),
        quantity: quantityOf(raw as InspectionItem),
      };
      delete (item as { quantityToReplace?: number }).quantityToReplace;
      backfillPrice(item, key, priceBook);
      return item;
    });

    return {
      ...(cat as InspectionCategory),
      sectionId,
      key,
      label: (cat.label as string) || (catalog ? catalog.label : 'Other / Accessories'),
      unitLabel: (cat.unitLabel as string) || (catalog ? catalog.unitLabel : 'Per Item'),
      count: typeof cat.count === 'number' ? cat.count : items.length,
      subCategories: (cat.subCategories as string[]) ?? catalog?.subCategories,
      nextCloneSeq: cat.nextCloneSeq ?? seqFromItems(items, CLONE_ID_RE),
      nextCustomSeq: cat.nextCustomSeq ?? seqFromItems(items, CUSTOM_ID_RE),
      items,
    };
  });

  return { ...(anyDoc as unknown as InspectionDoc), categories, schemaVersion: 2 };
}

function normalizeLegacyAreas(
  anyDoc: Record<string, unknown>,
  priceBook: InspectionPriceBookEntry[] | null | undefined,
): InspectionDoc {
  const rawAreas = (anyDoc.areas as unknown[]) ?? [];
  const categories: InspectionCategory[] = rawAreas.filter(isObj).map((ra, sectionOrdinal) => {
    const area = ra as Record<string, unknown>;
    const areaName = (area.name as string) ?? '';
    const rawItems = Array.isArray(area.items) ? (area.items as unknown[]) : [];
    const firstItemName = isObj(rawItems[0]) ? ((rawItems[0] as Record<string, unknown>).name as string) : undefined;
    const key = legacyKeyFromName(areaName, firstItemName);
    const catalog = CATALOG_BY_KEY[key];
    const sectionId = `${key}:${sectionOrdinal}`;

    const items: InspectionItem[] = rawItems.filter(isObj).map((ri, idx) => {
      const raw = ri as Record<string, unknown>;
      const componentName = (raw.name as string) ?? '';
      const item: InspectionItem = {
        id: stableHash(`${key}|${areaName}|${componentName}|${idx}`),
        category: key,
        sectionId,
        componentName,
        location: areaName,
        inCondition: mapLegacyCondition(raw.inCondition),
        outCondition: mapLegacyCondition(raw.outCondition),
        quantity: 0,
        totalCostAed: 0,
        itemAttachments: Array.isArray(raw.itemAttachments) ? (raw.itemAttachments as InspectionPhoto[]) : undefined,
        moveInAttachments: Array.isArray(raw.moveInAttachments) ? (raw.moveInAttachments as InspectionPhoto[]) : undefined,
      };
      backfillPrice(item, key, priceBook);
      return item;
    });

    return {
      sectionId,
      key,
      label: key === 'other' && areaName ? areaName : catalog.label,
      unitLabel: catalog.unitLabel,
      count: items.length,
      subCategories: catalog.subCategories,
      nextCloneSeq: 1,
      nextCustomSeq: 1,
      items,
      remarks: typeof area.remarks === 'string' ? (area.remarks as string) : undefined,
    };
  });

  // Carry forward the safe top-level document fields; drop legacy `areas`.
  const { areas: _drop, ...rest } = anyDoc;
  void _drop;
  return { ...(rest as Partial<InspectionDoc>), categories, schemaVersion: 2 };
}
