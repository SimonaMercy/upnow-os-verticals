'use client';

/**
 * AddListingWizard — single-screen combined property + units form.
 *
 * Three modes (tabs):
 *   New Property  — property fields at top + inline unit rows below
 *   Use Existing  — pick an existing property + same unit rows
 *   Import CSV    — upload one file that contains both property and unit columns
 *
 * One "Save All" button creates the property (if new) and all unit rows together.
 *
 * CSV format (each row = one unit, properties grouped by building_name):
 *   building_name, category, emirate, address, unit_number, unit_name,
 *   unit_type, floor, bedrooms, bathrooms, size_sqft,
 *   annual_rent_aed, service_charges_aed, description
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Building2, Plus, Trash2, Upload, Download,
  CheckCircle2, AlertCircle, Loader2, FileSpreadsheet, ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { SPACE_CATEGORIES, type PropertyFormData } from './PropertyFormModal';
import {
  RESIDENTIAL_UNIT_TYPES, COMMERCIAL_UNIT_TYPES, INDUSTRIAL_UNIT_TYPES,
  FURNISHING_OPTIONS, AMENITIES, UNIT_TIERS,
  type UnitFormData,
} from './UnitFormModal';

/* ─── styles ──────────────────────────────────────────────────────────────── */
const INPUT  = 'w-full border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const SELECT = INPUT + ' appearance-none';
const ERR    = 'text-[10px] text-red-500 mt-0.5';

function Label({ t, req }: { t: string; req?: boolean }) {
  return (
    <label className="block text-xs font-medium text-[#6b6860] mb-1">
      {t}{req && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function unitTypesFor(cat: string) {
  if (cat === 'commercial') return COMMERCIAL_UNIT_TYPES;
  if (cat === 'industrial') return INDUSTRIAL_UNIT_TYPES;
  return RESIDENTIAL_UNIT_TYPES;
}

/* ─── Types ───────────────────────────────────────────────────────────────── */
interface Country   { id: number; nameEn: string; code: string }
interface Emirate   { id: number; nameEn: string }
interface Community { id: number; nameEn: string }

export interface WizardProperty {
  id: number;
  buildingName: string;
  spaceCategory: string;
  fullAddress: string | null;
}

const EMPTY_PROP: PropertyFormData = {
  buildingName: '', spaceCategory: '', leasingType: 'direct',
  countryId: null, emirateId: null, cityId: null, communityId: null, subCommunityId: null,
  countryName: '', emirateName: '', cityName: '', communityName: '', subCommunityName: '',
  street: '', makaniNumber: '', plotNumber: '', sewerageNumber: '', numberOfFloors: '', numberOfUnits: '',
  propertyDescription: '', latitude: null, longitude: null,
  googlePlaceId: null,
  sharedAmenities: [],
  hasGym: false, hasPool: false, hasParking: false, isStandaloneUnit: false,
};

/* ── unit row in the inline table ── */
interface UnitRow {
  id: string;
  unitNumber: string;
  unitName: string;
  unitType: string;
  unitTier: string;
  floor: string;
  bedrooms: string;
  bathrooms: string;
  unitSizeSqft: string;
  rentalPrice: string;
  serviceCharges: string;
  securityDeposit: string;
  adminFee: string;
  ejariFeeFils: string;
  commission: string;
  view: string;
  furnishing: string;
  amenities: string[];
  description: string;
}

function emptyRow(): UnitRow {
  return {
    id: Math.random().toString(36).slice(2),
    unitNumber: '', unitName: '', unitType: '', unitTier: 'standard',
    floor: '', bedrooms: '1', bathrooms: '1', unitSizeSqft: '',
    rentalPrice: '', serviceCharges: '', securityDeposit: '',
    adminFee: '', ejariFeeFils: '', commission: '',
    view: '', furnishing: 'Unfurnished', amenities: [], description: '',
  };
}

/* ─── CSV helpers ─────────────────────────────────────────────────────────── */
const CSV_TEMPLATE = [
  'building_name,category,emirate,address,unit_number,unit_name,unit_type,floor,bedrooms,bathrooms,size_sqft,annual_rent_aed,service_charges_aed,description',
  'Marina Heights,residential,Dubai,Dubai Marina Building 5,101,Sea View Suite,apartment,1,2,1,1200,120000,15000,Corner unit with sea view',
  'Marina Heights,residential,Dubai,Dubai Marina Building 5,102,,apartment,1,1,1,800,85000,12000,',
  'Business Bay Tower,commercial,Dubai,Business Bay,Office-5A,,office_fitted,5,,,1500,200000,20000,Fitted office space',
].join('\n');

interface CsvRow {
  building_name: string; category: string; emirate: string; address: string;
  unit_number: string; unit_name: string; unit_type: string; floor: string;
  bedrooms: string; bathrooms: string; size_sqft: string;
  annual_rent_aed: string; service_charges_aed: string; description: string;
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
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
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

/* ─── Props ───────────────────────────────────────────────────────────────── */
interface Props {
  open: boolean;
  existingProperties: WizardProperty[];
  onClose: () => void;
  onDone: () => void;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
export function AddListingWizard({ open, existingProperties, onClose, onDone }: Props) {
  type Mode = 'new' | 'existing' | 'import';

  const [mode, setMode] = useState<Mode>('new');

  /* property form */
  const [pf, setPf]   = useState<PropertyFormData>({ ...EMPTY_PROP });
  const [pe, setPe]   = useState<Partial<Record<keyof PropertyFormData, string>>>({});
  const [countries, setCountries]     = useState<Country[]>([]);
  const [emirates, setEmirates]       = useState<Emirate[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loadingComms, setLoadingComms] = useState(false);
  const defaultCountryIdRef = useRef<number | null>(null);

  /* existing property picker */
  const [selectedPropId, setSelectedPropId]         = useState<number | null>(null);
  const [selectedPropCategory, setSelectedPropCategory] = useState('');

  /* unit rows */
  const [rows, setRows]       = useState<UnitRow[]>([emptyRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, Partial<Record<keyof UnitRow, string>>>>({});

  /* csv */
  const [csvRows, setCsvRows]   = useState<CsvRow[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [importing, setImporting]       = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importErrs, setImportErrs]     = useState<string[]>([]);

  /* general */
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [done, setDone]     = useState(false);
  const [doneMsg, setDoneMsg] = useState('');

  /* reset */
  useEffect(() => {
    if (!open) return;
    setMode('new'); setPf({ ...EMPTY_PROP }); setPe({});
    setSelectedPropId(null); setSelectedPropCategory('');
    setRows([emptyRow()]); setRowErrors({});
    setCsvRows([]); setCsvError(null); setImportErrs([]);
    setError(null); setDone(false); setDoneMsg('');
  }, [open]);

  /* countries — load once; auto-select UAE */
  useEffect(() => {
    if (countries.length > 0) return;
    apiGet<Country[]>('/locations/countries').then(cs => {
      setCountries(cs);
      const ae = cs.find(c => c.code === 'AE');
      if (ae) {
        defaultCountryIdRef.current = ae.id;
        setPf(prev => prev.countryId ? prev : { ...prev, countryId: ae.id, countryName: ae.nameEn });
        apiGet<Emirate[]>(`/locations/countries/${ae.id}/emirates`).then(setEmirates).catch(() => {});
      }
    }).catch(() => {});
  }, [countries.length]);

  /* reload emirates when country changes */
  useEffect(() => {
    if (!pf.countryId) { setEmirates([]); return; }
    apiGet<Emirate[]>(`/locations/countries/${pf.countryId}/emirates`).then(setEmirates).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pf.countryId]);

  /* communities cascade */
  useEffect(() => {
    if (!pf.emirateId) { setCommunities([]); return; }
    setLoadingComms(true);
    apiGet<Community[]>(`/locations/emirates/${pf.emirateId}/communities`)
      .then(setCommunities).catch(() => {}).finally(() => setLoadingComms(false));
  }, [pf.emirateId]);

  const updP = <K extends keyof PropertyFormData>(k: K, v: PropertyFormData[K]) => {
    setPf(prev => ({ ...prev, [k]: v }));
    setPe(prev => ({ ...prev, [k]: undefined }));
  };

  /* ── unit row helpers ── */
  const updRow = (id: string, k: keyof UnitRow, v: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [k]: v } : r));
    setRowErrors(prev => ({ ...prev, [id]: { ...prev[id], [k]: undefined } }));
  };
  const addRow = () => setRows(prev => [...prev, emptyRow()]);
  const delRow = (id: string) => setRows(prev => prev.length > 1 ? prev.filter(r => r.id !== id) : prev);
  const dupRow = (id: string) => setRows(prev => {
    const idx = prev.findIndex(r => r.id === id);
    if (idx === -1) return prev;
    const copy = { ...prev[idx], id: Math.random().toString(36).slice(2), unitNumber: '' };
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });

  /* ── Validate ── */
  function validate(): boolean {
    let ok = true;
    if (mode === 'new') {
      const errs: typeof pe = {};
      if (!pf.spaceCategory) { errs.spaceCategory = 'Required'; ok = false; }
      setPe(errs);
    } else if (mode === 'existing') {
      if (!selectedPropId) { setError('Please select a property.'); return false; }
    }
    // validate unit rows
    const newRowErrors: typeof rowErrors = {};
    for (const r of rows) {
      const e: Partial<Record<keyof UnitRow, string>> = {};
      if (!r.unitNumber.trim()) { e.unitNumber = 'Required'; ok = false; }
      if (!r.unitType)          { e.unitType   = 'Required'; ok = false; }
      if (!r.rentalPrice)       { e.rentalPrice = 'Required'; ok = false; }
      if (Object.keys(e).length) newRowErrors[r.id] = e;
    }
    setRowErrors(newRowErrors);
    return ok;
  }

  /* ── Save All ── */
  const handleSaveAll = useCallback(async () => {
    setError(null);
    if (!validate()) return;

    setSaving(true);
    try {
      let propId: number;
      let propName: string;

      if (mode === 'new') {
        const parts = [pf.street, pf.communityName, pf.emirateName].filter(Boolean);
        const created = await apiPost<WizardProperty>('/properties', {
          buildingName: pf.buildingName,
          spaceCategory: pf.spaceCategory,
          leasingType: pf.leasingType,
          fullAddress: parts.join(', ') || undefined,
          emirateId: pf.emirateId ?? undefined,
          communityId: pf.communityId ?? undefined,
          numberOfFloors: pf.numberOfFloors || undefined,
          numberOfUnits: pf.numberOfUnits ? Number(pf.numberOfUnits) : undefined,
          makaniNumber: pf.makaniNumber || undefined,
          sewerageNumber: pf.sewerageNumber || undefined,
          plotNumber: pf.plotNumber || undefined,
          hasGym: pf.hasGym, hasPool: pf.hasPool, hasParking: pf.hasParking,
          isStandaloneUnit: pf.isStandaloneUnit,
          propertyDescription: pf.propertyDescription || undefined,
        });
        propId   = created.id;
        propName = created.buildingName;
      } else {
        propId   = selectedPropId!;
        propName = existingProperties.find(p => p.id === propId)?.buildingName ?? 'Property';
      }

      for (const r of rows) {
        await apiPost(`/properties/${propId}/units`, {
          unitNumber:     r.unitNumber,
          unitName:       r.unitName    || undefined,
          unitType:       r.unitType,
          unitTier:       r.unitTier    || 'standard',
          floor:          r.floor       || undefined,
          bedrooms:       r.bedrooms && r.bedrooms !== 'Studio' ? Number(r.bedrooms) : undefined,
          bathrooms:      r.bathrooms   ? Number(r.bathrooms)   : undefined,
          unitSizeSqft:   r.unitSizeSqft  ? Number(r.unitSizeSqft)  : undefined,
          rentalPrice:     r.rentalPrice      ? Number(r.rentalPrice)      : undefined,
          serviceCharges:  r.serviceCharges   ? Number(r.serviceCharges)   : undefined,
          securityDeposit: r.securityDeposit  ? Number(r.securityDeposit)  : undefined,
          adminFee:        r.adminFee         ? Number(r.adminFee)         : undefined,
          ejariFeeFils:    r.ejariFeeFils     ? Number(r.ejariFeeFils)     : undefined,
          commission:      r.commission       ? Number(r.commission)       : undefined,
          view:            r.view        || undefined,
          furnishing:     r.furnishing  || undefined,
          amenities:      r.amenities.length ? r.amenities : undefined,
          description:    r.description || undefined,
        });
      }

      onDone();
      setDoneMsg(`${propName} + ${rows.length} unit${rows.length !== 1 ? 's' : ''} saved.`);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pf, rows, selectedPropId, existingProperties, onDone]);

  /* ── CSV file ── */
  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null); setCsvRows([]);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text ?? '');
      if (!rows.length) { setCsvError('No data rows found — check the file format.'); return; }
      setCsvRows(rows);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  /* ── CSV Import run ── */
  const runImport = useCallback(async () => {
    const valid = csvRows.filter(r => !r._error);
    if (!valid.length) return;
    setImporting(true); setImportErrs([]);
    setImportProgress({ done: 0, total: valid.length });

    const propMap = new Map<string, number>();
    const errs: string[] = [];

    for (const row of valid) {
      if (!propMap.has(row.building_name)) {
        try {
          const p = await apiPost<WizardProperty>('/properties', {
            buildingName: row.building_name,
            spaceCategory: row.category || 'residential',
            fullAddress: row.address || undefined,
          });
          propMap.set(row.building_name, p.id);
        } catch (e) {
          errs.push(`Property "${row.building_name}": ${e instanceof Error ? e.message : 'error'}`);
          propMap.set(row.building_name, -1);
        }
      }
      const pid = propMap.get(row.building_name)!;
      if (pid === -1) continue;
      try {
        await apiPost(`/properties/${pid}/units`, {
          unitNumber: row.unit_number,
          unitName:   row.unit_name   || undefined,
          unitType:   row.unit_type   || 'apartment',
          floor:      row.floor       || undefined,
          bedrooms:   row.bedrooms    ? Number(row.bedrooms)    : undefined,
          bathrooms:  row.bathrooms   ? Number(row.bathrooms)   : undefined,
          unitSizeSqft:   row.size_sqft        ? Number(row.size_sqft)        : undefined,
          rentalPrice:    row.annual_rent_aed   ? Number(row.annual_rent_aed)   : undefined,
          serviceCharges: row.service_charges_aed ? Number(row.service_charges_aed) : undefined,
          description: row.description || undefined,
        });
      } catch (e) {
        errs.push(`Unit "${row.unit_number}" in "${row.building_name}": ${e instanceof Error ? e.message : 'error'}`);
      }
      setImportProgress(p => ({ ...p, done: p.done + 1 }));
    }

    setImportErrs(errs);
    setImporting(false);
    onDone();
    setDoneMsg(`Imported ${valid.length - errs.length} of ${valid.length} rows.`);
    setDone(true);
  }, [csvRows, onDone]);

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'upnow_listings_template.csv';
    a.click(); URL.revokeObjectURL(url);
  }

  if (!open) return null;

  const unitTypes = unitTypesFor(mode === 'existing'
    ? (existingProperties.find(p => p.id === selectedPropId)?.spaceCategory ?? '')
    : pf.spaceCategory,
  );

  /* ════════════════════════════════════════════════════════════════════════ */
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-white w-full sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxWidth: 720, maxHeight: '94vh' }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0] shrink-0">
          <div>
            <h2 className="font-semibold text-[#1a1916]">Add Listing</h2>
            <p className="text-xs text-[#9b9890] mt-0.5">Property + units in one go</p>
          </div>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer">
            <X size={20} />
          </button>
        </div>

        {/* ── Mode tabs ── */}
        {!done && (
          <div className="flex border-b border-[#e8e6e0] shrink-0">
            {([
              { key: 'new',      label: 'New Property' },
              { key: 'existing', label: 'Use Existing' },
              { key: 'import',   label: 'Import CSV' },
            ] as { key: Mode; label: string }[]).map(m => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setError(null); }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                  mode === m.key
                    ? 'border-[#2e9f82] text-[#2e9f82]'
                    : 'border-transparent text-[#6b6860] hover:text-[#1a1916]'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">

          {/* ══ DONE ══ */}
          {done && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
                <CheckCircle2 size={32} className="text-[#2e9f82]" />
              </div>
              <h3 className="text-lg font-bold text-[#1a1916] mb-1">All done!</h3>
              <p className="text-sm text-[#6b6860]">{doneMsg}</p>
              {importErrs.length > 0 && (
                <div className="mt-4 text-left w-full max-w-sm">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Rows with errors:</p>
                  {importErrs.map((e, i) => <p key={i} className="text-xs text-red-600">• {e}</p>)}
                </div>
              )}
            </div>
          )}

          {/* ══ NEW PROPERTY + UNITS ══ */}
          {!done && mode === 'new' && (
            <div className="px-6 py-5 space-y-5">

              {/* ─ Property section ─ */}
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-3">Property</p>
                <div className="space-y-3">

                  {/* Category tiles */}
                  <div>
                    <Label t="Category" req />
                    {pe.spaceCategory && <p className={ERR}>{pe.spaceCategory}</p>}
                    <div className="grid grid-cols-3 gap-2">
                      {SPACE_CATEGORIES.map(c => (
                        <button
                          key={c.id} type="button"
                          onClick={() => updP('spaceCategory', c.id)}
                          className={`rounded-xl border p-2.5 text-left cursor-pointer transition-colors ${pf.spaceCategory === c.id ? 'border-[#2e9f82] bg-[#f0fdf8]' : 'border-[#e8e6e0] hover:bg-[#f4f3ef]'}`}
                        >
                          <span className="text-lg">{c.icon}</span>
                          <p className="text-xs font-semibold text-[#1a1916] mt-1">{c.label}</p>
                          <p className="text-[10px] text-[#9b9890]">{c.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Location — Country → Emirate → Community */}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label t="Country" req />
                      <select className={SELECT} value={pf.countryId ?? ''} onChange={e => {
                        const id   = e.target.value ? Number(e.target.value) : null;
                        const name = countries.find(c => c.id === id)?.nameEn ?? '';
                        setPf(prev => ({ ...prev, countryId: id, countryName: name, emirateId: null, emirateName: '', communityId: null, communityName: '' }));
                        setCommunities([]);
                      }}>
                        <option value="">Select</option>
                        {countries.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label t="Emirate / Region" req />
                      <select className={SELECT} value={pf.emirateId ?? ''} disabled={!pf.countryId} onChange={e => {
                        const id   = e.target.value ? Number(e.target.value) : null;
                        const name = emirates.find(em => em.id === id)?.nameEn ?? '';
                        setPf(prev => ({ ...prev, emirateId: id, emirateName: name, communityId: null, communityName: '' }));
                      }}>
                        <option value="">{pf.countryId ? 'Select' : 'Select country first'}</option>
                        {emirates.map(em => <option key={em.id} value={em.id}>{em.nameEn}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label t="Community" />
                      <select className={SELECT} value={pf.communityId ?? ''} disabled={!pf.emirateId || loadingComms}
                        onChange={e => {
                          const id   = e.target.value ? Number(e.target.value) : null;
                          const name = communities.find(c => c.id === id)?.nameEn ?? '';
                          updP('communityId', id); updP('communityName', name);
                        }}>
                        <option value="">{loadingComms ? 'Loading…' : 'Select'}</option>
                        {communities.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label t="Street / Address" />
                      <input className={INPUT} placeholder="e.g. 14 Marina Walk" value={pf.street} onChange={e => updP('street', e.target.value)} />
                    </div>
                    <div>
                      <Label t="Plot Number" />
                      <input className={INPUT} placeholder="e.g. 123-456" value={pf.plotNumber} onChange={e => updP('plotNumber', e.target.value)} />
                    </div>
                  </div>

                  {/* Building name + floors — both optional */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label t="Building / Property Name" />
                      <input
                        className={INPUT}
                        placeholder="e.g. Marina Heights (optional)"
                        value={pf.buildingName}
                        onChange={e => updP('buildingName', e.target.value)}
                      />
                    </div>
                    <div>
                      <Label t="Number of Floors" />
                      <input className={INPUT} placeholder="e.g. 20" value={pf.numberOfFloors} onChange={e => updP('numberOfFloors', e.target.value)} />
                    </div>
                    <div>
                      <Label t="Number of Units" />
                      <input type="number" min={0} inputMode="numeric" className={INPUT} placeholder="e.g. 24" value={pf.numberOfUnits} onChange={e => updP('numberOfUnits', e.target.value.replace(/[^0-9]/g, ''))} />
                    </div>
                  </div>
                </div>
              </section>

              {/* ─ Units section ─ */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890]">Units</p>
                  <span className="text-xs text-[#9b9890]">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
                </div>
                <UnitTable rows={rows} unitTypes={unitTypes} rowErrors={rowErrors} onUpdate={updRow} onAdd={addRow} onDelete={delRow} onDuplicate={dupRow} />
              </section>
            </div>
          )}

          {/* ══ EXISTING PROPERTY + UNITS ══ */}
          {!done && mode === 'existing' && (
            <div className="px-6 py-5 space-y-5">
              <section>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-3">Choose Property</p>
                {existingProperties.length === 0 ? (
                  <p className="text-sm text-[#9b9890] py-4">
                    No properties yet. <button className="text-[#2e9f82] underline cursor-pointer" onClick={() => setMode('new')}>Create one first.</button>
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {existingProperties.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPropId(p.id); setSelectedPropCategory(p.spaceCategory); setError(null); }}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left cursor-pointer transition-colors ${selectedPropId === p.id ? 'border-[#2e9f82] bg-[#f0fdf8]' : 'border-[#e8e6e0] hover:bg-[#f4f3ef]'}`}
                      >
                        <span className="text-xl shrink-0">{SPACE_CATEGORIES.find(c => c.id === p.spaceCategory)?.icon ?? '🏢'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1a1916] truncate">{p.buildingName}</p>
                          {p.fullAddress && <p className="text-xs text-[#9b9890] truncate">{p.fullAddress}</p>}
                        </div>
                        {selectedPropId === p.id && <CheckCircle2 size={15} className="text-[#2e9f82] shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {selectedPropId && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890]">Units to Add</p>
                    <span className="text-xs text-[#9b9890]">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
                  </div>
                  <UnitTable rows={rows} unitTypes={unitTypesFor(selectedPropCategory)} rowErrors={rowErrors} onUpdate={updRow} onAdd={addRow} onDelete={delRow} onDuplicate={dupRow} />
                </section>
              )}
            </div>
          )}

          {/* ══ IMPORT CSV ══ */}
          {!done && mode === 'import' && (
            <div className="px-6 py-5 space-y-5">

              {/* Explanation */}
              <div className="bg-[#f0fdf8] border border-[#a7f3d0] rounded-xl p-4">
                <p className="text-sm font-semibold text-[#1a7a5a] mb-1">Single file, all data combined</p>
                <p className="text-xs text-[#3d3b35] leading-relaxed">
                  Each CSV row contains both property and unit information. Rows sharing the same
                  <strong> building_name</strong> are grouped into one property automatically —
                  no need to enter the property twice.
                </p>
              </div>

              {/* Template download */}
              <div className="flex items-center gap-3 bg-[#f4f3ef] rounded-xl p-4">
                <FileSpreadsheet size={20} className="text-[#2e9f82] shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1a1916]">Download the CSV template</p>
                  <p className="text-xs text-[#9b9890]">Fill in your data then upload below.</p>
                </div>
                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] border border-[#2e9f82] rounded-lg px-3 py-2 hover:bg-[#f0fdf8] cursor-pointer shrink-0"
                >
                  <Download size={13} /> Template
                </button>
              </div>

              {/* Template column reference */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-[#9b9890] mb-2">CSV Columns</p>
                <div className="overflow-x-auto rounded-xl border border-[#e8e6e0]">
                  <table className="w-full text-xs min-w-[560px]">
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
                        ['category',             '✓', 'residential | commercial | industrial'],
                        ['emirate',              '',  'e.g. Dubai'],
                        ['address',              '',  'Full street address'],
                        ['unit_number',          '✓', 'Unique per building'],
                        ['unit_name',            '',  'Optional friendly name'],
                        ['unit_type',            '',  'apartment, villa, office_fitted …'],
                        ['floor',                '',  'Floor number'],
                        ['bedrooms',             '',  'Number or "Studio"'],
                        ['bathrooms',            '',  'Number'],
                        ['size_sqft',            '',  'e.g. 1200'],
                        ['annual_rent_aed',      '',  'e.g. 120000'],
                        ['service_charges_aed',  '',  'Per year'],
                        ['description',          '',  'Free text'],
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

              {/* Upload */}
              <div>
                <Label t="Upload your CSV" req />
                <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-xl p-6 cursor-pointer hover:border-[#2e9f82] transition-colors">
                  <Upload size={22} className="text-[#9b9890] mb-2" />
                  <span className="text-sm text-[#6b6860]">Click to choose a .csv file</span>
                  <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="sr-only" />
                </label>
                {csvError && <p className={ERR + ' mt-1'}>{csvError}</p>}
              </div>

              {/* Preview */}
              {csvRows.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-[#3d3b35]">
                      {csvRows.length} row{csvRows.length !== 1 ? 's' : ''} parsed —&nbsp;
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
                          {['Building', 'Category', 'Unit #', 'Type', 'Beds', 'sqft', 'Rent AED', ''].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-[#6b6860]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0ede8]">
                        {csvRows.slice(0, 12).map((row, i) => (
                          <tr key={i} className={row._error ? 'bg-red-50 opacity-60' : 'hover:bg-[#fafaf8]'}>
                            <td className="px-3 py-1.5 font-medium text-[#1a1916]">{row.building_name || '—'}</td>
                            <td className="px-3 py-1.5 text-[#6b6860] capitalize">{row.category || '—'}</td>
                            <td className="px-3 py-1.5">{row.unit_number || '—'}</td>
                            <td className="px-3 py-1.5 text-[#6b6860]">{row.unit_type || '—'}</td>
                            <td className="px-3 py-1.5">{row.bedrooms || '—'}</td>
                            <td className="px-3 py-1.5">{row.size_sqft || '—'}</td>
                            <td className="px-3 py-1.5 text-[#2e9f82] font-medium">
                              {row.annual_rent_aed ? `${Number(row.annual_rent_aed).toLocaleString('en-AE')}` : '—'}
                            </td>
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
                <div className="flex items-center gap-2 text-sm text-[#6b6860]">
                  <Loader2 size={14} className="animate-spin text-[#2e9f82]" />
                  Importing {importProgress.done} / {importProgress.total}…
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mx-6 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">{error}</div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#e8e6e0] shrink-0 bg-[#fafaf8]">
          {done ? (
            <>
              <button
                onClick={() => { setDone(false); setRows([emptyRow()]); setMode('new'); setPf({ ...EMPTY_PROP }); }}
                className="text-sm text-[#2e9f82] font-medium border border-[#2e9f82] px-4 py-2 rounded-lg hover:bg-[#f0fdf8] cursor-pointer"
              >
                Add Another Listing
              </button>
              <button
                onClick={onClose}
                className="text-sm font-semibold text-white px-5 py-2 rounded-lg cursor-pointer"
                style={{ background: '#1a1916' }}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="text-sm text-[#6b6860] hover:text-[#1a1916] px-4 py-2 cursor-pointer">Cancel</button>

              {mode !== 'import' && (
                <button
                  onClick={handleSaveAll}
                  disabled={saving || (mode === 'existing' && !selectedPropId)}
                  className="flex items-center gap-2 text-sm font-semibold text-white px-5 py-2 rounded-lg disabled:opacity-50 cursor-pointer"
                  style={{ background: '#2e9f82' }}
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Save Property + {rows.length} Unit{rows.length !== 1 ? 's' : ''}
                </button>
              )}

              {mode === 'import' && (
                <button
                  onClick={runImport}
                  disabled={importing || csvRows.filter(r => !r._error).length === 0}
                  className="flex items-center gap-2 text-sm font-semibold text-white px-5 py-2 rounded-lg disabled:opacity-50 cursor-pointer"
                  style={{ background: '#2e9f82' }}
                >
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Import {csvRows.filter(r => !r._error).length} Rows
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── UnitTable sub-component ─────────────────────────────────────────────── */
const CELL = 'w-full border border-[#e8e6e0] rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const CELL_ERR = 'w-full border rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:border-[#2e9f82] border-red-400';

function UnitTable({
  rows, unitTypes, rowErrors, onUpdate, onAdd, onDelete, onDuplicate,
}: {
  rows: UnitRow[];
  unitTypes: string[];
  rowErrors: Record<string, Partial<Record<keyof UnitRow, string>>>;
  onUpdate: (id: string, k: keyof UnitRow, v: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const lastRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    onAdd();
    setTimeout(() => lastRef.current?.focus(), 50);
  }

  return (
    <div className="rounded-xl border border-[#e8e6e0] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 1100 }}>
          <thead>
            <tr className="bg-[#f4f3ef]">
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-20">Unit # <span className="text-red-500">*</span></th>
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-32">Type <span className="text-red-500">*</span></th>
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-14">Floor</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-16">Beds</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-20">sqft</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-[#6b6860] w-28">Rent/yr AED <span className="text-red-500">*</span></th>
              <th colSpan={4} className="px-2 py-2 text-center text-xs font-semibold text-[#2e9f82] border-l border-[#e8e6e0]">
                Financials (AED)
              </th>
              <th className="w-14" />
            </tr>
            <tr className="bg-[#f9f8f6] border-t border-[#f0ede8]">
              <th colSpan={6} />
              <th className="px-2 py-1 text-left text-[10px] font-medium text-[#9b9890] border-l border-[#e8e6e0]">Security Dep.</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-[#9b9890]">Admin Fee</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-[#9b9890]">Contract Registration Fee</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-[#9b9890]">Commission</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ede8]">
            {rows.map((r, i) => {
              const e = rowErrors[r.id] ?? {};
              const isLast = i === rows.length - 1;
              return (
                <tr key={r.id} className="bg-white hover:bg-[#fafaf8]">
                  <td className="px-2 py-2">
                    <input
                      ref={isLast ? lastRef : undefined}
                      className={e.unitNumber ? CELL_ERR : CELL}
                      placeholder="101"
                      value={r.unitNumber}
                      onChange={ev => onUpdate(r.id, 'unitNumber', ev.target.value)}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      className={`appearance-none ${e.unitType ? CELL_ERR : CELL}`}
                      value={r.unitType}
                      onChange={ev => onUpdate(r.id, 'unitType', ev.target.value)}
                    >
                      <option value="">Select</option>
                      {unitTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input className={CELL} placeholder="1" value={r.floor} onChange={ev => onUpdate(r.id, 'floor', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <select className={`appearance-none ${CELL}`} value={r.bedrooms} onChange={ev => onUpdate(r.id, 'bedrooms', ev.target.value)}>
                      {['Studio', '1', '2', '3', '4', '5', '6'].map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input className={CELL} type="number" placeholder="1200" value={r.unitSizeSqft} onChange={ev => onUpdate(r.id, 'unitSizeSqft', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={e.rentalPrice ? CELL_ERR : CELL} type="number" placeholder="120000" value={r.rentalPrice} onChange={ev => onUpdate(r.id, 'rentalPrice', ev.target.value)} />
                  </td>
                  {/* Financial columns */}
                  <td className="px-2 py-2 border-l border-[#f0ede8]">
                    <input className={CELL} type="number" placeholder="5000" value={r.securityDeposit} onChange={ev => onUpdate(r.id, 'securityDeposit', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={CELL} type="number" placeholder="2000" value={r.adminFee} onChange={ev => onUpdate(r.id, 'adminFee', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={CELL} type="number" placeholder="220" value={r.ejariFeeFils} onChange={ev => onUpdate(r.id, 'ejariFeeFils', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <input className={CELL} type="number" placeholder="0" value={r.commission} onChange={ev => onUpdate(r.id, 'commission', ev.target.value)} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      <button title="Duplicate row" onClick={() => onDuplicate(r.id)} className="text-[#c8c6c0] hover:text-[#2e9f82] cursor-pointer" type="button">
                        <Plus size={13} />
                      </button>
                      <button title="Delete row" onClick={() => onDelete(r.id)} disabled={rows.length === 1} className="text-[#c8c6c0] hover:text-red-500 disabled:opacity-30 cursor-pointer" type="button">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2.5 bg-[#fafaf8] border-t border-[#f0ede8]">
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 text-xs font-medium text-[#2e9f82] hover:text-[#1f6655] cursor-pointer"
        >
          <Plus size={13} /> Add row
        </button>
      </div>
    </div>
  );
}
