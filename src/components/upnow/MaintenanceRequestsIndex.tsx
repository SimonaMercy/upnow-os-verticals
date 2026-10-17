/**
 * MaintenanceRequestsIndex — every maintenance request the landlord side has
 * ever handled, in one table: Open (what the Operations board shows) ·
 * Completed (closed out — left the board) · Ended (declined / cancelled).
 * The board is the WORKING view and drops a request the moment it closes;
 * this is where the landlord answers "what did we fix, for whom, at what
 * cost" afterwards. Shared by the RP page and the manager mirror, the way
 * MaintenanceRequestView is.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wrench, ImageIcon, Search, X, Loader2 } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  SCOPE_LABEL, SCOPE_HINT, maintenancePlace, maintenanceNoCustomerLabel, categoryFits,
  type MaintenanceScope, type PropertyProfile, type MaintenanceCategoryRow,
} from '@/lib/maintenanceScope';

interface Row {
  id: number; ref: string; title: string; stage: string; stageNote: string | null;
  coverage: string | null; holdReason: string | null;
  category: { id: number; name: string } | null;
  /** 0267 — where the work is: a unit, or a named common area / building system. */
  scope?: MaintenanceScope | null; locationLabel?: string | null;
  unit: { id: number; unitNumber: string | null; unitName: string | null } | null;
  property: { id: number; buildingName: string | null } | null;
  customer: { id: number; name: string | null; companyName: string | null; entityType: string | null } | null;
  provider: { id: number; name: string; relationship: string | null } | null;
  booking: { id: number; status: string; payer: string; totalAed: number | null } | null;
  quote: { status: string; totalAed: number } | null;
  costAllocation: string | null; invoiceTotalAed: number | null;
  photoCount?: number; raisedByRole: string | null;
  createdAt: string; closedAt: string | null; cancelledAt: string | null; declinedAt: string | null; updatedAt: string;
}
type Bucket = 'open' | 'completed' | 'ended';
type ScopeFilter = 'all' | MaintenanceScope;

const STAGE: Record<string, string> = {
  requested: 'Requested', awaiting_approval: 'Awaiting approval', in_progress: 'In progress',
  sign_off: 'Sign-off', close_out: 'Close-out', closed: 'Closed', declined: 'Declined', cancelled: 'Cancelled',
};
const COVER: Record<string, string> = { covered: 'Landlord pays', chargeable: 'Customer pays', not_offered: 'Not offered' };
/** Who raised it, in words — never the raw role key. */
const RAISED_BY: Record<string, string> = { rental_provider: 'the landlord', manager: 'a manager', customer: 'the customer', tenant: 'the customer', system: 'the system' };
const STAGE_CHIP: Record<string, { bg: string; fg: string }> = {
  requested: { bg: '#f1f3f1', fg: '#5b615e' }, awaiting_approval: { bg: '#fdf3dc', fg: '#8a5a00' }, in_progress: { bg: '#e9effc', fg: '#2a5bd7' },
  sign_off: { bg: '#ede9fe', fg: '#5b21b6' }, close_out: { bg: '#ede9fe', fg: '#5b21b6' }, closed: { bg: '#e7f4ee', fg: '#1a7a52' },
  declined: { bg: '#fdecec', fg: '#b42318' }, cancelled: { bg: '#f1f3f1', fg: '#5b615e' },
};
const ALLOC: Record<string, string> = { owner: 'Owner', tenant: 'Customer (lease charge)', property_expense: 'Property expense' };
const fmt = (d?: string | null) => d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const aed = (n?: number | null) => n != null ? `AED ${Number(n).toLocaleString('en-AE')}` : '—';
const bucketOf = (r: Row): Bucket => r.stage === 'closed' ? 'completed' : (r.stage === 'declined' || r.stage === 'cancelled') ? 'ended' : 'open';

export function MaintenanceRequestsIndex({ base, rp, detailHref, boardHref }: {
  /** '/maintenance' for the landlord, '/manager/maintenance' for a manager (+ rp). */
  base: string; rp?: number | null;
  detailHref: (id: number) => string;
  boardHref: string;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>('open');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [q, setQ] = useState('');
  const [propFilter, setPropFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const path = `${base}/requests?scope=all${rp != null ? `&rp=${rp}` : ''}`;
    apiGet<Row[]>(path).then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setErr('Could not load maintenance requests.'));
  }, [base, rp]);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { open: 0, completed: 0, ended: 0 };
    for (const r of rows ?? []) c[bucketOf(r)]++;
    return c;
  }, [rows]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter(r => bucketOf(r) === bucket)
      .filter(r => scopeFilter === 'all' || (r.scope ?? 'unit') === scopeFilter)
      .filter(r => !needle || [r.ref, r.title, r.category?.name, r.unit?.unitNumber, r.locationLabel, r.property?.buildingName, r.provider?.name,
        tenantDisplayName({ name: r.customer?.name ?? null, entityType: r.customer?.entityType, companyName: r.customer?.companyName })]
        .some(v => (v ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => new Date(b.closedAt ?? b.updatedAt).getTime() - new Date(a.closedAt ?? a.updatedAt).getTime());
  }, [rows, bucket, scopeFilter, q]);
  const scopeCounts = useMemo(() => {
    const c: Record<ScopeFilter, number> = { all: 0, unit: 0, common_area: 0, building_system: 0 };
    for (const r of rows ?? []) { if (bucketOf(r) !== bucket) continue; c.all++; c[(r.scope ?? 'unit') as MaintenanceScope]++; }
    return c;
  }, [rows, bucket]);


  // ── the page follows its neighbours in the Maintenance section (AMC Contracts, Vendors):
  //    title + one line · main button top-right · four tiles · ONE filter row · compact table.
  const needsYou = (r: Row) => bucketOf(r) === 'open' && (r.stage === 'awaiting_approval' || r.stage === 'sign_off' || r.stage === 'close_out' || (r.stage === 'requested' && !!r.holdReason));
  const kpi = useMemo(() => {
    const all = rows ?? [];
    return {
      open: all.filter(r => bucketOf(r) === 'open').length,
      needsYou: all.filter(needsYou).length,
      completed: all.filter(r => bucketOf(r) === 'completed').length,
      spent: all.filter(r => bucketOf(r) === 'completed').reduce((n, r) => n + (r.invoiceTotalAed ?? 0), 0),
    };
  }, [rows]);
  const propOptions = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows ?? []) if (r.property) m.set(r.property.id, r.property.buildingName ?? `Property #${r.property.id}`);
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]));
  }, [rows]);
  const shown = useMemo(() => list.filter(r => !propFilter || String(r.property?.id ?? '') === propFilter), [list, propFilter]);
  const loading = rows == null && !err;
  const GRID = 'grid grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,.9fr)_70px] gap-3 items-center px-[18px]';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 text-[#1c1f1d]">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.01em]">Maintenance requests</h1>
          <p className="text-[12.5px] text-[#5b615e] mt-1">
            Every repair and restoration job on your buildings — open, completed and cancelled. Open work is also on the{' '}
            <Link href={boardHref} className="text-[#1a7a52] hover:text-[#125a3c] underline font-semibold">Operations board</Link>.
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] whitespace-nowrap cursor-pointer">+ New request</button>
      </div>
      {creating && (
        <NewRequestModal base={base} rp={rp} detailHref={detailHref} onClose={() => setCreating(false)} />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-[22px]">
        {[
          { label: 'Open', value: String(kpi.open), color: '#1a7a52' },
          { label: 'Waiting on you', value: String(kpi.needsYou), color: kpi.needsYou ? '#b42318' : '#1c1f1d' },
          { label: 'Completed', value: String(kpi.completed), color: '#1c1f1d' },
          { label: 'Spent on completed work', value: aed(kpi.spent), color: '#1c1f1d' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e6e8e6] rounded-xl px-4 py-3.5">
            <p className="text-[11px] text-[#5b615e]">{k.label}</p>
            <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: k.color }}>{loading ? '…' : k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <label className="relative w-full sm:w-[260px]">
          <Search size={13} className="absolute left-3 top-[10px] text-[#8a8f8c]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ref, unit, item, provider…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <select value={propFilter} onChange={e => setPropFilter(e.target.value)} title="Filter by property"
          className="py-2 pl-3 pr-8 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full sm:w-auto max-w-[240px]"
          style={propFilter ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All properties</option>
          {propOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {/* 0267 — where the work is: one list, every scope */}
        <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value as ScopeFilter)} title="Where the work is"
          className="py-2 pl-3 pr-8 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full sm:w-auto"
          style={scopeFilter !== 'all' ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="all">All places · {scopeCounts.all}</option>
          <option value="unit">Units · {scopeCounts.unit}</option>
          <option value="common_area">Common areas · {scopeCounts.common_area}</option>
          <option value="building_system">Building systems · {scopeCounts.building_system}</option>
        </select>
        <div className="flex gap-1.5 ml-auto">
          {([['open', `Open · ${counts.open}`], ['completed', `Completed · ${counts.completed}`], ['ended', `Declined & cancelled · ${counts.ended}`]] as ReadonlyArray<readonly [Bucket, string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setBucket(key)}
              className="text-[11px] px-3 py-1.5 rounded-full font-semibold transition-colors cursor-pointer"
              style={bucket === key ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-red-700 bg-[#fef2f2] border border-[#fecaca] rounded-xl px-4 py-2.5 mt-3.5">{err}</p>}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : rows != null && shown.length === 0 ? (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 px-6 py-12 text-center">
          <Wrench size={22} className="mx-auto text-[#b9bdba]" />
          <p className="text-[12.5px] text-[#8a8f8c] mt-2">
            {q.trim() || propFilter || scopeFilter !== 'all' ? 'Nothing matches these filters.'
              : bucket === 'completed' ? 'Nothing completed yet — a request lands here once it is closed.'
              : bucket === 'open' ? 'No open requests.' : 'Nothing declined or cancelled.'}
          </p>
        </div>
      ) : rows != null && (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className={`${GRID} py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]`}>
                <span>REQUEST</span><span>WHERE</span><span>PROVIDER</span><span>{bucket === 'completed' ? 'CLOSED · COST' : bucket === 'ended' ? 'ENDED' : 'COST SO FAR'}</span><span />
              </div>
              {shown.map(r => {
                const st = STAGE_CHIP[r.stage] ?? STAGE_CHIP.requested;
                const who = tenantDisplayName({ name: r.customer?.name ?? null, entityType: r.customer?.entityType, companyName: r.customer?.companyName });
                return (
                  <div key={r.id} onClick={() => router.push(detailHref(r.id))}
                    className={`${GRID} py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 cursor-pointer hover:bg-[#fafbfa]`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{r.title}</span>
                        <span className="text-[10.5px] font-semibold px-2 py-[2px] rounded-full whitespace-nowrap" style={{ background: st.bg, color: st.fg }}>{STAGE[r.stage] ?? r.stage}</span>
                        {needsYou(r) && <span className="text-[10.5px] font-semibold px-2 py-[2px] rounded-full whitespace-nowrap" style={{ background: '#fdecec', color: '#b42318' }}>Waiting on you</span>}
                      </div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">
                        {r.ref} · {r.category?.name ?? 'Maintenance'} · raised {fmt(r.createdAt)}{r.raisedByRole ? ` by ${RAISED_BY[r.raisedByRole] ?? r.raisedByRole}` : ''}
                        {(r.photoCount ?? 0) > 0 && <> · <ImageIcon size={10} className="inline -mt-0.5" /> {r.photoCount}</>}
                        {r.stageNote && r.stageNote !== 'Own team' && <span className="text-[#c47a00]"> · {r.stageNote}</span>}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {maintenancePlace(r)}
                        {(r.scope ?? 'unit') !== 'unit' && <span className="ml-1.5 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eef3f1] text-[#2e6f5e]">{SCOPE_LABEL[r.scope as MaintenanceScope]}</span>}
                      </div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">{[r.property?.buildingName, who ?? maintenanceNoCustomerLabel(r.scope)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate">{r.provider ? r.provider.name : <span className="text-[#c47a00] font-semibold">Not assigned</span>}</div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">
                        {[r.provider?.relationship === 'internal_team' ? 'Own team' : r.provider ? 'Vendor' : null, r.coverage ? COVER[r.coverage] ?? r.coverage : 'Who pays — undecided'].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="min-w-0 whitespace-nowrap">
                      {bucket === 'completed' ? (
                        <>
                          <div className="font-semibold">{aed(r.invoiceTotalAed)}</div>
                          <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">closed {fmt(r.closedAt)}{r.costAllocation ? ` · ${ALLOC[r.costAllocation] ?? r.costAllocation}` : ''}</div>
                        </>
                      ) : bucket === 'ended' ? (
                        <div className="text-[#5b615e]">{fmt(r.declinedAt ?? r.cancelledAt)}</div>
                      ) : (
                        <div className={r.invoiceTotalAed ? 'font-semibold' : 'text-[#b9bdba]'}>{r.invoiceTotalAed ? aed(r.invoiceTotalAed) : '—'}</div>
                      )}
                    </div>
                    <div className="text-right text-[12px] font-semibold text-[#1a7a52] whitespace-nowrap">View →</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Raise a request from the landlord's (or manager's) side — a unit (occupied or
 * vacant: restoration, make-ready), a common area (corridor leak) or a building
 * system (electric room) — every scope, one pipeline (0267). On a unit the lease
 * resolves server-side (running lease if there is one; a vacant unit routes with
 * no occupant, the landlord as the party).
 */
function NewRequestModal({ base, rp, detailHref, onClose }: {
  base: string; rp?: number | null;
  detailHref: (id: number) => string;
  onClose: () => void;
}) {
  const router = useRouter();
  const manager = rp != null;
  const withRp = (p: string) => manager ? `${p}${p.includes('?') ? '&' : '?'}rp=${rp}` : p;

  const [props, setProps] = useState<{ id: number; buildingName: string }[] | null>(null);
  const [cats, setCats] = useState<MaintenanceCategoryRow[]>([]);
  const [scope, setScope] = useState<MaintenanceScope>('unit');
  // 0268 — the building decides the places and the categories on offer.
  const [profile, setProfile] = useState<PropertyProfile | null>(null);
  const [changingForm, setChangingForm] = useState(false);
  const [propertyId, setPropertyId] = useState<number | ''>('');
  const [units, setUnits] = useState<{ id: number; unitNumber?: string | null; unitName?: string | null; displayName?: string | null }[] | null>(null);
  const [unitId, setUnitId] = useState<number | ''>('');
  // Common area / building system: the category IS the place ("Lift", "Roof & waterproofing");
  // an optional line says exactly where ("3rd floor, near lift B").
  const [placeDetail, setPlaceDetail] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [preferredAt, setPreferredAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ id: number; buildingName: string }[]>(withRp(manager ? '/manager/properties' : '/properties'))
      .then(d => setProps(Array.isArray(d) ? d : [])).catch(() => setProps([]));
    apiGet<MaintenanceCategoryRow[]>(withRp(`${base}/categories`))
      .then(d => setCats(Array.isArray(d) ? d : [])).catch(() => setCats([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setUnitId(''); setUnits(null); setProfile(null); setCategoryId(''); setChangingForm(false);
    if (propertyId === '') return;
    apiGet<PropertyProfile>(withRp(`${base}/property-profile/${propertyId}`))
      .then(p => setProfile(p && typeof p === 'object' ? p : null)).catch(() => setProfile(null));
    apiGet<{ id: number; unitNumber?: string | null; unitName?: string | null; displayName?: string | null }[]>(
      withRp(manager ? `/manager/properties/${propertyId}/units` : `/properties/${propertyId}/units`))
      .then(d => setUnits(Array.isArray(d) ? d : [])).catch(() => setUnits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const form = profile?.form ?? null;
  // Only the leaves that fit this scope on this building form; a group shows only when it has leaves left.
  // Landlord-only groups (building systems / common areas / restoration) lead for their scope.
  const leavesOf = (gid: number) => cats.filter(c => c.parentId === gid && categoryFits(c, scope, form));
  const groups = cats.filter(c => c.parentId == null && categoryFits(c, scope, form) && leavesOf(c.id).length > 0)
    .sort((a, b) => Number(b.audience === 'landlord') - Number(a.audience === 'landlord'));
  const commonLabel = profile?.commonLabel ?? SCOPE_LABEL.common_area;
  const scopeLabel = (k: MaintenanceScope) => (k === 'common_area' ? commonLabel : SCOPE_LABEL[k]);
  const scopeHint = (k: MaintenanceScope) => (k === 'common_area' && profile ? profile.commonHint : SCOPE_HINT[k]);
  const setForm = async (key: string) => {
    if (propertyId === '') return;
    try {
      const p = await apiPut<PropertyProfile>(withRp(`${base}/property-profile/${propertyId}`), { buildingForm: key === '' ? null : key });
      setProfile(p); setCategoryId(''); setChangingForm(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not change the building form.'); }
  };
  const unitLabel = (u: { unitNumber?: string | null; unitName?: string | null; displayName?: string | null }) =>
    u.unitNumber ? `Unit ${u.unitNumber}` : (u.unitName ?? u.displayName ?? 'Unit');

  const categoryName = categoryId === '' ? '' : (cats.find(c => c.id === categoryId)?.name ?? '');
  const locationLabel = [categoryName, placeDetail.trim()].filter(Boolean).join(', ').slice(0, 120);

  const submit = async () => {
    if (scope === 'unit') {
      if (unitId === '' || categoryId === '' || !title.trim()) { setErr('Pick the unit and category, and describe the issue.'); return; }
    } else if (propertyId === '' || categoryId === '' || !title.trim()) {
      setErr(`Pick the property and the ${scope === 'common_area' ? 'work' : 'system'}, and describe the issue.`); return;
    }
    setBusy(true); setErr(null);
    try {
      const res = await apiPost<{ id: number }>(withRp(`${base}/requests`), {
        scope,
        ...(scope === 'unit' ? { unitId } : { propertyId, locationLabel }),
        serviceCategoryId: categoryId, title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(preferredAt ? { preferredAt: new Date(preferredAt).toISOString() } : {}),
      });
      router.push(detailHref(res.id));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not raise the request.'); setBusy(false); }
  };

  const field = 'w-full border border-[#e4e9e5] rounded-lg px-3 py-2.5 text-sm bg-white text-[#14201a] focus:outline-none focus:border-[#047246] focus:ring-2 focus:ring-[#047246]/15';
  const label = 'block text-[12px] font-semibold text-[#4a4842] mb-1';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,25,22,0.45)' }}>
      <form className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl"
        onSubmit={e => { e.preventDefault(); if (!busy) void submit(); }}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#f0eee8]">
          <div>
            <h2 className="text-lg font-bold text-[#14201a]">New maintenance request</h2>
            <p className="text-[12.5px] text-[#8a948d] mt-0.5">Raised on your side — a unit, a common area or a building system; it routes through the same pipeline as a customer request.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#8a948d] hover:text-[#14201a] cursor-pointer mt-1" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 grid gap-4">
          {/* 0267 — where is the work? every scope, one pipeline */}
          <div>
            <label className={label} htmlFor="nr-property">Property <span className="text-[#d4553f]">*</span></label>
            <SearchPick id="nr-property" fieldClass={field}
              placeholder={props == null ? 'Loading…' : 'Type to search…'}
              options={props?.map(p => ({ id: p.id, label: p.buildingName })) ?? null}
              value={propertyId} onPick={id => setPropertyId(id)} />
            {/* 0268 — the building form drives places + categories; derived, overridable */}
            {propertyId !== '' && profile && (
              <p className="text-[11.5px] text-[#5f6b63] mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-[#14201a]">{profile.formLabel}</span>
                <span className="text-[#8a948d]">{profile.override ? '· set by you' : '· from its units'}{profile.floors != null ? ` · ${profile.floors} floor${profile.floors === 1 ? '' : 's'}` : ''}</span>
                {changingForm ? (
                  <select className="border border-[#e4e9e5] rounded-md px-1.5 py-0.5 text-[11.5px] bg-white" value={profile.override ?? ''} autoFocus
                    onChange={e => void setForm(e.target.value)} onBlur={() => setChangingForm(false)}>
                    <option value="">Derived — {profile.forms.find(f => f.key === profile.derivedForm)?.label ?? profile.derivedForm}</option>
                    {profile.forms.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                ) : (
                  <button type="button" onClick={() => setChangingForm(true)} className="text-[#1a7a5a] font-semibold underline cursor-pointer">change</button>
                )}
              </p>
            )}
          </div>

          <div>
            <span className={label}>Where <span className="text-[#d4553f]">*</span></span>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#eef1ef]" role="radiogroup" aria-label="Where is the work">
              {(['unit', 'common_area', 'building_system'] as MaintenanceScope[]).map(k => (
                <button key={k} type="button" role="radio" aria-checked={scope === k}
                  onClick={() => { setScope(k); setPlaceDetail(''); setCategoryId(''); }}
                  className={`h-9 rounded-lg text-[12.5px] font-semibold cursor-pointer transition ${scope === k ? 'bg-white text-[#14201a] shadow-sm' : 'text-[#5f6b63] hover:text-[#14201a]'}`}>
                  {scopeLabel(k)}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-[#8a948d] mt-1.5">{scopeHint(scope)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {scope === 'unit' ? (
              <div>
                <label className={label} htmlFor="nr-unit">Unit <span className="text-[#d4553f]">*</span></label>
                <SearchPick id="nr-unit" fieldClass={field} disabled={propertyId === ''}
                  placeholder={propertyId === '' ? 'Property first' : units == null ? 'Loading…' : 'Type to search…'}
                  options={propertyId === '' ? [] : units?.map(u => ({ id: u.id, label: unitLabel(u) })) ?? null}
                  value={unitId} onPick={id => setUnitId(id)} />
                <p className="text-[11.5px] text-[#8a948d] mt-1">Occupied or vacant — a vacant unit routes straight to your provider.</p>
              </div>
            ) : (
              <div>
                {/* One pick: the system / the work IS the place */}
                <label className={label} htmlFor="nr-category">{scope === 'building_system' ? 'Which system' : 'What needs doing'} <span className="text-[#d4553f]">*</span></label>
                <select id="nr-category" className={field} value={categoryId} disabled={propertyId === ''}
                  onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">{propertyId === '' ? 'Property first' : 'Choose…'}</option>
                  {groups.map(g => (
                    <optgroup key={g.id} label={g.name}>
                      {leavesOf(g.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>
          {scope !== 'unit' && (
            <div>
              <label className={label} htmlFor="nr-place-detail">Exactly where <span className="font-normal text-[#8a948d]">(optional)</span></label>
              <input id="nr-place-detail" className={field} placeholder={scope === 'common_area' ? 'e.g. 3rd floor, near lift B' : 'e.g. Panel 2, ground floor'}
                value={placeDetail} onChange={e => setPlaceDetail(e.target.value)} maxLength={60} />
            </div>
          )}

          {scope === 'unit' && (
            <div>
              <label className={label} htmlFor="nr-category">Category <span className="text-[#d4553f]">*</span></label>
              <select id="nr-category" className={field} value={categoryId}
                onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Choose…</option>
                {groups.map(g => (
                  <optgroup key={g.id} label={g.name}>
                    {leavesOf(g.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={label} htmlFor="nr-title">Issue <span className="text-[#d4553f]">*</span></label>
            <input id="nr-title" className={field} placeholder="A few words — e.g. Water leak in the corridor ceiling"
              value={title} onChange={e => setTitle(e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="nr-desc">Details</label>
            <textarea id="nr-desc" rows={3} className={field} placeholder="What you saw, where exactly, anything the technician should know."
              value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div>
            <label className={label} htmlFor="nr-when">Preferred visit</label>
            <input id="nr-when" type="datetime-local" className={field} value={preferredAt} onChange={e => setPreferredAt(e.target.value)} />
          </div>

          {err && <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#f0eee8] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="h-10 px-4 rounded-xl text-sm font-semibold text-[#5f6b63] border border-[#e4e9e5] bg-white hover:border-[#c9c6be] cursor-pointer">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="h-10 px-5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#047246' }}>
            {busy ? 'Raising…' : 'Raise request'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * A small searchable picker: type to filter, click to choose. Selection shows
 * in the input; typing again reopens the list. Self-contained — no library.
 */
function SearchPick({ id, options, value, onPick, placeholder, disabled, fieldClass }: {
  id: string;
  options: { id: number; label: string }[] | null; // null = still loading
  value: number | '';
  onPick: (id: number | '') => void;
  placeholder: string;
  disabled?: boolean;
  fieldClass: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = value === '' ? null : options?.find(o => o.id === value) ?? null;
  const needle = q.trim().toLowerCase();
  const filtered = (options ?? []).filter(o => !needle || o.label.toLowerCase().includes(needle));

  return (
    <div className="relative">
      <input
        id={id}
        className={fieldClass}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? q : (selected?.label ?? '')}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={e => { setQ(e.target.value); if (value !== '') onPick(''); }}
        onBlur={() => setOpen(false)}
        autoComplete="off"
      />
      {open && !disabled && (
        <ul className="absolute z-10 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-[#e4e9e5] rounded-xl shadow-lg py-1">
          {options == null ? (
            <li className="px-3 py-2 text-sm text-[#8a948d]">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[#8a948d]">No match.</li>
          ) : filtered.map(o => (
            <li key={o.id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-[#eef1ef] ${o.id === value ? 'font-semibold text-[#1a7a5a]' : 'text-[#14201a]'}`}
                onMouseDown={e => { e.preventDefault(); onPick(o.id); setQ(''); setOpen(false); }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
