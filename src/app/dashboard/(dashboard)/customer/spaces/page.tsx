'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { isResidentialUnitType } from '@/lib/unitTaxonomy';
import { getRequiredDocs, isDocKeySatisfied } from '@/lib/docRequirements';
import { parseAdditionalDocs } from '@/lib/requestableDocs';
import {
  deriveStateKey, resolveContractChain, readDocsSubmitted,
  CUSTOMER_STATE_DEFS,
  type CustomerStateKey, type JourneyContract,
} from '@/lib/customerJourney';
import { customerStepLabel, journeyOptionsFor, journeyPosition, presentCustomerState, type JourneyOptions } from '@/lib/spaceJourney';
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
  /** Auto-generated on express-interest; feeds the journey resolver. */
  paymentPlan?: unknown;
  /** Free-text extra documents the RP asked for. */
  additionalDocsNote?: string | null;
}

interface Viewing {
  id: number;
  scheduledAt: string;
  /** Recorded at creation by Book Now / direct booking (see bookedViaOf). */
  desiredMoveIn?: string | null;
  preferredChequeCount?: number | null;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  notes: string | null;
  outcome: string | null;
  unit: SpaceUnit | null;
  lead: Lead | null;
  leadStage?: string | null;
}

interface DirectLead {
  id: number;
  stage: string;
  unit: SpaceUnit | null;
  createdAt: string;
  paymentPlan?: unknown;
  additionalDocsNote?: string | null;
}

/** A customer document as returned by /documents/my. */
interface TenantDoc {
  documentKey: string;
  status?: string | null;
  fileUrl?: string | null;
}

// Extends JourneyContract so this row can be handed straight to deriveStateKey —
// /contracts/tenant already returns those fields, they just weren't declared here.
interface TenantContract extends JourneyContract {
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
  property?: { id: number | null; buildingName?: string | null; fullAddress?: string | null; spaceCategory?: string | null; emirate?: string | null } | null;
}

interface ViewingGroup {
  leadId: number;
  leadStage: string;
  unit: SpaceUnit | null;
  primary: Viewing;
}

type SpaceRow =
  | { kind: 'viewing';  key: string; group: ViewingGroup; contract?: TenantContract; renewalContract?: TenantContract }
  | { kind: 'direct';   key: string; lead: DirectLead;    contract?: TenantContract; renewalContract?: TenantContract }
  | { kind: 'contract'; key: string; contract: TenantContract;                        renewalContract?: TenantContract };

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

/** Current lease + renewal-in-flight for a unit, via the SHARED chain walk the
 *  space detail page uses — so a row can never disagree with the page it opens. */
function chainForUnit(contracts: TenantContract[], unitId: number | null | undefined) {
  if (!unitId) return { contract: undefined, renewalContract: undefined };
  const onUnit = contracts.filter(c => c.unit?.id === unitId);
  if (onUnit.length === 0) return { contract: undefined, renewalContract: undefined };
  const { contract, renewalContract } = resolveContractChain(onUnit);
  return { contract: contract ?? undefined, renewalContract: renewalContract ?? undefined };
}

function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: '2-digit', timeZone: APP_TIME_ZONE });
}

/**
 * Where this space actually is, using the SAME resolver the detail page runs.
 *
 * This replaced a local map off lead.stage / contract.status that could only
 * name coarse buckets — a customer stuck on "Documents required, Step 2 of 8"
 * read "Awaiting Next Step", which names neither the step nor the fact that it
 * is waiting on THEM.
 */
function rowJourney(row: SpaceRow, docs: TenantDoc[], entityType: 'individual' | 'company' | null): CustomerStateKey {
  const lead = row.kind === 'viewing' ? row.group.primary.lead : row.kind === 'direct' ? row.lead : null;
  const unitType = row.kind === 'viewing'
    ? row.group.unit?.unitType
    : row.kind === 'direct'
      ? row.lead.unit?.unitType
      : row.contract.unit?.unitType;

  // Same docs-complete gate as the detail page: KYC identity + the rental
  // section, so a customer who uploaded financials but skipped KYC is still
  // routed to docs_required rather than payment_review. entityType matters —
  // a COMPANY tenancy is asked for a trade licence + signatory ID, not the
  // individual pack, so passing the wrong one would disagree with the page.
  const requiredKeys = getRequiredDocs(unitType ?? null, entityType).filter(d => d.required).map(d => d.key);
  const uploadedKeys = new Set(
    docs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey),
  );
  const allRequiredDocsUploaded = requiredKeys.length > 0 && requiredKeys.every(k => isDocKeySatisfied(k, uploadedKeys));

  return deriveStateKey({
    contract: row.contract ?? null,
    renewalContract: row.renewalContract ?? null,
    viewing: row.kind === 'viewing' ? row.group.primary : null,
    stage: row.kind === 'viewing'
      ? (row.group.primary.lead?.stage ?? row.group.leadStage ?? null)
      : row.kind === 'direct' ? row.lead.stage : null,
    paymentPlan: lead?.paymentPlan ?? null,
    allRequiredDocsUploaded,
    docsSubmitted: readDocsSubmitted(row.key),
    myDocs: docs,
    requestedAdditionalDocs: parseAdditionalDocs(lead?.additionalDocsNote ?? null),
  });
}

/** The per-subcategory naming options for a row — same rule as the detail
 *  page (lib/spaceJourney), so the card and the page name the same stop. */
function rowJourneyOptions(row: SpaceRow, key: CustomerStateKey): JourneyOptions {
  const unitType = row.kind === 'viewing'
    ? row.group.unit?.unitType
    : row.kind === 'direct'
      ? row.lead.unit?.unitType
      : row.contract.unit?.unitType;
  const c = row.contract ?? row.renewalContract;
  return journeyOptionsFor(key, {
    unitType: unitType ?? c?.unit?.unitType ?? null,
    spaceCategory: c?.property?.spaceCategory ?? null,
    emirate: c?.property?.emirate ?? (row.kind === 'viewing' ? row.group.unit?.property?.emirate?.name : row.kind === 'direct' ? row.lead.unit?.property?.emirate?.name : null) ?? null,
    viewing: row.kind === 'viewing' ? row.group.primary : null,
    direct: row.kind === 'direct',
  });
}

/** Pill + tone for a resolved journey state. */
function journeyStatusConfig(key: CustomerStateKey, opts: JourneyOptions): { label: string; step: string; bg: string; text: string; isAction: boolean } {
  const def = presentCustomerState(CUSTOMER_STATE_DEFS[key], key, opts);
  const step = customerStepLabel(key, opts);
  const palette = {
    action:    { bg: 'bg-[#fbe5dc]', text: 'text-[#c8492c]' },
    waiting:   { bg: 'bg-[#fbebcc]', text: 'text-[#a0641b]' },
    celebrate: { bg: 'bg-[#d8efe3]', text: 'text-[#1a7a5a]' },
    declined:  { bg: 'bg-[#eef1ef]', text: 'text-[#5f6b63]' },
  }[def.tone];
  return { label: def.label, step, ...palette, isAction: def.tone === 'action' };
}

/* ── InactiveCard ───────────────────────────────────────────────────────────── */

function InactiveCard({ label, subLabel, dateStr, reason }: { label: string; subLabel?: string; dateStr: string; reason: string }) {
  return (
    <div className="bg-white rounded-xl p-4 border border-[#e4e9e5] flex items-center gap-3 opacity-60">
      <div className="w-8 h-8 rounded-full bg-[#eef1ef] flex items-center justify-center flex-shrink-0">
        <Ban size={14} className="text-[#8a948d]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#46534c] truncate">{label}</p>
        {subLabel && <p className="text-xs text-[#8a948d]">{subLabel}</p>}
        <p className="text-xs text-[#8a948d]">{dateStr} · {reason}</p>
      </div>
      <a href="/listings" className="ml-auto flex-shrink-0 text-xs text-[#047246] hover:underline font-medium">Find another →</a>
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
  const [docs,         setDocs]         = useState<TenantDoc[]>([]);
  const [entityType,   setEntityType]   = useState<'individual' | 'company' | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  /** Last fetch start, for the focus-refetch throttle below. */
  const lastFetchRef = useRef(0);

  // `background` = a focus/visibility refetch rather than the first load. Those
  // must not flip `loading`, or the whole card grid drops to skeletons on every
  // tab switch — which reads as the page reloading on a loop.
  const fetchAll = useCallback(async (background = false) => {
    lastFetchRef.current = Date.now();
    if (!background) setLoading(true);
    setError(null);
    try {
      const [vRes, lRes, cRes, dRes] = await Promise.all([
        fetch('/api/leads/my-viewings',     { credentials: 'include' }),
        fetch('/api/leads/my-applications', { credentials: 'include' }),
        fetch('/api/contracts/tenant',      { credentials: 'include' }),
        // Needed to tell "documents required" from "documents under review" —
        // without it every pre-contract space collapses to one vague label.
        fetch('/api/documents/my',          { credentials: 'include' }),
      ]);
      if (!vRes.ok) throw new Error(`Failed to load viewings (${vRes.status})`);
      const vData = await vRes.json();
      setViewings(Array.isArray(vData) ? vData : []);
      // Applications used to be guarded by a bare `if (lRes.ok)`, so a broken
      // endpoint just rendered an empty list forever with nothing to show for
      // it — a route-order bug hid behind that silence. Fail loudly instead.
      if (!lRes.ok) throw new Error(`Failed to load applications (${lRes.status})`);
      const lData = await lRes.json();
      setDirectLeads(Array.isArray(lData) ? lData : []);
      if (cRes.ok) { const d = await cRes.json(); setContracts(Array.isArray(d) ? d : []); }
      if (dRes.ok) {
        const d = await dRes.json();
        // A doc the RP merely REQUESTED is a row with no file — it is the
        // request, not the document, so it must not tick off the checklist.
        const list: TenantDoc[] = Array.isArray(d?.documents) ? d.documents : [];
        setDocs(list.filter(x => !!x.fileUrl));
        setEntityType(d?.entityType ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh on return to the tab. `focus` and `visibilitychange` BOTH fire on a
  // single tab switch, so this listens to visibility only and throttles to 30s
  // — matching useNavBadgeCounts in DashboardShell. Previously both events ran
  // unthrottled, firing eight requests per focus.
  useEffect(() => {
    function refetchIfVisible() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchRef.current < 30_000) return;
      void fetchAll(true);   // stamps lastFetchRef itself
    }
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => document.removeEventListener('visibilitychange', refetchIfVisible);
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
  // A space is past only when the WHOLE chain is done. An expired lease whose
  // renewal is still in flight is not past — the renewal is the live thing the
  // customer has to act on, and the old term ending first is the norm, not the
  // exception (renewal starts 1 Aug, old lease ended 31 Jul; the customer still
  // owes cheques/signature). Judging the row on the parent's status alone filed
  // those under "Past · Lease ended" and hid the renewal CTA entirely.
  //
  // The renewal CHILD is the source of truth: any non-terminal child keeps the
  // row live, whatever the parent reads. `renewalAccepted === 'pending'` is kept
  // only as the no-child fallback (offer recorded before the draft resolves).
  const chainStillLive = (x: { contract: TenantContract; renewalContract?: TenantContract }) =>
    !TERMINAL_CONTRACT.has(x.contract.status) ||
    (x.renewalContract
      ? !TERMINAL_CONTRACT.has(x.renewalContract.status)
      : x.contract.renewalAccepted === 'pending');
  const contractOnly = Array.from(
    new Set(contracts.map(c => c.unit?.id).filter((x): x is number => x != null)),
  )
    .filter(uid => !representedUnitIds.has(uid))
    .map(uid => chainForUnit(contracts, uid))
    .filter((x): x is { contract: TenantContract; renewalContract: TenantContract | undefined } => !!x.contract);
  const activeContractRows: SpaceRow[] = contractOnly
    .filter(chainStillLive)
    .map(x => ({ kind: 'contract' as const, key: `c-${x.contract.id}`, contract: x.contract, renewalContract: x.renewalContract }));
  const pastContractRows = contractOnly
    .filter(x => !chainStillLive(x))
    .map(x => x.contract);

  const activeRows: SpaceRow[] = [
    ...activeGroups.map(g => ({
      kind: 'viewing' as const,
      key: `v-${g.leadId}`,
      group: g,
      ...chainForUnit(contracts, g.unit?.id),
    })),
    ...activeDirectLeads.map(l => ({
      kind: 'direct' as const,
      key: `d-${l.id}`,
      lead: l,
      ...chainForUnit(contracts, l.unit?.id),
    })),
    ...activeContractRows,
  ];

  // Resolve every row's journey state ONCE — the header counts and the card
  // bodies must read the same number, so they share this list.
  const rowStates = activeRows.map(r => rowJourney(r, docs, entityType));

  const isLiveTenancy = (k: CustomerStateKey) => k === 'active' || k === 'renewal_active' || k === 'terminating';
  const isRenewing = (k: CustomerStateKey) => CUSTOMER_STATE_DEFS[k].mode === 'renewal' && k !== 'renewal_active';
  const activeCount   = rowStates.filter(isLiveTenancy).length;
  const renewingCount = rowStates.filter(isRenewing).length;
  // In-progress = still working toward a lease; excludes live tenancies, rows
  // already counted under "renewing", and dead-ends (declined/superseded).
  const inProgressCount = rowStates.filter(k =>
    !isLiveTenancy(k) && !isRenewing(k) && CUSTOMER_STATE_DEFS[k].currentIndex >= 0,
  ).length;
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8a948d]">
            Hello {firstName}
          </p>
          <h1 className="text-3xl font-bold text-[#14201a] mt-1.5 leading-[1.1] tracking-tight">
            Your <span className="text-[#1f5a3f]">spaces</span>
          </h1>
          <p className="text-sm text-[#5f6b63] mt-2 max-w-md">
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
            const stateKey = rowStates[idx];
            const jOpts = rowJourneyOptions(row, stateKey);
            const def = presentCustomerState(CUSTOMER_STATE_DEFS[stateKey], stateKey, jOpts);
            const sc = journeyStatusConfig(stateKey, jOpts);
            const totalSteps = journeyPosition(stateKey, jOpts).total;
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
            const isActive = def.tone === 'celebrate';
            const community = unit?.property?.community?.name ?? null;
            const emirate = unit?.property?.emirate?.name ?? null;
            const location = [community, emirate].filter(Boolean).join(', ') || null;
            // Beds only apply to residential units — a leased shop/office shows "—".
            const bedrooms = isResidentialUnitType(unit?.unitType) ? unit?.bedrooms : null;
            // Which contract the money/term stats describe. Once the current
            // term has ENDED and the renewal is the live one, the strip must
            // read the RENEWAL's dates and rent — an already-finished term on a
            // card whose CTA says "sign your renewal" reads as a past lease.
            const termC = c && TERMINAL_CONTRACT.has(c.status) && row.renewalContract ? row.renewalContract : c;
            const annual = termC?.annualRent ?? unit?.rentalPrice ?? null;
            const annualIsAsking = !termC?.annualRent && annual != null;
            const periodLabel = termC?.startDate && termC?.endDate
              ? { label: 'Period', value: `${fmtShort(termC.startDate)} -> ${fmtShort(termC.endDate)}` }
              : row.kind === 'viewing'
                ? { label: 'Viewing', value: fmtShort(row.group.primary.scheduledAt) }
                : row.kind === 'direct'
                  ? { label: 'Applied', value: fmtShort(row.lead.createdAt) }
                  : { label: 'Contract', value: `CID-${row.contract.id}` };
            const buildingName = unit?.property?.buildingName ?? '';
            // Show the Unit No (a stable identifier) — NOT unitName, which holds a
            // marketing/listing description ("Spacious unit in Bur Dubai...") that is
            // identical across a building's units and makes cards indistinguishable.
            const unitLabel = unit?.unitNumber ? `Unit ${unit.unitNumber}` : (unit?.unitName ?? 'Property');
            const photo = DUMMY_PHOTOS[idx % DUMMY_PHOTOS.length];
            const tone: 'action' | 'waiting' | 'settled' | 'closed' =
              def.tone === 'declined' ? 'closed' : sc.isAction ? 'action' : isActive ? 'settled' : 'waiting';
            // The eyebrow names WHO the space is waiting on — the old copy said
            // "In progress" for every non-active row, which is the one thing the
            // customer can already see from the fact that it's on this list.
            const toneCfg = {
              action:  { bg: 'bg-[#fbe5dc]', border: 'border-[#f3c4b3]', dot: 'bg-[#c8492c]', label: 'text-[#c8492c]', icon: <AlertCircle size={14} className="text-white" />, eyebrow: 'Your turn' },
              waiting: { bg: 'bg-[#fbebcc]', border: 'border-[#f0d68f]', dot: 'bg-[#a0641b]',  label: 'text-[#a0641b]',  icon: <Clock size={14} className="text-white" />,        eyebrow: 'With your rental provider' },
              settled: { bg: 'bg-[#e0ede0]', border: 'border-[#bdd9b8]', dot: 'bg-[#1f5a3f]',  label: 'text-[#1f5a3f]',  icon: <CheckCircle2 size={14} className="text-white" />, eyebrow: 'Active' },
              closed:  { bg: 'bg-[#eef1ef]', border: 'border-[#e4e9e5]', dot: 'bg-[#8a948d]',  label: 'text-[#5f6b63]',  icon: <Ban size={14} className="text-white" />,          eyebrow: 'Closed' },
            }[tone];

            return (
              <Link
                key={row.key}
                href={`/dashboard/customer/spaces/v2/${row.key}`}
                className="text-left bg-white rounded-2xl border border-[#e4e9e5] shadow-sm overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-[#14201a]/30 flex flex-col"
              >
                {/* Hero photo */}
                <div className="relative h-44 overflow-hidden bg-[#eef1ef]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo} alt={buildingName || unitLabel} className="w-full h-full object-cover" loading="lazy" />
                  <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 45%,rgba(0,0,0,0) 60%,rgba(26,23,20,.55) 100%)' }} />
                  {c?.renewalAccepted === 'pending' && (
                    <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] bg-[#14201a] text-white inline-flex items-center gap-1">
                      <RotateCcw size={10} /> Renewal — Action
                    </span>
                  )}
                  {/* The pill now names the actual journey step ("Documents
                      required", "Awaiting your signature") rather than a coarse
                      bucket, and carries its position on the subcategory rail (8 stops, 7 for land). */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
                    <span className={`text-[11px] font-semibold rounded-full px-3 py-1.5 ${sc.bg} ${sc.text} shadow-sm ${sc.isAction ? 'upnow-action-pill' : ''}`}>
                      {sc.isAction && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 align-middle" />}
                      {sc.label}
                    </span>
                    {sc.step && (
                      <span className="text-[10px] font-semibold rounded-full px-2.5 py-1 bg-[#14201a]/75 text-white shadow-sm whitespace-nowrap tabular-nums">
                        {sc.step}
                      </span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="p-5 flex flex-col gap-4 flex-1">
                  <div>
                    {location && (
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8a948d] mb-1">{location}</p>
                    )}
                    <h3 className="text-lg font-bold text-[#14201a] leading-tight tracking-tight">
                      {buildingName || unitLabel}
                      {buildingName && unitLabel && (
                        <>, <span className="font-semibold text-[#1f5a3f]">{unitLabel}</span></>
                      )}
                    </h3>
                  </div>

                  {/* What is actually happening right now. Without this the card
                      said only "In progress", which is the one thing the customer
                      can already tell from the space being on this list. */}
                  {totalSteps > 0 && (
                    <p className="text-xs text-[#5f6b63] leading-snug">
                      <span className="font-semibold text-[#14201a]">{def.headline}</span>
                      {def.timing && <span className="text-[#8a948d]"> · {def.timing}</span>}
                    </p>
                  )}

                  {/* Stats strip */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-y border-[#f0ede8]">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8a948d]">Beds</p>
                      <p className="text-sm font-semibold text-[#14201a] mt-0.5">
                        {bedrooms != null ? (bedrooms === 0 ? 'Studio' : `${bedrooms} BR`) : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8a948d]">
                        {annualIsAsking ? 'Asking' : 'Annual'}
                      </p>
                      <p className="text-sm font-semibold text-[#14201a] mt-0.5 tabular-nums">
                        {annual != null ? `AED ${(annual / 1000).toFixed(0)}K` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8a948d]">{periodLabel.label}</p>
                      <p className="text-sm font-semibold text-[#14201a] mt-0.5">{periodLabel.value}</p>
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
                    <span className="text-xs font-semibold text-[#14201a] inline-flex items-center gap-1">
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
          <div className="w-14 h-14 rounded-full bg-[#d8efe3] flex items-center justify-center mb-4">
            <BedDouble size={24} className="text-[#047246]" />
          </div>
          <h3 className="font-semibold text-[#14201a] mb-1">No spaces yet</h3>
          <p className="text-sm text-[#5f6b63] max-w-xs">Browse listings and book a viewing or apply directly to get started.</p>
          <a href="/listings" className="mt-4 text-sm font-medium text-[#047246] hover:underline">Browse listings →</a>
        </div>
      )}

      {/* Past / inactive */}
      {!loading && (inactiveGroups.length > 0 || inactiveDirectLeads.length > 0 || pastContractRows.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-[#46534c] uppercase tracking-wide mb-3">Past</h2>
          <div className="space-y-3">
            {pastContractRows.map(c => (
              <InactiveCard
                key={`pc-${c.id}`}
                label={c.unit?.number ? `Unit ${c.unit.number}` : (c.unit?.name ?? 'Property')}
                subLabel={c.property?.buildingName ?? undefined}
                dateStr={c.endDate ? new Date(c.endDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE }) : ''}
                reason={c.status === 'terminated' ? 'Lease terminated' : 'Lease ended'}
              />
            ))}
            {inactiveGroups.map(g => (
              <InactiveCard
                key={`iv-${g.leadId}`}
                label={g.unit?.unitNumber ? `Unit ${g.unit.unitNumber}` : (g.unit?.unitName ?? 'Property')}
                subLabel={g.unit?.property?.buildingName}
                dateStr={new Date(g.primary.scheduledAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE })}
                reason={g.primary.outcome === 'not_interested' ? 'Not interested' : g.primary.status === 'no_show' ? 'No show' : 'Cancelled'}
              />
            ))}
            {inactiveDirectLeads.map(l => (
              <InactiveCard
                key={`id-${l.id}`}
                label={l.unit?.unitNumber ? `Unit ${l.unit.unitNumber}` : (l.unit?.unitName ?? 'Property')}
                subLabel={l.unit?.property?.buildingName}
                dateStr={new Date(l.createdAt).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE })}
                reason="Application rejected"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
