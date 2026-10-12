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
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BedDouble, Bath, Maximize2, ChevronDown, Loader2, Layers, Image as ImageIcon,
  ArrowUp, Pencil, Check, X, Upload, Maximize, Download, AlertTriangle, Info,
  LayoutGrid, Rows3, Search, Plus, Trash2,
} from 'lucide-react';
import { apiGet, apiPatch, apiDelete } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { UnitFormModal } from '@/components/upnow/UnitFormModal';
import { UnitPreviewModal } from '@/components/upnow/UnitPreviewModal';
import { StartRestorationDialog } from '@/components/upnow/StartRestorationDialog';
import { type Plan } from '@/components/upnow/LayoutFinancialsModal';
import { MarketRateReviewNote } from '@/components/upnow/MarketRateReviewNote';
import { LayoutPreviewModal } from '@/components/upnow/LayoutPreviewModal';
import { saveUnit, saveLayoutDetails, unitToFormInitial, type UnitRecord } from '@/lib/unitForm';
import { type FeeRuleLite } from '@/lib/feeRules';
import { tenantDisplayName } from '@/lib/tenantName';
import { legalApi, breachStageTone, disputeStageTone, type LeaseFlag, type LeaseFlags } from '@/lib/legal';

interface PropOpt { id: number; buildingName: string; leasingType?: 'direct' | 'sub' | 'management' | null; emirate?: string | null }
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
  // The API's `name` is the person; a company customer also carries its entity
  // type and company name, and this page labels it by the company (see load).
  tenant: { id: number | null; name: string | null; entityType?: string | null; companyName?: string | null } | null;
  unit: { id: number | null } | null;
}

// Plans are unique per (property, plan_label) — labels can repeat across
// buildings in "all properties" mode, so edit/upload state keys on both.
// Restoration per unit, from the API (`/maintenance/restoration/units`): a vacant
// unit with an OPEN job in the "Restoration & make-ready" group is UNDER
// RESTORATION — read off the work itself, never a flag someone has to set —
// and the closed jobs are its history: how many times, and what they cost.
const RESTORATION_GROUP = 'Restoration & make-ready';
interface RestorationJob { id: number; ref: string; title?: string; stage: string; type: string | null; inHouse?: boolean; costAed?: number | null }
interface RestorationRow { unitId: number; open: RestorationJob[]; completed: RestorationJob[]; timesRestored: number; totalCostAed: number; lastCompletedAt: string | null }
const RESTORATION_STAGE: Record<string, string> = {
  requested: 'Requested', awaiting_approval: 'Quote awaiting approval', in_progress: 'Work in progress',
  sign_off: 'Awaiting sign-off', close_out: 'Invoice & close-out',
};
const planKey = (p: { propertyId: number; planLabel: string }) => `${p.propertyId}::${p.planLabel}`;
const aed = (n: number) => new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(n);
const bedLabel = (b: number | null) => (b == null ? 'Unit' : b === 0 ? 'Studio' : `${b} Bed`);
const typeLabel = (t: string | null) => (t == null ? 'Other' : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

// ── "Units & Pricing" redesign tokens (Claude-Design handoff). Mock structure
// + neutrals, but the brand green is the app green (#2e9f82) so this page stays
// consistent with its neighbours (Add Units, portfolio, the edit modals). ──────
const GREEN = '#2e9f82', GREEN_D = '#1a7a5a', GREEN_T = '#e6f7f1', GREEN_T2 = '#d8f2e8';
const INK = '#1d2823', MUTE = '#8a938c', MUTE2 = '#9aa39c', LINE = '#e7ebe6', THUMB_BG = '#f4f6f3';
const ICON_MUTE = '#a0a8a1';
// Small reusable inline-style fragments shared by the redesigned rows/cards.
const CHIP_COUNT = { fontSize: 11.5, fontWeight: 600, color: '#7d8780', background: '#eef1ec', padding: '4px 10px', borderRadius: 7 } as const;
const UNITS_CHIP = { fontSize: 10.5, fontWeight: 700, color: GREEN_D, background: GREEN_T2, padding: '3px 9px', borderRadius: 6 } as const;

const sizeLabel = (a: number | null | undefined, b: number | null | undefined) => {
  // Land / unsized units have no sqft (backend coerces missing → 0); show "—"
  // instead of "0", and never call .toLocaleString() on null (no crash).
  const lo = a || b, hi = b || a;
  if (!lo || !hi) return '—';
  return lo === hi ? lo.toLocaleString() : `${lo.toLocaleString()} – ${hi.toLocaleString()}`;
};

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
  { value: 'rent_desc',   label: 'Asking rent: high' },
  { value: 'rent_asc',    label: 'Asking rent: low' },
];

const isPdf = (u: string) => /\.pdf(\?|$)/i.test(u);
function PlanThumb({ url, alt, emptyLabel = 'No floor plan' }: { url: string | null; alt: string; emptyLabel?: string }) {
  if (!url) return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1" style={{ color: '#b9c1ba', background: THUMB_BG }}>
      <ImageIcon size={20} /><span style={{ fontSize: 10.5, color: ICON_MUTE }}>{emptyLabel}</span>
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
  // Manager portal is per-landlord: edit / price / add / delete need
  // canEditProperties on THIS landlord; publishing a listing needs
  // canPublishListings. The RP (no `manager` prop) owns their own units, so
  // everything is allowed. While a manager's permissions load, canForRp
  // returns false → edit affordances stay hidden until known (safe default).
  const { canForRp } = useManagerPermissions();
  const canEdit    = !manager || canForRp('canEditProperties', manager.rp);
  const canPublish = !manager || canForRp('canPublishListings', manager.rp);
  const [data, setData] = useState<Resp | null>(null);
  // propertyId → leasing model, so the unit editor can offer the sub-lease-only
  // charge (`properties` covers every property with plans, so it maps every row).
  const leasingByProperty = useMemo(() => {
    const m = new Map<number, 'direct' | 'sub' | 'management' | null>();
    for (const p of data?.properties ?? []) m.set(p.id, p.leasingType ?? null);
    return m;
  }, [data]);
  // propertyId → emirate, so the unit editor knows to show Ajman's Sewerage No.
  const emirateByProperty = useMemo(() => {
    const m = new Map<number, string | null>();
    for (const p of data?.properties ?? []) m.set(p.id, p.emirate ?? null);
    return m;
  }, [data]);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  // Plan/layout selector — 'all' or a planKey (propertyId::planLabel). Lets the
  // RP target one specific layout so it's clear which plan they're editing.
  const [planFilter, setPlanFilter] = useState('all');
  const [sort, setSort] = useState('default');
  // Seeded from `?q=` so a link elsewhere (a lead's unit, say) can land here with
  // that unit already filtered in — this workspace has no per-unit route.
  const [query, setQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') ?? '';
  });
  // Seeded from `?unit=` (see lib/unitHref.ts) so a link elsewhere — the
  // dashboard's vacant/occupied unit rows, a lead, a contract — opens THAT
  // unit's preview directly. This replaces the standalone /units/{id} page,
  // which rendered the same unit a second, differently-maintained way.
  // Held in state, not read on every render, because it is a ONE-SHOT: once the
  // preview is open, closing it must not immediately reopen it.
  const [deepLinkUnitId, setDeepLinkUnitId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const n = Number(new URLSearchParams(window.location.search).get('unit'));
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const [view, setView] = useState<'grid' | 'row'>('row');
  // Primary axis: 'unit' = a flat list of every individual unit grouped by
  // building (default), 'type' = layout cards grouped by unit type (pricing).
  const [mode, setMode] = useState<'type' | 'unit'>('unit');
  // By-unit status tab filter (All / Occupied / Published / Draft).
  const [statusFilter, setStatusFilter] = useState<'All' | 'Occupied' | 'Published' | 'Draft'>('All');
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
  // By-layout Edit opens the SAME full editor as the portfolio Unit Mix → Edit:
  // UnitFormModal in layout-bulk mode. Ensure the layout's units are loaded so we
  // have a representative unit to seed the form.
  const [editLayout, setEditLayout] = useState<Plan | null>(null);
  const openLayoutEdit = (p: Plan) => {
    if (unitsByProperty[p.propertyId] == null && !loadingUnits.has(p.propertyId)) void loadUnitsForProperty(p.propertyId);
    setEditLayout(p);
  };

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
  const [restoration, setRestoration] = useState<Record<number, RestorationRow>>({});
  const [restorationTypes, setRestorationTypes] = useState<{ id: number; name: string }[]>([]);
  // "Start restoration" dialog — the unit it was opened on.
  const [startRestoration, setStartRestoration] = useState<{ plan: Plan; unit: UnitRecord } | null>(null);
  // Legal & breach flags keyed by lease id (spec §7.5) — fetched once for the
  // in-force leases the rows already resolve, chunked like the Leases register.
  const [leaseFlags, setLeaseFlags] = useState<LeaseFlags>({});
  const [unitModal, setUnitModal] = useState<{ plan: Plan; editingUnit?: UnitRecord } | null>(null);
  const [unitPreview, setUnitPreview] = useState<{ plan: Plan; unit: UnitRecord } | null>(null);
  // Read-only layout detail popup — the same view shown from the portfolio's
  // property → Unit Mix. Opened by clicking a layout card in the By-layout view.
  const [layoutPreview, setLayoutPreview] = useState<Plan | null>(null);
  const openLayoutPreview = (p: Plan) => {
    if (unitsByProperty[p.propertyId] == null && !loadingUnits.has(p.propertyId)) void loadUnitsForProperty(p.propertyId);
    setLayoutPreview(p);
  };
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busyUnit, setBusyUnit] = useState<number | null>(null);

  // Contracts power the tenant / lease-end line on each unit row and the renewal
  // history in Unit details. Both print tenant.name, so a company customer's
  // label is resolved once here: the company, never its signatory.
  useEffect(() => {
    if (manager) return;
    apiGet<ContractSummary[]>('/contracts')
      .then(rows => setContracts(rows.map(c => (c.tenant ? { ...c, tenant: { ...c.tenant, name: tenantDisplayName(c.tenant) } } : c))))
      .catch(() => {});
  }, [manager]);
  useEffect(() => {
    const ids = contracts.filter(c => c.contractActive).map(c => c.id);
    if (!ids.length) return;
    let cancelled = false;
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
    Promise.all(chunks.map(chunk => legalApi.leaseFlags(manager ? '/manager/legal' : '/legal', manager?.rp, chunk).catch(() => ({} as LeaseFlags))))
      .then(parts => { if (!cancelled) setLeaseFlags(Object.assign({}, ...parts)); });
    return () => { cancelled = true; };
  }, [contracts, manager]);
  const canMaintain = !manager || canForRp('canManageMaintenance', manager.rp);
  const maintBase = manager ? '/manager/maintenance' : '/maintenance';
  const maintQ = manager ? `rp=${manager.rp}` : '';
  const loadRestoration = useCallback(() => {
    if (!canMaintain) return;
    apiGet<RestorationRow[]>(`${maintBase}/restoration/units${maintQ ? `?${maintQ}` : ''}`)
      .then(rows => setRestoration(Object.fromEntries(rows.map(r => [r.unitId, r]))))
      .catch(() => {});
  }, [canMaintain, maintBase, maintQ]);
  useEffect(() => { loadRestoration(); }, [loadRestoration]);
  // The kinds of restoration work — the landlord's own list under the group.
  useEffect(() => {
    if (!canMaintain) return;
    apiGet<{ id: number; name: string; parentId: number | null }[]>(`${maintBase}/categories${maintQ ? `?${maintQ}` : ''}`)
      .then(cats => {
        const groupId = cats.find(c => c.parentId == null && c.name === RESTORATION_GROUP)?.id;
        setRestorationTypes(cats.filter(c => groupId != null && c.parentId === groupId).map(c => ({ id: c.id, name: c.name })));
      }).catch(() => {});
  }, [canMaintain, maintBase, maintQ]);
  const router = useRouter();
  // One pill per open restoration job — "Painting & wall repairs · Awaiting approval".
  const restorationPills = (u: UnitRecord, small = false) => {
    const jobs = restoration[u.id]?.open;
    if (!jobs?.length || someoneInIt(u)) return null;
    const href = (id: number) => (manager ? `/dashboard/manager/maintenance/${id}?rp=${manager.rp}` : `/rental-provider/dashboard/maintenance/${id}`);
    return jobs.map(j => (
      <span key={j.id} role="link" tabIndex={0} title={`Open ${j.ref} — quotation, vendor, photos and cost`}
        style={{ fontSize: small ? 10 : 10.5, fontWeight: 700, color: '#9a3412', background: '#ffedd5', padding: small ? '3px 8px' : '4px 9px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(href(j.id)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); router.push(href(j.id)); } }}>
        {/* A job covering several kinds of work is titled "Restoration — Unit …" and files under its first kind. */}
        {j.title?.startsWith('Restoration —') ? 'Restoration' : (j.type ?? 'Restoration')} · {RESTORATION_STAGE[j.stage] ?? j.stage}
      </span>
    ));
  };
  // The unit's restoration history — how many times, and what it has cost so far.
  const restorationHistory = (u: UnitRecord) => {
    const r = restoration[u.id];
    if (!r?.timesRestored) return null;
    const last = r.lastCompletedAt ? new Date(r.lastCompletedAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, month: 'short', year: 'numeric' }) : null;
    return (
      <div className="truncate" style={{ fontSize: 11.5, color: '#9a3412', marginTop: 6, fontWeight: 600 }}>
        Restored {r.timesRestored === 1 ? 'once' : `${r.timesRestored} times`} · {r.totalCostAed > 0 ? `AED ${aed(r.totalCostAed)} spent` : 'no bills recorded'}{last ? ` · last ${last}` : ''}
      </div>
    );
  };
  // The two pills a lease can carry — a breach and a legal case are independent.
  // The unit row/card is itself clickable (opens the preview), so each pill
  // swallows the click and routes on its own.
  const legalPills = (leaseId: number | null, flag: LeaseFlag | null | undefined, small = false) => {
    if (!leaseId || !flag || (!flag.breach && !flag.dispute)) return null;
    const contractBase = manager ? '/dashboard/manager/contracts' : '/rental-provider/dashboard/contracts';
    const breachHref = `${contractBase}/${leaseId}/v2#sec-breaches`;
    const disputeHref = (id: number) => (manager ? `/dashboard/manager/legal/${id}?rp=${manager.rp}` : `/rental-provider/dashboard/legal/${id}`);
    const pillStyle = (t: { bg: string; fg: string }) => ({
      fontSize: small ? 10 : 10.5, fontWeight: 700, color: t.fg, background: t.bg, padding: small ? '3px 8px' : '4px 9px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' as const,
    });
    return (
      <>
        {flag.breach && (
          <span role="link" tabIndex={0} title="Open the breach on the lease page" style={pillStyle(breachStageTone(flag.breach.stage))}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(breachHref); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); router.push(breachHref); } }}>
            Breach · {flag.breach.label}
          </span>
        )}
        {flag.dispute && (
          <span role="link" tabIndex={0} title="Open the legal case" style={pillStyle(disputeStageTone(flag.dispute.stage))}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(disputeHref(flag.dispute!.id)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); router.push(disputeHref(flag.dispute!.id)); } }}>
            Legal · {flag.dispute.label}
          </span>
        )}
      </>
    );
  };

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

  // Occupied = has a current lease (server-derived), falling back to the flag only
  // on an older payload — so this page and the dashboard count the same units.
  const isOccupied = (u: UnitRecord) => u.occupiedByLease ?? u.availability === 'occupied';
  // LEASED AHEAD (owner, 21 Sep 2026: "we received the PDC, so no need to show it as vacant"):
  // a confirmed lease that has not started counts the unit as occupied everywhere; nobody is
  // in it yet, so the row says from when — and make-ready work can still be raised on it.
  const letNotStarted = (u: UnitRecord) => !!u.nextLeaseStart;
  const someoneInIt = (u: UnitRecord) => isOccupied(u) && !letNotStarted(u);
  const fmtShort = (d: string) => new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' });
  // The STATE of the unit — what a landlord asks first: is it let, being worked on, or ready?
  // (Owner, 21 Sep 2026, on a room whose restoration had just closed and that read "Draft":
  // "it should show ready to lease, right?") The marketplace listing is a separate fact — see listingChip.
  const statusPill = (u: UnitRecord): { label: string; bg: string; fg: string } => {
    if (letNotStarted(u)) return { label: `Leased · from ${fmtShort(u.nextLeaseStart!)}`, bg: '#e0e7ff', fg: '#3730a3' };
    if (isOccupied(u))    return { label: 'Occupied',   bg: '#e0e7ff', fg: '#3730a3' };
    // HELD UNTIL THE MOVE-OUT IS SIGNED (owner, 12 Oct 2026, unit 302: "it should be vacated only
    // once the move-out is signed"): the tenancy ended, but the unit is handed back only by the
    // counter-signed move-out inspection — so it is neither vacant nor ready to lease.
    if (u.moveOutPending) return { label: u.moveOutEndedOn ? `Move-out pending · since ${fmtShort(u.moveOutEndedOn)}` : 'Move-out pending', bg: '#fde68a', fg: '#78350f' };
    if (restoration[u.id]?.open.length) return { label: 'Under restoration', bg: '#ffedd5', fg: '#9a3412' };
    if (u.availability === 'maintenance') return { label: 'Maintenance', bg: '#fef3c7', fg: '#92400e' };
    if (u.availability === 'reserved')    return { label: 'Reserved',   bg: '#fef3c7', fg: '#92400e' };
    return { label: 'Ready to lease', bg: '#d8f2e8', fg: '#1a7a5a' };
  };
  // Listing status only describes a unit that is on the market — so it shows only on one that is
  // ready to lease, and never as the raw 'expired' (which means "taken off because it was let").
  const listingChip = (u: UnitRecord): { label: string; bg: string; fg: string } | null => {
    if (statusPill(u).label !== 'Ready to lease') return null;
    switch (u.listingStatus) {
      case 'published': return { label: 'Listed',            bg: '#eef7f2', fg: '#1a7a5a' };
      case 'pending':   return { label: 'Listing pending',   bg: '#fef3c7', fg: '#92400e' };
      case 'in_review': return { label: 'Listing in review', bg: '#dbeafe', fg: '#1e40af' };
      case 'rejected':  return { label: 'Listing rejected',  bg: '#fee2e2', fg: '#b91c1c' };
      default:          return { label: 'Not listed',        bg: '#f1efe9', fg: '#6b6860' };
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

  // unit-type breakdown (a layout maps to one type) — drives the By-layout groups
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
      priceFrom: null, rentFrom: null, rentTo: null, aedPerSqft: null,
      securityDeposit: null, adminFee: null, ejariFee: null, commission: null, serviceCharges: null,
      leaseTerms: null, termsVersion: null, unpricedCount: 0, unitCount: 1, sampleUnitId: u.id,
      floorPlanUrl: u.floorPlanUrl ?? null, flags: [],
    } as Plan);

  // The `?unit=` deep link, resolved DURING RENDER rather than in an effect.
  // The by-unit view (the default) eagerly loads every in-scope property, so the
  // unit appears here as soon as its property lands — no effect, no extra render
  // pass, and no setState-in-effect. If the id matches nothing in scope (a stale
  // link, or another landlord's unit) nothing opens and the reader simply lands
  // on the workspace.
  const deepLinkUnit = deepLinkUnitId == null ? null
    : Object.values(unitsByProperty).flat().find(u => u.id === deepLinkUnitId) ?? null;
  // An explicitly-opened preview wins; the deep link is only the initial one.
  // Closing clears BOTH, so a dismissed deep link cannot re-open itself.
  const activePreview = unitPreview
    ?? (deepLinkUnit ? { plan: planForUnit(deepLinkUnit), unit: deepLinkUnit } : null);
  const closePreview = () => { setUnitPreview(null); setDeepLinkUnitId(null); };

  const inScopePropIds = propertyId != null ? [propertyId] : (data?.properties.map(p => p.id) ?? []);
  const perUnitLoading = mode === 'unit'
    && inScopePropIds.some(pid => unitsByProperty[pid] == null || loadingUnits.has(pid));

  // Map the plan-level Sort onto unit fields so the control stays meaningful.
  const unitSortVal = (u: UnitRecord): number | null => {
    switch (sortField) {
      case 'sqft':   return u.unitSizeSqft ?? null;
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

  // Status buckets for the By-unit status tabs (mock's three buckets): occupied
  // wins, then a live "published" listing, else "Draft" (anything not yet live).
  const unitBucket = (u: UnitRecord): 'Occupied' | 'Published' | 'Draft' =>
    isOccupied(u) || !!u.moveOutPending ? 'Occupied'
    : u.listingStatus === 'published' ? 'Published'
    : 'Draft';
  const statusCounts = scopedUnitRows.reduce(
    (m, { u }) => { m[unitBucket(u)] += 1; return m; },
    { Occupied: 0, Published: 0, Draft: 0 } as Record<'Occupied' | 'Published' | 'Draft', number>,
  );
  const statusTotal = scopedUnitRows.length;
  const statusVisibleRows = statusFilter === 'All'
    ? scopedUnitRows
    : scopedUnitRows.filter(({ u }) => unitBucket(u) === statusFilter);

  const sortUnitItems = (items: { u: UnitRecord; pl: Plan }[]) => sortField
    ? [...items].sort((a, b) => {
        const av = unitSortVal(a.u), bv = unitSortVal(b.u);
        if (av == null && bv == null) return byUnitNumber(a.u, b.u);
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sortDir;
      })
    : [...items].sort((a, b) => byUnitNumber(a.u, b.u));

  // Group the status-visible units under their BUILDING (largest group first);
  // each group is ordered by the active Sort, falling back to unit number.
  const unitGroups = Object.entries(
    statusVisibleRows.reduce<Record<string, { u: UnitRecord; pl: Plan }[]>>((m, r) => {
      const b = r.pl.buildingName || 'Other'; (m[b] ??= []).push(r); return m;
    }, {}),
  ).map(([building, items]) => ({ building, items: sortUnitItems(items) }))
   .sort((a, b) => b.items.length - a.items.length);

  // ── shared bits, reused by both the grid card and the row ──────────────
  // Pricing flags shown as per-row badges (mock: amber "Doesn't scale" etc.;
  // unpriced is red).
  const flagBadges = (p: Plan) => p.flags.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {FLAG_ORDER.filter(f => p.flags.includes(f)).map(f => (
        <span key={f} title={FLAG_META[f].tip(p)} className="cursor-help"
          style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7,
            ...(f === 'unpriced' ? { color: '#b91c1c', background: '#fdecec' } : { color: '#b07415', background: '#fbf0dd' }) }}>
          {FLAG_META[f].label}
        </span>
      ))}
    </div>
  );

  // Floating view / replace floor-plan controls on a layout thumbnail.
  const imageActions = (p: Plan, isUploading: boolean) => (
    <div className="flex gap-1.5">
      {p.floorPlanUrl && (
        <button onClick={(e) => { e.stopPropagation(); setViewer({ url: p.floorPlanUrl!, name: `${p.buildingName} ${p.displayName}` }); }}
          title="View full floor plan" className="flex items-center justify-center hover:bg-white"
          style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.95)', color: '#5a635c', boxShadow: '0 2px 6px rgba(20,40,30,.1)', border: '1px solid #e2e7e1' }}>
          <Maximize size={13} />
        </button>
      )}
      {canEdit && (
        <button onClick={(e) => { e.stopPropagation(); pickImage(p); }} disabled={isUploading}
          title="Replace floor plan (applies to all units on this plan)" className="flex items-center justify-center hover:bg-white disabled:opacity-60"
          style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.95)', color: '#5a635c', boxShadow: '0 2px 6px rgba(20,40,30,.1)', border: '1px solid #e2e7e1' }}>
          {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
        </button>
      )}
    </div>
  );

  // Annual rent (right) + an "Edit" pill that opens the combined plan-wide
  // pricing & financial-details editor (one place — no separate pricing flow).
  const priceBlock = (p: Plan) => (
    <div className="flex items-end justify-between gap-3">
      <div>
        {/* Plan-wide TOTALS across the layout's units — not a per-unit range.
            Market Rent = Σ every unit's asking rent; Annual Rent = Σ each
            leased unit's latest-lease annual rent. */}
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>
          MARKET RENT{p.unitCount > 1 ? ` · ${p.unitCount} UNITS` : ''}
        </div>
        {p.rentSum != null && p.rentSum > 0 ? (
          <div style={{ fontSize: 18, fontWeight: 800, color: GREEN_D, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>
            AED {aed(p.rentSum)}
            <span style={{ fontSize: 12, fontWeight: 600, color: MUTE2 }}> /yr</span>
          </div>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 700, color: '#b91c1c' }}>No price set</div>
        )}
        {/* Contracted Annual Rent — sum of each leased unit's latest lease. */}
        <div style={{ fontSize: 11.5, color: MUTE, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
          {p.annualRentSum != null
            ? <>Annual rent <span style={{ fontWeight: 700, color: '#3a443d' }}>AED {aed(p.annualRentSum)}</span></>
            : <span style={{ color: '#aab2ab' }}>No lease yet</span>}
        </div>
      </div>
      {canEdit && (
        <button onClick={(e) => { e.stopPropagation(); openLayoutEdit(p); }} className="flex items-center gap-1.5 whitespace-nowrap shrink-0"
          style={{ fontSize: 13, fontWeight: 700, color: GREEN_D, background: GREEN_T, border: '1px solid #cce6d8', padding: '9px 15px', borderRadius: 10 }}>
          <Pencil size={13} /> {p.rentFrom != null ? 'Edit' : 'Set price'}
        </button>
      )}
    </div>
  );

  // ── one layout card, in each view ────────────────────────────────────
  const gridCard = (p: Plan) => {
    const isUploading = uploadingPlan === planKey(p);
    return (
      <div key={planKey(p)} onClick={() => openLayoutPreview(p)} title="View layout details" className="flex flex-col overflow-hidden"
        style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 15, boxShadow: '0 1px 2px rgba(20,40,30,.03)', cursor: 'pointer' }}>
        {/* Floor-plan drawing */}
        <div className="relative overflow-hidden" style={{ height: 128, background: THUMB_BG, borderBottom: '1px dashed #e0e6df' }}>
          <PlanThumb url={p.floorPlanUrl} alt={p.displayName} />
          <div className="absolute" style={{ top: 10, right: 10 }}>{imageActions(p, isUploading)}</div>
          {p.flags.length > 0 && <div className="absolute" style={{ top: 10, left: 10 }}>{flagBadges(p)}</div>}
        </div>

        {/* Body */}
        <div className="flex flex-col flex-1" style={{ padding: '14px 16px' }}>
          <div className="flex items-center gap-2">
            <span className="truncate" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', color: INK, flex: 1, minWidth: 0 }}>
              {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` · ${p.bathrooms} Bath` : ''}
            </span>
            <span className="shrink-0" style={UNITS_CHIP}>{p.unitCount} {p.unitCount === 1 ? 'unit' : 'units'}</span>
          </div>
          <div className="truncate" style={{ fontSize: 12, color: MUTE, marginTop: 5 }}>{p.buildingName} · {p.planLabel}</div>
          <div className="flex items-center gap-3.5" style={{ marginTop: 11, fontSize: 12, color: '#6b756f', fontWeight: 600 }}>
            {p.bedrooms != null && (<span className="inline-flex items-center gap-1"><BedDouble size={13} style={{ color: ICON_MUTE }} />{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} BR`}</span>)}
            {p.bathrooms != null && (<span className="inline-flex items-center gap-1"><Bath size={13} style={{ color: ICON_MUTE }} />{p.bathrooms} Bath</span>)}
            <span className="inline-flex items-center gap-1"><Maximize2 size={13} style={{ color: ICON_MUTE }} />{sizeLabel(p.sqftMin, p.sqftMax)} sqft</span>
          </div>
          <div className="mt-auto" style={{ paddingTop: 13, marginTop: 14, borderTop: '1px solid #f1f3f0' }}>
            {priceBlock(p)}
          </div>
        </div>
      </div>
    );
  };

  const rowCard = (p: Plan) => {
    const isUploading = uploadingPlan === planKey(p);
    return (
      <div key={planKey(p)} onClick={() => openLayoutPreview(p)} title="View layout details" className="flex items-center gap-4"
        style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 15, padding: '16px 18px', boxShadow: '0 1px 2px rgba(20,40,30,.03)', cursor: 'pointer' }}>
        {/* Floor-plan thumbnail */}
        <div className="relative shrink-0 overflow-hidden" style={{ width: 84, height: 66, borderRadius: 11, background: THUMB_BG, border: '1px dashed #d6ddd6' }}>
          <PlanThumb url={p.floorPlanUrl} alt={p.displayName} />
          <div className="absolute bottom-1 right-1">{imageActions(p, isUploading)}</div>
        </div>

        {/* Identity + stats + flags */}
        <div className="flex flex-col justify-center min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em', color: INK }}>
              {bedLabel(p.bedrooms)}{p.bathrooms != null ? ` · ${p.bathrooms} Bath` : ''}
            </span>
            <span className="shrink-0" style={UNITS_CHIP}>{p.unitCount} {p.unitCount === 1 ? 'unit' : 'units'}</span>
          </div>
          <div className="truncate" style={{ fontSize: 12.5, color: MUTE, marginTop: 5 }}>{p.buildingName} · {p.planLabel}</div>
          <div className="flex items-center gap-4" style={{ marginTop: 9, fontSize: 12.5, color: '#6b756f', fontWeight: 600 }}>
            {p.bedrooms != null && (<span className="inline-flex items-center gap-1.5"><BedDouble size={14} style={{ color: ICON_MUTE }} />{p.bedrooms === 0 ? 'Studio' : `${p.bedrooms} BR`}</span>)}
            {p.bathrooms != null && (<span className="inline-flex items-center gap-1.5"><Bath size={14} style={{ color: ICON_MUTE }} />{p.bathrooms} Bath</span>)}
            <span className="inline-flex items-center gap-1.5"><Maximize2 size={14} style={{ color: ICON_MUTE }} />{sizeLabel(p.sqftMin, p.sqftMax)} sqft</span>
          </div>
          {p.flags.length > 0 && <div style={{ marginTop: 9 }}>{flagBadges(p)}</div>}
        </div>

        {/* Pricing */}
        <div className="shrink-0" style={{ width: 300, maxWidth: '42%' }}>{priceBlock(p)}</div>
      </div>
    );
  };

  // Per-unit display bits shared by the row and the grid card.
  const unitMeta = (u: UnitRecord) => {
    const contract = contracts.find(c => c.unit?.id === u.id && c.contractActive) ?? null;
    const tenant = contract?.tenant?.name ?? null;
    const fmtLease = (d: string | null | undefined) =>
      d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : null;
    const start = fmtLease(contract?.startDate);
    const end = fmtLease(contract?.endDate);
    const leaseRange = start && end ? `${start} → ${end}` : start ? `from ${start}` : end ? `until ${end}` : '';
    const size = u.unitSizeSqft ? `${Number(u.unitSizeSqft).toLocaleString()} sqft`
      : u.unitSizeSqm ? `${Number(u.unitSizeSqm).toLocaleString()} sqm` : null;
    // Annual Rent = the income-counting lease (running today, or the next term
    // whose cheques are collected) — an ended / terminated lease or a draft
    // nobody has paid for is already excluded by the rule behind
    // `currentLeaseRent` (LEASE_COUNTS_SQL), which is what the portfolio KPI, the
    // Unit Mix and the Portfolio report all read. A unit with no such lease shows
    // "No lease yet".
    //
    // NOT re-gated on `availability === 'occupied'`. The flag is a cache of the
    // lease, written when the cheques are collected; where the two disagree the
    // lease is the fact, and re-testing the flag here made this page the only
    // surface showing a paid-for unit as earning nothing.
    const annual = u.currentLeaseRent ?? null;
    const leaseId = contract?.id ?? null;
    return { tenant, leaseRange, pill: statusPill(u), size, price: u.rentalPrice, annual, busy: busyUnit === u.id, leaseId, flag: leaseId ? leaseFlags[String(leaseId)] : null };
  };

  // Listing / edit / delete actions — shared by the unit row and card. (The row
  // and unit number already open the read-only preview, so there's no separate
  // "View" button; the mock leads with the "Edit" pill.)
  const unitActions = (p: Plan, u: UnitRecord, busy: boolean) => (
    <>
      {canPublish && u.availability === 'available' && !letNotStarted(u) && !restoration[u.id]?.open.length && (u.listingStatus === 'draft' || u.listingStatus === 'expired' || u.listingStatus === 'rejected') && (
        <button disabled={busy} onClick={(e) => { e.stopPropagation(); onListingAction(p.propertyId, u.id, 'submit-listing'); }}
          className="shrink-0 disabled:opacity-50" style={{ fontSize: 11.5, fontWeight: 700, color: GREEN_D, background: GREEN_T2, padding: '7px 11px', borderRadius: 9 }}>
          {u.listingStatus === 'expired' ? 'Relist' : u.listingStatus === 'rejected' ? 'Resubmit' : 'Submit'}
        </button>
      )}
      {canPublish && u.availability === 'available' && !letNotStarted(u) && (u.listingStatus === 'pending' || u.listingStatus === 'in_review') && (
        <button disabled={busy} onClick={(e) => { e.stopPropagation(); onListingAction(p.propertyId, u.id, 'withdraw-listing'); }}
          className="shrink-0 disabled:opacity-50" style={{ fontSize: 11.5, fontWeight: 700, color: '#6b756f', background: '#eef1ec', padding: '7px 11px', borderRadius: 9 }}>
          Withdraw
        </button>
      )}
      {canMaintain && !someoneInIt(u) && !restoration[u.id]?.open.length && restorationTypes.length > 0 && (
        <button onClick={(e) => { e.stopPropagation(); setStartRestoration({ plan: p, unit: u }); }}
          title="Raise a restoration job on this vacant unit" className="shrink-0"
          style={{ fontSize: 11.5, fontWeight: 700, color: '#9a3412', background: '#ffedd5', padding: '7px 11px', borderRadius: 9 }}>
          Start restoration
        </button>
      )}
      {canEdit && (
        <button onClick={(e) => { e.stopPropagation(); setUnitModal({ plan: p, editingUnit: u }); }} title="Edit unit"
          className="flex items-center gap-1.5 shrink-0"
          style={{ fontSize: 13, fontWeight: 700, color: GREEN_D, background: GREEN_T, border: '1px solid #cce6d8', padding: '9px 14px', borderRadius: 10 }}>
          <Pencil size={13} /> Edit
        </button>
      )}
      {canEdit && (confirmDelete === u.id ? (
        <span className="flex items-center gap-1 shrink-0">
          <button disabled={busy} onClick={(e) => { e.stopPropagation(); onDeleteUnit(p.propertyId, u.id); }}
            className="disabled:opacity-50" style={{ fontSize: 11.5, fontWeight: 700, color: '#b91c1c', background: '#fdecec', padding: '7px 10px', borderRadius: 9 }}>
            {busy ? '…' : 'Delete'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
            style={{ fontSize: 11.5, fontWeight: 700, color: '#6b756f', background: '#eef1ec', padding: '7px 10px', borderRadius: 9 }}>No</button>
        </span>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(u.id); }} title="Delete unit"
          className="flex items-center justify-center shrink-0" style={{ width: 34, height: 34, borderRadius: 9, color: '#b91c1c', background: '#fff', border: '1px solid #f1d5d5' }}>
          <Trash2 size={14} />
        </button>
      ))}
    </>
  );

  // Sub-line for a unit row/card: building (when rows span properties) · name ·
  // type · plan.
  const unitSub = (p: Plan, u: UnitRecord, showBuilding: boolean) =>
    [showBuilding && p.buildingName ? p.buildingName : null, u.unitName || null,
      u.unitType.replace(/_/g, ' '), u.planLabel || null].filter(Boolean).join(' · ');

  // One unit row — used in the per-unit row view (`showBuilding` adds the
  // building name, since rows can span properties).
  const unitRow = (p: Plan, u: UnitRecord, showBuilding = false) => {
    const { tenant, leaseRange, pill, size, price, annual, busy, leaseId, flag } = unitMeta(u);
    return (
      <div key={u.id} onClick={() => setUnitPreview({ plan: p, unit: u })} title="View full unit details"
        className="flex items-center gap-4 cursor-pointer transition-colors hover:border-[#cfe7da]"
        style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 15, padding: '16px 18px', boxShadow: '0 1px 2px rgba(20,40,30,.03)' }}>
        {/* Photo / floor-plan thumbnail */}
        <div className="relative shrink-0 overflow-hidden" style={{ width: 84, height: 66, borderRadius: 11, background: THUMB_BG, border: '1px dashed #d6ddd6' }}>
          <PlanThumb url={u.floorPlanUrl ?? p.floorPlanUrl} alt={u.unitNumber} emptyLabel="No photo" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: '-.01em', color: INK }}>Unit {u.unitNumber}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: pill.fg, background: pill.bg, padding: '5px 11px', borderRadius: 8 }}>{pill.label}</span>
            {listingChip(u) && <span style={{ fontSize: 10.5, fontWeight: 700, color: listingChip(u)!.fg, background: listingChip(u)!.bg, padding: '4px 9px', borderRadius: 7 }}>{listingChip(u)!.label}</span>}
            {restorationPills(u)}
            {legalPills(leaseId, flag)}
          </div>
          <div className="truncate" style={{ fontSize: 12.5, color: MUTE, marginTop: 5 }}>{unitSub(p, u, showBuilding)}</div>
          <div className="flex items-center gap-4" style={{ marginTop: 9, fontSize: 12.5, color: '#6b756f', fontWeight: 600 }}>
            {u.bedrooms != null && <span className="inline-flex items-center gap-1.5"><BedDouble size={14} style={{ color: ICON_MUTE }} />{u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} BR`}</span>}
            {u.bathrooms != null && <span className="inline-flex items-center gap-1.5"><Bath size={14} style={{ color: ICON_MUTE }} />{u.bathrooms} Bath</span>}
            {size && <span className="inline-flex items-center gap-1.5"><Maximize2 size={14} style={{ color: ICON_MUTE }} />{size}</span>}
          </div>
          {tenant && <div className="truncate" style={{ fontSize: 11.5, color: MUTE2, marginTop: 6 }}>{tenant}{leaseRange ? ` · ${leaseRange}` : ''}</div>}
          {restorationHistory(u)}
        </div>
        {/* Market Rent (asking) + contracted Annual Rent (latest lease) —
            mirrors the portfolio's per-property pairing. */}
        <div className="text-right shrink-0">
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>MARKET RENT</div>
          {price != null
            ? <div style={{ fontSize: 18, fontWeight: 800, color: GREEN_D, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em' }}>AED {aed(Number(price))} <span style={{ fontSize: 12, fontWeight: 600, color: MUTE2 }}>/yr</span></div>
            : <div style={{ fontSize: 14, fontWeight: 700, color: '#aab2ab' }}>No price set</div>}
          <div style={{ fontSize: 11.5, color: MUTE, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
            {annual != null
              ? <>Annual rent <span style={{ fontWeight: 700, color: '#3a443d' }}>AED {aed(Number(annual))}</span></>
              : <span style={{ color: '#aab2ab' }}>No lease yet</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {unitActions(p, u, busy)}
        </div>
      </div>
    );
  };

  // One unit as a card — used in the per-unit grid view.
  const unitCard = (p: Plan, u: UnitRecord, showBuilding = false) => {
    const { tenant, leaseRange, pill, size, price, annual, busy, leaseId, flag } = unitMeta(u);
    return (
      <div key={u.id} onClick={() => setUnitPreview({ plan: p, unit: u })} title="View full unit details"
        className="flex flex-col overflow-hidden cursor-pointer"
        style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 15, boxShadow: '0 1px 2px rgba(20,40,30,.03)' }}>
        {/* Photo / floor-plan thumbnail */}
        <div className="relative overflow-hidden" style={{ height: 128, background: THUMB_BG, borderBottom: '1px dashed #e0e6df' }}>
          <PlanThumb url={u.floorPlanUrl ?? p.floorPlanUrl} alt={u.unitNumber} emptyLabel="No photo" />
          <span className="absolute" style={{ top: 10, left: 10, fontSize: 11, fontWeight: 700, color: pill.fg, background: pill.bg, padding: '5px 11px', borderRadius: 8 }}>{pill.label}</span>
        </div>
        {/* Body */}
        <div className="flex flex-col flex-1" style={{ padding: '14px 16px' }}>
          <div className="truncate" style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-.01em', color: INK }}>Unit {u.unitNumber}</div>
          {(flag?.breach || flag?.dispute) && (
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>{legalPills(leaseId, flag, true)}</div>
          )}
          {!!restoration[u.id]?.open.length && !someoneInIt(u) && (
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>{restorationPills(u, true)}</div>
          )}
          <div className="truncate" style={{ fontSize: 12, color: MUTE, marginTop: 5 }}>{unitSub(p, u, showBuilding)}</div>
          <div className="flex items-center gap-3.5" style={{ marginTop: 11, fontSize: 12, color: '#6b756f', fontWeight: 600 }}>
            {u.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={13} style={{ color: ICON_MUTE }} />{u.bedrooms === 0 ? 'Studio' : `${u.bedrooms} BR`}</span>}
            {u.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={13} style={{ color: ICON_MUTE }} />{u.bathrooms} Bath</span>}
            {size && <span className="inline-flex items-center gap-1"><Maximize2 size={13} style={{ color: ICON_MUTE }} />{size}</span>}
          </div>
          {tenant && <div className="truncate" style={{ fontSize: 11, color: MUTE2, marginTop: 6 }}>{tenant}{leaseRange ? ` · ${leaseRange}` : ''}</div>}
          {restorationHistory(u)}
          <div className="mt-auto flex items-end justify-between gap-2" style={{ paddingTop: 13, marginTop: 14, borderTop: '1px solid #f1f3f0' }}>
            {/* Market Rent (asking) + contracted Annual Rent (latest lease). */}
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.06em', color: '#a0a8a1' }}>MARKET RENT</div>
              {price != null
                ? <div style={{ fontSize: 17, fontWeight: 800, color: GREEN_D, fontVariantNumeric: 'tabular-nums' }}>AED {aed(Number(price))} <span style={{ fontSize: 11, fontWeight: 600, color: MUTE2 }}>/yr</span></div>
                : <div style={{ fontSize: 13, fontWeight: 700, color: '#aab2ab' }}>No price set</div>}
              <div style={{ fontSize: 11, color: MUTE, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {annual != null
                  ? <>Annual rent <span style={{ fontWeight: 700, color: '#3a443d' }}>AED {aed(Number(annual))}</span></>
                  : <span style={{ color: '#aab2ab' }}>No lease yet</span>}
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>{unitActions(p, u, busy)}</div>
          </div>
        </div>
      </div>
    );
  };

  const loadingRow = (text: string, small = false) => (
    <div className="flex items-center justify-center gap-2" style={{ padding: small ? '8px 0' : '80px 0', fontSize: 13.5, color: MUTE2 }}>
      <Loader2 size={16} className="animate-spin" /> {text}
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: '#f2f4f1', color: INK }}>
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFile} />

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '26px 28px' }}>
        {/* HEADER */}
        <div className="flex items-start gap-4 flex-wrap" style={{ marginBottom: 20 }}>
          <div className="flex-1" style={{ minWidth: 200 }}>
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: GREEN_D }}>
              <Layers size={13} /> UNITS &amp; PRICING
            </div>
            <h1 style={{ margin: '6px 0 0', fontSize: 30, fontWeight: 800, letterSpacing: '-.025em', color: INK }}>My Units</h1>
            {/* This period's market rate review — the rates in the unit mix are reviewed on the landlord's schedule before renewal offers go out (owner, 7 Oct 2026). */}
            <MarketRateReviewNote rpQ={rpQ || undefined} />
          </div>
          {/* Bulk add-units wizard. Managers land on the same wizard scoped to the
              acting landlord (?rp) via the manager route re-export. Gated by the
              manager's edit permission on this landlord. */}
          {canEdit && (
            <Link
              href={manager ? `/dashboard/manager/units/add?rp=${manager.rp}` : '/rental-provider/dashboard/units/add'}
              className="flex items-center gap-2 shrink-0"
              style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: GREEN, padding: '11px 18px', borderRadius: 11, boxShadow: '0 6px 16px rgba(46,159,100,.26)' }}>
              <Plus size={16} /> Add units
            </Link>
          )}
        </div>

        {/* CONTROLS — By unit / By layout · sort · grid/list */}
        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 14 }}>
          <div className="inline-flex" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 11, padding: 4, gap: 3 }}>
            {([['unit', 'By unit'], ['type', 'By layout']] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                style={{ fontSize: 13.5, fontWeight: 700, padding: '8px 16px', borderRadius: 8,
                  ...(mode === m ? { color: INK, background: '#f2f4f1' } : { color: '#7d8780', background: 'transparent' }) }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <Select label="Sort" value={sort} onChange={setSort} options={SORT_OPTIONS} />
          <div className="inline-flex" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 11, padding: 4, gap: 3 }}>
            {([['grid', LayoutGrid, 'Grid'], ['row', Rows3, 'Rows']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)} title={`${label} view`} aria-label={`${label} view`} aria-pressed={view === v}
                className="flex items-center justify-center"
                style={{ width: 34, height: 34, borderRadius: 8, ...(view === v ? { background: GREEN, color: '#fff' } : { color: MUTE2 }) }}>
                <Icon size={17} />
              </button>
            ))}
          </div>
        </div>

        {/* FILTERS — search · property · type · plan */}
        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 16 }}>
          <div className="relative" style={{ flex: '1 1 240px', minWidth: 200 }}>
            <Search size={16} className="absolute pointer-events-none" style={{ left: 13, top: '50%', transform: 'translateY(-50%)', color: MUTE2 }} />
            <input type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder={mode === 'unit' ? 'Search units…' : 'Search layouts…'}
              aria-label={mode === 'unit' ? 'Search units' : 'Search layouts'}
              className="w-full outline-none"
              style={{ fontSize: 14, color: INK, background: '#fff', border: '1px solid #e2e7e1', borderRadius: 11, padding: '11px 14px 11px 38px' }} />
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

        {/* STATUS BAR (By unit) — status filter tabs + a visual draft indicator. */}
        {!loading && mode === 'unit' && scopedUnitRows.length > 0 && (
          <div className="flex items-center gap-2.5 flex-wrap" style={{ marginBottom: 18 }}>
            {([
              { key: 'All', label: 'All units', count: statusTotal, dot: '#cdd5cf' },
              { key: 'Occupied', label: 'Occupied', count: statusCounts.Occupied, dot: '#4a5a8f' },
              { key: 'Published', label: 'Published', count: statusCounts.Published, dot: GREEN },
              { key: 'Draft', label: 'Draft', count: statusCounts.Draft, dot: '#b0b8b1' },
            ] as const).map(s => {
              const on = statusFilter === s.key;
              return (
                <button key={s.key} onClick={() => setStatusFilter(s.key)} className="inline-flex items-center gap-2"
                  style={{ fontSize: 13, fontWeight: 700, padding: '9px 15px', borderRadius: 11,
                    border: `1px solid ${on ? GREEN : LINE}`, background: on ? GREEN_T : '#fff', color: on ? GREEN_D : '#3a443d' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, flex: '0 0 8px' }} />
                  <span>{s.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: on ? GREEN_D : INK, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                </button>
              );
            })}
            <div className="flex-1" />
            {statusCounts.Draft > 0 && (
              <span className="inline-flex items-center gap-2" title="Draft units are not yet listed"
                style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: GREEN, padding: '9px 16px', borderRadius: 10, boxShadow: '0 4px 12px rgba(46,159,100,.22)' }}>
                <ArrowUp size={15} /> {statusCounts.Draft} draft{statusCounts.Draft === 1 ? '' : 's'} to publish
              </span>
            )}
          </div>
        )}

        {/* PRICING HEALTH (By layout) — summary band kept; flags also badge each row. */}
        {!loading && mode === 'type' && plans.length > 0 && (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, boxShadow: '0 1px 2px rgba(20,40,30,.03)' }}>
            {flagged === 0 ? (
              <div className="flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 600, color: GREEN_D }}>
                <Check size={16} /> No pricing gaps on the shown layouts.
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5" style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>
                  <AlertTriangle size={15} style={{ color: '#d97706' }} />
                  {flagged} of {plans.length} layouts need a pricing look
                </span>
                <span style={{ color: '#d8d6d0' }}>·</span>
                {counts.map(c => (
                  <span key={c.f} style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 7,
                    ...(c.f === 'unpriced' ? { color: '#b91c1c', background: '#fdecec' } : { color: '#b07415', background: '#fbf0dd' }) }}>
                    {c.n} {FLAG_META[c.f].label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="flex items-center gap-2" style={{ background: '#fdecec', color: '#b91c1c', borderRadius: 11, padding: '10px 16px', fontSize: 13.5, marginBottom: 16 }}>
            <Info size={15} /> {err}
          </div>
        )}

        {/* GROUPS — By unit (grouped by building) / By layout (grouped by type) */}
        {loading ? (
          loadingRow('Loading layouts…')
        ) : mode === 'unit' ? (
          // ── Per-unit (flat) view — units grouped under their building ──
          scopedUnitRows.length === 0 ? (
            perUnitLoading ? loadingRow('Loading units…') : (
              <div className="text-center" style={{ padding: '80px 0' }}>
                <Layers size={32} className="mx-auto" style={{ color: '#c5c3bc', marginBottom: 12 }} />
                <p style={{ fontSize: 13.5, color: MUTE2 }}>
                  {q ? `No units match “${query.trim()}”.`
                    : typeFilter !== 'all' ? `No ${typeLabel(typeFilter === 'other' ? null : typeFilter)} units in this scope.`
                    : 'No units found for this scope.'}
                </p>
              </div>
            )
          ) : statusVisibleRows.length === 0 ? (
            <div className="text-center" style={{ padding: '56px 0', fontSize: 13.5, color: MUTE2 }}>
              No {statusFilter.toLowerCase()} units in this scope.
            </div>
          ) : (
            <>
              {unitGroups.map(g => (
                <section key={g.building} style={{ marginBottom: 26 }}>
                  <div className="flex items-center gap-3" style={{ margin: '6px 0 12px' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.01em', color: INK }}>{g.building}</div>
                    <span style={CHIP_COUNT}>{g.items.length} {g.items.length === 1 ? 'unit' : 'units'}</span>
                    {/* Adding units happens from the single header action only — the
                        per-building buttons repeated the same call to action. */}
                  </div>
                  {view === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 14 }}>
                      {g.items.map(({ u, pl }) => unitCard(pl, u, propertyId == null))}
                    </div>
                  ) : (
                    <div className="flex flex-col" style={{ gap: 12 }}>
                      {g.items.map(({ u, pl }) => unitRow(pl, u, propertyId == null))}
                    </div>
                  )}
                </section>
              ))}
              {perUnitLoading && loadingRow('Loading more units…', true)}
            </>
          )
        ) : plans.length === 0 ? (
          <div className="text-center" style={{ padding: '80px 0' }}>
            <Layers size={32} className="mx-auto" style={{ color: '#c5c3bc', marginBottom: 12 }} />
            <p style={{ fontSize: 13.5, color: MUTE2 }}>
              {q ? `No layouts match “${query.trim()}”.`
                : typeFilter !== 'all' ? `No ${typeLabel(typeFilter === 'other' ? null : typeFilter)} layouts in this scope.`
                : 'No layout plans found for this scope.'}
            </p>
          </div>
        ) : (
          groups.map(g => (
            <section key={g.unitType} style={{ marginBottom: 26 }}>
              <div className="flex items-center gap-3" style={{ margin: '6px 0 12px' }}>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-.01em', color: INK }}>{typeLabel(g.unitType === 'other' ? null : g.unitType)}</div>
                <span style={CHIP_COUNT}>{g.count} {g.count === 1 ? 'unit' : 'units'}</span>
              </div>
              {view === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: 14 }}>
                  {g.plans.map(p => gridCard(p))}
                </div>
              ) : (
                <div className="flex flex-col" style={{ gap: 12 }}>
                  {g.plans.map(p => rowCard(p))}
                </div>
              )}
            </section>
          ))
        )}
      </div>

      {/* Plan-wide financial-details editor */}
      {/* By-layout Edit — the full editor, identical to the portfolio Unit Mix → Edit. */}
      {editLayout && (() => {
        const plan = editLayout;
        const rep = (unitsByProperty[plan.propertyId] ?? []).find(u => (u.planLabel ?? '') === (plan.planLabel ?? ''));
        if (!rep) return null;
        return (
          <UnitFormModal
            open
            layoutBulk
            layoutUnitCount={plan.unitCount}
            title="Edit layout"
            propertyCategory={plan.spaceCategory ?? ''}
            leasingType={leasingByProperty.get(plan.propertyId) ?? null}
            propertyStandalone
            propertyId={plan.propertyId}
            planLabel={plan.planLabel}
            manager={manager}
            rpQ={rpQ}
            feeRules={data?.feeRules ?? null}
            existingFloorPlanUrl={plan.floorPlanUrl ?? null}
            initial={unitToFormInitial(rep)}
            seedAddendumTerms={plan.termsVersion?.addendumTerms ?? null}
            hasAddendumFile={!!plan.termsVersion?.addendumUrl}
            onAddendumApplied={reload}
            onSave={async (data, floorPlan) => {
              await saveLayoutDetails({ propertyId: plan.propertyId, planLabel: plan.planLabel ?? '', data, floorPlan, manager: manager ? { rp: manager.rp } : undefined });
              await refreshProperty(plan.propertyId);
            }}
            onClose={() => setEditLayout(null)}
          />
        );
      })()}

      {/* Read-only layout detail popup — same view as the portfolio Unit Mix. */}
      {layoutPreview && (
        <LayoutPreviewModal
          title={layoutPreview.displayName}
          planName={layoutPreview.displayName}
          unitType={layoutPreview.unitType ?? ''}
          bedrooms={layoutPreview.bedrooms}
          plan={layoutPreview}
          units={(unitsByProperty[layoutPreview.propertyId] ?? []).filter(u => (u.planLabel ?? '') === (layoutPreview.planLabel ?? ''))}
          propertyName={layoutPreview.buildingName}
          leasingType={leasingByProperty.get(layoutPreview.propertyId) ?? null}
          canEdit={canEdit && !!layoutPreview.planLabel}
          onEdit={() => { const p = layoutPreview; setLayoutPreview(null); if (p) openLayoutEdit(p); }}
          onClose={() => setLayoutPreview(null)}
        />
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

      {/* Start restoration — ONE job, its task list pre-filled from the last move-out form. */}
      {startRestoration && (
        <StartRestorationDialog
          unit={{ id: startRestoration.unit.id, unitNumber: startRestoration.unit.unitNumber ?? null }}
          maintBase={maintBase} maintQ={maintQ}
          onClose={() => setStartRestoration(null)}
          onStarted={id => { setStartRestoration(null); router.push(manager ? `/dashboard/manager/maintenance/${id}?rp=${manager.rp}` : `/rental-provider/dashboard/maintenance/${id}`); }}
        />
      )}

      {/* Per-unit add / edit. The modal closes itself on save. */}
      {unitModal && (
        <UnitFormModal
          open
          propertyCategory={unitModal.plan.spaceCategory ?? ''}
          propertyEmirate={emirateByProperty.get(unitModal.plan.propertyId) ?? null}
          leasingType={leasingByProperty.get(unitModal.plan.propertyId) ?? null}
          title={unitModal.editingUnit ? 'Edit Unit' : 'Add Unit'}
          initial={unitModal.editingUnit ? unitToFormInitial(unitModal.editingUnit) : undefined}
          existingFloorPlanUrl={unitModal.editingUnit?.floorPlanUrl ?? null}
          propertyStandalone={false}
          propertyId={unitModal.plan.propertyId}
          editingUnitId={unitModal.editingUnit?.id}
          feeRules={data?.feeRules ?? null}
          planLabel={unitModal.plan.planLabel}
          manager={manager}
          rpQ={rpQ}
          seedAddendumTerms={unitModal.plan.termsVersion?.addendumTerms ?? null}
          hasAddendumFile={!!unitModal.plan.termsVersion?.addendumUrl}
          onAddendumApplied={reload}
          onClose={() => setUnitModal(null)}
          onSave={(data, floorPlan, titleDeed, addendums) =>
            onSaveUnit(unitModal.plan, unitModal.editingUnit, data, floorPlan, titleDeed, addendums)}
        />
      )}

      {/* Read-only unit preview — opened by a row click, or by `?unit=` on the
          URL (see activePreview). This is where a unit is READ; the standalone
          /dashboard/units/{id} page that used to do it as well is gone. */}
      {activePreview && (
        <UnitPreviewModal
          propertyId={activePreview.plan.propertyId}
          propertyName={activePreview.plan.buildingName}
          leasingType={leasingByProperty.get(activePreview.plan.propertyId) ?? null}
          fetchBase={manager ? '/manager/properties' : undefined}
          fetchQuery={manager ? rpQ : undefined}
          unit={activePreview.unit}
          contract={(() => {
            // Prefer the active lease; else fall back to the most recent contract
            // (the list is sorted createdAt DESC) so a now-vacant unit still shows
            // its last tenancy.
            const forUnit = contracts.filter(x => x.unit?.id === activePreview.unit.id);
            const c = forUnit.find(x => x.contractActive) ?? forUnit[0];
            return c ? { id: c.id, tenantName: c.tenant?.name ?? null, startDate: c.startDate, endDate: c.endDate, status: c.status, active: c.contractActive } : null;
          })()}
          contracts={contracts
            .filter(x => x.unit?.id === activePreview.unit.id)
            .map(c => ({ id: c.id, tenantName: c.tenant?.name ?? null, startDate: c.startDate, endDate: c.endDate, status: c.status, active: c.contractActive }))}
          onEdit={canEdit ? () => { setUnitModal({ plan: activePreview.plan, editingUnit: activePreview.unit }); closePreview(); } : undefined}
          onClose={closePreview}
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
        className="appearance-none bg-white focus:outline-none cursor-pointer"
        style={{ padding: '11px 34px 11px 14px', fontSize: 13.5, fontWeight: 500, border: '1px solid #e2e7e1', borderRadius: 11, color: '#5a635c' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#8d978f' }} />
    </div>
  );
}

// RP portal route — the workspace with the default (RP-scoped) API.
export default function RpUnitsPage() {
  return <UnitsWorkspace />;
}
