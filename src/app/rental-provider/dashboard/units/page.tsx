/**
 * Rental Provider — Units by layout / Pricing.
 *
 * Three jobs (see product spec):
 *   1. Set pricing per plan  — edit the asking rent once for a whole layout;
 *      it writes through to every unit on that plan.
 *   2. Surface pricing gaps  — per-plan flags (unpriced, inconsistent within a
 *      plan, doesn't scale with size, below market, AED/sqft outlier) + a
 *      health summary, so the RP can see where pricing can improve.
 *   3. Manage the floor-plan drawing — replace the image (applies to all units
 *      on the plan) and view it full-screen.
 *
 * Data:   GET   /properties/floor-plans?propertyId=&bedrooms=
 * Price:  PATCH /properties/floor-plans/price   { propertyId, planLabel, rentalPrice }
 * Image:  POST  /properties/floor-plans/image   (multipart: file, propertyId, planLabel)
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BedDouble, Bath, Maximize2, ChevronDown, Loader2, Layers, Image as ImageIcon,
  ArrowRight, Pencil, Check, X, Upload, Maximize, Download, AlertTriangle, Info,
  LayoutGrid, Rows3, Search, Plus, Eye, Trash2,
} from 'lucide-react';
import { apiGet, apiPatch, apiDelete } from '@/lib/api';
import { validateAddendumFile, ADDENDUM_ACCEPT, ADDENDUM_SAMPLE_URL } from '@/lib/validateAddendum';
import { UnitFormModal } from '@/components/upnow/UnitFormModal';
import { UnitPreviewModal } from '@/components/upnow/UnitPreviewModal';
import { saveUnit, unitToFormInitial, type UnitRecord } from '@/lib/unitForm';

interface Plan {
  displayName: string;
  planLabel: string;
  propertyId: number;
  buildingName: string;
  spaceCategory: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqftMin: number; sqftMax: number; sqmMin: number; sqmMax: number; avgSqft: number | null;
  priceFrom: number | null;            // asking-rent "from"
  rentFrom: number | null; rentTo: number | null;
  marketFrom: number | null; marketTo: number | null;
  marketGap: number | null;            // marketFrom − rentFrom (>0 = below market)
  aedPerSqft: number | null;
  // representative financial details for the layout (editable plan-wide)
  securityDeposit: number | null; adminFee: number | null; ejariFee: number | null;
  commission: number | null; serviceCharges: number | null;
  // current plan-wide lease terms (from the units' facilities JSON)
  leaseTerms: LeaseTerms | null;
  // latest Agreement addendum version for the layout (file-based)
  termsVersion: {
    id: number; versionNo: number; effectiveAt: string; versionsCount: number;
    addendumUrl: string | null; addendumFileName: string | null;
  } | null;
  unpricedCount: number;
  unitCount: number;
  sampleUnitId: number;
  floorPlanUrl: string | null;
  flags: string[];
}
interface LeaseTerms {
  minLeaseMonths?: number; noticePeriodDays?: number; rentEscalationPct?: number;
  rentalType?: string; numberOfPayments?: number; advancePayment?: number;
  gracePeriodDays?: number; latePaymentFee?: number;
}
interface TermsVersion {
  id: number; versionNo: number; effectiveAt: string; contractsCount: number;
  addendumUrl: string | null; addendumFileName: string | null;
}
interface PropOpt { id: number; buildingName: string }
interface FeeRuleLite { feeType: string; valueType: string; value: number; isActive: boolean }
interface Resp {
  properties: PropOpt[];
  selectedPropertyId: number | null;
  bedroomOptions: number[];
  plans: Plan[];
  // RP's configured fee rules per category — used to default the per-layout fees
  feeRules: Record<string, FeeRuleLite[]> | null;
}
// Tenant + lease-end surfaced on each unit row (RP only).
interface ContractSummary {
  id: number;
  status: string;
  contractActive: boolean;
  startDate: string | null;
  endDate: string | null;
  tenant: { id: number | null; name: string | null } | null;
  unit: { id: number | null } | null;
}

// Plans are unique per (property, plan_label) — labels can repeat across
// buildings in "all properties" mode, so edit/upload state keys on both.
const planKey = (p: { propertyId: number; planLabel: string }) => `${p.propertyId}::${p.planLabel}`;
const aed = (n: number) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
const bedLabel = (b: number | null) => (b == null ? 'Unit' : b === 0 ? 'Studio' : `${b} Bed`);
const typeLabel = (t: string | null) => (t == null ? 'Other' : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

// Fee key (units column) → fee-rule fee_type, and the rule-based default off rent.
const FEE_RULE_TYPE: Record<string, string> = {
  securityDeposit: 'security_deposit', adminFee: 'admin_fee', ejariFee: 'ejari_fee', commission: 'commission',
};
const feeFromRules = (rules: FeeRuleLite[] | undefined, key: string, rent: number): number | null => {
  const r = rules?.find(x => x.feeType === FEE_RULE_TYPE[key]);
  if (!r || !r.isActive) return null;
  return r.valueType === 'fixed_aed' ? Math.round(r.value) : Math.round((rent * r.value) / 100);
};
const sizeLabel = (a: number, b: number) =>
  a === b ? a.toLocaleString() : `${a.toLocaleString()} – ${b.toLocaleString()}`;

// Flag → chip styling + human explanation.
const FLAG_META: Record<string, { label: string; cls: string; tip: (p: Plan) => string }> = {
  unpriced:     { label: 'No price',         cls: 'bg-[#fee2e2] text-[#b91c1c]', tip: p => `${p.unpricedCount} unit${p.unpricedCount === 1 ? '' : 's'} on this layout have no price set.` },
  inconsistent: { label: 'Inconsistent',     cls: 'bg-[#fef3c7] text-[#92400e]', tip: p => `Same layout, different prices (AED ${aed(p.rentFrom ?? 0)}–${aed(p.rentTo ?? 0)}). Align them.` },
  doesntScale:  { label: "Doesn't scale",    cls: 'bg-[#fef3c7] text-[#92400e]', tip: () => 'Priced at or below a smaller layout in the same tier — bigger should cost more.' },
};
const FLAG_ORDER = ['unpriced', 'inconsistent', 'doesntScale'];

// Sort options — value is `<field>_<dir>`; `default` keeps the backend order.
const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'default',     label: 'Sort: default' },
  { value: 'sqft_desc',   label: 'Size: largest' },
  { value: 'sqft_asc',    label: 'Size: smallest' },
  { value: 'market_desc', label: 'Market price: high' },
  { value: 'market_asc',  label: 'Market price: low' },
  { value: 'rent_desc',   label: 'Asking rent: high' },
  { value: 'rent_asc',    label: 'Asking rent: low' },
];

const isPdf = (u: string) => /\.pdf(\?|$)/i.test(u);
function PlanThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return (
    <div className="w-full h-full flex flex-col items-center justify-center text-[#c5c3bc] bg-[#fafaf8]">
      <ImageIcon size={30} /><span className="text-xs mt-1">No floor plan</span>
    </div>
  );
  if (isPdf(url)) return (
    <iframe src={`${url}#toolbar=0&navpanes=0&view=FitH`} title={alt} className="w-full h-full pointer-events-none bg-white" style={{ border: 0 }} />
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="w-full h-full object-contain bg-white" />;
}

/**
 * Units / floor-plan pricing workspace. Used by the RP portal (default export
 * below) and the Manager portal (rendered with `manager={{ rp }}`), which swaps
 * the API to the landlord-scoped /manager/units endpoints.
 */
export function UnitsWorkspace({ manager }: { manager?: { rp: number } }) {
  const rpQ = manager ? `rp=${manager.rp}` : '';
  const [data, setData] = useState<Resp | null>(null);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  // Plan/layout selector — 'all' or a planKey (propertyId::planLabel). Lets the
  // RP target one specific layout so it's clear which plan they're editing.
  const [planFilter, setPlanFilter] = useState('all');
  const [sort, setSort] = useState('default');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'row'>('row');
  // Primary axis: 'type' = layout cards grouped by unit type (default), 'unit' =
  // a flat list of every individual unit (still grouped under its unit type).
  const [mode, setMode] = useState<'type' | 'unit'>('type');
  const [loading, setLoading] = useState(true);

  // shared error surface (image upload, etc.)
  const [err, setErr] = useState<string | null>(null);

  // image upload
  const [uploadingPlan, setUploadingPlan] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetPlan = useRef<{ planLabel: string; propertyId: number } | null>(null);

  // full-screen viewer
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);

  // plan-wide financial-details editor
  const [finModal, setFinModal] = useState<Plan | null>(null);

  const load = useCallback((pid?: number | null, b: string = 'all') => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (pid) qs.set('propertyId', String(pid));
    if (b !== 'all') qs.set('bedrooms', b);
    apiGet<Resp>(manager
      ? `/manager/units?${[rpQ, qs.toString()].filter(Boolean).join('&')}`
      : `/properties/floor-plans${qs.toString() ? `?${qs}` : ''}`)
      .then(d => { setData(d); setPropertyId(d.selectedPropertyId); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpQ]);
  // Preselect a property when arriving via the portfolio "Manage units" link
  // (?propertyId=). Read from the URL directly to avoid a Suspense boundary.
  useEffect(() => {
    const pid = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('propertyId') : null;
    load(pid ? Number(pid) : undefined);
  }, [load]);

  const reload = () => load(propertyId);
  const onProperty = (v: string) => { setTypeFilter('all'); setPlanFilter('all'); load(v === 'all' ? null : Number(v), 'all'); };
  // Changing the unit-type scope can hide the selected plan, so reset it.
  const onType = (v: string) => { setTypeFilter(v); setPlanFilter('all'); };

  // ── Per-unit management lives in the "By unit" view. Units load lazily per
  // property and are cached; any change re-fetches them AND reloads the plan
  // aggregates so price ranges / flags stay in sync.
  const [unitsByProperty, setUnitsByProperty] = useState<Record<number, UnitRecord[]>>({});
  const [loadingUnits, setLoadingUnits] = useState<Set<number>>(new Set());
  const [contracts, setContracts] = useState<ContractSummary[]>([]);
  const [unitModal, setUnitModal] = useState<{ plan: Plan; editingUnit?: UnitRecord } | null>(null);
  const [unitPreview, setUnitPreview] = useState<{ plan: Plan; unit: UnitRecord } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busyUnit, setBusyUnit] = useState<number | null>(null);

  // Contracts power the tenant / lease-end line on each unit row.
  useEffect(() => {
    if (manager) return;
    apiGet<ContractSummary[]>('/contracts').then(setContracts).catch(() => {});
  }, [manager]);

  const loadUnitsForProperty = useCallback(async (pid: number) => {
    setLoadingUnits(s => new Set(s).add(pid));
    try {
      const rows = await apiGet<UnitRecord[]>(manager ? `/manager/properties/${pid}/units` : `/properties/${pid}/units`);
      setUnitsByProperty(m => ({ ...m, [pid]: rows }));
    } catch {
      setUnitsByProperty(m => ({ ...m, [pid]: m[pid] ?? [] }));
    } finally {
      setLoadingUnits(s => { const n = new Set(s); n.delete(pid); return n; });
    }
  // `manager` is constant for a mounted page (the landlord being managed).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In the per-unit view, eagerly load units for every in-scope property — the
  // by-type view loads them lazily on expand, but the flat list needs them all.
  useEffect(() => {
    if (mode !== 'unit' || !data) return;
    const scope = propertyId != null ? [propertyId] : data.properties.map(p => p.id);
    scope.forEach(pid => {
      if (unitsByProperty[pid] == null && !loadingUnits.has(pid)) void loadUnitsForProperty(pid);
    });
  }, [mode, data, propertyId, unitsByProperty, loadingUnits, loadUnitsForProperty]);

  // After any unit change, refresh that property's units AND the plan aggregates.
  const refreshProperty = async (pid: number) => { await loadUnitsForProperty(pid); reload(); };

  const onSaveUnit = async (
    plan: Plan, editingUnit: UnitRecord | undefined,
    data: Parameters<typeof saveUnit>[0]['data'],
    floorPlan?: File | null, titleDeed?: File | null, addendums?: File[],
  ) => {
    await saveUnit({
      propertyId: plan.propertyId, editingUnitId: editingUnit?.id, data,
      floorPlan, titleDeed, addendums, propertyStandalone: false,
      manager: manager ? { rp: manager.rp } : undefined,
    });
    await refreshProperty(plan.propertyId);
  };

  const onDeleteUnit = async (pid: number, unitId: number) => {
    setBusyUnit(unitId);
    try {
      await apiDelete(manager ? `/manager/properties/${pid}/units/${unitId}?${rpQ}` : `/properties/${pid}/units/${unitId}`);
      await refreshProperty(pid);
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not delete unit'); }
    finally { setBusyUnit(null); setConfirmDelete(null); }
  };

  const onListingAction = async (pid: number, unitId: number, action: 'submit-listing' | 'withdraw-listing') => {
    setBusyUnit(unitId);
    try {
      await apiPatch(manager ? `/manager/properties/${pid}/units/${unitId}/${action}?${rpQ}` : `/properties/${pid}/units/${unitId}/${action}`, {});
      await refreshProperty(pid);
    }
    catch (e) { setErr(e instanceof Error ? e.message : 'Listing action failed'); }
    finally { setBusyUnit(null); }
  };

  const statusPill = (u: UnitRecord): { label: string; bg: string; fg: string } => {
    if (u.availability === 'occupied')    return { label: 'Occupied',   bg: '#e0e7ff', fg: '#3730a3' };
    if (u.availability === 'maintenance') return { label: 'Maintenance', bg: '#fef3c7', fg: '#92400e' };
    switch (u.listingStatus) {
      case 'published': return { label: 'Published', bg: '#d8f2e8', fg: '#1a7a5a' };
      case 'pending':   return { label: 'Pending',   bg: '#fef3c7', fg: '#92400e' };
      case 'in_review': return { label: 'In review', bg: '#dbeafe', fg: '#1e40af' };
      case 'expired':   return { label: 'Expired',   bg: '#fef3c7', fg: '#92400e' };
      case 'rejected':  return { label: 'Rejected',  bg: '#fee2e2', fg: '#b91c1c' };
      default:          return { label: 'Draft',     bg: '#f1efe9', fg: '#6b6860' };
    }
  };

  const pickImage = (p: Plan) => { targetPlan.current = { planLabel: p.planLabel, propertyId: p.propertyId }; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const plan = targetPlan.current;
    e.target.value = '';
    if (!file || !plan) return;
    setUploadingPlan(planKey(plan)); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('propertyId', String(plan.propertyId));
      fd.append('planLabel', plan.planLabel);
      const r = await fetch(manager ? `/api/manager/units/image?${rpQ}` : '/api/properties/floor-plans/image', { method: 'POST', credentials: 'include', body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { message?: string }).message ?? 'Upload failed'); }
      reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setUploadingPlan(null);
    }
  };

  const building = data?.properties.find(p => p.id === propertyId)?.buildingName?.trim();
  const allPlans = data?.plans ?? [];
  const q = query.trim().toLowerCase();

  // Unit-type filter options — from the property/bedroom-scoped set, before the
  // type/search filters, so every available type stays selectable.
  const typeOptions = Object.entries(allPlans.reduce<Record<string, number>>((m, p) => {
    const k = p.unitType ?? 'other'; m[k] = (m[k] ?? 0) + p.unitCount; return m;
  }, {})).sort((a, b) => b[1] - a[1]).map(([t]) => t);

  // Plan selector options — scoped to the current unit-type filter. The label
  // spells out the exact layout (Plan · beds · size, + building in "all" mode)
  // so the RP knows precisely which plan they're about to edit.
  const planMatchesType = (p: Plan) => typeFilter === 'all' || (p.unitType ?? 'other') === typeFilter;
  const typePlans = allPlans.filter(planMatchesType);
  const planOptions = [
    { value: 'all', label: 'All plans' },
    ...typePlans.map(p => ({
      value: planKey(p),
      label: `${propertyId == null ? `${p.buildingName.trim()} — ` : ''}${p.displayName} · ${bedLabel(p.bedrooms)} · ${sizeLabel(p.sqftMin, p.sqftMax)} sqft`,
    })),
  ];

  const filtered = allPlans.filter(p => {
    if (!planMatchesType(p)) return false;
    if (planFilter !== 'all' && planKey(p) !== planFilter) return false;
    if (q && ![p.displayName, p.planLabel, bedLabel(p.bedrooms), p.buildingName]
      .some(s => s != null && s.toLowerCase().includes(q))) return false;
    return true;
  });

  // Sort the visible layouts; `default` keeps the backend order.
  const sortField = sort === 'default' ? null : sort.slice(0, sort.lastIndexOf('_'));
  const sortDir = sort.endsWith('_asc') ? 1 : -1;
  const sortVal = (p: Plan): number | null => {
    switch (sortField) {
      case 'sqft':   return p.avgSqft ?? p.sqftMax ?? null;
      case 'market': return p.marketFrom;
      case 'rent':   return p.rentFrom;
      default:       return null;
    }
  };
  const plans = sortField
    ? [...filtered].sort((a, b) => {
        const av = sortVal(a), bv = sortVal(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;   // nulls always sort last
        if (bv == null) return -1;
        return (av - bv) * sortDir;
      })
    : filtered;

  // pricing-health summary
  const flagged = plans.filter(p => p.flags.length > 0).length;
  const counts = FLAG_ORDER.map(f => ({ f, n: plans.filter(p => p.flags.includes(f)).length })).filter(c => c.n > 0);

  // total units, broken down by unit type (a layout maps to one type)
  const totalUnits = plans.reduce((s, p) => s + p.unitCount, 0);
  const typeCounts = Object.entries(plans.reduce<Record<string, number>>((m, p) => {
    const k = p.unitType ?? 'other';
    m[k] = (m[k] ?? 0) + p.unitCount;
    return m;
  }, {})).map(([unitType, count]) => ({ unitType, count })).sort((a, b) => b.count - a.count);

  // Layouts grouped under their unit type, in the same (count-desc) order as
  // the overview strip; each group's plans keep the active sort order.
  const groups = typeCounts.map(t => ({
    unitType: t.unitType,
    count: t.count,
    plans: plans.filter(p => (p.unitType ?? 'other') === t.unitType),
  }));

  // ── Per-unit (flat) view — same scope/filters, grouped by unit type ──────
  // Each unit resolves back to its layout Plan so the row's view/edit/delete/
  // listing actions reuse the by-type machinery (falls back to a minimal plan
  // if a unit somehow has no matching layout aggregate).
  const buildingNameOf = (pid: number) =>
    data?.properties.find(p => p.id === pid)?.buildingName?.trim() ?? '';
  const planForUnit = (u: UnitRecord): Plan =>
    allPlans.find(pl => pl.propertyId === u.propertyId && (pl.planLabel ?? '') === (u.planLabel ?? ''))
    ?? ({
      displayName: u.planLabel || 'Unit', planLabel: u.planLabel ?? '', propertyId: u.propertyId,
      buildingName: buildingNameOf(u.propertyId), spaceCategory: null, unitType: u.unitType ?? null,
      bedrooms: u.bedrooms ?? null, bathrooms: u.bathrooms ?? null,
      sqftMin: 0, sqftMax: 0, sqmMin: 0, sqmMax: 0, avgSqft: null,
      priceFrom: null, rentFrom: null, rentTo: null, marketFrom: null, marketTo: null, marketGap: null, aedPerSqft: null,
      securityDeposit: null, adminFee: null, ejariFee: null, commission: null, serviceCharges: null,
      leaseTerms: null, termsVersion: null, unpricedCount: 0, unitCount: 1, sampleUnitId: u.id,
      floorPlanUrl: u.floorPlanUrl ?? null, flags: [],
    } as Plan);

  const inScopePropIds = propertyId != null ? [propertyId] : (data?.properties.map(p => p.id) ?? []);
  const perUnitLoading = mode === 'unit'
    && inScopePropIds.some(pid => unitsByProperty[pid] == null || loadingUnits.has(pid));

  // Map the plan-level Sort onto unit fields so the control stays meaningful.
  const unitSortVal = (u: UnitRecord): number | null => {
    switch (sortField) {
      case 'sqft':   return u.unitSizeSqft ?? null;
      case 'market': return u.marketPrice ?? null;
      case 'rent':   return u.rentalPrice ?? null;
      default:       return null;
    }
  };
  const byUnitNumber = (a: UnitRecord, b: UnitRecord) =>
    (a.unitNumber ?? '').localeCompare(b.unitNumber ?? '', undefined, { numeric: true });

  // All in-scope units, filtered by the active type/plan/search filters.
  const scopedUnitRows = inScopePropIds
    .flatMap(pid => unitsByProperty[pid] ?? [])
    .map(u => ({ u, pl: planForUnit(u) }))
    .filter(({ u, pl }) => {
      if (typeFilter !== 'all' && (pl.unitType ?? 'other') !== typeFilter) return false;
      if (planFilter !== 'all' && planKey({ propertyId: u.propertyId, planLabel: u.planLabel ?? '' }) !== planFilter) return false;
      if (q && ![u.unitNumber, u.unitName, u.unitType, pl.buildingName]
        .some(s => s != null && String(s).toLowerCase().includes(q))) return false;
      return true;
    });

  // Group units under their unit type (largest group first); each group is
  // ordered by the active Sort, falling back to unit number.
  const unitGroups = Object.entries(
    scopedUnitRows.reduce<Record<string, { u: UnitRecord; pl: Plan }[]>>((m, r) => {
      const t = r.pl.unitType ?? 'other'; (m[t] ??= []).push(r); return m;
    }, {}),
  ).map(([unitType, items]) => ({
    unitType,
    items: sortField
      ? [...items].sort((a, b) => {
          const av = unitSortVal(a.u), bv = unitSortVal(b.u);
          if (av == null && bv == null) return byUnitNumber(a.u, b.u);
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av - bv) * sortDir;
        })
      : [...items].sort((a, b) => byUnitNumber(a.u, b.u)),
  })).sort((a, b) => b.items.length - a.items.length);

  // ── shared bits, reused by both the grid card and the row ──────────────
  const flagChips = (p: Plan) => p.flags.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {FLAG_ORDER.filter(f => p.flags.includes(f)).map(f => (
        <span key={f} title={FLAG_META[f].tip(p)} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full cursor-help ${FLAG_META[f].cls}`}>
          {FLAG_META[f].label}
        </span>
      ))}
    </div>
  );

  const imageActions = (p: Plan, isUploading: boolean) => (
    <div className="flex gap-1.5">
      {p.floorPlanUrl && (
        <button onClick={() => setViewer({ url: p.floorPlanUrl!, name: `${p.buildingName} ${p.displayName}` })}
          title="View full floor plan"
          className="w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center text-[#44423c] hover:bg-white">
          <Maximize size={14} />
        </button>
      )}
      <button onClick={() => pickImage(p)} disabled={isUploading}
        title="Replace floor plan (applies to all units on this plan)"
        className="w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center text-[#44423c] hover:bg-white disabled:opacity-60">
        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
      </button>
    </div>
  );

  // Price display + a single "Edit" that opens the combined pricing & financial
  // details editor (one place — no separate pricing flow).
  const priceBlock = (p: Plan) => (
    <div className="flex items-center justify-between gap-2">
      <div>
        {p.rentFrom != null ? (
          <>
            <span className="font-bold text-lg" style={{ color: 'var(--primary, #2e9f82)' }}>AED {aed(p.rentFrom)}</span>
            {p.rentTo != null && p.rentTo !== p.rentFrom && (
              <span className="text-xs" style={{ color: 'var(--neutral-400,#9b9890)' }}> – {aed(p.rentTo)}</span>
            )}
            <span className="text-xs ml-1" style={{ color: 'var(--neutral-500, #6b6860)' }}>/yr</span>
          </>
        ) : (
          <span className="text-sm font-medium" style={{ color: '#b91c1c' }}>No price set</span>
        )}
      </div>
      <button onClick={() => setFinModal(p)}
        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg whitespace-nowrap"
        style={{ backgroundColor: '#e6f7f1', color: 'var(--primary, #2e9f82)' }}>
        <Pencil size={12} /> {p.rentFrom != null ? 'Edit' : 'Set price'}
      </button>
    </div>
  );

  // ── one layout card, in each view ────────────────────────────────────
  const gridCard = (p: Plan) => {
    const isUploading = uploadingPlan === planKey(p);
    return (
      <div key={planKey(p)} className="flex flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--white, #fff)', borderRadius: 20, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
        {/* Floor-plan drawing */}
        <div className="relative overflow-hidden group" style={{ height: 200 }}>
          <PlanThumb url={p.floorPlanUrl} alt={p.displayName} />
          <span className="absolute top-3 left-3 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.92)', color: 'var(--neutral-700, #44423c)' }}>
            {p.displayName}
          </span>
          <span className="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ backgroundColor: '#d8f2e8', color: '#1a7a5a' }}>
            {p.unitCount} {p.unitCount === 1 ? 'unit' : 'units'}
          </span>
          <div className="absolute bottom-2 right-2">{imageActions(p, isUploading)}</div>
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1 p-5">
          <p className="text-xs font-medium mb-0.5 truncate" style={{ color: 'var(--neutral-500, #6b6860)' }}>
            {p.buildingName}
          </p>
          <h3 className="font-semibold text-base truncate" style={{ color: 'var(--neutral-900, #1a1916)' }}>
            {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` · ${p.bathrooms} Bath` : ''}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--neutral-500, #6b6860)' }}>{p.planLabel}</p>

          <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: 'var(--neutral-600, #57544d)' }}>
            {p.bedrooms != null && (<span className="flex items-center gap-1"><BedDouble size={13} />{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} BR`}</span>)}
            {p.bathrooms != null && (<span className="flex items-center gap-1"><Bath size={13} />{p.bathrooms} Bath</span>)}
            <span className="flex items-center gap-1"><Maximize2 size={13} />{sizeLabel(p.sqftMin, p.sqftMax)} sqft</span>
          </div>

          {p.flags.length > 0 && <div className="mt-3">{flagChips(p)}</div>}

          <div className="mt-auto pt-4">
            {priceBlock(p)}
            <div className="mt-3 flex items-center justify-between gap-2">
              <Link href={`/listings/units/${p.sampleUnitId}`} target="_blank"
                className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--neutral-500,#6b6860)' }}>
                View a unit <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const rowCard = (p: Plan) => {
    const isUploading = uploadingPlan === planKey(p);
    return (
      <div key={planKey(p)} className="flex items-stretch gap-4 p-3 sm:p-4"
        style={{ backgroundColor: 'var(--white, #fff)', borderRadius: 16, boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
        {/* Floor-plan thumbnail */}
        <div className="relative shrink-0 overflow-hidden rounded-xl" style={{ width: 132, height: 92 }}>
          <PlanThumb url={p.floorPlanUrl} alt={p.displayName} />
          <div className="absolute bottom-1.5 right-1.5">{imageActions(p, isUploading)}</div>
        </div>

        {/* Identity + stats + flags */}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base truncate" style={{ color: 'var(--neutral-900, #1a1916)' }}>
              {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` · ${p.bathrooms} Bath` : ''}
            </h3>
            <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#d8f2e8', color: '#1a7a5a' }}>
              {p.unitCount} {p.unitCount === 1 ? 'unit' : 'units'}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--neutral-500, #6b6860)' }}>
            {p.buildingName} · {p.planLabel}
          </p>
          <div className="flex items-center gap-4 mt-1.5 text-xs" style={{ color: 'var(--neutral-600, #57544d)' }}>
            {p.bedrooms != null && (<span className="flex items-center gap-1"><BedDouble size={13} />{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} BR`}</span>)}
            {p.bathrooms != null && (<span className="flex items-center gap-1"><Bath size={13} />{p.bathrooms} Bath</span>)}
            <span className="flex items-center gap-1"><Maximize2 size={13} />{sizeLabel(p.sqftMin, p.sqftMax)} sqft</span>
          </div>
          {p.flags.length > 0 && <div className="mt-2">{flagChips(p)}</div>}
        </div>

        {/* Pricing */}
        <div className="flex flex-col justify-center items-end gap-1.5 shrink-0 w-[300px] max-w-[44%]">
          <div className="w-full">{priceBlock(p)}</div>
        </div>
      </div>
    );
  };

  // Per-unit display bits shared by the row and the grid card.
  const unitMeta = (u: UnitRecord) => {
    const contract = contracts.find(c => c.unit?.id === u.id && c.contractActive) ?? null;
    const tenant = contract?.tenant?.name ?? null;
    const fmtLease = (d: string | null | undefined) =>
      d ? new Date(d).toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' }) : null;
    const start = fmtLease(contract?.startDate);
    const end = fmtLease(contract?.endDate);
    const leaseRange = start && end ? `${start} → ${end}` : start ? `from ${start}` : end ? `until ${end}` : '';
    const size = u.unitSizeSqft ? `${Number(u.unitSizeSqft).toLocaleString()} sqft`
      : u.unitSizeSqm ? `${Number(u.unitSizeSqm).toLocaleString()} sqm` : null;
    return { tenant, leaseRange, pill: statusPill(u), size, price: u.rentalPrice ?? u.marketPrice, busy: busyUnit === u.id };
  };

  // Listing / view / edit / delete buttons — shared by the unit row and card.
  const unitActions = (p: Plan, u: UnitRecord, busy: boolean) => (
    <>
      {u.availability === 'available' && (u.listingStatus === 'draft' || u.listingStatus === 'expired' || u.listingStatus === 'rejected') && (
        <button disabled={busy} onClick={(e) => { e.stopPropagation(); onListingAction(p.propertyId, u.id, 'submit-listing'); }}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50" style={{ background: '#e6f7f1', color: 'var(--primary,#2e9f82)' }}>
          {u.listingStatus === 'expired' ? 'Relist' : u.listingStatus === 'rejected' ? 'Resubmit' : 'Submit'}
        </button>
      )}
      {u.availability === 'available' && (u.listingStatus === 'pending' || u.listingStatus === 'in_review') && (
        <button disabled={busy} onClick={(e) => { e.stopPropagation(); onListingAction(p.propertyId, u.id, 'withdraw-listing'); }}
          className="text-[11px] font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50" style={{ background: '#f1efe9', color: 'var(--neutral-600,#57544d)' }}>
          Withdraw
        </button>
      )}
      <button onClick={(e) => { e.stopPropagation(); setUnitPreview({ plan: p, unit: u }); }} title="View full unit details"
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
        style={{ color: 'var(--primary,#2e9f82)', background: '#e6f7f1', border: '1px solid #cfe9df' }}>
        <Eye size={13} /> View
      </button>
      <button onClick={(e) => { e.stopPropagation(); setUnitModal({ plan: p, editingUnit: u }); }} title="Edit unit"
        className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: 'var(--neutral-500,#6b6860)', background: '#fff', border: '1px solid #e8e6e0' }}>
        <Pencil size={14} />
      </button>
      {confirmDelete === u.id ? (
        <span className="flex items-center gap-1">
          <button disabled={busy} onClick={(e) => { e.stopPropagation(); onDeleteUnit(p.propertyId, u.id); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg disabled:opacity-50" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            {busy ? '…' : 'Delete'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg" style={{ background: '#f1efe9', color: '#6b6860' }}>No</button>
        </span>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(u.id); }} title="Delete unit"
          className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ color: '#b91c1c', background: '#fff', border: '1px solid #f1d5d5' }}>
          <Trash2 size={14} />
        </button>
      )}
    </>
  );

  // One unit row — used in the per-unit row view (`showBuilding` adds the
  // building name, since rows can span properties).
  const unitRow = (p: Plan, u: UnitRecord, showBuilding = false) => {
    const { tenant, leaseRange, pill, size, price, busy } = unitMeta(u);
    return (
      <div key={u.id} onClick={() => setUnitPreview({ plan: p, unit: u })} title="View full unit details"
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors bg-[#fafaf8] border border-[#eef0ee] hover:bg-[#f3f7f5] hover:border-[#cfe9df]">
        <button onClick={(e) => { e.stopPropagation(); setUnitPreview({ plan: p, unit: u }); }} title="Preview unit"
          className="font-semibold text-sm shrink-0 hover:underline"
          style={{ color: 'var(--neutral-900,#1a1916)', minWidth: 52, textAlign: 'left' }}>
          {u.unitNumber}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-xs" style={{ color: 'var(--neutral-600,#57544d)' }}>
            {showBuilding && p.buildingName && <span className="font-medium" style={{ color: 'var(--neutral-700,#44423c)' }}>{p.buildingName}</span>}
            {u.unitName && <span className="font-medium" style={{ color: 'var(--neutral-800,#2d2b26)' }}>{u.unitName}</span>}
            <span>{u.unitType.replace(/_/g, ' ')}</span>
            {u.bedrooms != null && <span>· {u.bedrooms} BR</span>}
            {u.bathrooms != null && <span>· {u.bathrooms} BA</span>}
            {size && <span>· {size}</span>}
            {u.view && <span>· {u.view}</span>}
          </div>
          {tenant && (
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--neutral-500,#6b6860)' }}>
              {tenant}{leaseRange ? ` · ${leaseRange}` : ''}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {price != null && (
            <div className="text-sm font-bold whitespace-nowrap" style={{ color: 'var(--primary,#2e9f82)' }}>
              AED {aed(Number(price))}
            </div>
          )}
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: pill.bg, color: pill.fg }}>
            {pill.label}
          </span>
          {unitActions(p, u, busy)}
        </div>
      </div>
    );
  };

  // One unit as a card — used in the per-unit grid view.
  const unitCard = (p: Plan, u: UnitRecord, showBuilding = false) => {
    const { tenant, leaseRange, pill, size, price, busy } = unitMeta(u);
    return (
      <div key={u.id} onClick={() => setUnitPreview({ plan: p, unit: u })} title="View full unit details"
        className="flex flex-col overflow-hidden cursor-pointer transition-shadow hover:shadow-md"
        style={{ background: 'var(--white,#fff)', borderRadius: 16, border: '1px solid #eef0ee', boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
        {/* Floor-plan thumbnail */}
        <div className="relative" style={{ height: 132 }}>
          <PlanThumb url={u.floorPlanUrl ?? p.floorPlanUrl} alt={u.unitNumber} />
          <span className="absolute top-2 left-2 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.92)', color: 'var(--neutral-700,#44423c)' }}>
            {u.unitNumber}
          </span>
          <span className="absolute top-2 right-2 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: pill.bg, color: pill.fg }}>
            {pill.label}
          </span>
        </div>
        {/* Body */}
        <div className="flex flex-col flex-1 p-4">
          {showBuilding && p.buildingName && (
            <p className="text-xs font-medium truncate" style={{ color: 'var(--neutral-500,#6b6860)' }}>{p.buildingName}</p>
          )}
          {u.unitName && (
            <h3 className="font-semibold text-sm truncate" style={{ color: 'var(--neutral-900,#1a1916)' }}>{u.unitName}</h3>
          )}
          <div className="flex items-center gap-1.5 flex-wrap text-xs mt-0.5" style={{ color: 'var(--neutral-600,#57544d)' }}>
            <span>{u.unitType.replace(/_/g, ' ')}</span>
            {u.bedrooms != null && <span>· {u.bedrooms} BR</span>}
            {u.bathrooms != null && <span>· {u.bathrooms} BA</span>}
            {size && <span>· {size}</span>}
            {u.view && <span>· {u.view}</span>}
          </div>
          {tenant && (
            <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--neutral-500,#6b6860)' }}>
              {tenant}{leaseRange ? ` · ${leaseRange}` : ''}
            </p>
          )}
          <div className="mt-auto pt-3">
            {price != null && (
              <div className="text-base font-bold whitespace-nowrap" style={{ color: 'var(--primary,#2e9f82)' }}>
                AED {aed(Number(price))}<span className="text-xs font-medium" style={{ color: 'var(--neutral-500,#6b6860)' }}> /yr</span>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {unitActions(p, u, busy)}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--base-100, #f7f6f2)' }}>
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFile} />

      <div className="max-w-6xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-bold" style={{ fontSize: 28, color: 'var(--neutral-900, #1a1916)', letterSpacing: '-0.02em' }}>
              Units &amp; pricing
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--neutral-500, #6b6860)' }}>
              {building ? `${building} · pricing by floor-plan layout` : 'All properties · pricing by floor-plan layout'}
            </p>
          </div>
          {!manager && (
            <Link href="/rental-provider/dashboard/units/add"
              className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-lg shrink-0"
              style={{ background: 'var(--primary,#2e9f82)', color: '#fff' }}>
              <Plus size={15} /> Add units
            </Link>
          )}
        </div>

        {/* Row 1 — switch tab (left) + sort & layout view (right). */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: '#f1efe9' }}>
            {([['type', 'By layout'], ['unit', 'By unit']] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className="px-3 h-8 rounded-md text-xs font-semibold transition-colors"
                style={mode === m
                  ? { background: 'var(--white,#fff)', color: 'var(--neutral-900,#1a1916)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                  : { color: 'var(--neutral-500,#6b6860)' }}>
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Select label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
            <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: '#f1efe9' }}>
              {([['grid', LayoutGrid, 'Grid'], ['row', Rows3, 'Rows']] as const).map(([v, Icon, label]) => (
                <button key={v} onClick={() => setView(v)} title={`${label} view`} aria-label={`${label} view`} aria-pressed={view === v}
                  className="flex items-center justify-center w-9 h-8 rounded-md transition-colors"
                  style={view === v
                    ? { background: 'var(--white,#fff)', color: 'var(--neutral-900,#1a1916)', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }
                    : { color: 'var(--neutral-500,#6b6860)' }}>
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Row 2 — filters, left-aligned to line up with Row 1, separate row. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {/* Search — matches the portfolio page filter style */}
          <div className="relative w-[240px] max-w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--mute, #9b9890)' }} />
            <input
              type="text"
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder={mode === 'unit' ? 'Search units…' : 'Search layouts…'}
              aria-label={mode === 'unit' ? 'Search units' : 'Search layouts'}
              className="w-full outline-none transition-all"
              style={{ padding: '10px 32px 10px 36px', fontSize: 13.5, border: '1px solid var(--line-2, #d8d6d0)', borderRadius: 10, background: '#fff', color: 'var(--ink, #1a1916)' }} />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center cursor-pointer"
                style={{ width: 24, height: 24, borderRadius: 6, background: 'transparent', border: 0, color: 'var(--mute, #9b9890)' }}>
                <X size={12} />
              </button>
            )}
          </div>
          {data && data.properties.length > 0 && (
            <Select label="Property" value={propertyId == null ? 'all' : String(propertyId)} onChange={onProperty}
              options={[{ value: 'all', label: 'All properties' }, ...data.properties.map(p => ({ value: String(p.id), label: p.buildingName.trim() }))]} />
          )}

          {typeOptions.length > 1 && (
            <Select label="Unit type" value={typeFilter} onChange={onType}
              options={[{ value: 'all', label: 'All types' }, ...typeOptions.map(t => ({ value: t, label: typeLabel(t === 'other' ? null : t) }))]} />
          )}

          {typePlans.length > 1 && (
            <Select label="Plan" value={planFilter} onChange={setPlanFilter} options={planOptions} />
          )}
        </div>

        {/* Total units by unit type */}
        {!loading && plans.length > 0 && (
          <div className="mt-5 flex items-center gap-2 flex-wrap text-sm">
            <span className="font-semibold" style={{ color: 'var(--neutral-900,#1a1916)' }}>
              {totalUnits.toLocaleString()} {totalUnits === 1 ? 'unit' : 'units'}
            </span>
            <span style={{ color: '#d8d6d0' }}>·</span>
            {typeCounts.map(t => (
              <span key={t.unitType} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs"
                style={{ background: 'var(--white,#fff)', color: 'var(--neutral-600,#57544d)', boxShadow: '0 1px 4px -1px rgba(0,0,0,0.06)' }}>
                {typeLabel(t.unitType === 'other' ? null : t.unitType)}
                <span className="font-bold" style={{ color: 'var(--neutral-900,#1a1916)' }}>{t.count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Pricing health */}
        {!loading && plans.length > 0 && (
          <div className="mt-5 rounded-2xl p-4" style={{ background: 'var(--white,#fff)', boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            {flagged === 0 ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: '#1a7a5a' }}>
                <Check size={16} /> No pricing gaps on the shown layouts.
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: 'var(--neutral-800,#2d2b26)' }}>
                  <AlertTriangle size={15} className="text-[#d97706]" />
                  {flagged} of {plans.length} layouts need a pricing look
                </span>
                <span className="text-[#d8d6d0]">·</span>
                {counts.map(c => (
                  <span key={c.f} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${FLAG_META[c.f].cls}`}>
                    {c.n} {FLAG_META[c.f].label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm" style={{ background: '#fee2e2', color: '#b91c1c' }}>
            <Info size={15} /> {err}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm" style={{ color: 'var(--neutral-400, #9b9890)' }}>
            <Loader2 size={16} className="animate-spin" /> Loading layouts…
          </div>
        ) : mode === 'unit' ? (
          // ── Per-unit (flat) view — units grouped under their unit type ──
          scopedUnitRows.length === 0 ? (
            perUnitLoading ? (
              <div className="flex items-center justify-center gap-2 py-24 text-sm" style={{ color: 'var(--neutral-400, #9b9890)' }}>
                <Loader2 size={16} className="animate-spin" /> Loading units…
              </div>
            ) : (
              <div className="text-center py-24">
                <Layers size={32} className="mx-auto mb-3" style={{ color: 'var(--neutral-300, #c5c3bc)' }} />
                <p className="text-sm" style={{ color: 'var(--neutral-400, #9b9890)' }}>
                  {q ? `No units match “${query.trim()}”.`
                    : typeFilter !== 'all' ? `No ${typeLabel(typeFilter === 'other' ? null : typeFilter)} units in this scope.`
                    : 'No units found for this scope.'}
                </p>
              </div>
            )
          ) : (
            <div className="mt-6 flex flex-col gap-9">
              {unitGroups.map(g => (
                <section key={g.unitType}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className="font-semibold" style={{ fontSize: 17, color: 'var(--neutral-900,#1a1916)' }}>
                      {typeLabel(g.unitType === 'other' ? null : g.unitType)}
                    </h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: '#f1efe9', color: 'var(--neutral-600,#57544d)' }}>
                      {g.items.length} {g.items.length === 1 ? 'unit' : 'units'}
                    </span>
                    {/* Add a unit to this group's property (single-property scope is
                        unambiguous; in "all properties" it targets the first listed
                        unit's property — the new unit's type is set in the form). */}
                    {g.items[0]?.pl && (
                      <button onClick={() => setUnitModal({ plan: g.items[0].pl })}
                        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                        style={{ background: 'var(--primary,#2e9f82)', color: '#fff' }}>
                        <Plus size={13} /> Add unit
                      </button>
                    )}
                  </div>
                  {view === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                      {g.items.map(({ u, pl }) => unitCard(pl, u, propertyId == null))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {g.items.map(({ u, pl }) => unitRow(pl, u, propertyId == null))}
                    </div>
                  )}
                </section>
              ))}
              {perUnitLoading && (
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--neutral-400,#9b9890)' }}>
                  <Loader2 size={15} className="animate-spin" /> Loading more units…
                </div>
              )}
            </div>
          )
        ) : plans.length === 0 ? (
          <div className="text-center py-24">
            <Layers size={32} className="mx-auto mb-3" style={{ color: 'var(--neutral-300, #c5c3bc)' }} />
            <p className="text-sm" style={{ color: 'var(--neutral-400, #9b9890)' }}>
              {q ? `No layouts match “${query.trim()}”.`
                : typeFilter !== 'all' ? `No ${typeLabel(typeFilter === 'other' ? null : typeFilter)} layouts in this scope.`
                : 'No layout plans found for this scope.'}
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-9">
            {groups.map(g => (
              <section key={g.unitType}>
                {/* Unit-type heading */}
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-semibold" style={{ fontSize: 17, color: 'var(--neutral-900,#1a1916)' }}>
                    {typeLabel(g.unitType === 'other' ? null : g.unitType)}
                  </h2>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: '#f1efe9', color: 'var(--neutral-600,#57544d)' }}>
                    {g.count} {g.count === 1 ? 'unit' : 'units'}
                  </span>
                </div>

                {view === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {g.plans.map(p => gridCard(p))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {g.plans.map(p => rowCard(p))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Plan-wide financial-details editor */}
      {finModal && (
        <FinancialsModal plan={finModal} manager={manager} rpQ={rpQ} feeRules={data?.feeRules ?? null}
          onClose={() => setFinModal(null)}
          onSaved={() => { setFinModal(null); reload(); }} />
      )}

      {/* Full-screen floor-plan viewer */}
      {viewer && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'rgba(20,19,18,0.92)' }} onClick={() => setViewer(null)}>
          <div className="flex items-center justify-between px-5 py-3 text-white" onClick={e => e.stopPropagation()}>
            <span className="text-sm font-medium truncate">{viewer.name.trim() || 'Floor plan'}</span>
            <div className="flex items-center gap-2">
              <a href={viewer.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25">
                <Download size={14} /> Open / download
              </a>
              <button onClick={() => setViewer(null)} className="w-9 h-9 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="flex-1 px-4 pb-4" onClick={e => e.stopPropagation()}>
            {isPdf(viewer.url)
              ? <iframe src={viewer.url} title="Floor plan" className="w-full h-full rounded-lg bg-white" style={{ border: 0 }} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={viewer.url} alt="Floor plan" className="w-full h-full object-contain" />}
          </div>
        </div>
      )}

      {/* Per-unit add / edit. The modal closes itself on save. */}
      {unitModal && (
        <UnitFormModal
          open
          propertyCategory={unitModal.plan.spaceCategory ?? ''}
          title={unitModal.editingUnit ? 'Edit Unit' : 'Add Unit'}
          initial={unitModal.editingUnit ? unitToFormInitial(unitModal.editingUnit) : undefined}
          existingFloorPlanUrl={unitModal.editingUnit?.floorPlanUrl ?? null}
          propertyStandalone={false}
          propertyId={unitModal.plan.propertyId}
          editingUnitId={unitModal.editingUnit?.id}
          onClose={() => setUnitModal(null)}
          onSave={(data, floorPlan, titleDeed, addendums) =>
            onSaveUnit(unitModal.plan, unitModal.editingUnit, data, floorPlan, titleDeed, addendums)}
        />
      )}

      {/* Read-only unit preview. */}
      {unitPreview && (
        <UnitPreviewModal
          propertyId={unitPreview.plan.propertyId}
          propertyName={unitPreview.plan.buildingName}
          fetchBase={manager ? '/manager/properties' : undefined}
          fetchQuery={manager ? rpQ : undefined}
          unit={unitPreview.unit}
          contract={(() => {
            // Prefer the active lease; else fall back to the most recent contract
            // (the list is sorted createdAt DESC) so a now-vacant unit still shows
            // its last tenancy.
            const forUnit = contracts.filter(x => x.unit?.id === unitPreview.unit.id);
            const c = forUnit.find(x => x.contractActive) ?? forUnit[0];
            return c ? { id: c.id, tenantName: c.tenant?.name ?? null, startDate: c.startDate, endDate: c.endDate, status: c.status, active: c.contractActive } : null;
          })()}
          onClose={() => setUnitPreview(null)}
        />
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label}
        className="appearance-none bg-white focus:outline-none cursor-pointer transition-all"
        style={{ padding: '10px 32px 10px 14px', fontSize: 13.5, fontWeight: 500, border: '1px solid var(--line-2, #d8d6d0)', borderRadius: 10, color: 'var(--ink-2, #44423c)' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--mute, #9b9890)' }} />
    </div>
  );
}

// Plan-wide pricing & financial-details editor — one place to set the price
// AND the deposit/fees/service charges, written to every unit on the layout
// (the "plan → all units" model).
const FIN_FIELDS = [
  { key: 'securityDeposit', label: 'Security Deposit' },
  { key: 'adminFee',        label: 'Admin Fee' },
  { key: 'ejariFee',        label: 'Ejari Fee' },
  { key: 'commission',      label: 'Commission' },
  { key: 'serviceCharges',  label: 'Service Charges (AED/yr)' },
] as const;

// Lease terms + leasing configuration — also plan-wide, written to every unit's
// facilities JSON. Labels mirror the per-unit form (UnitFormModal) verbatim so
// the two editors look identical.
const LEASE_TERM_FIELDS = [
  { key: 'minLeaseMonths',    label: 'Min. Lease (months)',    placeholder: '12', step: '1',   max: undefined as number | undefined },
  { key: 'noticePeriodDays',  label: 'Notice Period (days)',   placeholder: '60', step: '1',   max: undefined },
  { key: 'rentEscalationPct', label: 'Rent Escalation (%/yr)', placeholder: 'e.g. 5', step: '0.5', max: 100 },
] as const;
const LEASE_CONFIG_FIELDS = [
  { key: 'numberOfPayments', label: 'Number of Payments', placeholder: 'e.g. 4 cheques', step: '1',   max: undefined as number | undefined },
  { key: 'advancePayment',   label: 'Advance Payment (AED)', placeholder: 'e.g. 5000',  step: 'any', max: undefined },
  { key: 'gracePeriodDays',  label: 'Grace Period (days)',   placeholder: 'e.g. 7',     step: '1',   max: undefined },
  { key: 'latePaymentFee',   label: 'Late Payment Fee (AED)', placeholder: 'e.g. 500',  step: 'any', max: undefined },
] as const;
// Every numeric lease key the editor manages (validation + save).
const LEASE_NUM_KEYS = [...LEASE_TERM_FIELDS, ...LEASE_CONFIG_FIELDS] as readonly { key: string; label: string }[];
const RENTAL_TYPES = [
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }, { id: 'quarterly', label: 'Quarterly' },
  { id: 'yearly', label: 'Yearly' }, { id: 'custom', label: 'Custom' },
];
const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// Shared form styling — matches UnitFormModal so both unit editors look the same.
const FORM_INPUT = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#2e9f82]';
const FORM_LABEL = 'block text-xs font-medium text-[#3d3b35] mb-1';

function FinancialsModal({ plan, manager, rpQ, feeRules, onClose, onSaved }: {
  plan: Plan; manager?: { rp: number }; rpQ: string;
  feeRules: Record<string, FeeRuleLite[]> | null;
  onClose: () => void; onSaved: () => void;
}) {
  // The fee rules for this layout's space category (fallback: residential).
  const rules = (plan.spaceCategory && feeRules?.[plan.spaceCategory]) || feeRules?.residential;
  // Fees driven by a rule (default off the rent); service charges has no rule.
  const RULE_KEYS = ['securityDeposit', 'adminFee', 'ejariFee', 'commission'];

  // Rule-defaulted value for a fee key at a given rent (string for the input).
  const ruleDefault = (key: string, rent: number): string => {
    const v = feeFromRules(rules, key, rent);
    if (v != null) return String(v);
    const stored = plan[key as keyof Plan] as number | null; // fall back to stored
    return stored != null ? String(stored) : '';
  };

  const initRent = plan.rentFrom ?? 0;
  const [vals, setVals] = useState<Record<string, string>>(() => ({
    rentalPrice: plan.rentFrom != null ? String(plan.rentFrom) : '',
    securityDeposit: ruleDefault('securityDeposit', initRent),
    adminFee:        ruleDefault('adminFee', initRent),
    ejariFee:        ruleDefault('ejariFee', initRent),
    commission:      ruleDefault('commission', initRent),
    serviceCharges:  plan.serviceCharges != null ? String(plan.serviceCharges) : '',
  }));
  // Fee keys the user has overridden — these stop auto-recomputing off the rent.
  const [overridden, setOverridden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lease terms + leasing configuration (plan-wide), seeded from current values.
  const lt = plan.leaseTerms ?? {};
  const [lease, setLease] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of LEASE_NUM_KEYS) {
      const v = (lt as Record<string, number | undefined>)[f.key];
      seed[f.key] = v != null ? String(v) : '';
    }
    return seed;
  });
  const [rentalType, setRentalType] = useState<string>(lt.rentalType || 'yearly');
  // Agreement addendum — a staged .docx to upload (mints a new version on save),
  // plus the version timeline.
  const [addendumFile, setAddendumFile] = useState<File | null>(null);
  const [addendumErr, setAddendumErr] = useState<string | null>(null);
  const [addendumChecking, setAddendumChecking] = useState(false);
  const addendumInputRef = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<TermsVersion[] | null>(null);
  const [verLoading, setVerLoading] = useState(false);

  const onAddendumPick = async (f: File | undefined) => {
    if (!f) return;
    setAddendumErr(null); setAddendumChecking(true);
    try {
      const res = await validateAddendumFile(f);
      if (res.ok) setAddendumFile(f);
      else setAddendumErr(res.error ?? 'Invalid addendum file.');
    } finally { setAddendumChecking(false); }
  };

  const toggleHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setShowHistory(true);
    if (versions || verLoading) return;
    setVerLoading(true);
    try {
      const qs = new URLSearchParams({ propertyId: String(plan.propertyId), planLabel: plan.planLabel });
      const url = manager
        ? `/manager/units/terms-versions?${[rpQ, qs.toString()].filter(Boolean).join('&')}`
        : `/properties/floor-plans/terms-versions?${qs.toString()}`;
      const r = await apiGet<{ versions: TermsVersion[] }>(url);
      setVersions(r.versions ?? []);
    } catch { setVersions([]); }
    finally { setVerLoading(false); }
  };

  // When the rent changes, re-default the rule-driven fees the user hasn't touched.
  const onRentChange = (raw: string) => {
    const rent = Number(raw);
    setVals(v => {
      const next: Record<string, string> = { ...v, rentalPrice: raw };
      if (Number.isFinite(rent)) {
        for (const k of RULE_KEYS) {
          if (!overridden.has(k)) next[k] = ruleDefault(k, rent);
        }
      }
      return next;
    });
  };
  const onFeeChange = (key: string, raw: string) => {
    setOverridden(s => new Set(s).add(key));
    setVals(v => ({ ...v, [key]: raw }));
  };
  const resetToRules = () => {
    const rent = Number(vals.rentalPrice) || 0;
    setOverridden(new Set());
    setVals(v => ({
      ...v,
      securityDeposit: ruleDefault('securityDeposit', rent),
      adminFee: ruleDefault('adminFee', rent),
      ejariFee: ruleDefault('ejariFee', rent),
      commission: ruleDefault('commission', rent),
    }));
  };

  const save = async () => {
    // Financial details — blank clears the fee.
    const finBody: Record<string, unknown> = { propertyId: plan.propertyId, planLabel: plan.planLabel };
    for (const f of FIN_FIELDS) {
      const s = vals[f.key].trim();
      if (s === '') { finBody[f.key] = null; continue; }
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { setErr(`Enter a valid ${f.label.toLowerCase()}`); return; }
      finBody[f.key] = n;
    }
    // Annual rent (the single price) — optional; only written when provided.
    const priceStr = vals.rentalPrice.trim();
    let price: number | null = null;
    if (priceStr !== '') {
      price = Number(priceStr);
      if (!Number.isFinite(price) || price < 0) { setErr('Enter a valid annual rent'); return; }
    }

    // Lease terms + leasing config + Special Conditions — the editor is the
    // source of truth, so the whole set is submitted; a blank numeric clears
    // that term on the layout. The backend versions the Special Conditions.
    const leaseBody: Record<string, unknown> = { propertyId: plan.propertyId, planLabel: plan.planLabel };
    for (const f of LEASE_NUM_KEYS) {
      const s = (lease[f.key] ?? '').trim();
      if (s === '') continue;
      const n = Number(s);
      if (!Number.isFinite(n) || n < 0) { setErr(`Enter a valid ${f.label.toLowerCase()}`); return; }
      leaseBody[f.key] = n;
    }
    if (rentalType) leaseBody.rentalType = rentalType;

    setSaving(true); setErr(null);
    try {
      if (price != null) {
        await apiPatch(manager ? `/manager/units/price?${rpQ}` : '/properties/floor-plans/price',
          { propertyId: plan.propertyId, planLabel: plan.planLabel, rentalPrice: price });
      }
      await apiPatch(manager ? `/manager/units/financials?${rpQ}` : '/properties/floor-plans/financials', finBody);
      await apiPatch(manager ? `/manager/units/lease-terms?${rpQ}` : '/properties/floor-plans/lease-terms', leaseBody);
      // A staged addendum mints a new version (multipart, like the floor-plan image).
      if (addendumFile) {
        const fd = new FormData();
        fd.append('file', addendumFile);
        fd.append('propertyId', String(plan.propertyId));
        fd.append('planLabel', plan.planLabel);
        const r = await fetch(manager ? `/api/manager/units/addendum?${rpQ}` : '/api/properties/floor-plans/addendum',
          { method: 'POST', credentials: 'include', body: fd });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { message?: string }).message ?? 'Addendum upload failed'); }
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,19,18,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}
        style={{ boxShadow: '0 20px 60px -10px rgba(0,0,0,0.3)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: '#efece6' }}>
          <h3 className="font-semibold text-base" style={{ color: 'var(--neutral-900,#1a1916)' }}>
            {plan.buildingName} · {plan.displayName}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--neutral-500,#6b6860)' }}>
            {bedLabel(plan.bedrooms)} · {sizeLabel(plan.sqftMin, plan.sqftMax)} sqft · applies to all {plan.unitCount} unit{plan.unitCount === 1 ? '' : 's'} on this layout
          </p>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Annual rent — the single price (drives the fee auto-defaults). */}
          <div>
            <label className="block text-xs font-medium text-[#6b6860] mb-1">Annual Rent (AED)</label>
            <input type="number" min={0} step="any" autoFocus placeholder="e.g. 85000" value={vals.rentalPrice}
              onChange={e => onRentChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              className={FORM_INPUT} />
          </div>

          {/* Financial Details */}
          <div className="rounded-xl border border-[#a7f3d0] bg-[#f0fdf8] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a7a5a]">Financial Details</p>
              <button type="button" onClick={resetToRules} className="text-[10px] font-semibold text-[#1a7a5a] underline">
                Reset to fee rules
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {FIN_FIELDS.map(f => {
                const ruled = RULE_KEYS.includes(f.key);
                return (
                  <div key={f.key}>
                    <label className={FORM_LABEL}>
                      {f.label}
                      {ruled && overridden.has(f.key) && (
                        <span className="ml-1 text-[10px] font-semibold text-[#92400e]">· custom</span>
                      )}
                    </label>
                    <input type="number" min={0} step="any" className={FORM_INPUT} value={vals[f.key]}
                      onChange={e => onFeeChange(f.key, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') save(); }} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lease Terms — plan-wide; written to every unit's facilities JSON. */}
          <div className="rounded-xl border border-[#dbeafe] bg-[#eff6ff] p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1e40af]">Lease Terms</p>
            <div className="grid grid-cols-3 gap-3">
              {LEASE_TERM_FIELDS.map(f => (
                <div key={f.key}>
                  <label className={FORM_LABEL}>{f.label}</label>
                  <input type="number" min={0} step={f.step} max={f.max} className={FORM_INPUT}
                    placeholder={f.placeholder} value={lease[f.key] ?? ''}
                    onChange={e => setLease(v => ({ ...v, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Leasing Configuration — rental cadence + payment terms. */}
          <div className="rounded-xl border border-[#ede9fe] bg-[#f5f3ff] p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6d28d9]">Leasing Configuration</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={FORM_LABEL}>Rental Type</label>
                <select value={rentalType} onChange={e => setRentalType(e.target.value)} className={`${FORM_INPUT} appearance-none`}>
                  {RENTAL_TYPES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              {LEASE_CONFIG_FIELDS.map(f => (
                <div key={f.key}>
                  <label className={FORM_LABEL}>{f.label}</label>
                  <input type="number" min={0} step={f.step} className={FORM_INPUT}
                    placeholder={f.placeholder} value={lease[f.key] ?? ''}
                    onChange={e => setLease(v => ({ ...v, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Agreement — Addendum (versioned FILE). Upload a .docx (with the
              signature block); each upload mints a new version. The latest flows
              into new contracts; signed contracts keep the version they used. */}
          <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#b45309]">Agreement — Addendum</p>
              <a href={ADDENDUM_SAMPLE_URL} download className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b45309] hover:underline">
                <Download size={11} /> Download sample
              </a>
            </div>
            <p className="text-[10px] text-[#a16207]">
              {plan.termsVersion
                ? `Current v${plan.termsVersion.versionNo} · uploaded ${fmtDate(plan.termsVersion.effectiveAt)}. New contracts use the latest; signed contracts keep their version.`
                : 'Attach the addendum that new contracts from this layout will carry.'}
            </p>

            <input ref={addendumInputRef} type="file" accept={ADDENDUM_ACCEPT} className="sr-only"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void onAddendumPick(f); }} />

            {/* Current addendum on file (latest version). */}
            {plan.termsVersion?.addendumUrl && !addendumFile && (
              <a href={plan.termsVersion.addendumUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2 text-[#1a1916] hover:bg-[#fdf6e3]">
                <Upload size={14} className="text-[#b45309] shrink-0" />
                <span className="text-sm truncate flex-1">{plan.termsVersion.addendumFileName ?? 'Addendum'}</span>
                <span className="text-[11px] text-[#9b9890]">on file</span>
              </a>
            )}

            {/* Staged replacement, pending save. */}
            {addendumFile && (
              <div className="flex items-center gap-2 border border-[#e8e6e0] rounded-lg px-3 py-2">
                <Upload size={14} className="text-[#2e9f82] shrink-0" />
                <span className="text-sm text-[#1a1916] truncate flex-1">{addendumFile.name}</span>
                <button type="button" onClick={() => { setAddendumFile(null); setAddendumErr(null); }}
                  className="w-5 h-5 rounded-full bg-[#f4f3ef] flex items-center justify-center text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><X size={11} /></button>
              </div>
            )}

            <button type="button" onClick={() => addendumInputRef.current?.click()} disabled={addendumChecking}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-[#e8e6e0] rounded-lg py-2.5 text-xs text-[#9b9890] hover:border-[#b45309] hover:bg-[#fffbeb] transition-colors cursor-pointer disabled:opacity-50">
              {addendumChecking ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} className="text-[#c8c6c0]" />}
              {addendumChecking ? 'Checking signature fields…'
                : plan.termsVersion?.addendumUrl ? 'Replace addendum (Word .docx)' : 'Attach addendum (Word .docx)'}
            </button>
            {addendumErr && <p className="text-[11px] text-red-600">{addendumErr}</p>}

            {plan.termsVersion && (
              <button type="button" onClick={toggleHistory} className="text-[11px] font-semibold text-[#b45309] underline">
                {showHistory ? 'Hide' : 'View'} history · {plan.termsVersion.versionsCount} version{plan.termsVersion.versionsCount === 1 ? '' : 's'}
              </button>
            )}
            {showHistory && (
              <div className="rounded-lg border border-[#fde68a] bg-white p-3 space-y-2.5">
                {verLoading && (
                  <div className="text-xs flex items-center gap-1.5 text-[#6b6860]">
                    <Loader2 size={13} className="animate-spin" /> Loading history…
                  </div>
                )}
                {!verLoading && versions && versions.length === 0 && (
                  <p className="text-xs text-[#9b9890]">No versions yet — uploading an addendum creates v1.</p>
                )}
                {!verLoading && versions?.map(v => (
                  <div key={v.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-semibold text-[#1a1916] shrink-0">v{v.versionNo}</span>
                    {v.addendumUrl
                      ? <a href={v.addendumUrl} target="_blank" rel="noreferrer" className="text-[#b45309] truncate flex-1 hover:underline">{v.addendumFileName ?? 'Addendum'}</a>
                      : <span className="italic text-[#bdbab2] flex-1">No file</span>}
                    <span className="text-[#9b9890] shrink-0">{fmtDate(v.effectiveAt)}</span>
                    <span className="text-[#9b9890] shrink-0">· {v.contractsCount} contract{v.contractsCount === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {err && <div className="px-5 pb-1 text-xs" style={{ color: '#b91c1c' }}>{err}</div>}
        <div className="px-5 py-4 flex items-center justify-end gap-2 border-t" style={{ borderColor: '#efece6' }}>
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: '#f1efe9', color: '#6b6860' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: 'var(--primary,#2e9f82)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} Save to layout
          </button>
        </div>
      </div>
    </div>
  );
}

// RP portal route — the workspace with the default (RP-scoped) API.
export default function RpUnitsPage() {
  return <UnitsWorkspace />;
}
