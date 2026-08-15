/**
 * Super-Admin: Service Catalog & Pricing (dashboard/admin/catalog)
 *
 * Root-configuration console for the platform-owned SP rate card: categories,
 * service templates (prices), commission (global + per-category overrides,
 * versioned in fee_config), VAT display mode, launch scope and cancellation
 * policy. All money is WHOLE AED; commission/VAT stored as basis points.
 * Backend contract: /admin/catalog/* — tolerate 404/network (may not be live).
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Wind, Droplets, Zap, Hammer, PaintRoller, Bug, Car, Trees, Building2, Wrench, Pencil, Plus, X, Loader2, RefreshCw, AlertTriangle, Percent, Layers, ListChecks, Tags, BadgePercent, Landmark, Rocket, ChevronUp, ChevronDown, Trash2, GripVertical, Image as ImageIcon, ImagePlus } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from '@/lib/api';

/* ── API types (exact contract) ── */
type PriceUnit =
  | 'fixed' | 'per_hour' | 'per_unit' | 'per_area'
  | 'per_size_package' | 'per_period' | 'quote_after_callout';

interface CatCategory {
  id: number; code: string; nameEn: string; nameAr: string | null;
  iconKey: string | null; imageUrl?: string | null; sortOrder: number; isActive: boolean;
  serviceCount: number; activeServiceCount: number; minFromPrice: number | null;
  commissionBps: number; hasOverride: boolean;
}
interface CancelTier { minHoursBefore: number; feePct: number }
/** SP-135: platform matrix + who keeps a retained fee + the no-show grace window. */
interface CancellationPolicy {
  reschedule: CancelTier[]; cancel: CancelTier[]; noShowFeePct: number;
  noShowGraceMinutes: number; retainedFeeTo: 'provider' | 'platform'; note?: string;
}
interface SpLaunch { emirates: string[]; inviteOnly: boolean }
interface Policies {
  vat_display_mode?: string;
  cancellation_policy?: CancellationPolicy;
  sp_launch?: SpLaunch;
}
interface Overview {
  categories: CatCategory[];
  commission: { globalBps: number; effectiveFrom: string | null };
  vat: { rateBps: number };
  policies: Policies;
}
interface TemplateVariant {
  id: number; code: string; name: string; nameAr: string | null;
  basePrice: number; estimatedDuration: number | null; estimatedDurationMax: number | null;
  sortOrder: number; isActive: boolean;
}
interface TemplateAddon {
  id: number; code: string; name: string; nameAr: string | null;
  price: number; priceUnit: 'flat' | 'per_hour'; sortOrder: number; isActive: boolean;
}
interface Template {
  id: number; categoryId: number; categoryCode: string; code: string;
  name: string; nameAr: string | null; description: string | null;
  priceUnit: PriceUnit; basePrice: number | null; isFromPrice: boolean;
  minPrice: number | null; maxPrice: number | null; minCalloutCharge: number | null;
  /** SP-135: per-service PARTIAL override of the platform cancellation policy (null = inherit). */
  cancellationPolicy?: { cancel?: CancelTier[]; noShowFeePct?: number } | null;
  isEmergency: boolean; estimatedDuration: number | null; estimatedDurationMax: number | null;
  sortOrder: number; isActive: boolean; adoptionCount: number;
  imageUrl?: string | null;
  // Variant layer (backend rolling out in parallel — always read defensively).
  variantGroupLabel?: string | null;
  variantCount?: number;               // active variants
  variants?: TemplateVariant[];        // ALL variants incl inactive, sorted sort_order,id
  // Booking options (migr 0118)
  quantityLabel?: string | null;
  quantityMin?: number;
  quantityMax?: number | null;
  addons?: TemplateAddon[];            // ALL add-ons incl inactive
}
interface CommissionResult {
  globalBps: number;
  categories: { id: number; commissionBps: number; hasOverride: boolean }[];
}

/* ── Style constants (match admin/risk generation) ── */
const GREEN = '#2e9f82', BLUE = '#3b6fb5', AMBER = '#d97706', RED = '#dc2626';
const tooltipStyle = { borderRadius: 12, border: '1px solid #e8e6e0', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' };

const ICON_MAP: Record<string, React.ElementType> = {
  'sparkles': Sparkles, 'wind': Wind, 'droplets': Droplets, 'zap': Zap,
  'hammer': Hammer, 'paint-roller': PaintRoller, 'bug': Bug, 'car': Car,
  'trees': Trees, 'building-2': Building2,
};
const ICON_KEYS = Object.keys(ICON_MAP);

const PRICE_UNITS: { value: PriceUnit; label: string }[] = [
  { value: 'fixed', label: 'Fixed price' },
  { value: 'per_hour', label: 'Per hour' },
  { value: 'per_unit', label: 'Per unit' },
  { value: 'per_area', label: 'Per area' },
  { value: 'per_size_package', label: 'Per size package' },
  { value: 'per_period', label: 'Per period' },
  { value: 'quote_after_callout', label: 'Quote after callout' },
];
const UNIT_SUFFIX: Partial<Record<PriceUnit, string>> = {
  per_hour: '/hr', per_unit: '/unit', per_area: '/sqm', per_period: '/period',
};

const EMIRATES: { value: string; label: string }[] = [
  { value: 'dubai', label: 'Dubai' },
  { value: 'abu_dhabi', label: 'Abu Dhabi' },
  { value: 'sharjah', label: 'Sharjah' },
  { value: 'ajman', label: 'Ajman' },
  { value: 'rak', label: 'Ras Al Khaimah' },
  { value: 'fujairah', label: 'Fujairah' },
  { value: 'uaq', label: 'Umm Al Quwain' },
];

/* ── Formatting helpers ── */
const fmtAED = (n: number) => `AED ${Math.round(n).toLocaleString('en-AE')}`;
function fmtBps(bps: number): string {
  const p = bps / 100;
  return `${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
}
function fmtDuration(min: number | null, max: number | null): string {
  if (min == null && max == null) return '—';
  const one = (m: number) => (m < 60 ? `${m}m` : m % 60 === 0 ? `${m / 60}h` : `${(m / 60).toFixed(1)}h`);
  if (min != null && max != null && max !== min) return `${one(min)}–${one(max)}`;
  return one((min ?? max)!);
}
function pricePill(t: Template): { text: string; tone: 'green' | 'amber' | 'mute' } {
  if (t.priceUnit === 'quote_after_callout') return { text: 'Quote after callout', tone: 'amber' };
  if (t.basePrice == null) return { text: '—', tone: 'mute' };
  const vCount = t.variantCount ?? 0;
  if (vCount > 0) {
    return { text: `From ${fmtAED(t.basePrice)} · ${vCount} × ${t.variantGroupLabel || 'Options'}`, tone: 'green' };
  }
  const suffix = UNIT_SUFFIX[t.priceUnit] ?? '';
  return { text: `${t.isFromPrice ? 'from ' : ''}${fmtAED(t.basePrice)}${suffix}`, tone: 'green' };
}
/** Duration display: template values, else min–max across active variants. */
function templateDuration(t: Template): string {
  if (t.estimatedDuration == null && t.estimatedDurationMax == null) {
    const active = (t.variants ?? []).filter(v => v.isActive);
    const mins = active.map(v => v.estimatedDuration).filter((n): n is number => n != null);
    const maxs = active.map(v => v.estimatedDurationMax ?? v.estimatedDuration).filter((n): n is number => n != null);
    if (mins.length || maxs.length) {
      return fmtDuration(mins.length ? Math.min(...mins) : null, maxs.length ? Math.max(...maxs) : null);
    }
  }
  return fmtDuration(t.estimatedDuration, t.estimatedDurationMax);
}
/** ≥6h before / 2–6h / <2h labels from a desc-sorted tier list. */
function tierLabel(tiers: CancelTier[], i: number): string {
  const t = tiers[i];
  if (i === 0) return `≥${t.minHoursBefore}h before`;
  const prev = tiers[i - 1].minHoursBefore;
  if (t.minHoursBefore === 0) return `<${prev}h before`;
  return `${t.minHoursBefore}–${prev}h before`;
}

/* ── Small building blocks ── */
function KpiTile({ icon: Icon, label, value, sub }: {
  icon: React.ComponentType<{ size?: number }>; label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">
        <Icon size={12} /> {label}
      </div>
      <p className="text-xl font-bold mt-1.5 leading-none text-[#1a1916]">{value}</p>
      {sub && <p className="text-[11px] text-[#9b9890] mt-1.5">{sub}</p>}
    </div>
  );
}

function Chip({ c, children }: { c: string; children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap" style={{ backgroundColor: `${c}1a`, color: c }}>{children}</span>;
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button" disabled={disabled} onClick={onChange} aria-pressed={on}
      className="relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ backgroundColor: on ? GREEN : '#d4d2cc' }}
    >
      <span className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all" style={{ left: on ? 16 : 2 }} />
    </button>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold text-[#6b6860] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-[#9b9890] mt-1">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-[#e8e6e0] bg-white px-2.5 py-1.5 text-[13px] text-[#1a1916] outline-none focus:border-[#2e9f82] disabled:bg-[#f4f3ef] disabled:text-[#9b9890]';

/** Attach/replace/remove a cover image on a saved row (multipart POST). */
function ImageAttach({ label, current, uploadPath, clearPath, onChanged, newHint }: {
  label: string;
  current: string | null;
  uploadPath: string | null; // null → row not saved yet (attach disabled)
  clearPath: string;
  onChanged: (url: string | null) => void;
  newHint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!uploadPath) {
    return (
      <div>
        <span className="block text-[11px] font-semibold text-[#6b6860] mb-1">{label}</span>
        <p className="rounded-lg border border-dashed border-[#e8e6e0] px-3 py-2.5 text-[11px] text-[#9b9890]">{newHint}</p>
      </div>
    );
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { setErr('Use a JPEG, PNG or WebP image.'); return; }
    if (f.size > 8 * 1024 * 1024) { setErr('Image is larger than 8 MB.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await apiUpload<{ imageUrl?: string | null }>(uploadPath, f);
      onChanged(res.imageUrl ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true); setErr(null);
    try {
      await apiDelete(clearPath);
      onChanged(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Remove failed.');
    } finally { setBusy(false); }
  };

  return (
    <div>
      <span className="block text-[11px] font-semibold text-[#6b6860] mb-1">{label}</span>
      <div className="flex items-center gap-3">
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt="" className="h-14 w-24 rounded-lg object-cover border border-[#e8e6e0]" />
        ) : (
          <div className="h-14 w-24 rounded-lg border border-dashed border-[#d4d2cc] flex items-center justify-center text-[#c9c6bf]">
            <ImageIcon size={16} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-[#e8e6e0] px-2.5 py-1.5 text-[11px] font-semibold text-[#1a1916] hover:bg-[#faf9f6] disabled:opacity-50">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />} {current ? 'Replace' : 'Attach image'}
          </button>
          {current && (
            <button type="button" disabled={busy} onClick={remove}
              className="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-[#b91c1c] hover:bg-[#fef2f2] disabled:opacity-50">Remove</button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => onFile(e.target.files?.[0] ?? undefined)} />
      </div>
      <span className="block text-[10px] text-[#9b9890] mt-1">Shown on the landing page and services cards. Without one, a stock photo is used.</span>
      {err && <span className="block text-[11px] text-[#b91c1c] mt-1">{err}</span>}
    </div>
  );
}

function SectionCard({ step, title, sub, children }: {
  step: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#f0ede8] p-3.5 bg-white">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="w-5 h-5 rounded-full bg-[#f0faf6] text-[#1a7a5a] text-[11px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step}</span>
        <div>
          <p className="text-[13px] font-bold text-[#1a1916] leading-tight">{title}</p>
          {sub && <p className="text-[11px] text-[#9b9890] mt-0.5 leading-snug">{sub}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 overflow-y-auto"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-white rounded-2xl border border-[#e8e6e0] shadow-xl w-full ${wide ? 'max-w-xl' : 'max-w-md'} my-8`}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0ede8]">
          <h3 className="text-sm font-bold text-[#1a1916]">{title}</h3>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916]"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <div className="h-[220px] flex items-center justify-center text-[12px] text-[#9b9890]">{text}</div>;
}

/* ═════════════════════════ Page ═════════════════════════ */
export default function AdminCatalogPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  // Third browser column: the service whose package ladder is shown on-page.
  const [selectedTplId, setSelectedTplId] = useState<number | null>(null);
  // Drag-to-reorder (native HTML5) — replaces numeric position fields.
  const [dragCatId, setDragCatId] = useState<number | null>(null);
  const [dragSvcId, setDragSvcId] = useState<number | null>(null);
  const deepLinkCode = useRef<string | null>(null);

  /* Modals + confirm */
  const [catModal, setCatModal] = useState<{ cat: CatCategory | null } | null>(null);
  const [svcModal, setSvcModal] = useState<{ tpl: Template | null; focus?: 'packages' } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => Promise<void> } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const categories = overview?.categories ?? [];

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) { setLoading(true); setLoadError(null); }
    const [ov, tpl] = await Promise.allSettled([
      apiGet<Overview>('/admin/catalog/overview'),
      apiGet<{ data: Template[] }>('/admin/catalog/templates?includeInactive=1'),
    ]);
    if (ov.status === 'fulfilled' && ov.value && Array.isArray(ov.value.categories)) {
      setOverview(ov.value);
      if (deepLinkCode.current) {
        const hit = ov.value.categories.find(c => c.code === deepLinkCode.current);
        if (hit) setSelectedCatId(hit.id);
        deepLinkCode.current = null;
      }
    } else if (ov.status === 'rejected' && !opts?.silent) {
      setLoadError(ov.reason instanceof Error ? ov.reason.message : 'Could not reach the catalog service.');
    }
    if (tpl.status === 'fulfilled' && Array.isArray(tpl.value?.data)) setTemplates(tpl.value.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Deep-link ?category=<code> — read once on mount.
    try { deepLinkCode.current = new URLSearchParams(window.location.search).get('category'); } catch { /* ignore */ }
    loadAll();
  }, [loadAll]);

  /* ── Derived KPI values ── */
  const activeTemplates = useMemo(() => templates.filter(t => t.isActive), [templates]);
  const pricingMix = useMemo(() => {
    let fixed = 0, hourly = 0, quote = 0;
    for (const t of activeTemplates) {
      if (t.priceUnit === 'quote_after_callout') quote++;
      else if (t.priceUnit === 'per_hour') hourly++;
      else fixed++;
    }
    return { fixed, hourly, quote };
  }, [activeTemplates]);

  const visibleTemplates = useMemo(
    () => (selectedCatId == null ? templates : templates.filter(t => t.categoryId === selectedCatId)),
    [templates, selectedCatId],
  );
  const selectedCat = selectedCatId == null ? null : categories.find(c => c.id === selectedCatId) ?? null;

  /** Persist a new order: renumber 1..n and PATCH only the rows that moved. */
  const persistOrder = async (
    rows: { id: number; sortOrder: number }[],
    pathFor: (id: number) => string,
  ) => {
    const changed = rows.filter((r, i) => r.sortOrder !== i + 1);
    await Promise.all(changed.map((r, ) => apiPatch(pathFor(r.id), { sortOrder: rows.indexOf(r) + 1 })));
  };

  const dropCategory = async (targetId: number) => {
    if (dragCatId == null || dragCatId === targetId) { setDragCatId(null); return; }
    const list = [...categories];
    const from = list.findIndex(c => c.id === dragCatId);
    const to = list.findIndex(c => c.id === targetId);
    if (from < 0 || to < 0) { setDragCatId(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setOverview(prev => prev ? { ...prev, categories: list.map((c, i) => ({ ...c, sortOrder: i + 1 })) } : prev);
    setDragCatId(null);
    try { await persistOrder(list, id => `/admin/catalog/categories/${id}`); } catch { /* order re-syncs on next load */ }
  };

  const dropService = async (targetId: number) => {
    if (dragSvcId == null || dragSvcId === targetId) { setDragSvcId(null); return; }
    const list = [...visibleTemplates];
    const from = list.findIndex(t => t.id === dragSvcId);
    const to = list.findIndex(t => t.id === targetId);
    if (from < 0 || to < 0) { setDragSvcId(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const renumbered = new Map(list.map((t, i) => [t.id, i + 1]));
    setTemplates(prev => prev.map(t => renumbered.has(t.id) ? { ...t, sortOrder: renumbered.get(t.id)! } : t)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id));
    setDragSvcId(null);
    try { await persistOrder(list, id => `/admin/catalog/templates/${id}`); } catch { /* re-syncs on next load */ }
  };

  // No "All categories" view — default the rail to the first category.
  useEffect(() => {
    if (selectedCatId == null && categories.length) setSelectedCatId(categories[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.length]);

  // Switching category clears a packages selection that is no longer visible.
  useEffect(() => {
    setSelectedTplId(prev =>
      prev != null && visibleTemplates.some(t => t.id === prev) ? prev : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCatId]);

  const chartData = useMemo(() =>
    categories.filter(c => c.isActive).map(c => ({
      id: c.id, name: c.nameEn, services: c.activeServiceCount, fromPrice: c.minFromPrice ?? 0,
    })), [categories]);

  /* ── Mutations ── */
  async function toggleTemplateActive(t: Template) {
    const next = !t.isActive;
    setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isActive: next } : x)));
    try {
      await apiPatch(`/admin/catalog/templates/${t.id}`, { isActive: next });
      loadAll({ silent: true });
    } catch {
      setTemplates(prev => prev.map(x => (x.id === t.id ? { ...x, isActive: !next } : x)));
    }
  }

  function applyCommissionResult(res: CommissionResult) {
    setOverview(prev => {
      if (!prev) return prev;
      const byId = new Map(res.categories.map(c => [c.id, c]));
      return {
        ...prev,
        commission: { ...prev.commission, globalBps: res.globalBps },
        categories: prev.categories.map(c => {
          const u = byId.get(c.id);
          return u ? { ...c, commissionBps: u.commissionBps, hasOverride: u.hasOverride } : c;
        }),
      };
    });
  }

  const requestConfirm = (message: string, run: () => Promise<void>) => {
    setConfirmError(null);
    setConfirm({ message, run });
  };

  // Recharts bar click — payload carries our chart row (with category id).
  const handleBarClick = (data: unknown) => {
    const d = data as { payload?: { id?: unknown }; id?: unknown } | null;
    const id = typeof d?.payload?.id === 'number' ? d.payload.id : typeof d?.id === 'number' ? d.id : null;
    if (id != null) setSelectedCatId(id);
  };

  const iconFor = (key: string | null) => ICON_MAP[key ?? ''] ?? Wrench;

  /* ════════ Render ════════ */
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-16">
      {/* 1 — Hero */}
      <div className="pt-6 pb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#2e9f82]">Platform Configuration</p>
        <h1 className="text-xl font-bold text-[#1a1916] mt-1">Service Catalog &amp; Pricing</h1>
        <p className="text-[12.5px] text-[#6b6860] mt-1 max-w-2xl">
          The platform-owned rate card for home services. Providers adopt these services — you own the
          categories, prices, commission and marketplace policies from here.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#f3d9b1] bg-[#fffbeb] px-4 py-2.5 text-[12px] text-[#b45309]">
          <AlertTriangle size={14} />
          <span className="flex-1">Catalog service unavailable ({loadError}). The backend may still be deploying.</span>
          <button onClick={() => loadAll()} className="flex items-center gap-1 font-semibold hover:underline"><RefreshCw size={12} /> Retry</button>
        </div>
      )}
      {loading && (
        <div className="mb-4 flex items-center gap-2 text-[12px] text-[#9b9890]"><Loader2 size={14} className="animate-spin" /> Loading catalog…</div>
      )}

      {/* 2 — KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile icon={Layers} label="Active categories"
          value={overview ? `${categories.filter(c => c.isActive).length}/${categories.length}` : '—'}
          sub="of taxonomy" />
        <KpiTile icon={ListChecks} label="Live services"
          value={overview || templates.length ? String(activeTemplates.length) : '—'}
          sub={`${templates.length} total templates`} />
        <KpiTile icon={Tags} label="Pricing mix"
          value={templates.length ? `${pricingMix.fixed} fixed` : '—'}
          sub={templates.length ? `${pricingMix.hourly} hourly · ${pricingMix.quote} quote` : ''} />
        <KpiTile icon={Percent} label="Default commission"
          value={overview ? fmtBps(overview.commission.globalBps) : '—'}
          sub={`${categories.filter(c => c.hasOverride).length} category overrides`} />
      </div>

      {/* 3 — Main split: Categories → Services → Packages (3-column browser) */}
      <div className="mt-4 grid grid-cols-1 lg:grid-cols-[280px_1fr_300px] gap-4 items-start">
        {/* LEFT: category rail */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          <div className="flex items-center px-4 py-2 border-b border-[#f0ede8]">
            <span className="flex-1 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">Categories</span>
            <button
              onClick={() => setCatModal({ cat: null })}
              className="flex items-center gap-1 rounded-lg bg-[#2e9f82] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90"
            ><Plus size={12} /> New</button>
          </div>
          <ul className="divide-y divide-[#f0ede8]">
            {categories.map(cat => {
              const Icon = iconFor(cat.iconKey);
              const selected = selectedCatId === cat.id;
              return (
                <li key={cat.id} className={cat.isActive ? '' : 'opacity-55'}>
                  <div
                    draggable
                    onDragStart={() => setDragCatId(cat.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropCategory(cat.id)}
                    onDragEnd={() => setDragCatId(null)}
                    className={`group flex items-center gap-1.5 px-3 py-2.5 cursor-grab active:cursor-grabbing ${selected ? 'bg-[#f0faf6]' : 'hover:bg-[#faf9f6]'} ${dragCatId === cat.id ? 'opacity-40' : ''}`}
                  >
                    <GripVertical size={13} className="text-[#d5d2cb] flex-shrink-0" />
                    <button onClick={() => setSelectedCatId(cat.id)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
                      {cat.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cat.imageUrl} alt="" className="h-5 w-5 rounded object-cover flex-shrink-0" />
                      ) : (
                        <Icon size={15} style={{ color: selected ? GREEN : '#9b9890' }} />
                      )}
                      <span className={`truncate text-[13px] ${selected ? 'font-semibold text-[#1a7a5a]' : 'text-[#1a1916]'}`}>{cat.nameEn}</span>
                    </button>
                    {!cat.isActive && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#f5f4f0] text-[#9b9890]">Off</span>}
                    <span className="text-[11px] text-[#9b9890] tabular-nums">{cat.activeServiceCount}</span>
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#f5f4f0] text-[#6b6860]">
                      {cat.hasOverride && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: AMBER }} />}
                      {fmtBps(cat.commissionBps)}
                    </span>
                    <button
                      onClick={() => setCatModal({ cat })}
                      className="text-[#c9c6bf] hover:text-[#1a1916] opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Edit category"
                    ><Pencil size={13} /></button>
                  </div>
                </li>
              );
            })}
            {!loading && categories.length === 0 && (
              <li className="px-4 py-6 text-center text-[12px] text-[#9b9890]">No categories yet.</li>
            )}
          </ul>
        </div>

        {/* RIGHT: services panel */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f0ede8]">
            <h3 className="font-semibold text-[13px] flex-1 text-[#1a1916]">
              {selectedCat ? `${selectedCat.nameEn} services` : 'All services'}
              <span className="ml-2 text-[11px] font-normal text-[#9b9890]">{visibleTemplates.length}</span>
            </h3>
            <button
              onClick={() => setSvcModal({ tpl: null })}
              className="flex items-center gap-1 rounded-lg bg-[#2e9f82] px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
            ><Plus size={13} /> Add service</button>
          </div>
          {visibleTemplates.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-[#9b9890]">
              {loading ? 'Loading…' : 'No services here yet. Add the first one — providers will adopt it at your price.'}
            </p>
          ) : (
            <ul className="divide-y divide-[#f0ede8]">
              {visibleTemplates.map(t => {
                const pill = pricePill(t);
                const cat = categories.find(c => c.id === t.categoryId);
                const tplSelected = selectedTplId === t.id;
                return (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={() => setDragSvcId(t.id)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => dropService(t.id)}
                    onDragEnd={() => setDragSvcId(null)}
                    className={`flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing ${t.isActive ? '' : 'opacity-55'} ${tplSelected ? 'bg-[#f0faf6]' : ''} ${dragSvcId === t.id ? 'opacity-40' : ''}`}
                  >
                    <GripVertical size={13} className="text-[#d5d2cb] flex-shrink-0" />
                    {t.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.imageUrl} alt="" className="h-8 w-11 rounded-md object-cover border border-[#f0ede8] flex-shrink-0" />
                    )}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setSelectedTplId(tplSelected ? null : t.id)}
                      title="Show packages"
                    >
                      <p className="text-[13px] font-semibold text-[#1a1916] truncate">
                        {t.name}
                        {t.nameAr && <span className="ml-2 text-[11px] font-normal text-[#9b9890]" dir="rtl">{t.nameAr}</span>}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {selectedCatId == null && (
                          <span className="text-[10px] text-[#9b9890]">{cat?.nameEn ?? t.categoryCode}</span>
                        )}
                        {t.isEmergency && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border border-[#dc2626] text-[#dc2626]">Emergency</span>
                        )}
                        {t.cancellationPolicy?.cancel && (
                          <Chip c={AMBER}>Own cancellation terms</Chip>
                        )}
                        {t.minCalloutCharge != null && t.minCalloutCharge > 0 && (
                          <Chip c={BLUE}>Callout {fmtAED(t.minCalloutCharge)}</Chip>
                        )}
                        {t.adoptionCount > 0 && <Chip c={'#6b6860'}>{t.adoptionCount} provider{t.adoptionCount === 1 ? '' : 's'}</Chip>}
                        {t.quantityLabel && <Chip c={'#3b6fb5'}>Asks: {t.quantityLabel}</Chip>}
                        {(t.addons?.filter(a => a.isActive).length ?? 0) > 0 && (
                          <Chip c={'#3b6fb5'}>+{t.addons!.filter(a => a.isActive).length} extra{t.addons!.filter(a => a.isActive).length === 1 ? '' : 's'}</Chip>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-[#9b9890] tabular-nums w-14 text-right shrink-0">
                      {templateDuration(t)}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0"
                      style={pill.tone === 'amber'
                        ? { backgroundColor: '#fffbeb', color: '#b45309' }
                        : pill.tone === 'green'
                          ? { backgroundColor: '#f0faf6', color: '#1a7a5a' }
                          : { backgroundColor: '#f5f4f0', color: '#9b9890' }}
                    >{pill.text}</span>
                    <Toggle on={t.isActive} onChange={() => toggleTemplateActive(t)} />
                    <button
                      onClick={() => setSvcModal({ tpl: t })}
                      className="text-[11px] font-semibold text-[#6b6860] hover:text-[#1a1916] shrink-0"
                    >Edit</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* THIRD COLUMN: package ladder of the selected service */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          {(() => {
            const tpl = templates.find(t => t.id === selectedTplId) ?? null;
            const pkgs = (tpl?.variants ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
            return (
              <>
                <div className="px-4 py-2.5 border-b border-[#f0ede8]">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[13px] flex-1 text-[#1a1916] truncate">
                      {tpl ? (tpl.variantGroupLabel || 'Packages') : 'Packages'}
                    </h3>
                    {tpl && (
                      <button
                        onClick={() => setSvcModal({ tpl, focus: 'packages' })}
                        className="text-[11px] font-semibold text-[#2e9f82] hover:opacity-80 shrink-0"
                      >Edit</button>
                    )}
                  </div>
                  {tpl && (
                    <>
                      <p className="text-[10px] text-[#9b9890] mt-0.5 truncate">
                        {categories.find(c => c.id === tpl.categoryId)?.nameEn ?? tpl.categoryCode} → {tpl.name}
                      </p>
                      <p className="text-[11px] text-[#1a1916] mt-1.5">
                        {tpl.priceUnit === 'quote_after_callout'
                          ? 'Free quote — priced after the visit'
                          : tpl.priceUnit === 'per_hour'
                            ? `AED ${tpl.basePrice ?? '—'} per hour`
                            : `${tpl.isFromPrice ? 'From ' : ''}AED ${tpl.basePrice ?? '—'}`}
                        {templateDuration(tpl) !== '—' && (
                          <span className="text-[#9b9890]"> · {templateDuration(tpl)}</span>
                        )}
                      </p>
                    </>
                  )}
                </div>
                {!tpl ? (
                  <p className="px-4 py-10 text-center text-[12px] text-[#9b9890]">
                    Select a service to see its package ladder.
                  </p>
                ) : pkgs.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[12px] text-[#9b9890]">
                      {tpl.priceUnit === 'quote_after_callout'
                        ? 'Priced by quote — free-quote services don\u2019t use packages.'
                        : `Single price — ${tpl.basePrice != null ? fmtAED(tpl.basePrice) : '—'}, no packages.`}
                    </p>
                    {tpl.priceUnit !== 'quote_after_callout' && (
                      <button
                        onClick={() => setSvcModal({ tpl, focus: 'packages' })}
                        className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#2e9f82] hover:opacity-80"
                      ><Plus size={13} /> Add packages</button>
                    )}
                  </div>
                ) : (
                  <>
                    <ul className="divide-y divide-[#f0ede8]">
                      {pkgs.map(v => (
                        <li key={v.id} className={`flex items-center gap-2.5 px-4 py-2.5 ${v.isActive ? '' : 'opacity-55'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] text-[#1a1916] truncate">{v.name}</p>
                            {(v.estimatedDuration || v.estimatedDurationMax) && (
                              <p className="text-[10px] text-[#9b9890] mt-0.5">
                                {fmtDuration(v.estimatedDuration, v.estimatedDurationMax)}
                              </p>
                            )}
                          </div>
                          {!v.isActive && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-[#f5f4f0] text-[#9b9890]">Off</span>
                          )}
                          <span className="text-[12px] font-semibold text-[#1a1916] tabular-nums whitespace-nowrap">
                            {fmtAED(v.basePrice)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="px-4 py-2 border-t border-[#f0ede8] text-[10px] text-[#9b9890]">
                      From-price auto-tracks the cheapest active package · edit rows via Edit
                    </p>
                  </>
                )}
                {tpl && (tpl.quantityLabel || (tpl.addons?.length ?? 0) > 0) && (
                  <div className="border-t border-[#f0ede8]">
                    <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">Booking options</div>
                    {tpl.quantityLabel && (
                      <p className="px-4 pb-1.5 text-[12px] text-[#1a1916]">
                        {tpl.quantityLabel}: {tpl.quantityMin ?? 1}–{tpl.quantityMax ?? '∞'}
                      </p>
                    )}
                    <ul>
                      {(tpl.addons ?? []).map(a => (
                        <li key={a.id} className={`flex items-center justify-between px-4 py-1.5 text-[12px] ${a.isActive ? '' : 'opacity-55'}`}>
                          <span className="truncate text-[#1a1916]">{a.name}</span>
                          <span className="font-semibold tabular-nums text-[#1a1916]">+{fmtAED(a.price)}{a.priceUnit === 'per_hour' ? '/hr' : ''}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="pb-2" />
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* 4 — Chart card */}
      <div className="mt-4 bg-white rounded-2xl border border-[#e8e6e0] p-4">
        <h3 className="text-sm font-bold text-[#1a1916]">Catalog shape by category</h3>
        <p className="text-[11px] text-[#9b9890] mt-0.5">Active services per category (green) and cheapest &lsquo;from&rsquo; price (blue). Click a bar to filter.</p>
        {chartData.length === 0 ? (
          <EmptyChart text="No active categories to chart yet." />
        ) : (
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 26 + 30)}>
              <ComposedChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" horizontal={false} />
                <XAxis xAxisId="count" type="number" allowDecimals={false} tick={{ fontSize: 10, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                <XAxis xAxisId="price" type="number" orientation="top" hide />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: '#9b9890' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v, name) => {
                    const label = String(name);
                    if (label === 'From price') return [typeof v === 'number' && v > 0 ? fmtAED(v) : '—', label];
                    return [v as number, label];
                  }}
                />
                <Bar xAxisId="count" dataKey="services" name="Active services" barSize={12} radius={[0, 4, 4, 0]}
                  cursor="pointer" onClick={handleBarClick}>
                  {chartData.map(d => (
                    <Cell key={d.id} fill={selectedCatId === d.id ? '#1a7a5a' : GREEN} />
                  ))}
                </Bar>
                <Bar xAxisId="price" dataKey="fromPrice" name="From price" barSize={4} radius={[0, 2, 2, 0]} fill={BLUE} fillOpacity={0.55}
                  cursor="pointer" onClick={handleBarClick} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* 5 — Platform defaults */}
      <h2 className="mt-8 mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#9b9890]">Platform defaults · root configuration</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <CommissionCard
          overview={overview}
          onConfirm={requestConfirm}
          applyResult={applyCommissionResult}
        />
        <VatCard overview={overview} onConfirm={requestConfirm} setOverview={setOverview} />
        <LaunchCancellationCard overview={overview} onConfirm={requestConfirm} setOverview={setOverview} />
      </div>

      {/* ── Modals ── */}
      {catModal && (
        <CategoryModal
          cat={catModal.cat}
          nextSortOrder={categories.length ? Math.max(...categories.map(c => c.sortOrder)) + 1 : 1}
          onClose={() => setCatModal(null)}
          onSaved={() => { setCatModal(null); loadAll({ silent: true }); }}
          onRefetch={() => loadAll({ silent: true })}
        />
      )}
      {svcModal && (
        <ServiceModal
          tpl={svcModal.tpl}
          focus={svcModal.focus}
          categories={categories}
          defaultCategoryId={selectedCatId}
          nextSortOrder={Math.max(0, ...templates.filter(t => t.categoryId === (svcModal.tpl?.categoryId ?? selectedCatId)).map(t => t.sortOrder)) + 1}
          onClose={() => setSvcModal(null)}
          onSaved={() => { setSvcModal(null); loadAll({ silent: true }); }}
          onRefetch={() => loadAll({ silent: true })}
        />
      )}
      {confirm && (
        <Modal title="Please confirm" onClose={() => { if (!confirmBusy) setConfirm(null); }}>
          <p className="text-[13px] text-[#1a1916]">{confirm.message}</p>
          {confirmError && <p className="mt-2 text-[12px] text-[#b91c1c]">{confirmError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button disabled={confirmBusy} onClick={() => setConfirm(null)}
              className="rounded-lg border border-[#e8e6e0] px-3 py-1.5 text-[12px] font-semibold text-[#6b6860] hover:bg-[#faf9f6]">Cancel</button>
            <button
              disabled={confirmBusy}
              onClick={async () => {
                setConfirmBusy(true); setConfirmError(null);
                try { await confirm.run(); setConfirm(null); }
                catch (e) { setConfirmError(e instanceof Error ? e.message : 'Something went wrong.'); }
                finally { setConfirmBusy(false); }
              }}
              className="flex items-center gap-1.5 rounded-lg bg-[#2e9f82] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >{confirmBusy && <Loader2 size={12} className="animate-spin" />} Confirm</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ═════════════════════════ Platform-defaults cards ═════════════════════════ */

function CommissionCard({ overview, onConfirm, applyResult }: {
  overview: Overview | null;
  onConfirm: (message: string, run: () => Promise<void>) => void;
  applyResult: (res: CommissionResult) => void;
}) {
  const [globalPct, setGlobalPct] = useState('');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editPct, setEditPct] = useState('');

  useEffect(() => {
    if (overview) setGlobalPct((overview.commission.globalBps / 100).toFixed(1));
  }, [overview?.commission.globalBps]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseBps = (pct: string): number | null => {
    const n = parseFloat(pct);
    if (!isFinite(n) || n < 0 || n > 50) return null;
    return Math.round(n * 100);
  };

  const saveCommission = (categoryId: number | null, bps: number, label: string) => {
    onConfirm(
      `Set ${label} commission to ${fmtBps(bps)}? Applies to new bookings from now; versioned in fee_config.`,
      async () => {
        const res = await apiPatch<CommissionResult>('/admin/catalog/commission', { categoryId, bps });
        applyResult(res);
        setEditingCatId(null);
      },
    );
  };
  const removeOverride = (cat: CatCategory) => {
    onConfirm(
      `Remove the ${cat.nameEn} override and fall back to the global default? Applies to new bookings from now; versioned in fee_config.`,
      async () => {
        const res = await apiDelete<CommissionResult>(`/admin/catalog/commission/${cat.id}`);
        applyResult(res);
      },
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f0ede8]">
        <BadgePercent size={14} style={{ color: GREEN }} />
        <h3 className="font-semibold text-[13px] text-[#1a1916]">Commission</h3>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] text-[#9b9890]">Global default — platform take on every booking. Super-admin only.</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number" step="0.1" min={0} max={50} value={globalPct}
            onChange={e => setGlobalPct(e.target.value)}
            className={`${inputCls} !w-24 text-right`} disabled={!overview}
          />
          <span className="text-[13px] text-[#6b6860]">%</span>
          <button
            disabled={!overview || parseBps(globalPct) == null || parseBps(globalPct) === overview.commission.globalBps}
            onClick={() => { const bps = parseBps(globalPct); if (bps != null) saveCommission(null, bps, 'the global default'); }}
            className="rounded-lg bg-[#2e9f82] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >Save</button>
        </div>
        {globalPct !== '' && parseBps(globalPct) == null && (
          <p className="mt-1 text-[11px] text-[#b91c1c]">Enter a rate between 0% and 50%.</p>
        )}
      </div>
      <div className="border-t border-[#f0ede8]">
        <p className="px-4 pt-2.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">Per-category overrides</p>
        {!overview || overview.categories.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-[#9b9890]">No categories loaded.</p>
        ) : (
          <ul className="divide-y divide-[#f0ede8] mt-1">
            {overview.categories.map(cat => (
              <li key={cat.id} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1 text-[12.5px] text-[#1a1916] truncate">{cat.nameEn}</span>
                {editingCatId === cat.id ? (
                  <>
                    <input
                      type="number" step="0.1" min={0} max={50} value={editPct} autoFocus
                      onChange={e => setEditPct(e.target.value)}
                      className={`${inputCls} !w-20 text-right !py-1`}
                    />
                    <button
                      disabled={parseBps(editPct) == null}
                      onClick={() => { const bps = parseBps(editPct); if (bps != null) saveCommission(cat.id, bps, cat.nameEn); }}
                      className="text-[11px] font-semibold text-[#2e9f82] hover:underline disabled:opacity-40"
                    >Save</button>
                    <button onClick={() => setEditingCatId(null)} className="text-[11px] text-[#9b9890] hover:text-[#1a1916]">Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="text-[12px] font-semibold tabular-nums text-[#1a1916]">{fmtBps(cat.commissionBps)}</span>
                    {cat.hasOverride && <Chip c={AMBER}>override</Chip>}
                    <button
                      onClick={() => { setEditingCatId(cat.id); setEditPct((cat.commissionBps / 100).toFixed(1)); }}
                      className="text-[11px] font-semibold text-[#6b6860] hover:text-[#1a1916]"
                    >{cat.hasOverride ? 'Edit' : 'Set'}</button>
                    {cat.hasOverride && (
                      <button onClick={() => removeOverride(cat)} title="Remove override"
                        className="text-[#c9c6bf] hover:text-[#b91c1c]"><X size={13} /></button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VatCard({ overview, onConfirm, setOverview }: {
  overview: Overview | null;
  onConfirm: (message: string, run: () => Promise<void>) => void;
  setOverview: React.Dispatch<React.SetStateAction<Overview | null>>;
}) {
  const mode = overview?.policies?.vat_display_mode ?? 'inclusive';

  const changeMode = (next: string) => {
    if (next === mode) return;
    onConfirm(
      `Switch price display to VAT-${next}? This changes how every service price is presented to customers.`,
      async () => {
        const policies = await apiPatch<Policies>('/admin/catalog/policies', { key: 'vat_display_mode', value: next });
        setOverview(prev => (prev ? { ...prev, policies } : prev));
      },
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f0ede8]">
        <Landmark size={14} style={{ color: BLUE }} />
        <h3 className="font-semibold text-[13px] text-[#1a1916]">VAT &amp; display</h3>
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] text-[#6b6860]">VAT rate</span>
          <span className="text-[13px] font-bold text-[#1a1916]">{overview ? fmtBps(overview.vat.rateBps) : '—'}</span>
        </div>
        <Field label="Price display mode">
          <select value={mode} disabled={!overview} onChange={e => changeMode(e.target.value)} className={inputCls}>
            <option value="inclusive">VAT-inclusive (customer sees final price)</option>
            <option value="net">Net + VAT shown separately</option>
          </select>
        </Field>
        <p className="text-[11px] text-[#9b9890] leading-relaxed rounded-lg bg-[#faf9f6] border border-[#f0ede8] px-2.5 py-2">
          UAE B2C norm is VAT-inclusive display — pending CEO ratification (D-D).
        </p>
      </div>
    </div>
  );
}

function LaunchCancellationCard({ overview, onConfirm, setOverview }: {
  overview: Overview | null;
  onConfirm: (message: string, run: () => Promise<void>) => void;
  setOverview: React.Dispatch<React.SetStateAction<Overview | null>>;
}) {
  const [launch, setLaunch] = useState<SpLaunch>({ emirates: ['dubai'], inviteOnly: true });
  const [cancel, setCancel] = useState<CancellationPolicy | null>(null);

  // Re-sync drafts whenever server policies change identity (initial load / after save).
  useEffect(() => {
    const p = overview?.policies;
    if (!p) return;
    if (p.sp_launch && Array.isArray(p.sp_launch.emirates)) setLaunch({ emirates: p.sp_launch.emirates, inviteOnly: !!p.sp_launch.inviteOnly });
    if (p.cancellation_policy && Array.isArray(p.cancellation_policy.reschedule)) setCancel(p.cancellation_policy);
  }, [overview?.policies]);

  const serverLaunch = overview?.policies?.sp_launch;
  const serverCancel = overview?.policies?.cancellation_policy;
  const launchDirty = !!serverLaunch && JSON.stringify(serverLaunch) !== JSON.stringify(launch);
  const cancelDirty = !!serverCancel && !!cancel && JSON.stringify(serverCancel) !== JSON.stringify(cancel);
  const dirty = launchDirty || cancelDirty || (!serverLaunch && !!overview);

  const toggleEmirate = (v: string) =>
    setLaunch(prev => ({
      ...prev,
      emirates: prev.emirates.includes(v) ? prev.emirates.filter(e => e !== v) : [...prev.emirates, v],
    }));

  // Tiers are kept furthest-first; the server validates windows/fees on save (SP-135).
  const sortTiers = (tiers: CancelTier[]) => [...tiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  const setTier = (kind: 'reschedule' | 'cancel', idx: number, patch: Partial<CancelTier>) =>
    setCancel(prev => prev
      ? { ...prev, [kind]: prev[kind].map((t, i) => (i === idx ? { ...t, ...patch } : t)) }
      : prev);
  const commitTierOrder = (kind: 'reschedule' | 'cancel') =>
    setCancel(prev => (prev ? { ...prev, [kind]: sortTiers(prev[kind]) } : prev));
  const addTier = (kind: 'reschedule' | 'cancel') =>
    setCancel(prev => {
      if (!prev) return prev;
      const top = prev[kind][0]?.minHoursBefore ?? 0;
      return { ...prev, [kind]: [{ minHoursBefore: top + 24, feePct: 0 }, ...prev[kind]] };
    });
  const removeTier = (kind: 'reschedule' | 'cancel', idx: number) =>
    setCancel(prev => (prev && prev[kind].length > 1 ? { ...prev, [kind]: prev[kind].filter((_, i) => i !== idx) } : prev));

  const save = () => {
    onConfirm(
      'Save launch scope and cancellation policy? Providers and booking flows pick these up immediately.',
      async () => {
        let policies: Policies | null = null;
        if (launchDirty || !serverLaunch) {
          policies = await apiPatch<Policies>('/admin/catalog/policies', { key: 'sp_launch', value: launch });
        }
        if (cancel && (cancelDirty || !serverCancel)) {
          policies = await apiPatch<Policies>('/admin/catalog/policies', { key: 'cancellation_policy', value: cancel });
        }
        if (policies) {
          const finalPolicies = policies;
          setOverview(prev => (prev ? { ...prev, policies: finalPolicies } : prev));
        }
      },
    );
  };

  const miniTable = (kind: 'reschedule' | 'cancel', title: string) => {
    const tiers = cancel?.[kind] ?? [];
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{title}</p>
          <button
            type="button" onClick={() => addTier(kind)} disabled={!overview}
            className="text-[11px] font-semibold text-[#2e9f82] hover:underline disabled:opacity-40"
          >+ tier</button>
        </div>
        {tiers.length === 0 ? (
          <p className="text-[11px] text-[#9b9890]">—</p>
        ) : (
          <ul className="space-y-1">
            {tiers.map((t, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12px] text-[#1a1916]">
                <input
                  type="number" min={0} max={720} value={t.minHoursBefore} aria-label="Hours before the slot"
                  onChange={e => setTier(kind, i, { minHoursBefore: Math.max(0, Math.min(720, Math.round(Number(e.target.value) || 0))) })}
                  onBlur={() => commitTierOrder(kind)}
                  className={`${inputCls} !w-14 text-right !py-0.5`}
                />
                <span className="text-[#9b9890] text-[11px]">h</span>
                <span className="flex-1 text-[#6b6860] text-[11px] truncate">{tierLabel(tiers, i)}</span>
                <input
                  type="number" min={0} max={100} value={t.feePct} aria-label="Fee percent"
                  onChange={e => setTier(kind, i, { feePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  className={`${inputCls} !w-16 text-right !py-0.5`}
                />
                <span className="text-[#9b9890]">%</span>
                <button
                  type="button" onClick={() => removeTier(kind, i)} disabled={tiers.length <= 1}
                  className="text-[#9b9890] hover:text-[#c0392b] disabled:opacity-30 px-1" aria-label="Remove tier"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#f0ede8]">
        <Rocket size={14} style={{ color: AMBER }} />
        <h3 className="font-semibold text-[13px] text-[#1a1916]">Launch &amp; cancellation</h3>
      </div>
      <div className="px-4 py-3 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold mb-1.5">Live emirates</p>
          <div className="flex flex-wrap gap-1.5">
            {EMIRATES.map(e => {
              const on = launch.emirates.includes(e.value);
              return (
                <button
                  key={e.value} onClick={() => toggleEmirate(e.value)} disabled={!overview}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-40"
                  style={on
                    ? { backgroundColor: GREEN, borderColor: GREEN, color: '#fff' }
                    : { backgroundColor: '#fff', borderColor: '#e8e6e0', color: '#6b6860' }}
                >{e.label}</button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <Toggle on={launch.inviteOnly} disabled={!overview} onChange={() => setLaunch(p => ({ ...p, inviteOnly: !p.inviteOnly }))} />
            <span className="text-[12px] text-[#1a1916]">Invite-only provider onboarding</span>
          </div>
        </div>

        {cancel ? (
          <div className="space-y-3 border-t border-[#f0ede8] pt-3">
            {miniTable('reschedule', 'Reschedule fees')}
            {miniTable('cancel', 'Cancellation fees')}
            <div className="flex items-center gap-2 text-[12px] text-[#1a1916]">
              <span className="flex-1 text-[#6b6860]">Customer no-show fee</span>
              <input
                type="number" min={0} max={100} value={cancel.noShowFeePct}
                onChange={e => setCancel(p => (p ? { ...p, noShowFeePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : p))}
                className={`${inputCls} !w-16 text-right !py-0.5`}
              />
              <span className="text-[#9b9890]">%</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#1a1916]">
              <span className="flex-1 text-[#6b6860]" title="How long past the booked time before either side may record a no-show">No-show grace</span>
              <input
                type="number" min={0} max={240} value={cancel.noShowGraceMinutes ?? 30}
                onChange={e => setCancel(p => (p ? { ...p, noShowGraceMinutes: Math.max(0, Math.min(240, Math.round(Number(e.target.value) || 0))) } : p))}
                className={`${inputCls} !w-16 text-right !py-0.5`}
              />
              <span className="text-[#9b9890]">min</span>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[#1a1916]">
              <span className="flex-1 text-[#6b6860]" title="Who keeps a retained cancellation / no-show fee (CEO decision 8 — Urban Company passes it to the partner)">Retained fee goes to</span>
              <div className="inline-flex rounded-lg border border-[#e8e6e0] overflow-hidden">
                {(['provider', 'platform'] as const).map(who => {
                  const on = (cancel.retainedFeeTo ?? 'provider') === who;
                  return (
                    <button
                      key={who} type="button" onClick={() => setCancel(p => (p ? { ...p, retainedFeeTo: who } : p))}
                      className="px-2.5 py-0.5 text-[11px] font-semibold capitalize"
                      style={on ? { backgroundColor: GREEN, color: '#fff' } : { backgroundColor: '#fff', color: '#6b6860' }}
                    >{who}</button>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] text-[#9b9890]">
              A service can override any of these on its own row (Services → edit → Cancellation). Bookings keep the terms they were made under.
            </p>
            {cancel.note && <p className="text-[10px] text-[#9b9890] italic">{cancel.note}</p>}
          </div>
        ) : (
          <p className="text-[11px] text-[#9b9890] border-t border-[#f0ede8] pt-3">Cancellation policy not loaded yet.</p>
        )}

        <button
          onClick={save} disabled={!overview || !dirty}
          className="w-full rounded-lg bg-[#2e9f82] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >Save launch &amp; cancellation</button>
      </div>
    </div>
  );
}

/* ═════════════════════════ Category modal ═════════════════════════ */

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function CategoryModal({ cat, nextSortOrder, onClose, onSaved, onRefetch }: {
  cat: CatCategory | null; nextSortOrder: number; onClose: () => void; onSaved: () => void; onRefetch: () => void;
}) {
  const isNew = cat == null;
  const [nameEn, setNameEn] = useState(cat?.nameEn ?? '');
  const [nameAr, setNameAr] = useState(cat?.nameAr ?? '');
  const [code, setCode] = useState(cat?.code ?? '');
  const [codeTouched, setCodeTouched] = useState(!isNew);
  const [iconKey, setIconKey] = useState(cat?.iconKey ?? 'sparkles');
  const [sortOrder, setSortOrder] = useState(String(cat?.sortOrder ?? nextSortOrder));
  const [isActive, setIsActive] = useState(cat?.isActive ?? true);
  const [imageUrl, setImageUrl] = useState<string | null>(cat?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!nameEn.trim()) { setError('English name is required.'); return; }
    if (isNew && !code.trim()) { setError('Code is required.'); return; }
    setBusy(true); setError(null);
    try {
      if (isNew) {
        await apiPost('/admin/catalog/categories', {
          code: code.trim(), nameEn: nameEn.trim(), nameAr: nameAr.trim() || undefined,
          iconKey, sortOrder: Number(sortOrder) || nextSortOrder,
        });
      } else {
        await apiPatch(`/admin/catalog/categories/${cat.id}`, {
          nameEn: nameEn.trim(), nameAr: nameAr.trim() || null,
          iconKey, isActive,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'New category' : `Edit — ${cat.nameEn}`} onClose={onClose}>
      <div className="space-y-3">
        <ImageAttach
          label="Cover image (optional)"
          current={imageUrl}
          uploadPath={isNew ? null : `/admin/catalog/categories/${cat.id}/image`}
          clearPath={isNew ? '' : `/admin/catalog/categories/${cat.id}/image`}
          onChanged={(url) => { setImageUrl(url); onRefetch(); }}
          newHint="Create the category first — then reopen it to attach an image."
        />
        <Field label="Category name *" hint="Shown to customers — e.g. Home Cleaning, Pest Control.">
          <input className={inputCls} value={nameEn} placeholder="e.g. Appliance Repair"
            onChange={e => { setNameEn(e.target.value); if (isNew && !codeTouched) setCode(slugify(e.target.value)); }} />
        </Field>
        <Field label="Arabic name (optional)">
          <input className={inputCls} dir="rtl" value={nameAr} onChange={e => setNameAr(e.target.value)} />
        </Field>
        {isNew && (
          <Field label="System ID" hint="Created automatically from the name — fine to leave as is.">
            <input className={inputCls} value={code} onChange={e => { setCode(e.target.value); setCodeTouched(true); }} />
          </Field>
        )}
        <Field label="Icon" hint="Shown on the public services page. Reorder categories by dragging them in the list.">
          <select className={inputCls} value={iconKey} onChange={e => setIconKey(e.target.value)}>
            {(ICON_KEYS.includes(iconKey) ? ICON_KEYS : [iconKey, ...ICON_KEYS]).map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </Field>
        {!isNew && (
          <div className="flex items-center gap-2">
            <Toggle on={isActive} onChange={() => setIsActive(v => !v)} />
            <span className="text-[12px] text-[#1a1916]">Category is active (visible to providers &amp; customers)</span>
          </div>
        )}
        {error && <p className="text-[12px] text-[#b91c1c]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button disabled={busy} onClick={onClose}
            className="rounded-lg border border-[#e8e6e0] px-3 py-1.5 text-[12px] font-semibold text-[#6b6860] hover:bg-[#faf9f6]">Cancel</button>
          <button disabled={busy} onClick={save}
            className="flex items-center gap-1.5 rounded-lg bg-[#2e9f82] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />} {isNew ? 'Create category' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════ Capability requirements (SP-248) ═════════════════════════ */

interface CapabilityRequirement {
  id: number; templateId: number; key: string; label: string; description: string | null;
  requirementType: 'equipment' | 'material' | 'certification' | 'consumable';
  isMandatory: boolean; evidenceRequired: boolean; sortOrder: number; isActive: boolean;
}
const REQ_TYPES: { v: CapabilityRequirement['requirementType']; label: string }[] = [
  { v: 'equipment', label: 'Equipment' }, { v: 'material', label: 'Material' }, { v: 'consumable', label: 'Consumable' }, { v: 'certification', label: 'Certification' },
];

/**
 * What a service NEEDS to be delivered — tools, materials, certifications.
 * Providers declare against this list on My Services; admins verify it in the
 * approval drawer. Self-managing so it can sit inside the service editor.
 */
function RequirementsEditor({ templateId }: { templateId: number }) {
  const [rows, setRows] = useState<CapabilityRequirement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<CapabilityRequirement['requirementType']>('equipment');
  const [newMandatory, setNewMandatory] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const load = () => apiGet<CapabilityRequirement[]>(`/admin/catalog/templates/${templateId}/requirements`).then(setRows).catch(e => setError(e instanceof Error ? e.message : 'Could not load requirements'));
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const wrap = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };
  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    void wrap(async () => {
      await apiPost(`/admin/catalog/templates/${templateId}/requirements`, { label, requirementType: newType, isMandatory: newMandatory });
      setNewLabel('');
    });
  };
  const patch = (id: number, body: Partial<CapabilityRequirement>) => void wrap(() => apiPatch(`/admin/catalog/requirements/${id}`, body));
  const remove = (r: CapabilityRequirement) => {
    if (!confirm(`Remove "${r.label}" from this service's checklist? (It is only deactivated if providers have already declared against it.)`)) return;
    void wrap(() => apiDelete(`/admin/catalog/requirements/${r.id}`));
  };

  const visible = (rows ?? []).filter(r => showInactive || r.isActive);
  const inactiveCount = (rows ?? []).filter(r => !r.isActive).length;
  return (
    <SectionCard step="✦" title="What this service needs" sub="Tools, materials and certifications the provider must have. Providers tick these on My Services; you verify them at approval.">
      {rows === null ? (
        <p className="text-[11px] text-[#9b9890]">Loading…</p>
      ) : (
        <>
          {visible.length === 0 && <p className="text-[11px] text-[#9b9890]">No requirements yet — add the first one below.</p>}
          <ul className="space-y-1">
            {visible.map(r => (
              <li key={r.id} className="flex items-center gap-1.5 text-[12px] text-[#1a1916]" style={{ opacity: r.isActive ? 1 : 0.5 }}>
                <input value={r.label} disabled={busy} aria-label="Requirement label"
                  onChange={e => setRows(prev => prev ? prev.map(x => x.id === r.id ? { ...x, label: e.target.value } : x) : prev)}
                  onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== r.label) patch(r.id, { label: e.target.value.trim() }); }}
                  className={`${inputCls} flex-1 !py-0.5`} />
                <select value={r.requirementType} disabled={busy} onChange={e => patch(r.id, { requirementType: e.target.value as CapabilityRequirement['requirementType'] })}
                  className={`${inputCls} !w-auto !py-0.5`}>
                  {REQ_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                <button type="button" disabled={busy} onClick={() => patch(r.id, { isMandatory: !r.isMandatory })}
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                  title={r.isMandatory ? 'Mandatory — click to make optional' : 'Optional — click to make mandatory'}
                  style={r.isMandatory ? { backgroundColor: '#fef2f2', color: '#b91c1c' } : { backgroundColor: '#f4f3ef', color: '#6b6860' }}>
                  {r.isMandatory ? 'Mandatory' : 'Optional'}
                </button>
                {r.isActive ? (
                  <button type="button" disabled={busy} onClick={() => remove(r)} className="text-[#9b9890] hover:text-[#c0392b] px-1" aria-label="Remove requirement">×</button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => patch(r.id, { isActive: true })} className="text-[10px] font-semibold text-[#2e9f82]">restore</button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1.5 mt-2 text-[12px]">
            <input value={newLabel} disabled={busy} placeholder="Add a requirement, e.g. Vacuum cleaner"
              onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
              className={`${inputCls} flex-1 !py-0.5`} />
            <select value={newType} disabled={busy} onChange={e => setNewType(e.target.value as CapabilityRequirement['requirementType'])} className={`${inputCls} !w-auto !py-0.5`}>
              {REQ_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-[#6b6860]"><input type="checkbox" checked={newMandatory} onChange={e => setNewMandatory(e.target.checked)} /> mandatory</label>
            <button type="button" disabled={busy || !newLabel.trim()} onClick={add}
              className="rounded-lg bg-[#2e9f82] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Add</button>
          </div>
          {inactiveCount > 0 && (
            <button type="button" onClick={() => setShowInactive(v => !v)} className="mt-1.5 text-[10.5px] text-[#9b9890] hover:underline">
              {showInactive ? 'Hide' : 'Show'} {inactiveCount} retired
            </button>
          )}
          {error && <p className="mt-1 text-[11px] text-[#b91c1c]">{error}</p>}
        </>
      )}
    </SectionCard>
  );
}

/* ═════════════════════════ Service modal ═════════════════════════ */

function ServiceModal({ tpl, focus, categories, defaultCategoryId, nextSortOrder, onClose, onSaved, onRefetch }: {
  tpl: Template | null; focus?: 'packages'; categories: CatCategory[]; defaultCategoryId: number | null; nextSortOrder: number;
  onClose: () => void; onSaved: () => void; onRefetch: () => void;
}) {
  const isNew = tpl == null;
  const [name, setName] = useState(tpl?.name ?? '');
  const [nameAr, setNameAr] = useState(tpl?.nameAr ?? '');
  const [description, setDescription] = useState(tpl?.description ?? '');
  const [categoryId, setCategoryId] = useState<number | ''>(tpl?.categoryId ?? defaultCategoryId ?? (categories[0]?.id ?? ''));
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(tpl?.priceUnit ?? 'fixed');
  const [basePrice, setBasePrice] = useState(tpl?.basePrice != null ? String(tpl.basePrice) : '');
  const [isFromPrice, setIsFromPrice] = useState(tpl?.isFromPrice ?? false);
  const [minPrice, setMinPrice] = useState(tpl?.minPrice != null ? String(tpl.minPrice) : '');
  const [maxPrice, setMaxPrice] = useState(tpl?.maxPrice != null ? String(tpl.maxPrice) : '');
  const [minCalloutCharge, setMinCalloutCharge] = useState(tpl?.minCalloutCharge != null ? String(tpl.minCalloutCharge) : '');
  const [isEmergency, setIsEmergency] = useState(tpl?.isEmergency ?? false);
  // SP-135: cancellation override — null = inherit the platform matrix.
  const [cancelOverride, setCancelOverride] = useState<{ cancel: CancelTier[]; noShowFeePct: number | null } | null>(() =>
    tpl?.cancellationPolicy?.cancel
      ? { cancel: tpl.cancellationPolicy.cancel.slice(), noShowFeePct: tpl.cancellationPolicy.noShowFeePct ?? null }
      : null);
  const [estMin, setEstMin] = useState(tpl?.estimatedDuration != null ? String(tpl.estimatedDuration) : '');
  const [estMax, setEstMax] = useState(tpl?.estimatedDurationMax != null ? String(tpl.estimatedDurationMax) : '');
  const [variantGroupLabel, setVariantGroupLabel] = useState(tpl?.variantGroupLabel ?? '');
  const [imageUrl, setImageUrl] = useState<string | null>(tpl?.imageUrl ?? null);
  const [variants, setVariants] = useState<TemplateVariant[]>(() => (tpl?.variants ?? []).slice());
  const [addons, setAddons] = useState<TemplateAddon[]>(() => (tpl?.addons ?? []).slice());
  const [quantityLabel, setQuantityLabel] = useState(tpl?.quantityLabel ?? '');
  const [quantityMin, setQuantityMin] = useState(String(tpl?.quantityMin ?? 1));
  const [quantityMax, setQuantityMax] = useState(tpl?.quantityMax != null ? String(tpl.quantityMax) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opened from the packages pane → show ONLY packages + booking questions;
  // the full form is one click away and never in the way.
  const [showFull, setShowFull] = useState(focus !== 'packages' || tpl == null);
  const isQuote = priceUnit === 'quote_after_callout';
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  // With ≥1 active variant, base_price auto-tracks the cheapest variant server-side (read-only here).
  const lockedBase = !isNew && !isQuote && variants.some(v => v.isActive);

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    if (categoryId === '') { setError('Pick a category.'); return; }
    const bp = isQuote ? null : num(basePrice);
    if (!isQuote && !lockedBase && (bp == null || !(bp > 0))) { setError('Base price must be greater than 0 for non-quote services.'); return; }
    setBusy(true); setError(null);
    const payload: Record<string, unknown> = {
      categoryId,
      name: name.trim(),
      description: description.trim() || null,
      priceUnit,
      basePrice: bp,
      isFromPrice: isQuote ? false : isFromPrice,
      minPrice: num(minPrice),
      maxPrice: num(maxPrice),
      minCalloutCharge: num(minCalloutCharge),
      isEmergency,
      estimatedDuration: num(estMin),
      estimatedDurationMax: num(estMax),
    };
    if (nameAr.trim()) payload.nameAr = nameAr.trim(); else if (!isNew) payload.nameAr = null;
    if (isNew) payload.sortOrder = nextSortOrder; // append at the end; reorder by dragging in the list
    if (!isNew) payload.variantGroupLabel = variantGroupLabel.trim() || null;
    if (!isNew) {
      payload.cancellationPolicy = cancelOverride
        ? { cancel: cancelOverride.cancel, ...(cancelOverride.noShowFeePct != null ? { noShowFeePct: cancelOverride.noShowFeePct } : {}) }
        : null;
    }
    if (!isNew) {
      payload.quantityLabel = quantityLabel.trim() || null;
      payload.quantityMin = Math.max(1, Number(quantityMin) || 1);
      payload.quantityMax = quantityMax.trim() === '' ? null : Math.max(1, Number(quantityMax) || 1);
    }
    if (lockedBase) { delete payload.basePrice; delete payload.isFromPrice; } // read-only while variants drive the from-price
    try {
      if (isNew) {
        // POST: omit nulls — everything optional is simply not sent.
        const body = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null));
        await apiPost('/admin/catalog/templates', body);
      } else {
        await apiPatch(`/admin/catalog/templates/${tpl.id}`, payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? 'New service' : showFull ? `Edit — ${tpl.name}` : `Packages — ${tpl.name}`} onClose={onClose} wide>
      <div className="space-y-3.5">

        {/* ① Basics */}
        {showFull && (
        <SectionCard step="1" title="The basics" sub="What customers see on the services page.">
          <ImageAttach
            label="Card image (optional)"
            current={imageUrl}
            uploadPath={isNew ? null : `/admin/catalog/templates/${tpl.id}/image`}
            clearPath={isNew ? '' : `/admin/catalog/templates/${tpl.id}/image`}
            onChanged={(url) => { setImageUrl(url); onRefetch(); }}
            newHint="Create the service first — then reopen it to attach an image."
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service name *">
              <input className={inputCls} value={name} placeholder="e.g. Sofa Cleaning" onChange={e => setName(e.target.value)} />
            </Field>
            <Field label="Category *">
              <select className={inputCls} value={categoryId} onChange={e => setCategoryId(Number(e.target.value))}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Short description (optional)" hint="One or two lines shown under the service name.">
            <textarea className={`${inputCls} resize-y`} rows={2} value={description} onChange={e => setDescription(e.target.value)} />
          </Field>
          <Field label="Arabic name (optional)">
            <input className={inputCls} dir="rtl" value={nameAr} onChange={e => setNameAr(e.target.value)} />
          </Field>
        </SectionCard>
        )}

        {/* ② Pricing */}
        {showFull && (
        <SectionCard step="2" title="How is it priced?" sub="Pick one — the booking page adapts automatically.">
          <div className="grid grid-cols-3 gap-2">
            {([
              { v: 'fixed', t: 'Fixed price', d: 'One set price. Can be sold as packages (sizes / types).' },
              { v: 'per_hour', t: 'Per hour', d: 'Customer picks hours — price = rate × hours.' },
              { v: 'quote_after_callout', t: 'Free quote', d: 'Assess on site first; customer approves a quote.' },
            ] as { v: PriceUnit; t: string; d: string }[]).map(o => {
              const on = priceUnit === o.v;
              return (
                <button key={o.v} type="button"
                  onClick={() => {
                    setPriceUnit(o.v);
                    if (o.v === 'quote_after_callout') { setBasePrice(''); setIsFromPrice(false); }
                  }}
                  className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${on ? 'border-[#2e9f82] bg-[#f0faf6]' : 'border-[#e8e6e0] bg-white hover:border-[#c9c6bf]'}`}
                >
                  <span className={`block text-[12px] font-bold ${on ? 'text-[#1a7a5a]' : 'text-[#1a1916]'}`}>{o.t}</span>
                  <span className="block text-[10px] text-[#9b9890] mt-0.5 leading-snug">{o.d}</span>
                </button>
              );
            })}
          </div>
          {!['fixed', 'per_hour', 'quote_after_callout'].includes(priceUnit) && (
            <p className="rounded-lg bg-[#fffbeb] border border-[#fde68a] px-2.5 py-2 text-[11px] text-[#92400e]">
              This service uses an advanced price unit ({priceUnit}) — keep it, or pick one of the three above.
            </p>
          )}

          {!isQuote ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Field
                  label={priceUnit === 'per_hour' ? 'Rate per hour (AED) *' : 'Price (AED) *'}
                  hint={lockedBase ? 'Set automatically by the cheapest package below.' : undefined}
                >
                  <input className={inputCls} type="number" min={0} value={basePrice} disabled={lockedBase}
                    onChange={e => setBasePrice(e.target.value)} />
                </Field>
                <Field label="Typical duration (min)" hint="Optional — shown to customers.">
                  <input className={inputCls} type="number" min={0} value={estMin} onChange={e => setEstMin(e.target.value)} />
                </Field>
                <Field label="… up to (min)">
                  <input className={inputCls} type="number" min={0} value={estMax} onChange={e => setEstMax(e.target.value)} />
                </Field>
              </div>
              <label className="flex items-center gap-1.5 text-[12px] text-[#1a1916]">
                <input type="checkbox" checked={lockedBase ? true : isFromPrice} disabled={lockedBase} onChange={e => setIsFromPrice(e.target.checked)} className="accent-[#2e9f82]" />
                Show as a starting price — &ldquo;From AED …&rdquo;
              </label>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Visit charge (AED, optional)" hint="Charged for the assessment visit — credited to the job if the customer goes ahead.">
                <input className={inputCls} type="number" min={0} value={minCalloutCharge} onChange={e => setMinCalloutCharge(e.target.value)} />
              </Field>
              <Field label="Typical duration (min, optional)">
                <input className={inputCls} type="number" min={0} value={estMin} onChange={e => setEstMin(e.target.value)} />
              </Field>
            </div>
          )}

          <details className="rounded-lg border border-[#f0ede8] px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-[#9b9890]">Advanced (rarely needed)</summary>
            <div className="grid grid-cols-3 gap-3 pt-2.5">
              {!isQuote && (
                <>
                  <Field label="Provider min price (AED)" hint="Only if providers may set their own price later.">
                    <input className={inputCls} type="number" min={0} value={minPrice} onChange={e => setMinPrice(e.target.value)} />
                  </Field>
                  <Field label="Provider max price (AED)">
                    <input className={inputCls} type="number" min={0} value={maxPrice} onChange={e => setMaxPrice(e.target.value)} />
                  </Field>
                  <Field label="Callout charge (AED)">
                    <input className={inputCls} type="number" min={0} value={minCalloutCharge} onChange={e => setMinCalloutCharge(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          </details>
        </SectionCard>
        )}

        {/* ③ Packages — fixed-price services only */}
        {priceUnit === 'fixed' && (
          <SectionCard step="3" title="Packages — sizes & types (optional)"
            sub="Sell the same service in sizes or types, each with its own price — e.g. Studio → Villa 5BR+. The 'From' price follows the cheapest package automatically.">
            {isNew ? (
              <p className="rounded-lg bg-[#faf9f6] border border-[#f0ede8] px-2.5 py-2 text-[11px] text-[#9b9890]">
                Save the service first — then add packages here.
              </p>
            ) : (
              <>
                <Field label="Packages are grouped by…" hint="Shown as the question title on the booking page.">
                  <input className={inputCls} value={variantGroupLabel} placeholder="e.g. Home size · Vehicle type · AC type"
                    onChange={e => setVariantGroupLabel(e.target.value)} />
                </Field>
                <VariantsEditor templateId={tpl.id} variants={variants} setVariants={setVariants} onRefetch={onRefetch} />
              </>
            )}
          </SectionCard>
        )}

        {/* ④ Booking questions — not for quote services */}
        {!isQuote && (
          <SectionCard step={priceUnit === 'fixed' ? '4' : '3'} title="Booking questions (optional)"
            sub="Extra questions the customer answers at checkout — leave empty for none.">
            {isNew ? (
              <p className="rounded-lg bg-[#faf9f6] border border-[#f0ede8] px-2.5 py-2 text-[11px] text-[#9b9890]">
                Save the service first — then set these here.
              </p>
            ) : (
              <>
                <div>
                  <p className="text-[11px] font-semibold text-[#6b6860] mb-1.5">Ask &ldquo;how many?&rdquo; — multiplies the price</p>
                  <div className="flex items-center gap-1.5">
                    <input className={`${inputCls} flex-1`} placeholder="What are we counting? e.g. Cleaners · AC units" value={quantityLabel}
                      onChange={e => setQuantityLabel(e.target.value)} />
                    <span className="text-[11px] text-[#9b9890]">from</span>
                    <input className={`${inputCls} !w-14 text-right`} type="number" min={1} value={quantityMin}
                      onChange={e => setQuantityMin(e.target.value)} disabled={!quantityLabel.trim()} />
                    <span className="text-[11px] text-[#9b9890]">to</span>
                    <input className={`${inputCls} !w-14 text-right`} type="number" min={1} placeholder="∞" value={quantityMax}
                      onChange={e => setQuantityMax(e.target.value)} disabled={!quantityLabel.trim()} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-[#6b6860] mb-1.5">Optional extras the customer can tick — e.g. Cleaning materials +10/hr</p>
                  <AddonsEditor templateId={tpl.id} addons={addons} setAddons={setAddons} onRefetch={onRefetch} />
                </div>
              </>
            )}
          </SectionCard>
        )}

        {showFull && !isNew && tpl && <RequirementsEditor templateId={tpl.id} />}

        {showFull && !isNew && (
          <SectionCard step="✦" title="Cancellation terms" sub="Overrides the platform matrix for THIS service only. Bookings keep the terms they were made under.">
            <div className="flex items-center gap-2 text-[12px]">
              <select
                className={`${inputCls} !w-auto`}
                value={cancelOverride ? 'custom' : 'inherit'}
                onChange={e => setCancelOverride(e.target.value === 'custom'
                  ? { cancel: [{ minHoursBefore: 24, feePct: 0 }, { minHoursBefore: 2, feePct: 50 }, { minHoursBefore: 0, feePct: 100 }], noShowFeePct: null }
                  : null)}
              >
                <option value="inherit">Inherit platform policy</option>
                <option value="custom">Custom tiers for this service</option>
              </select>
              {cancelOverride && (
                <button type="button" onClick={() => setCancelOverride(o => o ? { ...o, cancel: [{ minHoursBefore: (o.cancel[0]?.minHoursBefore ?? 0) + 24, feePct: 0 }, ...o.cancel] } : o)}
                  className="text-[11px] font-semibold text-[#2e9f82] hover:underline">+ tier</button>
              )}
            </div>
            {cancelOverride && (
              <ul className="space-y-1 mt-2">
                {cancelOverride.cancel.map((t, i, arr) => (
                  <li key={i} className="flex items-center gap-1.5 text-[12px] text-[#1a1916]">
                    <input type="number" min={0} max={720} value={t.minHoursBefore} aria-label="Hours before the slot"
                      onChange={e => setCancelOverride(o => o ? { ...o, cancel: o.cancel.map((x, j) => j === i ? { ...x, minHoursBefore: Math.max(0, Math.min(720, Math.round(Number(e.target.value) || 0))) } : x) } : o)}
                      onBlur={() => setCancelOverride(o => o ? { ...o, cancel: [...o.cancel].sort((a, b) => b.minHoursBefore - a.minHoursBefore) } : o)}
                      className={`${inputCls} !w-14 text-right !py-0.5`} />
                    <span className="text-[#9b9890] text-[11px]">h</span>
                    <span className="flex-1 text-[#6b6860] text-[11px] truncate">{tierLabel(arr, i)}</span>
                    <input type="number" min={0} max={100} value={t.feePct} aria-label="Fee percent"
                      onChange={e => setCancelOverride(o => o ? { ...o, cancel: o.cancel.map((x, j) => j === i ? { ...x, feePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x) } : o)}
                      className={`${inputCls} !w-16 text-right !py-0.5`} />
                    <span className="text-[#9b9890]">%</span>
                    <button type="button" disabled={arr.length <= 1} aria-label="Remove tier"
                      onClick={() => setCancelOverride(o => o && o.cancel.length > 1 ? { ...o, cancel: o.cancel.filter((_, j) => j !== i) } : o)}
                      className="text-[#9b9890] hover:text-[#c0392b] disabled:opacity-30 px-1">×</button>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-[12px] text-[#1a1916] pt-1">
                  <span className="flex-1 text-[#6b6860]">Customer no-show fee (blank = platform)</span>
                  <input type="number" min={0} max={100} value={cancelOverride.noShowFeePct ?? ''} placeholder="—"
                    onChange={e => setCancelOverride(o => o ? { ...o, noShowFeePct: e.target.value.trim() === '' ? null : Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : o)}
                    className={`${inputCls} !w-16 text-right !py-0.5`} />
                  <span className="text-[#9b9890]">%</span>
                </li>
              </ul>
            )}
          </SectionCard>
        )}

        {showFull ? (
          <label className="flex items-center gap-1.5 text-[12px] text-[#1a1916]">
            <input type="checkbox" checked={isEmergency} onChange={e => setIsEmergency(e.target.checked)} className="accent-[#dc2626]" />
            24/7 emergency service — shows the red badge
          </label>
        ) : (
          <button type="button" onClick={() => setShowFull(true)}
            className="text-[11px] font-semibold text-[#9b9890] hover:text-[#1a7a5a] text-left">
            Need to change the name, category or price? Edit the full service →
          </button>
        )}

        {error && <p className="text-[12px] text-[#b91c1c]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button disabled={busy} onClick={onClose}
            className="rounded-lg border border-[#e8e6e0] px-3 py-1.5 text-[12px] font-semibold text-[#6b6860] hover:bg-[#faf9f6]">Cancel</button>
          <button disabled={busy} onClick={save}
            className="flex items-center gap-1.5 rounded-lg bg-[#2e9f82] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />} {isNew ? 'Create service' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ═════════════════════════ Variant editor (inside service modal) ═════════════════════════ */

function VariantsEditor({ templateId, variants, setVariants, onRefetch }: {
  templateId: number;
  variants: TemplateVariant[];
  setVariants: React.Dispatch<React.SetStateAction<TemplateVariant[]>>;
  onRefetch: () => void; // silent template refetch — base_price may be recomputed server-side
}) {
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addDuration, setAddDuration] = useState('');
  const [adding, setAdding] = useState(false);

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  const patchVariant = async (id: number, body: Record<string, unknown>) => {
    setError(null);
    try {
      const row = await apiPatch<TemplateVariant>(`/admin/catalog/variants/${id}`, body);
      setVariants(prev => prev.map(v => (v.id === id ? { ...v, ...(row && typeof row.id === 'number' ? row : body) } : v)));
      onRefetch();
    } catch (e) { fail(e, 'Package update failed.'); }
  };

  const [dragId, setDragId] = useState<number | null>(null);
  const dropOn = async (targetId: number) => {
    if (dragId == null || dragId === targetId) { setDragId(null); return; }
    const list = [...variants];
    const from = list.findIndex(v => v.id === dragId);
    const to = list.findIndex(v => v.id === targetId);
    if (from < 0 || to < 0) { setDragId(null); return; }
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    const renumbered = list.map((v, i) => ({ ...v, sortOrder: i + 1 }));
    setVariants(renumbered);
    setDragId(null);
    setError(null);
    try {
      await Promise.all(renumbered.filter((v, i) => variants.find(x => x.id === v.id)?.sortOrder !== i + 1)
        .map(v => apiPatch(`/admin/catalog/variants/${v.id}`, { sortOrder: v.sortOrder })));
      onRefetch();
    } catch (e) { fail(e, 'Could not reorder packages.'); }
  };

  const remove = async (v: TemplateVariant) => {
    if (!window.confirm(`Delete package “${v.name}”? This is permanent.`)) return;
    setError(null);
    try {
      await apiDelete(`/admin/catalog/variants/${v.id}`);
      setVariants(prev => prev.filter(x => x.id !== v.id));
      onRefetch();
    } catch (e) { fail(e, 'Could not delete the package.'); }
  };

  const add = async () => {
    const price = Number(addPrice);
    if (!addName.trim()) { setError('Package name is required.'); return; }
    if (addPrice.trim() === '' || !isFinite(price) || !(price > 0)) { setError('Package price must be greater than 0.'); return; }
    setAdding(true); setError(null);
    const body: Record<string, unknown> = { name: addName.trim(), basePrice: price };
    if (addDuration.trim() !== '') body.estimatedDuration = Number(addDuration);
    try {
      const row = await apiPost<TemplateVariant>(`/admin/catalog/templates/${templateId}/variants`, body);
      if (row && typeof row.id === 'number') setVariants(prev => [...prev, row]);
      setAddName(''); setAddPrice(''); setAddDuration('');
      onRefetch();
    } catch (e) { fail(e, 'Could not add the package.'); }
    finally { setAdding(false); }
  };

  return (
    <div className="rounded-xl border border-[#f0ede8] overflow-hidden">
      {variants.length > 0 && (
        <>
          <div className="grid grid-cols-[16px_1fr_76px_64px_36px_24px] items-center gap-1.5 px-2.5 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wide text-[#9b9890]">
            <span /><span>Package</span><span className="text-right">AED</span><span className="text-right">Min (m)</span>
            <span className="text-center">On</span><span />
          </div>
          <ul className="divide-y divide-[#f0ede8]">
            {variants.map(v => (
              <VariantRow
                key={v.id} v={v}
                dragging={dragId === v.id}
                onDragStart={() => setDragId(v.id)}
                onDropOn={() => dropOn(v.id)}
                onPatch={body => patchVariant(v.id, body)}
                onToggle={() => patchVariant(v.id, { isActive: !v.isActive })}
                onDelete={() => remove(v)}
              />
            ))}
          </ul>
        </>
      )}
      {variants.length === 0 && (
        <p className="px-2.5 py-2.5 text-[11px] text-[#9b9890]">No packages yet — the service sells at one price.</p>
      )}
      <div className="flex items-center gap-1.5 border-t border-[#f0ede8] bg-[#faf9f6] px-2.5 py-2">
        <input className={`${inputCls} !py-1 flex-1`} placeholder="New package — e.g. Studio" value={addName}
          onChange={e => setAddName(e.target.value)} />
        <input className={`${inputCls} !py-1 !w-[76px] text-right`} type="number" min={0} placeholder="AED" value={addPrice}
          onChange={e => setAddPrice(e.target.value)} />
        <input className={`${inputCls} !py-1 !w-16 text-right`} type="number" min={0} placeholder="min" value={addDuration}
          onChange={e => setAddDuration(e.target.value)} />
        <button
          type="button" disabled={adding} onClick={add}
          className="flex items-center gap-1 rounded-lg bg-[#2e9f82] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50 shrink-0"
        >{adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add</button>
      </div>
      {error && <p className="px-2.5 pb-2 pt-1 text-[11px] text-[#b91c1c]">{error}</p>}
    </div>
  );
}


/* ═════════════════════════ Add-ons editor (inside service modal) ═════════════════════════ */

function AddonsEditor({ templateId, addons, setAddons, onRefetch }: {
  templateId: number;
  addons: TemplateAddon[];
  setAddons: React.Dispatch<React.SetStateAction<TemplateAddon[]>>;
  onRefetch: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [addName, setAddName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addUnit, setAddUnit] = useState<'flat' | 'per_hour'>('flat');
  const [adding, setAdding] = useState(false);

  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  const patchAddon = async (id: number, body: Record<string, unknown>) => {
    setError(null);
    try {
      const row = await apiPatch<TemplateAddon>(`/admin/catalog/addons/${id}`, body);
      setAddons(prev => prev.map(a => (a.id === id ? { ...a, ...(row && typeof row.id === 'number' ? row : body) } : a)));
      onRefetch();
    } catch (e) { fail(e, 'Add-on update failed.'); }
  };

  const remove = async (a: TemplateAddon) => {
    if (!window.confirm(`Delete add-on \u201c${a.name}\u201d? This is permanent.`)) return;
    setError(null);
    try {
      await apiDelete(`/admin/catalog/addons/${a.id}`);
      setAddons(prev => prev.filter(x => x.id !== a.id));
      onRefetch();
    } catch (e) { fail(e, 'Could not delete the add-on.'); }
  };

  const add = async () => {
    const price = Number(addPrice);
    if (!addName.trim()) { setError('Add-on name is required.'); return; }
    if (addPrice.trim() === '' || !isFinite(price) || !(price > 0)) { setError('Add-on price must be greater than 0.'); return; }
    setAdding(true); setError(null);
    try {
      const row = await apiPost<TemplateAddon>(`/admin/catalog/templates/${templateId}/addons`, {
        name: addName.trim(), price, priceUnit: addUnit,
      });
      if (row && typeof row.id === 'number') setAddons(prev => [...prev, row]);
      setAddName(''); setAddPrice(''); setAddUnit('flat');
      onRefetch();
    } catch (e) { fail(e, 'Could not add the add-on.'); }
    finally { setAdding(false); }
  };

  return (
    <div className="rounded-xl border border-[#f0ede8] overflow-hidden">
      {addons.length > 0 && (
        <ul className="divide-y divide-[#f0ede8]">
          {addons.map(a => (
            <li key={a.id} className={`flex items-center gap-2 px-2.5 py-1.5 ${a.isActive ? '' : 'opacity-55'}`}>
              <span className="flex-1 min-w-0 truncate text-[12px] text-[#1a1916]">{a.name}</span>
              <span className="text-[11px] font-semibold tabular-nums text-[#1a1916]">
                +{fmtAED(a.price)}{a.priceUnit === 'per_hour' ? '/hr' : ''}
              </span>
              <Toggle on={a.isActive} onChange={() => patchAddon(a.id, { isActive: !a.isActive })} />
              <button type="button" onClick={() => remove(a)} title="Delete add-on"
                className="text-[#c9c6bf] hover:text-[#b91c1c]"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
      {addons.length === 0 && (
        <p className="px-2.5 py-2 text-[11px] text-[#9b9890]">No add-ons — customers see none at checkout.</p>
      )}
      <div className="flex items-center gap-1.5 border-t border-[#f0ede8] bg-[#faf9f6] px-2.5 py-2">
        <input className={`${inputCls} !py-1 flex-1`} placeholder="New add-on — e.g. Cleaning materials" value={addName}
          onChange={e => setAddName(e.target.value)} />
        <input className={`${inputCls} !py-1 !w-[70px] text-right`} type="number" min={0} placeholder="AED" value={addPrice}
          onChange={e => setAddPrice(e.target.value)} />
        <select className={`${inputCls} !py-1 !w-[86px]`} value={addUnit} onChange={e => setAddUnit(e.target.value as 'flat' | 'per_hour')}>
          <option value="flat">flat</option>
          <option value="per_hour">per hour</option>
        </select>
        <button type="button" disabled={adding} onClick={add}
          className="flex items-center gap-1 rounded-lg bg-[#2e9f82] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
        </button>
      </div>
      {error && <p className="px-2.5 py-1.5 text-[11px] text-[#b91c1c] border-t border-[#f0ede8]">{error}</p>}
    </div>
  );
}

function VariantRow({ v, dragging, onDragStart, onDropOn, onPatch, onToggle, onDelete }: {
  v: TemplateVariant;
  dragging: boolean;
  onDragStart: () => void;
  onDropOn: () => void;
  onPatch: (body: Record<string, unknown>) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(v.name);
  const [price, setPrice] = useState(String(v.basePrice));
  const [duration, setDuration] = useState(v.estimatedDuration != null ? String(v.estimatedDuration) : '');

  // Re-sync drafts when the server row changes underneath (patch responses).
  useEffect(() => { setName(v.name); }, [v.name]);
  useEffect(() => { setPrice(String(v.basePrice)); }, [v.basePrice]);
  useEffect(() => { setDuration(v.estimatedDuration != null ? String(v.estimatedDuration) : ''); }, [v.estimatedDuration]);

  const blurName = () => {
    const n = name.trim();
    if (!n) { setName(v.name); return; }
    if (n !== v.name) onPatch({ name: n });
  };
  const blurPrice = () => {
    const p = Number(price);
    if (price.trim() === '' || !isFinite(p) || !(p > 0)) { setPrice(String(v.basePrice)); return; }
    if (p !== v.basePrice) onPatch({ basePrice: p });
  };
  const blurDuration = () => {
    const d = duration.trim() === '' ? null : Number(duration);
    if (d != null && (!isFinite(d) || d <= 0)) { setDuration(v.estimatedDuration != null ? String(v.estimatedDuration) : ''); return; }
    if (d !== v.estimatedDuration) onPatch({ estimatedDuration: d });
  };

  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={e => e.preventDefault()}
      onDrop={onDropOn}
      className={`grid grid-cols-[16px_1fr_76px_64px_36px_24px] items-center gap-1.5 px-2.5 py-1.5 ${v.isActive ? '' : 'opacity-55'} ${dragging ? 'opacity-40' : ''}`}
    >
      <span className="cursor-grab active:cursor-grabbing text-[#d5d2cb]"><GripVertical size={13} /></span>
      <input className={`${inputCls} !py-1`} value={name} onChange={e => setName(e.target.value)} onBlur={blurName} />
      <input className={`${inputCls} !py-1 text-right`} type="number" min={0} value={price}
        onChange={e => setPrice(e.target.value)} onBlur={blurPrice} />
      <input className={`${inputCls} !py-1 text-right`} type="number" min={0} value={duration} placeholder="—"
        onChange={e => setDuration(e.target.value)} onBlur={blurDuration} />
      <div className="flex justify-center"><Toggle on={v.isActive} onChange={onToggle} /></div>
      <button type="button" onClick={onDelete} title="Delete package"
        className="text-[#c9c6bf] hover:text-[#b91c1c] justify-self-center"><X size={13} /></button>
    </li>
  );
}
