'use client';

/**
 * Property View — read-only property detail popup (RP portfolio + manager).
 *
 * Redesigned to the "Property View" handoff: a single near-full-screen card with
 *   • header (name · category · titling · Edit · close)
 *   • photo gallery (hero + thumbnails → full-screen lightbox)
 *   • stat strip (units · occupied · vacant · annual rent)
 *   • About + Key facts (description, features, lease-agreement shortcut)
 *   • Units list · Location · Documents grid
 *   • a document reader (sidebar + live preview, per-slot upload/replace/remove)
 *
 * Data: the same endpoints the previous version used —
 *   GET /api/properties/:id            (full detail: location names, leasing model)
 *   GET /api/properties/:id/media      (building photos)
 *   GET /api{fetchBase}/:id/units      (units list — manager passes a scoped base)
 *   GET /api/documents?ownerType=property&ownerId=:id   (property documents)
 * Uploads reuse uploadOwnedDocument; deletes hit DELETE /documents/:id.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, ArrowLeft, MapPin, ExternalLink, FileText, Eye, Building2, AlignLeft,
  Image as ImageIcon, Check, Plus, Upload, Replace, Trash2,
  Pencil, ChevronLeft, ChevronRight, Loader2, Layers, Download,
} from 'lucide-react';
import { apiDelete } from '@/lib/api';
import { downloadStoredDoc } from '@/lib/downloadDoc';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { useSlideOver } from '@/lib/useSlideOver';
import { docBelongsToSlot, type PropertyDocSlot } from '@/lib/propertyDocs';
import { type Plan } from '@/components/upnow/LayoutFinancialsModal';
import { UnitFormModal } from '@/components/upnow/UnitFormModal';
import { LayoutPreviewModal } from '@/components/upnow/LayoutPreviewModal';
import { LocationMap } from '@/components/upnow/LocationMap';
import { saveLayoutDetails, unitToFormInitial, type UnitRecord } from '@/lib/unitForm';
import type { FeeRuleLite } from '@/lib/feeRules';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

/** Unit shape for the in-popup units list + Unit Mix aggregation. */
interface UnitLite {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType: string;
  availability: string;
  listingStatus: string;
  bedrooms: number | null;
  unitSizeSqm: number | null;
  unitSizeSqft: number | null;
  planLabel: string | null;
  rentalPrice: number | null;
  lastLeaseRent: number | null;      // annual rent of the unit's most recent lease (active OR ended); null = never leased
  currentLeaseRent: number | null;   // annual rent of the lease counting as current income — running today, or next term with cheques collected; null = none
}

interface Property {
  id: number;
  buildingName: string;
  spaceCategory: string;
  leasingType?: 'direct' | 'sub' | 'management' | null;
  fullAddress: string | null;
  countryName?: string | null;
  emirateName: string | null;
  cityName?: string | null;
  communityName: string | null;
  subCommunityName?: string | null;
  street: string | null;
  makaniNumber: string | null;
  plotNumber: string | null;
  latitude: number | null;
  longitude: number | null;
  sharedAmenities?: string[] | null;
  hasGym: boolean;
  hasPool: boolean;
  hasParking: boolean;
  isStandaloneUnit: boolean;
  propertyDescription: string | null;
  numberOfFloors: string | null;
  createdAt: string;
  unitCount?: number;
  occupiedCount?: number;
  rentTotal?: number;
}

/** Defensive shape for a document record returned by GET /documents. */
interface DocRecord {
  id?: number;
  documentKey?: string;
  document_key?: string;
  displayName?: string | null;
  display_name?: string | null;
  fileUrl?: string;
  file_url?: string;
  url?: string;
  fileName?: string;
  file_name?: string;
  mimeType?: string | null;
  mime_type?: string | null;
}

/** One normalised file inside a document slot. */
interface SlotFile {
  id: number;
  name: string;
  url: string;
  mime: string | null;
}

/** A document slot rendered in the grid + reader. */
interface DocSlot {
  key: string;
  label: string;
  category: string;
  multiple: boolean;
  files: SlotFile[];
}

// ── colour tokens (from the handoff) ──────────────────────
const C = {
  ink: '#1d2823', ink2: '#2b342e', body: '#5a635c',
  mute: '#7d8780', mute2: '#8a938c', mute3: '#9aa39c', mute4: '#a0a8a1',
  green: '#1a9a64', greenT: '#1a7a4f', greenD: '#1a6b4d',
  greenBg: '#e7f3ec', greenBg2: '#eef6f1', greenBg3: '#e6f4ec',
  greenBd: '#cce6d8', greenBd2: '#cfe7da', greenBd3: '#d3e8db',
  line: '#e7ebe6', line2: '#eef1ec', line3: '#f1f3f0', line4: '#f4f6f3',
  soft: '#fbfcfb', soft2: '#fafdfb',
  amber: '#b07415', danger: '#c44536',
};

function docKey(d: DocRecord): string { return d.documentKey ?? d.document_key ?? ''; }
function docUrl(d: DocRecord): string | null { return d.fileUrl ?? d.file_url ?? d.url ?? null; }
function docMime(d: DocRecord): string | null { return d.mimeType ?? d.mime_type ?? null; }
function docName(d: DocRecord): string {
  return d.displayName ?? d.display_name ?? d.fileName ?? d.file_name ?? 'Document';
}
function isImageFile(f: SlotFile): boolean {
  return (f.mime ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(f.url);
}

function leasingLabel(t: Property['leasingType']): string {
  if (t === 'sub') return 'Sub-lease';
  if (t === 'management') return 'Managed';
  return 'Owned (direct lease)';
}

// Header ownership chip — mirrors the portfolio cards' Owned / Sub-lease / Managed badge.
function ownershipChip(t: Property['leasingType']): { label: string; color: string; bg: string } {
  if (t === 'sub')        return { label: 'Sub-lease', color: '#6d4fa1', bg: '#f0eaf8' };
  if (t === 'management') return { label: 'Managed',   color: '#8a6d2e', bg: '#f6f0e0' };
  return { label: 'Owned', color: '#1a6b4d', bg: '#e6f3ec' };
}

// ── Unit Mix helpers ──────────────────────────────────────
// Shared column template for the mix table (Type · Layout · Sqft · Units · Rent/unit · Total · Edit).
const MIX_COLS = 'minmax(96px,0.9fr) minmax(118px,1.3fr) 66px 46px minmax(104px,1fr) minmax(104px,1fr) 74px';
const aed = (n: number) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
// Backend numeric(…) columns (size, rent) come back as strings — coerce defensively.
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const unitTypeLabel = (t: string) => (t ? t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other');
const bedroomsLabel = (b: number | null) => (b == null ? '—' : b === 0 ? 'Studio' : `${b} Bedroom`);
// A min–max span, collapsing to a single value when the DISPLAYED (rounded)
// numbers match — so 1313.95 & 1314.27 sqft both show as "1,314", not a range
// of two identical-looking values (used for size + price).
const spanLabel = (lo: number | null, hi: number | null) => {
  if (lo == null && hi == null) return '—';
  const a = lo ?? (hi as number), b = hi ?? (lo as number);
  const fa = aed(a), fb = aed(b);
  return fa === fb ? fa : `${fa} – ${fb}`;
};

/** One layout (units sharing a plan_label) within a type × bedrooms group. */
interface MixLayout {
  planLabel: string | null;
  label: string;
  count: number;
  sqmLo: number | null; sqmHi: number | null;
  sqftLo: number | null; sqftHi: number | null;
  priceLo: number | null; priceHi: number | null;
  marketSum: number;    // Σ units.rental_price (asking / market rent) over priced units
  leaseSum: number;     // Σ latest-lease annual_rent (already net of discount); leased units only
  unpriced: number;
  hasPlan: boolean;     // a matching floor-plan exists (→ editable)
}
/** A type × bedrooms mix row, aggregating its layouts. */
interface MixGroup {
  key: string;
  unitType: string;
  bedrooms: number | null;
  count: number;
  sqmLo: number | null; sqmHi: number | null;
  sqftLo: number | null; sqftHi: number | null;
  priceLo: number | null; priceHi: number | null;
  marketSum: number;
  leaseSum: number;
  unpriced: number;
  layouts: MixLayout[];
}

/** A flattened mix row — one layout, carrying its parent unit type + bedrooms. */
interface MixRow extends MixLayout { unitType: string; bedrooms: number | null; }

const minOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b));
const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

/**
 * Fold the units list into a type × bedrooms → layouts tree with counts, size
 * spans, price spans and rent-roll sums. `planLabels` (from the floor-plans
 * endpoint) marks which layouts have an editable plan.
 */
function buildUnitMix(units: UnitLite[], planLabels: Set<string>): { rows: MixRow[]; totalUnits: number; grandMarket: number; grandLease: number; unpriced: number } {
  const groups = new Map<string, MixGroup>();
  for (const u of units) {
    const gkey = `${u.unitType}::${u.bedrooms ?? ''}`;
    let g = groups.get(gkey);
    if (!g) {
      g = { key: gkey, unitType: u.unitType, bedrooms: u.bedrooms ?? null, count: 0, sqmLo: null, sqmHi: null, sqftLo: null, sqftHi: null, priceLo: null, priceHi: null, marketSum: 0, leaseSum: 0, unpriced: 0, layouts: [] };
      groups.set(gkey, g);
    }
    const lp = u.planLabel ?? null;
    let l = g.layouts.find((x) => x.planLabel === lp);
    if (!l) {
      l = { planLabel: lp, label: lp || 'No layout', count: 0, sqmLo: null, sqmHi: null, sqftLo: null, sqftHi: null, priceLo: null, priceHi: null, marketSum: 0, leaseSum: 0, unpriced: 0, hasPlan: lp != null && planLabels.has(lp) };
      g.layouts.push(l);
    }
    // Two money figures per unit:
    //  • Market Rent — the unit's asking rent (units.rental_price).
    //  • Annual Rent  — the annual_rent of the lease counting as current income
    //    (backend currentLeaseRent: running today, or the next term whose cheques
    //    are already collected), counted ONLY while the unit is occupied. It is
    //    ALREADY net of any discount (annual_rent = listed_price − discount), so it
    //    is summed as-is. Terminated / ended leases and drafts nobody has paid for
    //    contribute nothing, so this reconciles with the portfolio KPI
    //    (annualRentTotalsFor).
    const market = u.rentalPrice;
    const leaseNet = u.availability === 'occupied' ? u.currentLeaseRent : null;
    for (const bucket of [g, l]) {
      bucket.count += 1;
      bucket.sqmLo = minOf(bucket.sqmLo, u.unitSizeSqm);
      bucket.sqmHi = maxOf(bucket.sqmHi, u.unitSizeSqm);
      bucket.sqftLo = minOf(bucket.sqftLo, u.unitSizeSqft);
      bucket.sqftHi = maxOf(bucket.sqftHi, u.unitSizeSqft);
      if (market != null && market > 0) {
        bucket.marketSum += market;
        bucket.priceLo = minOf(bucket.priceLo, market);
        bucket.priceHi = maxOf(bucket.priceHi, market);
      } else {
        bucket.unpriced += 1;
      }
      if (leaseNet != null && leaseNet > 0) bucket.leaseSum += leaseNet;
    }
  }
  const out = [...groups.values()];
  out.forEach((g) => g.layouts.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })));
  out.sort((a, b) => a.unitType.localeCompare(b.unitType) || (a.bedrooms ?? -1) - (b.bedrooms ?? -1));
  // Flatten to one row per layout (no grouping), keeping type/bedroom order.
  const rows: MixRow[] = out.flatMap((g) => g.layouts.map((l) => ({ ...l, unitType: g.unitType, bedrooms: g.bedrooms })));
  const totalUnits = units.length;
  const grandMarket = out.reduce((s, g) => s + g.marketSum, 0);
  const grandLease = out.reduce((s, g) => s + g.leaseSum, 0);
  const unpriced = out.reduce((s, g) => s + g.unpriced, 0);
  return { rows, totalUnits, grandMarket, grandLease, unpriced };
}

// Open a transient file picker and resolve with the chosen files.
function pickFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.multiple = multiple;
    input.onchange = () => resolve(input.files ? Array.from(input.files) : []);
    input.click();
  });
}

export function PropertyDetailsModal({
  property,
  stats,
  fetchBase = '/properties',
  fetchQuery = '',
  editable = false,
  canEditPricing = false,
  pricingRp,
  onEdit,
  onClose,
}: {
  property: Property;
  stats?: { units: number; occupied: number; rentTotal: number } | null;
  /** Units base — RP uses '/properties'; the manager passes '/manager/properties' + 'rp=N'. */
  fetchBase?: string;
  fetchQuery?: string;
  /** When true, the documents section allows direct upload / replace / delete. */
  editable?: boolean;
  /** When true, the Unit Mix table exposes per-layout pricing edit (RP always; manager needs canEditProperties). */
  canEditPricing?: boolean;
  /** Manager only — the landlord's rental-provider id, scoping the pricing endpoints (/manager/units*). */
  pricingRp?: number;
  /** Opens the edit form (header "Edit" button). Hidden when omitted. */
  onEdit?: () => void;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsBusy, setDocsBusy] = useState(false);
  const [units, setUnits] = useState<UnitLite[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [detail, setDetail] = useState<Partial<Property> | null>(null);
  const [photos, setPhotos] = useState<{ id: number; url: string }[]>([]);
  // Unit Mix per-layout pricing — floor-plans power the editor.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [feeRules, setFeeRules] = useState<Record<string, FeeRuleLite[]> | null>(null);
  const [editLayout, setEditLayout] = useState<{ planLabel: string | null; unitCount: number } | null>(null);
  // Read-only per-layout (grouped) detail popup, opened from a Unit Mix row.
  const [previewLayout, setPreviewLayout] = useState<MixRow | null>(null);
  // ANNUAL RENT info popover — anchored to the icon (fixed, escapes the stat strip's overflow clip).

  // RP vs manager scope for the pricing endpoints (mirrors the units workspace).
  // rp is a dedicated prop — it drives ONLY the pricing calls, never the units fetch.
  const isManager = fetchBase.includes('/manager');
  const managerScope = isManager && pricingRp != null ? { rp: pricingRp } : undefined;
  const pricingRpQ = pricingRp != null ? `rp=${pricingRp}` : '';
  // Pricing edit is available when allowed AND (RP, or a manager with a resolved rp).
  const pricingEditable = canEditPricing && (!isManager || pricingRp != null);

  // Overlays
  const [lb, setLb] = useState<number | null>(null);          // lightbox photo index
  const [reader, setReader] = useState<string | null>(null);  // active slot key
  const [readerFile, setReaderFile] = useState(0);            // active file in slot

  // Swipe-in / swipe-out — same right-to-left slide as PropertyFormModal (see
  // globals.css .slideover-*). This modal is mounted only while open, so the
  // slide-in plays on mount automatically; `dismiss` plays the reverse slide,
  // then calls the parent's onClose (which unmounts us). The shared hook also
  // wires the browser Back button to close the panel instead of navigating away.
  const { closing, dismiss } = useSlideOver(onClose);

  // Track viewport so the layout collapses like the handoff (CSS can't do it via
  // inline styles).
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const f = () => setVw(window.innerWidth);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const isNarrow = vw < 820;
  const isTight = vw < 600;

  // ── data loads ──────────────────────────────────────────
  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents?ownerType=property&ownerId=${property.id}`, { credentials: 'include' });
      const data = res.ok ? await res.json() : [];
      setDocs(Array.isArray(data) ? data : []);
    } catch {
      setDocs([]);
    } finally {
      setDocsLoading(false);
    }
  }, [property.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadDocs(); }, [loadDocs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/properties/${property.id}`, { credentials: 'include' });
        if (res.ok && !cancelled) setDetail(await res.json());
      } catch { /* fall back to the passed-in property */ }
    })();
    return () => { cancelled = true; };
  }, [property.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/properties/${property.id}/media`, { credentials: 'include' });
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setPhotos(Array.isArray(data) ? data : []);
      } catch { /* no photos */ }
    })();
    return () => { cancelled = true; };
  }, [property.id]);

  const loadUnits = useCallback(async () => {
    try {
      const res = await fetch(`/api${fetchBase}/${property.id}/units${fetchQuery ? `?${fetchQuery}` : ''}`, { credentials: 'include' });
      const data = res.ok ? await res.json() : [];
      // numeric(…) columns (size, rent) serialise as strings — normalise for the mix maths.
      const rows: UnitLite[] = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
        ...(r as unknown as UnitLite),
        bedrooms: numOrNull(r.bedrooms),
        unitSizeSqm: numOrNull(r.unitSizeSqm),
        unitSizeSqft: numOrNull(r.unitSizeSqft),
        rentalPrice: numOrNull(r.rentalPrice),
        lastLeaseRent: numOrNull(r.lastLeaseRent),
        currentLeaseRent: numOrNull(r.currentLeaseRent),
      }));
      rows.sort((a, b) => (a.unitNumber ?? '').localeCompare(b.unitNumber ?? '', undefined, { numeric: true, sensitivity: 'base' }));
      setUnits(rows);
    } catch {
      setUnits([]);
    } finally {
      setUnitsLoading(false);
    }
  }, [property.id, fetchBase, fetchQuery]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadUnits(); }, [loadUnits]);

  // Floor-plans (layout aggregates) power BOTH the per-layout pricing editor and
  // the read-only per-layout detail popup (fees, floor plan, market, terms), so
  // they load whenever the endpoint is reachable — RP always; manager once a
  // rental-provider scope is resolved — not only when pricing edits are allowed.
  const loadFloorPlans = useCallback(async () => {
    if (isManager && pricingRp == null) return;
    try {
      const url = isManager
        ? `/api/manager/units?rp=${pricingRp}&propertyId=${property.id}`
        : `/api/properties/floor-plans?propertyId=${property.id}`;
      const res = await fetch(url, { credentials: 'include' });
      const data = res.ok ? await res.json() : null;
      setPlans(Array.isArray(data?.plans) ? data.plans : []);
      setFeeRules(data?.feeRules ?? null);
    } catch {
      setPlans([]); setFeeRules(null);
    }
  }, [isManager, pricingRp, property.id]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadFloorPlans(); }, [loadFloorPlans]);

  // Merge: prefer freshly-fetched detail (full location names + leasing model).
  const p: Property = { ...property, ...(detail ?? {}) };

  // ── Unit Mix (grouped by type × bedrooms, expandable to layouts) ─────────
  const planLabelSet = useMemo(
    () => new Set(plans.map((pl) => pl.planLabel).filter((x): x is string => x != null)),
    [plans],
  );
  const mix = useMemo(() => buildUnitMix(units, planLabelSet), [units, planLabelSet]);

  // ── document slots ──────────────────────────────────────
  // The proof-of-right slot depends on the leasing model.
  const proofSlot: PropertyDocSlot = useMemo(() => {
    if (p.leasingType === 'sub') return { key: 'head_lease', label: 'Head-lease / Master-lease Agreement', category: 'legal', multiple: false };
    if (p.leasingType === 'management') return { key: 'management_agreement', label: 'Signed Property Management Agreement', category: 'legal', multiple: false };
    return { key: 'title_deed', label: 'Title Deed', category: 'legal', multiple: false };
  }, [p.leasingType]);

  const slotDefs: PropertyDocSlot[] = useMemo(() => [
    proofSlot,
    { key: 'completion_certificate', label: 'Completion Certificate',  category: 'compliance', multiple: false },
    { key: 'site_plan',              label: 'Site Plan',               category: 'property',   multiple: false },
    { key: 'building_drawing',       label: 'Building Floor Plans',    category: 'property',   multiple: true  },
    { key: 'utility_account',        label: 'Utility Account Details', category: 'property',   multiple: false },
    { key: 'architectural_drawings', label: 'Architectural Drawings',  category: 'property',   multiple: true  },
    { key: 'noc_documents',          label: 'NOC Documents',           category: 'legal',      multiple: true  },
    { key: 'other_document',         label: 'Other Documents',         category: 'property',   multiple: true  },
  ], [proofSlot]);

  const slots: DocSlot[] = useMemo(() => {
    const records = docs.filter((d) => d.id != null && docUrl(d));
    const toFile = (d: DocRecord): SlotFile => ({ id: d.id as number, name: docName(d), url: docUrl(d)!, mime: docMime(d) });
    const matched = new Set<number>();
    const built = slotDefs.map((def) => {
      const files = records.filter((d) => docBelongsToSlot(docKey(d), def)).map(toFile);
      files.forEach((f) => matched.add(f.id));
      return { ...def, files };
    });
    // Fold any document not claimed by a named slot (legacy keys, a title deed on
    // a sub-lease property, …) into "Other Documents" so nothing is hidden.
    const other = built.find((s) => s.key === 'other_document');
    if (other) {
      const leftover = records.filter((d) => !matched.has(d.id as number)).map(toFile);
      other.files = [...other.files, ...leftover];
    }
    return built;
  }, [docs, slotDefs]);

  const onFileCount = slots.filter((s) => s.files.length > 0).length;
  const docsSummary = `${onFileCount} of ${slots.length} on file`;
  const proof = slots.find((s) => s.key === proofSlot.key);

  // ── mutations ───────────────────────────────────────────
  const uploadToSlot = useCallback(async (slot: DocSlot, openAfter = true) => {
    const files = await pickFiles(slot.multiple);
    if (!files.length) return;
    setDocsBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const key = slot.multiple ? `${slot.key}_${Date.now()}_${i}` : slot.key;
        await uploadOwnedDocument({
          ownerType: 'property', ownerId: property.id,
          documentKey: key, category: slot.category,
          displayName: files[i].name || slot.label, file: files[i],
        });
      }
      await loadDocs();
      if (openAfter) { setReader(slot.key); setReaderFile(0); }
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setDocsBusy(false);
    }
  }, [property.id, loadDocs]);

  const replaceFile = useCallback(async (slot: DocSlot, file: SlotFile) => {
    const picked = await pickFiles(false);
    if (!picked.length) return;
    setDocsBusy(true);
    try {
      await apiDelete(`/documents/${file.id}`);
      const key = slot.multiple ? `${slot.key}_${Date.now()}_0` : slot.key;
      await uploadOwnedDocument({
        ownerType: 'property', ownerId: property.id,
        documentKey: key, category: slot.category,
        displayName: picked[0].name || slot.label, file: picked[0],
      });
      await loadDocs();
    } catch (e) {
      alert(`Replace failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setDocsBusy(false);
    }
  }, [property.id, loadDocs]);

  const removeFile = useCallback(async (file: SlotFile) => {
    if (!confirm('Remove this document?')) return;
    setDocsBusy(true);
    try {
      await apiDelete(`/documents/${file.id}`);
      await loadDocs();
      setReaderFile(0);
    } catch (e) {
      alert(`Could not remove the document: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setDocsBusy(false);
    }
  }, [loadDocs]);

  // ── reader derived ──────────────────────────────────────
  const rSlot = reader ? slots.find((s) => s.key === reader) ?? null : null;
  const rFiles = rSlot?.files ?? [];
  const rf = Math.min(readerFile, Math.max(0, rFiles.length - 1));
  const rActive = rFiles[rf] ?? null;

  // Cross-slot file sequence for the reader's prev/next arrows.
  const seq = useMemo(() => {
    const out: { key: string; idx: number }[] = [];
    slots.forEach((s) => s.files.forEach((_, i) => out.push({ key: s.key, idx: i })));
    return out;
  }, [slots]);
  const curPos = seq.findIndex((x) => x.key === reader && x.idx === rf);
  const goSeq = (delta: number) => {
    if (!seq.length) return;
    const pos = ((curPos < 0 ? 0 : curPos) + delta + seq.length) % seq.length;
    setReader(seq[pos].key);
    setReaderFile(seq[pos].idx);
  };

  // ── keyboard: ESC closes the topmost layer ──────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (lb !== null) setLb(null);
      else if (reader !== null) setReader(null);
      else dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, reader, dismiss]);

  // ── summary numbers ─────────────────────────────────────
  const occFromUnits = units.filter((u) => u.availability === 'occupied').length;
  const totalUnits = stats ? stats.units : units.length;
  const occupied = stats ? stats.occupied : occFromUnits;
  const vacant = Math.max(0, totalUnits - occupied);

  const features: string[] = (p.sharedAmenities && p.sharedAmenities.length)
    ? p.sharedAmenities
    : [p.hasParking && 'Parking', p.hasGym && 'Gym', p.hasPool && 'Pool'].filter(Boolean) as string[];

  // Key facts carries only what isn't shown elsewhere: category + ownership +
  // titling are header chips, total units is the stat strip, and plot / makani
  // live in the Location card — so none of those are repeated here. The leasing
  // model keeps its fuller wording here since the header chip is just "Owned".
  const facts: { label: string; value: string }[] = [];
  facts.push({ label: 'Ownership / leasing model', value: leasingLabel(p.leasingType) });
  if (p.numberOfFloors) facts.push({ label: 'Number of floors', value: p.numberOfFloors });

  const statCells = stats ? [
    { label: 'UNITS', value: String(stats.units), color: C.ink },
    { label: 'OCCUPIED', value: String(stats.occupied), color: C.ink },
    { label: 'VACANT', value: String(vacant), color: C.ink },
    { label: 'MARKET RENT', value: `AED ${Math.round(stats.rentTotal).toLocaleString('en-AE')}`, color: C.greenD },
  ] : [];

  const hasMapLink = p.latitude != null && p.longitude != null;
  const titling = p.isStandaloneUnit ? 'One title deed (single owner)' : 'Units titled separately';

  // Full address — composed from the structured parts so it always carries the
  // emirate + country, falling back to the stored string. The same line is shown
  // up top and in the Location card.
  const addressBits = [p.street, p.subCommunityName, p.communityName, p.emirateName, p.countryName].filter(Boolean);
  const fullAddressLine = addressBits.join(', ') || (p.fullAddress?.trim() || '');
  // Separate, individually-labelled location fields.
  const locCells: { label: string; value: string; mono?: boolean }[] = [];
  if (p.street) locCells.push({ label: 'Street', value: p.street });
  if (p.subCommunityName) locCells.push({ label: 'Sub-community', value: p.subCommunityName });
  if (p.communityName) locCells.push({ label: 'Community', value: p.communityName });
  if (p.emirateName) locCells.push({ label: 'Emirate', value: p.emirateName });
  if (p.countryName) locCells.push({ label: 'Country', value: p.countryName });
  if (p.makaniNumber) locCells.push({ label: 'Makani', value: p.makaniNumber, mono: true });
  if (p.plotNumber) locCells.push({ label: 'Plot', value: p.plotNumber, mono: true });
  const hasLocation = !!fullAddressLine || locCells.length > 0 || hasMapLink;
  const photoSmalls = photos.slice(1, 5);
  const extraPhotos = Math.max(0, photos.length - 5);
  const showSmalls = !isTight && photos.length > 1;

  // shared bits ----------------------------------------------------------------
  const sectionIcon = (Icon: typeof Building2) => (
    <span style={{ width: 28, height: 28, borderRadius: 8, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 28px' }}>
      <Icon size={16} />
    </span>
  );

  return (
    <>
      {/* ── MAIN CARD — full-screen panel that swipes in from the right ── */}
      <div
        onClick={dismiss}
        className={`slideover-scrim${closing ? ' closing' : ''}`}
        style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,25,.46)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 50 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={`slideover-panel${closing ? ' closing' : ''}`}
          style={{ width: '100%', height: '100dvh', maxHeight: '100dvh', background: '#fff', boxShadow: '0 24px 70px rgba(15,30,22,.30)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* HEADER */}
          <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 24px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
            <button type="button" onClick={dismiss} aria-label="Back"
              style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10, border: `1px solid ${C.line}`, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}>
              <ArrowLeft size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-.02em', color: C.ink }}>{p.buildingName}</h1>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: C.greenT, background: C.greenBg, padding: '3px 9px', borderRadius: 6 }}>{categoryDisplayLabel(p.spaceCategory)}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: ownershipChip(p.leasingType).color, background: ownershipChip(p.leasingType).bg, padding: '3px 9px', borderRadius: 6 }}>{ownershipChip(p.leasingType).label}</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: C.mute, background: C.line3, padding: '3px 9px', borderRadius: 6 }}>{titling}</span>
              </div>
            </div>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}
              >
                <Pencil size={14} /> Edit
              </button>
            )}
          </header>

          {/* BODY */}
          <main style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div style={{ maxWidth: 920, margin: '0 auto', padding: isTight ? 16 : '20px 24px 30px' }}>

              {/* GALLERY */}
              {photos.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: showSmalls ? '1.7fr 1fr 1fr' : '1fr', gridTemplateRows: showSmalls ? '174px 174px' : (isTight ? '220px' : '320px'), gap: 8, marginBottom: 8 }}>
                  <div onClick={() => setLb(0)} style={{ gridColumn: 1, gridRow: showSmalls ? '1 / span 2' : '1', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photos[0].url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <span style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, color: '#fff', background: 'rgba(20,40,30,.5)', padding: '6px 12px', borderRadius: 9 }}>
                      <ImageIcon size={14} /> {photos.length} photo{photos.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {showSmalls && photoSmalls.map((ph, i) => {
                    const idx = i + 1;
                    const showMore = i === 3 && extraPhotos > 0;
                    return (
                      <div key={ph.id} onClick={() => setLb(idx)} style={{ borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative' }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {showMore && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,40,30,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>+{extraPhotos}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ height: 174, borderRadius: 14, background: 'linear-gradient(140deg,#dfe8e1,#cdddd2)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9aa39c', marginBottom: 8 }}>
                  <ImageIcon size={26} />
                  <span style={{ fontSize: 12, marginTop: 6 }}>No photos yet</span>
                </div>
              )}

              {/* Address is shown once, in the Location card below — not repeated here. */}

              {/* STATS */}
              {statCells.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: isTight ? 'repeat(2,1fr)' : 'repeat(4,1fr)', border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', background: '#fff', marginBottom: 24 }}>
                  {statCells.map((s, i) => (
                    <div key={s.label} style={{ padding: '14px 18px', borderLeft: `1px solid ${i === 0 ? 'transparent' : C.line2}` }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: s.color, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ABOUT + KEY FACTS */}
              <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1.55fr 1fr', gap: 24, marginBottom: 28 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    {sectionIcon(AlignLeft)}
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>About this property</div>
                  </div>
                  <div style={{ fontSize: 13.5, color: C.body, lineHeight: 1.65 }}>
                    {p.propertyDescription || 'No description has been added for this property yet.'}
                  </div>
                  {features.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.mute4, margin: '18px 0 10px' }}>FEATURES</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {features.map((f) => (
                          <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd3}`, padding: '6px 12px', borderRadius: 999 }}>
                            <Check size={12} />{f}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: C.mute4, marginBottom: 6 }}>KEY FACTS</div>
                  {facts.map((o) => (
                    <div key={o.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: `1px solid ${C.line3}` }}>
                      <span style={{ fontSize: 12.5, color: C.mute2 }}>{o.label}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, textAlign: 'right' }}>{o.value}</span>
                    </div>
                  ))}
                  {proof && proof.files.length > 0 && (
                    <div onClick={() => { setReader(proof.key); setReaderFile(0); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, padding: '10px 11px', border: `1px solid ${C.greenBd2}`, background: '#fff', borderRadius: 10, cursor: 'pointer' }}>
                      <span style={{ width: 28, height: 28, flex: '0 0 28px', borderRadius: 7, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{proof.label}</div>
                        <div style={{ fontSize: 10, color: C.greenT, fontWeight: 600 }}>On file · tap to view</div>
                      </div>
                      <span style={{ color: C.mute3 }}><Eye size={15} /></span>
                    </div>
                  )}
                </div>
              </div>

              {/* UNITS — Unit Mix (one flat row per layout) + rent roll */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                {sectionIcon(Layers)}
                <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Unit Mix</div>
              </div>

              <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
                {unitsLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 16, fontSize: 13, color: C.mute3, background: '#fff' }}>
                    <Loader2 size={15} className="animate-spin" /> Loading units…
                  </div>
                ) : units.length === 0 ? (
                  <div style={{ padding: 16, fontSize: 13, color: C.mute3, background: '#fff' }}>No units yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ minWidth: 840 }}>
                      {/* header */}
                      <div style={{ display: 'grid', gridTemplateColumns: MIX_COLS, gap: 8, padding: '10px 14px', background: C.soft, borderBottom: `1px solid ${C.line}` }}>
                        {['Unit type', 'Bedrooms · Plan', 'Sqft', 'Units', 'Market Rent', 'Annual Rent', ''].map((h, i) => (
                          <div key={i} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', color: C.mute4, textTransform: 'uppercase', textAlign: i === 3 ? 'center' : (i === 2 || i === 4 || i === 5) ? 'right' : 'left' }}>{h}</div>
                        ))}
                      </div>

                      {/* one flat row per layout — no grouping; click opens the grouped detail popup */}
                      {mix.rows.map((r, i) => (
                        <div key={`${r.unitType}::${r.bedrooms ?? ''}::${r.label}`}
                          onClick={() => setPreviewLayout(r)}
                          title="View layout details"
                          style={{ display: 'grid', gridTemplateColumns: MIX_COLS, gap: 8, alignItems: 'center', padding: '11px 14px', borderTop: i === 0 ? 'none' : `1px solid ${C.line3}`, background: '#fff', cursor: 'pointer' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = C.soft2; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unitTypeLabel(r.unitType)}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.planLabel ? r.label : bedroomsLabel(r.bedrooms)}</div>
                          <div style={{ fontSize: 12.5, color: C.body, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{spanLabel(r.sqftLo, r.sqftHi)}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.ink2, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{r.count}</div>
                          {/* Market Rent — Σ units.rental_price (asking) for the layout */}
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: r.marketSum > 0 ? C.ink2 : C.mute3, fontVariantNumeric: 'tabular-nums' }}>{r.marketSum > 0 ? `AED ${aed(r.marketSum)}` : '—'}</span>
                            {r.unpriced > 0 && r.marketSum > 0 && <div style={{ fontSize: 9.5, color: C.amber, fontWeight: 600 }}>{r.unpriced} unpriced</div>}
                          </div>
                          {/* Annual Rent — Σ annual_rent of the income-counting lease (already net of discount); occupied units only */}
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: r.leaseSum > 0 ? C.ink2 : C.mute3, fontVariantNumeric: 'tabular-nums' }}>{r.leaseSum > 0 ? `AED ${aed(r.leaseSum)}` : '—'}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            {pricingEditable && r.planLabel && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); setEditLayout({ planLabel: r.planLabel, unitCount: r.count }); }}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
                                <Pencil size={12} /> Edit
                              </button>
                            )}
                          </div>
                        </div>
                      ))}

                      {/* total — the "sum of pricing as per mix" (rent roll = Σ rent × units) */}
                      <div style={{ display: 'grid', gridTemplateColumns: MIX_COLS, gap: 8, alignItems: 'center', padding: '12px 14px', borderTop: `2px solid ${C.line}`, background: C.greenBg2 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, letterSpacing: '.02em' }}>TOTAL</div>
                        <div />
                        <div />
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{mix.totalUnits}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {aed(mix.grandMarket)}</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {aed(mix.grandLease)}</div>
                        <div />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* caption + individual-units disclosure */}
              {!unitsLoading && units.length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, color: C.mute2, lineHeight: 1.5, marginBottom: 12 }}>
                    Tap a layout to see its grouped detail · Market Rent = Σ asking rent · Annual Rent = Σ current lease (running, or next term with cheques collected), net of discount (occupied units only){mix.unpriced > 0 ? ` · ${mix.unpriced} unit${mix.unpriced === 1 ? '' : 's'} not yet priced` : ''}{pricingEditable ? ' · use the Edit button to set a layout’s rent (applies to every unit on that layout).' : '.'}
                  </div>
                </>
              )}

              {/* LOCATION — details on the left, live Google map on the right */}
              {hasLocation && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    {sectionIcon(MapPin)}
                    <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Location</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: (isNarrow || !hasMapLink) ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 28, alignItems: 'stretch' }}>
                    {/* LEFT — address details */}
                    <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: '16px 18px', background: C.soft }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4 }}>FULL ADDRESS</div>
                      <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink2, marginTop: 5 }}>{fullAddressLine || 'Pinned on map'}</div>

                      {/* Individually-labelled fields (street, community, emirate, country, …) */}
                      {locCells.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '14px 18px', marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.line3}` }}>
                          {locCells.map((c) => (
                            <div key={c.label} style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: C.mute4, textTransform: 'uppercase' }}>{c.label}</div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink2, marginTop: 4, wordBreak: 'break-word', fontVariantNumeric: c.mono ? 'tabular-nums' : undefined }}>{c.value}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      {hasMapLink && (
                        <a href={`https://maps.google.com/?q=${p.latitude},${p.longitude}`} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 16, fontSize: 12.5, fontWeight: 700, color: C.greenT, textDecoration: 'none' }}>
                          Open in Google Maps <ExternalLink size={13} />
                        </a>
                      )}
                    </div>

                    {/* RIGHT — live Google map (only when the property is pinned).
                        Fixed height so the map always renders; the left card stretches to match. */}
                    {hasMapLink && p.latitude != null && p.longitude != null && (
                      <LocationMap latitude={p.latitude} longitude={p.longitude} label={p.buildingName} height={isTight ? 240 : 300} />
                    )}
                  </div>
                </>
              )}

              {/* DOCUMENTS */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {sectionIcon(FileText)}
                <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Documents</div>
                <span style={{ fontSize: 11.5, color: C.mute3 }}>{docsLoading ? 'Loading…' : docsSummary}</span>
                <div style={{ flex: 1 }} />
                {docsBusy && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.mute3 }}><Loader2 size={13} className="animate-spin" /> Working…</span>}
                {onFileCount > 0 && (
                  <button type="button" onClick={() => { const first = slots.find((s) => s.files.length > 0); if (first) { setReader(first.key); setReaderFile(0); } }}
                    style={{ fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '8px 14px', borderRadius: 9, cursor: 'pointer' }}>
                    View all
                  </button>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : 'repeat(2,1fr)', gap: 10 }}>
                {slots.map((slot) => {
                  const attached = slot.files.length > 0;
                  const multi = slot.files.length > 1;
                  const statusText = attached ? (multi ? `${slot.files.length} files` : 'Uploaded') : 'Not uploaded';
                  const statusColor = attached ? C.greenT : C.amber;
                  return (
                    <div key={slot.key}
                      onClick={() => { if (attached) { setReader(slot.key); setReaderFile(0); } else if (editable) { uploadToSlot(slot); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 11px', border: `1px solid ${attached ? C.greenBd2 : C.line}`, background: attached ? C.soft2 : '#fff', borderRadius: 11, cursor: attached || editable ? 'pointer' : 'default' }}>
                      <div style={{ position: 'relative', width: 42, height: 52, flex: '0 0 42px' }}>
                        {multi && <div style={{ position: 'absolute', left: 3, top: 3, width: 40, height: 50, background: '#fff', border: '1px solid #e2e7e1', borderRadius: 5 }} />}
                        {attached ? (
                          <div style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 50, background: '#fff', border: '1px solid #e2e7e1', borderRadius: 5, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: 5 }}>
                            <div style={{ width: 14, height: 14, borderRadius: 3, background: C.green }} />
                            <div style={{ height: 3, width: '80%', background: '#e6eae5', borderRadius: 2, marginTop: 5 }} />
                            <div style={{ height: 3, width: '92%', background: '#eef1ec', borderRadius: 2, marginTop: 3 }} />
                            <div style={{ height: 3, width: '70%', background: '#eef1ec', borderRadius: 2, marginTop: 3 }} />
                          </div>
                        ) : (
                          <div style={{ position: 'absolute', left: 0, top: 0, width: 40, height: 50, border: '1.5px dashed #d6ddd6', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bcc4bd' }}><Plus size={14} /></div>
                        )}
                        {multi && <span style={{ position: 'absolute', right: -4, bottom: -4, minWidth: 17, height: 17, padding: '0 4px', borderRadius: 9, background: C.green, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{slot.files.length}</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slot.label}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: statusColor, marginTop: 2 }}>{statusText}</div>
                      </div>
                      {attached ? (
                        <span style={{ color: C.mute3, flex: '0 0 auto' }}><Eye size={15} /></span>
                      ) : editable ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); uploadToSlot(slot); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', flex: '0 0 auto' }}>
                          <Upload size={13} />Upload
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>

            </div>
          </main>
        </div>
      </div>

      {/* ── LIGHTBOX ── */}
      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(12,20,15,.82)', display: 'flex', flexDirection: 'column', zIndex: 70 }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', color: '#fff' }}>
            <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{lb + 1} / {photos.length}</div>
            <div onClick={() => setLb(null)} style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><X size={18} /></div>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 16px' }}>
            {photos.length > 1 && (
              <div onClick={() => setLb((lb - 1 + photos.length) % photos.length)} style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: '50%', background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronLeft size={24} /></div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[lb].url} alt="" style={{ flex: 1, maxWidth: 820, maxHeight: '72%', objectFit: 'contain', borderRadius: 14 }} />
            {photos.length > 1 && (
              <div onClick={() => setLb((lb + 1) % photos.length)} style={{ width: 44, height: 44, flex: '0 0 44px', borderRadius: '50%', background: 'rgba(255,255,255,.16)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><ChevronRight size={24} /></div>
            )}
          </div>
          {photos.length > 1 && (
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: 18, overflowX: 'auto' }}>
              {photos.map((ph, i) => (
                <div key={ph.id} onClick={() => setLb(i)} style={{ width: 64, height: 46, flex: '0 0 64px', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', opacity: i === lb ? 1 : 0.5, border: `2px solid ${i === lb ? C.green : 'transparent'}` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ph.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENT READER ── */}
      {reader !== null && rSlot && (
        <div onClick={() => setReader(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,25,18,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isTight ? 0 : 22, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 900, maxHeight: '90vh', background: '#fff', borderRadius: isTight ? 0 : 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(15,30,22,.42)' }}>
            {/* reader header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 18px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
              <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, background: C.greenBg2, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Documents</div>
                <div style={{ fontSize: 11.5, color: C.mute3 }}>{docsSummary}</div>
              </div>
              <div onClick={() => setReader(null)} style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, border: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.body, cursor: 'pointer' }}><X size={17} /></div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: isTight ? 'column' : 'row' }}>
              {/* sidebar */}
              <aside style={{ width: isTight ? 'auto' : 236, flex: '0 0 auto', maxHeight: isTight ? 150 : 'none', overflowY: 'auto', borderRight: isTight ? 'none' : `1px solid ${C.line2}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 3, background: C.soft }}>
                {slots.map((s) => {
                  const attached = s.files.length > 0;
                  const selected = s.key === reader;
                  return (
                    <div key={s.key} onClick={() => { if (attached) { setReader(s.key); setReaderFile(0); } else if (editable) { uploadToSlot(s); } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 11px', borderRadius: 10, cursor: attached || editable ? 'pointer' : 'default', border: `1px solid ${selected ? C.greenBd : 'transparent'}`, background: selected ? C.greenBg : 'transparent' }}>
                      <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: 8, background: selected ? C.green : (attached ? C.greenBg2 : C.line4), color: selected ? '#fff' : (attached ? C.greenT : '#aab2ab'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={15} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: attached ? C.greenT : C.amber }}>{attached ? (s.files.length > 1 ? `${s.files.length} files` : 'Uploaded') : 'Not uploaded'}</div>
                      </div>
                      {!attached && editable && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); uploadToSlot(s); }}
                          style={{ fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, color: C.greenT, background: C.greenBg, border: `1px solid ${C.greenBd}`, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', flex: '0 0 auto' }}>Upload</button>
                      )}
                    </div>
                  );
                })}
              </aside>

              {/* preview */}
              <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.line2}`, flex: '0 0 auto' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rSlot.label}</div>
                    <div style={{ fontSize: 11, color: C.greenT, fontWeight: 600 }}>
                      {rActive
                        ? (rFiles.length > 1
                          ? `File ${rf + 1} of ${rFiles.length} · ${isImageFile(rActive) ? 'Image' : 'PDF'}`
                          : `${isImageFile(rActive) ? 'Image' : 'PDF'} · Uploaded`)
                        : 'Not uploaded yet'}
                    </div>
                  </div>
                  {rActive && (
                    <>
                      {editable && (
                        <button type="button" onClick={() => replaceFile(rSlot, rActive)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#3a443d', background: '#fff', border: '1px solid #e2e7e1', padding: '7px 11px', borderRadius: 8, cursor: 'pointer' }}>
                          <Replace size={14} />Replace
                        </button>
                      )}
                      {editable && (
                        <button type="button" onClick={() => removeFile(rActive)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: C.danger, background: '#fff', border: '1px solid #f0d8d3', padding: '7px 11px', borderRadius: 8, cursor: 'pointer' }}>
                          <Trash2 size={13} />{rFiles.length > 1 ? 'Remove file' : 'Remove'}
                        </button>
                      )}
                      {/* Download — available to the RP owner and any manager of the
                          landlord (backend allows read/download for all of them).
                          Managing (Replace/Remove) still requires `editable`. */}
                      <button type="button" title="Download this document"
                        onClick={() => { void downloadStoredDoc(rActive.id).catch(() => alert('Download failed. Please try again.')); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#fff', background: '#2e9f82', border: '1px solid #2e9f82', padding: '7px 11px', borderRadius: 8, cursor: 'pointer' }}>
                        <Download size={14} />Download
                      </button>
                    </>
                  )}
                </div>

                {/* cross-document nav */}
                {rActive && seq.length > 1 && (
                  <>
                    <div onClick={() => goSeq(-1)} style={{ position: 'absolute', left: 14, top: '62%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronLeft size={21} /></div>
                    <div onClick={() => goSeq(1)} style={{ position: 'absolute', right: 14, top: '62%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', background: '#fff', border: '1px solid #e2e7e1', boxShadow: '0 4px 14px rgba(20,40,30,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3a443d', cursor: 'pointer', zIndex: 5 }}><ChevronRight size={21} /></div>
                    <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 700, color: '#fff', background: 'rgba(20,40,30,.55)', padding: '5px 12px', borderRadius: 9, zIndex: 5 }}>{(curPos < 0 ? 0 : curPos) + 1} of {seq.length} files</div>
                  </>
                )}

                {/* multi-file tabs */}
                {rFiles.length > 1 && (
                  <div style={{ display: 'flex', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${C.line2}`, overflowX: 'auto', background: C.soft, flex: '0 0 auto' }}>
                    {rFiles.map((f, i) => (
                      <div key={f.id} onClick={() => setReaderFile(i)}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer', flex: '0 0 auto', border: `1px solid ${i === rf ? C.greenBd : C.line}`, background: i === rf ? C.greenBg : '#fff', color: i === rf ? C.greenT : C.body }}>
                        <span style={{ width: 18, height: 22, flex: '0 0 18px', borderRadius: 3, background: '#fff', border: '1px solid #d8e0d9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greenT, fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                        <span style={{ whiteSpace: 'nowrap', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* preview body */}
                {rActive ? (
                  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: C.line2, display: 'flex', justifyContent: 'center' }}>
                    {isImageFile(rActive) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={rActive.url} alt={rActive.name} style={{ maxWidth: '100%', alignSelf: 'flex-start', margin: 22, borderRadius: 8, boxShadow: '0 6px 22px rgba(20,40,30,.12)' }} />
                    ) : (
                      <iframe src={`${rActive.url}#toolbar=0&navpanes=0&statusbar=0&view=FitH`} title={rActive.name} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
                    )}
                  </div>
                ) : (
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 30, background: C.soft }}>
                    <div style={{ textAlign: 'center', maxWidth: 300 }}>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: '#fff', border: `1px solid ${C.line}`, color: C.greenT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}><Upload size={22} /></div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#3a443d', marginTop: 14 }}>{rSlot.label}</div>
                      <div style={{ fontSize: 12, color: C.mute3, marginTop: 5, lineHeight: 1.5 }}>
                        {editable ? "This document hasn't been uploaded yet. Add it now and it'll appear here." : 'This document has not been uploaded yet.'}
                      </div>
                      {editable && (
                        <button type="button" onClick={() => uploadToSlot(rSlot)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: '#fff', background: C.green, border: 'none', padding: '11px 20px', borderRadius: 10, cursor: 'pointer', marginTop: 16 }}>
                          <Upload size={16} />Upload document
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ── PER-LAYOUT DETAIL (read-only grouped view, opened from a Unit Mix row) ── */}
      {previewLayout && (() => {
        const lp = previewLayout.planLabel ?? '';
        const plan = plans.find((pl) => (pl.planLabel ?? '') === lp) ?? null;
        const unitsOnLayout = units.filter((u) => (u.planLabel ?? '') === lp);
        return (
          <LayoutPreviewModal
            title={previewLayout.label}
            planName={plan?.displayName ?? null}
            unitType={previewLayout.unitType}
            bedrooms={previewLayout.bedrooms}
            plan={plan}
            units={unitsOnLayout}
            propertyName={p.buildingName}
            leasingType={p.leasingType}
            canEdit={pricingEditable && !!previewLayout.planLabel}
            onEdit={() => { setEditLayout({ planLabel: previewLayout.planLabel, unitCount: previewLayout.count }); setPreviewLayout(null); }}
            onClose={() => setPreviewLayout(null)}
          />
        );
      })()}

      {/* ── PER-LAYOUT EDITOR (one popup: all unit details for every unit on the layout) ── */}
      {editLayout && (() => {
        const rep = units.find((u) => (u.planLabel ?? '') === (editLayout.planLabel ?? ''));
        if (!rep) return null;
        const plan = plans.find((pl) => (pl.planLabel ?? '') === (editLayout.planLabel ?? ''));
        return (
          <UnitFormModal
            open
            layoutBulk
            layoutUnitCount={editLayout.unitCount}
            title="Edit layout"
            propertyCategory={p.spaceCategory}
            leasingType={p.leasingType}
            propertyStandalone
            propertyId={property.id}
            planLabel={editLayout.planLabel}
            manager={managerScope}
            rpQ={pricingRpQ}
            feeRules={feeRules}
            existingFloorPlanUrl={plan?.floorPlanUrl ?? null}
            initial={unitToFormInitial(rep as unknown as UnitRecord)}
            onSave={async (data, floorPlan) => {
              await saveLayoutDetails({ propertyId: property.id, planLabel: editLayout.planLabel ?? '', data, floorPlan, manager: managerScope });
              loadUnits();
              loadFloorPlans();
            }}
            onClose={() => setEditLayout(null)}
          />
        );
      })()}
    </>
  );
}
