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
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api';

interface Plan {
  displayName: string;
  planLabel: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqftMin: number; sqftMax: number; sqmMin: number; sqmMax: number; avgSqft: number | null;
  priceFrom: number | null;            // asking-rent "from"
  rentFrom: number | null; rentTo: number | null;
  marketFrom: number | null; marketTo: number | null;
  marketGap: number | null;            // marketFrom − rentFrom (>0 = below market)
  aedPerSqft: number | null;
  unpricedCount: number;
  unitCount: number;
  sampleUnitId: number;
  floorPlanUrl: string | null;
  flags: string[];
}
interface PropOpt { id: number; buildingName: string }
interface Resp {
  properties: PropOpt[];
  selectedPropertyId: number | null;
  bedroomOptions: number[];
  plans: Plan[];
}

const aed = (n: number) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
const bedLabel = (b: number | null) => (b == null ? 'Unit' : b === 0 ? 'Studio' : `${b} Bed`);
const sizeLabel = (a: number, b: number) =>
  a === b ? a.toLocaleString() : `${a.toLocaleString()} – ${b.toLocaleString()}`;

// Flag → chip styling + human explanation.
const FLAG_META: Record<string, { label: string; cls: string; tip: (p: Plan) => string }> = {
  unpriced:     { label: 'Unpriced',        cls: 'bg-[#fee2e2] text-[#b91c1c]', tip: p => `${p.unpricedCount} unit${p.unpricedCount === 1 ? '' : 's'} on this layout have no asking rent set.` },
  inconsistent: { label: 'Inconsistent',    cls: 'bg-[#fef3c7] text-[#92400e]', tip: p => `Same layout, different rents (AED ${aed(p.rentFrom ?? 0)}–${aed(p.rentTo ?? 0)}). Align them.` },
  doesntScale:  { label: "Doesn't scale",   cls: 'bg-[#fef3c7] text-[#92400e]', tip: () => 'Priced at or below a smaller layout in the same tier — bigger should cost more.' },
  belowMarket:  { label: 'Below market',    cls: 'bg-[#dbeafe] text-[#1e40af]', tip: p => `Asking AED ${aed(p.marketGap ?? 0)} below the market benchmark (AED ${aed(p.marketFrom ?? 0)}).` },
  outlier:      { label: 'Rate outlier',    cls: 'bg-[#ede9fe] text-[#6d28d9]', tip: p => `AED ${p.aedPerSqft}/sqft is far from the ${bedLabel(p.bedrooms)} median for this property.` },
};
const FLAG_ORDER = ['unpriced', 'inconsistent', 'doesntScale', 'belowMarket', 'outlier'];

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
  const [beds, setBeds] = useState('all');
  const [loading, setLoading] = useState(true);

  // inline rent editing
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // image upload
  const [uploadingPlan, setUploadingPlan] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const targetPlan = useRef<string | null>(null);

  // full-screen viewer
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);

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

  const reload = () => load(propertyId, beds);
  const onProperty = (v: string) => { const pid = Number(v); setBeds('all'); load(pid, 'all'); };
  const onBeds = (v: string) => { setBeds(v); load(propertyId, v); };

  const startEdit = (p: Plan) => { setErr(null); setEditing(p.planLabel); setDraft(p.rentFrom != null ? String(p.rentFrom) : ''); };
  const saveEdit = async (p: Plan) => {
    const val = Number(draft);
    if (!Number.isFinite(val) || val < 0) { setErr('Enter a valid yearly rent'); return; }
    setSaving(true); setErr(null);
    try {
      await apiPatch(manager ? `/manager/units/price?${rpQ}` : '/properties/floor-plans/price', { propertyId, planLabel: p.planLabel, rentalPrice: val });
      setEditing(null);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const pickImage = (planLabel: string) => { targetPlan.current = planLabel; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const plan = targetPlan.current;
    e.target.value = '';
    if (!file || !plan || propertyId == null) return;
    setUploadingPlan(plan); setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('propertyId', String(propertyId));
      fd.append('planLabel', plan);
      const r = await fetch(manager ? `/api/manager/units/image?${rpQ}` : '/api/properties/floor-plans/image', { method: 'POST', credentials: 'include', body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { message?: string }).message ?? 'Upload failed'); }
      reload();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setUploadingPlan(null);
    }
  };

  const plans = data?.plans ?? [];
  const building = data?.properties.find(p => p.id === propertyId)?.buildingName?.trim();

  // pricing-health summary
  const flagged = plans.filter(p => p.flags.length > 0).length;
  const counts = FLAG_ORDER.map(f => ({ f, n: plans.filter(p => p.flags.includes(f)).length })).filter(c => c.n > 0);

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
            {building ? `${building} · pricing by floor-plan layout` : 'Set pricing per layout and spot gaps to improve'}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mt-5">
          {data && data.properties.length > 0 && (
            <Select label="Property" value={String(propertyId ?? '')} onChange={onProperty}
              options={data.properties.map(p => ({ value: String(p.id), label: p.buildingName.trim() }))} />
          )}
          <Select label="Bedrooms" value={beds} onChange={onBeds}
            options={[{ value: 'all', label: 'All bedrooms' }, ...(data?.bedroomOptions ?? []).map(b => ({ value: String(b), label: bedLabel(b) }))]} />
        </div>

        {/* Pricing health */}
        {!loading && plans.length > 0 && (
          <div className="mt-5 rounded-2xl p-4" style={{ background: 'var(--white,#fff)', boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            {flagged === 0 ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: '#1a7a5a' }}>
                <Check size={16} /> No pricing gaps on the {beds === 'all' ? 'shown' : bedLabel(Number(beds))} layouts.
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
            <p className="text-sm" style={{ color: 'var(--neutral-400, #9b9890)' }}>No layout plans found for this scope.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
            {plans.map(p => {
              const isEditing = editing === p.planLabel;
              const isUploading = uploadingPlan === p.planLabel;
              return (
                <div key={p.planLabel} className="flex flex-col overflow-hidden"
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
                    {/* image actions */}
                    <div className="absolute bottom-2 right-2 flex gap-1.5">
                      {p.floorPlanUrl && (
                        <button onClick={() => setViewer({ url: p.floorPlanUrl!, name: `${building ?? ''} ${p.displayName}` })}
                          title="View full floor plan"
                          className="w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center text-[#44423c] hover:bg-white">
                          <Maximize size={14} />
                        </button>
                      )}
                      <button onClick={() => pickImage(p.planLabel)} disabled={isUploading}
                        title="Replace floor plan (applies to all units on this plan)"
                        className="w-8 h-8 rounded-full bg-white/95 shadow flex items-center justify-center text-[#44423c] hover:bg-white disabled:opacity-60">
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="flex flex-col flex-1 p-5">
                    <p className="text-xs font-medium mb-0.5 truncate" style={{ color: 'var(--neutral-500, #6b6860)' }}>
                      {building ?? p.planLabel}
                    </p>
                    <h3 className="font-semibold text-base truncate" style={{ color: 'var(--neutral-900, #1a1916)' }}>
                      {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` · ${p.bathrooms} Bath` : ''}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--neutral-500, #6b6860)' }}>{p.planLabel}</p>

                    {/* Stats */}
                    <div className="flex items-center gap-4 mt-3 text-xs" style={{ color: 'var(--neutral-600, #57544d)' }}>
                      {p.bedrooms != null && (<span className="flex items-center gap-1"><BedDouble size={13} />{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} BR`}</span>)}
                      {p.bathrooms != null && (<span className="flex items-center gap-1"><Bath size={13} />{p.bathrooms} Bath</span>)}
                      <span className="flex items-center gap-1"><Maximize2 size={13} />{sizeLabel(p.sqftMin, p.sqftMax)} sqft</span>
                    </div>

                    {/* Gap flags */}
                    {p.flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {FLAG_ORDER.filter(f => p.flags.includes(f)).map(f => (
                          <span key={f} title={FLAG_META[f].tip(p)} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full cursor-help ${FLAG_META[f].cls}`}>
                            {FLAG_META[f].label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Pricing block */}
                    <div className="mt-auto pt-4">
                      {/* benchmark + rate row */}
                      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--neutral-500,#6b6860)' }}>
                        <span>{p.aedPerSqft != null ? `AED ${p.aedPerSqft}/sqft` : 'No rate'}</span>
                        {p.marketFrom != null && (
                          <span>Market <span className="font-medium" style={{ color: 'var(--neutral-700,#44423c)' }}>AED {aed(p.marketFrom)}</span></span>
                        )}
                      </div>

                      {/* editable asking rent */}
                      {isEditing ? (
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center gap-1 flex-1 border rounded-lg px-2 py-1.5" style={{ borderColor: 'var(--primary,#2e9f82)' }}>
                            <span className="text-xs" style={{ color: 'var(--neutral-500,#6b6860)' }}>AED</span>
                            <input autoFocus type="number" min={0} value={draft} onChange={e => setDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(p); if (e.key === 'Escape') setEditing(null); }}
                              className="w-full text-sm font-semibold bg-transparent focus:outline-none" style={{ color: 'var(--neutral-900,#1a1916)' }} />
                            <span className="text-xs" style={{ color: 'var(--neutral-500,#6b6860)' }}>/yr</span>
                          </div>
                          <button onClick={() => saveEdit(p)} disabled={saving}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-white disabled:opacity-60" style={{ background: 'var(--primary,#2e9f82)' }}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
                          </button>
                          <button onClick={() => setEditing(null)} disabled={saving}
                            className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#f1efe9', color: '#6b6860' }}>
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between mt-2">
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
                              <span className="text-sm font-medium" style={{ color: '#b91c1c' }}>No asking rent</span>
                            )}
                          </div>
                          <button onClick={() => startEdit(p)}
                            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg"
                            style={{ backgroundColor: '#e6f7f1', color: 'var(--primary, #2e9f82)' }}>
                            <Pencil size={12} /> {p.rentFrom != null ? 'Edit' : 'Set price'}
                          </button>
                        </div>
                      )}

                      <Link href={`/listings/units/${p.sampleUnitId}`} target="_blank"
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--neutral-500,#6b6860)' }}>
                        View a unit <ArrowRight size={12} />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
        className="appearance-none border rounded-md pl-3 pr-9 py-2 text-sm bg-white focus:outline-none cursor-pointer"
        style={{ borderColor: 'var(--neutral-300, #d8d6d0)', color: 'var(--neutral-900, #1a1916)' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--neutral-400, #9b9890)' }} />
    </div>
  );
}

// RP portal route — the workspace with the default (RP-scoped) API.
export default function RpUnitsPage() {
  return <UnitsWorkspace />;
}
