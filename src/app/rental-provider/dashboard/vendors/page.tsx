'use client';

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
import { ChevronDown, Plus, Users, X } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';

interface Trade { id: number; name: string }
export type VendorKind = 'service' | 'utility' | 'government' | 'insurance' | 'supplier';
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
}
interface Cat { id: number; name: string; parentId: number | null }

export const KIND_META: Record<VendorKind, { label: string; bg: string; fg: string }> = {
  service:    { label: 'Service', bg: '#e6f4ef', fg: '#1a7a5a' },
  utility:    { label: 'Utility', bg: '#e0f2fe', fg: '#0369a1' },
  government: { label: 'Government', bg: '#ede9fe', fg: '#6d28d9' },
  insurance:  { label: 'Insurance', bg: '#fef3c7', fg: '#92400e' },
  supplier:   { label: 'Supplier', bg: '#f4f3ef', fg: '#6b6860' },
};
const STATUS: Record<VendorRow['inviteStatus'], { label: string; bg: string; fg: string }> = {
  accepted:    { label: 'Accepted', bg: '#d8f2e8', fg: '#1a7a5a' },
  invited:     { label: 'Invited', bg: '#fef3c7', fg: '#92400e' },
  not_invited: { label: 'Not invited', bg: '#f4f3ef', fg: '#6b6860' },
};
export const chip = (label: string, bg: string, fg: string) => (
  <span key={label} className="text-[10.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: bg, color: fg }}>{label}</span>
);

export default function VendorsPage() {
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [groups, setGroups] = useState<Cat[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Kind filter: a multi-select — everything shows by default, untick to focus.
  const ALL_KINDS = Object.keys(KIND_META) as VendorKind[];
  const [kinds, setKinds] = useState<VendorKind[]>(ALL_KINDS);
  const [filterOpen, setFilterOpen] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      apiGet<VendorRow[]>('/maintenance/vendors'),
      apiGet<Cat[]>('/maintenance/categories'),
    ]).then(([v, c]) => {
      setRows(Array.isArray(v) ? v : []);
      setGroups((Array.isArray(c) ? c : []).filter(x => x.parentId == null));
    }).catch(() => setErr('Could not load your vendors.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ofKind = useCallback((k: VendorKind) => (rows ?? []).filter(r => (r.kind ?? 'service') === k), [rows]);
  const ownTeam = useMemo(() => ofKind('service').filter(r => r.relationship === 'internal_team'), [ofKind]);
  // "Contracted service vendors" = ON the UpNow journey (invited or accepted).
  // A service company never invited is the landlord's record only — it lists
  // apart, so the section never implies someone is a provider who isn't.
  const serviceVendors = useMemo(() => ofKind('service').filter(r => r.relationship !== 'internal_team' && r.inviteStatus !== 'not_invited'), [ofKind]);
  const serviceRecords = useMemo(() => ofKind('service').filter(r => r.relationship !== 'internal_team' && r.inviteStatus === 'not_invited'), [ofKind]);

  const row = (v: VendorRow) => {
    const st = STATUS[v.inviteStatus];
    const km = KIND_META[v.kind] ?? KIND_META.service;
    const participating = v.kind === 'service';
    return (
      <Link key={v.serviceProviderId} href={`/rental-provider/dashboard/vendors/${v.serviceProviderId}`}
        className="flex items-center gap-4 px-5 py-4 bg-white border border-[#e8e6e0] rounded-2xl hover:border-[#c9c6bd] transition-colors">
        <div className="w-11 h-11 rounded-xl grid place-items-center font-extrabold text-[15px] shrink-0" style={{ background: km.bg, color: km.fg }}>{v.name.charAt(0)}</div>
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-[#1a1916]">{v.name}</span>
            {v.relationship === 'internal_team' && chip('Own team', '#e0f2fe', '#0369a1')}
            {!participating && chip(km.label, km.bg, km.fg)}
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

  const section = (title: string, sub: string, list: VendorRow[], empty: string) => (
    <section className="grid gap-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-bold tracking-[0.1em] uppercase text-[#9b9890]">{title}</span>
        <span className="text-[11px] text-[#9b9890]">{sub}</span>
        <span className="flex-1 h-px bg-[#e8e6e0] self-center" />
      </div>
      {list.map(row)}
      {list.length === 0 && <p className="text-sm text-[#9b9890] bg-white border border-[#e8e6e0] rounded-2xl px-5 py-4">{empty}</p>}
    </section>
  );

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

      {rows != null && (() => {
        const kindLabel = (k: VendorKind) =>
          k === 'service' ? 'Service & own team' : k === 'utility' ? 'Utilities' : `${KIND_META[k].label}${k === 'supplier' ? 's' : ''}`;
        const kindEmpty = (k: VendorKind) =>
          k === 'utility' ? 'Nothing yet — DEWA, Etisalat, waste collection live here.'
          : k === 'government' ? 'Nothing yet — land renewal, Noqodi, municipal fees live here.'
          : k === 'insurance' ? 'Nothing yet — building insurance policies live here.'
          : 'Nothing yet — cleaning material and other suppliers live here.';
        const toggleKind = (k: VendorKind) =>
          setKinds(prev => prev.includes(k) ? prev.filter(x => x !== k) : [...ALL_KINDS.filter(x => prev.includes(x) || x === k)]);
        const focused = kinds.length === 1;
        return (
        <div className="grid gap-4">
          <div className="relative self-start">
            <button type="button" onClick={() => setFilterOpen(o => !o)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold cursor-pointer border bg-white text-[#4a4842] border-[#e8e6e0] hover:bg-[#f4f3ef]">
              Vendor types · {kinds.length === ALL_KINDS.length ? 'All' : kinds.map(kindLabel).join(', ')}
              <ChevronDown size={14} className="text-[#9b9890]" />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
                <div className="absolute z-20 mt-1.5 bg-white border border-[#e8e6e0] rounded-xl shadow-lg p-1.5 w-64">
                  {ALL_KINDS.map(k => (
                    <label key={k} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-[#1a1916] cursor-pointer hover:bg-[#f4f3ef]">
                      <input type="checkbox" className="accent-[#2e9f82]" checked={kinds.includes(k)} onChange={() => toggleKind(k)} />
                      <span className="flex-1">{kindLabel(k)}</span>
                      <span className="text-[#9b9890]">{ofKind(k).length}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {kinds.length === 0 ? (
            <p className="text-sm text-[#9b9890] bg-white border border-[#e8e6e0] rounded-2xl px-5 py-4">No vendor types selected — pick at least one above.</p>
          ) : (
            <div className="grid gap-6">
              {kinds.includes('service') && section('Own team', '— your in-house crew', ownTeam, 'No in-house team yet — add one with relationship "Our own team".')}
              {kinds.includes('service') && section('Contracted service vendors', '— on UpNow; only accepted ones take jobs', serviceVendors, 'No vendors on UpNow yet — invite one from its page below.')}
              {kinds.includes('service') && serviceRecords.length > 0 &&
                section('Service vendor records', '— your companies, not on UpNow yet; invite them from their page when ready', serviceRecords, '')}
              {(['utility', 'government', 'insurance', 'supplier'] as VendorKind[])
                .filter(k => kinds.includes(k) && (ofKind(k).length > 0 || focused))
                .map(k => (
                  <div key={k}>
                    {section(
                      k === 'utility' ? 'Utilities' : k === 'government' ? 'Government & authorities' : k === 'insurance' ? 'Insurance' : 'Suppliers',
                      '— records you manage; never invited, never assigned work',
                      ofKind(k), kindEmpty(k),
                    )}
                  </div>
                ))}
            </div>
          )}
        </div>
        );
      })()}

      {adding && <AddVendorModal groups={groups} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function AddVendorModal({ groups, onClose, onDone }: { groups: Cat[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<VendorKind>('service');
  const [category, setCategory] = useState('');
  const [relationship, setRelationship] = useState<'contracted_vendor' | 'internal_team'>('contracted_vendor');
  const [entityType, setEntityType] = useState<'company' | 'individual'>('company');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [trades, setTrades] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const service = kind === 'service';
  const submit = async () => {
    if (!name.trim()) { setErr('The vendor needs a name.'); return; }
    setBusy(true); setErr(null);
    try {
      await apiPost('/maintenance/vendors', {
        name: name.trim(), kind,
        ...(category.trim() ? { category: category.trim() } : {}),
        relationship: service ? relationship : 'contracted_vendor',
        entityType,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(service && trades.length ? { trades } : {}),
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the vendor.'); }
    finally { setBusy(false); }
  };
  const field = 'w-full border border-[#e8e6e0] rounded-lg px-3 py-2.5 text-sm bg-white text-[#1a1916] placeholder:text-[#b8b5ad] focus:outline-none focus:border-[#2e9f82] focus:ring-2 focus:ring-[#2e9f82]/15';
  const label = 'block text-[12px] font-semibold text-[#4a4842] mb-1';
  const categoryHint =
    kind === 'service' ? 'e.g. Elevator Maintenance, Pest Control'
    : kind === 'utility' ? 'e.g. Utility – Power, Utility – Water'
    : kind === 'government' ? 'e.g. Land Renewal, Municipal Fees'
    : kind === 'insurance' ? 'e.g. Building Insurance'
    : 'e.g. Cleaning Material';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(26,25,22,0.45)' }}>
      <form
        className="bg-white rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-xl"
        onSubmit={e => { e.preventDefault(); if (!busy) void submit(); }}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[#f0eee8]">
          <div>
            <h2 className="text-lg font-bold text-[#1a1916]">Add a vendor</h2>
            <p className="text-[12.5px] text-[#9b9890] mt-0.5">Your roster — service companies, your own crew, and the records behind your expenses.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] cursor-pointer mt-1" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 grid gap-4">
          <div>
            <span className={label}>Vendor type</span>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(KIND_META) as VendorKind[]).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border cursor-pointer transition-colors ${kind === k ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e8e6e0] hover:border-[#c9c6be]'}`}>
                  {KIND_META[k].label}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-[#9b9890] mt-1.5">
              {service
                ? 'Does maintenance work — you can invite them onto UpNow and assign jobs.'
                : 'A record for contracts and payments — never invited, never assigned work.'}
            </p>
          </div>

          <div>
            <label className={label} htmlFor="vendor-name">Name <span className="text-[#d4553f]">*</span></label>
            <input id="vendor-name" className={field} placeholder="Company or person" value={name} onChange={e => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <label className={label} htmlFor="vendor-category">What they&rsquo;re for</label>
            <input id="vendor-category" className={field} placeholder={categoryHint} value={category} onChange={e => setCategory(e.target.value)} />
            <p className="text-[11.5px] text-[#9b9890] mt-1">In your own words — shown on the list so anyone can tell vendors apart.</p>
          </div>

          {service && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="vendor-relationship">Relationship</label>
                <select id="vendor-relationship" className={field} value={relationship} onChange={e => setRelationship(e.target.value as typeof relationship)}>
                  <option value="contracted_vendor">Contracted vendor</option>
                  <option value="internal_team">Our own team</option>
                </select>
              </div>
              <div>
                <label className={label} htmlFor="vendor-entity">Entity</label>
                <select id="vendor-entity" className={field} value={entityType} onChange={e => setEntityType(e.target.value as typeof entityType)}>
                  <option value="company">Company</option>
                  <option value="individual">Individual / solo</option>
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="vendor-phone">Phone</label>
              <input id="vendor-phone" type="tel" className={field} placeholder="+971 50 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
              {service && <p className="text-[11.5px] text-[#9b9890] mt-1">For the invite &amp; job alerts.</p>}
            </div>
            <div>
              <label className={label} htmlFor="vendor-email">Email</label>
              <input id="vendor-email" type="email" className={field} placeholder="name@company.com" value={email} onChange={e => setEmail(e.target.value)} />
              {service && <p className="text-[11.5px] text-[#9b9890] mt-1">They&rsquo;ll sign in with it.</p>}
            </div>
          </div>

          {service && (
            <div>
              <span className={label}>Trades</span>
              <div className="flex gap-1.5 flex-wrap">
                {groups.map(g => {
                  const on = trades.includes(g.id);
                  return (
                    <button key={g.id} type="button" onClick={() => setTrades(t => on ? t.filter(x => x !== g.id) : [...t, g.id])}
                      className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border cursor-pointer transition-colors ${on ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e8e6e0] hover:border-[#c9c6be]'}`}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] text-[#9b9890] mt-1.5">What kinds of work they can be assigned. Leave empty if unsure — you can set it later.</p>
            </div>
          )}

          {err && <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="px-6 py-4 border-t border-[#f0eee8] flex items-center justify-between gap-3">
          <p className="text-[11.5px] text-[#9b9890] flex-1">
            {service ? 'Adding only records them — send the invitation from their page when ready.' : ''}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose}
              className="h-10 px-4 rounded-xl text-sm font-semibold text-[#6b6860] border border-[#e8e6e0] bg-white hover:border-[#c9c6be] cursor-pointer">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="h-10 px-5 rounded-xl text-sm font-bold text-white cursor-pointer disabled:opacity-50" style={{ background: '#2e9f82' }}>
              {busy ? 'Adding…' : 'Add vendor'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
