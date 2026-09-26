/**
 * OperationsPipelines — the Operations page as separate pipeline trackers, one
 * per tab: Lead · New Lease · Renewal · Terminated · Maintenance · Breach · Legal.
 *
 * Each tab renders that pipeline's own stages as fixed kanban lanes; a card sits
 * in its current stage (first incomplete step) with earlier steps ticked. This
 * is a PURE TRACKER — no inline actions, no drag. Every card's "Open" link jumps
 * to the record's detail page, where the actual work happens:
 *   - Lead cards        → the Leads page (anchored to that lead row)
 *   - Contract cards    → the contract detail page (setup / wind-down workflow)
 *
 * Data comes from two endpoints, partitioned by tab so a record shows in exactly
 * one tab at a time as it progresses:
 *   - GET leadsPath      → leads at INTERESTED-onward (pre-contract) → Lead tab
 *   - GET contractsPath  → operations contracts → New Lease / Renewal / Terminated
 * Once a lead converts to a contract its lead row leaves the funnel stages, so it
 * naturally moves out of the Lead tab and into New Lease / Renewal. A fully set-up
 * active lease drops off entirely (it lives in the Leases register); an accepted
 * termination surfaces under Terminated for move-out + settlement.
 *
 * Maintenance, Breach and Legal are workflow pipelines: Maintenance tracks
 * who holds the ball on a routed request (Requested → Awaiting approval → In
 * progress → Sign-off → Close-out); Breach and Legal are the two pipelines of
 * the Legal & Breach Management module (owner's build spec, 14 Sep 2026 —
 * `02 Engineering Specs & Plans/LEGAL_BREACH_MODULE_SPEC_2026-09-14.md`):
 * Breach = behaviour / agreement breaches handled with warnings (stage enum
 * reported → warning_sent → final_warning → resolved | escalated); Legal =
 * the Dispute pipeline (notice_sent → case_filed → settlement → decision →
 * enforcement → closed). A breach hands over to legal ONLY through the
 * explicit "Escalate to legal" action, and the two are never shown as one
 * status list. Lane keys ARE the spec's stage enums so the records wire in
 * one-to-one. Their lanes render today; records land with the module.
 * ?tab=breach_legal (the former combined board) deep-links to Breach.
 *
 * RULE (owner, 14 Sep): a lease escalated to legal appears ONLY on the Legal
 * tab — never on Breach, New Lease, Renewal, Terminated or Maintenance — to
 * avoid confusion. See LEGAL_TAB_ONLY below.
 */
'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, X, RefreshCw, ClipboardList, CheckCircle2, ArrowRight, UserPlus, FileText, RefreshCcw, LogOut, LayoutList, Columns3, LayoutGrid, BarChart3, Info, Wrench, Scale, ShieldAlert, Gavel, ClipboardCheck, Mail, MessageCircle } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { whatsappEnabled } from '@/lib/whatsappApi';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { tenantDisplayName } from '@/lib/tenantName';
import { maintenancePlace } from '@/lib/maintenanceScope';
import { legalApi, BREACH_STAGES as BREACH_STAGE_ORDER, DISPUTE_STAGES as DISPUTE_STAGE_ORDER, type BreachRow, type DisputeRow } from '@/lib/legal';
import { StartNoticeModal } from '@/components/legal/StartNoticeModal';
import type { OpsContract, StageHandler } from '@/components/upnow/OperationsBoard';

/* ── Lead shape (subset of GET /leads) ─────────────────────────────────────── */
interface OpsLead {
  id: number;
  stage: string;
  customerName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  createdAt: string;
  updatedAt: string;
  convertedTenant?: {
    id?: number | null; user?: { name?: string | null; email?: string | null } | null;
    /** A company lease is held by the ENTITY — the person named on the user
     *  record is only its signatory. Carried so the card can say which. */
    entityType?: string | null; companyName?: string | null;
  } | null;
  unit?: {
    id?: number | null; unitNumber?: string | null; unitName?: string | null; rentalPrice?: number | null;
    property?: { id?: number | null; buildingName?: string | null; rentalProviderId?: number | null } | null;
  } | null;
  paymentPlan?: { rentFils?: number | null } | null;
  /** Manager handling the lead (assigned, else responsible manager, else RP). */
  handler?: StageHandler | null;
}

interface Props {
  /** Operations contracts endpoint (without /api), e.g. '/contracts/operations'. */
  contractsPath: string;
  /** Leads endpoint (without /api), e.g. '/leads'. */
  leadsPath: string;
  /** Deep-link to a contract's detail page. */
  contractHref: (id: number) => string;
  /** Deep-link to a lead's detail (Leads page anchor). Omitted → no lead link. */
  leadHref?: (id: number) => string;
  /** Maintenance requests endpoint (without /api), e.g. '/maintenance/requests'.
   *  Omitted → the Maintenance tab shows its lanes with no records. */
  maintenancePath?: string;
  /** Deep-link to a maintenance request's detail page. */
  maintenanceHref?: (id: number) => string;
  /** Open AMC visits endpoint (without /api), e.g. '/amc/visits/open' or
   *  '/manager/amc/visits/open?rp=N'. Omitted → the AMC tab shows its lanes with no records. */
  amcPath?: string;
  /** Deep-link to an AMC contract's detail page (the visit's contract). */
  amcHref?: (contractId: number) => string;
  /** Manager scope: keep only leads whose unit belongs to this RP. */
  rpFilter?: number;
  /** Link to the manager-performance report (landlord-only) — omitted → no button. */
  performanceHref?: string;
  /** Extra content rendered inside the page shell, right after the "Pipeline
   *  tracker" heading and above the pipeline cards (e.g. the embedded Leasing
   *  Funnel activity table on the operations page). */
  afterHeading?: ReactNode;
  /** Legal module API base — '/legal' (landlord) or '/manager/legal' (manager, with legalRp).
   *  Omitted → the Breach and Legal tabs show their lanes with no records. */
  legalBase?: string;
  legalRp?: number;
  /** Deep-link to a legal case's detail page. */
  disputeHref?: (id: number) => string;
}

/* ── Tabs ──────────────────────────────────────────────────────────────────── */
type TabKey = 'lead' | 'new' | 'renewal' | 'terminated' | 'maintenance' | 'amc' | 'breach' | 'legal';
/** Breach and Legal were hidden on PRODUCTION builds from 10 Sep 2026, while they had no records behind them.
 *  The Legal & Breach module went live on 15 Sep, and the owner switched the tabs on everywhere on 21 Sep 2026
 *  ("let's enable the tabs that we hide for production"). */
/** The former combined board's deep link (?tab=breach_legal) lands on Breach. */
const LEGACY_TAB: Record<string, TabKey> = { breach_legal: 'breach' };
const TABS: { key: TabKey; label: string; icon: typeof UserPlus }[] = [
  { key: 'lead',        label: 'Lead',        icon: UserPlus },
  { key: 'new',         label: 'New Lease',   icon: FileText },
  { key: 'renewal',     label: 'Renewal',     icon: RefreshCcw },
  { key: 'terminated',  label: 'Terminated',  icon: LogOut },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'amc',         label: 'AMC',         icon: ClipboardCheck },
  { key: 'breach',      label: 'Breach',      icon: ShieldAlert },
  { key: 'legal',       label: 'Legal',       icon: Scale },
];

/* ── Stage definitions per pipeline (fixed lanes, in order) ────────────────────
 * `keys` = the operations checklist keys that belong to that lane; a contract
 * card lands in the FIRST lane that still has an incomplete item. A lane with no
 * keys is a terminal "everything done" lane. */
interface StageDef { key: string; title: string; keys: string[]; desc?: string }

// Lead lanes match RAW lead stages (interested-onward, pre-contract).
// Every mid-funnel stage must land in a lane: a stage with no lane is dropped
// from the board silently (leadStageKey → null). `approved` = documents
// approved, plan not yet shared → still the documents step; `cheques_collected`
// = cheques in hand, contract not yet issued → still the confirmation step.
const LEAD_STAGES: { key: string; title: string; match: string[] }[] = [
  { key: 'interested', title: 'Interested',      match: ['interested'] },
  { key: 'documents',  title: 'KYC / Documents', match: ['documents_collection', 'approved'] },
  { key: 'plan',       title: 'Payment plan',    match: ['payment_plan_shared'] },
  { key: 'cheques',    title: 'Payment Confirmation Ready',     match: ['cheques_submitted', 'cheques_collected'] },
];
const LEAD_MATCH = new Set(LEAD_STAGES.flatMap(s => s.match));

// New Lease — the setup gates. (KYC + Payment plan are handled in the Lead flow,
// so they're not tracked again as New Lease lanes.) No terminal "Ready to
// activate" lane: once every gate is done the lease awaits activation on the
// contract page, so it drops off this board (see allGatesDone below).
// No Cheques / PDC lane: cheques are collected in the LEAD flow, whose last lane
// is Payment Confirmation Ready — tracking them again here just duplicated the
// same work on a second board (the reason KYC + Payment plan aren't lanes here
// either). Renewals keep their Cheques / PDC lane: a renewal has no lead, so that
// board is the only place its cheques are worked.
// Lane ORDER is the process order, and it must match the checklist order the
// API builds (`buildOperationsList`): Signatures → Contract Registration →
// Utility → Move-in. Registration sits directly after the signatures because the
// certificate is what the utility account is opened against — the two lanes
// after it genuinely cannot start until it is done.
//
// Between 2026-08-01 and 2026-08-08 this list ran Registration LAST, on the
// reasoning that registration is what makes a tenancy legally live. That held
// only because registration auto-activated the lease; activation now waits for
// the move-in counter-signature, so the lane order follows the real dependency
// again. Restored at the product owner's direction on 2026-08-08.
const NEW_STAGES: StageDef[] = [
  { key: 'signatures',   title: 'Signatures',        keys: ['sign_tenant', 'sign_landlord'] },
  { key: 'ejari',        title: 'Contract Registration',             keys: ['ejari'] },
  { key: 'utility',      title: 'Utility',           keys: ['utility'] },
  { key: 'move_in',      title: 'Move-in',           keys: ['move_in'] },
];

// Renewal — starts with the offer stages (Draft → Notice Sent, driven by the
// parent's renewalStatus) before the operational spine. No Utility / Move-in
// (same tenant, no re-handover).
const RENEWAL_STAGES: StageDef[] = [
  { key: 'draft',        title: 'Draft',             keys: ['renewal_draft'] },
  { key: 'notice_sent',  title: 'Notice Sent',       keys: ['renewal_notice'] },
  { key: 'kyc',          title: 'KYC',               keys: ['kyc'] },
  { key: 'payment_plan', title: 'Payment plan',      keys: ['payment_plan'] },
  { key: 'pdc',          title: 'Cheques / PDC',     keys: ['pdc'] },
  { key: 'signatures',   title: 'Signatures',        keys: ['sign_tenant', 'sign_landlord'] },
  { key: 'ejari',        title: 'Contract Registration',             keys: ['ejari'] },
  // No 'Ready to activate' lane: renewals have no manual activation step, and a
  // fully-complete renewal has already dropped off the worklist.
];

// Terminated — Requested (pending acceptance) then the wind-down work.
const TERM_STAGES: StageDef[] = [
  { key: 'requested',      title: 'Requested',           keys: ['termination_accept'] },
  { key: 'move_out',       title: 'Move-out inspection', keys: ['move_out'] },
  { key: 'bill_clearance', title: 'Bills cleared',       keys: ['bill_clearance'] },
  { key: 'settlement',     title: 'Deposit settlement',  keys: ['settlement'] },
];

/* ── Process pipelines: Maintenance · Breach · Legal ──────────────────────────
 * Lane-only stage models (no checklist keys — their records aren't the
 * operations-contract shape). Maintenance = owner-based lanes (see the note on
 * MAINT_STAGES; spec MAINTENANCE_ROUTING_SPEC_2026-08-30 §4); Breach = the
 * landlord's tenancy-breach handling; Legal = the business process sheet's legal
 * stages (Process Flow UpNow: Legal), folded to the five hand-offs an RP
 * actually tracks. Each board shows its workflow's shape today; records wire
 * in as each module lands. */
// Maintenance lanes track WHO IS HOLDING THE BALL (one owner + one action per
// lane), mirroring the SP portal's Requests → Quotes → Active Jobs → Closure
// board so both sides see the same shape. The process sheet's seven steps
// (received → diagnosed → quoted → approved → executed → verified → invoiced)
// are the request's timeline events, not columns — as columns, Quotation and
// Approval sit empty for every fixed-price job and Diagnosis vs Execution is
// the same SP job status. Awaiting approval is a parking lane a card can enter
// from In progress (diagnose → quote → approve → repair).
const MAINT_STAGES: StageDef[] = [
  { key: 'requested',   title: 'Requested',         keys: [], desc: 'Raised and routed — waiting on landlord triage (no rule / no provider) or the provider’s acceptance.' },
  { key: 'approval',    title: 'Awaiting approval', keys: [], desc: 'A quote is on the table — the landlord (covered, over threshold) or the customer (chargeable) must approve.' },
  { key: 'in_progress', title: 'In progress',       keys: [], desc: 'Provider accepted and working — diagnosing or repairing.' },
  { key: 'sign_off',    title: 'Sign-off',          keys: [], desc: 'Provider marked the job complete; customer sign-off outstanding.' },
  { key: 'close_out',   title: 'Close-out',         keys: [], desc: 'Signed off; invoice and cost allocation pending.' },
];
/* AMC pipeline (owner, 15 Sep 2026). One card per visit that is overdue or in
 * hand, plus the NEXT upcoming visit of each contract ("only the upcoming
 * one, otherwise it shows too many — overdue ones stay until cleared"); the
 * lane is the next thing the visit waits on. Attending
 * IS the inspection ("keep one"); the delivery note completes the visit; a
 * completed visit stays only while its quotation is pending. */
const AMC_STAGES: StageDef[] = [
  { key: 'scheduled', title: 'Scheduled',         keys: [], desc: 'Visit due — record who attended and inspected it (overdue visits first).' },
  { key: 'attended',  title: 'Attended',          keys: [], desc: 'Attended and inspected — file the vendor’s delivery note, which completes the visit.' },
  { key: 'quotation', title: 'Quotation pending', keys: [], desc: 'Visit complete; the vendor’s quotation for fixes found is still to be processed.' },
];
/* Breach pipeline (spec §4.2). Lane keys = Breach.stage. `escalated` is NOT a
 * lane: an escalated breach is frozen and its lease shows on the Legal board
 * only (owner, 14 Sep) — the breach record itself keeps stage `escalated` and
 * links to the dispute on the lease's Breaches tab. Hints quote the spec;
 * "N days" is JurisdictionConfig.breach_correction_days, never a constant. */
const BREACH_STAGES: StageDef[] = [
  { key: 'reported',      title: 'Reported',        keys: [], desc: 'Review and issue a warning.' },
  { key: 'warning_sent',  title: 'Warning issued',  keys: [], desc: 'Customer has N days to correct (correction deadline from the jurisdiction settings). Deadline passed — issue the final warning.' },
  { key: 'final_warning', title: 'Final warning',   keys: [], desc: 'If not corrected by the final deadline, escalate to legal. Escalating moves the lease to the Legal board.' },
  { key: 'resolved',      title: 'Resolved',        keys: [], desc: 'Closed — stays on the lease record.' },
];
/* Legal pipeline (spec §5.2). Lane keys = Dispute.stage. A dispute is filed by
 * the landlord OR the customer (wording flips, same lanes) and enters from an
 * escalated breach or directly (unpaid rent, overstaying, eviction, rent
 * increase, deposit, maintenance, early termination). Deadlines and fees come
 * from JurisdictionConfig — nothing jurisdiction-specific is named here. */
const LEGAL_STAGES: StageDef[] = [
  { key: 'notice_sent', title: 'Notice sent',        keys: [], desc: 'Customer has N days to respond / fix the issue. Deadline passed — you can file the case (proof of service required).' },
  { key: 'case_filed',  title: 'Case filed',         keys: [], desc: 'Registered with the rental authority — next hearing on the recorded date.' },
  { key: 'settlement',  title: 'Settlement talks',   keys: [], desc: 'Settlement payment due on the agreed date, or collect from the authority.' },
  { key: 'decision',    title: 'Decision received',  keys: [], desc: 'Other side has N days to appeal (appeal window from the jurisdiction settings).' },
  { key: 'enforcement', title: 'Enforcing decision', keys: [], desc: 'Next action: the latest enforcement event.' },
  { key: 'closed',      title: 'Closed',             keys: [], desc: 'Outcome — resolved by agreement, decided in your favour, decided against you, or withdrawn.' },
];
/** Dispute stages during which the lease is "in legal": it is shown on the
 *  Legal tab ONLY and dropped from every other board (owner, 14 Sep 2026).
 *  `notice_sent` counts too — the lease is already on the Legal board then,
 *  and showing it twice is the confusion the rule exists to avoid. */
export const LEGAL_TAB_ONLY = new Set(['notice_sent', 'case_filed', 'settlement', 'decision', 'enforcement']);

/* ── Unified card view-model ───────────────────────────────────────────────── */
/** Unread count by record id — the shape of `/email/unread-by-record` (and WhatsApp's, when that module is present). */
interface UnreadByRecord { customers: Record<number, number>; leads: Record<number, number> }
const NO_UNREAD: UnreadByRecord = { customers: {}, leads: {} };

interface CardVM {
  key: string;
  name: string;
  sub: string;                 // "Unit 12 · Building"
  ref: string | null;
  rentAed: number | null;
  term: string | null;
  done: number;
  total: number;
  href: string | null;
  stageKey: string;
  building: string | null;
  ageDays: number | null;
  /** Handler(s) for the card's CURRENT stage. Usually one person; the Signatures
   *  stage lists every party still awaiting signature (customer and/or landlord). */
  handler: StageHandler[];
  /** Per-stage handler breakdown (stages present on this contract) for the tooltip. */
  handlerBreakdown: { stage: string; name: string; inferred: boolean; done: boolean }[];
  /** Who the card is about — what unread emails and WhatsApp messages are counted by. */
  tenantId?: number | null;
  leadId?: number | null;
  /** Breach cards only: the one action the board offers inline — a deep link
   *  that opens the lease's Breaches section with the Escalate dialog up. */
  escalateHref?: string | null;
}

// Days since last activity (updatedAt, falling back to createdAt) — powers the
// "stuck" badge. nowMs is captured once per mount so it's stable across renders.
function daysSince(dateStr: string | null | undefined, nowMs: number): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}
function ageTone(d: number | null): 'fresh' | 'warn' | 'stale' | '' {
  if (d == null) return '';
  if (d >= 14) return 'stale';
  if (d >= 7) return 'warn';
  return 'fresh';
}

function fmtShort(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: '2-digit' });
}
function fmtAed(n: number) { return n.toLocaleString('en-AE'); }
function initials(name: string | null) {
  if (!name) return '—';
  return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
const unitLabel = (u?: { number?: string | null; unitNumber?: string | null; name?: string | null; unitName?: string | null } | null) => {
  const num = u?.unitNumber ?? u?.number ?? null;
  const nm = u?.unitName ?? u?.name ?? null;
  return num ? `Unit ${num}` : (nm ?? '—');
};

// True when every gate in `stages` is complete (a lane with no keys never blocks).
// A New Lease in this state has nothing left on the board — it awaits activation
// on the contract page — so it's filtered off the pipeline.
function allGatesDone(c: OpsContract, stages: StageDef[]): boolean {
  return stages.every(s => !s.keys.length || !c.checklist.some(i => s.keys.includes(i.key) && !i.done));
}

// The lane a contract card sits in = its first incomplete gate (only counting
// checklist items that actually exist on that contract).
function contractStageKey(c: OpsContract, stages: StageDef[]): string {
  for (const s of stages) {
    if (!s.keys.length) continue;
    if (c.checklist.some(i => s.keys.includes(i.key) && !i.done)) return s.key;
  }
  return stages[stages.length - 1].key;
}

// Stages co-signed by BOTH the manager and the customer — the manager conducts /
// signs the inspection or settlement, and the customer signs it too (unlike the
// contract Signatures lane, where the manager is never a signer).
const CO_SIGNED_KEYS = new Set(['move_in', 'move_out', 'settlement']);

// The handler(s) for a lane. For the Signatures lane we surface the parties we're
// still WAITING ON: once a party signs, their name drops off; while both are
// unsigned, both names show. Move-in/out + settlement follow the same rule — the
// manager plus the customer while both signatures are outstanding, the manager
// alone once the customer has signed. Single-item lanes otherwise yield one person.
function laneHandlers(c: OpsContract, keys: string[]): StageHandler[] {
  const items = keys
    .map(k => c.checklist.find(i => i.key === k))
    .filter((i): i is NonNullable<typeof i> => !!i && !!i.handler);
  if (!items.length) return [];
  const pending = items.filter(i => !i.done);
  const pick = pending.length ? pending : items;
  const seen = new Set<string>();
  const out: StageHandler[] = [];
  for (const i of pick) {
    const h = i.handler!;
    if (!seen.has(h.name)) { seen.add(h.name); out.push(h); }
  }
  // Move-in/out + settlement are co-signed by the customer — add them alongside
  // the manager who conducted the stage, but only while their signature is still
  // OUTSTANDING (custSigned). A move-in the customer has already signed is waiting
  // solely on the manager's counter-signature, so only the manager shows. Completed
  // lanes keep both names — both parties did sign.
  const coItems = keys
    .filter(k => CO_SIGNED_KEYS.has(k))
    .map(k => c.checklist.find(i => i.key === k))
    .filter((i): i is NonNullable<typeof i> => !!i);
  if (coItems.some(i => i.done || i.custSigned !== true)) {
    const cust = tenantDisplayName(c.tenant);
    if (cust && !seen.has(cust)) { seen.add(cust); out.push({ name: cust, inferred: false }); }
  }
  return out;
}

function contractToCard(c: OpsContract, stages: StageDef[], href: string, nowMs: number): CardVM {
  const stageKey = contractStageKey(c, stages);
  const curKeys = stages.find(s => s.key === stageKey)?.keys ?? [];
  // Current-stage handler(s): the pending signers on the Signatures stage, else the
  // stage's exact actor / responsible manager; final fallback to the card handler.
  let handler = laneHandlers(c, curKeys);
  if (!handler.length && c.handler) handler = [c.handler];
  // Per-stage breakdown (only lanes that exist on this contract) for the tooltip.
  const handlerBreakdown = stages
    .filter(s => s.keys.length)
    .map(s => {
      const hs = laneHandlers(c, s.keys);
      if (!hs.length) return null;
      const done = s.keys.every(k => { const it = c.checklist.find(i => i.key === k); return !it || it.done; });
      return { stage: s.title, name: hs.map(h => h.name).join(', '), inferred: hs.some(h => h.inferred), done };
    })
    .filter((x): x is { stage: string; name: string; inferred: boolean; done: boolean } => x != null);
  return {
    key: `c-${c.id}`,
    tenantId: c.tenant.id,
    name: tenantDisplayName(c.tenant) ?? '—',
    sub: `${unitLabel(c.unit)} · ${c.property.buildingName ?? '—'}`,
    ref: c.ref,
    rentAed: c.annualRent || null,
    term: `${fmtShort(c.startDate)} – ${fmtShort(c.endDate)}`,
    done: c.doneCount,
    total: c.totalCount,
    href,
    stageKey,
    building: c.property.buildingName ?? null,
    ageDays: daysSince(c.updatedAt ?? c.createdAt, nowMs),
    handler,
    handlerBreakdown,
  };
}

function leadStageKey(l: OpsLead): string | null {
  for (const s of LEAD_STAGES) if (s.match.includes(l.stage)) return s.key;
  return null;
}
function leadToCard(l: OpsLead, href: string | null, nowMs: number): CardVM | null {
  const stageKey = leadStageKey(l);
  if (!stageKey) return null;
  const idx = LEAD_STAGES.findIndex(s => s.key === stageKey);
  const rentFils = l.paymentPlan?.rentFils ?? (l.unit?.rentalPrice != null ? Number(l.unit.rentalPrice) * 100 : null);
  return {
    key: `l-${l.id}`,
    leadId: l.id,
    tenantId: l.convertedTenant?.id ?? null,
    /* The party, not the signatory. Converting a lead attaches the customer
     * record, and reading the person's name off it put the man who signs for
     * API Energy on the board where the company belongs — the same rule the
     * contract cards on this very board already follow. `customerName` is
     * written with the company name at conversion, so it agrees. */
    name: tenantDisplayName({
      name: l.convertedTenant?.user?.name ?? l.customerName,
      entityType: l.convertedTenant?.entityType,
      companyName: l.convertedTenant?.companyName,
    }) ?? l.customerName ?? '—',
    sub: `${unitLabel(l.unit)} · ${l.unit?.property?.buildingName ?? '—'}`,
    ref: null,
    rentAed: rentFils != null ? Math.round(rentFils / 100) : null,
    term: null,
    done: idx + 1,
    total: LEAD_STAGES.length,
    href,
    stageKey,
    building: l.unit?.property?.buildingName ?? null,
    ageDays: daysSince(l.updatedAt ?? l.createdAt, nowMs),
    handler: l.handler ? [l.handler] : [],
    handlerBreakdown: [],
  };
}

/* ── Maintenance request shape (subset of GET /maintenance/requests) ────────── */
interface MaintReq {
  id: number;
  ref: string;
  title: string;
  stage: string;
  stageNote: string | null;
  coverage: string | null;
  category?: { id: number; name: string } | null;
  /** 0267 — where the work is: a unit, or a named common area / building system. */
  scope?: string | null; locationLabel?: string | null;
  unit?: { id: number; unitNumber: string | null; unitName: string | null } | null;
  property?: { id: number; buildingName: string | null } | null;
  customer?: { id: number; name: string | null; companyName: string | null; entityType: string | null } | null;
  provider?: { id: number; name: string; relationship: string | null } | null;
  quote?: { status: string; totalAed: number | null } | null;
  booking?: { id: number; status: string; totalAed: number | null } | null;
  createdAt: string;
  updatedAt: string;
}

// Backend stage → board lane key (terminal stages never arrive: the list is open-scoped).
const MAINT_STAGE_KEY: Record<string, string> = {
  requested: 'requested', awaiting_approval: 'approval', in_progress: 'in_progress',
  sign_off: 'sign_off', close_out: 'close_out',
};

function maintToCard(m: MaintReq, href: string | null, nowMs: number): CardVM {
  const stageKey = MAINT_STAGE_KEY[m.stage] ?? 'requested';
  const idx = Math.max(0, MAINT_STAGES.findIndex(s => s.key === stageKey));
  return {
    key: `m-${m.id}`,
    // The party, not the signatory — same company rule as every other card here.
    name: tenantDisplayName({
      name: m.customer?.name ?? null,
      entityType: m.customer?.entityType, companyName: m.customer?.companyName,
    }) ?? (m.property?.buildingName ?? '—'),
    sub: `${maintenancePlace(m)} · ${m.property?.buildingName ?? '—'} · ${m.category?.name ?? 'Maintenance'}`,
    ref: m.ref,
    // The money on the job (quote, else priced booking) — not rent.
    rentAed: m.quote?.totalAed ?? m.booking?.totalAed ?? null,
    // The stage note rides the small term slot: "No coverage rule — triage",
    // "Diagnosing", "Provider declined — reassign"…
    term: m.stageNote,
    done: idx + 1,
    total: MAINT_STAGES.length,
    href,
    stageKey,
    building: m.property?.buildingName ?? null,
    ageDays: daysSince(m.updatedAt ?? m.createdAt, nowMs),
    handler: m.provider ? [{ name: m.provider.name, inferred: false }] : [],
    handlerBreakdown: [],
  };
}

/* ── AMC visit shape (GET /amc/visits/open) ─────────────────────────────────── */
interface AmcVisit {
  id: number; contractId: number; title: string; dueDate: string | null; status: string; overdue: boolean;
  stage: 'scheduled' | 'attended' | 'quotation';
  attendedAt: string | null; attendedByName: string | null; supervisedBy: string | null;
  inspectedAt: string | null; inspectedByName: string | null; hasDeliveryNote: boolean;
  quotationStatus: string | null; quotationAmountAed: number | null;
  vendorName: string | null; propertyId: number | null; propertyName: string | null; kindLabel: string | null;
  contractEndDate: string | null; moreOpen?: number; updatedAt: string | null; createdAt: string | null;
}
const fmtDay = (d: string | null) => d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' }) : null;
/* AMC card: one open visit. The stakeholders are whoever holds it now — the
 * person who attended / inspected (the manager, or the supervisor they named),
 * and the vendor who does the work. */
function amcToCard(v: AmcVisit, href: string | null, nowMs: number): CardVM {
  const idx = Math.max(0, AMC_STAGES.findIndex(s => s.key === v.stage));
  const holder = v.inspectedByName ?? v.attendedByName ?? null;
  const supervisor = v.supervisedBy && v.supervisedBy !== 'self' ? v.supervisedBy : null;
  const term = v.stage === 'quotation'
    ? `Quotation pending${v.quotationAmountAed != null ? ` · AED ${v.quotationAmountAed.toLocaleString('en-AE')}` : ''}`
    : v.stage === 'scheduled'
      ? (v.overdue ? `Overdue — due ${fmtDay(v.dueDate)}` : v.dueDate ? `Due ${fmtDay(v.dueDate)}` : 'No date set')
      : 'Awaiting delivery note';
  // The queue behind this visit on the same contract, so one card still says how much is owed.
  const queued = v.moreOpen ? ` · +${v.moreOpen} more scheduled` : '';
  return {
    key: `a-${v.id}`,
    // The contract is the card (what the visit is for); the vendor is a stakeholder chip.
    name: v.kindLabel ?? v.title,
    sub: `${v.propertyName ?? '—'} · ${v.vendorName ?? '—'} · ${v.title}`,
    ref: `VISIT-${v.id}`,
    rentAed: v.stage === 'quotation' ? v.quotationAmountAed : null,
    term: term + queued,
    done: idx + 1,
    total: AMC_STAGES.length,
    href,
    stageKey: v.stage,
    building: v.propertyName ?? null,
    ageDays: daysSince(v.updatedAt ?? v.createdAt ?? null, nowMs),
    handler: [
      ...(holder ? [{ name: holder, inferred: false }] : []),
      ...(supervisor ? [{ name: `${supervisor} (supervised)`, inferred: true }] : []),
      ...(v.vendorName ? [{ name: `${v.vendorName} (vendor)`, inferred: true }] : []),
    ],
    handlerBreakdown: [],
  };
}

/* Breach card: one open breach on a lease (spec §4). The lane is the breach's
 * own stage; the API's `hint` rides the term slot ("Customer has 9 days to
 * correct"). Opens the lease page at its Breaches section. */
function breachToCard(b: BreachRow, href: string | null, nowMs: number, escalateHref: string | null): CardVM {
  const idx = Math.max(0, BREACH_STAGE_ORDER.indexOf(b.stage));
  return {
    escalateHref: b.actions.escalate ? escalateHref : null,
    key: `b-${b.id}`,
    name: b.lease?.customerName ?? '—',
    sub: `Unit ${b.lease?.unitNumber ?? '—'} · ${b.lease?.buildingName ?? '—'} · ${b.categoryLabel}`,
    ref: `BR-${b.id}`,
    rentAed: null,
    term: b.alert?.text ?? b.hint,
    done: idx + 1,
    total: 4,
    href,
    stageKey: b.stage,
    building: b.lease?.buildingName ?? null,
    ageDays: daysSince(b.updatedAt ?? b.createdAt, nowMs),
    // The stakeholder holding the breach: whoever acted on it last.
    handler: b.handler ? [{ name: b.handler, inferred: false }] : [],
    handlerBreakdown: [],
  };
}
/* Legal card: one open case on a lease (spec §5). The claim rides the money
 * slot; the API's `hint` ("Next hearing on …") rides the term slot. */
function disputeToCard(d: DisputeRow, href: string | null, nowMs: number): CardVM {
  const idx = Math.max(0, DISPUTE_STAGE_ORDER.indexOf(d.stage));
  return {
    key: `d-${d.id}`,
    name: d.lease?.customerName ?? '—',
    sub: `Unit ${d.lease?.unitNumber ?? '—'} · ${d.lease?.buildingName ?? '—'} · ${d.typeLabel} · ${d.filedByLabel}`,
    ref: `CASE-${d.id}`,
    rentAed: d.claimAmount,
    term: d.alert?.text ?? d.hint,
    done: idx + 1,
    total: 6,
    href,
    stageKey: d.stage,
    building: d.lease?.buildingName ?? null,
    ageDays: daysSince(d.updatedAt ?? d.createdAt, nowMs),
    // The stakeholders on the case: whoever acted last, and the representative (lawyer) when one is named.
    handler: [
      ...(d.handler ? [{ name: d.handler, inferred: false }] : []),
      ...(d.representative ? [{ name: `${d.representative} (representative)`, inferred: true }] : []),
    ],
    handlerBreakdown: [],
  };
}

export default function OperationsPipelines({ contractsPath, leadsPath, contractHref, leadHref, maintenancePath, maintenanceHref, amcPath, amcHref, rpFilter, performanceHref, afterHeading, legalBase, legalRp, disputeHref }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [nowMs] = useState(() => Date.now());
  const [contracts, setContracts] = useState<OpsContract[]>([]);
  const [leads, setLeads] = useState<OpsLead[]>([]);
  const [maint, setMaint] = useState<MaintReq[]>([]);
  const [visits, setVisits] = useState<AmcVisit[]>([]);
  const [breaches, setBreaches] = useState<BreachRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  // "Move lease to legal" on the Legal board — the Start-notice dialog, which
  // can also record a case that is already in progress at its real stage.
  const [showStartNotice, setShowStartNotice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>(() => {
    const t = sp.get('tab'); if (t && LEGACY_TAB[t]) return LEGACY_TAB[t]; return TABS.some(x => x.key === t) ? (t as TabKey) : 'lead';
  });
  // Guards the one-shot "land on a pipeline that actually has records" hop below;
  // a manual tab click sets it so an empty pipeline the RP chose is never overridden.
  const didAutoTab = useRef(false);
  // Seeded from `?q=` so a link that has no contract id yet (a just-converted
  // lead) can still land with that customer filtered in.
  const [search, setSearch] = useState(() => sp.get('q') ?? '');
  const [filterAsset, setFilterAsset] = useState('all');
  // Scope is fixed to the current calendar year (no picker) — the board always
  // shows this year's deals.
  const filterYear = String(new Date().getFullYear());
  const [view, setView] = useState<'kanban' | 'list' | 'grid'>(() => {
    const v = sp.get('view'); return v === 'list' || v === 'grid' || v === 'kanban' ? v : 'kanban';
  });

  // Mirror tab + view into the URL (?tab=&view=) — shareable, back-button friendly,
  // and lets the sidebar deep-link straight to a pipeline.
  const syncUrl = (next: { tab?: TabKey; view?: string }) => {
    const params = new URLSearchParams(sp.toString());
    params.set('tab', next.tab ?? tab);
    params.set('view', next.view ?? view);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const selectTab = (k: TabKey) => { didAutoTab.current = true; setTab(k); syncUrl({ tab: k }); };
  const selectView = (v: 'kanban' | 'list' | 'grid') => { setView(v); syncUrl({ view: v }); };

  /**
   * Something waiting to be read — unread emails and WhatsApp messages, per
   * customer and per lead — shown as a small icon with a number on the card. It
   * loads on its own: a team member without the email (or WhatsApp) authority,
   * or a backend without that module, simply shows no icon.
   */
  const [unread, setUnread] = useState<Record<'email' | 'whatsapp', UnreadByRecord>>({ email: NO_UNREAD, whatsapp: NO_UNREAD });
  useEffect(() => {
    let alive = true;
    const q = rpFilter != null ? `?rp=${rpFilter}` : '';
    const get = (path: string) => apiGet<UnreadByRecord>(`${path}${q}`).then((d) => ({ customers: d?.customers ?? {}, leads: d?.leads ?? {} })).catch(() => NO_UNREAD);
    // WhatsApp is only asked where it is switched on — elsewhere it would just be refused.
    const pull = () => Promise.all([get('/email/unread-by-record'), whatsappEnabled().then((on) => (on ? get('/whatsapp/unread-by-record') : NO_UNREAD))]).then(([email, whatsapp]) => { if (alive) setUnread({ email, whatsapp }); });
    void pull();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void pull(); }, 120_000);
    return () => { alive = false; window.clearInterval(t); };
  }, [rpFilter]);
  const unreadFor = (c: CardVM, of: UnreadByRecord) => (c.tenantId != null ? of.customers[c.tenantId] ?? 0 : 0) + (c.leadId != null ? of.leads[c.leadId] ?? 0 : 0);
  const portalBase = rpFilter != null ? '/dashboard/manager' : '/rental-provider/dashboard';
  const inboxHref = (page: 'communications' | 'whatsapp', c: CardVM) => {
    const who = c.tenantId != null ? `customer=${c.tenantId}` : `lead=${c.leadId}`;
    return `${portalBase}/${page}?${rpFilter != null ? `rp=${rpFilter}&` : ''}${who}&unread=1`;
  };
  const waitingCount = (c: CardVM) => unreadFor(c, unread.email) + unreadFor(c, unread.whatsapp);
  /**
   * What is waiting across a set of cards — for a pipeline tile or a lane header,
   * so an unread message is seen from the top of the page, not found by scrolling.
   * One customer on two cards is still one customer's messages.
   */
  const waitingAcross = (cards: CardVM[]) => {
    const seen = new Set<string>();
    let email = 0, wa = 0;
    for (const c of cards) {
      const id = c.tenantId != null ? `c${c.tenantId}` : c.leadId != null ? `l${c.leadId}` : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      email += unreadFor(c, unread.email); wa += unreadFor(c, unread.whatsapp);
    }
    return { email, wa };
  };
  /** The same pair of numbers, not clickable — on a tile or a lane header. */
  const waitingSummary = (cards: CardVM[]) => {
    const { email, wa } = waitingAcross(cards);
    if (!email && !wa) return null;
    return (
      <span className="act-wrap" title={[email ? `${email} unread email${email === 1 ? '' : 's'}` : '', wa ? `${wa} unread WhatsApp message${wa === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}>
        {email > 0 && <span className="act mail"><Mail size={11} />{email}</span>}
        {wa > 0 && <span className="act wa"><MessageCircle size={11} />{wa}</span>}
      </span>
    );
  };
  /** On a card: "✉ 1 unread email" — each opens that person's unread conversations. Nothing unread: nothing drawn. */
  const waiting = (c: CardVM, words = false) => {
    const email = unreadFor(c, unread.email);
    const wa = unreadFor(c, unread.whatsapp);
    if (!email && !wa) return null;
    return (
      <span className="act-wrap">
        {email > 0 && <Link href={inboxHref('communications', c)} className="act mail" title="Open the unread emails" aria-label={`${email} unread emails`}><Mail size={12} />{email}{words ? ` unread email${email === 1 ? '' : 's'}` : ''}</Link>}
        {wa > 0 && <Link href={inboxHref('whatsapp', c)} className="act wa" title="Open the unread WhatsApp messages" aria-label={`${wa} unread WhatsApp messages`}><MessageCircle size={12} />{wa}{words ? ' on WhatsApp' : ''}</Link>}
      </span>
    );
  };

  const load = useMemo(() => () => Promise.all([
    apiGet<OpsContract[]>(contractsPath).then(d => Array.isArray(d) ? d : []).catch(() => []),
    apiGet<OpsLead[]>(leadsPath).then(d => Array.isArray(d) ? d : []).catch(() => []),
    maintenancePath
      ? apiGet<MaintReq[]>(maintenancePath).then(d => Array.isArray(d) ? d : []).catch(() => [])
      : Promise.resolve([] as MaintReq[]),
    amcPath
      ? apiGet<AmcVisit[]>(amcPath).then(d => Array.isArray(d) ? d : []).catch(() => [])
      : Promise.resolve([] as AmcVisit[]),
    // Open breaches + open cases (closed ones live on the lease record / the
    // Legal list). A missing permission or an old backend just yields empty boards.
    legalBase ? legalApi.breaches(legalBase, legalRp, { open: true }).then(r => r.items ?? []).catch(() => [] as BreachRow[]) : Promise.resolve([] as BreachRow[]),
    legalBase ? legalApi.disputes(legalBase, legalRp, { open: true }).then(r => r.items ?? []).catch(() => [] as DisputeRow[]) : Promise.resolve([] as DisputeRow[]),
  ]).then(([c, l, m, v, b, d]) => {
    setContracts(c);
    setLeads(rpFilter != null ? l.filter(x => x.unit?.property?.rentalProviderId === rpFilter) : l);
    setMaint(m);
    setVisits(v);
    setBreaches(b);
    setDisputes(d);
  }), [contractsPath, leadsPath, maintenancePath, amcPath, rpFilter, legalBase, legalRp]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); load().finally(() => setLoading(false)); }, [load]);

  // Property option list (drawn from both sources).
  const assets = useMemo(() => {
    const s = new Set<string>();
    for (const c of contracts) if (c.property.buildingName) s.add(c.property.buildingName);
    for (const l of leads) if (l.unit?.property?.buildingName) s.add(l.unit.property.buildingName);
    for (const m of maint) if (m.property?.buildingName) s.add(m.property.buildingName);
    for (const v of visits) if (v.propertyName) s.add(v.propertyName);
    for (const b of breaches) if (b.lease?.buildingName) s.add(b.lease.buildingName);
    for (const d of disputes) if (d.lease?.buildingName) s.add(d.lease.buildingName);
    return [...s].sort();
  }, [contracts, leads, maint, visits, breaches, disputes]);

  // Every word typed must appear somewhere ("unit 8 avenue", "amaraa 10") — not
  // the whole query as one run of text, which only ever matched a single field.
  const matchSearch = (hay: (string | null | undefined)[]) => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const text = hay.filter((x): x is string => Boolean(x)).join(' ').toLowerCase();
    return words.every(w => text.includes(w));
  };
  // Search reads what the card SHOWS — name, ref, "Unit 8 · Building", the
  // handler — plus the tab's extra fields, so the same name or unit finds a card on
  // every tab alike. The term dates are left out: a unit typed as "26" must not
  // match every lease running in 2026.
  const cardText = (c: CardVM) => [c.name, c.ref, c.sub, ...c.handler.map(h => h.name)];
  const contractInYear = (c: OpsContract) => {
    const jan1 = `${filterYear}-01-01`, dec31 = `${filterYear}-12-31`;
    const st = (c.startDate ?? '').slice(0, 10), en = (c.endDate ?? '').slice(0, 10);
    if (!st || st > dec31) return (c.createdAt ?? '').slice(0, 4) === filterYear;
    if (en && en < jan1) return false;
    return true;
  };

  // Build the cards for each tab (partitioned so a record shows in one tab only).
  const cardsByTab = useMemo(() => {
    // A lease with an open case (LEGAL_TAB_ONLY stage) shows on the Legal tab
    // only — dropped from New Lease / Renewal / Terminated and from Breach.
    // Leads are pre-contract so they cannot be in legal; maintenance requests
    // carry no lease id on this list, so they are not filtered.
    const legalLeaseIds = new Set<number>(disputes.filter(d => LEGAL_TAB_ONLY.has(d.stage)).map(d => d.leaseId));
    const passC = (c: OpsContract) =>
      !legalLeaseIds.has(c.id)
      && (filterAsset === 'all' || c.property.buildingName === filterAsset)
      && contractInYear(c);
    const contractExtra = (c: OpsContract) => [c.tenant.name, c.tenant.companyName, c.tenant.email, c.unit.number, c.unit.name];
    const passL = (l: OpsLead) =>
      (filterAsset === 'all' || l.unit?.property?.buildingName === filterAsset)
      && (l.createdAt ?? '').slice(0, 4) === filterYear;

    const leadCards = leads.filter(l => LEAD_MATCH.has(l.stage) && passL(l))
      .map(l => { const card = leadToCard(l, leadHref ? leadHref(l.id) : null, nowMs);
        return card && matchSearch([...cardText(card), l.customerName, l.convertedTenant?.companyName,
          l.convertedTenant?.user?.name, l.leadEmail, l.unit?.unitNumber, l.unit?.unitName]) ? card : null; })
      .filter((x): x is CardVM => x != null);

    // Setup = neither winding down nor termination-requested (those belong to Terminated).
    const setup = contracts.filter(c => !c.windDown && !c.terminationRequested && passC(c));
    const searchC = (rows: OpsContract[], stages: StageDef[]) => rows
      .map(c => ({ c, card: contractToCard(c, stages, contractHref(c.id), nowMs) }))
      .filter(({ c, card }) => matchSearch([...cardText(card), ...contractExtra(c)]))
      .map(({ card }) => card);
    const newCards = searchC(setup.filter(c => c.contractType !== 'renewal' && !allGatesDone(c, NEW_STAGES)), NEW_STAGES);
    const renewalCards = searchC(setup.filter(c => c.contractType === 'renewal'), RENEWAL_STAGES);
    const termCards = searchC(contracts.filter(c => (c.windDown || c.terminationRequested) && passC(c)), TERM_STAGES);

    // Maintenance: live requests from maintenancePath. The backend list is
    // open-scoped (terminal stages already dropped), and an open request is
    // relevant whatever year it was raised — so no year gate here.
    const passM = (m: MaintReq) =>
      (filterAsset === 'all' || m.property?.buildingName === filterAsset);
    const maintCards = maint.filter(passM)
      .map(m => ({ m, card: maintToCard(m, maintenanceHref ? maintenanceHref(m.id) : null, nowMs) }))
      .filter(({ m, card }) => matchSearch([...cardText(card), m.title, m.customer?.name, m.customer?.companyName,
        m.unit?.unitNumber, m.provider?.name]))
      .map(({ card }) => card);

    // AMC: open visits from amcPath — open work whenever the visit was due, so
    // no year gate. Search covers the vendor, property, kind and the people on it.
    const passV = (v: AmcVisit) =>
      (filterAsset === 'all' || v.propertyName === filterAsset);
    const amcCards = visits.filter(passV)
      .map(v => ({ v, card: amcToCard(v, amcHref ? amcHref(v.contractId) : null, nowMs) }))
      .filter(({ v, card }) => matchSearch([...cardText(card), v.attendedByName, v.inspectedByName, v.supervisedBy]))
      .map(({ card }) => card);

    // Breach: open breaches, minus any whose lease is in legal (Legal only).
    // Escalated breaches are not on the open list at all. Legal: open cases.
    // Neither is year-gated — an open case matters whenever it was opened.
    const passB = (b: BreachRow) =>
      !legalLeaseIds.has(b.leaseId)
      && (filterAsset === 'all' || b.lease?.buildingName === filterAsset);
    const breachCards = breaches.filter(passB)
      .map(b => breachToCard(b, `${contractHref(b.leaseId)}#sec-breaches`, nowMs,
        `${contractHref(b.leaseId)}${contractHref(b.leaseId).includes('?') ? '&' : '?'}escalate=${b.id}#sec-breaches`))
      .filter(card => matchSearch(cardText(card)));
    const passD = (d: DisputeRow) =>
      (filterAsset === 'all' || d.lease?.buildingName === filterAsset);
    const legalCards = disputes.filter(passD)
      .map(d => ({ d, card: disputeToCard(d, disputeHref ? disputeHref(d.id) : null, nowMs) }))
      .filter(({ d, card }) => matchSearch([...cardText(card), d.authorityCaseNumber]))
      .map(({ card }) => card);
    return {
      lead: leadCards, new: newCards, renewal: renewalCards, terminated: termCards,
      maintenance: maintCards, amc: amcCards, breach: breachCards, legal: legalCards,
    } as Record<TabKey, CardVM[]>;
  }, [contracts, leads, maint, visits, breaches, disputes, search, filterAsset, filterYear, contractHref, leadHref, maintenanceHref, amcHref, disputeHref, nowMs]);

  const stagesForTab: Record<TabKey, { key: string; title: string; desc?: string }[]> = {
    lead: LEAD_STAGES,
    new: NEW_STAGES,
    renewal: RENEWAL_STAGES,
    terminated: TERM_STAGES,
    maintenance: MAINT_STAGES,
    amc: AMC_STAGES,
    breach: BREACH_STAGES,
    legal: LEGAL_STAGES,
  };

  const focusKey = sp.get('focus');

  // Land on a pipeline that has something in it. The sidebar/bookmark can point at
  // ?tab=new while New Lease is empty this year — rather than open on a blank board,
  // hop once to the first pipeline (TABS order) that holds at least one record and
  // mirror it into the URL. Only fires when the landing tab is empty, only once, and
  // never after a manual tab click or a ?focus= deep link (which picks its own tab).
  useEffect(() => {
    if (loading || didAutoTab.current || focusKey) return;
    didAutoTab.current = true;
    // A deep link to Breach or Legal means "show me that pipeline" even when it
    // is empty — never hop away from it. Maintenance hops normally.
    if (tab === 'breach' || tab === 'legal') return;
    if (cardsByTab[tab].length > 0) return;
    const first = TABS.find(t => cardsByTab[t.key].length > 0);
    if (first) selectTab(first.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cardsByTab]);

  // Deep-link focus (?focus=c-<id> / l-<id>) — e.g. "Open lease" from a converted
  // lead. Once the data loads, jump to the tab that holds the card, then scroll to
  // it and flash a highlight ring. Done once so the RP can still switch tabs after.
  const didFocusTab = useRef(false);
  const focusElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focusKey || loading || didFocusTab.current) return;
    for (const t of TABS) {
      if (cardsByTab[t.key].some(c => c.key === focusKey)) {
        didFocusTab.current = true;
        setTab(t.key);
        break;
      }
    }
  }, [focusKey, loading, cardsByTab]);
  useEffect(() => {
    if (!focusKey || loading) return;
    const el = focusElRef.current;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusKey, loading, tab, view]);

  const activeCards = cardsByTab[tab];
  const stages = stagesForTab[tab];
  const byStage = useMemo(() => {
    const m = new Map<string, CardVM[]>();
    for (const c of activeCards) { const a = m.get(c.stageKey) ?? []; a.push(c); m.set(c.stageKey, a); }
    // Someone waiting for an answer comes first; then the furthest along.
    for (const a of m.values()) a.sort((x, y) => (Number(waitingCount(y) > 0) - Number(waitingCount(x) > 0)) || ((y.done / y.total) - (x.done / x.total)));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCards, unread]);

  // Flat, stage-ordered list for the List + Grid views (kanban uses byStage).
  const orderIndex = new Map(stages.map((s, i) => [s.key, i]));
  const sortedCards = useMemo(() =>
    [...activeCards].sort((a, b) =>
      ((orderIndex.get(a.stageKey) ?? 0) - (orderIndex.get(b.stageKey) ?? 0))
      || (Number(waitingCount(b) > 0) - Number(waitingCount(a) > 0)) || ((b.done / b.total) - (a.done / a.total))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeCards, tab, unread]);
  const stageTitleOf = (key: string) => stages.find(s => s.key === key)?.title ?? key;
  // Full details for the hover tooltip — so anything clipped in the compact
  // cards (name, unit, building, term) is still readable on hover.
  const cardTitle = (c: CardVM) => [
    c.name,
    c.ref ?? 'Lead',
    c.sub,
    c.rentAed != null ? `AED ${fmtAed(c.rentAed)}${c.key.startsWith('m-') ? '' : '/yr'}` : null,
    c.term,
    `Stage: ${stageTitleOf(c.stageKey)}`,
    ...(c.handlerBreakdown.length
      ? ['', 'Handlers:', ...c.handlerBreakdown.map(h =>
          `  ${h.done ? '✓' : '•'} ${h.stage}: ${h.name}${h.inferred ? ' (responsible)' : ''}`)]
      : []),
  ].filter(x => x != null).join('\n');

  // Shared vertical card (kanban lanes + grid). showStage adds a stage badge
  // (kanban implies stage by lane, so it hides it).
  const vcard = (c: CardVM, showStage: boolean) => (
    <article key={c.key} className={'card' + (c.key === focusKey ? ' focused' : '') + (waitingCount(c) > 0 ? ' waiting' : '')}
      ref={c.key === focusKey ? (focusElRef as React.RefObject<HTMLElement>) : undefined} title={cardTitle(c)}>
      {c.handler.length > 0 && (
        <div className="c-handler-top" title={`${stageTitleOf(c.stageKey)}: ${c.handler.map(h => h.name).join(', ')}`}>
          {c.handler.map((h, i) => (
            <span className="hperson" key={i}>
              <span className="hav">{initials(h.name)}</span>
              <span className="hname">{h.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="c-top">
        <span className="av">{initials(c.name)}</span>
        <div className="c-id">
          <div className="c-name">{c.name}</div>
          <div className="c-ref">{c.ref ?? 'Lead'}</div>
        </div>
        {showStage && <span className="c-stage">{stageTitleOf(c.stageKey)}</span>}
        {c.ageDays != null && (
          <span className={'age ' + ageTone(c.ageDays)} title={`${c.ageDays} day${c.ageDays === 1 ? '' : 's'} since last activity`}>{c.ageDays}d</span>
        )}
      </div>
      {waitingCount(c) > 0 && <div className="c-wait">{waiting(c, true)}</div>}
      <div className="c-unit">{c.sub}</div>
      <div className="c-foot">
        <span className="rent">{c.rentAed != null ? `AED ${fmtAed(c.rentAed)}` : '—'}</span>
        {c.term && <span className="term">{c.term}</span>}
      </div>
      {c.href
        ? <Link href={c.href} className="open">Open <ArrowRight size={12} /></Link>
        : <span className="open disabled">No detail</span>}
      {c.escalateHref && (
        <Link href={c.escalateHref} className="open escalate" title="Opens the lease's Breaches section with the Escalate dialog">
          <Gavel size={12} /> Escalate to legal
        </Link>
      )}
    </article>
  );

  // Horizontal row (list view). Collapses to a wrapped card on narrow screens.
  const rrow = (c: CardVM) => (
    <div key={c.key} className={'rrow' + (c.key === focusKey ? ' focused' : '')}
      ref={c.key === focusKey ? (focusElRef as React.RefObject<HTMLDivElement>) : undefined} title={cardTitle(c)}>
      <span className="av">{initials(c.name)}</span>
      <div className="r-id">
        <div className="c-name">{c.name}{waiting(c)}</div>
        <div className="c-ref">{c.ref ?? 'Lead'}</div>
      </div>
      <div className="r-sub">{c.sub}</div>
      {c.handler.length > 0
        ? <span className="r-handler" title={`${stageTitleOf(c.stageKey)}: ${c.handler.map(h => h.name).join(', ')}`}>
            <span className="hav">{initials(c.handler[0].name)}</span>{c.handler.map(h => h.name).join(', ')}
          </span>
        : <span className="r-handler empty">—</span>}
      <span className="c-stage">{stageTitleOf(c.stageKey)}</span>
      {c.ageDays != null && (
        <span className={'age ' + ageTone(c.ageDays)} title={`${c.ageDays} day${c.ageDays === 1 ? '' : 's'} since last activity`}>{c.ageDays}d</span>
      )}
      <span className="r-rent">{c.rentAed != null ? `AED ${fmtAed(c.rentAed)}` : '—'}</span>
      <span className="r-term">{c.term ?? '—'}</span>
      {c.href
        ? <Link href={c.href} className="open">Open <ArrowRight size={12} /></Link>
        : <span className="open disabled">—</span>}
    </div>
  );

  const hasFilters = filterAsset !== 'all' || search !== '';

  return (
    <>
    <div className="opsp-page">
      <main className="main">
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><ClipboardList size={12} /> Operations</div>
            <h1>
              Pipeline <span className="accent">tracker</span>
              <span className="info" tabIndex={0} role="note" aria-label="Every deal in progress, by pipeline. Pick a tab, see where each record sits, and open it to do the work on its detail page.">
                <Info size={15} />
                <span className="tip">Every deal in progress, by pipeline. Pick a tab, see where each record sits, and <b>open</b> it to do the work on its detail page.</span>
              </span>
            </h1>
          </div>
          <div className="hero-actions">
            {tab === 'legal' && legalBase && (
              <button type="button" className="btn btn-primary" onClick={() => setShowStartNotice(true)} title="Serve a notice, or record a case that is already in progress">
                <Gavel size={14} /> Move lease to legal
              </button>
            )}
            {performanceHref && (
              <Link href={performanceHref} className="btn btn-ghost" title="How the team is performing, stage by stage">
                <BarChart3 size={14} /> Manager performance
              </Link>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {afterHeading}

        {/* Pipeline selector cards — one per pipeline; click to switch. */}
        <div className="pcards">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                className={'pcard' + (tab === t.key ? ' active' : '')}
                onClick={() => selectTab(t.key)}
                aria-pressed={tab === t.key}
              >
                <span className="pc-ic"><Icon size={14} /></span>
                <span className="pc-label">{t.label}</span>
                {waitingSummary(cardsByTab[t.key])}
                <span className="pc-val">{cardsByTab[t.key].length}</span>
              </button>
            );
          })}
        </div>

        <div className="filters">
          <div className="search">
            <span className="ic"><Search size={15} /></span>
            <input placeholder="Search name, unit, building…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button type="button" className="clear" onClick={() => setSearch('')}><X size={14} /></button>}
          </div>
          <div className="sel-wrap">
            <select className="sel" value={filterAsset} onChange={e => setFilterAsset(e.target.value)}>
              <option value="all">All properties</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button type="button" className="reset" onClick={() => { setFilterAsset('all'); setSearch(''); }}>
              <X size={12} /> Reset
            </button>
          )}
          <div className="viewtoggle" role="group" aria-label="View">
            <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => selectView('list')} title="List" aria-label="List view"><LayoutList size={15} /></button>
            <button type="button" className={view === 'kanban' ? 'on' : ''} onClick={() => selectView('kanban')} title="Kanban" aria-label="Kanban view"><Columns3 size={15} /></button>
            <button type="button" className={view === 'grid' ? 'on' : ''} onClick={() => selectView('grid')} title="Grid" aria-label="Grid view"><LayoutGrid size={15} /></button>
          </div>
          <span className="results">{activeCards.length} in {TABS.find(t => t.key === tab)?.label}</span>
        </div>

        {loading ? (
          <div className="empty"><p>Loading pipelines…</p></div>
        ) : view === 'kanban' ? (
          // Kanban ALWAYS shows the full pipeline — every stage lane, even empty
          // ones — so the pipeline's shape is visible with zero records.
          <div className="board">
            {stages.map(s => {
              const cards = byStage.get(s.key) ?? [];
              return (
                <section key={s.key} className="lane">
                  <header className="lane-head" title={s.desc}>
                    <span className="lane-title">{s.title}</span>
                    {waitingSummary(cards)}
                    <span className="lane-count">{cards.length}</span>
                  </header>
                  <div className="lane-body">
                    {cards.map(c => vcard(c, false))}
                    {cards.length === 0 && <div className="lane-empty">No records</div>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : activeCards.length === 0 ? (
          <div className="empty">
            <div className="ic"><CheckCircle2 size={20} /></div>
            <h3>Nothing here</h3>
            <p>No records in the {TABS.find(t => t.key === tab)?.label} pipeline{hasFilters ? ' for these filters' : ''}. Switch to Kanban to see the stages.</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid">{sortedCards.map(c => vcard(c, true))}</div>
        ) : (
          <div className="list">{sortedCards.map(c => rrow(c))}</div>
        )}
      </main>
      <OpsPipelineStyle />
    </div>
    {/* Outside .opsp-page on purpose: the page's own `.grid` rule (its Grid view)
        would otherwise restyle every grid inside the dialog. */}
    {showStartNotice && legalBase && (
      <StartNoticeModal
        base={legalBase}
        rp={legalRp}
        onClose={() => setShowStartNotice(false)}
        onSaved={(id) => {
          setShowStartNotice(false);
          if (disputeHref) router.push(disputeHref(id));
          else { setLoading(true); load().finally(() => setLoading(false)); }
        }}
      />
    )}
    </>
  );
}

// Exported so SpOperationsPipelines (the service-provider twin of this page)
// can reuse the exact same .opsp-page design system without duplicating it.
export function OpsPipelineStyle() {
  return (
    <style jsx global>{`
      .opsp-page {
        --green:#2e9f82; --green-d:#1a7a5a; --green-t:#d8f2e8; --green-t2:#ebf8f2;
        --ink:#1a1916; --ink-2:#3d3b35; --ink-3:#6b6860; --mute:#9b9890;
        --line:#e8e6e0; --line-2:#f0eeea; --paper:#f4f3ef; --paper-2:#ebe9e3;
        --sky-bg:#e0f2fe; --sky-fg:#0369a1; --sh-sm:0 1px 2px rgba(26,25,22,.04);
        background:var(--paper); color:var(--ink); min-height:100vh; font-family:inherit; font-size:12.5px; line-height:1.45; font-weight:450;
      }
      .opsp-page *{ box-sizing:border-box; }
      .opsp-page button, .opsp-page input, .opsp-page select{ font-family:inherit; color:inherit; }
      .opsp-page .main{ padding:22px 24px 52px; max-width:1600px; margin:0 auto; width:100%; }
      @media (max-width:720px){ .opsp-page .main{ padding:18px 14px 52px; } }

      .opsp-page .hero{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:16px; flex-wrap:wrap; }
      .opsp-page .hero .left{ flex:1; min-width:260px; }
      .opsp-page .eyebrow{ font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--green-d); font-weight:700; margin-bottom:6px; display:flex; align-items:center; gap:7px; }
      .opsp-page .hero h1{ margin:0; font-size:23px; font-weight:700; letter-spacing:-.022em; line-height:1.1; }
      .opsp-page .hero h1 .accent{ color:var(--green-d); }
      .opsp-page .hero h1 .info{ position:relative; display:inline-flex; align-items:center; margin-left:7px; vertical-align:middle; color:var(--mute); cursor:help; outline:none; }
      .opsp-page .hero h1 .info:hover, .opsp-page .hero h1 .info:focus-visible{ color:var(--green-d); }
      .opsp-page .hero h1 .info .tip{ position:absolute; top:calc(100% + 8px); left:0; width:300px; background:var(--ink); color:#fff; padding:9px 11px; border-radius:9px; font-size:12px; font-weight:450; line-height:1.45; letter-spacing:normal; opacity:0; visibility:hidden; transform:translateY(-3px); transition:opacity .15s, transform .15s; z-index:30; box-shadow:0 6px 20px rgba(0,0,0,.16); pointer-events:none; }
      .opsp-page .hero h1 .info .tip b{ color:#fff; font-weight:700; }
      .opsp-page .hero h1 .info .tip::before{ content:''; position:absolute; bottom:100%; left:12px; border:6px solid transparent; border-bottom-color:var(--ink); }
      .opsp-page .hero h1 .info:hover .tip, .opsp-page .hero h1 .info:focus-visible .tip{ opacity:1; visibility:visible; transform:translateY(0); }
      .opsp-page .hero p{ margin:7px 0 0; font-size:12.5px; color:var(--ink-3); max-width:64ch; }
      .opsp-page .hero p b{ color:var(--ink-2); font-weight:700; }
      .opsp-page .hero-actions{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
      .opsp-page .btn{ display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border-radius:9px; font-weight:600; font-size:12px; border:1px solid transparent; cursor:pointer; white-space:nowrap; }
      .opsp-page .btn-primary{ background:var(--green-d); color:#fff; border-color:var(--green-d); }
      .opsp-page .btn-primary:hover{ background:var(--green); border-color:var(--green); }
      .opsp-page .btn-ghost{ background:#fff; color:var(--ink-2); border-color:var(--line); }
      .opsp-page .btn-ghost:hover{ border-color:var(--ink-3); color:var(--ink); }
      .opsp-page .reset{ background:transparent; border:0; color:var(--green-d); font-weight:600; font-size:12.5px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; padding:6px 8px; border-radius:7px; }
      .opsp-page .reset:hover{ background:var(--green-t2); }

      /* auto-fit: the selector row holds however many pipelines the page has
         (4 on the SP page, 7 here), wrapping to new rows on narrow screens. */
      .opsp-page .pcards{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:8px; margin:0 0 14px; }
      .opsp-page .pcard{ appearance:none; text-align:left; background:#fff; border:1px solid var(--line); border-radius:11px; padding:9px 12px; box-shadow:var(--sh-sm); cursor:pointer; display:flex; align-items:center; gap:10px; transition:border-color .15s, box-shadow .15s, background .15s; }
      .opsp-page .pcard:hover{ border-color:var(--ink-3); }
      .opsp-page .pcard.active{ border-color:var(--green); background:var(--green-t2); box-shadow:0 0 0 2px rgba(46,159,130,.1); }
      .opsp-page .pc-ic{ width:24px; height:24px; border-radius:7px; background:var(--paper-2); color:var(--ink-3); display:grid; place-items:center; flex:0 0 auto; }
      .opsp-page .pcard.active .pc-ic{ background:var(--green-t); color:var(--green-d); }
      .opsp-page .pc-label{ flex:1; min-width:0; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--mute); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsp-page .pcard.active .pc-label{ color:var(--green-d); }
      .opsp-page .pc-val{ font-size:22px; font-weight:700; letter-spacing:-.025em; line-height:1; font-variant-numeric:tabular-nums; color:var(--ink); flex:0 0 auto; }

      .opsp-page .filters{ display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-bottom:12px; }
      .opsp-page .search{ position:relative; flex:1; max-width:340px; min-width:170px; }
      .opsp-page .search input{ width:100%; padding:8px 12px 8px 32px; font-size:12px; border:1px solid var(--line); border-radius:9px; background:#fff; outline:none; }
      .opsp-page .search input:focus{ border-color:var(--green); box-shadow:0 0 0 3px rgba(46,159,130,.08); }
      .opsp-page .search .ic{ position:absolute; left:10px; top:50%; transform:translateY(-50%); color:var(--mute); }
      .opsp-page .search .clear{ position:absolute; right:6px; top:50%; transform:translateY(-50%); background:transparent; border:0; color:var(--mute); cursor:pointer; width:22px; height:22px; border-radius:6px; display:grid; place-items:center; }
      .opsp-page .sel{ appearance:none; padding:8px 30px 8px 12px; font-size:12px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink-2); cursor:pointer; font-weight:500; }
      .opsp-page .sel-wrap{ position:relative; }
      .opsp-page .sel-wrap::after{ content:''; position:absolute; right:14px; top:50%; width:6px; height:6px; border-right:1.5px solid var(--mute); border-bottom:1.5px solid var(--mute); transform:translateY(-65%) rotate(45deg); pointer-events:none; }
      .opsp-page .viewtoggle{ display:inline-flex; gap:2px; background:#fff; border:1px solid var(--line); border-radius:10px; padding:3px; margin-left:auto; }
      .opsp-page .viewtoggle button{ appearance:none; background:transparent; border:0; cursor:pointer; width:32px; height:30px; border-radius:7px; display:grid; place-items:center; color:var(--mute); }
      .opsp-page .viewtoggle button:hover{ color:var(--ink-2); }
      .opsp-page .viewtoggle button.on{ background:var(--green-t2); color:var(--green-d); }
      .opsp-page .results{ font-size:12.5px; color:var(--mute); font-weight:500; white-space:nowrap; }

      .opsp-page .empty{ background:#fff; border:1px solid var(--line); border-radius:16px; box-shadow:var(--sh-sm); padding:56px 24px; text-align:center; color:var(--mute); }
      .opsp-page .empty .ic{ width:48px; height:48px; border-radius:14px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; margin:0 auto 12px; }
      .opsp-page .empty h3{ margin:0 0 6px; font-size:18px; font-weight:700; color:var(--ink); }
      .opsp-page .empty p{ margin:0 auto; font-size:13.5px; color:var(--ink-3); max-width:46ch; }

      /* ── board ── lanes flex to share the width so the whole pipeline fits
         without horizontal scroll on desktop; narrow screens fall back to scroll. */
      .opsp-page .board{ display:flex; gap:8px; align-items:flex-start; padding-bottom:8px; }
      .opsp-page .board::-webkit-scrollbar{ height:9px; }
      .opsp-page .board::-webkit-scrollbar-thumb{ background:var(--paper-2); border-radius:99px; }
      .opsp-page .lane{ flex:1 1 0; min-width:0; background:#f7f8f6; border:1px solid var(--line-2); border-radius:11px; display:flex; flex-direction:column; }
      @media (max-width:1080px){
        .opsp-page .board{ overflow-x:auto; scroll-snap-type:x proximity; }
        .opsp-page .lane{ flex:0 0 190px; min-width:190px; scroll-snap-align:start; }
      }
      .opsp-page .lane-head{ display:flex; align-items:center; gap:6px; padding:9px 9px 7px; }
      .opsp-page .lane-title{ font-size:10.5px; font-weight:700; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
      .opsp-page .lane-count{ font-size:9.5px; font-weight:700; padding:1px 6px; border-radius:6px; flex:0 0 auto; color:var(--green-d); background:var(--green-t2); }
      .opsp-page .lane-body{ padding:0 6px 8px; display:flex; flex-direction:column; gap:6px; min-height:44px; }
      .opsp-page .lane-empty{ text-align:center; font-size:10px; color:var(--mute); padding:10px 0; }

      .opsp-page .card{ position:relative; background:#fff; border:1px solid #e9ece8; border-radius:9px; padding:8px; box-shadow:0 1px 2px rgba(20,40,30,.04); }
      /* Deep-link highlight (e.g. "Open lease" from a converted lead) */
      .opsp-page .card.focused, .opsp-page .rrow.focused{ border-color:var(--green); box-shadow:0 0 0 3px rgba(46,159,130,.28); animation:opsp-flash 1.6s ease-out 1; }
      @keyframes opsp-flash{ 0%{ box-shadow:0 0 0 3px rgba(46,159,130,.55); } 60%{ box-shadow:0 0 0 6px rgba(46,159,130,.12); } 100%{ box-shadow:0 0 0 3px rgba(46,159,130,.28); } }
      .opsp-page .c-top{ display:flex; align-items:center; gap:7px; }
      .opsp-page .card .c-top{ padding-right:30px; }  /* reserve the corner for the pinned age badge */
      .opsp-page .c-top .av{ width:23px; height:23px; flex:0 0 23px; border-radius:6px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; font-size:9px; font-weight:700; border:1px solid #cfe7dc; }
      .opsp-page .c-id{ flex:1; min-width:0; }
      .opsp-page .c-name{ font-size:11px; font-weight:700; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsp-page .c-ref{ font-family:'DM Mono',ui-monospace,monospace; font-size:9.5px; color:var(--mute); }
      .opsp-page .c-unit{ font-size:10px; color:var(--mute); margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* current-stage handler — highlighted banner pinned to the top of the card.
         Right margin clears the absolute age badge so the name never sits under it. */
      .opsp-page .c-handler-top{ display:flex; flex-direction:column; align-items:stretch; gap:4px; margin:0 30px 9px 0; padding:5px 9px; border-radius:8px;
        background:var(--green-t); border:1px solid #cfe7dc; min-width:0; }
      .opsp-page .c-handler-top .hperson{ display:flex; align-items:center; gap:6px; min-width:0; }
      .opsp-page .c-handler-top .hav{ width:17px; height:17px; flex:0 0 17px; border-radius:5px; background:var(--green-d); color:#fff; display:grid; place-items:center; font-size:8px; font-weight:700; }
      .opsp-page .c-handler-top .hname{ font-size:11.5px; font-weight:800; color:var(--green-d); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* handler cell (list row) — highlighted value */
      .opsp-page .rrow .r-handler{ width:170px; flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:800; color:var(--green-d); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsp-page .rrow .r-handler .hav{ width:19px; height:19px; flex:0 0 19px; border-radius:5px; background:var(--green-d); color:#fff; display:grid; place-items:center; font-size:8.5px; font-weight:700; }
      .opsp-page .rrow .r-handler.empty{ color:var(--mute); font-weight:500; }
      .opsp-page .c-foot{ display:flex; align-items:center; justify-content:space-between; gap:6px; margin-top:8px; flex-wrap:wrap; }
      .opsp-page .c-foot .rent{ font-size:11px; font-weight:700; color:var(--green-d); font-variant-numeric:tabular-nums; }
      .opsp-page .c-foot .term{ font-size:9.5px; color:var(--mute); font-variant-numeric:tabular-nums; }
      .opsp-page .open.escalate{ margin-top:6px; color:#5b3fbf; border-color:#d9d3f7; background:#f5f3fd; }
      .opsp-page .open{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; font-weight:600; color:var(--ink-2); text-decoration:none; padding:5px 8px; border-radius:7px; border:1px solid var(--line); background:#fff; margin-top:8px; width:100%; justify-content:center; }
      .opsp-page a.open:hover{ border-color:var(--green); color:var(--green-d); background:var(--green-t2); }
      .opsp-page .open.disabled{ color:var(--mute); cursor:default; }

      /* stage badge (grid + list) */
      .opsp-page .c-stage{ margin-left:auto; flex:0 0 auto; font-size:9px; letter-spacing:.05em; text-transform:uppercase; font-weight:700; padding:3px 8px; border-radius:99px; background:var(--sky-bg); color:var(--sky-fg); white-space:nowrap; }

      /* age / "stuck" badge — pinned to the card's top-right corner so it never
         crowds the name; stays inline within list rows. */
      .opsp-page .card .age{ position:absolute; top:6px; right:6px; z-index:2; }
      .opsp-page .age{ flex:0 0 auto; font-size:9px; font-weight:700; padding:2px 6px; border-radius:99px; font-variant-numeric:tabular-nums; white-space:nowrap; }
      .opsp-page .act-wrap{ display:inline-flex; align-items:center; gap:4px; margin-left:auto; flex:0 0 auto; }
      .opsp-page .lane-head .act-wrap{ margin-left:6px; }
      /* On a tile it is a corner badge — the tile's own label and number keep their room. */
      .opsp-page .pcard{ position:relative; }
      .opsp-page .pcard .act-wrap{ position:absolute; top:-8px; right:10px; margin:0; }
      .opsp-page .pcard .act-wrap .act.mail{ box-shadow:0 0 0 2px #fff; background:#2e9f82; color:#fff; }
      .opsp-page .pcard .act-wrap .act.wa{ box-shadow:0 0 0 2px #fff; background:#128c4a; color:#fff; }
      .opsp-page .card.waiting{ border-color:#2e9f82; box-shadow:0 0 0 1px #2e9f82 inset; }
      .opsp-page .c-wait{ margin:6px 0 2px; }
      .opsp-page .c-wait .act-wrap{ margin-left:0; flex-wrap:wrap; }
      .opsp-page .c-wait .act{ font-size:11px; padding:4px 9px; }
      .opsp-page .c-name .act-wrap{ margin-left:8px; vertical-align:middle; }
      .opsp-page .act{ display:inline-flex; align-items:center; gap:3px; font-size:10px; font-weight:700; line-height:1; padding:3px 7px; border-radius:99px; font-variant-numeric:tabular-nums; text-decoration:none; }
      .opsp-page .act.mail{ background:#eef9f4; color:#1a7a5a; }
      .opsp-page .act.wa{ background:#e6f7ec; color:#128c4a; }
      .opsp-page .act:hover{ filter:brightness(.95); }
      .opsp-page .age.fresh{ background:var(--paper-2); color:var(--mute); }
      .opsp-page .age.warn{ background:#fef3c7; color:#92400e; }
      .opsp-page .age.stale{ background:#fee2e2; color:#991b1b; }

      /* ── grid view ── */
      .opsp-page .grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:12px; }

      /* ── list view ── */
      .opsp-page .list{ display:flex; flex-direction:column; gap:8px; }
      .opsp-page .rrow{ display:flex; align-items:center; gap:14px; background:#fff; border:1px solid #e9ece8; border-radius:12px; padding:10px 14px; box-shadow:0 1px 2px rgba(20,40,30,.04); }
      .opsp-page .rrow .av{ width:32px; height:32px; flex:0 0 32px; border-radius:8px; background:var(--green-t); color:var(--green-d); display:grid; place-items:center; font-size:11px; font-weight:700; border:1px solid #cfe7dc; }
      .opsp-page .rrow .r-id{ width:180px; flex:0 0 auto; min-width:0; }
      .opsp-page .rrow .r-sub{ flex:1; min-width:120px; font-size:12px; color:var(--mute); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .opsp-page .rrow .c-stage{ margin-left:0; }
      .opsp-page .rrow .r-rent{ width:110px; flex:0 0 auto; text-align:right; font-size:12.5px; font-weight:700; color:var(--green-d); font-variant-numeric:tabular-nums; }
      .opsp-page .rrow .r-term{ width:120px; flex:0 0 auto; text-align:right; font-size:11px; color:var(--mute); font-variant-numeric:tabular-nums; }
      .opsp-page .rrow .open{ margin-top:0; width:auto; flex:0 0 auto; }

      /* ── responsive ── */
      @media (max-width:900px){
        .opsp-page .rrow .r-term{ display:none; }
      }
      @media (max-width:680px){
        .opsp-page .hero h1{ font-size:26px; }
        .opsp-page .search{ max-width:none; flex:1 1 100%; order:-1; }
        .opsp-page .rrow{ flex-wrap:wrap; gap:8px 12px; }
        .opsp-page .rrow .r-id{ width:auto; flex:1 1 auto; }
        .opsp-page .rrow .r-sub{ flex:1 1 100%; order:5; }
        .opsp-page .rrow .r-handler{ width:auto; order:6; }
        .opsp-page .rrow .r-rent{ width:auto; margin-left:auto; }
        .opsp-page .rrow .open{ order:7; margin-left:auto; }
      }
    `}</style>
  );
}
