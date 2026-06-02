'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, Upload, Download, CheckCircle2,
  AlertCircle, Loader2, FileSpreadsheet, ChevronDown, ChevronUp,
  ImagePlus, X, Camera, Copy, MapPin,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import {
  SPACE_CATEGORIES, BuildingSearch, StreetSearch,
  type PropertyFormData, type SearchResult, type LocalSuggestion,
} from '@/components/upnow/PropertyFormModal';
import { MapPicker } from '@/components/upnow/MapPicker';
import {
  RESIDENTIAL_UNIT_TYPES, COMMERCIAL_UNIT_TYPES, INDUSTRIAL_UNIT_TYPES,
  WORKSPACES_UNIT_TYPES, VENUES_UNIT_TYPES,
  FURNISHING_OPTIONS, AMENITIES, UNIT_TYPE_LABELS,
} from '@/components/upnow/UnitFormModal';

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

function FieldErr({ msg }: { msg?: string }) {
  return msg ? <p className="text-[10px] text-red-500 mt-0.5">{msg}</p> : null;
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
interface Emirate   { id: number; nameEn: string }
interface Community { id: number; nameEn: string }
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
  unitNumber: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
  unitSizeSqft: string;
  furnishing: string;
  rentalPrice: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  view: string;
  amenities: string[];
  minLeaseMonths: string;
  noticePeriodDays: string;
  rentEscalationPct: string;
  description: string;
  stagedPhotos: StagedPhoto[];
}

function emptyRow(expanded = true): UnitRow {
  return {
    id: Math.random().toString(36).slice(2),
    expanded,
    unitName: '', unitType: '', unitNumber: '',
    floor: '', bedrooms: '1', bathrooms: '1', unitSizeSqft: '',
    furnishing: 'Unfurnished', rentalPrice: '',
    securityDeposit: '', adminFee: '', ejariFeeFils: '', commission: '',
    view: '', amenities: [], minLeaseMonths: '12', noticePeriodDays: '60',
    rentEscalationPct: '', description: '', stagedPhotos: [],
  };
}

const EMPTY_PROP: PropertyFormData = {
  buildingName: '', spaceCategory: '',
  emirateId: null, communityId: null, emirateName: '', communityName: '',
  street: '', makaniNumber: '', plotNumber: '', numberOfFloors: '',
  propertyDescription: '', latitude: null, longitude: null,
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
  googlePlaceId: null,
};

/* ─── CSV helpers ─────────────────────────────────────────────────────────── */
const CSV_TEMPLATE = [
  'building_name,category,emirate,address,unit_name,unit_type,unit_number,floor,bedrooms,bathrooms,size_sqft,annual_rent_aed,security_deposit_aed,admin_fee_aed,ejari_fee_aed,commission_aed,furnishing,view,min_lease_months,notice_period_days,rent_escalation_pct,description',
  'Marina Heights,residential,Dubai,Dubai Marina Building 5,Sea View Suite,apartment,101,1,2,1,1200,120000,6000,6000,220,6000,Unfurnished,Sea View,12,60,,Corner unit with balcony',
  'Marina Heights,residential,Dubai,Dubai Marina Building 5,,apartment,102,1,1,1,800,85000,4250,4250,220,4250,Semi-Furnished,,12,60,,',
  'Business Bay Tower,commercial,Dubai,Business Bay,,office_fitted,Office-5A,5,,,1500,200000,10000,10000,,10000,,City View,12,90,5,Fitted office space',
  'Dubai Industrial City,industrial,Dubai,DIC Phase 2,,warehouse,WH-01,G,,,25000,350000,17500,17500,,17500,,Road View,24,90,5,Climate-controlled warehouse with dock',
  'Creative Hub JLT,workspaces,Dubai,JLT Cluster X,,coworking_desk,Desk-22,3,,,80,18000,900,900,,900,,City View,1,30,,Hot desk in vibrant coworking space',
  'Grand Ballroom Palace,venues,Dubai,Al Quoz,,event_hall,Main Hall,G,,,8000,500000,25000,25000,,25000,,,,0,14,,Premier event hall with full AV setup',
].join('\n');

interface CsvRow {
  building_name: string; category: string; emirate: string; address: string;
  unit_name: string; unit_type: string; unit_number: string; floor: string;
  bedrooms: string; bathrooms: string; size_sqft: string;
  annual_rent_aed: string;
  security_deposit_aed: string; admin_fee_aed: string;
  ejari_fee_aed: string; commission_aed: string;
  furnishing: string; view: string;
  min_lease_months: string; notice_period_days: string; rent_escalation_pct: string;
  description: string;
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

function unitTypesFor(cat: string) {
  if (cat === 'commercial')  return COMMERCIAL_UNIT_TYPES;
  if (cat === 'industrial')  return INDUSTRIAL_UNIT_TYPES;
  if (cat === 'workspaces')  return WORKSPACES_UNIT_TYPES;
  if (cat === 'venues')      return VENUES_UNIT_TYPES;
  return RESIDENTIAL_UNIT_TYPES;
}

function isResidential(unitType: string) {
  return RESIDENTIAL_UNIT_TYPES.includes(unitType);
}

function unitLabel(r: UnitRow) {
  const parts: string[] = [];
  if (r.unitName) parts.push(r.unitName);
  if (r.unitType) parts.push(r.unitType.replace(/_/g, ' '));
  if (r.unitNumber) parts.push(`#${r.unitNumber}`);
  if (r.bedrooms && r.bedrooms !== 'Studio' && isResidential(r.unitType)) parts.push(`${r.bedrooms} Bed`);
  if (r.unitSizeSqft) parts.push(`${r.unitSizeSqft} sqft`);
  if (r.rentalPrice) parts.push(`AED ${Number(r.rentalPrice).toLocaleString('en-AE')}`);
  return parts.join('  ·  ') || 'New Unit';
}

/* ══════════════════════════════════════════════════════════════════════════ */
export default function AddListingPage() {
  const router = useRouter();
  type Mode = 'new' | 'import';
  const [mode, setMode] = useState<Mode>('new');

  /* property form */
  const [pf, setPf]   = useState<PropertyFormData>({ ...EMPTY_PROP });
  const [pe, setPe]   = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [emirates, setEmirates]       = useState<Emirate[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loadingComms, setLoadingComms] = useState(false);
  const [loadCommsFor, setLoadCommsFor] = useState<number | null>(null);
  const [autoFilled, setAutoFilled]   = useState(false);
  const [showMap, setShowMap]         = useState(false);
  const [buildingQuery, setBuildingQuery] = useState('');
  const pendingCommunityRef           = useRef<string>('');

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
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState(false);
  const [doneMsg, setDoneMsg] = useState('');
  const [doneErrs, setDoneErrs] = useState<string[]>([]);

  /* importing */
  const [importing, setImporting]       = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importErrs, setImportErrs]     = useState<string[]>([]);

  useEffect(() => {
    apiGet<Emirate[]>('/locations/emirates').then(setEmirates).catch(() => {});
    apiGet<WizardProperty[]>('/properties').then(setExistingProps).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loadCommsFor) { setCommunities([]); return; }
    setLoadingComms(true);
    apiGet<Community[]>(`/locations/emirates/${loadCommsFor}/communities`)
      .then(comms => {
        setCommunities(comms);
        if (pendingCommunityRef.current) {
          const pending  = pendingCommunityRef.current.toLowerCase().trim();
          const tokenize = (s: string) => s.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
          const pTokens  = tokenize(pending);
          let bestScore = 0; let bestMatch: Community | null = null;
          for (const c of comms) {
            const dbT   = tokenize(c.nameEn.toLowerCase());
            const score = pTokens.filter(t => dbT.includes(t)).length / Math.max(pTokens.length, dbT.length);
            if (score > bestScore) { bestScore = score; bestMatch = c; }
          }
          if (bestMatch && bestScore >= 0.5)
            setPf(prev => ({ ...prev, communityId: bestMatch!.id, communityName: bestMatch!.nameEn }));
          pendingCommunityRef.current = '';
        }
      })
      .catch(() => {})
      .finally(() => setLoadingComms(false));
  }, [loadCommsFor]);

  const updP = <K extends keyof PropertyFormData>(k: K, v: PropertyFormData[K]) => {
    setPf(prev => ({ ...prev, [k]: v }));
    setPe(prev => ({ ...prev, [k]: undefined }));
  };

  const handleSearchSelect = (r: SearchResult) => {
    const newEmirateId: number | null = r.emirateId !== undefined
      ? (r.emirateId ?? null)
      : (() => {
          const mb = r.emirateName.trim().toLowerCase();
          if (!mb) {
            const label = r.label.toLowerCase();
            return emirates.find(e => label.includes(e.nameEn.toLowerCase()))?.id ?? null;
          }
          return emirates.find(e => {
            const db = e.nameEn.toLowerCase();
            return db === mb || mb.includes(db) || db.includes(mb);
          })?.id ?? null;
        })();

    const emirateName = emirates.find(e => e.id === newEmirateId)?.nameEn ?? r.emirateName;
    const googlePlaceId = r.googlePlaceId != null
      ? r.googlePlaceId
      : (!r.id.startsWith('cache_') && !r.id.startsWith('local_') ? r.id : null);

    if (r.communityId != null) {
      pendingCommunityRef.current = '';
      setPf(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   r.communityId ?? null,
        communityName: '',
        googlePlaceId: googlePlaceId ?? prev.googlePlaceId,
      }));
    } else {
      pendingCommunityRef.current = r.communityName;
      setPf(prev => ({
        ...prev,
        ...(r.featureType === 'poi'  && r.name   && { buildingName: r.name }),
        ...(r.featureType !== 'area' && r.street && { street: r.street }),
        latitude:      r.lat || prev.latitude,
        longitude:     r.lng || prev.longitude,
        emirateId:     newEmirateId,
        emirateName,
        communityId:   null,
        communityName: '',
        googlePlaceId: googlePlaceId ?? prev.googlePlaceId,
      }));
    }

    setLoadCommsFor(null);
    setTimeout(() => setLoadCommsFor(newEmirateId), 0);
    setAutoFilled(true);
    setShowMap(true);
    setPe(prev => ({ ...prev, buildingName: undefined, emirateId: undefined }));
  };

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
    const dup: UnitRow = { ...src, id: Math.random().toString(36).slice(2), expanded: true, unitNumber: '', stagedPhotos: [] };
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id);
      const next = [...prev.map(r => ({ ...r, expanded: false }))];
      next.splice(idx + 1, 0, dup);
      return next;
    });
  };

  /* ── stage photos ── */
  const stagePhotos = (id: string, files: FileList) => {
    const newPhotos: StagedPhoto[] = [];
    Array.from(files).forEach(file => {
      newPhotos.push({ file, previewUrl: URL.createObjectURL(file) });
    });
    setRows(prev => prev.map(r => r.id === id
      ? { ...r, stagedPhotos: [...r.stagedPhotos, ...newPhotos].slice(0, 20) }
      : r));
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

  /* ── validate ── */
  function validate(): boolean {
    let ok = true;
    if (mode === 'new' && !selectedPropId) {
      const errs: typeof pe = {};
      if (!pf.spaceCategory) { errs.spaceCategory = 'Required'; ok = false; }
      if (!pf.emirateId)     { errs.emirateId = 'Required'; ok = false; }
      setPe(errs);
    }
    const newRowErrors: typeof rowErrors = {};
    for (const r of rows) {
      const e: Partial<Record<keyof UnitRow, string>> = {};
      if (!r.unitNumber.trim()) { e.unitNumber = 'Required'; ok = false; }
      if (!r.unitType)          { e.unitType   = 'Required'; ok = false; }
      if (!r.unitSizeSqft)      { e.unitSizeSqft = 'Required'; ok = false; }
      if (!r.rentalPrice)       { e.rentalPrice = 'Required'; ok = false; }
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
          buildingName: pf.buildingName,
          spaceCategory: pf.spaceCategory,
          fullAddress: parts.join(', ') || undefined,
          emirateId: pf.emirateId ?? undefined,
          communityId: pf.communityId ?? undefined,
          latitude: pf.latitude ?? undefined,
          longitude: pf.longitude ?? undefined,
          numberOfFloors: pf.numberOfFloors || undefined,
          makaniNumber: pf.makaniNumber || undefined,
          plotNumber: pf.plotNumber || undefined,
          hasGym: pf.hasGym, hasPool: pf.hasPool, hasParking: pf.hasParking,
          isStandaloneUnit: pf.isStandaloneUnit,
          propertyDescription: pf.propertyDescription || undefined,
          googlePlaceId: pf.googlePlaceId || undefined,
        });
        propId   = created.id;
        propName = created.buildingName;
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
            unitNumber:       r.unitNumber,
            floor:            r.floor           || undefined,
            bedrooms:         r.bedrooms && r.bedrooms !== 'Studio' ? Number(r.bedrooms) : undefined,
            bathrooms:        r.bathrooms       ? Number(r.bathrooms)       : undefined,
            unitSizeSqft:     r.unitSizeSqft    ? Number(r.unitSizeSqft)    : undefined,
            rentalPrice:      r.rentalPrice     ? Number(r.rentalPrice)     : undefined,
            securityDeposit:  r.securityDeposit ? Number(r.securityDeposit) : undefined,
            adminFee:         r.adminFee        ? Number(r.adminFee)        : undefined,
            ejariFeeFils:     r.ejariFeeFils    ? Number(r.ejariFeeFils)    : undefined,
            commission:       r.commission      ? Number(r.commission)      : undefined,
            minLeaseMonths:   r.minLeaseMonths   ? Number(r.minLeaseMonths)   : undefined,
            noticePeriodDays: r.noticePeriodDays ? Number(r.noticePeriodDays) : undefined,
            rentEscalationPct: r.rentEscalationPct ? Number(r.rentEscalationPct) : undefined,
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
  }, [mode, pf, rows, selectedPropId, existingProps]);

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
    const errs: string[] = [];
    for (const row of valid) {
      if (!propMap.has(row.building_name)) {
        const emirate = emirates.find(e => e.nameEn.toLowerCase() === (row.emirate ?? '').toLowerCase());
        try {
          const p = await apiPost<WizardProperty>('/properties', {
            buildingName: row.building_name || undefined,
            spaceCategory: row.category || 'residential',
            fullAddress: row.address || undefined,
            emirateId: emirate?.id,
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
            bedrooms:         row.bedrooms     ? Number(row.bedrooms)  : undefined,
            bathrooms:        row.bathrooms    ? Number(row.bathrooms) : undefined,
            unitSizeSqft:     row.size_sqft    ? Number(row.size_sqft) : undefined,
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

  // Local suggestions for BuildingSearch — filters RP's own properties
  const localBuildingSuggestions: LocalSuggestion[] = buildingQuery.length >= 2
    ? existingProps
        .filter(p => p.buildingName?.toLowerCase().includes(buildingQuery.toLowerCase()))
        .slice(0, 4)
        .map(p => ({
          id:          String(p.id),
          name:        p.buildingName || 'Unnamed',
          label:       p.fullAddress ?? '',
          lat:         p.latitude  != null ? Number(p.latitude)  : null,
          lng:         p.longitude != null ? Number(p.longitude) : null,
          emirateId:   p.emirateId   ?? null,
          communityId: p.communityId ?? null,
        }))
    : [];

  /* ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-full bg-[#f9f8f5]">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-[#e8e6e0] px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.push('/rental-provider/dashboard/portfolio')}
          className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] cursor-pointer"
        >
          <ArrowLeft size={16} /> Portfolio
        </button>
        <div className="w-px h-4 bg-[#e8e6e0]" />
        <div>
          <h1 className="font-semibold text-[#1a1916] text-sm leading-tight">Add Listing</h1>
          <p className="text-xs text-[#9b9890]">Property + units in one go</p>
        </div>

        {/* Mode tabs */}
        {!done && (
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
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">

        {/* ══ DONE ══ */}
        {done && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-10 text-center">
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
                }}
                className="px-5 py-2.5 rounded-lg border border-[#2e9f82] text-[#2e9f82] text-sm font-medium hover:bg-[#f0fdf8] cursor-pointer"
              >
                Add Another Listing
              </button>
              <button
                onClick={() => router.push('/rental-provider/dashboard/portfolio')}
                className="px-5 py-2.5 rounded-lg text-white text-sm font-semibold cursor-pointer"
                style={{ background: '#1a1916' }}
              >
                Go to Portfolio
              </button>
            </div>
          </div>
        )}

        {/* ══ PROPERTY DETAILS ══ */}
        {!done && mode === 'new' && (
          <Section title="Property Details">
            <div className="space-y-4">

              {/* Existing properties dropdown */}
              {existingProps.length > 0 && (
                <div>
                  <Label t="Select Existing Property" />
                  <select
                    className={SELECT}
                    value={selectedPropId ?? ''}
                    onChange={e => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const cat = existingProps.find(p => p.id === id)?.spaceCategory ?? '';
                      setSelectedPropId(id); setSelectedPropCat(cat); setError(null);
                    }}
                  >
                    <option value="">— Select a property —</option>
                    {existingProps.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.buildingName || 'Unnamed Property'}{p.fullAddress ? ` · ${p.fullAddress}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Divider */}
              {existingProps.length > 0 && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#e8e6e0]" /></div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-[10px] font-medium text-[#9b9890] uppercase tracking-wider">or create new</span>
                  </div>
                </div>
              )}

              {/* New property form — hidden when an existing property is selected */}
              {!selectedPropId && (<>

              {/* Category — only field the user sets manually */}
              <div>
                <Label t="Category" req />
                <select className={SELECT} value={pf.spaceCategory} onChange={e => updP('spaceCategory', e.target.value)}>
                  <option value="">Select category</option>
                  {SPACE_CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <FieldErr msg={pe.spaceCategory} />
              </div>

              {/* Search + Map — triggers auto-fill of all fields below */}
              <div>
                <Label t="Search Building / Address" />
                {autoFilled ? (
                  <div className="flex items-center gap-2 text-xs text-[#1a7a5a] bg-[#d8f2e8] rounded-lg px-3 py-2 mb-2">
                    <CheckCircle2 size={13} className="shrink-0" />
                    <span>
                      Fields auto-filled
                      {pf.buildingName ? ` · ${pf.buildingName}` : ''}
                      {pf.communityName ? `, ${pf.communityName}` : ''}
                      {pf.emirateName   ? `, ${pf.emirateName}`   : ''}
                      {' '}— review and adjust below
                    </span>
                  </div>
                ) : (
                  <p className="text-[10px] text-[#9b9890] mb-2">Search to auto-fill all fields below, or fill in manually</p>
                )}
                <BuildingSearch
                  onSelect={handleSearchSelect}
                  onManualEntry={() => setAutoFilled(false)}
                  onQueryChange={setBuildingQuery}
                  localSuggestions={localBuildingSuggestions}
                />
                <p className="text-[10px] text-[#9b9890] mt-1 mb-3">Powered by Google Places · UAE buildings &amp; addresses</p>
                {showMap ? (
                  <MapPicker
                    latitude={pf.latitude} longitude={pf.longitude}
                    onChange={(lat, lng) => { updP('latitude', lat); updP('longitude', lng); }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowMap(true)}
                    className="w-full h-[220px] rounded-xl border border-dashed border-[#e8e6e0] bg-[#f9f8f5] flex flex-col items-center justify-center gap-2 text-[#9b9890] hover:border-[#2e9f82] hover:text-[#2e9f82] transition-colors cursor-pointer"
                  >
                    <MapPin size={20} className="opacity-40" />
                    <span className="text-xs">Search above to pin location, or click to open map</span>
                  </button>
                )}
              </div>

              {/* Emirate | Community — auto-filled from search */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label t="Emirate" req />
                  <select className={SELECT} value={pf.emirateId ?? ''} onChange={e => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    const name = emirates.find(em => em.id === id)?.nameEn ?? '';
                    setPf(prev => ({ ...prev, emirateId: id, emirateName: name, communityId: null, communityName: '' }));
                    setLoadCommsFor(id);
                  }}>
                    <option value="">Select</option>
                    {emirates.map(em => <option key={em.id} value={em.id}>{em.nameEn}</option>)}
                  </select>
                  <FieldErr msg={pe.emirateId} />
                </div>
                <div>
                  <Label t="Community / Area" />
                  <select className={SELECT} value={pf.communityId ?? ''} disabled={!pf.emirateId || loadingComms}
                    onChange={e => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const name = communities.find(c => c.id === id)?.nameEn ?? '';
                      updP('communityId', id); updP('communityName', name);
                    }}>
                    <option value="">{loadingComms ? 'Loading…' : pf.emirateId ? 'Select community' : 'Select emirate first'}</option>
                    {communities.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
                  </select>
                </div>
              </div>

              {/* Building Name | Street — auto-filled from search */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label t="Building / Property Name" />
                  <input className={INPUT} placeholder="e.g. Marina Heights"
                    value={pf.buildingName} onChange={e => updP('buildingName', e.target.value)} />
                  <FieldErr msg={pe.buildingName} />
                </div>
                <div>
                  <Label t="Street / Address" />
                  <StreetSearch
                    value={pf.street}
                    onChange={v => updP('street', v)}
                    onCoords={(lat, lng) => { updP('latitude', lat); updP('longitude', lng); }}
                  />
                </div>
              </div>

              {/* Plot Number — manual only */}
              <div>
                <Label t="Plot Number" />
                <input className={INPUT} placeholder="e.g. 123-456"
                  value={pf.plotNumber} onChange={e => updP('plotNumber', e.target.value)} />
              </div>

              </>)}
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
                        ['category',             '',  'residential | commercial | industrial'],
                        ['emirate',              '',  'e.g. Dubai, Abu Dhabi'],
                        ['address',              '',  'Full street address'],
                        ['unit_name',            '',  'Listing title / display name'],
                        ['unit_type',            '',  'apartment, villa, office_fitted …'],
                        ['unit_number',          '✓', 'Unique identifier per building'],
                        ['floor',                '',  'Floor number or label'],
                        ['bedrooms',             '',  'Number or Studio'],
                        ['bathrooms',            '',  'Number'],
                        ['size_sqft',            '',  'e.g. 1200'],
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
                          {['Building', 'Unit #', 'Type', 'Beds', 'sqft', 'Rent AED', 'View', ''].map(h => (
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
                            <td className="px-3 py-1.5">{row.size_sqft || '—'}</td>
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

        {/* ══ UNITS section (new + existing modes) ══ */}
        {!done && mode !== 'import' && (
          <Section title={`Units  ·  ${rows.length} added`}>
            <div className="space-y-3">
              {rows.map((r, i) => (
                <UnitCard
                  key={r.id}
                  row={r}
                  index={i}
                  unitTypes={unitTypesFor(propCategory)}
                  propCategory={propCategory}
                  errors={rowErrors[r.id] ?? {}}
                  onUpdate={(patch) => updRow(r.id, patch)}
                  onDelete={() => delRow(r.id)}
                  onDuplicate={() => dupRow(r.id)}
                  onToggle={() => toggleRow(r.id)}
                  onStagePhotos={(files) => stagePhotos(r.id, files)}
                  onRemovePhoto={(idx) => removeStagedPhoto(r.id, idx)}
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
              onClick={() => router.push('/rental-provider/dashboard/portfolio')}
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
                Save{!selectedPropId ? ' Property +' : ''} {rows.length} Unit{rows.length !== 1 ? 's' : ''}
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
  row, index, unitTypes, propCategory, errors, onUpdate, onDelete, onDuplicate, onToggle, onStagePhotos, onRemovePhoto, canDelete,
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
  onStagePhotos: (files: FileList) => void;
  onRemovePhoto: (idx: number) => void;
  canDelete: boolean;
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);
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

          {/* View */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">View</label>
            <ViewInput value={row.view} onChange={v => onUpdate({ view: v })} />
          </div>

          {/* Row 4: Size + Annual Rent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Size (sq.ft) <span className="text-red-500">*</span></label>
              <input type="number" min="0"
                className={errors.unitSizeSqft ? INPUT_ERR : INPUT_C}
                placeholder="e.g. 1200"
                value={row.unitSizeSqft}
                onChange={e => onUpdate({ unitSizeSqft: e.target.value })} />
              {errors.unitSizeSqft && <p className="text-[10px] text-red-500 mt-0.5">{errors.unitSizeSqft}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6860] mb-1">Annual Rent (AED) <span className="text-red-500">*</span></label>
              <input type="number" min="0"
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
                <input type="number" min="0" className={INPUT_C}
                  placeholder="e.g. 10000"
                  value={row.securityDeposit}
                  onChange={e => onUpdate({ securityDeposit: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Admin Fee</label>
                <input type="number" min="0" className={INPUT_C}
                  placeholder="e.g. 5000"
                  value={row.adminFee}
                  onChange={e => onUpdate({ adminFee: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Ejari Fee</label>
                <input type="number" min="0" className={INPUT_C}
                  placeholder="220"
                  value={row.ejariFeeFils}
                  onChange={e => onUpdate({ ejariFeeFils: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#3d3b35] mb-1">Commission</label>
                <input type="number" min="0" className={INPUT_C}
                  placeholder="e.g. 4000"
                  value={row.commission}
                  onChange={e => onUpdate({ commission: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Amenities */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-2">Amenities</label>
            <div className="flex flex-wrap gap-2">
              {AMENITIES.map(a => (
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
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-[#6b6860]">
                Unit Photos <span className="text-[#9b9890] font-normal">({row.stagedPhotos.length}/20)</span>
              </label>
              {row.stagedPhotos.length < 20 && (
                <button type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-[#2e9f82] font-medium hover:text-[#1f6655] cursor-pointer">
                  <ImagePlus size={13} /> Add Photos
                </button>
              )}
            </div>
            <input ref={photoInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={e => { if (e.target.files) stagePhotos(e.target.files); e.target.value = ''; }} />

            {row.stagedPhotos.length === 0 ? (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-5 cursor-pointer hover:border-[#2e9f82] transition-colors">
                <Camera size={22} className="text-[#c8c6c0] mb-1.5" />
                <span className="text-xs text-[#9b9890]">Click to add photos</span>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only"
                  onChange={e => { if (e.target.files) stagePhotos(e.target.files); e.target.value = ''; }} />
              </label>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {row.stagedPhotos.map((sp, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[#e8e6e0] group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sp.previewUrl} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => onRemovePhoto(idx)}
                      className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {row.stagedPhotos.length < 20 && (
                  <label className="w-20 h-20 rounded-lg border-2 border-dashed border-[#e8e6e0] flex items-center justify-center cursor-pointer hover:border-[#2e9f82] transition-colors">
                    <Plus size={16} className="text-[#c8c6c0]" />
                    <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only"
                      onChange={e => { if (e.target.files) stagePhotos(e.target.files); e.target.value = ''; }} />
                  </label>
                )}
              </div>
            )}
            <p className="text-[10px] text-[#9b9890] mt-1">Photos will be uploaded after saving. JPEG, PNG or WebP, up to 20 per unit.</p>
          </div>
        </div>
      )}
    </div>
  );

  function stagePhotos(files: FileList) {
    onStagePhotos(files);
  }
}
