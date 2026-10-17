'use client';

/**
 * Catalogue › Add units — the REAL Spaces listing flow, presented as the Genspark listing
 * wizard (step list · form · live preview). Reached from /rental-provider/dashboard/units/add
 * when NO ?rp is present (an RP owner adding units to one of their own existing properties).
 * The manager property-creation + CSV-import wizard stays in page.tsx.
 *
 * Parity with previous page (AddUnitsExperience — Claude-Design scroll-spy form):
 *  Data / API (unchanged endpoints + payloads)
 *   [x] GET  /properties                          → property picker (search by name / address / category)
 *   [x] GET  /profiles/rental-provider/me         → "KYC under review" pill (complianceStatus = pending_review)
 *   [x] POST /properties/:pid/units               → one per unit row, same DTO keys and number coercion
 *   [x] POST /api/properties/:pid/units/:id/media       (FormData file) → each staged photo, in cover order
 *   [x] POST /api/properties/:pid/units/:id/floor-plan  (FormData file) → staged floor plan (hidden for standalone)
 *   [x] uploadOwnedDocument(unit, 'title_deed', legal)  → staged title deed (always saved to the UNIT)
 *   [x] GET  /properties/floor-plans?propertyId= + PATCH /properties/floor-plans/addendum-terms → listing addendum per layout
 *  Steps / fields (one step per previous section)
 *   [x] 1 Property: searchable picker, empty state → Portfolio "Add a property" (?add=1), "Need a new building?" link;
 *       switching category clears unit type + amenities (previous behaviour)
 *   [x] 2 Unit details: title, unit type * (unitTypesForCategory), unit number *, utility premises no.,
 *       bedrooms / bathrooms / furnishing (residential only — isResidentialUnitType via the effective category,
 *       so a warehouse never shows bedrooms), floor, view type-ahead (+ custom), parking, size sq.ft (→ sq.m)
 *   [x] 3 Pricing & fees: annual rent (auto-fills deposit / admin / commission at 5%, contract registration
 *       AED 220 residential only), security deposit, admin fee, contract registration fee, commission,
 *       service charges, additional payments (label / net / VAT rows, add + remove)
 *   [x] 4 Leasing terms: rental type, notice (days)
 *   [x] 5 Amenities (category list) + unit description
 *   [x] 6 Photos (up to 20, drag to reorder, first = cover, remove) · floor plan · title deed (replace / remove)
 *   [x] 7 Agreement addendum: template picker · Preview (PDF in new tab) · Write new / Edit (AddendumEditorModal)
 *   [x] Multi-unit: unit tabs, Add unit, Clone unit (clears number + files), Remove unit (≥ 2 units)
 *   [x] Validation: property required; unit number + unit type required per unit → jumps to the first bad unit
 *   [x] Save N units with phase progress bar · error banner · done screen with per-item errors,
 *       "Add more units" (full reset) and "Go to Units"; Cancel → back
 *  Added (Genspark): live preview card, "Preview & validate" checklist from the real form state, Gate 3 note.
 *  Listing quality: the "Listing readiness for review" checklist and the live preview now use the SHARED scorer
 *   (src/lib/os/listingQuality.ts, scoreListing) — the same one Catalogue › Units & listings uses on saved units,
 *   so the score here equals the score there (photos = staged photos, floor plan = staged floor plan, not
 *   applicable on a standalone property). Each missing item has a labelled "Fix" that jumps to its step.
 *   The previous five readiness checks are all still there, as scorer checks: photos (now ≥ 5, + ≥ 10 for best),
 *   annual rent set, size set, description (now 300+ characters), no phone numbers / emails / links; added title,
 *   floor plan, bedrooms / bathrooms (residential only), 3+ amenities. Saving is still never blocked by quality.
 *  Changed on purpose:
 *   - Staff accommodation (unitHasRooms) asks for Rooms instead of Bedrooms, like UnitFormModal; it posts
 *     `rooms` and omits `bedrooms`. Non-residential units no longer post the hidden default bedrooms=1 /
 *     furnishing='Unfurnished' (the fields were never shown for them).
 *   - The full-screen slide-over takeover is replaced by the OS page layout (Back / Cancel navigate directly).
 * What saving does: units are created as DRAFT listings. This flow does not submit them for review —
 * each listing is submitted for UpNow review (Gate 3) from Catalogue › Units & listings ("Submit listing").
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, ImagePlus, Loader2, Plus, X } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import {
  unitTypesForCategory, FURNISHING_OPTIONS, UNIT_TYPE_LABELS,
  getAmenitiesForCategory, RENTAL_TYPE_OPTIONS, sqmFromSqft,
} from '@/components/upnow/UnitFormModal';
import { isResidentialUnitType, isLandUnitType, unitHasRooms, isRentVatable } from '@/lib/unitTaxonomy';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumTemplatePicker from '@/components/upnow/AddendumTemplatePicker';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { openAddendumPdfInNewTab } from '@/lib/openAddendumPdf';
import {
  Btn, Callout, Card, Checklist, Evid, Field, OsPage, PageHead, Pill, ScopeStrip, SearchField, TableWrap,
  EmptyRow, SkeletonRows, ErrorRow, fmtAed,
} from '@/components/os/kit';
import { scoreListing, hasContactDetails, QUALITY_GOOD, DESCRIPTION_MIN, type ListingQuality } from '@/lib/os/listingQuality';
import { QualityMeter, QualityPanel } from '../_quality';

/* ─── types ───────────────────────────────────────────────────────────────── */
interface WizardProperty {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
  isStandaloneUnit?: boolean;
}

interface StagedPhoto { file: File; previewUrl: string; }

interface UnitRow {
  id: string;
  unitName: string;
  unitType: string;
  unitTier: string;
  unitNumber: string;
  floor: string;
  premiseNumber: string;
  bedrooms: string;
  bathrooms: string;
  rooms: string;
  parkingSpaces: string;
  unitSizeSqft: string;
  unitSizeSqm: string;
  furnishing: string;
  rentalPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  serviceCharges: string;
  view: string;
  amenities: string[];
  minLeaseMonths: string;
  noticePeriodDays: string;
  rentEscalationPct: string;
  rentalType: string;
  numberOfPayments: string;
  advancePayment: string;
  gracePeriodDays: string;
  latePaymentFee: string;
  additionalPayments: Array<{ label: string; amount: string; vat: string }>;
  description: string;
  stagedPhotos: StagedPhoto[];
  stagedFloorPlan: File | null;
  stagedTitleDeed: File | null;
}

function emptyRow(): UnitRow {
  return {
    id: Math.random().toString(36).slice(2),
    unitName: '', unitType: '', unitTier: 'standard', unitNumber: '',
    floor: '', premiseNumber: '', bedrooms: '1', bathrooms: '1', rooms: '', parkingSpaces: '', unitSizeSqft: '', unitSizeSqm: '',
    furnishing: 'Unfurnished', rentalPrice: '',
    securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '', serviceCharges: '',
    view: '', amenities: [], minLeaseMonths: '12', noticePeriodDays: '60', rentEscalationPct: '',
    rentalType: 'yearly', numberOfPayments: '', advancePayment: '', gracePeriodDays: '', latePaymentFee: '',
    additionalPayments: [], description: '', stagedPhotos: [], stagedFloorPlan: null, stagedTitleDeed: null,
  };
}

const SPACE_CATEGORY_LABELS: Record<string, string> = {
  residential: 'Residential', commercial: 'Commercial', industrial: 'Industrial',
  workspaces: 'Workspaces', venues: 'Venues', land: 'Land', mixed_use: 'Mixed-use',
};
const spaceCategoryLabel = (c: string) =>
  SPACE_CATEGORY_LABELS[c] ?? (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Property');
const typeLabel = (t: string) => UNIT_TYPE_LABELS[t] ?? t.replace(/_/g, ' ');

const VIEW_OPTIONS = [
  'Sea View', 'Partial Sea View', 'Full Sea View', 'Beach View', 'Marina View',
  'Canal View', 'Lake View', 'Lagoon View', 'Pool View', 'Garden View',
  'Park View', 'Community View', 'Courtyard View', 'City View', 'Skyline View',
  'Downtown View', 'Landmark View', 'Burj View', 'Golf Course View', 'Mountain View',
  'Desert View', 'Road View', 'Street View', 'Creek View', 'Harbour View',
  'Waterfront View', 'Palm View', 'Panoramic View', 'Open View',
  'Burj Khalifa View', 'Palm Jumeirah View', 'Dubai Marina View', 'Fountain View',
];

type StepId = 'prop' | 'details' | 'pricing' | 'leasing' | 'amenities' | 'media' | 'addendum' | 'validate' | 'save' | 'done';
const STEPS: { id: StepId; t: string; d: string }[] = [
  { id: 'prop',      t: 'Property',                d: 'The building these units belong to' },
  { id: 'details',   t: 'Unit details',            d: 'Identity, layout and size' },
  { id: 'pricing',   t: 'Pricing & fees',          d: 'Annual rent and one-off charges' },
  { id: 'leasing',   t: 'Leasing terms',           d: 'Defaults new contracts will use' },
  { id: 'amenities', t: 'Amenities & description', d: 'What the unit offers' },
  { id: 'media',     t: 'Photos & documents',      d: 'Photos, floor plan, title deed' },
  { id: 'addendum',  t: 'Agreement addendum',      d: 'Optional · applies to every new unit' },
  { id: 'validate',  t: 'Preview & validate',      d: 'Checklist before saving' },
  { id: 'save',      t: 'Save units',              d: 'Created as draft listings' },
  { id: 'done',      t: 'Review status',           d: 'Gate 3 · listing approval' },
];
const UNIT_STEPS: StepId[] = ['details', 'pricing', 'leasing', 'amenities', 'media'];


/** Staff accommodation: rooms are optional, but a whole number 1–5,000 when given (UnitFormModal rule). */
const roomsError = (r: UnitRow) => {
  if (!unitHasRooms(r.unitType) || !r.rooms.trim()) return null;
  const n = Number(r.rooms);
  return !Number.isInteger(n) || n < 1 || n > 5000 ? 'Enter the number of rooms (1–5,000)' : null;
};

/* ══════════════════════════════════════════════════════════════════════════ */
export default function AddUnitsExperience({ backHref }: { backHref: string }) {
  const router = useRouter();
  const goBack = () => router.push(backHref);

  const [existingProps, setExistingProps] = useState<WizardProperty[]>([]);
  const [propsState, setPropsState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [selectedPropCat, setSelectedPropCat] = useState('');
  const [propQuery, setPropQuery] = useState('');
  const [kycReview, setKycReview] = useState(false);

  const [rows, setRows] = useState<UnitRow[]>([emptyRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof UnitRow, string>>>>({});
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>('prop');

  const [addendumTerms, setAddendumTerms] = useState<AddendumTerms>(emptyAddendumTerms());
  const [addendumEditorOpen, setAddendumEditorOpen] = useState(false);
  const [addendumPreviewBusy, setAddendumPreviewBusy] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [doneErrs, setDoneErrs] = useState<string[]>([]);
  const [savedPropId, setSavedPropId] = useState<number | null>(null);

  const fetchProps = () => apiGet<WizardProperty[]>('/properties')
    .then((p) => { setExistingProps(p); setPropsState('ok'); })
    .catch(() => setPropsState('error'));
  const loadProps = () => { setPropsState('loading'); void fetchProps(); };
  useEffect(() => {
    void fetchProps();
    apiGet<{ complianceStatus?: string }>('/profiles/rental-provider/me')
      .then(p => setKycReview(p?.complianceStatus === 'pending_review'))
      .catch(() => {});
  }, []);

  /* ── row helpers ── */
  const updRow = (id: string, patch: Partial<UnitRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    const keys = Object.keys(patch) as (keyof UnitRow)[];
    setRowErrors(prev => {
      const next = { ...prev };
      if (next[id]) keys.forEach(k => { delete next[id][k]; });
      return next;
    });
  };

  const selectedProp   = existingProps.find(p => p.id === selectedPropId) ?? null;
  const propStandalone = !!selectedProp?.isStandaloneUnit;
  const propCategory   = selectedProp?.spaceCategory ?? '';

  const activeId  = rows.find(r => r.id === activeRowId)?.id ?? rows[0]?.id ?? '';
  const activeIdx = Math.max(0, rows.findIndex(r => r.id === activeId));
  const active    = rows[activeIdx];
  const aErr      = rowErrors[activeId] ?? {};
  const upd       = (patch: Partial<UnitRow>) => updRow(activeId, patch);
  const aps       = active?.additionalPayments ?? [];

  // Field applicability (unchanged rule): Bedrooms + Bathrooms + Furnishing are ONE
  // residential-only group, gated by the EFFECTIVE category. A unit's type wins
  // (isResidentialUnitType); before a type is picked we fall back to the property's base
  // category, so an industrial / commercial building never shows beds/baths. Existing
  // mixed-use properties fall back to residential, as before.
  const rowResidential = (r?: { unitType?: string }) => {
    const t = r?.unitType ?? '';
    const fromType = t ? (isLandUnitType(t) ? 'land' : (isResidentialUnitType(t) ? 'residential' : 'commercial')) : null;
    const base = propCategory === 'residential' || propCategory === 'mixed_use' ? 'residential'
      : propCategory === 'land' ? 'land' : 'commercial';
    return (fromType ?? base) === 'residential';
  };
  const showResi          = rowResidential(active);  // beds (or rooms) + baths + furnishing
  const isResidentialUnit = showResi;                // contract registration default (AED 220) is residential-only
  const showRooms         = unitHasRooms(active?.unitType);

  /* ── unit tabs ── */
  const addUnitTab = () => { const r = emptyRow(); setRows(prev => [...prev, r]); setActiveRowId(r.id); };
  const cloneUnitTab = () => {
    const src = rows.find(r => r.id === activeId);
    if (!src) return;
    const dup: UnitRow = { ...src, id: Math.random().toString(36).slice(2), unitNumber: '', stagedPhotos: [], stagedFloorPlan: null, stagedTitleDeed: null };
    setRows(prev => { const i = prev.findIndex(r => r.id === activeId); const next = [...prev]; next.splice(i + 1, 0, dup); return next; });
    setActiveRowId(dup.id);
  };
  const removeUnitTab = (id: string) => {
    if (rows.length <= 1) return;
    const next = rows.filter(r => r.id !== id);
    setRows(next);
    if (id === activeId) setActiveRowId(next[0].id);
  };

  /* ── photos / docs (active row) ── */
  const stagePhotos = (files: File[]) => {
    const add = files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }));
    setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedPhotos: [...r.stagedPhotos, ...add].slice(0, 20) } : r));
  };
  const removePhoto = (idx: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== activeId) return r;
      const next = [...r.stagedPhotos];
      URL.revokeObjectURL(next[idx].previewUrl);
      next.splice(idx, 1);
      return { ...r, stagedPhotos: next };
    }));
  };
  const reorderPhotos = (next: StagedPhoto[]) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedPhotos: next } : r));
  const setFloorPlan  = (file: File | null) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedFloorPlan: file } : r));
  const setTitleDeed  = (file: File | null) => setRows(prev => prev.map(r => r.id === activeId ? { ...r, stagedTitleDeed: file } : r));

  /* ── property picker ── */
  const q = propQuery.trim().toLowerCase();
  const filteredProps = existingProps.filter(p =>
    !q || `${p.buildingName} ${p.fullAddress ?? ''} ${spaceCategoryLabel(p.spaceCategory)}`.toLowerCase().includes(q));
  const pickProp = (p: WizardProperty) => {
    const catChanged = p.spaceCategory !== selectedPropCat;
    setSelectedPropId(p.id); setSelectedPropCat(p.spaceCategory); setError(null);
    setRows(prev => prev.map(r => ({ ...r, amenities: [], ...(catChanged ? { unitType: '' } : {}) })));
  };

  /* ── Preview & validate — computed from the real form state ── */
  const unitChecks = useMemo(() => rows.map((r) => {
    const rErr = roomsError(r);
    const required: { l: string; sub?: string; state: 'pass' | 'fail' }[] = [
      { l: 'Unit number', sub: r.unitNumber.trim() || 'Required', state: r.unitNumber.trim() ? 'pass' : 'fail' },
      { l: 'Unit type', sub: r.unitType ? typeLabel(r.unitType) : 'Required', state: r.unitType ? 'pass' : 'fail' },
    ];
    if (rErr) required.push({ l: 'Rooms', sub: rErr, state: 'fail' });
    // Listing readiness = the shared listing-quality scorer, fed the same fields the unit is
    // saved with (unitName → title, staged photos → media, staged floor plan → floor plan).
    const quality: ListingQuality = scoreListing({
      title: r.unitName, unitNumber: r.unitNumber, description: r.description,
      photoCount: r.stagedPhotos.length, hasFloorPlan: !!r.stagedFloorPlan, floorPlanApplicable: !propStandalone,
      unitType: r.unitType, rent: r.rentalPrice, sizeSqft: r.unitSizeSqft,
      bedrooms: r.bedrooms, rooms: r.rooms, bathrooms: r.bathrooms, amenityCount: r.amenities.length,
    });
    return { row: r, required, quality };
  }), [rows, propStandalone]);
  const propCheck = { l: 'Property selected', sub: selectedProp?.buildingName ?? 'Pick the building first', state: selectedProp ? 'pass' as const : 'fail' as const };
  const requiredOk = !!selectedProp && unitChecks.every(u => u.required.every(c => c.state === 'pass'));
  const goodUnits = unitChecks.filter(u => u.quality.score >= QUALITY_GOOD).length;
  const openQualityItems = unitChecks.reduce((n, u) => n + u.quality.missing.length, 0);

  /* ── validate + save ── */
  const validate = (): boolean => {
    if (!selectedPropId) { setError('Select a property to add units to.'); setStep('prop'); return false; }
    let ok = true;
    const errs: typeof rowErrors = {};
    for (const r of rows) {
      const e: Partial<Record<keyof UnitRow, string>> = {};
      if (!r.unitNumber.trim()) { e.unitNumber = 'Required'; ok = false; }
      if (!r.unitType)          { e.unitType   = 'Required'; ok = false; }
      const rErr = roomsError(r);
      if (rErr) { e.rooms = rErr; ok = false; }
      if (Object.keys(e).length) errs[r.id] = e;
    }
    setRowErrors(errs);
    if (!ok) { const first = Object.keys(errs)[0]; if (first) { setActiveRowId(first); setStep('details'); } }
    return ok;
  };

  const handleSaveAll = async () => {
    setError(null);
    if (!validate()) return;
    setSaving(true);
    const errs: string[] = [];
    try {
      const propId = selectedPropId!;
      const propName = existingProps.find(p => p.id === propId)?.buildingName ?? 'Property';

      /* 1. Create units */
      const unitIds: { rowId: string; unitId: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const resi = rowResidential(r);
        const hasRooms = unitHasRooms(r.unitType);
        setSaveProgress({ phase: `Creating units… (${i + 1}/${rows.length})`, done: i, total: rows.length });
        try {
          const created = await apiPost<{ id: number }>(`/properties/${propId}/units`, {
            unitName:          r.unitName        || undefined,
            unitType:          r.unitType,
            unitTier:          r.unitTier || 'standard',
            unitNumber:        r.unitNumber,
            floor:             r.floor           || undefined,
            premiseNumber:     r.premiseNumber   || undefined,
            // Bedrooms are residential-only (never a warehouse / shop); staff accommodation counts rooms instead.
            bedrooms:          resi && !hasRooms && r.bedrooms && r.bedrooms !== 'Studio' ? Number(r.bedrooms) : undefined,
            ...(hasRooms && r.rooms.trim() ? { rooms: Number(r.rooms) } : {}),
            bathrooms:         r.bathrooms       ? Number(r.bathrooms)       : undefined,
            parkingSpaces:     r.parkingSpaces   ? Number(r.parkingSpaces)   : undefined,
            unitSizeSqft:      r.unitSizeSqft    ? Number(r.unitSizeSqft)    : undefined,
            unitSizeSqm:       r.unitSizeSqm     ? Number(r.unitSizeSqm)     : undefined,
            rentalPrice:       r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            securityDeposit:   r.securityDeposit ? Number(r.securityDeposit) : undefined,
            adminFee:          r.adminFee        ? Number(r.adminFee)        : undefined,
            ejariFeeFils:      r.ejariFeeFils    ? Number(r.ejariFeeFils)    : undefined,
            commission:        r.commission      ? Number(r.commission)      : undefined,
            serviceCharges:    r.serviceCharges  ? Number(r.serviceCharges)  : undefined,
            minLeaseMonths:    r.minLeaseMonths   ? Number(r.minLeaseMonths)   : undefined,
            noticePeriodDays:  r.noticePeriodDays ? Number(r.noticePeriodDays) : undefined,
            rentEscalationPct: r.rentEscalationPct ? Number(r.rentEscalationPct) : undefined,
            rentalType:        r.rentalType       || undefined,
            numberOfPayments:  r.numberOfPayments ? Number(r.numberOfPayments) : undefined,
            advancePayment:    r.advancePayment   ? Number(r.advancePayment)   : undefined,
            gracePeriodDays:   r.gracePeriodDays  ? Number(r.gracePeriodDays)  : undefined,
            latePaymentFee:    r.latePaymentFee   ? Number(r.latePaymentFee)   : undefined,
            additionalPayments: (r.additionalPayments ?? [])
              .map(p => ({ label: p.label.trim(), amount: Number(p.amount) || 0, vat: p.vat ? Number(p.vat) : 0 }))
              .filter(p => p.label !== '' && p.amount > 0),
            view:              r.view            || undefined,
            furnishing:        resi ? (r.furnishing || undefined) : undefined,
            amenities:         r.amenities.length ? r.amenities : undefined,
            description:       r.description     || undefined,
          });
          unitIds.push({ rowId: r.id, unitId: created.id });
        } catch (e) {
          errs.push(`Unit "${r.unitNumber}": ${e instanceof Error ? e.message : 'create failed'}`);
        }
      }

      /* 2. Photos */
      const photoRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedPhotos.length);
      if (photoRows.length) {
        const totalPhotos = photoRows.reduce((sum, { rowId }) => sum + (rows.find(r => r.id === rowId)?.stagedPhotos.length ?? 0), 0);
        let photoDone = 0;
        setSaveProgress({ phase: 'Uploading photos…', done: 0, total: totalPhotos });
        for (const { rowId, unitId } of photoRows) {
          const row = rows.find(r => r.id === rowId)!;
          for (const sp of row.stagedPhotos) {
            try {
              const fd = new FormData(); fd.append('file', sp.file);
              await fetch(`/api/properties/${propId}/units/${unitId}/media`, { method: 'POST', body: fd, credentials: 'include' });
            } catch { errs.push(`Photo for unit "${row.unitNumber}": upload failed`); }
            photoDone++;
            setSaveProgress({ phase: 'Uploading photos…', done: photoDone, total: totalPhotos });
          }
        }
      }

      /* 3. Floor plans */
      const planRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedFloorPlan);
      if (planRows.length) {
        let planDone = 0;
        setSaveProgress({ phase: 'Uploading floor plans…', done: 0, total: planRows.length });
        for (const { rowId, unitId } of planRows) {
          const row = rows.find(r => r.id === rowId)!;
          try {
            const fd = new FormData(); fd.append('file', row.stagedFloorPlan!);
            const res = await fetch(`/api/properties/${propId}/units/${unitId}/floor-plan`, { method: 'POST', body: fd, credentials: 'include' });
            if (!res.ok) throw new Error();
          } catch { errs.push(`Floor plan for unit "${row.unitNumber}": upload failed`); }
          planDone++;
          setSaveProgress({ phase: 'Uploading floor plans…', done: planDone, total: planRows.length });
        }
      }

      /* 4. Title deeds — always saved to the UNIT (documentKey 'title_deed') */
      const deedRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedTitleDeed);
      if (deedRows.length) {
        let deedDone = 0;
        setSaveProgress({ phase: 'Uploading title deeds…', done: 0, total: deedRows.length });
        for (const { rowId, unitId } of deedRows) {
          const row = rows.find(r => r.id === rowId)!;
          try {
            await uploadOwnedDocument({ ownerType: 'unit', ownerId: unitId, documentKey: 'title_deed', category: 'legal', displayName: 'Title deed', file: row.stagedTitleDeed! });
          } catch (e) { errs.push(`Title deed for unit "${row.unitNumber}": ${e instanceof Error ? e.message : 'upload failed'}`); }
          deedDone++;
          setSaveProgress({ phase: 'Uploading title deeds…', done: deedDone, total: deedRows.length });
        }
      }

      /* 5. Apply the listing's in-app Agreement addendum to the new layout(s). */
      if (hasAddendumTerms(addendumTerms) && unitIds.length) {
        setSaveProgress({ phase: 'Saving addendum…', done: 0, total: 1 });
        try {
          const fp = await apiGet<{ plans: Array<{ planLabel: string | null }> }>(`/properties/floor-plans?propertyId=${propId}`);
          const labels = Array.from(new Set((fp.plans ?? []).map(p => p.planLabel).filter((l): l is string => !!l)));
          for (const planLabel of labels) {
            await apiPatch('/properties/floor-plans/addendum-terms', { propertyId: propId, planLabel, terms: addendumTerms });
          }
        } catch { errs.push('Addendum: could not be saved to the new layout(s) — add it from the Units page.'); }
      }

      setDoneErrs(errs);
      setDoneMsg(`${propName} · ${unitIds.length} unit${unitIds.length !== 1 ? 's' : ''} saved.`);
      setSavedPropId(propId);
      setDone(true);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — please try again.');
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  const resetForMore = () => {
    setDone(false); setRows([emptyRow()]); setActiveRowId(null);
    setSelectedPropId(null); setSelectedPropCat(''); setPropQuery('');
    setDoneErrs([]); setError(null); setAddendumTerms(emptyAddendumTerms()); setSavedPropId(null); setStep('prop');
  };

  /* ── wizard navigation ── */
  const stepIdx = STEPS.findIndex(s => s.id === step);
  const stepEnabled = (id: StepId) => {
    if (done) return id === 'done';
    if (id === 'done') return false;
    if (id === 'prop') return true;
    return !!selectedProp;
  };
  const next = STEPS[stepIdx + 1]?.id;
  const prev = STEPS[stepIdx - 1]?.id;
  const isUnitStep = UNIT_STEPS.includes(step);

  const addendumCount = (addendumTerms.en?.filter(l => l.trim()).length ?? 0) + (addendumTerms.ar?.filter(l => l.trim()).length ?? 0);
  const cover = active?.stagedPhotos[0]?.previewUrl ?? null;
  // The active unit's score — the same scorer (and so the same number) as Units & listings.
  const activeQuality = unitChecks[activeIdx]?.quality ?? null;
  const vatable = active?.unitType ? isRentVatable(active.unitType, propCategory) : null;

  /* ══════════════════════════════════════════════════════════════════════════ */
  return (
    <OsPage>
      <PageHead
        eyebrow="Catalogue"
        title="Add units"
        lede="Add units to one of your properties. Each unit is saved as a draft listing — you submit it for UpNow review from Units & listings."
        actions={<>
          {kycReview && <Pill tone="amber">KYC under review</Pill>}
          <Btn onClick={goBack}>Back to units</Btn>
        </>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Catalogue' },
        { label: 'Vertical', value: 'Spaces' },
        { label: 'Property', value: selectedProp ? `${selectedProp.buildingName || 'Unnamed property'} · ${spaceCategoryLabel(selectedProp.spaceCategory)}` : 'Not chosen' },
        { label: 'Units', value: `${rows.length} in this batch` },
      ]} />

      <section className="gx-card">
        <div className="gx-wz">
          <nav className="gx-wz-steps" aria-label="Add units steps">
            {STEPS.map((sx, i) => {
              const isDone = done ? i < STEPS.length - 1 : i < stepIdx;
              return (
                <button key={sx.id} type="button" className={`gx-wz-s${isDone ? ' done' : ''}`}
                  aria-current={sx.id === step ? 'step' : undefined}
                  disabled={!stepEnabled(sx.id)} onClick={() => setStep(sx.id)}
                  style={!stepEnabled(sx.id) && sx.id !== step ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
                  <span className="n">{isDone ? '✓' : i + 1}</span>
                  <span><span className="t">{sx.t}</span><span className="d">{sx.d}</span></span>
                </button>
              );
            })}
            <div style={{ marginTop: 12, padding: '0 8px', fontSize: 10.5, color: 'var(--ms-ink-3)', lineHeight: 1.45 }}>
              {rows.length} unit{rows.length !== 1 ? 's' : ''} in this batch. Fill each step, then clone or add another unit.
            </div>
          </nav>

          <div className="gx-wz-main">
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{stepIdx + 1}. {STEPS[stepIdx].t}</h2>
            <p style={{ fontSize: 12, color: 'var(--ms-ink-3)', marginBottom: 14 }}>{STEPS[stepIdx].d}</p>

            {/* Unit tabs — per-unit steps only */}
            {isUnitStep && selectedProp && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--ms-surface-3)' }}>
                <div className="gx-chips" role="group" aria-label="Units in this batch" style={{ flex: 1 }}>
                  {rows.map((r, i) => (
                    <button key={r.id} type="button" className="gx-chip" aria-pressed={r.id === activeId} onClick={() => setActiveRowId(r.id)}
                      title={rowErrors[r.id] && Object.keys(rowErrors[r.id]).length ? 'This unit has errors' : undefined}>
                      Unit {i + 1}{r.unitNumber.trim() ? ` · ${r.unitNumber.trim()}` : ''}
                      {rowErrors[r.id] && Object.keys(rowErrors[r.id]).length > 0 && <span style={{ color: 'var(--ms-danger)', marginLeft: 4 }}>!</span>}
                    </button>
                  ))}
                </div>
                <Btn size="sm" onClick={cloneUnitTab}>Clone unit</Btn>
                <Btn size="sm" onClick={addUnitTab}>Add unit</Btn>
                {rows.length > 1 && <Btn size="sm" variant="danger" onClick={() => removeUnitTab(activeId)}>Remove unit {activeIdx + 1}</Btn>}
              </div>
            )}

            {/* 1 · PROPERTY */}
            {step === 'prop' && (
              propsState === 'ok' && existingProps.length === 0 ? (
                <Callout tone="info" title="No properties yet.">
                  Create a property first, then come back to add its units. <Link href="/rental-provider/dashboard/portfolio?add=1">Add a property</Link>
                </Callout>
              ) : (
                <>
                  <TableWrap toolbar={<SearchField value={propQuery} onChange={setPropQuery} placeholder="Search building, area or emirate…" />}>
                    <table className="gx-tbl">
                      <thead><tr><th>Property</th><th>Category</th><th>Type</th><th className="act" /></tr></thead>
                      {propsState === 'loading' ? <SkeletonRows rows={4} cols={4} />
                        : propsState === 'error' ? <ErrorRow cols={4} onRetry={loadProps} />
                        : filteredProps.length === 0 ? <EmptyRow cols={4} title={`No properties match “${propQuery}”.`} text="Clear the search, or add a new building on the Portfolio page." />
                        : (
                          <tbody>
                            {filteredProps.map(p => {
                              const on = p.id === selectedPropId;
                              return (
                                <tr key={p.id} className="click" onClick={() => pickProp(p)} aria-selected={on}
                                  style={on ? { background: 'var(--ms-tint)' } : undefined}>
                                  <td className="strong">{p.buildingName || 'Unnamed property'}{p.fullAddress && <div className="sub">{p.fullAddress}</div>}</td>
                                  <td><Pill tone="outline" dot={false}>{spaceCategoryLabel(p.spaceCategory)}</Pill></td>
                                  <td>{p.isStandaloneUnit ? 'Standalone unit' : 'Building'}</td>
                                  <td className="act">
                                    {on ? <Pill tone="primary">Selected</Pill>
                                      : <Btn size="xs" variant="primary" onClick={() => pickProp(p)}>Select</Btn>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        )}
                    </table>
                  </TableWrap>
                  <div className="gx-hint" style={{ marginTop: 8 }}>
                    Need a new building? <Link href="/rental-provider/dashboard/portfolio?add=1">Add a property</Link> on the Portfolio page.
                    The unit form adapts to the property&apos;s category.
                  </div>
                </>
              )
            )}

            {/* 2 · UNIT DETAILS */}
            {step === 'details' && active && (
              <>
                <Field label="Listing unit title" htmlFor="au-title">
                  <input id="au-title" className="gx-inp" placeholder="e.g. Spacious 2BR Apartment with Balcony in Al Raffa" value={active.unitName} onChange={e => upd({ unitName: e.target.value })} />
                </Field>
                <div className="gx-two">
                  <Field label="Unit type *" htmlFor="au-type" error={aErr.unitType}>
                    <select id="au-type" className="gx-sel" value={active.unitType} onChange={e => upd({ unitType: e.target.value })}>
                      <option value="">Select type</option>
                      {unitTypesForCategory(propCategory).map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
                    </select>
                  </Field>
                  <Field label="Unit number *" htmlFor="au-num" error={aErr.unitNumber}>
                    <input id="au-num" className="gx-inp" placeholder="e.g. 101, G-02" value={active.unitNumber} onChange={e => upd({ unitNumber: e.target.value })} />
                  </Field>
                </div>
                <Field label="Utility premises no." htmlFor="au-prem">
                  <input id="au-prem" className="gx-inp" placeholder="e.g. 1234567" value={active.premiseNumber} onChange={e => upd({ premiseNumber: e.target.value })} />
                </Field>

                {showResi ? (
                  <>
                    {showRooms ? (
                      <Field label="Rooms" htmlFor="au-rooms" error={aErr.rooms} hint={aErr.rooms ? undefined : 'Rooms in this block, let as one unit under one lease.'}>
                        <input id="au-rooms" className="gx-inp" type="number" min="1" max="5000" step="1" inputMode="numeric" placeholder="e.g. 65"
                          value={active.rooms} onChange={e => upd({ rooms: e.target.value })} />
                      </Field>
                    ) : (
                      <Field label="Bedrooms">
                        <div className="gx-chips" role="group" aria-label="Bedrooms">
                          {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                            <button key={b} type="button" className="gx-chip" aria-pressed={active.bedrooms === b} onClick={() => upd({ bedrooms: b })}>{b === 'Studio' ? 'Studio' : `${b} BR`}</button>
                          ))}
                        </div>
                      </Field>
                    )}
                    <Field label="Bathrooms">
                      <div className="gx-chips" role="group" aria-label="Bathrooms">
                        {['1', '2', '3', '4', '5+'].map(b => (
                          <button key={b} type="button" className="gx-chip" aria-pressed={active.bathrooms === b} onClick={() => upd({ bathrooms: b })}>{b}</button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Furnishing">
                      <div className="gx-chips" role="group" aria-label="Furnishing">
                        {FURNISHING_OPTIONS.map(f => <button key={f} type="button" className="gx-chip" aria-pressed={active.furnishing === f} onClick={() => upd({ furnishing: f })}>{f}</button>)}
                      </div>
                    </Field>
                  </>
                ) : (
                  <div style={{ marginBottom: 13 }}>
                    <Evid>No bedrooms, bathrooms or furnishing for a {active.unitType ? typeLabel(active.unitType).toLowerCase() : `${spaceCategoryLabel(propCategory).toLowerCase()} unit`} — those fields are residential only.</Evid>
                  </div>
                )}

                <div className="gx-two">
                  <Field label="Floor" htmlFor="au-floor">
                    <input id="au-floor" className="gx-inp" placeholder="e.g. G, 1, 2…" value={active.floor} onChange={e => upd({ floor: e.target.value })} />
                  </Field>
                  <Field label="Parking" htmlFor="au-park">
                    <input id="au-park" className="gx-inp" type="number" min="0" step="1" placeholder="e.g. 1" value={active.parkingSpaces} onChange={e => upd({ parkingSpaces: e.target.value })} />
                  </Field>
                </div>
                <Field label="View" htmlFor="au-view">
                  <ViewInput id="au-view" value={active.view} onChange={v => upd({ view: v })} />
                </Field>
                <Field label="Size (sq.ft) *" htmlFor="au-size" error={aErr.unitSizeSqft}
                  hint={`≈ ${active.unitSizeSqm ? `${active.unitSizeSqm} sq.m` : '— sq.m'} · stored in both units`}>
                  <input id="au-size" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 1200" style={{ maxWidth: 320 }}
                    value={active.unitSizeSqft} onChange={e => upd({ unitSizeSqft: e.target.value, unitSizeSqm: sqmFromSqft(e.target.value) })} />
                </Field>
              </>
            )}

            {/* 3 · PRICING & FEES */}
            {step === 'pricing' && active && (
              <>
                <Field label="Annual rent (AED) *" htmlFor="au-rent" error={aErr.rentalPrice}
                  hint="Setting the rent pre-fills the deposit, admin fee and commission at 5% (and the AED 220 registration fee for residential units). Edit any of them below.">
                  <input id="au-rent" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 85000"
                    value={active.rentalPrice}
                    onChange={e => {
                      const val = e.target.value; const rent = parseFloat(val);
                      const patch: Partial<UnitRow> = { rentalPrice: val };
                      if (!isNaN(rent) && rent > 0) {
                        patch.securityDeposit = String(Math.round(rent * 0.05));
                        patch.adminFee        = String(Math.round(rent * 0.05));
                        patch.ejariFeeFils    = isResidentialUnit ? '220' : '';
                        patch.commission      = String(Math.round(rent * 0.05));
                      }
                      upd(patch);
                    }} />
                </Field>
                <Card title="Fees" sub="AED · one-off charges on the contract" pad>
                  <div className="gx-two">
                    <Field label="Security deposit" htmlFor="au-dep"><input id="au-dep" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 10000" value={active.securityDeposit} onChange={e => upd({ securityDeposit: e.target.value })} /></Field>
                    <Field label="Admin fee" htmlFor="au-admin"><input id="au-admin" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 5000" value={active.adminFee} onChange={e => upd({ adminFee: e.target.value })} /></Field>
                    <Field label="Contract registration fee" htmlFor="au-ejari"><input id="au-ejari" className="gx-inp" type="number" min="0" step="any" placeholder="220" value={active.ejariFeeFils} onChange={e => upd({ ejariFeeFils: e.target.value })} /></Field>
                    <Field label="Commission" htmlFor="au-comm"><input id="au-comm" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 4000" value={active.commission} onChange={e => upd({ commission: e.target.value })} /></Field>
                    <Field label="Service charges" htmlFor="au-svc"><input id="au-svc" className="gx-inp" type="number" min="0" step="any" placeholder="e.g. 3000" value={active.serviceCharges} onChange={e => upd({ serviceCharges: e.target.value })} /></Field>
                  </div>
                </Card>
                <div style={{ marginTop: 12 }}>
                  <Card title="Additional payments"
                    sub={aps.length === 0 ? 'None — only rent, deposit and the fees above apply.' : `${aps.length} extra charge${aps.length === 1 ? '' : 's'} added to the contract.`}
                    right={<Btn size="sm" onClick={() => upd({ additionalPayments: [...aps, { label: '', amount: '', vat: '' }] })}>Add payment</Btn>}>
                    {aps.length > 0 && (
                      <div className="gx-tbl-scroll">
                        <table className="gx-tbl">
                          <thead><tr><th>Label</th><th className="num">Net AED</th><th className="num">VAT AED</th><th className="act" /></tr></thead>
                          <tbody>
                            {aps.map((p, i) => (
                              <tr key={i}>
                                <td><input className="gx-inp" aria-label={`Payment ${i + 1} label`} placeholder="e.g. Chiller deposit" value={p.label} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })} /></td>
                                <td className="num"><input className="gx-inp" aria-label={`Payment ${i + 1} net amount`} type="number" min="0" step="any" placeholder="0" value={p.amount} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) })} /></td>
                                <td className="num"><input className="gx-inp" aria-label={`Payment ${i + 1} VAT`} type="number" min="0" step="any" placeholder="0" value={p.vat} onChange={e => upd({ additionalPayments: aps.map((r, j) => j === i ? { ...r, vat: e.target.value } : r) })} /></td>
                                <td className="act"><Btn size="xs" variant="danger" onClick={() => upd({ additionalPayments: aps.filter((_, j) => j !== i) })}>Remove</Btn></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                </div>
              </>
            )}

            {/* 4 · LEASING TERMS */}
            {step === 'leasing' && active && (
              <>
                <Field label="Rental type">
                  <div className="gx-chips" role="group" aria-label="Rental type">
                    {RENTAL_TYPE_OPTIONS.map(o => <button key={o.id} type="button" className="gx-chip" aria-pressed={active.rentalType === o.id} onClick={() => upd({ rentalType: o.id })}>{o.label}</button>)}
                  </div>
                </Field>
                <Field label="Notice (days)" htmlFor="au-notice">
                  <input id="au-notice" className="gx-inp" type="number" min="0" step="any" placeholder="60" style={{ maxWidth: 200 }} value={active.noticePeriodDays} onChange={e => upd({ noticePeriodDays: e.target.value })} />
                </Field>
                <Evid>Annual rent stays the rate; the rental type only slices the payment plan. New contracts on this unit start from these terms.</Evid>
              </>
            )}

            {/* 5 · AMENITIES & DESCRIPTION */}
            {step === 'amenities' && active && (
              <>
                <Field label={`Amenities${active.amenities.length ? ` · ${active.amenities.length} selected` : ''}`}>
                  {!propCategory ? (
                    <div className="gx-hint">Select a property to see relevant amenities.</div>
                  ) : (
                    <div className="gx-chips" role="group" aria-label="Amenities">
                      {getAmenitiesForCategory(propCategory).map(a => {
                        const on = active.amenities.includes(a);
                        return <button key={a} type="button" className="gx-chip" aria-pressed={on}
                          onClick={() => upd({ amenities: on ? active.amenities.filter(x => x !== a) : [...active.amenities, a] })}>{a}</button>;
                      })}
                    </div>
                  )}
                </Field>
                <Field label="Unit description" htmlFor="au-desc"
                  hint={`No phone numbers, emails or links — customers contact you through UpNow. ${active.description.trim().length}/${DESCRIPTION_MIN}+ characters for a full quality score.`}
                  error={hasContactDetails(active.description) ? 'Remove phone numbers, emails and links from the description.' : undefined}>
                  <textarea id="au-desc" className="gx-ta" rows={5} placeholder="Describe this unit for the listing — features, highlights, unique selling points…" value={active.description} onChange={e => upd({ description: e.target.value })} />
                </Field>
              </>
            )}

            {/* 6 · PHOTOS & DOCUMENTS */}
            {step === 'media' && active && (
              <>
                <UnitPhotos photos={active.stagedPhotos} onAdd={stagePhotos} onRemove={removePhoto} onReorder={reorderPhotos} />
                <div className="gx-two" style={{ marginTop: 14, ...(propStandalone ? { gridTemplateColumns: '1fr' } : {}) }}>
                  {!propStandalone && (
                    <DocSlot label="Floor plan (optional)" file={active.stagedFloorPlan} onPick={setFloorPlan} onClear={() => setFloorPlan(null)} sub="PDF, PNG or JPG · the layout drawing for this unit" />
                  )}
                  <DocSlot label="Title deed (unit deed)" file={active.stagedTitleDeed} onPick={setTitleDeed} onClear={() => setTitleDeed(null)}
                    sub={propStandalone ? 'Deed for this standalone unit' : 'For separately-titled units'} />
                </div>
                {propStandalone && <div style={{ marginTop: 10 }}><Evid>Standalone unit — no separate floor plan; the title deed is saved to the unit.</Evid></div>}
              </>
            )}

            {/* 7 · ADDENDUM */}
            {step === 'addendum' && (
              <>
                <Card title={addendumTerms.name?.trim() || 'Agreement addendum'}
                  sub={addendumCount ? `${addendumCount} term${addendumCount === 1 ? '' : 's'} written — added to the new layout(s)` : 'Pick a template or write a new one. Extra wording every contract on these units will carry.'}
                  pad>
                  <div className="gx-btn-row" style={{ flexWrap: 'wrap' }}>
                    <AddendumTemplatePicker onPick={t => setAddendumTerms(t)} selectedName={addendumTerms.name?.trim() || undefined} selectedTerms={addendumTerms} />
                    {hasAddendumTerms(addendumTerms) && (
                      <Btn size="sm" disabled={addendumPreviewBusy}
                        onClick={async () => {
                          if (addendumPreviewBusy) return;
                          setAddendumPreviewBusy(true);
                          try { await openAddendumPdfInNewTab(addendumTerms, addendumTerms.name?.trim() || 'Agreement Addendum'); }
                          finally { setAddendumPreviewBusy(false); }
                        }}>
                        {addendumPreviewBusy ? 'Opening…' : 'Preview PDF'}
                      </Btn>
                    )}
                    <Btn size="sm" variant="primary" onClick={() => setAddendumEditorOpen(true)}>{hasAddendumTerms(addendumTerms) ? 'Edit addendum' : 'Write new'}</Btn>
                  </div>
                </Card>
                <div style={{ marginTop: 10 }}><Evid>Optional. The addendum is written once for this batch and applied to each new layout when you save.</Evid></div>
              </>
            )}

            {/* 8 · PREVIEW & VALIDATE */}
            {step === 'validate' && (
              <>
                <Checklist items={[propCheck]} />
                {unitChecks.map(({ row, required, quality }, i) => (
                  <div key={row.id} style={{ marginTop: 14 }}>
                    <Card title={`Unit ${i + 1}${row.unitNumber.trim() ? ` · ${row.unitNumber.trim()}` : ''}`}
                      sub={row.unitType ? typeLabel(row.unitType) : 'Type not chosen'}
                      right={<Btn size="xs" onClick={() => { setActiveRowId(row.id); setStep('details'); }}>Edit unit</Btn>} pad>
                      <div className="gx-lb">Required to save</div>
                      <Checklist items={required} />
                      <div style={{ marginTop: 12 }}>
                        <QualityPanel q={quality} title="Listing readiness for review"
                          onFixItem={c => { setActiveRowId(row.id); setStep(selectedProp ? c.section : 'prop'); }} />
                      </div>
                    </Card>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}>
                  {requiredOk
                    ? <Evid tone="ok">Ready to save. {openQualityItems === 0 ? 'Every listing-quality check passes.' : `${openQualityItems} quality item${openQualityItems === 1 ? '' : 's'} still open (${goodUnits} of ${rows.length} unit${rows.length === 1 ? '' : 's'} score Good, ${QUALITY_GOOD}+) — you can save now and finish them before submitting each listing for review. Units & listings shows the same score.`}</Evid>
                    : <Evid tone="warn">Fix the required items before saving. Use “Edit unit” to open the unit.</Evid>}
                </div>
              </>
            )}

            {/* 9 · SAVE */}
            {step === 'save' && (
              <>
                <Callout tone="info" title="Saved as drafts — not yet submitted for review.">
                  Saving creates {rows.length} unit{rows.length !== 1 ? 's' : ''} in {selectedProp?.buildingName || 'this property'} as <b>draft</b> listings,
                  then uploads photos, floor plans, title deeds and the addendum. Nothing goes live yet: to publish, open Units &amp; listings and use
                  “Submit listing” on each unit — that sends it to UpNow listing review (Gate 3).
                </Callout>
                <div style={{ marginTop: 12 }}><Checklist items={[propCheck, ...unitChecks.flatMap(u => u.required.map(c => ({ ...c, l: `${u.row.unitNumber.trim() || 'Unit'} — ${c.l}` })))]} /></div>
                {error && <div style={{ marginTop: 12 }}><Callout tone="bad" title="Not saved.">{error}</Callout></div>}
                {saving && saveProgress && (
                  <div style={{ marginTop: 12 }} role="status" aria-live="polite">
                    <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Loader2 size={14} className="animate-spin" aria-hidden /> {saveProgress.phase}</div>
                    {saveProgress.total > 0 && <span className="gx-bar" style={{ display: 'block' }}><i style={{ width: `${(saveProgress.done / saveProgress.total) * 100}%` }} /></span>}
                  </div>
                )}
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" onClick={handleSaveAll} disabled={saving || !selectedProp}>
                    {saving ? 'Saving…' : `Save ${rows.length} unit${rows.length !== 1 ? 's' : ''}`}
                  </Btn>
                  {!requiredOk && !saving && <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>Required items are missing — saving will take you to the first one.</span>}
                </div>
              </>
            )}

            {/* 10 · DONE / REVIEW STATUS */}
            {step === 'done' && done && (
              <>
                <Evid tone="ok">{doneMsg}</Evid>
                {doneErrs.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Callout tone="warn" title="Some items had errors:">
                      <ul style={{ margin: '4px 0 0 16px' }}>{doneErrs.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </Callout>
                  </div>
                )}
                <div className="gx-lb" style={{ margin: '14px 0 6px' }}>Where these listings stand</div>
                <Checklist items={[
                  { l: 'Saved as draft', sub: 'The units exist in your catalogue but are not on the marketplace.', state: 'pass' },
                  { l: 'Submit for review', sub: 'From Units & listings, use “Submit listing” on each unit when it is ready.', state: 'wait' },
                  { l: 'UpNow review (Gate 3)', sub: 'Each listing is approved and published, or rejected with a reason you can fix and resubmit.', state: 'wait' },
                ]} />
                <div style={{ marginTop: 12 }}><Evid>Gate 3 is per listing: your business verification does not approve listings automatically.</Evid></div>
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" href={savedPropId ? `/rental-provider/dashboard/units?propertyId=${savedPropId}` : backHref}>Open these units</Btn>
                  <Btn onClick={goBack}>Go to Units</Btn>
                  <Btn onClick={resetForMore}>Add more units</Btn>
                </div>
              </>
            )}

            {/* footer nav */}
            {!done && (
              <div className="gx-btn-row" style={{ marginTop: 18, borderTop: '1px solid var(--ms-surface-3)', paddingTop: 14 }}>
                <Btn onClick={goBack}>Cancel</Btn>
                <span style={{ flex: 1 }} />
                {prev && step !== 'prop' && <Btn onClick={() => setStep(prev)}>Back</Btn>}
                {next && step !== 'save' && (
                  <Btn variant="primary" disabled={!stepEnabled(next)} onClick={() => setStep(next)}>
                    {step === 'prop' && !selectedProp ? 'Select a property to continue' : 'Continue'}
                  </Btn>
                )}
              </div>
            )}
          </div>

          {/* Live preview — the active unit as a customer would see it */}
          <aside className="gx-wz-prev" aria-label="Live preview">
            <div className="gx-lb" style={{ marginBottom: 8 }}>Live preview · unit {activeIdx + 1} of {rows.length}</div>
            <div className="gx-card" style={{ overflow: 'hidden' }}>
              <div style={{ height: 120, background: 'var(--ms-surface-3)', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--ms-ink-3)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {cover ? <img src={cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'No photo yet'}
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3 }}>
                  {active?.unitName.trim() || (active?.unitType ? `${typeLabel(active.unitType)}${active.unitNumber.trim() ? ` ${active.unitNumber.trim()}` : ''}` : 'Untitled unit')}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 3 }}>
                  {selectedProp ? `${selectedProp.buildingName || 'Unnamed property'}${selectedProp.fullAddress ? ` · ${selectedProp.fullAddress}` : ''}` : 'No property chosen'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ms-ink-2)', marginTop: 6 }}>
                  {[
                    active && showResi && !showRooms ? (active.bedrooms === 'Studio' ? 'Studio' : `${active.bedrooms} BR`) : null,
                    active && showResi && showRooms && active.rooms.trim() ? `${active.rooms} rooms` : null,
                    active && showResi ? `${active.bathrooms} bath` : null,
                    active && Number(active.unitSizeSqft) > 0 ? `${active.unitSizeSqft} sq.ft` : null,
                    active?.view || null,
                  ].filter(Boolean).join(' · ') || '—'}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 8 }}>{active && Number(active.rentalPrice) > 0 ? fmtAed(active.rentalPrice) : 'Rent not set'}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>
                  per year · {RENTAL_TYPE_OPTIONS.find(o => o.id === active?.rentalType)?.label ?? '—'}
                  {vatable != null && <> · {vatable ? 'rent + 5% VAT' : 'rent VAT-exempt'}</>}
                </div>
                <div style={{ marginTop: 10, display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <Pill tone="neutral" dot={false}>Draft</Pill>
                  {active?.unitType && <Pill tone="outline" dot={false}>{typeLabel(active.unitType)}</Pill>}
                  {(active?.amenities.length ?? 0) > 0 && <Pill tone="outline" dot={false}>{active!.amenities.length} amenities</Pill>}
                </div>
              </div>
            </div>
            {activeQuality && (
              <div className="gx-card" style={{ marginTop: 10, padding: 12 }} aria-label="Listing quality">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                  <span className="gx-lb" style={{ marginBottom: 0 }}>Listing quality</span>
                  <Pill tone={activeQuality.tone}>{activeQuality.bandLabel}</Pill>
                </div>
                <QualityMeter q={activeQuality} />
                {activeQuality.missing.length > 0 ? (
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
                    {activeQuality.missing.slice(0, 4).map(c => (
                      <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>{c.label} <span style={{ color: 'var(--ms-ink-3)' }}>· {c.weight} pts</span></span>
                        <Btn size="xs" title={selectedProp ? undefined : 'Pick the property first'} onClick={() => setStep(selectedProp ? c.section : 'prop')}>Fix</Btn>
                      </li>
                    ))}
                    {activeQuality.missing.length > 4 && <li style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>+{activeQuality.missing.length - 4} more in Preview &amp; validate</li>}
                  </ul>
                ) : <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 6 }}>Every quality check passes.</div>}
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ms-ink-3)', lineHeight: 1.5 }}>
              {active?.stagedPhotos.length ?? 0} photo{(active?.stagedPhotos.length ?? 0) === 1 ? '' : 's'}
              {active?.stagedFloorPlan ? ' · floor plan' : ''}{active?.stagedTitleDeed ? ' · title deed' : ''}
              <br />{goodUnits} of {rows.length} unit{rows.length === 1 ? '' : 's'} score Good ({QUALITY_GOOD}+)
              {addendumCount > 0 && <><br />Addendum: {addendumCount} term{addendumCount === 1 ? '' : 's'}</>}
            </div>
          </aside>
        </div>
      </section>

      {addendumEditorOpen && (
        <AddendumEditorModal value={addendumTerms} onChange={setAddendumTerms} onClose={() => setAddendumEditorOpen(false)}
          title="Agreement Addendum" subtitle="Write the terms; they're applied to the layout(s) you create. Preview on the right." />
      )}
    </OsPage>
  );
}

/* ─── ViewInput — type-ahead with custom entry ──────────────────────────────── */
function ViewInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const filtered = value.length >= 3 ? VIEW_OPTIONS.filter(v => v.toLowerCase().includes(value.toLowerCase())) : [];
  const exact = VIEW_OPTIONS.some(v => v.toLowerCase() === value.toLowerCase());
  const showCustom = open && value.length >= 3 && !exact;
  const showMenu = open && value.length >= 3 && (filtered.length > 0 || showCustom);
  const pick = (v: string) => { onChange(v); setOpen(false); };
  const rowStyle = { display: 'block', width: '100%', textAlign: 'left' as const, padding: '7px 10px', border: 0, background: 'transparent', fontSize: 12, borderRadius: 6, cursor: 'pointer' };
  return (
    <div style={{ position: 'relative' }}>
      <input id={id} className="gx-inp" placeholder="e.g. Sea View…" value={value} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (value.length >= 3) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }} />
      {showMenu && (
        <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, maxHeight: 208, overflowY: 'auto', background: 'var(--ms-surface)', border: '1px solid var(--ms-surface-3)', borderRadius: 10, boxShadow: 'var(--ms-shadow)', padding: 4 }}>
          {filtered.map(v => (
            <button key={v} type="button" role="option" aria-selected={value === v} onMouseDown={e => e.preventDefault()} onClick={() => pick(v)}
              style={{ ...rowStyle, fontWeight: value === v ? 700 : 500 }}>{v}</button>
          ))}
          {showCustom && (
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(value)} style={{ ...rowStyle, color: 'var(--ms-primary)', fontWeight: 700 }}>
              + Use “{value}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── UnitPhotos — dropzone + draggable thumbnails (first = cover) ───────────── */
function UnitPhotos({ photos, onAdd, onRemove, onReorder }: {
  photos: StagedPhoto[]; onAdd: (files: File[]) => void; onRemove: (idx: number) => void; onReorder: (next: StagedPhoto[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragIdx = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  return (
    <div>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Add unit photos"
        onChange={e => { const f = e.target.files ? Array.from(e.target.files) : []; if (f.length) onAdd(f); e.target.value = ''; }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="gx-lb" style={{ marginBottom: 0 }}>
          Unit photos ({photos.length}/20){photos.length > 1 && ' · drag to set cover'}
        </span>
        {photos.length > 0 && photos.length < 20 && <Btn size="sm" onClick={() => inputRef.current?.click()}><ImagePlus size={13} aria-hidden /> Add photos</Btn>}
      </div>
      {photos.length === 0 ? (
        <button type="button" onClick={() => inputRef.current?.click()}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '22px 12px', border: '1.5px dashed var(--ms-border-strong)', borderRadius: 12, background: 'var(--ms-surface-2)', cursor: 'pointer' }}>
          <Camera size={20} aria-hidden style={{ color: 'var(--ms-ink-3)' }} />
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Click to add photos</span>
          <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>JPEG, PNG or WebP · up to 20 · first image is the cover</span>
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {photos.map((p, idx) => {
            const size = idx === 0 ? 96 : 80;
            const dragOver = over === idx && dragFrom !== idx;
            return (
              <div key={p.previewUrl} draggable
                onDragStart={() => { dragIdx.current = idx; setDragFrom(idx); }}
                onDragOver={e => { e.preventDefault(); setOver(idx); }}
                onDrop={e => {
                  e.preventDefault();
                  const from = dragIdx.current;
                  if (from !== null && from !== idx) { const arr = [...photos]; const [m] = arr.splice(from, 1); arr.splice(idx, 0, m); onReorder(arr); }
                  dragIdx.current = null; setOver(null); setDragFrom(null);
                }}
                onDragEnd={() => { dragIdx.current = null; setOver(null); setDragFrom(null); }}
                style={{ position: 'relative', width: size, height: size, borderRadius: 10, overflow: 'hidden', cursor: 'grab', userSelect: 'none',
                  border: `1px solid ${idx === 0 || dragOver ? 'var(--ms-primary)' : 'var(--ms-surface-3)'}`, boxShadow: dragOver ? '0 0 0 2px var(--ms-primary)' : undefined }}>
                {idx === 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--ms-primary)', color: '#fff', fontSize: 9, fontWeight: 700, textAlign: 'center', padding: '2px 0', zIndex: 1 }}>COVER</div>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt={`Photo ${idx + 1}`} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                <button type="button" aria-label={`Remove photo ${idx + 1}`} title="Remove photo" onClick={e => { e.stopPropagation(); onRemove(idx); }}
                  style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 999, background: 'rgba(0,0,0,.6)', color: '#fff', border: 0, display: 'grid', placeItems: 'center', cursor: 'pointer', zIndex: 2 }}>
                  <X size={10} aria-hidden />
                </button>
              </div>
            );
          })}
          {photos.length < 20 && (
            <button type="button" aria-label="Add photos" onClick={() => inputRef.current?.click()}
              style={{ width: 80, height: 80, borderRadius: 10, border: '1.5px dashed var(--ms-border-strong)', display: 'grid', placeItems: 'center', background: 'var(--ms-surface)', cursor: 'pointer', color: 'var(--ms-ink-3)' }}>
              <Plus size={16} aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── DocSlot — single document upload (floor plan / title deed) ─────────────── */
function DocSlot({ label, file, onPick, onClear, sub }: {
  label: string; file: File | null; onPick: (f: File) => void; onClear: () => void; sub: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="gx-lb">{label}</span>
      <input ref={ref} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only" aria-label={label}
        onChange={e => { const f = e.target.files?.[0] ?? null; if (f) onPick(f); e.target.value = ''; }} />
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--ms-surface-3)', borderRadius: 10, padding: '8px 10px' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <Btn size="xs" onClick={() => ref.current?.click()}>Replace</Btn>
          <Btn size="xs" variant="danger" onClick={onClear}>Remove</Btn>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()}
          style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '16px 10px', border: '1.5px dashed var(--ms-border-strong)', borderRadius: 10, background: 'var(--ms-surface-2)', cursor: 'pointer' }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Attach {label.replace(/ \(.*\)$/, '').toLowerCase()}</span>
          <span style={{ fontSize: 10.5, color: 'var(--ms-ink-3)' }}>{sub}</span>
        </button>
      )}
    </div>
  );
}
