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
  LayoutGrid, Rows3, Search,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';

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
  unpricedCount: number;
  unitCount: number;
  sampleUnitId: number;
  floorPlanUrl: string | null;
  flags: string[];
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
  const [sort, setSort] = useState('default');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'row'>('row');
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
  useEffect(() => { load(); }, [load]);

  const reload = () => load(propertyId);
  const onProperty = (v: string) => { setTypeFilter('all'); load(v === 'all' ? null : Number(v), 'all'); };

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

  const filtered = allPlans.filter(p => {
    if (typeFilter !== 'all' && (p.unitType ?? 'other') !== typeFilter) return false;
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
            <Link href={`/listings/units/${p.sampleUnitId}`} target="_blank"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--neutral-500,#6b6860)' }}>
              View a unit <ArrowRight size={12} />
            </Link>
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
          <Link href={`/listings/units/${p.sampleUnitId}`} target="_blank"
            className="inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--neutral-500,#6b6860)' }}>
            View a unit <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--base-100, #f7f6f2)' }}>
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFile} />

      <div className="max-w-6xl mx-auto px-5 py-8">
        {/* Header */}
        <div>
          <h1 className="font-bold" style={{ fontSize: 28, color: 'var(--neutral-900, #1a1916)', letterSpacing: '-0.02em' }}>
            Units &amp; pricing
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--neutral-500, #6b6860)' }}>
            {building ? `${building} · pricing by floor-plan layout` : 'All properties · pricing by floor-plan layout'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {/* Search — matches the portfolio page filter style */}
          <div className="relative flex-1 min-w-[200px] max-w-[340px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--mute, #9b9890)' }} />
            <input
              type="text"
              value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search layouts…" aria-label="Search layouts"
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
            <Select label="Unit type" value={typeFilter} onChange={setTypeFilter}
              options={[{ value: 'all', label: 'All types' }, ...typeOptions.map(t => ({ value: t, label: typeLabel(t === 'other' ? null : t) }))]} />
          )}

          {/* Sort + view toggle, pinned right */}
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
                    {g.plans.map(gridCard)}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {g.plans.map(rowCard)}
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
  { key: 'securityDeposit', label: 'Security deposit' },
  { key: 'adminFee',        label: 'Admin fee' },
  { key: 'ejariFee',        label: 'Ejari fee' },
  { key: 'commission',      label: 'Commission' },
  { key: 'serviceCharges',  label: 'Service charges' },
] as const;

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

    setSaving(true); setErr(null);
    try {
      if (price != null) {
        await apiPatch(manager ? `/manager/units/price?${rpQ}` : '/properties/floor-plans/price',
          { propertyId: plan.propertyId, planLabel: plan.planLabel, rentalPrice: price });
      }
      await apiPatch(manager ? `/manager/units/financials?${rpQ}` : '/properties/floor-plans/financials', finBody);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,19,18,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white overflow-hidden" onClick={e => e.stopPropagation()}
        style={{ boxShadow: '0 20px 60px -10px rgba(0,0,0,0.3)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: '#efece6' }}>
          <h3 className="font-semibold text-base" style={{ color: 'var(--neutral-900,#1a1916)' }}>Pricing &amp; financial details</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--neutral-500,#6b6860)' }}>
            {plan.buildingName} · {bedLabel(plan.bedrooms)} · applies to all {plan.unitCount} unit{plan.unitCount === 1 ? '' : 's'} on this layout
          </p>
        </div>
        <div className="p-5 space-y-4">
          {/* Annual rent — the single price */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--neutral-600,#57544d)' }}>Annual Rent (AED) <span style={{ color: '#6b6860' }}>· per year</span></label>
            <input type="number" min={0} step="any" autoFocus value={vals.rentalPrice}
              onChange={e => onRentChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
              className="w-full border rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none"
              style={{ borderColor: 'var(--primary,#2e9f82)', color: 'var(--neutral-900,#1a1916)' }} />
          </div>

          <div className="border-t pt-4" style={{ borderColor: '#efece6' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--neutral-500,#6b6860)' }}>Financial details</p>
              <button type="button" onClick={resetToRules} className="text-[11px] font-semibold underline" style={{ color: 'var(--primary,#2e9f82)' }}>
                Reset to fee rules
              </button>
            </div>
            <p className="text-[11px] mb-2.5" style={{ color: 'var(--neutral-400,#9b9890)' }}>
              Defaulted from your Fee Rules off the annual rent — override if this layout differs.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {FIN_FIELDS.map(f => {
                const ruled = RULE_KEYS.includes(f.key);
                return (
                  <div key={f.key}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--neutral-600,#57544d)' }}>
                      {f.label} (AED)
                      {ruled && overridden.has(f.key) && (
                        <span className="ml-1 text-[10px] font-semibold" style={{ color: '#92400e' }}>· custom</span>
                      )}
                    </label>
                    <input type="number" min={0} step="any" value={vals[f.key]}
                      onChange={e => onFeeChange(f.key, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') save(); }}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ borderColor: 'var(--neutral-300,#d8d6d0)', color: 'var(--neutral-900,#1a1916)' }} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {err && <div className="px-5 pb-1 text-xs" style={{ color: '#b91c1c' }}>{err}</div>}
        <div className="px-5 py-4 flex items-center justify-end gap-2 border-t" style={{ borderColor: '#efece6' }}>
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: '#f1efe9', color: '#6b6860' }}>Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-60" style={{ background: 'var(--primary,#2e9f82)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} Save to all units
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
