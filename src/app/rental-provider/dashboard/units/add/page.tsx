'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Plus, Trash2, Upload, Download, CheckCircle2,
  AlertCircle, Loader2, FileSpreadsheet, ChevronDown, ChevronUp,
  ImagePlus, X, Camera, Copy, Building2, Eye, FileText,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { uploadExtraPropertyDocs } from '@/lib/propertyDocs';
import {
  PropertyFields, type PropertyFormData,
} from '@/components/upnow/PropertyFormModal';
import { PropertyPhotos } from '@/components/upnow/PropertyPhotos';
import {
  RESIDENTIAL_UNIT_TYPES, unitTypesForCategory,
  FURNISHING_OPTIONS, UNIT_TYPE_LABELS, getAmenitiesForCategory,
  UNIT_TIERS, RENTAL_TYPE_OPTIONS, sqftFromSqm, sqmFromSqft,
} from '@/components/upnow/UnitFormModal';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumTemplatePicker from '@/components/upnow/AddendumTemplatePicker';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { openAddendumPdfInNewTab } from '@/lib/openAddendumPdf';
import AddUnitsExperience from './AddUnitsExperience';

/* ─── shared styles ───────────────────────────────────────────────────────── */
const INPUT  = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const SELECT = INPUT + ' appearance-none';

function Label({ t, req }: { t: string; req?: boolean }) {
  return (
    <label className="block text-xs font-medium text-[#6b6860] mb-1">
      {t}{req && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-6">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-4">{title}</p>
      {children}
    </div>
  );
}

/* ─── types ───────────────────────────────────────────────────────────────── */
interface Country      { id: number; nameEn: string; code: string }
interface Emirate      { id: number; nameEn: string }
interface Community    { id: number; nameEn: string }
interface WizardProperty {
  id: number; buildingName: string; spaceCategory: string; fullAddress: string | null;
  emirateId: number | null; communityId: number | null;
  latitude: number | null; longitude: number | null;
}

interface StagedPhoto { file: File; previewUrl: string; }

interface UnitRow {
  id: string;
  expanded: boolean;
  unitName: string;
  unitType: string;
  unitTier: string;
  unitNumber: string;
  floor: string;
  premiseNumber: string;
  bedrooms: string;
  bathrooms: string;
  parkingSpaces: string;
  unitSizeSqft: string;
  unitSizeSqm: string;
  furnishing: string;
  rentalPrice: string;
  marketPrice: string;
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
  specialConditions: string;
  additionalPayments: Array<{ label: string; amount: string; vat: string }>;
  description: string;
  stagedPhotos: StagedPhoto[];
  stagedFloorPlan: File | null;
  stagedAddendums: File[];
}

function emptyRow(expanded = true): UnitRow {
  return {
    id: Math.random().toString(36).slice(2),
    expanded,
    unitName: '', unitType: '', unitTier: 'standard', unitNumber: '',
    floor: '', premiseNumber: '', bedrooms: '1', bathrooms: '1', parkingSpaces: '', unitSizeSqft: '', unitSizeSqm: '',
    furnishing: 'Unfurnished', rentalPrice: '', marketPrice: '',
    securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '', serviceCharges: '',
    view: '', amenities: [], minLeaseMonths: '12', noticePeriodDays: '60',
    rentEscalationPct: '',
    rentalType: 'yearly', numberOfPayments: '', advancePayment: '',
    gracePeriodDays: '', latePaymentFee: '', specialConditions: '',
    additionalPayments: [],
    description: '', stagedPhotos: [], stagedFloorPlan: null, stagedAddendums: [],
  };
}

const EMPTY_PROP: PropertyFormData = {
  buildingName: '', spaceCategory: '', leasingType: 'direct',
  countryId: null, emirateId: null, cityId: null, communityId: null, subCommunityId: null,
  countryName: '', emirateName: '', cityName: '', communityName: '', subCommunityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '', numberOfUnits: '',
  propertyDescription: '', latitude: null, longitude: null,
  sharedAmenities: [],
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
  googlePlaceId: null,
};

/* ─── CSV helpers ─────────────────────────────────────────────────────────── */
const CSV_TEMPLATE = [
  'building_name,category,emirate,community,address,unit_name,unit_type,unit_number,floor,bedrooms,bathrooms,size_sqm,annual_rent_aed,security_deposit_aed,admin_fee_aed,ejari_fee_aed,commission_aed,furnishing,view,min_lease_months,notice_period_days,rent_escalation_pct,description',
  'Marina Heights,residential,Dubai,Dubai Marina,Dubai Marina Building 5,Sea View Suite,apartment,101,1,2,1,1200,120000,6000,6000,220,6000,Unfurnished,Sea View,12,60,,Corner unit with balcony',
  'Marina Heights,residential,Dubai,Dubai Marina,Dubai Marina Building 5,,apartment,102,1,1,1,800,85000,4250,4250,220,4250,Semi-Furnished,,12,60,,',
  'Business Bay Tower,commercial,Dubai,Business Bay,Business Bay,,office_fitted,Office-5A,5,,,1500,200000,10000,10000,,10000,,City View,12,90,5,Fitted office space',
  'Dubai Industrial City,industrial,Dubai,Dubai Industrial City,DIC Phase 2,,warehouse,WH-01,G,,,25000,350000,17500,17500,,17500,,Road View,24,90,5,Climate-controlled warehouse with dock',
  'Creative Hub JLT,workspaces,Dubai,Jumeirah Lake Towers,JLT Cluster X,,coworking_desk,Desk-22,3,,,80,18000,900,900,,900,,City View,1,30,,Hot desk in vibrant coworking space',
  'Grand Ballroom Palace,venues,Dubai,Al Quoz,Al Quoz,,event_hall,Main Hall,G,,,8000,500000,25000,25000,,25000,,,,0,14,,Premier event hall with full AV setup',
].join('\n');

interface CsvRow {
  building_name: string; category: string; emirate: string; community: string; address: string;
  unit_name: string; unit_type: string; unit_number: string; floor: string;
  bedrooms: string; bathrooms: string; size_sqm: string;
  annual_rent_aed: string;
  security_deposit_aed: string; admin_fee_aed: string;
  ejari_fee_aed: string; commission_aed: string;
  furnishing: string; view: string;
  min_lease_months: string; notice_period_days: string; rent_escalation_pct: string;
  description: string;
  // Airtable / legacy field aliases
  dewa_premises_no?: string; premise_number?: string;
  _error?: string;
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map((line, i) => {
    const cols: string[] = [];
    let cur = ''; let inQ = false;
    for (const ch of line + ',') {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => { obj[h] = cols[j] ?? ''; });
    const row = obj as unknown as CsvRow;
    const errs: string[] = [];
    if (!row.building_name) errs.push('building_name required');
    if (!row.unit_number)   errs.push('unit_number required');
    if (errs.length) row._error = `Row ${i + 2}: ${errs.join(', ')}`;
    return row;
  });
}

const VIEW_OPTIONS = [
  'Sea View', 'Partial Sea View', 'Full Sea View', 'Beach View', 'Marina View',
  'Canal View', 'Lake View', 'Lagoon View', 'Pool View', 'Garden View',
  'Park View', 'Community View', 'Courtyard View', 'City View', 'Skyline View',
  'Downtown View', 'Landmark View', 'Burj View', 'Golf Course View', 'Mountain View',
  'Desert View', 'Road View', 'Street View', 'Highway View', 'Creek View',
  'River View', 'Harbour View', 'Waterfront View', 'Palm View', 'Island View',
  'Yacht Club View', 'Canal & Sea View', 'Panoramic View', 'Open View',
  'Greenery View', 'Nature View', 'Atrium View', 'Inner Courtyard View',
  'Back View', 'Front View', 'Corner View', 'Facing View', 'Sunrise View', 'Sunset View',
  'Burj Khalifa View', 'Palm Jumeirah View', 'Dubai Marina View', 'Ain Dubai View', 'Fountain View',
];

function isResidential(unitType: string) {
  return RESIDENTIAL_UNIT_TYPES.includes(unitType);
}

function unitLabel(r: UnitRow) {
  const parts: string[] = [];
  if (r.unitName) parts.push(r.unitName);
  if (r.unitType) parts.push(r.unitType.replace(/_/g, ' '));
  if (r.unitNumber) parts.push(`#${r.unitNumber}`);
  if (r.bedrooms && r.bedrooms !== 'Studio' && isResidential(r.unitType)) parts.push(`${r.bedrooms} Bed`);
  if (r.unitSizeSqm) parts.push(`${r.unitSizeSqm} sqm`);
  if (r.rentalPrice) parts.push(`AED ${Number(r.rentalPrice).toLocaleString('en-AE')}`);
  return parts.join('  ·  ') || 'New Unit';
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function AddListingPage() {
  const router = useRouter();
  // Manager listing on behalf of a landlord: ?rp=<id> scopes the new property
  // to that landlord. Absent for normal RP owners (they list under themselves).
  const actingRpId = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('rp') ?? null)
    : null;
  // Where "back" / "done" returns to: a manager acting on behalf goes to their
  // own portal; an RP owner returns to the Units page (the home for units).
  const backHref = actingRpId
    ? `/dashboard/manager/properties?rp=${actingRpId}`
    : '/rental-provider/dashboard/units';
  // Units-only mode: the RP /units/add flow ADDS UNITS to an existing property
  // (property creation lives on the Portfolio page). The manager "Add property"
  // re-export (?rp present) keeps the full property + units wizard.
  const unitsOnly = !actingRpId;
  type Mode = 'new' | 'import';
  const [mode, setMode] = useState<Mode>('new');

  /* property form */
  const [pf, setPf]   = useState<PropertyFormData>({ ...EMPTY_PROP });
  const [pe, setPe]   = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  // Property documents collected in the form; uploaded after the property row
  // is created (mirrors the Edit modal via the shared PropertyFields component).
  const [titleDeed, setTitleDeed] = useState<File | null>(null);
  const [drawings, setDrawings]   = useState<File[]>([]);
  const [extraDocs, setExtraDocs] = useState<Record<string, File[]>>({});
  // Building photos staged before the property exists; uploaded after create.
  const [propertyPhotos, setPropertyPhotos] = useState<File[]>([]);
  // countries + emirates also feed the CSV bulk-importer's name→id resolution,
  // so they live here even though PropertyFields runs its own location cascade.
  const [countries, setCountries] = useState<Country[]>([]);
  const [emirates, setEmirates]   = useState<Emirate[]>([]);
  const defaultCountryIdRef = useRef<number | null>(null);

  /* existing property search */
  const [existingProps, setExistingProps] = useState<WizardProperty[]>([]);
  const [selectedPropId, setSelectedPropId] = useState<number | null>(null);
  const [selectedPropCat, setSelectedPropCat] = useState('');

  /* unit rows */
  const [rows, setRows]       = useState<UnitRow[]>([emptyRow(true)]);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof UnitRow, string>>>>({});

  /* csv */
  const [csvRows, setCsvRows]   = useState<CsvRow[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  /* save state */
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  // One in-app Agreement Addendum for the whole listing — applied to the new
  // layout(s) on save (replaces the old per-unit .docx upload).
  const [addendumTerms, setAddendumTerms] = useState<AddendumTerms>(emptyAddendumTerms());
  const [addendumEditorOpen, setAddendumEditorOpen] = useState(false);
  const [addendumPreviewBusy, setAddendumPreviewBusy] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [doneErrs, setDoneErrs] = useState<string[]>([]);

  /* importing */
  const [importing, setImporting]       = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importErrs, setImportErrs]     = useState<string[]>([]);

  // When a manager opens this with ?rp=<id>, resolve the landlord name for the banner
  const [actingRpName, setActingRpName] = useState<string | null>(null);
  useEffect(() => {
    if (!actingRpId) return;
    apiGet<{ rentalProviderId: number; rpName: string }[]>('/manager/my-rps')
      .then(rps => setActingRpName(rps.find(r => r.rentalProviderId === Number(actingRpId))?.rpName ?? `Landlord #${actingRpId}`))
      .catch(() => setActingRpName(`Landlord #${actingRpId}`));
  }, [actingRpId]);

  useEffect(() => {
    apiGet<WizardProperty[]>('/properties').then(setExistingProps).catch(() => {});
    // Load countries then default to UAE
    apiGet<Country[]>('/locations/countries').then(cs => {
      setCountries(cs);
      const ae = cs.find(c => c.code === 'AE');
      if (ae) {
        defaultCountryIdRef.current = ae.id;
        setPf(prev => prev.countryId ? prev : { ...prev, countryId: ae.id, countryName: ae.nameEn });
        apiGet<Emirate[]>(`/locations/countries/${ae.id}/emirates`).then(setEmirates).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Reload emirates when country changes
  useEffect(() => {
    if (!pf.countryId) { setEmirates([]); return; }
    apiGet<Emirate[]>(`/locations/countries/${pf.countryId}/emirates`).then(setEmirates).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf.countryId]);

  // Property location cascade + building-search auto-fill now live inside the
  // shared <PropertyFields> component (used by Add + Edit, RP + manager), so the
  // wizard no longer maintains its own copy. Changing the category still clears
  // per-unit amenities, so that one hook stays here on pf.spaceCategory.
  useEffect(() => {
    setRows(prev => prev.map(r => ({ ...r, amenities: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf.spaceCategory]);

  /* ── unit row helpers ── */
  const updRow = useCallback((id: string, patch: Partial<UnitRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    const keys = Object.keys(patch) as (keyof UnitRow)[];
    setRowErrors(prev => {
      const next = { ...prev };
      if (next[id]) {
        keys.forEach(k => { delete next[id][k as keyof typeof next[typeof id]]; });
      }
      return next;
    });
  }, []);

  const addRow = () => {
    const r = emptyRow(true);
    setRows(prev => {
      // collapse all existing rows
      const collapsed = prev.map(p => ({ ...p, expanded: false }));
      return [...collapsed, r];
    });
    setTimeout(() => {
      document.getElementById(`unit-card-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const delRow = (id: string) =>
    setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev);

  const toggleRow = (id: string) =>
    setRows(prev => prev.map(r => r.id === id ? { ...r, expanded: !r.expanded } : r));

  const dupRow = (id: string) => {
    const src = rows.find(r => r.id === id);
    if (!src) return;
    const dup: UnitRow = { ...src, id: Math.random().toString(36).slice(2), expanded: true, unitNumber: '', stagedPhotos: [], stagedFloorPlan: null, stagedAddendums: [] };
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      const next = [...prev.map(r => ({ ...r, expanded: false }))];
      next.splice(idx + 1, 0, dup);
      return next;
    });
  };

  /* ── stage photos ── */
  const stagePhotos = (id: string, files: File[]) => {
    const newPhotos: StagedPhoto[] = files.map(file => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setRows(prev => prev.map(r => r.id === id
      ? { ...r, stagedPhotos: [...r.stagedPhotos, ...newPhotos].slice(0, 20) }
      : r));
  };

  const reorderPhotos = (id: string, newPhotos: StagedPhoto[]) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, stagedPhotos: newPhotos } : r));
  };

  const removeStagedPhoto = (rowId: string, idx: number) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next = [...r.stagedPhotos];
      URL.revokeObjectURL(next[idx].previewUrl);
      next.splice(idx, 1);
      return { ...r, stagedPhotos: next };
    }));
  };

  const setFloorPlan = (rowId: string, file: File | null) => {
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, stagedFloorPlan: file } : r));
  };

  /* ── validate ── */
  function validate(): boolean {
    let ok = true;
    // Units-only flow never creates a property — a selection is mandatory.
    if (unitsOnly && !selectedPropId) {
      setError('Select a property to add units to.');
      return false;
    }
    if (!unitsOnly && mode === 'new' && !selectedPropId) {
      const errs: typeof pe = {};
      if (!pf.spaceCategory) { errs.spaceCategory = 'Required'; ok = false; }
      if (!pf.emirateId)     { errs.emirateId = 'Required'; ok = false; }
      setPe(errs);
    }
    const newRowErrors: typeof rowErrors = {};
    for (const r of rows) {
      const e: Partial<Record<keyof UnitRow, string>> = {};
      // Only the unit reference + type are mandatory — same as the CSV-import
      // path and the backend DTO. Size & price are optional so a unit can be
      // stubbed with limited detail (e.g. an accommodation room) and sized /
      // priced later; the /units page flags unsized/unpriced units for follow-up.
      if (!r.unitNumber.trim()) { e.unitNumber = 'Required'; ok = false; }
      if (!r.unitType)          { e.unitType   = 'Required'; ok = false; }
      if (Object.keys(e).length) newRowErrors[r.id] = e;
    }
    setRowErrors(newRowErrors);
    if (!ok) {
      // expand first row with errors
      const firstErrId = Object.keys(newRowErrors)[0];
      if (firstErrId) setRows(prev => prev.map(r => ({ ...r, expanded: r.id === firstErrId ? true : r.expanded })));
    }
    return ok;
  }

  /* ── save all ── */
  const handleSaveAll = useCallback(async () => {
    setError(null);
    if (!validate()) return;
    setSaving(true);
    const errs: string[] = [];

    try {
      /* 1. Create / resolve property */
      setSaveProgress({ phase: 'Creating property…', done: 0, total: rows.length });
      let propId: number;
      let propName: string;
      if (!selectedPropId) {
        const parts = [pf.street, pf.communityName, pf.emirateName].filter(Boolean);
        const created = await apiPost<WizardProperty>('/properties', {
          ...(actingRpId ? { rentalProviderId: Number(actingRpId) } : {}),
          buildingName: pf.buildingName,
          spaceCategory: pf.spaceCategory,
          leasingType: pf.leasingType,
          fullAddress: parts.join(', ') || undefined,
          countryId: pf.countryId ?? undefined,
          emirateId: pf.emirateId ?? undefined,
          cityId: pf.cityId ?? undefined,
          communityId: pf.communityId ?? undefined,
          subCommunityId: pf.subCommunityId ?? undefined,
          latitude: pf.latitude ?? undefined,
          longitude: pf.longitude ?? undefined,
          numberOfFloors: pf.numberOfFloors || undefined,
          makaniNumber: pf.makaniNumber || undefined,
          plotNumber: pf.plotNumber || undefined,
          sharedAmenities: pf.sharedAmenities,
          hasGym: pf.hasGym, hasPool: pf.hasPool, hasParking: pf.hasParking,
          isStandaloneUnit: pf.isStandaloneUnit,
          propertyDescription: pf.propertyDescription || undefined,
          googlePlaceId: pf.googlePlaceId || undefined,
        });
        propId   = created.id;
        propName = created.buildingName;
        // Standalone title deed + building drawings (property-level documents).
        // Failures are collected and surfaced (don't silently drop uploads).
        const docErrs: string[] = [];
        if (titleDeed) {
          try {
            await uploadOwnedDocument({ ownerType: 'property', ownerId: propId, documentKey: 'title_deed', category: 'legal', displayName: 'Title deed', file: titleDeed });
          } catch (e) { docErrs.push(`Title deed: ${e instanceof Error ? e.message : 'upload failed'}`); }
        }
        for (let i = 0; i < drawings.length; i++) {
          try {
            await uploadOwnedDocument({ ownerType: 'property', ownerId: propId, documentKey: `building_drawing_${Date.now()}_${i}`, category: 'property', displayName: drawings[i].name || `Property drawing ${i + 1}`, file: drawings[i] });
          } catch (e) { docErrs.push(`${drawings[i].name || `Drawing ${i + 1}`}: ${e instanceof Error ? e.message : 'upload failed'}`); }
        }
        docErrs.push(...await uploadExtraPropertyDocs(propId, extraDocs));
        // Building photos → property media (public bucket).
        for (let i = 0; i < propertyPhotos.length; i++) {
          try {
            const fd = new FormData();
            fd.append('file', propertyPhotos[i]);
            const res = await fetch(`/api/properties/${propId}/media`, { method: 'POST', body: fd, credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          } catch (e) { docErrs.push(`Property photo ${i + 1}: ${e instanceof Error ? e.message : 'upload failed'}`); }
        }
        if (docErrs.length) {
          alert(`The property was created, but ${docErrs.length} document(s) failed to upload:\n\n${docErrs.join('\n')}`);
        }
      } else {
        propId   = selectedPropId!;
        propName = existingProps.find(p => p.id === propId)?.buildingName ?? 'Property';
      }

      /* 2. Create units */
      const unitIds: { rowId: string; unitId: number }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        setSaveProgress({ phase: `Creating units… (${i + 1}/${rows.length})`, done: i, total: rows.length });
        try {
          const created = await apiPost<{ id: number }>(`/properties/${propId}/units`, {
            unitName:         r.unitName        || undefined,
            unitType:         r.unitType,
            unitTier:         r.unitTier || 'standard',
            unitNumber:       r.unitNumber,
            floor:            r.floor           || undefined,
            premiseNumber:    r.premiseNumber   || undefined,
            bedrooms:         r.bedrooms && r.bedrooms !== 'Studio' ? Number(r.bedrooms) : undefined,
            bathrooms:        r.bathrooms       ? Number(r.bathrooms)       : undefined,
            parkingSpaces:    r.parkingSpaces   ? Number(r.parkingSpaces)   : undefined,
            unitSizeSqft:    r.unitSizeSqft   ? Number(r.unitSizeSqft)   : undefined,
            unitSizeSqm:     r.unitSizeSqm    ? Number(r.unitSizeSqm)    : undefined,
            rentalPrice:      r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            // One price: market = the annual rent (kept in lock-step).
            marketPrice:      r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            securityDeposit:  r.securityDeposit ? Number(r.securityDeposit) : undefined,
            adminFee:         r.adminFee        ? Number(r.adminFee)        : undefined,
            ejariFeeFils:     r.ejariFeeFils    ? Number(r.ejariFeeFils)    : undefined,
            commission:       r.commission      ? Number(r.commission)      : undefined,
            serviceCharges:   r.serviceCharges  ? Number(r.serviceCharges)  : undefined,
            minLeaseMonths:   r.minLeaseMonths   ? Number(r.minLeaseMonths)   : undefined,
            noticePeriodDays: r.noticePeriodDays ? Number(r.noticePeriodDays) : undefined,
            rentEscalationPct: r.rentEscalationPct ? Number(r.rentEscalationPct) : undefined,
            rentalType:       r.rentalType       || undefined,
            numberOfPayments: r.numberOfPayments ? Number(r.numberOfPayments) : undefined,
            advancePayment:   r.advancePayment   ? Number(r.advancePayment)   : undefined,
            gracePeriodDays:  r.gracePeriodDays  ? Number(r.gracePeriodDays)  : undefined,
            latePaymentFee:   r.latePaymentFee   ? Number(r.latePaymentFee)   : undefined,
            specialConditions: r.specialConditions || undefined,
            additionalPayments: (r.additionalPayments ?? [])
              .map(p => ({ label: p.label.trim(), amount: Number(p.amount) || 0, vat: p.vat ? Number(p.vat) : 0 }))
              .filter(p => p.label !== '' && p.amount > 0),
            view:             r.view            || undefined,
            furnishing:       r.furnishing      || undefined,
            amenities:        r.amenities.length ? r.amenities : undefined,
            description:      r.description     || undefined,
          });
          unitIds.push({ rowId: r.id, unitId: created.id });
        } catch (e) {
          errs.push(`Unit "${r.unitNumber}": ${e instanceof Error ? e.message : 'create failed'}`);
        }
      }

      /* 3. Upload staged photos */
      const photoRows = unitIds.filter(({ rowId }) =>
        rows.find(r => r.id === rowId)?.stagedPhotos.length);
      if (photoRows.length > 0) {
        let photoDone = 0;
        const totalPhotos = photoRows.reduce((sum, { rowId }) =>
          sum + (rows.find(r => r.id === rowId)?.stagedPhotos.length ?? 0), 0);
        setSaveProgress({ phase: 'Uploading photos…', done: 0, total: totalPhotos });
        for (const { rowId, unitId } of photoRows) {
          const row = rows.find(r => r.id === rowId)!;
          for (const sp of row.stagedPhotos) {
            try {
              const fd = new FormData();
              fd.append('file', sp.file);
              await fetch(`/api/properties/${propId}/units/${unitId}/media`, {
                method: 'POST',
                body: fd,
                credentials: 'include',
              });
            } catch (e) {
              errs.push(`Photo for unit "${row.unitNumber}": upload failed`);
            }
            photoDone++;
            setSaveProgress({ phase: 'Uploading photos…', done: photoDone, total: totalPhotos });
          }
        }
      }

      /* 4. Upload staged floor plans (one per unit) */
      const planRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedFloorPlan);
      if (planRows.length > 0) {
        setSaveProgress({ phase: 'Uploading floor plans…', done: 0, total: planRows.length });
        let planDone = 0;
        for (const { rowId, unitId } of planRows) {
          const row = rows.find(r => r.id === rowId)!;
          try {
            const fd = new FormData();
            fd.append('file', row.stagedFloorPlan!);
            const res = await fetch(`/api/properties/${propId}/units/${unitId}/floor-plan`, {
              method: 'POST', body: fd, credentials: 'include',
            });
            if (!res.ok) throw new Error();
          } catch {
            errs.push(`Floor plan for unit "${row.unitNumber}": upload failed`);
          }
          planDone++;
          setSaveProgress({ phase: 'Uploading floor plans…', done: planDone, total: planRows.length });
        }
      }

      /* 5. Upload staged addendum / amendment documents (one record per file) */
      const addendumRows = unitIds.filter(({ rowId }) => rows.find(r => r.id === rowId)?.stagedAddendums.length);
      if (addendumRows.length > 0) {
        setSaveProgress({ phase: 'Uploading addendums…', done: 0, total: addendumRows.length });
        let addDone = 0;
        for (const { rowId, unitId } of addendumRows) {
          const row = rows.find(r => r.id === rowId)!;
          for (let i = 0; i < row.stagedAddendums.length; i++) {
            try {
              await uploadOwnedDocument({
                ownerType: 'unit', ownerId: unitId,
                documentKey: `addendum_${Date.now()}_${i}`, category: 'legal',
                displayName: row.stagedAddendums[i].name, file: row.stagedAddendums[i],
              });
            } catch {
              errs.push(`Addendum for unit "${row.unitNumber}": upload failed`);
            }
          }
          addDone++;
          setSaveProgress({ phase: 'Uploading addendums…', done: addDone, total: addendumRows.length });
        }
      }

      /* 6. Apply the listing's in-app Agreement addendum to the new layout(s).
            The addendum lives per layout (property + plan_label), so we resolve
            the just-created layouts and write the terms to each. */
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
      setDoneMsg(`${propName} + ${unitIds.length} unit${unitIds.length !== 1 ? 's' : ''} saved.`);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed — please try again.');
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pf, rows, selectedPropId, existingProps, addendumTerms]);

  /* ── CSV ── */
  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null); setCsvRows([]);
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCsv(ev.target?.result as string ?? '');
      if (!parsed.length) { setCsvError('No data rows found — check the file format.'); return; }
      setCsvRows(parsed);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const runImport = useCallback(async () => {
    const valid = csvRows.filter(r => !r._error);
    if (!valid.length) return;
    setImporting(true); setImportErrs([]);
    setImportProgress({ done: 0, total: valid.length });
    const propMap = new Map<string, number>();
    // Cache communities per emirate to avoid redundant API calls
    const communityCache = new Map<number, Community[]>();
    const errs: string[] = [];

    const resolveEmirateId = (name: string) =>
      emirates.find(e => e.nameEn.toLowerCase() === name.toLowerCase())?.id ?? null;

    const resolveCommunityId = async (emirateId: number, communityName: string): Promise<number | null> => {
      if (!communityName.trim()) return null;
      let comms = communityCache.get(emirateId);
      if (!comms) {
        try {
          comms = await apiGet<Community[]>(`/locations/emirates/${emirateId}/communities`);
          communityCache.set(emirateId, comms);
        } catch { return null; }
      }
      const needle   = communityName.toLowerCase().trim();
      const normalize = (s: string) => s.replace(/[^a-z0-9]/g, '');
      const needleN   = normalize(needle);
      let best: Community | null = null; let bestScore = 0;
      for (const c of comms) {
        const dbN = normalize(c.nameEn.toLowerCase());
        let score = 0;
        if (dbN === needleN)                                             score = 1;
        else if (needleN.length >= 4 && (dbN.includes(needleN) || needleN.includes(dbN))) score = 0.8;
        else {
          const toks = needle.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
          const dbT  = c.nameEn.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
          score = toks.filter(t => dbT.some(dt => dt.includes(t) || t.includes(dt))).length /
                  Math.max(toks.length, dbT.length);
        }
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return (best && bestScore >= 0.4) ? best.id : null;
    };

    for (const row of valid) {
      if (!propMap.has(row.building_name)) {
        const emirateId = resolveEmirateId(row.emirate ?? '');
        const communityId = emirateId && row.community
          ? await resolveCommunityId(emirateId, row.community)
          : null;
        try {
          const p = await apiPost<WizardProperty>('/properties', {
            ...(actingRpId ? { rentalProviderId: Number(actingRpId) } : {}),
            buildingName: row.building_name || undefined,
            spaceCategory: row.category || 'residential',
            fullAddress: row.address || undefined,
            emirateId: emirateId ?? undefined,
            communityId: communityId ?? undefined,
          });
          propMap.set(row.building_name, p.id);
        } catch (e) {
          errs.push(`Property "${row.building_name}": ${e instanceof Error ? e.message : 'error'}`);
          propMap.set(row.building_name, -1);
        }
      }
      const pid = propMap.get(row.building_name)!;
      if (pid !== -1) {
        const rent = row.annual_rent_aed ? Number(row.annual_rent_aed) : 0;
        const secDep  = row.security_deposit_aed ? Number(row.security_deposit_aed) : (rent > 0 ? Math.round(rent * 0.05) : undefined);
        const adminFee = row.admin_fee_aed       ? Number(row.admin_fee_aed)        : (rent > 0 ? Math.round(rent * 0.05) : undefined);
        const isResi  = RESIDENTIAL_UNIT_TYPES.includes(row.unit_type) || row.category === 'residential';
        const ejari   = row.ejari_fee_aed ? Number(row.ejari_fee_aed) : (isResi ? 220 : undefined);
        const commission = row.commission_aed    ? Number(row.commission_aed)       : (rent > 0 ? Math.round(rent * 0.05) : undefined);
        try {
          await apiPost(`/properties/${pid}/units`, {
            unitName:         row.unit_name    || undefined,
            unitType:         row.unit_type    || 'apartment',
            unitNumber:       row.unit_number,
            floor:            row.floor        || undefined,
            premiseNumber:    row.premise_number || row.dewa_premises_no || undefined,
            bedrooms:         row.bedrooms     ? Number(row.bedrooms)  : undefined,
            bathrooms:        row.bathrooms    ? Number(row.bathrooms) : undefined,
            unitSizeSqm:     row.size_sqm    ? Number(row.size_sqm) : undefined,
            unitSizeSqft:    row.size_sqm    ? Number(sqftFromSqm(row.size_sqm)) || undefined : undefined,
            rentalPrice:      rent > 0         ? rent                  : undefined,
            securityDeposit:  secDep,
            adminFee,
            ejariFeeFils:     ejari,
            commission,
            minLeaseMonths:   row.min_lease_months   ? Number(row.min_lease_months)   : undefined,
            noticePeriodDays: row.notice_period_days ? Number(row.notice_period_days) : undefined,
            rentEscalationPct: row.rent_escalation_pct ? Number(row.rent_escalation_pct) : undefined,
            furnishing:       row.furnishing   || undefined,
            view:             row.view         || undefined,
            description:      row.description  || undefined,
          });
        } catch (e) {
          errs.push(`Unit "${row.unit_number}" in "${row.building_name}": ${e instanceof Error ? e.message : 'error'}`);
        }
      }
      setImportProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setImportErrs(errs);
    setImporting(false);
    setDoneMsg(`Imported ${valid.length - errs.length} of ${valid.length} rows.`);
    setDoneErrs(errs);
    setDone(true);
  }, [csvRows, emirates]);

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'upnow_listings_template.csv';
    a.click();
  }

  const propCategory = selectedPropId
    ? (existingProps.find(p => p.id === selectedPropId)?.spaceCategory ?? '')
    : pf.spaceCategory;

  // RP owner (no ?rp) adding units to an existing property → the redesigned,
  // self-contained "Add Units" experience. The manager property-creation + CSV
  // wizard below is unchanged. (All hooks above run first, so this conditional
  // return is rules-of-hooks safe.)
  if (unitsOnly) return <AddUnitsExperience backHref={backHref} />;

  /* ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-full bg-[#f9f8f5]">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-[#e8e6e0] px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push(backHref)}
          className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] cursor-pointer"
        >
          <ArrowLeft size={16} /> {unitsOnly ? 'Units' : 'Portfolio'}
        </button>
        <div className="w-px h-4 bg-[#e8e6e0]" />
        <div>
          <h1 className="font-semibold text-[#1a1916] text-sm leading-tight">{unitsOnly ? 'Add Units' : 'Add Listing'}</h1>
          <p className="text-xs text-[#9b9890]">{unitsOnly ? 'Add units to one of your properties' : 'Property + units in one go'}</p>
        </div>

        {/* Manager acting-on-behalf banner */}
        {actingRpId && (
          <div className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
            style={{ backgroundColor: 'var(--color-primary-50, #f0faf6)', color: 'var(--color-primary-dark, #1a5a4a)' }}>
            <Building2 size={12} />
            Listing on behalf of {actingRpName ?? '…'}
          </div>
        )}

        {/* Mode tabs — CSV import creates properties, so it's hidden in the
            units-only (RP) flow; only the manager property+units wizard shows it. */}
        {!done && !unitsOnly && (
          <div className="ml-auto flex rounded-xl border border-[#e8e6e0] overflow-hidden bg-[#f4f3ef]">
            {([
              { key: 'new',    label: 'Manual Entry' },
              { key: 'import', label: 'Import CSV' },
            ] as { key: Mode; label: string }[]).map(m => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setError(null); }}
                className={`px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  mode === m.key ? 'bg-white text-[#1a1916] shadow-sm rounded-lg m-0.5' : 'text-[#6b6860] hover:text-[#1a1916]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">

        {/* ══ DONE ══ */}
        {done && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 text-center max-w-2xl mx-auto">
            <div className="w-16 h-16 rounded-full bg-[#d8f2e8] flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={32} className="text-[#2e9f82]" />
            </div>
            <h2 className="text-xl font-bold text-[#1a1916] mb-1">All done!</h2>
            <p className="text-sm text-[#6b6860] mb-6">{doneMsg}</p>
            {doneErrs.length > 0 && (
              <div className="text-left bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                <p className="text-xs font-semibold text-amber-700 mb-2">Some rows had errors:</p>
                {doneErrs.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setDone(false); setRows([emptyRow(true)]); setMode('new');
                  setSelectedPropId(null); setPf({ ...EMPTY_PROP }); setCsvRows([]); setDoneErrs([]);
                  setTitleDeed(null); setDrawings([]); setExtraDocs({}); setPropertyPhotos([]);
                }}
                className="px-5 py-2.5 rounded-lg border border-[#2e9f82] text-[#2e9f82] text-sm font-medium hover:bg-[#f0fdf8] cursor-pointer"
              >
                {unitsOnly ? 'Add More Units' : 'Add Another Listing'}
              </button>
              <button
                onClick={() => router.push(backHref)}
                className="px-5 py-2.5 rounded-lg text-white text-sm font-semibold cursor-pointer"
                style={{ background: '#1a1916' }}
              >
                {unitsOnly ? 'Go to Units' : 'Go to Portfolio'}
              </button>
            </div>
          </div>
        )}

        {/* ══ PROPERTY ══ Units-only (RP) = pick an existing property; full mode
            (manager) = pick existing OR create a new property. */}
        {!done && mode === 'new' && (
          <Section title={unitsOnly ? 'Select Property' : 'Property Details'}>
            <div className="space-y-4">

              {/* Existing property selector (both modes, when ≥1 exists) */}
              {existingProps.length > 0 && (
                <div>
                  <Label t={unitsOnly ? 'Property' : 'Select Existing Property'} req={unitsOnly} />
                  <select
                    className={SELECT}
                    value={selectedPropId ?? ''}
                    onChange={e => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const cat = existingProps.find(p => p.id === id)?.spaceCategory ?? '';
                      // Switching to a different category invalidates the chosen
                      // unit type + amenities, so clear them (keeps the POST clean).
                      const catChanged = cat !== selectedPropCat;
                      setSelectedPropId(id); setSelectedPropCat(cat); setError(null);
                      setRows(prev => prev.map(r => ({
                        ...r, amenities: [], ...(catChanged ? { unitType: '' } : {}),
                      })));
                    }}
                  >
                    <option value="">— Select a property —</option>
                    {existingProps.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.buildingName || 'Unnamed Property'}{p.fullAddress ? ` · ${p.fullAddress}` : ''}
                      </option>
                    ))}
                  </select>
                  {unitsOnly && (
                    <p className="text-[11px] text-[#9b9890] mt-1.5">
                      Need a new building?{' '}
                      <Link href="/rental-provider/dashboard/portfolio?add=1" className="font-medium text-[#2e9f82] hover:underline">Add a property</Link>{' '}
                      on the Portfolio page.
                    </p>
                  )}
                </div>
              )}

              {/* Units-only with NO properties yet → create one on Portfolio first. */}
              {unitsOnly && existingProps.length === 0 && (
                <div className="text-center py-6">
                  <Building2 size={22} className="mx-auto mb-2 text-[#c5c3bc]" />
                  <p className="text-sm text-[#6b6860] mb-3">
                    You don’t have any properties yet. Create a property first, then come back to add its units.
                  </p>
                  <Link href="/rental-provider/dashboard/portfolio?add=1"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg"
                    style={{ background: '#2e9f82', color: '#fff' }}>
                    <Building2 size={15} /> Add a property
                  </Link>
                </div>
              )}

              {/* Full mode (manager) only: divider + the new-property form via the
                  shared <PropertyFields> (byte-identical to the Edit modal). */}
              {!unitsOnly && existingProps.length > 0 && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#e8e6e0]" /></div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[10px] font-medium text-[#9b9890] uppercase tracking-wider">or create new</span>
                  </div>
                </div>
              )}
              {!unitsOnly && !selectedPropId && (
                <>
                  <PropertyFields
                    value={pf} setValue={setPf}
                    errors={pe} setErrors={setPe}
                    isEdit={false}
                    titleDeed={titleDeed} setTitleDeed={setTitleDeed}
                    drawings={drawings} setDrawings={setDrawings}
                    extraDocs={extraDocs} setExtraDocs={setExtraDocs}
                  />
                  <div className="mt-5 pt-5 border-t border-[#f0ede8]">
                    <PropertyPhotos value={propertyPhotos} onChange={setPropertyPhotos} />
                  </div>
                </>
              )}
            </div>
          </Section>
        )}

        {/* ══ IMPORT CSV ══ */}
        {!done && mode === 'import' && (
          <Section title="Import from CSV">
            <div className="space-y-5">
              <div className="bg-[#f0fdf8] border border-[#a7f3d0] rounded-xl p-4">
                <p className="text-sm font-semibold text-[#1a7a5a] mb-1">Single file — property + units combined</p>
                <p className="text-xs text-[#3d3b35] leading-relaxed">
                  Each row contains both property and unit data. Rows sharing the same <strong>building_name</strong> are grouped into one property automatically.
                </p>
              </div>

              <div className="flex items-center gap-3 bg-[#f4f3ef] rounded-xl p-4">
                <FileSpreadsheet size={20} className="text-[#2e9f82] shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1a1916]">Download the CSV template</p>
                  <p className="text-xs text-[#9b9890]">Fill in your data then upload below.</p>
                </div>
                <button onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] border border-[#2e9f82] rounded-lg px-3 py-2 hover:bg-[#f0fdf8] cursor-pointer shrink-0">
                  <Download size={13} /> Template
                </button>
              </div>

              {/* Column reference */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-2">CSV Columns</p>
                <div className="overflow-x-auto rounded-xl border border-[#e8e6e0]">
                  <table className="w-full text-xs min-w-[540px]">
                    <thead>
                      <tr className="bg-[#f4f3ef]">
                        <th className="px-3 py-2 text-left font-medium text-[#6b6860]">Column</th>
                        <th className="px-3 py-2 text-left font-medium text-[#6b6860]">Required</th>
                        <th className="px-3 py-2 text-left font-medium text-[#6b6860]">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0ede8]">
                      {[
                        ['building_name',        '✓', 'Groups rows into one property'],
                        ['category',             '',  'residential | commercial | industrial | workspaces | venues'],
                        ['emirate',              '',  'e.g. Dubai, Abu Dhabi, Sharjah'],
                        ['community',            '',  'Community / area name — matched to our database'],
                        ['address',              '',  'Full street address'],
                        ['unit_name',            '',  'Listing title / display name'],
                        ['unit_type',            '',  'apartment, villa, office_fitted …'],
                        ['unit_number',          '✓', 'Unique identifier per building'],
                        ['floor',                '',  'Floor number or label'],
                        ['bedrooms',             '',  'Number or Studio'],
                        ['bathrooms',            '',  'Number'],
                        ['size_sqm',            '',  'e.g. 1200'],
                        ['annual_rent_aed',      '',  'e.g. 120000'],
                        ['security_deposit_aed', '',  'Auto-calculated at 5% if blank'],
                        ['admin_fee_aed',        '',  'Auto-calculated at 5% if blank'],
                        ['ejari_fee_aed',        '',  'Defaults to AED 220 if blank'],
                        ['commission_aed',       '',  'Auto-calculated at 5% if blank'],
                        ['furnishing',           '',  'Unfurnished | Semi-Furnished | Fully Furnished'],
                        ['view',                 '',  'e.g. Sea View, City View, Pool View'],
                        ['description',          '',  'Free text for the listing'],
                      ].map(([col, req, note]) => (
                        <tr key={col} className="hover:bg-[#fafaf8]">
                          <td className="px-3 py-1.5 font-mono text-[#1a1916]">{col}</td>
                          <td className="px-3 py-1.5 text-center">{req && <span className="text-red-500 font-bold">{req}</span>}</td>
                          <td className="px-3 py-1.5 text-[#6b6860]">{note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <Label t="Upload your CSV" req />
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-8 cursor-pointer hover:border-[#2e9f82] transition-colors">
                  <Upload size={24} className="text-[#9b9890] mb-2" />
                  <span className="text-sm text-[#6b6860]">Click to choose a .csv file</span>
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="sr-only" />
                </label>
                {csvError && <p className="text-[10px] text-red-500 mt-1">{csvError}</p>}
              </div>

              {csvRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[#3d3b35]">
                      {csvRows.length} row{csvRows.length !== 1 ? 's' : ''} parsed —{' '}
                      <span className="text-[#2e9f82]">{csvRows.filter(r => !r._error).length} valid</span>
                      {csvRows.filter(r => r._error).length > 0 && (
                        <span className="text-amber-600">, {csvRows.filter(r => r._error).length} will be skipped</span>
                      )}
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-[#e8e6e0]">
                    <table className="w-full text-xs min-w-[580px]">
                      <thead>
                        <tr className="bg-[#f4f3ef]">
                          {['Building', 'Unit #', 'Type', 'Beds', 'sqm', 'Rent AED', 'View', ''].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-[#6b6860]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0ede8]">
                        {csvRows.slice(0, 12).map((row, i) => (
                          <tr key={i} className={row._error ? 'bg-red-50 opacity-60' : 'hover:bg-[#fafaf8]'}>
                            <td className="px-3 py-1.5 font-medium text-[#1a1916]">{row.building_name || '—'}</td>
                            <td className="px-3 py-1.5">{row.unit_number || '—'}</td>
                            <td className="px-3 py-1.5 text-[#6b6860]">{row.unit_type || '—'}</td>
                            <td className="px-3 py-1.5">{row.bedrooms || '—'}</td>
                            <td className="px-3 py-1.5">{row.size_sqm || '—'}</td>
                            <td className="px-3 py-1.5 text-[#2e9f82] font-medium">
                              {row.annual_rent_aed ? Number(row.annual_rent_aed).toLocaleString('en-AE') : '—'}
                            </td>
                            <td className="px-3 py-1.5 text-[#6b6860]">{row.view || '—'}</td>
                            <td className="px-3 py-1.5">
                              {row._error
                                ? <span title={row._error}><AlertCircle size={12} className="text-red-500" /></span>
                                : <CheckCircle2 size={12} className="text-[#2e9f82]" />
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {csvRows.length > 12 && (
                      <p className="text-center text-xs text-[#9b9890] py-2">… and {csvRows.length - 12} more rows</p>
                    )}
                  </div>
                </div>
              )}

              {importing && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm text-[#6b6860]">
                    <Loader2 size={14} className="animate-spin text-[#2e9f82]" />
                    Importing {importProgress.done} / {importProgress.total}…
                  </div>
                  <div className="h-1.5 bg-[#e8e6e0] rounded-full overflow-hidden">
                    <div className="h-full bg-[#2e9f82] rounded-full transition-all"
                      style={{ width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Units-only: prompt to pick a property before the unit rows appear. */}
        {!done && unitsOnly && !selectedPropId && existingProps.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-6 text-center text-sm text-[#9b9890]">
            Select a property above to start adding its units.
          </div>
        )}

        {/* ══ UNITS section (new + existing modes) ══ */}
        {!done && mode !== 'import' && (!unitsOnly || selectedPropId) && (
          <Section title={`Units  ·  ${rows.length} added`}>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <UnitCard
                  key={r.id}
                  row={r}
                  index={i}
                  unitTypes={unitTypesForCategory(propCategory)}
                  propCategory={propCategory}
                  errors={rowErrors[r.id] ?? {}}
                  onUpdate={(patch) => updRow(r.id, patch)}
                  onDelete={() => delRow(r.id)}
                  onDuplicate={() => dupRow(r.id)}
                  onToggle={() => toggleRow(r.id)}
                  onStagePhotos={(files) => stagePhotos(r.id, files)}
                  onRemovePhoto={(idx) => removeStagedPhoto(r.id, idx)}
                  onReorderPhotos={(photos) => reorderPhotos(r.id, photos)}
                  onSetFloorPlan={(file) => setFloorPlan(r.id, file)}
                  canDelete={rows.length > 1}
                />
              ))}
              <button
                onClick={addRow}
                className="flex items-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-[#e8e6e0] text-sm font-medium text-[#6b6860] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors cursor-pointer"
              >
                <Plus size={15} /> Add another unit
              </button>
            </div>
          </Section>
        )}

        {/* ── error banner ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* ── Agreement Addendum (one for the listing, applied to the new layout(s)) ── */}
        {!done && mode !== 'import' && (!unitsOnly || selectedPropId) && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-3">
              Agreement Addendum <span className="font-normal normal-case text-[#bdbab2]">· optional</span>
            </p>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#1a1916] truncate">{addendumTerms.name?.trim() || 'Agreement Addendum'}</p>
                <p className="text-[11px] text-[#a16207]">
                  {(() => {
                    const n = (addendumTerms.en?.filter(l => l.trim()).length ?? 0) + (addendumTerms.ar?.filter(l => l.trim()).length ?? 0);
                    return n ? `${n} term${n === 1 ? '' : 's'} written — added to the new layout(s)` : 'Write the addendum new contracts on these units will carry';
                  })()}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Choose from a saved template… */}
                <AddendumTemplatePicker onPick={t => setAddendumTerms(t)} />
                {hasAddendumTerms(addendumTerms) && (
                  <button type="button" disabled={addendumPreviewBusy}
                    onClick={async () => {
                      if (addendumPreviewBusy) return;
                      setAddendumPreviewBusy(true);
                      try { await openAddendumPdfInNewTab(addendumTerms, addendumTerms.name?.trim() || 'Agreement Addendum'); }
                      finally { setAddendumPreviewBusy(false); }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c5e8df] text-[#2e9f82] text-xs font-semibold hover:bg-[#f0faf6] cursor-pointer disabled:opacity-50">
                    {addendumPreviewBusy ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview
                  </button>
                )}
                {/* …or add new / edit */}
                <button type="button" onClick={() => setAddendumEditorOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b45309] text-white text-xs font-semibold hover:bg-[#92400e] cursor-pointer">
                  <FileText size={13} /> {hasAddendumTerms(addendumTerms) ? 'Edit addendum' : 'Write new'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Save progress ── */}
        {saving && saveProgress && (
          <div className="bg-white rounded-xl border border-[#e8e6e0] p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm text-[#6b6860]">
              <Loader2 size={14} className="animate-spin text-[#2e9f82]" /> {saveProgress.phase}
            </div>
            {saveProgress.total > 0 && (
              <div className="h-1.5 bg-[#e8e6e0] rounded-full overflow-hidden">
                <div className="h-full bg-[#2e9f82] rounded-full transition-all"
                  style={{ width: `${(saveProgress.done / saveProgress.total) * 100}%` }} />
              </div>
            )}
          </div>
        )}

        {/* ── bottom actions ── */}
        {!done && (
          <div className="flex items-center justify-between pb-8">
            <button
              onClick={() => router.push(backHref)}
              className="text-sm text-[#6b6860] hover:text-[#1a1916] px-4 py-2 cursor-pointer"
            >
              Cancel
            </button>

            {mode !== 'import' && (
              <button
                onClick={handleSaveAll}
                disabled={saving}
                className="flex items-center gap-2 text-sm font-semibold text-white px-6 py-2.5 rounded-xl disabled:opacity-50 cursor-pointer"
                style={{ background: '#2e9f82' }}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save{!unitsOnly && !selectedPropId ? ' Property +' : ''} {rows.length} Unit{rows.length !== 1 ? 's' : ''}
              </button>
            )}

            {mode === 'import' && (
              <button
                onClick={runImport}
                disabled={importing || csvRows.filter(r => !r._error).length === 0}
                className="flex items-center gap-2 text-sm font-semibold text-white px-6 py-2.5 rounded-xl disabled:opacity-50 cursor-pointer"
                style={{ background: '#2e9f82' }}
              >
                {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                Import {csvRows.filter(r => !r._error).length} Rows
              </button>
            )}
          </div>
        )}

        {addendumEditorOpen && (
          <AddendumEditorModal value={addendumTerms} onChange={setAddendumTerms} onClose={() => setAddendumEditorOpen(false)}
            title="Agreement Addendum" subtitle="Write the terms; they're applied to the layout(s) you create. Preview on the right." />
        )}
      </div>
    </div>
  );
}

/* ─── ViewInput ───────────────────────────────────────────────────────────── */
function ViewInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const filtered = value.length >= 3
    ? VIEW_OPTIONS.filter(v => v.toLowerCase().includes(value.toLowerCase()))
    : [];
  const exactMatch = VIEW_OPTIONS.some(v => v.toLowerCase() === value.toLowerCase());
  const showCustom  = open && value.length >= 3 && !exactMatch;
  const showDropdown = open && value.length >= 3 && (filtered.length > 0 || showCustom);

  const select = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div className="relative">
      <input
        className="w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]"
        placeholder="e.g. Sea View, Marina View…"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (value.length >= 3) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      />
      {value.length > 0 && value.length < 3 && (
        <p className="text-[10px] text-[#9b9890] mt-0.5">
          Type {3 - value.length} more character{3 - value.length !== 1 ? 's' : ''} to see suggestions
        </p>
      )}
      {showDropdown && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-[#e8e6e0] rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map(v => (
            <button key={v} type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => select(v)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                value === v
                  ? 'bg-[#f0fdf8] text-[#1a7a5a] font-medium'
                  : 'text-[#1a1916] hover:bg-[#f4f3ef]'
              }`}>
              {v}
            </button>
          ))}
          {showCustom && (
            <div className={filtered.length > 0 ? 'border-t border-[#f0ede8]' : ''}>
              <button type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => select(value)}
                className="w-full text-left px-3 py-2 text-sm text-[#2e9f82] font-medium hover:bg-[#f0fdf8] transition-colors">
                + Use &quot;{value}&quot;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── UnitCard ────────────────────────────────────────────────────────────── */
function UnitCard({
  row, index, unitTypes, propCategory, errors, onUpdate, onDelete, onDuplicate, onToggle, onStagePhotos, onRemovePhoto, onReorderPhotos, onSetFloorPlan, canDelete,
}: {
  row: UnitRow;
  index: number;
  unitTypes: string[];
  propCategory: string;
  errors: Partial<Record<keyof UnitRow, string>>;
  onUpdate: (patch: Partial<UnitRow>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onStagePhotos: (files: File[]) => void;
  onRemovePhoto: (idx: number) => void;
  onReorderPhotos: (newPhotos: StagedPhoto[]) => void;
  onSetFloorPlan: (file: File | null) => void;
  canDelete: boolean;
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const floorPlanInputRef = useRef<HTMLInputElement>(null);
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const showBedBath = !row.unitType || RESIDENTIAL_UNIT_TYPES.includes(row.unitType);
  const isResidentialUnit = propCategory === 'residential' || RESIDENTIAL_UNIT_TYPES.includes(row.unitType);

  const INPUT_C  = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
  const INPUT_ERR = 'w-full border border-red-400 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400';
  const SELECT_C = INPUT_C + ' appearance-none';

  return (
    <div id={`unit-card-${row.id}`} className="bg-white rounded-xl border border-[#e8e6e0] overflow-hidden">
      {/* Card header — always visible */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="w-6 h-6 rounded-full bg-[#f4f3ef] flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-[#9b9890]">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          {row.expanded ? (
            <p className="text-sm font-semibold text-[#1a1916]">Unit {index + 1}</p>
          ) : (
            <p className="text-sm font-medium text-[#1a1916] truncate">{unitLabel(row)}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {row.stagedPhotos.length > 0 && !row.expanded && (
            <span className="flex items-center gap-1 text-[10px] text-[#9b9890]">
              <Camera size={11} /> {row.stagedPhotos.length}
            </span>
          )}
          {Object.keys(errors).length > 0 && (
            <AlertCircle size={14} className="text-red-500" />
          )}
          <button onClick={e => { e.stopPropagation(); onDuplicate(); }}
            className="text-[#c8c6c0] hover:text-[#2e9f82] cursor-pointer p-1" title="Duplicate unit">
            <Copy size={14} />
          </button>
          {canDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              className="text-[#c8c6c0] hover:text-red-500 cursor-pointer p-1">
              <Trash2 size={14} />
            </button>
          )}
          {row.expanded ? <ChevronUp size={15} className="text-[#9b9890]" /> : <ChevronDown size={15} className="text-[#9b9890]" />}
        </div>
      </div>

      {/* Expanded fields */}
      {row.expanded && (
        <div className="px-4 pb-5 border-t border-[#f0ede8] pt-4 space-y-4">

          {/* Row 1: Listing Unit Title — full width */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Listing Unit Title</label>
            <input className={INPUT_C}
              placeholder="e.g. Spacious 2BR Apartment with Balcony in Al Raffa"
              value={row.unitName}
              onChange={e => onUpdate({ unitName: e.target.value })} />
          </div>

          {/* Row 2: Unit Type + Unit Number + Floor */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Type <span className="text-red-500">*</span></label>
              <select className={errors.unitType ? INPUT_ERR + ' appearance-none' : SELECT_C}
                value={row.unitType}
                onChange={e => onUpdate({ unitType: e.target.value })}>
                <option value="">Select type</option>
                {unitTypes.map(t => <option key={t} value={t}>{UNIT_TYPE_LABELS[t] ?? t.replace(/_/g, ' ')}</option>)}
              </select>
              {errors.unitType && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitType}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Tier</label>
              <select className={SELECT_C} value={row.unitTier} onChange={e => onUpdate({ unitTier: e.target.value })}>
                {UNIT_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Number <span className="text-red-500">*</span></label>
              <input className={errors.unitNumber ? INPUT_ERR : INPUT_C}
                placeholder="e.g. 101, G-02"
                value={row.unitNumber}
                onChange={e => onUpdate({ unitNumber: e.target.value })} />
              {errors.unitNumber && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitNumber}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Floor</label>
              <input className={INPUT_C} placeholder="e.g. G, 1, 2…"
                value={row.floor} onChange={e => onUpdate({ floor: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Utility Premises No.</label>
              <input className={INPUT_C} placeholder="e.g. 1234567"
                value={row.premiseNumber} onChange={e => onUpdate({ premiseNumber: e.target.value })} />
            </div>
          </div>

          {/* Row 3: Beds + Baths + Furnishing (residential only) */}
          {showBedBath && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Bedrooms</label>
                <select className={SELECT_C} value={row.bedrooms} onChange={e => onUpdate({ bedrooms: e.target.value })}>
                  {['Studio', '1', '2', '3', '4', '5', '6+'].map(b => (
                    <option key={b} value={b}>{b === 'Studio' ? 'Studio' : `${b} BR`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Bathrooms</label>
                <select className={SELECT_C} value={row.bathrooms} onChange={e => onUpdate({ bathrooms: e.target.value })}>
                  {['1', '2', '3', '4', '5+'].map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6b6860] mb-1">Furnishing</label>
                <select className={SELECT_C} value={row.furnishing} onChange={e => onUpdate({ furnishing: e.target.value })}>
                  {FURNISHING_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* View + Parking allocation */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[#6b6860] mb-1">View</label>
              <ViewInput value={row.view} onChange={v => onUpdate({ view: v })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Parking</label>
              <input type="number" min="0" step="1" className={INPUT_C} placeholder="e.g. 1"
                value={row.parkingSpaces} onChange={e => onUpdate({ parkingSpaces: e.target.value })} />
            </div>
          </div>

          {/* Row 4: Size (sq.ft ↔ sq.m, capture one) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.ft) <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="any"
                className={errors.unitSizeSqft ? INPUT_ERR : INPUT_C}
                placeholder="e.g. 1200"
                value={row.unitSizeSqft}
                onChange={e => onUpdate({ unitSizeSqft: e.target.value, unitSizeSqm: sqmFromSqft(e.target.value) })} />
              {errors.unitSizeSqft && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitSizeSqft}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.m)</label>
              <input type="number" min="0" step="any"
                className={INPUT_C}
                placeholder="e.g. 111"
                value={row.unitSizeSqm}
                onChange={e => onUpdate({ unitSizeSqm: e.target.value, unitSizeSqft: sqftFromSqm(e.target.value) })} />
              <p className="text-[10px] text-[#9b9890] mt-0.5">Auto-converts with sq.ft.</p>
            </div>
          </div>

          {/* Row 5: Annual rent — the single price (also the market/list price;
              a discount becomes the contract's annual rent). Mirrored into
              marketPrice on submit, so we don't expose a second field. */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Annual Rent (AED) <span className="text-red-500">*</span></label>
            <input type="number" min="0" step="any"
              className={errors.rentalPrice ? INPUT_ERR : INPUT_C}
              placeholder="e.g. 85000"
              value={row.rentalPrice}
              onChange={e => {
                const val = e.target.value;
                const rent = parseFloat(val);
                const patch: Partial<UnitRow> = { rentalPrice: val };
                if (!isNaN(rent) && rent > 0) {
                  patch.securityDeposit = String(Math.round(rent * 0.05));
                  patch.adminFee        = String(Math.round(rent * 0.05));
                  patch.ejariFeeFils    = isResidentialUnit ? '220' : '';
                  patch.commission      = String(Math.round(rent * 0.05));
                }
                onUpdate(patch);
              }} />
            {errors.rentalPrice && <p className="text-[10px] text-red-500 mt-0.5">{errors.rentalPrice}</p>}
          </div>

          {/* Financial details box */}
          <div className="rounded-xl border border-[#a7f3d0] bg-[#f0fdf8] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a7a5a]">Financial Details</p>
              {row.rentalPrice && (
                <span className="text-[10px] text-[#4aaa8a]">Calculated from annual rent · edit to adjust</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Security Deposit</label>
                <input type="number" min="0" step="any" className={INPUT_C}
                  placeholder="e.g. 10000"
                  value={row.securityDeposit}
                  onChange={e => onUpdate({ securityDeposit: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Admin Fee</label>
                <input type="number" min="0" step="any" className={INPUT_C}
                  placeholder="e.g. 5000"
                  value={row.adminFee}
                  onChange={e => onUpdate({ adminFee: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Ejari Fee</label>
                <input type="number" min="0" step="any" className={INPUT_C}
                  placeholder="220"
                  value={row.ejariFeeFils}
                  onChange={e => onUpdate({ ejariFeeFils: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Commission</label>
                <input type="number" min="0" step="any" className={INPUT_C}
                  placeholder="e.g. 4000"
                  value={row.commission}
                  onChange={e => onUpdate({ commission: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Service Charges</label>
                <input type="number" min="0" step="any" className={INPUT_C}
                  placeholder="e.g. 3000"
                  value={row.serviceCharges}
                  onChange={e => onUpdate({ serviceCharges: e.target.value })} />
              </div>
            </div>

            {/* Additional Payments — extra one-off charges shown to the customer
                on booking + added to the contract as "Others" rows. */}
            <div className="border-t border-[#a7f3d0] pt-3">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[#3d3b35]">Additional Payments</label>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-[#1a7a5a] hover:underline"
                  onClick={() => onUpdate({ additionalPayments: [...(row.additionalPayments ?? []), { label: '', amount: '', vat: '' }] })}
                >+ Add payment</button>
              </div>
              {(row.additionalPayments ?? []).length === 0 ? (
                <p className="text-[11px] text-[#9b9890] italic">None — only rent, deposit and the fees above apply.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_72px_72px_24px] gap-2 text-[10px] font-medium uppercase tracking-wider text-[#6b6860]">
                    <span>Label</span><span>Net AED</span><span>VAT AED</span><span />
                  </div>
                  {(row.additionalPayments ?? []).map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_72px_72px_24px] gap-2 items-center">
                      <input type="text" className={INPUT_C} placeholder="e.g. Chiller deposit"
                        value={p.label}
                        onChange={e => onUpdate({ additionalPayments: (row.additionalPayments ?? []).map((r, j) => j === i ? { ...r, label: e.target.value } : r) })} />
                      <input type="number" min="0" step="any" className={INPUT_C} placeholder="0"
                        value={p.amount}
                        onChange={e => onUpdate({ additionalPayments: (row.additionalPayments ?? []).map((r, j) => j === i ? { ...r, amount: e.target.value } : r) })} />
                      <input type="number" min="0" step="any" className={INPUT_C} placeholder="0"
                        value={p.vat}
                        onChange={e => onUpdate({ additionalPayments: (row.additionalPayments ?? []).map((r, j) => j === i ? { ...r, vat: e.target.value } : r) })} />
                      <button type="button" title="Remove"
                        className="text-[#b91c1c] hover:bg-[#fee2e2] rounded-md w-6 h-6 flex items-center justify-center text-base leading-none"
                        onClick={() => onUpdate({ additionalPayments: (row.additionalPayments ?? []).filter((_, j) => j !== i) })}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Leasing Configuration — cadence, lease terms + payment terms.
              Annual rent stays the rate; rental type only slices the plan. */}
          <div className="rounded-xl border border-[#ede9fe] bg-[#f5f3ff] p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6d28d9]">Leasing Configuration</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Rental Type</label>
                <select className={SELECT_C} value={row.rentalType} onChange={e => onUpdate({ rentalType: e.target.value })}>
                  {RENTAL_TYPE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Min. Lease (months)</label>
                <input type="number" min="0" step="any" className={INPUT_C} placeholder="12"
                  value={row.minLeaseMonths} onChange={e => onUpdate({ minLeaseMonths: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Notice (days)</label>
                <input type="number" min="0" step="any" className={INPUT_C} placeholder="60"
                  value={row.noticePeriodDays} onChange={e => onUpdate({ noticePeriodDays: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">No. of Payments</label>
                <input type="number" min="1" step="1" className={INPUT_C} placeholder="e.g. 4"
                  value={row.numberOfPayments} onChange={e => onUpdate({ numberOfPayments: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Advance Payment</label>
                <input type="number" min="0" step="any" className={INPUT_C} placeholder="e.g. 5000"
                  value={row.advancePayment} onChange={e => onUpdate({ advancePayment: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Rent Escalation (%/yr)</label>
                <input type="number" min="0" max="100" step="0.5" className={INPUT_C} placeholder="e.g. 5"
                  value={row.rentEscalationPct} onChange={e => onUpdate({ rentEscalationPct: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Grace Period (days)</label>
                <input type="number" min="0" step="1" className={INPUT_C} placeholder="e.g. 7"
                  value={row.gracePeriodDays} onChange={e => onUpdate({ gracePeriodDays: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Late Payment Fee (AED)</label>
                <input type="number" min="0" step="any" className={INPUT_C} placeholder="e.g. 500"
                  value={row.latePaymentFee} onChange={e => onUpdate({ latePaymentFee: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Agreement addendum is set once for the whole listing (below the units),
              not per unit — see the "Agreement Addendum" section. */}

          {/* Amenities */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-2">
              Amenities
              {row.amenities.length > 0 && (
                <span className="ml-1.5 text-[#2e9f82] font-semibold">{row.amenities.length} selected</span>
              )}
            </label>
            {!propCategory ? (
              <p className="text-xs text-[#9b9890] bg-[#f4f3ef] rounded-lg px-3 py-2.5">
                Select a property category above to see relevant amenities.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {getAmenitiesForCategory(propCategory).map(a => (
                  <button
                    key={a} type="button"
                    onClick={() => onUpdate({ amenities: row.amenities.includes(a) ? row.amenities.filter(x => x !== a) : [...row.amenities, a] })}
                    className={`px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-colors ${
                      row.amenities.includes(a)
                        ? 'border-[#2e9f82] bg-[#d8f2e8] text-[#1a7a5a]'
                        : 'border-[#e8e6e0] text-[#6b6860] hover:border-[#c8c6c0]'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Unit Description</label>
            <textarea className={INPUT_C + ' min-h-[70px] resize-vertical'}
              placeholder="Describe this unit for the listing — features, highlights, unique selling points…"
              value={row.description}
              onChange={e => onUpdate({ description: e.target.value })} />
          </div>

          {/* Row 9: Photos */}
          <div>
            {/* Hidden single file input — all triggers use this ref */}
            <input
              ref={photoInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={e => {
                const files = e.target.files ? Array.from(e.target.files) : [];
                if (files.length) onStagePhotos(files);
                e.target.value = '';
              }}
            />

            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-[#6b6860]">
                Unit Photos
                <span className="text-[#9b9890] font-normal ml-1">({row.stagedPhotos.length}/20)</span>
                {row.stagedPhotos.length > 1 && (
                  <span className="text-[#9b9890] font-normal ml-2">· drag to set cover</span>
                )}
              </p>
              {row.stagedPhotos.length > 0 && row.stagedPhotos.length < 20 && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer"
                >
                  <ImagePlus size={13} /> Add Photos
                </button>
              )}
            </div>

            {row.stagedPhotos.length === 0 ? (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-5 hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors cursor-pointer"
              >
                <Camera size={22} className="text-[#c8c6c0] mb-1.5" />
                <span className="text-xs text-[#9b9890]">Click to add photos</span>
              </button>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {row.stagedPhotos.map((sp, idx) => (
                  <div
                    key={sp.previewUrl}
                    draggable
                    onDragStart={() => { dragIdxRef.current = idx; }}
                    onDragOver={(e) => { e.preventDefault(); setDragOverIdx(idx); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragIdxRef.current;
                      if (from !== null && from !== idx) {
                        const arr = [...row.stagedPhotos];
                        const [moved] = arr.splice(from, 1);
                        arr.splice(idx, 0, moved);
                        onReorderPhotos(arr);
                      }
                      dragIdxRef.current = null;
                      setDragOverIdx(null);
                    }}
                    onDragEnd={() => { dragIdxRef.current = null; setDragOverIdx(null); }}
                    className={`relative rounded-lg overflow-hidden border group transition-all select-none
                      ${idx === 0 ? 'w-24 h-24' : 'w-20 h-20'}
                      ${dragOverIdx === idx && dragIdxRef.current !== idx
                        ? 'border-[#2e9f82] ring-2 ring-[#2e9f82] scale-105'
                        : idx === 0 ? 'border-[#2e9f82]' : 'border-[#e8e6e0]'}
                    `}
                    style={{ cursor: 'grab' }}
                  >
                    {/* Cover badge */}
                    {idx === 0 && (
                      <div className="absolute bottom-0 left-0 right-0 bg-[#2e9f82] text-white text-[9px] font-bold text-center py-0.5 z-10 leading-tight">
                        COVER
                      </div>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sp.previewUrl} alt="" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onRemovePhoto(idx); }}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}

                {row.stagedPhotos.length < 20 && (
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="w-20 h-20 rounded-lg border-2 border-dashed border-[#e8e6e0] flex items-center justify-center cursor-pointer hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors"
                  >
                    <Plus size={16} className="text-[#c8c6c0]" />
                  </button>
                )}
              </div>
            )}
            <p className="text-[10px] text-[#9b9890] mt-1">JPEG, PNG or WebP · up to 20 per unit · drag thumbnails to reorder · first image is the cover.</p>
          </div>

          {/* Row 10: Floor plan */}
          <div>
            <input
              ref={floorPlanInputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={e => { const f = e.target.files?.[0] ?? null; if (f) onSetFloorPlan(f); e.target.value = ''; }}
            />
            <p className="text-xs font-medium text-[#6b6860] mb-2">
              Floor plan <span className="text-[#9b9890] font-normal">(optional)</span>
            </p>
            {row.stagedFloorPlan ? (
              <div className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2">
                <Upload size={14} className="text-[#2e9f82] shrink-0" />
                <span className="text-sm text-[#1a1916] truncate flex-1">{row.stagedFloorPlan.name}</span>
                <button type="button" onClick={() => floorPlanInputRef.current?.click()}
                  className="text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer">Replace</button>
                <button type="button" onClick={() => onSetFloorPlan(null)}
                  className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center text-[#9b9890] hover:text-[#b91c1c] cursor-pointer">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => floorPlanInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-5 hover:border-[#2e9f82] hover:bg-[#f0fdf8] transition-colors cursor-pointer">
                <Upload size={20} className="text-[#c8c6c0] mb-1.5" />
                <span className="text-xs text-[#9b9890]">Click to attach a floor plan (PDF or image)</span>
              </button>
            )}
            <p className="text-[10px] text-[#9b9890] mt-1">PDF, PNG, JPG or WebP · the layout drawing for this unit.</p>
          </div>
        </div>
      )}
    </div>
  );

}
