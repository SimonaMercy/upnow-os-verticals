'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  Ban, AlertCircle, CheckCircle2, Clock,
  BedDouble, ChevronRight, RotateCcw,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface SpaceUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  marketPrice?: number | null;
  rentalPrice?: number | null;
  property?: {
    id: number;
    buildingName: string;
    fullAddress: string | null;
    emirate?: { name: string } | null;
    community?: { name: string } | null;
  };
}

interface Lead {
  id: number;
  stage: string;
}

interface Viewing {
  id: number;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  notes: string | null;
  outcome: string | null;
  unit: SpaceUnit | null;
  lead: Lead | null;
}

interface DirectLead {
  id: number;
  stage: string;
  unit: SpaceUnit | null;
  createdAt: string;
}

interface TenantContract {
  id: number;
  status: string;
  contractType?: string | null;
  parentContractId?: number | null;
  startDate: string | null;
  endDate: string | null;
  annualRent: number;
  tenantSignedAt: string | null;
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  unit: { id: number | null; number?: string | null; name?: string | null; unitType?: string | null; bedrooms?: number | null } | null;
  property?: { id: number | null; buildingName?: string | null; fullAddress?: string | null } | null;
}

interface ViewingGroup {
  leadId: number;
  leadStage: string;
  unit: SpaceUnit | null;
  primary: Viewing;
}

type SpaceRow =
  | { kind: 'viewing';  key: string; group: ViewingGroup; contract?: TenantContract }
  | { kind: 'direct';   key: string; lead: DirectLead;    contract?: TenantContract }
  | { kind: 'contract'; key: string; contract: TenantContract };

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function groupByLead(viewings: Viewing[]): ViewingGroup[] {
  const map = new Map<number, Viewing[]>();
  for (const v of viewings) {
    const key = v.lead?.id ?? -v.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  const groups: ViewingGroup[] = [];
  for (const [, list] of map) {
    const sorted = [...list].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    const primary = sorted.find(v => ['scheduled', 'confirmed', 'completed'].includes(v.status)) ?? sorted[0];
    groups.push({ leadId: primary.lead?.id ?? -primary.id, leadStage: primary.lead?.stage ?? 'new', unit: primary.unit, primary });
  }
  groups.sort((a, b) => new Date(a.primary.scheduledAt).getTime() - new Date(b.primary.scheduledAt).getTime());
  return groups;
}

function pickPrimaryContract(contracts: TenantContract[], unitId: number | null | undefined): TenantContract | undefined {
  if (!unitId) return undefined;
  const onUnit = contracts.filter(c => c.unit?.id === unitId);
  if (onUnit.length === 0) return undefined;
  const nonRenewal = onUnit.filter(c => c.contractType !== 'renewal' && !c.parentContractId);
  const pool = nonRenewal.length > 0 ? nonRenewal : onUnit;
  const rank = (s: string) => (s === 'active' ? 0 : s === 'issued' ? 1 : s === 'pending' ? 2 : 3);
  return [...pool].sort((a, b) => rank(a.status) - rank(b.status))[0];
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Dubai' });
}

function rowStatusConfig(row: SpaceRow): { label: string; bg: string; text: string; isAction: boolean } {
  const c = row.contract;

  if (c) {
    if (c.status === 'active') return { label: 'Active Tenancy', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false };
    if (c.status === 'issued' && !c.tenantSignedAt) return { label: 'Sign Contract', bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true };
    if (c.status === 'issued' && c.tenantSignedAt)  return { label: 'Awaiting Ejari', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
    if (c.status === 'expired')    return { label: 'Lease Ended', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
    if (c.status === 'terminated') return { label: 'Terminated',  bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
    return { label: 'Contract Pending', bg: 'bg-[#f4f3ef]', text: 'text-[#6b6860]', isAction: false };
  }

  // Non-contract rows are always viewing/direct here.
  const stage = row.kind === 'viewing' ? row.group.leadStage : row.kind === 'direct' ? row.lead.stage : 'new';
  const vstatus = row.kind === 'viewing' ? row.group.primary.status : undefined;

  const stageMap: Record<string, { label: string; bg: string; text: string; isAction: boolean }> = {
    documents_collection: { label: 'Documents in Review',     bg: 'bg-[#f0f9ff]', text: 'text-[#0369a1]', isAction: false },
    payment_plan_shared:  { label: 'Review Payment Plan',     bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', isAction: true  },
    cheques_submitted:    { label: 'Cheques Under Review',    bg: 'bg-[#fef9c3]', text: 'text-[#854d0e]', isAction: false },
    cheques_collected:    { label: 'Preparing Your Contract', bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
    contract_issued:      { label: 'Contract Being Issued',   bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
    converted:            { label: 'Active Tenancy',          bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
    interested:           { label: 'Interested',              bg: 'bg-[#d8f2e8]', text: 'text-[#1a7a5a]', isAction: false },
  };
  if (stageMap[stage]) return stageMap[stage];
  if (vstatus === 'completed') return { label: 'Awaiting Next Step', bg: 'bg-[#f0faf6]', text: 'text-[#2e9f82]', isAction: false };
  return { label: 'Attend Your Viewing', bg: 'bg-[#fef3c7]', text: 'text-[#92400e]', isAction: false };
}

/* ── InactiveCard ───────────────────────────────────────────────────────────── */

function InactiveCard({ label, subLabel, dateStr, reason }: { label: string; subLabel?: string; dateStr: string; reason: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-[#e8e6e0] flex items-center gap-3 opacity-60">
      <div className="w-8 h-8 rounded-full bg-[#f4f3ef] flex items-center justify-center flex-shrink-0">
        <Ban size={14} className="text-[#9b9890]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#3d3b35] truncate">{label}</p>
        {subLabel && <p className="text-xs text-[#9b9890]">{subLabel}</p>}
        <p className="text-xs text-[#9b9890]">{dateStr} · {reason}</p>
      </div>
      <a href="/listings" className="ml-auto flex-shrink-0 text-xs text-[#2e9f82] hover:underline font-medium">Find another →</a>
    </div>
  );
}

/* ── Dummy photos (rotating by index) ──────────────────────────────────────── */

const DUMMY_PHOTOS = [
  'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=900&q=80',
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=900&q=80',
  'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=900&q=80',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=900&q=80',
];

/* ── Main page ──────────────────────────────────────────────────────────────── */

export default function MySpacesPage() {
  const { user } = useAuth();
  const [viewings,     setViewings]     = useState<Viewing[]>([]);
  const [directLeads,  setDirectLeads]  = useState<DirectLead[]>([]);
  const [contracts,    setContracts]    = useState<TenantContract[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [vRes, lRes, cRes] = await Promise.all([
        fetch('/api/leads/my-viewings',     { credentials: 'include' }),
        fetch('/api/leads/my-applications', { credentials: 'include' }),
        fetch('/api/contracts/tenant',      { credentials: 'include' }),
      ]);
      if (!vRes.ok) throw new Error(`Failed to load viewings (${vRes.status})`);
      const vData = await vRes.json();
      setViewings(Array.isArray(vData) ? vData : []);
      if (lRes.ok) { const d = await lRes.json(); setDirectLeads(Array.isArray(d) ? d : []); }
      if (cRes.ok) { const d = await cRes.json(); setContracts(Array.isArray(d) ? d : []); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState === 'visible') fetchAll();
    }
    window.addEventListener('focus', refetchIfVisible);
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => {
      window.removeEventListener('focus', refetchIfVisible);
      document.removeEventListener('visibilitychange', refetchIfVisible);
    };
  }, [fetchAll]);

  const groups = groupByLead(viewings);
  const activeGroups = groups.filter(g =>
    g.primary.outcome !== 'not_interested' &&
    !(['cancelled', 'no_show'].includes(g.primary.status) && g.primary.outcome === 'not_interested')
  );
  const inactiveGroups = groups.filter(g =>
    ['cancelled', 'no_show'].includes(g.primary.status) || g.primary.outcome === 'not_interested'
  );
  const activeDirectLeads  = directLeads.filter(l => l.stage !== 'rejected');
  const inactiveDirectLeads = directLeads.filter(l => l.stage === 'rejected');
  const isEmpty = !loading && viewings.length === 0 && directLeads.length === 0 && contracts.length === 0;

  // Units already represented by a viewing group or direct lead — so contract
  // rows below don't double-list the same unit.
  const representedUnitIds = new Set<number>([
    ...activeGroups.map(g => g.unit?.id).filter((x): x is number => x != null),
    ...activeDirectLeads.map(l => l.unit?.id).filter((x): x is number => x != null),
  ]);
  // Contracts whose unit has NO viewing/lead row — surface them directly so a
  // customer always sees their leases (including contracts created outside the
  // viewing/lead pipeline, e.g. imported data). One row per unit, primary pick.
  const TERMINAL_CONTRACT = new Set(['expired', 'terminated', 'cancelled', 'rejected', 'superseded']);
  const contractOnly = Array.from(
    new Set(contracts.map(c => c.unit?.id).filter((x): x is number => x != null)),
  )
    .filter(uid => !representedUnitIds.has(uid))
    .map(uid => pickPrimaryContract(contracts, uid))
    .filter((c): c is TenantContract => !!c);
  const activeContractRows: SpaceRow[] = contractOnly
    .filter(c => !TERMINAL_CONTRACT.has(c.status))
    .map(c => ({ kind: 'contract' as const, key: `c-${c.id}`, contract: c }));
  const pastContractRows = contractOnly.filter(c => TERMINAL_CONTRACT.has(c.status));

  const activeRows: SpaceRow[] = [
    ...activeGroups.map(g => ({
      kind: 'viewing' as const,
      key: `v-${g.leadId}`,
      group: g,
      contract: pickPrimaryContract(contracts, g.unit?.id),
    })),
    ...activeDirectLeads.map(l => ({
      kind: 'direct' as const,
      key: `d-${l.id}`,
      lead: l,
      contract: pickPrimaryContract(contracts, l.unit?.id),
    })),
    ...activeContractRows,
  ];

  const activeCount    = activeRows.filter(r => r.contract?.status === 'active').length;
  const renewingCount  = activeRows.filter(r => r.contract?.renewalAccepted === 'pending').length;
  const inProgressCount = activeRows.filter(r => !r.contract || r.contract.status !== 'active').length;
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] || 'there';

  const chips = [
    { label: 'Active',      value: activeCount,      bg: 'bg-[#1f5a3f]', fg: 'text-white' },
    { label: 'In progress', value: inProgressCount,  bg: 'bg-[#fbe5dc]', fg: 'text-[#c8492c]' },
    { label: 'Renewing',    value: renewingCount,    bg: 'bg-[#fbebcc]', fg: 'text-[#a0641b]' },
  ];

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9890]">
            Hello {firstName}
          </p>
          <h1 className="text-3xl font-bold text-[#1a1916] mt-1.5 leading-[1.1] tracking-tight">
            Your <span className="text-[#1f5a3f]">spaces</span>
          </h1>
          <p className="text-sm text-[#6b6860] mt-2 max-w-md">
            Everything in motion — current leases, applications, viewings on the calendar. Tap any card to drill in.
          </p>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          {chips.map(c => (
            <div key={c.label} className={`px-4 py-2.5 rounded-2xl min-w-[92px] ${c.bg} ${c.fg}`}>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] opacity-90">{c.label}</p>
              <p className="text-2xl font-bold leading-none mt-1 tabular-nums">{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <style>{`
        @keyframes actionRing {
          0%   { box-shadow: 0 0 0 0   rgba(200,73,44,0.55); }
          70%  { box-shadow: 0 0 0 10px rgba(200,73,44,0); }
          100% { box-shadow: 0 0 0 0   rgba(200,73,44,0); }
        }
        .upnow-action-dot { animation: actionRing 1.8s ease-out infinite; }
        @keyframes arrowNudge {
          0%, 100% { transform: translateX(0); }
          50%      { transform: translateX(4px); }
        }
        .upnow-action-arrow { animation: arrowNudge 1.4s ease-in-out infinite; }
        @keyframes pillBlink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.65; }
        }
        .upnow-action-pill { animation: pillBlink 2s ease-in-out infinite; }
      `}</style>

      {/* Active space cards */}
      {!loading && activeRows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {activeRows.map((row, idx) => {
            const sc = rowStatusConfig(row);
            // For contract-only rows, map the contract's unit/property payload
            // into the SpaceUnit shape the card expects.
            const unit: SpaceUnit | null = row.kind === 'viewing'
              ? row.group.unit
              : row.kind === 'direct'
                ? row.lead.unit
                : row.contract.unit
                  ? {
                      id: row.contract.unit.id ?? 0,
                      unitNumber: row.contract.unit.number ?? '',
                      unitName: row.contract.unit.name ?? null,
                      unitType: row.contract.unit.unitType ?? null,
                      bedrooms: row.contract.unit.bedrooms ?? null,
                      property: row.contract.property
                        ? {
                            id: row.contract.property.id ?? 0,
                            buildingName: row.contract.property.buildingName ?? '',
                            fullAddress: row.contract.property.fullAddress ?? null,
                          }
                        : undefined,
                    }
                  : null;
            const c = row.contract;
            const isActive = c?.status === 'active';
            const community = unit?.property?.community?.name ?? null;
            const emirate = unit?.property?.emirate?.name ?? null;
            const location = [community, emirate].filter(Boolean).join(', ') || null;
            const bedrooms = unit?.bedrooms;
            const annual = c?.annualRent ?? unit?.rentalPrice ?? unit?.marketPrice ?? null;
            const annualIsAsking = !c?.annualRent && annual != null;
            const periodLabel = c?.startDate && c?.endDate
              ? { label: 'Period', value: `${fmtShort(c.startDate)} -> ${fmtShort(c.endDate)}` }
              : row.kind === 'viewing'
                ? { label: 'Viewing', value: fmtShort(row.group.primary.scheduledAt) }
                : row.kind === 'direct'
                  ? { label: 'Applied', value: fmtShort(row.lead.createdAt) }
                  : { label: 'Contract', value: `CID-${row.contract.id}` };
            const buildingName = unit?.property?.buildingName ?? '';
            const unitLabel = unit?.unitName ?? (unit ? `Unit ${unit.unitNumber}` : 'Property');
            const photo = DUMMY_PHOTOS[idx % DUMMY_PHOTOS.length];
            const tone: 'action' | 'waiting' | 'settled' = sc.isAction ? 'action' : isActive ? 'settled' : 'waiting';
            const toneCfg = {
              action:  { bg: 'bg-[#fbe5dc]', border: 'border-[#f3c4b3]', dot: 'bg-[#c8492c]', label: 'text-[#c8492c]', icon: <AlertCircle size={14} className="text-white" />, eyebrow: 'Action required' },
              waiting: { bg: 'bg-[#fbebcc]', border: 'border-[#f0d68f]', dot: 'bg-[#a0641b]',  label: 'text-[#a0641b]',  icon: <Clock size={14} className="text-white" />,        eyebrow: 'In progress'      },
              settled: { bg: 'bg-[#e0ede0]', border: 'border-[#bdd9b8]', dot: 'bg-[#1f5a3f]',  label: 'text-[#1f5a3f]',  icon: <CheckCircle2 size={14} className="text-white" />, eyebrow: 'Active'           },
            }[tone];

            return (
              <Link
                key={row.key}
                href={`/dashboard/customer/spaces/v2/${row.key}`}
                className="text-left bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[#1a1916]/30 flex flex-col"
              >
                {/* Hero photo */}
                <div className="relative h-44 overflow-hidden bg-[#f4f3ef]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt={buildingName || unitLabel} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 45%,rgba(0,0,0,0) 60%,rgba(26,23,20,.55) 100%)' }} />
                  {c?.renewalAccepted === 'pending' && (
                    <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] bg-[#1a1916] text-white inline-flex items-center gap-1">
                      <RotateCcw size={10} /> Renewal — Action
                    </span>
                  )}
                  <span className={`absolute bottom-3 left-3 text-[11px] font-semibold rounded-full px-3 py-1.5 ${sc.bg} ${sc.text} shadow-sm ${sc.isAction ? 'upnow-action-pill' : ''}`}>
                    {sc.isAction && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 align-middle" />}
                    {sc.label}
                  </span>
                </div>

                {/* Body */}
                <div className="p-5 flex flex-col gap-4 flex-1">
                  <div>
                    {location && (
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9b9890] mb-1">{location}</p>
                    )}
                    <h3 className="text-lg font-bold text-[#1a1916] leading-tight tracking-tight">
                      {buildingName || unitLabel}
                      {buildingName && unitLabel && (
                        <>, <span className="font-semibold text-[#1f5a3f]">{unitLabel}</span></>
                      )}
                    </h3>
                  </div>

                  {/* Stats strip */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-y border-[#f0ede8]">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">Beds</p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5">
                        {bedrooms != null ? (bedrooms === 0 ? 'Studio' : `${bedrooms} BR`) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">
                        {annualIsAsking ? 'Asking' : 'Annual'}
                      </p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5 tabular-nums">
                        {annual != null ? `AED ${(annual / 1000).toFixed(0)}K` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#9b9890]">{periodLabel.label}</p>
                      <p className="text-sm font-semibold text-[#1a1916] mt-0.5">{periodLabel.value}</p>
                    </div>
                  </div>

                  {/* Action chip */}
                  <div className={`mt-auto flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border ${toneCfg.bg} ${toneCfg.border}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${toneCfg.dot} ${sc.isAction ? 'upnow-action-dot' : ''}`}>
                        {toneCfg.icon}
                      </span>
                      <p className={`text-xs font-semibold ${toneCfg.label}`}>{toneCfg.eyebrow}</p>
                    </div>
                    <span className="text-xs font-semibold text-[#1a1916] inline-flex items-center gap-1">
                      Open <ChevronRight size={14} className={sc.isAction ? 'upnow-action-arrow' : ''} />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="bg-white rounded-xl h-14 animate-pulse" />)}
        </div>
      )}

      {/* Empty state */}
      {isEmpty && (
        <div className="bg-white rounded-2xl p-16 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <BedDouble size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No spaces yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">Browse listings and book a viewing or apply directly to get started.</p>
          <a href="/listings" className="mt-4 text-sm font-medium text-[#2e9f82] hover:underline">Browse listings →</a>
        </div>
      )}

      {/* Past / inactive */}
      {!loading && (inactiveGroups.length > 0 || inactiveDirectLeads.length > 0 || pastContractRows.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-[#3d3b35] uppercase tracking-wide mb-3">Past</h2>
          <div className="space-y-3">
            {pastContractRows.map(c => (
              <InactiveCard
                key={`pc-${c.id}`}
                label={c.unit?.name ?? (c.unit?.number ? `Unit ${c.unit.number}` : 'Property')}
                subLabel={c.property?.buildingName ?? undefined}
                dateStr={c.endDate ? new Date(c.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : ''}
                reason={c.status === 'terminated' ? 'Lease terminated' : 'Lease ended'}
              />
            ))}
            {inactiveGroups.map(g => (
              <InactiveCard
                key={`iv-${g.leadId}`}
                label={g.unit?.unitName ?? (g.unit ? `Unit ${g.unit.unitNumber}` : 'Property')}
                subLabel={g.unit?.property?.buildingName}
                dateStr={new Date(g.primary.scheduledAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
                reason={g.primary.outcome === 'not_interested' ? 'Not interested' : g.primary.status === 'no_show' ? 'No show' : 'Cancelled'}
              />
            ))}
            {inactiveDirectLeads.map(l => (
              <InactiveCard
                key={`id-${l.id}`}
                label={l.unit?.unitName ?? (l.unit ? `Unit ${l.unit.unitNumber}` : 'Property')}
                subLabel={l.unit?.property?.buildingName}
                dateStr={new Date(l.createdAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
                reason="Application rejected"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
