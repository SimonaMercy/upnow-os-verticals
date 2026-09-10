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
import { Wrench, ImageIcon, Search, Plus, X } from 'lucide-react';
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
  const [creating, setCreating] = useState(false);

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

  const spent = useMemo(() => list.reduce((s, r) => s + (r.invoiceTotalAed ?? 0), 0), [list]);

  const tab = (k: Bucket, label: string) => (
    <button key={k} type="button" onClick={() => setBucket(k)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${bucket === k ? 'bg-[#2e9f82] text-white' : 'text-[#6b6860] hover:bg-[#f4f3ef]'}`}>
      {label} <span className={bucket === k ? 'opacity-80' : 'text-[#9b9890]'}>· {counts[k]}</span>
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916] flex items-center gap-2"><Wrench size={20} /> Maintenance requests</h1>
          <p className="text-sm text-[#6b6860] max-w-2xl mt-1">
            Everything raised on your buildings — a unit (occupied or vacant), a common area, a building system. Open work is worked on the <Link href={boardHref} className="text-[#1a7a5a] font-semibold underline">Operations board</Link>;
            a request leaves the board when it is closed out and lives here — what was fixed, by whom, and where the cost landed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-[#9b9890]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ref, place, item, provider, customer…"
              className="pl-8 pr-3 py-2 border border-[#e8e6e0] rounded-lg text-sm bg-white focus:outline-none focus:border-[#2e9f82] w-72" />
          </label>
          <button type="button" onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold text-white cursor-pointer" style={{ background: '#2e9f82' }}>
            <Plus size={14} /> New request
          </button>
        </div>
      </div>
      {creating && (
        <NewRequestModal base={base} rp={rp} detailHref={detailHref} onClose={() => setCreating(false)} />
      )}

      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {tab('open', 'Open')}{tab('completed', 'Completed')}{tab('ended', 'Declined & cancelled')}
        {bucket === 'completed' && list.length > 0 && (
          <span className="ml-auto text-xs text-[#6b6860]">{list.length} closed · invoices {aed(spent)}</span>
        )}
      </div>
      {/* 0267 — where: every scope, one list */}
      <div className="flex items-center gap-1 mb-3 flex-wrap text-xs">
        <span className="text-[#9b9890] mr-1">Where</span>
        {(['all', 'unit', 'common_area', 'building_system'] as ScopeFilter[]).map(k => (
          <button key={k} type="button" onClick={() => setScopeFilter(k)}
            className={`px-2.5 py-1 rounded-full font-semibold cursor-pointer border ${scopeFilter === k ? 'bg-[#1a1916] text-white border-[#1a1916]' : 'text-[#6b6860] border-[#e8e6e0] bg-white hover:border-[#c9c6be]'}`}>
            {k === 'all' ? 'All' : k === 'unit' ? 'Units' : k === 'common_area' ? 'Common areas' : 'Building systems'}
            <span className={scopeFilter === k ? 'opacity-70' : 'text-[#9b9890]'}> · {scopeCounts[k]}</span>
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-red-700 bg-[#fef2f2] border border-[#fecaca] rounded-xl px-4 py-2.5 mb-3">{err}</p>}
      {rows == null && !err && <p className="text-sm text-[#9b9890]">Loading…</p>}

      {rows != null && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-[#9b9890] border-b border-[#f0eeea]">
                <th className="text-left px-4 py-2.5 font-semibold">Request</th>
                <th className="text-left px-4 py-2.5 font-semibold">Where</th>
                <th className="text-left px-4 py-2.5 font-semibold">Customer</th>
                <th className="text-left px-4 py-2.5 font-semibold">Provider</th>
                <th className="text-left px-4 py-2.5 font-semibold">Who pays</th>
                <th className="text-left px-4 py-2.5 font-semibold">{bucket === 'completed' ? 'Closed · cost' : 'Stage'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} className="border-b border-[#f9f8f6] last:border-0 hover:bg-[#fafaf8]">
                  <td className="px-4 py-2.5">
                    <Link href={detailHref(r.id)} className="block">
                      <span className="font-mono text-[10px] text-[#9b9890]">{r.ref}</span>
                      <span className="block font-semibold text-[#1a1916]">{r.title}</span>
                      <span className="block text-[11px] text-[#6b6860]">{r.category?.name ?? '—'} · raised {fmt(r.createdAt)} by {r.raisedByRole ?? '—'}
                        {(r.photoCount ?? 0) > 0 && <> · <ImageIcon size={10} className="inline -mt-0.5" /> {r.photoCount}</>}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-[#1a1916]">
                    {maintenancePlace(r)}
                    {(r.scope ?? 'unit') !== 'unit' && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#eef3f1] text-[#2e6f5e]">{SCOPE_LABEL[r.scope as MaintenanceScope]}</span>}
                    <span className="block text-[11px] text-[#6b6860]">{r.property?.buildingName ?? ''}</span>
                  </td>
                  <td className="px-4 py-2.5 text-[#1a1916]">{tenantDisplayName({ name: r.customer?.name ?? null, entityType: r.customer?.entityType, companyName: r.customer?.companyName }) ?? <span className="text-[#9b9890]">{maintenanceNoCustomerLabel(r.scope)}</span>}</td>
                  <td className="px-4 py-2.5 text-[#1a1916]">{r.provider ? `${r.provider.name}${r.provider.relationship === 'internal_team' ? ' · own team' : ''}` : '—'}</td>
                  <td className="px-4 py-2.5 text-[#1a1916]">{r.coverage ? COVER[r.coverage] ?? r.coverage : <span className="text-[#9b9890]">undecided</span>}</td>
                  <td className="px-4 py-2.5">
                    {bucket === 'completed' ? (
                      <>
                        <span className="text-[#1a1916]">{fmt(r.closedAt)}</span>
                        <span className="block text-[11px] text-[#6b6860]">{aed(r.invoiceTotalAed)}{r.costAllocation ? ` · ${ALLOC[r.costAllocation] ?? r.costAllocation}` : ''}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[#1a1916]">{STAGE[r.stage] ?? r.stage}</span>
                        {r.stageNote && <span className="block text-[11px] text-[#92400e]">{r.stageNote}</span>}
                        {bucket === 'ended' && <span className="block text-[11px] text-[#6b6860]">{fmt(r.declinedAt ?? r.cancelledAt)}</span>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#9b9890]">
                  {bucket === 'completed' ? 'Nothing closed out yet — completed requests appear here once you close them out on the board.'
                    : bucket === 'open' ? (scopeFilter === 'all' ? 'No open requests.' : 'No open requests here.') : 'Nothing declined or cancelled.'}
                </td></tr>
              )}
            </tbody>
          </table>
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

  const field = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2.5 text-sm bg-white text-[#1a1916] focus:outline-none focus:border-[#2e9f82] focus:ring-2 focus:ring-[#2e9f82]/15';
  const label = 'block text-[12px] font-semibold text-[#4a4842] mb-1';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,25,22,0.45)' }}>
      <form className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl"
        onSubmit={e => { e.preventDefault(); if (!busy) void submit(); }}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#f0eee8]">
          <div>
            <h2 className="text-lg font-bold text-[#1a1916]">New maintenance request</h2>
            <p className="text-[12.5px] text-[#9b9890] mt-0.5">Raised on your side — a unit, a common area or a building system; it routes through the same pipeline as a customer request.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer mt-1" aria-label="Close"><X size={18} /></button>
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
              <p className="text-[11.5px] text-[#6b6860] mt-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-[#1a1916]">{profile.formLabel}</span>
                <span className="text-[#9b9890]">{profile.override ? '· set by you' : '· from its units'}{profile.floors != null ? ` · ${profile.floors} floor${profile.floors === 1 ? '' : 's'}` : ''}</span>
                {changingForm ? (
                  <select className="border border-[#e8e6e0] rounded-md px-1.5 py-0.5 text-[11.5px] bg-white" value={profile.override ?? ''} autoFocus
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
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#f4f3ef]" role="radiogroup" aria-label="Where is the work">
              {(['unit', 'common_area', 'building_system'] as MaintenanceScope[]).map(k => (
                <button key={k} type="button" role="radio" aria-checked={scope === k}
                  onClick={() => { setScope(k); setPlaceDetail(''); setCategoryId(''); }}
                  className={`h-9 rounded-lg text-[12.5px] font-semibold cursor-pointer transition ${scope === k ? 'bg-white text-[#1a1916] shadow-sm' : 'text-[#6b6860] hover:text-[#1a1916]'}`}>
                  {scopeLabel(k)}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-[#9b9890] mt-1.5">{scopeHint(scope)}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {scope === 'unit' ? (
              <div>
                <label className={label} htmlFor="nr-unit">Unit <span className="text-[#d4553f]">*</span></label>
                <SearchPick id="nr-unit" fieldClass={field} disabled={propertyId === ''}
                  placeholder={propertyId === '' ? 'Property first' : units == null ? 'Loading…' : 'Type to search…'}
                  options={propertyId === '' ? [] : units?.map(u => ({ id: u.id, label: unitLabel(u) })) ?? null}
                  value={unitId} onPick={id => setUnitId(id)} />
                <p className="text-[11.5px] text-[#9b9890] mt-1">Occupied or vacant — a vacant unit routes straight to your provider.</p>
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
              <label className={label} htmlFor="nr-place-detail">Exactly where <span className="font-normal text-[#9b9890]">(optional)</span></label>
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
            className="h-10 px-4 rounded-xl text-sm font-semibold text-[#6b6860] border border-[#e8e6e0] bg-white hover:border-[#c9c6be] cursor-pointer">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className="h-10 px-5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
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
        <ul className="absolute z-10 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white border border-[#e8e6e0] rounded-xl shadow-lg py-1">
          {options == null ? (
            <li className="px-3 py-2 text-sm text-[#9b9890]">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[#9b9890]">No match.</li>
          ) : filtered.map(o => (
            <li key={o.id}>
              <button
                type="button"
                className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-[#f4f3ef] ${o.id === value ? 'font-semibold text-[#1a7a5a]' : 'text-[#1a1916]'}`}
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
