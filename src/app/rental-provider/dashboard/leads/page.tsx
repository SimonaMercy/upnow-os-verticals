'use client';

/**
 * Demand › Leads — the LONG-TERM lease queue (residential / commercial / industrial /
 * land). Short stays, venues, courts and yachts live under Demand › All demand
 * (/rental-provider/dashboard/requests). Stage words follow the lead's unit
 * subcategory (lib/spaceJourney); first-reply target is 15 min (lib/os/sla).
 *
 * Used by the RP portal (default export) AND the Manager portal, which imports
 * `LeadsWorkspace` and renders it with `manager={{ rp }}` + `canCreateLeads` —
 * keep that export and its props stable. In manager mode every lead call is
 * rewritten to /api/manager/leads/*?rp= by leadUrl(), and the landlord rules by
 * rpSettingsUrl().
 *
 * Parity with previous page (leads/page.tsx before the Genspark rebuild):
 *  - GET /api/leads (manager: GET /api/manager/leads?rp=) on mount + Refresh button.      ✔ kept
 *  - Re-fetch on window focus, only when visible, throttled to once / 10s.                  ✔ kept (silent, no skeleton flash)
 *  - GET profile rules via rpSettingsUrl('/api/profiles/rental-provider/me')
 *    → preferredStartDays + allowedInstallments, re-fetched when ?rp= changes,
 *    fed to NewLeadModal.                                                                  ✔ kept
 *  - "Add Lead" (gated on canCreateLeads) → NewLeadModal (reused as-is); on close,
 *    navigate to the created lead (id parked until the overlay closes); onCreated
 *    re-fetches the list. Also offered from the empty state.                               ✔ kept
 *  - Stage filter with live counts, funnel order: Viewing · Interested · Docs · Plan ·
 *    Payment Confirmation · Collected · Converted · Rejected · All (All excludes
 *    Rejected); clicking the active stage again clears it; switching stage clears search. ✔ kept (Seg)
 *  - Needs-action triage (getUrgency) banner with count + per-stage breakdown and a
 *    Show / Show all toggle that filters to urgent leads (auto-released at 0).             ✔ kept (Callout)
 *  - Search across company/person name, contact person, unit name/number, building,
 *    email, phone; Clear; result count.                                                    ✔ kept
 *  - Views Row · Grid · Calendar, with ?view=row|grid|calendar deep links (the rail's
 *    Operations › Calendar opens ?view=calendar).                                           ✔ kept as Queue · Pipeline ·
 *    Calendar; ?view=row|queue → Queue, ?view=grid|pipeline → Pipeline, ?view=calendar →
 *    Calendar. Filters/search are shared across all three views, as before.
 *  - LeadsCalendarView (reused as-is) with the filtered leads; clicking a viewing opens
 *    the lead.                                                                              ✔ kept
 *  - Row/card click → lead detail route (/rental-provider/dashboard/leads/:id, manager:
 *    /dashboard/manager/leads/:id?rp=). Every lead action — mark visited, review/approve
 *    documents, request docs, issue/edit/share payment plan, payment review, confirm
 *    collected, issue contract, reject/reopen, guard notice, notes — lives on that
 *    detail page and is reached through the labelled "Open" button.                         ✔ kept
 *  - Row data: avatar, display name (company wins), contact person, email, phone, unit +
 *    building, stage pill, urgency pill, customer-decline note on rejected leads, viewing
 *    date (amber when passed), annual rent (firm plan rent, else unit listed price).        ✔ kept
 *  - Loading skeletons, error message, "No leads yet" empty state, "no match" state.       ✔ kept (+ retry)
 *
 *  Dropped as dead code (was never reachable from the old UI): the old LeadRow carried
 *  ~650 lines of panel state/handlers (plan form, cheque rows, docs panel, guard notice,
 *  moveStage / handleConvert props) that its render never displayed — the row only ever
 *  navigated to the detail page, where those actions really live. The GET /api/fee-rules
 *  fetch only fed that unreachable plan form, so it is no longer made here (the detail
 *  page still loads fee rules for its own plan form).
 *  Urgency now uses the shared getUrgency() in lib/leadJourney (same as the detail page,
 *  with its 4h grace on a just-passed viewing) instead of a stale inline copy.
 *
 *  New (from real data only): source filter (lead.source), priority filter when the
 *  data carries more than one priority, KPIs, "Waiting" (time since last update) and a
 *  "Next action" pill (urgency, else the stage's primary action from getPrimary()).
 *  No assignee filter: the leads API does not return an assigned agent.
 *
 *  First-response SLA (research: "Responsiveness is a published SLA"; rule in lib/os/sla.ts,
 *  shared with Overview › Today so both screens show the same clock):
 *  [+] "First reply" column on the Queue — "Reply within 12m" (info → amber under 5m) or
 *      "Overdue 3h" (red) for leads awaiting a first response; "—" for every other lead.
 *      The clock re-reads every 30s (no refetch — it is arithmetic on createdAt).
 *  [+] "Needs reply (N)" filter chip in the toolbar (shared by all three views, like the other
 *      filters; cleared by Clear). N counts every lead on the clock regardless of other filters.
 *  [+] Queue sort: "Most urgent" (default) = SLA overdue → SLA least time left → getUrgency red →
 *      amber → the API's order; "As received" keeps the API order exactly as before.
 *  [+] Pipeline cards show the SLA pill ahead of the urgency pill when a lead is on the clock.
 *  Nothing removed: every column, filter, view, action and endpoint above is unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, RefreshCw } from 'lucide-react';
import {
  Board, BoardCard, BoardCol, Btn, Callout, Card, EmptyRow, ErrorRow, Kpi, Kpis, OsPage, PageHead, Pill,
  ScopeStrip, SearchField, Seg, SkeletonRows, TableWrap, fmtAed, fmtFils, humanize, initials, type Tone,
} from '@/components/os/kit';
import { LeadsCalendarView } from '@/components/leads/LeadsCalendarView';
import { NewLeadModal } from '@/components/leads/NewLeadModal';
import { rpSettingsUrl } from '@/lib/rpSettingsUrl';
import { APP_TIME_ZONE } from '@/lib/datetime';
import {
  STAGE_LABELS, getPendingViewing, getLatestViewing, getPrimary, getUrgency, leadContactPerson, leadDisplayName,
  type ApiLead, type LeadStage,
} from '@/lib/leadJourney';
import { FIRST_RESPONSE_SLA_LABEL, awaitingFirstResponse, firstResponseSla, slaRank, type SlaState } from '@/lib/os/sla';
import { leadColumnLabel, leadStageLabel, spaceSubcategory, type SpaceSubcategory } from '@/lib/spaceJourney';
import Link from 'next/link';

/* ─── Vocabulary ──────────────────────────────────────────────────────────── */

// Pipeline columns, in funnel order; terminal stages last. `cheques_collected` is
// normally transient (the contract auto-issues and the lead jumps to converted) —
// it only rests there if the auto-create failed, so it stays as the recovery lane.
//
// "New / Contacted" comes first: a lead at `new` is exactly the one on the
// first-reply clock (lib/os/sla keys on stage === 'new'), so it must be a
// visible lane, not buried under "Other stages". `contacted` shares the lane —
// the two together are "enquiries not yet at a viewing / site visit".
//
// The titles here are the fallbacks; the rendered titles come from
// lib/spaceJourney (leadColumnLabel) so a commercial-only portfolio reads
// "Site visit / Company docs / Heads of terms" and a mixed one the neutral pair.
const FUNNEL_COLS: [LeadStage, string][] = [
  ['new',                  'New / Contacted'],
  ['viewing_scheduled',    'Viewing'],
  ['interested',           'Interested'],
  ['documents_collection', 'Docs'],
  ['payment_plan_shared',  'Plan'],
  ['cheques_submitted',    'Payment Confirmation'],
  ['cheques_collected',    'Collected'],
  ['converted',            'Converted'],
  ['rejected',             'Rejected'],
];
const FUNNEL_SET = new Set<LeadStage>([...FUNNEL_COLS.map(([s]) => s), 'contacted']);
/** Does a lead at `stage` belong in column / stage filter `col`? */
const inCol = (col: LeadStage, stage: LeadStage) => col === stage || (col === 'new' && stage === 'contacted');

/** The lead's long-term subcategory — decides which words its stage uses. */
const leadSub = (lead: ApiLead): SpaceSubcategory => spaceSubcategory(lead.unit?.unitType ?? null);

/** Column / filter title for a stage over the leads in view. */
function colTitle(stage: LeadStage, fallback: string, subs: Set<SpaceSubcategory>): string {
  if (stage === 'new') return 'New / Contacted';
  if (stage === 'rejected' || stage === 'cheques_collected') return fallback;
  if (stage === 'cheques_submitted') return 'Payment confirmation';
  return subs.size ? leadColumnLabel(stage, subs) : fallback;
}

const STAGE_TONE: Record<LeadStage, Tone> = {
  new: 'info', contacted: 'info', viewing_scheduled: 'info', offer_made: 'primary', applied: 'info', approved: 'primary',
  documents_collection: 'amber', payment_plan_shared: 'info', interested: 'primary', cheques_submitted: 'amber',
  cheques_collected: 'primary', contract_issued: 'primary', rejected: 'danger', converted: 'primary',
};

// Short phrases for the needs-action breakdown, per urgent stage.
const URGENCY_PHRASE: Partial<Record<LeadStage, [string, string]>> = {
  viewing_scheduled:    ['overdue viewing', 'overdue viewings'],
  interested:           ['no next step', 'no next step'],
  documents_collection: ['docs pending', 'docs pending'],
  payment_plan_shared:  ['stale plan', 'stale plans'],
  cheques_submitted:    ['payment advice to collect', 'payment advice to collect'],
};

// Mirrors LEAD_SOURCES in the backend (see NewLeadModal SOURCES) + `portal`,
// which the marketplace stamps itself.
const SOURCE_LABEL: Record<string, string> = {
  walk_in: 'Walk-in', phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', referral: 'Referral', agent: 'Agent',
  property_finder: 'Property Finder', bayut: 'Bayut', dubizzle: 'Dubizzle', social_media: 'Social media',
  other: 'Other', portal: 'Marketplace',
};
const NO_SOURCE = '__none__';
const sourceLabel = (s: string | null) => (s ? SOURCE_LABEL[s] ?? humanize(s) : 'Not recorded');

type View = 'queue' | 'pipeline' | 'calendar';
const viewFromParam = (p: string | null): View =>
  p === 'calendar' ? 'calendar' : p === 'grid' || p === 'pipeline' ? 'pipeline' : 'queue';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Rewrites an RP lead URL to the manager-scoped equivalent when acting as a manager. */
function leadUrl(path: string, manager?: { rp: number } | null): string {
  if (!manager) return path;
  const swapped = path.replace('/api/leads', '/api/manager/leads');
  return swapped + (swapped.includes('?') ? '&' : '?') + `rp=${manager.rp}`;
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-AE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE,
  });
}

function waitingFor(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return '<1h';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Annual rent — the firm plan's rent (fils) once issued, else the unit's listed price (AED). */
function rentText(lead: ApiLead): string | null {
  if (lead.paymentPlan) return fmtFils(lead.paymentPlan.rentFils);
  if (lead.unit?.rentalPrice != null) return fmtAed(lead.unit.rentalPrice);
  return null;
}

function unitText(lead: ApiLead): { unit: string | null; building: string | null } {
  return {
    unit: lead.unit?.unitNumber ? `Unit ${lead.unit.unitNumber}` : (lead.unit?.unitName ?? null),
    building: lead.unit?.property?.buildingName ?? null,
  };
}

function declineNote(lead: ApiLead): string | null {
  const v = getLatestViewing(lead);
  if (lead.stage === 'rejected' && v?.status === 'cancelled' && v?.outcome === 'not_interested') {
    return v.declineNote?.trim() ? v.declineNote : 'Customer declined';
  }
  return null;
}

function NextAction({ lead }: { lead: ApiLead }) {
  const u = getUrgency(lead);
  if (u) return <Pill tone={u.level === 'red' ? 'danger' : 'amber'} title={u.label}>{u.label}</Pill>;
  const p = getPrimary(lead);
  if (p) return <Pill tone="primary">{p.label}</Pill>;
  if (lead.stage === 'payment_plan_shared') return <Pill tone="neutral">Waiting on customer</Pill>;
  return <span style={{ color: 'var(--ms-ink-3)' }}>—</span>;
}

function SlaPill({ sla }: { sla: SlaState }) {
  const due = new Date(sla.dueAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
  return <Pill tone={sla.tone} title={`First reply due ${due} (${FIRST_RESPONSE_SLA_LABEL} target from arrival)`}>{sla.label}</Pill>;
}

const URGENCY_ORDER = { red: 0, amber: 1 } as const;

/** Stage pill in the lead's own words (residential "Viewing" vs commercial
 *  "Site visit"…) — its unit category decides. */
function StagePill({ stage, sub }: { stage: LeadStage; sub?: SpaceSubcategory }) {
  const label = sub ? leadStageLabel(stage, sub) : (STAGE_LABELS[stage] ?? humanize(stage));
  return <Pill tone={STAGE_TONE[stage] ?? 'neutral'}>{label}</Pill>;
}

/* ─── Workspace ───────────────────────────────────────────────────────────── */

/**
 * `canCreateLeads` gates "Add Lead". The RP owns their pipeline (default true);
 * a manager only gets it when the landlord granted "Add new leads".
 */
export function LeadsWorkspace({ manager, canCreateLeads = true }: { manager?: { rp: number }; canCreateLeads?: boolean }) {
  const router = useRouter();
  const managerRp = manager?.rp ?? null;
  const scope = useMemo(() => (managerRp != null ? { rp: managerRp } : null), [managerRp]);

  const [leads, setLeads]     = useState<ApiLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tick, setTick]       = useState(0);

  const [search, setSearch]         = useState('');
  const [activeTab, setActiveTab]   = useState<'all' | LeadStage>('all');
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [source, setSource]         = useState<string>('all');
  const [priority, setPriority]     = useState<string>('all');
  const [needsReply, setNeedsReply] = useState(false);
  const [sortBy, setSortBy]         = useState<'urgency' | 'received'>('urgency');

  // ?view= deep link wins until the person picks a view on this page; a new ?view=
  // (e.g. the rail's Calendar link clicked while already here) takes over again.
  const viewParam = useSearchParams().get('view');
  const [picked, setPicked] = useState<{ param: string | null; view: View } | null>(null);
  const view: View = picked && picked.param === viewParam ? picked.view : viewFromParam(viewParam);

  const [preferredStartDays, setPreferredStartDays]   = useState<number[]>([]);
  const [allowedInstallments, setAllowedInstallments] = useState<number[]>([]);
  const [addingLead, setAddingLead] = useState(false);
  const createdLeadRef = useRef<number | null>(null);
  // Re-read every 30s so the first-reply countdowns stay live (pure arithmetic, no refetch).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const openLead = useCallback((id: number) => {
    router.push(managerRp != null ? `/dashboard/manager/leads/${id}?rp=${managerRp}` : `/rental-provider/dashboard/leads/${id}`);
  }, [router, managerRp]);
  const leadHref = (id: number) =>
    managerRp != null ? `/dashboard/manager/leads/${id}?rp=${managerRp}` : `/rental-provider/dashboard/leads/${id}`;

  // Leads list.
  useEffect(() => {
    let cancelled = false;
    fetch(leadUrl('/api/leads', scope), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load leads (${res.status})`);
        const data = await res.json();
        if (!cancelled) { setLeads(Array.isArray(data) ? data : []); setError(null); }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load leads'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, tick]);

  const reload = useCallback(() => { setLoading(true); setError(null); setTick((t) => t + 1); }, []);

  // Re-fetch on focus so the RP sees the customer's latest submission — throttled
  // (≤ once / 10s) and only when visible. Seeded to "now" so it won't double the mount fetch.
  useEffect(() => {
    let last = Date.now();
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < 10_000) return;
      last = Date.now();
      setTick((t) => t + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Landlord rules for the New Lead modal (manager: the landlord chosen with ?rp=).
  useEffect(() => {
    fetch(rpSettingsUrl('/api/profiles/rental-provider/me', scope), { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { profile?: { preferredStartDays?: number[] | null; allowedInstallments?: number[] | null } } | null) => {
        if (Array.isArray(data?.profile?.preferredStartDays)) setPreferredStartDays(data!.profile!.preferredStartDays!);
        if (Array.isArray(data?.profile?.allowedInstallments)) setAllowedInstallments(data!.profile!.allowedInstallments!);
      })
      .catch(() => undefined);
  }, [scope]);

  // Needs-action triage.
  const urgentLeads = useMemo(() => leads.filter((l) => getUrgency(l) !== null), [leads]);
  const urgentCount = urgentLeads.length;
  const urgentFilter = urgentOnly && urgentCount > 0; // released automatically when the last one is resolved
  const urgencySummary = useMemo(() => {
    const byStage = new Map<LeadStage, number>();
    urgentLeads.forEach((l) => byStage.set(l.stage, (byStage.get(l.stage) ?? 0) + 1));
    return [...byStage.entries()]
      .map(([s, n]) => { const p = URGENCY_PHRASE[s]; return p ? `${n} ${n === 1 ? p[0] : p[1]}` : null; })
      .filter(Boolean)
      .join(' · ');
  }, [urgentLeads]);

  // First-response SLA (lib/os/sla) — whole pipeline, independent of other filters.
  const needsReplyCount = useMemo(() => leads.filter((l) => awaitingFirstResponse(l)).length, [leads]);

  // Real-data filter options.
  const sourceOptions = useMemo(() => {
    const m = new Map<string, number>();
    leads.forEach((l) => { const k = l.source ?? NO_SOURCE; m.set(k, (m.get(k) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [leads]);
  const priorityOptions = useMemo(() => {
    const m = new Map<string, number>();
    leads.forEach((l) => { if (l.priority) m.set(l.priority, (m.get(l.priority) ?? 0) + 1); });
    return [...m.entries()];
  }, [leads]);

  // "All" = every live lead; Rejected keeps its own stage.
  const tabCount = (key: 'all' | LeadStage) =>
    key === 'all' ? leads.filter((l) => l.stage !== 'rejected').length : leads.filter((l) => inCol(key, l.stage)).length;
  // Subcategories present in the pipeline — decides the column words.
  const subsInView = useMemo(() => new Set(leads.map(leadSub)), [leads]);

  const filtered = useMemo(() => leads.filter((l) => {
    if (urgentFilter && !getUrgency(l)) return false;
    if (needsReply && !awaitingFirstResponse(l)) return false;
    if (activeTab === 'all' ? l.stage === 'rejected' : !inCol(activeTab, l.stage)) return false;
    if (source !== 'all' && (l.source ?? NO_SOURCE) !== source) return false;
    if (priority !== 'all' && l.priority !== priority) return false;
    if (search) {
      const q = search.toLowerCase();
      const name = `${leadDisplayName(l)} ${leadContactPerson(l) ?? ''}`.toLowerCase();
      const unit = (l.unit?.unitName ?? l.unit?.unitNumber ?? '').toLowerCase();
      const bldg = (l.unit?.property?.buildingName ?? '').toLowerCase();
      const eml  = (l.leadEmail ?? l.convertedTenant?.user?.email ?? '').toLowerCase();
      const ph   = (l.leadPhone ?? '').toLowerCase();
      if (![name, unit, bldg, eml, ph].some((f) => f.includes(q))) return false;
    }
    return true;
  }), [leads, urgentFilter, needsReply, activeTab, source, priority, search]);

  // Queue order: most urgent first (SLA clock, then getUrgency), API order as the tie-break.
  const queueRows = useMemo(() => {
    if (sortBy === 'received') return filtered;
    return filtered
      .map((l, i) => {
        const u = getUrgency(l);
        return { l, i, sla: slaRank(l, now), urg: u ? URGENCY_ORDER[u.level] : 2 };
      })
      .sort((a, b) => (a.sla - b.sla) || (a.urg - b.urg) || (a.i - b.i))
      .map((x) => x.l);
  }, [filtered, sortBy, now]);

  const filtersDirty = !!search || source !== 'all' || priority !== 'all' || urgentFilter || needsReply;
  const clearFilters = () => { setSearch(''); setSource('all'); setPriority('all'); setUrgentOnly(false); setNeedsReply(false); };
  const pickStage = (s: 'all' | LeadStage) => { setActiveTab(s === activeTab ? 'all' : s); setSearch(''); };

  // KPIs (whole pipeline, independent of filters).
  const live = leads.filter((l) => l.stage !== 'rejected' && l.stage !== 'converted');
  const viewingsBooked = leads.filter((l) => {
    const v = getPendingViewing(l);
    return v && new Date(v.scheduledAt).getTime() >= now;
  }).length;
  const paymentReview = leads.filter((l) => l.stage === 'cheques_submitted').length;
  const converted = leads.filter((l) => l.stage === 'converted').length;

  const stageOptions = [...FUNNEL_COLS, ['all', 'All'] as ['all', string]].map(([v, l]) => ({
    v, l: v === 'all' ? l : colTitle(v, l, subsInView), n: loading ? undefined : tabCount(v),
  }));

  const toolbar = (
    <>
      <SearchField value={search} onChange={setSearch} placeholder="Search name, email, phone, unit…" />
      <button type="button" className="gx-chip" aria-pressed={needsReply} onClick={() => setNeedsReply((v) => !v)}
        title={`Leads waiting for your first reply (${FIRST_RESPONSE_SLA_LABEL} target from arrival)`}>
        Needs reply ({loading ? '…' : needsReplyCount})
      </button>
      <select className="gx-sel" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source" style={{ height: 30 }}>
        <option value="all">All sources</option>
        {sourceOptions.map(([k, n]) => (
          <option key={k} value={k}>{k === NO_SOURCE ? 'Not recorded' : sourceLabel(k)} ({n})</option>
        ))}
      </select>
      {priorityOptions.length > 1 && (
        <select className="gx-sel" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority" style={{ height: 30 }}>
          <option value="all">All priorities</option>
          {priorityOptions.map(([k, n]) => <option key={k} value={k}>{humanize(k)} ({n})</option>)}
        </select>
      )}
      {view === 'queue' && (
        <select className="gx-sel" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'urgency' | 'received')} aria-label="Sort the queue" style={{ height: 30 }}>
          <option value="urgency">Sort: Most urgent</option>
          <option value="received">Sort: As received</option>
        </select>
      )}
      {filtersDirty && <Btn size="sm" variant="ghost" onClick={clearFilters}>Clear</Btn>}
      <span className="sp" />
      <span style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>
        {!loading && `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`}
      </span>
    </>
  );

  const COLS = 10;

  return (
    <OsPage>
      <PageHead
        eyebrow="Demand"
        title="Leads"
        lede={
          <>
            Long-term lease enquiries — residential, commercial, industrial and land — from the marketplace, walk-ins, calls and portals.
            Open a lead to move it through viewing or site visit, documents, offer and contract. First reply target: {FIRST_RESPONSE_SLA_LABEL}.
            {!manager && (
              <>
                {' '}
                <Link href="/rental-provider/dashboard/requests" style={{ color: 'var(--ms-primary, #047246)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>
                  Short stays, venues, courts &amp; yachts → All demand
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <Btn onClick={reload} disabled={loading}><RefreshCw size={13} aria-hidden /> Refresh</Btn>
            {canCreateLeads && <Btn variant="primary" onClick={() => setAddingLead(true)}><Plus size={13} aria-hidden /> Add lead</Btn>}
          </>
        }
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Demand' },
        { label: 'Pipeline', value: loading ? '…' : `${leads.length} lead${leads.length !== 1 ? 's' : ''}` },
        { label: 'Data', value: 'Live' },
      ]} />

      {!loading && urgentCount > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Callout tone="warn" title={`${urgentCount} lead${urgentCount !== 1 ? 's' : ''} need${urgentCount === 1 ? 's' : ''} action.`}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {urgencySummary && <span>{urgencySummary}</span>}
              <Btn size="xs" variant={urgentFilter ? 'amber' : undefined}
                onClick={() => { if (!urgentFilter) setActiveTab('all'); setUrgentOnly(!urgentFilter); }}>
                {urgentFilter ? 'Show all leads' : 'Show only these'}
              </Btn>
            </span>
          </Callout>
        </div>
      )}

      <Kpis>
        <Kpi dark k="Open pipeline" v={loading ? '…' : live.length} d="Not yet converted or rejected" />
        <Kpi k="Viewings booked" v={loading ? '…' : viewingsBooked} d="Upcoming, not yet held" />
        <Kpi k="Need action" v={loading ? '…' : urgentCount} d="Overdue viewing or idle stage" />
        <Kpi k="Payment review" v={loading ? '…' : paymentReview} d="Payment confirmation ready" />
        <Kpi k="Converted" v={loading ? '…' : converted} d="Contract issued" />
      </Kpis>

      <div className="gx-btn-row" style={{ justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap' }}>
        <Seg<'all' | LeadStage> label="Filter by stage" value={activeTab} options={stageOptions} onChange={pickStage} />
        <Seg<View> label="View" value={view} onChange={(v) => setPicked({ param: viewParam, view: v })}
          options={[{ v: 'queue', l: 'Queue' }, { v: 'pipeline', l: 'Pipeline' }, { v: 'calendar', l: 'Calendar' }]} />
      </div>

      {view === 'queue' && (
        <TableWrap toolbar={toolbar}>
          <table className="gx-tbl">
            <thead>
              <tr>
                <th>Lead</th><th>Source</th><th>Arrived on</th><th>Requirement · unit</th><th>Viewing</th>
                <th>Waiting</th><th>First reply</th><th>Stage</th><th>Next action</th><th className="act"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            {loading ? <SkeletonRows rows={6} cols={COLS} />
              : error ? <ErrorRow cols={COLS} onRetry={reload} />
              : leads.length === 0 ? (
                <tbody><tr><td colSpan={COLS}><div className="gx-empty">
                  <b>No leads yet</b>
                  {canCreateLeads
                    ? 'Leads appear when customers book viewings on your units — or add one yourself for a walk-in or phone enquiry.'
                    : 'Leads appear when customers book viewings on your units.'}
                  {canCreateLeads && <div style={{ marginTop: 8 }}><Btn size="sm" variant="primary" onClick={() => setAddingLead(true)}>Add lead</Btn></div>}
                </div></td></tr></tbody>
              )
              : filtered.length === 0 ? (
                <tbody><tr><td colSpan={COLS}><div className="gx-empty">
                  <b>No leads match these filters</b>Try another stage, source or search.
                  {filtersDirty && <div style={{ marginTop: 8 }}><Btn size="sm" onClick={clearFilters}>Clear filters</Btn></div>}
                </div></td></tr></tbody>
              )
              : (
                <tbody>
                  {queueRows.map((lead) => {
                    const name = leadDisplayName(lead);
                    const contact = leadContactPerson(lead);
                    const email = lead.leadEmail ?? lead.convertedTenant?.user?.email ?? null;
                    const phone = lead.leadPhone ?? lead.convertedTenant?.user?.phone ?? null;
                    const { unit, building } = unitText(lead);
                    const viewing = getPendingViewing(lead);
                    const passed = viewing ? new Date(viewing.scheduledAt).getTime() <= now : false;
                    const rent = rentText(lead);
                    const decline = declineNote(lead);
                    const sla = firstResponseSla(lead, now);
                    return (
                      <tr key={`${lead.id}-${lead.updatedAt}`} id={`lead-${lead.id}`} className="click" onClick={() => openLead(lead.id)}>
                        <td>
                          <div className="gx-cell">
                            <span className="gx-thumb" style={{ borderRadius: 999 }} aria-hidden>{initials(name)}</span>
                            <span>
                              <span className="strong">{name}</span>
                              <span className="sub">
                                <span className="mono">L-{lead.id}</span>
                                {contact ? ` · ${contact}` : ''}{` · ${email ?? 'No email'}`}{phone ? ` · ${phone}` : ''}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="nowrap">{sourceLabel(lead.source)}</td>
                        <td>{lead.unit?.unitType ? <Pill tone="outline" dot={false}>{humanize(lead.unit.unitType)}</Pill> : '—'}</td>
                        <td>
                          {rent ? <span className="strong">{rent}<span style={{ fontWeight: 400, color: 'var(--ms-ink-3)' }}> / yr</span></span> : '—'}
                          <span className="sub">{unit ? `${unit}${building ? ` · ${building}` : ''}` : 'No unit assigned'}</span>
                        </td>
                        <td className="nowrap" style={passed ? { color: 'var(--ms-amber-text)', fontWeight: 600 } : undefined}>
                          {viewing ? fmtDateTime(viewing.scheduledAt) : '—'}
                        </td>
                        <td className="nowrap" title={`Last updated ${fmtDateTime(lead.updatedAt)}`}>{waitingFor(lead.updatedAt, now)}</td>
                        <td className="nowrap">{sla ? <SlaPill sla={sla} /> : <span style={{ color: 'var(--ms-ink-3)' }}>—</span>}</td>
                        <td>
                          <StagePill stage={lead.stage} sub={leadSub(lead)} />
                          {decline && <span className="sub" style={{ color: 'var(--ms-danger)' }} title={decline}>{decline}</span>}
                        </td>
                        <td><NextAction lead={lead} /></td>
                        <td className="act" onClick={(e) => e.stopPropagation()}>
                          <Btn size="sm" href={leadHref(lead.id)}>Open</Btn>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
          </table>
        </TableWrap>
      )}

      {view !== 'queue' && (
        <>
          <div className="gx-tbl-wrap" style={{ marginBottom: 12 }}><div className="gx-tbar">{toolbar}</div></div>
          {loading ? (
            <Card><table className="gx-tbl"><SkeletonRows rows={4} cols={4} /></table></Card>
          ) : error ? (
            <Callout tone="bad" title="Couldn't load leads.">
              {error} <Btn size="xs" onClick={reload}>Try again</Btn>
            </Callout>
          ) : leads.length === 0 ? (
            <Card><table className="gx-tbl"><EmptyRow cols={1} title="No leads yet"
              text={canCreateLeads ? 'Leads appear when customers book viewings — or use Add lead for a walk-in or phone enquiry.' : 'Leads appear when customers book viewings on your units.'} /></table></Card>
          ) : view === 'calendar' ? (
            <LeadsCalendarView leads={filtered} onOpenLead={openLead} />
          ) : filtered.length === 0 ? (
            <Card><table className="gx-tbl"><EmptyRow cols={1} title="No leads match these filters" text="Try another stage, source or search." /></table></Card>
          ) : (
            <PipelineBoard leads={filtered} activeTab={activeTab} now={now} onOpen={openLead} subs={subsInView} />
          )}
        </>
      )}

      {addingLead && canCreateLeads && (
        <NewLeadModal
          manager={scope}
          preferredStartDays={preferredStartDays}
          allowedInstallments={allowedInstallments}
          // Navigate on CLOSE, not on create: the overlay closes through history.back()
          // (useBackClose), which would undo a router.push fired in the same tick.
          onClose={() => {
            setAddingLead(false);
            const id = createdLeadRef.current;
            createdLeadRef.current = null;
            if (id) openLead(id);
          }}
          onCreated={(leadId) => { createdLeadRef.current = leadId; setTick((t) => t + 1); }}
        />
      )}
    </OsPage>
  );
}

/* ─── Pipeline (board) view — replaces the old Grid cards ─────────────────── */

function PipelineBoard({ leads, activeTab, now, onOpen, subs }: {
  leads: ApiLead[]; activeTab: 'all' | LeadStage; now: number; onOpen: (id: number) => void; subs: Set<SpaceSubcategory>;
}) {
  // "All" hides Rejected (as the filter does); a picked stage shows just its column.
  const cols: [string, string][] = (activeTab === 'all'
    ? FUNNEL_COLS.filter(([s]) => s !== 'rejected')
    : [[activeTab, FUNNEL_COLS.find(([s]) => s === activeTab)?.[1] ?? STAGE_LABELS[activeTab]] as [LeadStage, string]]
  ).map(([s, l]) => [s, colTitle(s, l, subs)]);
  // Legacy stages (approved, offer_made, …) stay visible under "All".
  const other = leads.filter((l) => !FUNNEL_SET.has(l.stage));
  if (activeTab === 'all' && other.length) cols.push(['__other', 'Other stages']);

  return (
    <Board>
      {cols.map(([key, title]) => {
        const items = key === '__other' ? other : leads.filter((l) => inCol(key as LeadStage, l.stage));
        return (
          <BoardCol key={key} title={title} count={items.length}>
            {items.map((lead) => {
              const { unit, building } = unitText(lead);
              const viewing = getPendingViewing(lead);
              const u = getUrgency(lead);
              const sla = firstResponseSla(lead, now);
              const rent = rentText(lead);
              return (
                <BoardCard
                  key={`${lead.id}-${lead.updatedAt}`}
                  onClick={() => onOpen(lead.id)}
                  t={leadDisplayName(lead)}
                  m={
                    <>
                      {unit ? `${unit}${building ? ` · ${building}` : ''}` : 'No unit assigned'}
                      {viewing && (
                        <span style={{ display: 'block', color: new Date(viewing.scheduledAt).getTime() <= now ? 'var(--ms-amber-text)' : undefined }}>
                          {leadSub(lead) === 'residential' ? 'Viewing' : 'Site visit'} {fmtDateTime(viewing.scheduledAt)}
                        </span>
                      )}
                      {key === 'new' && lead.stage === 'contacted' && <span style={{ display: 'block', color: 'var(--ms-ink-3)' }}>Contacted</span>}
                      {declineNote(lead) && <span style={{ display: 'block', color: 'var(--ms-danger)' }}>{declineNote(lead)}</span>}
                    </>
                  }
                  amt={rent ?? undefined}
                  tag={sla ? <SlaPill sla={sla} /> : u
                    ? <Pill tone={u.level === 'red' ? 'danger' : 'amber'} title={u.label}>{u.label}</Pill>
                    : key === '__other' ? <StagePill stage={lead.stage} sub={leadSub(lead)} /> : <span>{sourceLabel(lead.source)}</span>}
                />
              );
            })}
          </BoardCol>
        );
      })}
    </Board>
  );
}

// RP portal route — the workspace with the default (RP-scoped) API.
export default function LeadsPage() {
  return <LeadsWorkspace />;
}
