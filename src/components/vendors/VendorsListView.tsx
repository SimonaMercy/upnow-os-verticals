'use client';
/**
 * The Vendors list — shared by the landlord page and the manager mirror.
 */

/**
 * RP → Vendors: JUST the list (owner, 2 Sep). Grouped the way the landlord's
 * own expense sheets are: the own team, the service vendors that participate
 * (invite → accept → jobs), and the records — utilities, authorities,
 * insurers, suppliers — managed within the platform, never invited.
 * Everything about ONE vendor (pricing, technicians, invite) lives on its
 * page: /vendors/[id].
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Users } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { VendorForm } from '@/components/vendors/VendorForm';

interface Trade { id: number; name: string }
/** 0279 adds landlord (head landlord / authority the rent goes to) and internal (employees). */
export type VendorKind = 'service' | 'utility' | 'government' | 'insurance' | 'supplier' | 'landlord' | 'internal';
const url = (base: string, rp: number | null | undefined, path: string) => rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;
export interface VendorRow {
  serviceProviderId: number; name: string; entityType: string | null; tier: string;
  email: string | null; phone: string | null;
  relationship: 'internal_team' | 'contracted_vendor'; isDefault: boolean;
  kind: VendorKind;
  inviteStatus: 'not_invited' | 'invited' | 'accepted';
  invitedAt: string | null; acceptedAt: string | null;
  trades: Trade[]; pricing: { categoryGroupId: number; group: string; mode: string; hourlyRateAed: number | null }[];
  technicians: number; openJobs: number;
  category: string | null;
  contactName?: string | null; address?: string | null;
  tradeLicence?: { number: string | null; expiry: string | null; doc: { id: number; fileUrl: string; displayName: string | null } | null } | null;
}
interface Cat { id: number; name: string; parentId: number | null }

export const KIND_META: Record<VendorKind, { label: string; bg: string; fg: string }> = {
  service:    { label: 'Service', bg: '#e6f4ef', fg: '#1a7a5a' },
  utility:    { label: 'Utility', bg: '#e0f2fe', fg: '#0369a1' },
  government: { label: 'Government', bg: '#ede9fe', fg: '#6d28d9' },
  insurance:  { label: 'Insurance', bg: '#fef3c7', fg: '#92400e' },
  supplier:   { label: 'Supplier', bg: '#f4f3ef', fg: '#6b6860' },
  landlord:   { label: 'Head landlord', bg: '#fce7f3', fg: '#9d174d' },
  internal:   { label: 'Internal', bg: '#e0e7ff', fg: '#3730a3' },
};
const STATUS: Record<VendorRow['inviteStatus'], { label: string; bg: string; fg: string }> = {
  accepted:    { label: 'Accepted', bg: '#d8f2e8', fg: '#1a7a5a' },
  invited:     { label: 'Invited', bg: '#fef3c7', fg: '#92400e' },
  not_invited: { label: 'Not invited', bg: '#f4f3ef', fg: '#6b6860' },
};
export const chip = (label: string, bg: string, fg: string) => (
  <span key={label} className="text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: bg, color: fg }}>{label}</span>
);

export function VendorsListView({ base = '/maintenance', rp = null, detailHrefOf }: {
  /** '/maintenance' for the landlord, '/manager/maintenance' (+ rp) for a manager. */
  base?: string; rp?: number | null; detailHrefOf: (spId: number) => string;
}) {
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [groups, setGroups] = useState<Cat[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // One flat list (owner, 10 Sep: the Own team / Contracted / Records sections
  // are hidden for now): a search box plus one chip per vendor type.
  const ALL_KINDS = Object.keys(KIND_META) as VendorKind[];
  const [kind, setKind] = useState<VendorKind | 'all'>('all');
  const [q, setQ] = useState('');

  const load = useCallback(() => {
    Promise.all([
      apiGet<VendorRow[]>(url(base, rp, '/vendors')),
      apiGet<Cat[]>(url(base, rp, '/categories')),
    ]).then(([v, c]) => {
      setRows(Array.isArray(v) ? v : []);
      setGroups((Array.isArray(c) ? c : []).filter(x => x.parentId == null));
    }).catch(() => setErr('Could not load your vendors.'));
  }, [base, rp]);
  useEffect(() => { load(); }, [load]);

  const ofKind = useCallback((k: VendorKind) => (rows ?? []).filter(r => (r.kind ?? 'service') === k), [rows]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? [])
    .filter(r => kind === 'all' || (r.kind ?? 'service') === kind)
    .filter(r => !needle || [r.name, r.category, r.email, r.phone, r.contactName, ...r.trades.map(t => t.name)].some(x => (x ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name)), [rows, kind, needle]);

  const row = (v: VendorRow) => {
    const st = STATUS[v.inviteStatus];
    const km = KIND_META[v.kind] ?? KIND_META.service;
    const participating = v.kind === 'service';
    return (
      <Link key={v.serviceProviderId} href={detailHrefOf(v.serviceProviderId)}
        className="flex items-center gap-4 px-5 py-4 bg-white border border-[#e8e6e0] rounded-2xl hover:border-[#c9c6bd] transition-colors">
        <div className="w-11 h-11 rounded-xl grid place-items-center font-extrabold text-[15px] shrink-0" style={{ background: km.bg, color: km.fg }}>{v.name.charAt(0)}</div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-[#1a1916]">{v.name}</span>
            {chip(km.label, km.bg, km.fg)}
            {v.relationship === 'internal_team' && chip('Own team', '#e0f2fe', '#0369a1')}
            {participating && chip(st.label, st.bg, st.fg)}
            {v.isDefault && chip('Default', '#f4f3ef', '#6b6860')}
          </div>
          <span className="text-[13px] text-[#6b6860] truncate">
            {v.category ? <><b className="text-[#4a4842] font-semibold">{v.category}</b>{' · '}</> : null}
            {participating
              ? (v.trades.length ? v.trades.map(t => t.name).join(' · ') : 'no trades set')
              : 'record — contracts & payments here; never invited, never assigned work'}
          </span>
        </div>
        {/* Job-board figures exist only once the vendor is ON the platform —
            before acceptance the status chip already says it all. */}
        {participating && v.inviteStatus === 'accepted' && (
          <div className="flex items-center gap-6 text-right shrink-0">
            <div className="flex flex-col"><span className="text-[17px] font-extrabold text-[#1a1916]">{v.technicians}</span><span className="text-[11px] text-[#9b9890]">technicians</span></div>
            <div className="flex flex-col"><span className="text-[17px] font-extrabold text-[#1a1916]">{v.openJobs}</span><span className="text-[11px] text-[#9b9890]">open jobs</span></div>
          </div>
        )}
      </Link>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-[#1a1916] flex items-center gap-2"><Users size={22} /> Vendors</h1>
          <p className="text-sm text-[#6b6860] max-w-2xl mt-1.5">Everyone your buildings depend on. Open a vendor for its pricing, people and status.</p>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="h-10 px-4 rounded-xl text-[13.5px] font-bold text-white inline-flex items-center gap-2 cursor-pointer" style={{ background: '#2e9f82' }}>
          <Plus size={15} /> Add vendor
        </button>
      </div>

      {err && <p className="text-sm text-red-700 bg-[#fef2f2] border border-[#fecaca] rounded-xl px-4 py-2.5 mb-4">{err}</p>}
      {rows == null && !err && <p className="text-sm text-[#9b9890]">Loading…</p>}

      {rows != null && (
        <div className="grid gap-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <label className="relative w-full sm:w-[300px]">
              <Search size={14} className="absolute left-3 top-[11px] text-[#9b9890]" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendors — name, what they're for, contact…"
                className="w-full pl-9 pr-3 h-10 border border-[#e8e6e0] rounded-xl text-[13px] bg-white focus:outline-none focus:border-[#2e9f82]" />
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {([['all', 'All', rows.length] as const, ...ALL_KINDS.map(k => [k, KIND_META[k].label, ofKind(k).length] as const)]).map(([k, label, n]) => {
                const on = kind === k; const meta = k === 'all' ? null : KIND_META[k as VendorKind];
                return (
                  <button key={k} type="button" onClick={() => setKind(k as VendorKind | 'all')}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-full border cursor-pointer transition-colors"
                    style={on ? { background: '#1a1916', color: '#fff', borderColor: '#1a1916' } : { background: meta?.bg ?? '#fff', color: meta?.fg ?? '#6b6860', borderColor: meta ? 'transparent' : '#e8e6e0' }}>
                    {label} · {n}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2.5">
            {shown.map(row)}
            {shown.length === 0 && (
              <p className="text-sm text-[#9b9890] bg-white border border-[#e8e6e0] rounded-2xl px-5 py-4">
                {rows.length === 0 ? 'No vendors yet — add your first with "Add vendor".' : needle ? `Nothing matches "${q.trim()}".` : `No ${KIND_META[kind as VendorKind]?.label.toLowerCase() ?? ''} vendors yet.`}
              </p>
            )}
          </div>
        </div>
      )}

      {adding && <VendorForm mode="add" groups={groups} base={base} rp={rp} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </div>
  );
}

