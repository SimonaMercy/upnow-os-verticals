/**
 * Long-term Spaces journey — the per-SUBCATEGORY names (MarketSpace alignment).
 *
 * The backend runs ONE state machine for every long-term lease (lead stages →
 * contract statuses). What MarketSpace changed is the vocabulary: a family
 * renting an apartment books a *viewing*, makes an *offer with cheques* and
 * connects *DEWA*; a company taking a warehouse books a *site visit*, agrees an
 * *offer* and gets a *handover*; a land lease runs *due diligence* and ends in a
 * *land lease agreement*. This file is that vocabulary and nothing else — it
 * maps the EXISTING states onto per-subcategory labels and step positions. It
 * never invents a state, and every surface (customer v1 list, v2 detail, RP
 * leads queue, lead detail, contract rail) reads the same table, so a customer
 * and their landlord name the same stop the same way.
 *
 * Pure: no React, no network. Covered by the scratchpad journey test.
 */
import type { CustomerStateKey, CustomerStateDef } from './customerJourney';
import type { LeadStage } from './leadJourney';
import { effectiveSpaceCategory, isLandUnitType } from './unitTaxonomy';

/* ── Subcategory ───────────────────────────────────────────────────────────── */

export type SpaceSubcategory = 'residential' | 'commercial' | 'industrial' | 'land';
export const SPACE_SUBCATEGORIES: SpaceSubcategory[] = ['residential', 'commercial', 'industrial', 'land'];

/**
 * Which long-term subcategory a unit belongs to.
 *
 * Land is decided by the unit TYPE first (a plot inside any property is a
 * plot), then by the property's own category. Everything else defers to
 * `effectiveSpaceCategory`, so a MIXED-USE building (retired for new listings,
 * still live on existing ones) resolves per unit — its flats read residential,
 * its shops commercial — exactly as fees and VAT already do.
 */
export function spaceSubcategory(
  unitType: string | null | undefined,
  propertySpaceCategory?: string | null,
): SpaceSubcategory {
  if (isLandUnitType(unitType) || propertySpaceCategory === 'land') return 'land';
  const cat = effectiveSpaceCategory(unitType, propertySpaceCategory);
  if (cat === 'industrial' || cat === 'warehouse') return 'industrial';
  if (cat === 'commercial' || cat === 'retail' || cat === 'workspaces' || cat === 'venues') return 'commercial';
  return 'residential';
}

/* ── Registration / utility authority names ────────────────────────────────── */

/**
 * The tenancy-registration and utility names are Dubai's (Ejari / DEWA), which
 * is what MarketSpace shows. Outside Dubai they are not the right names
 * (Abu Dhabi registers through Tawtheeq, Sharjah's utility is SEWA…), so a
 * listing whose emirate is KNOWN and is not Dubai falls back to the neutral
 * words. An unknown emirate keeps the Dubai names — nearly every live listing.
 */
export function authorityNames(emirate?: string | null): { registration: string; utility: string } {
  const e = (emirate ?? '').trim().toLowerCase();
  if (e && e !== 'dubai' && e !== 'dxb') return { registration: 'Registration', utility: 'Utilities' };
  return { registration: 'Ejari', utility: 'DEWA' };
}

export interface JourneyOptions {
  subcategory: SpaceSubcategory;
  emirate?: string | null;
  /** How the lead started. A Book Now application has no viewing to "book",
   *  so its first stop must not read "Viewing booked". */
  bookedVia?: 'viewing' | 'book_now';
}

/* ── Customer rails ────────────────────────────────────────────────────────── */

export type JourneyIcon = 'calendar' | 'document' | 'wallet' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope';
export interface JourneyStep { key: string; label: string; short: string; icon: JourneyIcon }

/**
 * New-lease rail per subcategory. Residential / commercial / industrial have 8
 * stops; land has 7 (a bare plot has no separate utility stop — the utility
 * connection, when the backend asks for one, is part of Handover).
 *
 * The backend ORDER is fixed and identical for all four: documents → payment
 * plan → signatures → registration → utility → move-in inspection → active.
 */
export function newLeaseSteps(o: JourneyOptions): JourneyStep[] {
  const { registration, utility } = authorityNames(o.emirate);
  switch (o.subcategory) {
    case 'commercial':
      return [
        { key: 'booked',    label: 'Site visit',            short: 'Visit',     icon: 'calendar' },
        { key: 'documents', label: 'Company documents',     short: 'Docs',      icon: 'document' },
        { key: 'payment',   label: 'Heads of terms',        short: 'Terms',     icon: 'wallet'   },
        { key: 'sign',      label: 'Lease & signatures',    short: 'Sign',      icon: 'pen'      },
        { key: 'ejari',     label: registration,            short: registration, icon: 'stamp'   },
        { key: 'utility',   label: 'Utilities',             short: 'Utilities', icon: 'bolt'     },
        { key: 'move_in',   label: 'Fit-out & handover',    short: 'Handover',  icon: 'key'      },
        { key: 'active',    label: 'Active lease',          short: 'Active',    icon: 'active'   },
      ];
    case 'industrial':
      return [
        { key: 'booked',    label: 'Site visit',            short: 'Visit',     icon: 'calendar' },
        { key: 'documents', label: 'Company documents',     short: 'Docs',      icon: 'document' },
        { key: 'payment',   label: 'Offer',                 short: 'Offer',     icon: 'wallet'   },
        { key: 'sign',      label: 'Lease & signatures',    short: 'Sign',      icon: 'pen'      },
        { key: 'ejari',     label: registration,            short: registration, icon: 'stamp'   },
        { key: 'utility',   label: 'Utilities',             short: 'Utilities', icon: 'bolt'     },
        { key: 'move_in',   label: 'Handover',              short: 'Handover',  icon: 'key'      },
        { key: 'active',    label: 'Active lease',          short: 'Active',    icon: 'active'   },
      ];
    case 'land':
      return [
        { key: 'booked',    label: 'Site visit',            short: 'Visit',     icon: 'calendar' },
        { key: 'documents', label: 'Due diligence',         short: 'Diligence', icon: 'document' },
        { key: 'payment',   label: 'Offer',                 short: 'Offer',     icon: 'wallet'   },
        { key: 'sign',      label: 'Land lease agreement',  short: 'Agreement', icon: 'pen'      },
        { key: 'ejari',     label: 'Registration',          short: 'Registration', icon: 'stamp' },
        { key: 'move_in',   label: 'Handover',              short: 'Handover',  icon: 'key'      },
        { key: 'active',    label: 'Active land lease',     short: 'Active',    icon: 'active'   },
      ];
    case 'residential':
    default:
      return [
        { key: 'booked',    label: o.bookedVia === 'book_now' ? 'Application' : 'Viewing', short: o.bookedVia === 'book_now' ? 'Apply' : 'Viewing', icon: 'calendar' },
        { key: 'documents', label: 'Documents',             short: 'Docs',      icon: 'document' },
        { key: 'payment',   label: 'Offer & cheques',       short: 'Offer',     icon: 'wallet'   },
        { key: 'sign',      label: 'Contract & signatures', short: 'Sign',      icon: 'pen'      },
        { key: 'ejari',     label: registration,            short: registration, icon: 'stamp'   },
        { key: 'utility',   label: utility,                 short: utility,     icon: 'bolt'     },
        { key: 'move_in',   label: 'Move-in',               short: 'Move-in',   icon: 'key'      },
        { key: 'active',    label: 'Active tenancy',        short: 'Active',    icon: 'active'   },
      ];
  }
}

/** Renewal rail — 6 stops for every subcategory (only the words differ). */
export function renewalSteps(o: JourneyOptions): JourneyStep[] {
  const { registration } = authorityNames(o.emirate);
  const land = o.subcategory === 'land';
  const reg = land ? 'Registration renewal' : `${registration} renewal`;
  return [
    { key: 'terms_offered', label: 'Terms offered',                          short: 'Terms',   icon: 'envelope' },
    { key: 'documents',     label: o.subcategory === 'residential' ? 'Renewal documents' : 'Company documents', short: 'Docs', icon: 'document' },
    { key: 'cheques',       label: 'Cheques / PDC',                          short: 'Cheques', icon: 'wallet'   },
    { key: 'sign',          label: land ? 'Sign land lease renewal' : o.subcategory === 'residential' ? 'Sign renewal' : 'Sign lease renewal', short: 'Sign', icon: 'pen' },
    { key: 'ejari',         label: reg,                                      short: land ? 'Registration' : registration, icon: 'stamp' },
    { key: 'active',        label: 'Renewal active',                         short: 'Active',  icon: 'active'   },
  ];
}

/* ── State → rail stop ─────────────────────────────────────────────────────── */

/** Which rail a state belongs to. Dead-ends sit on no rail. */
const RAIL_OF: Record<CustomerStateKey, 'new' | 'renewal' | null> = {
  booked: 'new', docs_required: 'new', docs_under_review: 'new',
  payment_review: 'new', awaiting_rp_confirm: 'new',
  signature: 'new', ejari: 'new', utility: 'new', utility_review: 'new',
  move_in: 'new', move_in_review: 'new', active: 'new',
  termination_request_received: 'new', termination_request_sent: 'new', terminating: 'new',
  renewal_offered: 'renewal', renewal_documents: 'renewal', renewal_cheques: 'renewal',
  renewal_cheques_review: 'renewal', renewal_progress: 'renewal', renewal_ejari: 'renewal',
  renewal_ready: 'renewal', renewal_active: 'renewal',
  rejected: null, withdrawn: null, terminated: null, renewal_rejected: null, superseded: null,
};

/** The rail step KEY each state stands on. Land has no 'utility' stop, so its
 *  utility states stand on Handover (see `stepKeyFor`). */
const STEP_KEY_OF: Record<CustomerStateKey, string | null> = {
  booked: 'booked', docs_required: 'documents', docs_under_review: 'documents',
  payment_review: 'payment', awaiting_rp_confirm: 'payment',
  signature: 'sign', ejari: 'ejari', utility: 'utility', utility_review: 'utility',
  move_in: 'move_in', move_in_review: 'move_in', active: 'active',
  termination_request_received: 'active', termination_request_sent: 'active', terminating: 'active',
  renewal_offered: 'terms_offered', renewal_documents: 'documents', renewal_cheques: 'cheques',
  renewal_cheques_review: 'cheques', renewal_progress: 'sign', renewal_ejari: 'ejari',
  renewal_ready: 'active', renewal_active: 'active',
  rejected: null, withdrawn: null, terminated: null, renewal_rejected: null, superseded: null,
};

function stepKeyFor(key: CustomerStateKey, sub: SpaceSubcategory): string | null {
  const k = STEP_KEY_OF[key];
  if (sub === 'land' && k === 'utility') return 'move_in';
  return k;
}

export interface JourneyPosition {
  mode: 'new' | 'renewal' | 'rejected';
  steps: JourneyStep[];
  /** Index into `steps`, or -1 for a dead-end. */
  index: number;
  total: number;
}

export function journeyPosition(key: CustomerStateKey, o: JourneyOptions): JourneyPosition {
  const rail = RAIL_OF[key];
  if (!rail) return { mode: 'rejected', steps: newLeaseSteps(o), index: -1, total: 0 };
  const steps = rail === 'renewal' ? renewalSteps(o) : newLeaseSteps(o);
  const sk = stepKeyFor(key, o.subcategory);
  const index = sk ? steps.findIndex(s => s.key === sk) : -1;
  return { mode: rail, steps, index, total: steps.length };
}

/* ── Customer-facing state labels ──────────────────────────────────────────── */

type LabelTable = Record<CustomerStateKey, string>;

const SHARED_TAIL = {
  termination_request_received: 'Provider requested termination',
  termination_request_sent: 'Your termination request',
  renewal_offered: 'Renewal offered',
  renewal_documents: 'Renewal documents',
  renewal_cheques: 'Renewal payments',
  renewal_cheques_review: 'Payments under review',
  renewal_rejected: 'Renewal declined',
  rejected: 'Application declined',
  withdrawn: 'You declined this space',
  superseded: 'No longer available',
  terminating: 'Move-out scheduled',
} as const;

function labelTable(o: JourneyOptions): LabelTable {
  const { registration, utility } = authorityNames(o.emirate);
  const bookNow = o.bookedVia === 'book_now';
  switch (o.subcategory) {
    case 'commercial':
    case 'industrial': {
      const ind = o.subcategory === 'industrial';
      return {
        ...SHARED_TAIL,
        booked: bookNow ? 'Application received' : 'Site visit booked',
        docs_required: 'Company documents required',
        docs_under_review: 'Company documents under review',
        payment_review: ind ? 'Review the offer' : 'Review heads of terms',
        awaiting_rp_confirm: 'Payments under review',
        signature: 'Sign your lease',
        ejari: `${registration} in progress`,
        utility: 'Connect utilities',
        utility_review: 'Utilities under review',
        move_in: ind ? 'Handover inspection' : 'Fit-out & handover',
        move_in_review: 'Handover under review',
        active: 'Active lease',
        terminated: 'Lease terminated',
        renewal_progress: 'Sign your lease renewal',
        renewal_ejari: `${registration} renewal in progress`,
        renewal_ready: 'Renewal confirmed',
        renewal_active: 'Renewal active',
      };
    }
    case 'land':
      return {
        ...SHARED_TAIL,
        booked: bookNow ? 'Plot application received' : 'Site visit booked',
        docs_required: 'Due-diligence documents required',
        docs_under_review: 'Due diligence under review',
        payment_review: 'Review the offer',
        awaiting_rp_confirm: 'Payments under review',
        signature: 'Sign the land lease',
        ejari: 'Registration in progress',
        utility: 'Utility connection (handover)',
        utility_review: 'Utility connection under review',
        move_in: 'Plot handover',
        move_in_review: 'Handover under review',
        active: 'Active land lease',
        terminated: 'Land lease terminated',
        renewal_progress: 'Sign the land lease renewal',
        renewal_ejari: 'Registration renewal in progress',
        renewal_ready: 'Renewal confirmed',
        renewal_active: 'Renewal active',
      };
    case 'residential':
    default:
      return {
        ...SHARED_TAIL,
        booked: bookNow ? 'Application received' : 'Viewing booked',
        docs_required: 'Documents required',
        docs_under_review: 'Documents under review',
        payment_review: 'Offer & cheques',
        awaiting_rp_confirm: 'Payments under review',
        signature: 'Sign your contract',
        ejari: `${registration} in progress`,
        utility: `Connect ${utility}`,
        utility_review: `${utility} under review`,
        move_in: 'Move-in inspection',
        move_in_review: 'Inspection under review',
        active: 'Active tenancy',
        terminated: 'Tenancy terminated',
        renewal_progress: 'Sign your renewal',
        renewal_ejari: `${registration} renewal in progress`,
        renewal_ready: 'Renewal confirmed',
        renewal_active: 'Renewal active',
      };
  }
}

export function customerStateLabel(key: CustomerStateKey, o: JourneyOptions): string {
  return labelTable(o)[key];
}

/** "Step 3 of 8 · Heads of terms" / "Renewal step 2 of 6" / "" for dead-ends. */
export function customerStepLabel(key: CustomerStateKey, o: JourneyOptions): string {
  const p = journeyPosition(key, o);
  if (p.index < 0) return '';
  return `${p.mode === 'renewal' ? 'Renewal step' : 'Step'} ${p.index + 1} of ${p.total}`;
}

/**
 * The shared state definition re-dressed for one subcategory: the pill label,
 * the "Step N of T" line and the rail index change; the tone and body copy
 * stay (they describe the backend state, which is the same for all four).
 * The headline changes only where the base copy names the wrong thing
 * (a "viewing" on a plot, a "tenancy contract" on a warehouse lease).
 */
export function presentCustomerState(base: CustomerStateDef, key: CustomerStateKey, o: JourneyOptions): CustomerStateDef {
  const p = journeyPosition(key, o);
  const residential = o.subcategory === 'residential';
  const bookNow = o.bookedVia === 'book_now';
  let headline = base.headline;
  let body = base.body;
  if (key === 'booked') {
    if (bookNow) {
      headline = 'Your application is in.';
      body = 'Your rental provider has your preferences. Tap “I’m Interested” to confirm and move on to documents.';
    } else if (!residential) {
      headline = o.subcategory === 'land' ? 'Your site visit for this plot is booked.' : 'Your site visit is booked.';
    }
  }
  if (key === 'signature' && !residential) {
    headline = o.subcategory === 'land' ? 'Review and sign your land lease agreement.' : 'Review and sign your lease.';
  }
  if (key === 'active' && !residential) headline = o.subcategory === 'land' ? 'Your land lease is live.' : 'Your lease is live.';
  const sub = p.index >= 0
    ? (key === 'active' ? `Step ${p.index + 1} of ${p.total} — ${residential ? 'tenancy' : 'lease'} is live`
      : key === 'renewal_active' ? `Renewal step ${p.index + 1} of ${p.total} — done`
      : key.startsWith('termination_') || key === 'terminating' ? base.sub
      : customerStepLabel(key, o))
    : base.sub;
  return { ...base, label: customerStateLabel(key, o), sub, headline, body, currentIndex: p.index };
}

/* ── RP side: lead stages ──────────────────────────────────────────────────── */

/** Lead-stage names per subcategory — the same words the customer sees. */
export function leadStageLabel(stage: LeadStage, sub: SpaceSubcategory): string {
  const visit = sub === 'residential' ? 'Viewing' : 'Site visit';
  const docs = sub === 'residential' ? 'Documents' : sub === 'land' ? 'Due diligence' : 'Company docs';
  const offer = sub === 'residential' ? 'Offer & cheques' : sub === 'commercial' ? 'Heads of terms' : 'Offer';
  const lease = sub === 'residential' ? 'Contract issued' : sub === 'land' ? 'Land lease issued' : 'Lease issued';
  switch (stage) {
    case 'new':                  return 'New enquiry';
    case 'contacted':            return 'Contacted';
    case 'viewing_scheduled':    return visit;
    case 'offer_made':           return 'Offer made';
    case 'applied':              return 'Applied';
    case 'interested':           return 'Interested';
    case 'documents_collection': return docs;
    case 'approved':             return sub === 'land' ? 'Diligence cleared' : 'Docs approved';
    case 'payment_plan_shared':  return offer;
    case 'cheques_submitted':    return 'Payment confirmation';
    case 'cheques_collected':    return 'Collected';
    case 'contract_issued':      return lease;
    case 'converted':            return `Converted · ${lease.toLowerCase()}`;
    case 'rejected':             return 'Rejected';
    default:                     return String(stage);
  }
}

/**
 * Pipeline column title for a set of leads. When every lead in view is the
 * same subcategory the column uses its words; a mixed portfolio gets the
 * neutral pair ("Viewing / site visit") so no lead is mislabelled.
 */
export function leadColumnLabel(stage: LeadStage, subs: Iterable<SpaceSubcategory>): string {
  const set = new Set(subs);
  if (set.size === 1) return leadStageLabel(stage, [...set][0]);
  switch (stage) {
    case 'viewing_scheduled':    return set.has('residential') ? 'Viewing / site visit' : 'Site visit';
    case 'documents_collection': return 'Documents';
    case 'payment_plan_shared':  return 'Offer / terms';
    case 'converted':            return 'Converted';
    default:                     return leadStageLabel(stage, 'residential');
  }
}

/** The 6 lead-journey nodes on the lead detail page, per subcategory. */
export function leadJourneyNodes(sub: SpaceSubcategory): string[] {
  return [
    sub === 'residential' ? 'Viewing' : 'Site visit',
    'Interested',
    sub === 'residential' ? 'Documents' : sub === 'land' ? 'Due diligence' : 'Company documents',
    sub === 'residential' ? 'Offer & cheques' : sub === 'commercial' ? 'Heads of terms' : 'Offer',
    'Payment confirmation',
    sub === 'residential' ? 'Contract issued' : sub === 'land' ? 'Land lease issued' : 'Lease issued',
  ];
}

/* ── RP side: contract rail ────────────────────────────────────────────────── */

export type ContractRailKey = 'issue' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active';

/** Labels for the RP contract rail (STEPS_NEW keys), per subcategory. The rail
 *  keeps its 6 keys — only the words change. */
export function contractRailLabels(o: JourneyOptions): Record<ContractRailKey, { label: string; short: string }> {
  const { registration, utility } = authorityNames(o.emirate);
  switch (o.subcategory) {
    case 'commercial':
      return {
        issue: { label: 'Lease issued', short: 'Issue' }, sign: { label: 'Lease & signatures', short: 'Sign' },
        ejari: { label: registration, short: registration }, utility: { label: 'Utilities', short: 'Utilities' },
        movein: { label: 'Fit-out & handover', short: 'Handover' }, active: { label: 'Active lease', short: 'Active' },
      };
    case 'industrial':
      return {
        issue: { label: 'Lease issued', short: 'Issue' }, sign: { label: 'Lease & signatures', short: 'Sign' },
        ejari: { label: registration, short: registration }, utility: { label: 'Utilities', short: 'Utilities' },
        movein: { label: 'Handover inspection', short: 'Handover' }, active: { label: 'Active lease', short: 'Active' },
      };
    case 'land':
      return {
        issue: { label: 'Land lease issued', short: 'Issue' }, sign: { label: 'Land lease agreement', short: 'Sign' },
        ejari: { label: 'Registration', short: 'Registration' }, utility: { label: 'Utility connection', short: 'Utility' },
        movein: { label: 'Plot handover', short: 'Handover' }, active: { label: 'Active land lease', short: 'Active' },
      };
    case 'residential':
    default:
      return {
        issue: { label: 'Contract issued', short: 'Issue' }, sign: { label: 'Contract & signatures', short: 'Sign' },
        ejari: { label: registration, short: registration }, utility: { label: utility, short: utility },
        movein: { label: 'Move-in inspection', short: 'Move-in' }, active: { label: 'Active tenancy', short: 'Active' },
      };
  }
}

/* ── Book Now detection ────────────────────────────────────────────────────── */

/**
 * Did this lead start from Book Now (an application) rather than a viewing
 * request? The API carries no explicit flag. What it does carry: the public
 * viewing form sends only a date/time and notes, while Book Now (and the RP's
 * direct-booking form) records the move-in date AND the instalment count on
 * the viewing row at creation. So a row with both, or no viewing at all, is an
 * application. Heuristic — used for wording only, never for routing.
 */
export function bookedViaOf(viewing: { desiredMoveIn?: string | null; preferredChequeCount?: number | null } | null | undefined): 'viewing' | 'book_now' {
  if (!viewing) return 'book_now';
  return viewing.desiredMoveIn && viewing.preferredChequeCount != null ? 'book_now' : 'viewing';
}

/**
 * Journey options for one surface. `bookedVia` is only consulted while the
 * customer is still on the first stop: once a viewing customer taps
 * "I'm Interested" their viewing ALSO carries a move-in date and cheque count,
 * so the heuristic would mis-read them as Book Now on every later step.
 */
export function journeyOptionsFor(key: CustomerStateKey, input: {
  unitType?: string | null;
  spaceCategory?: string | null;
  emirate?: string | null;
  viewing?: { desiredMoveIn?: string | null; preferredChequeCount?: number | null } | null;
  /** True when the row has no viewing at all (a direct lead). */
  direct?: boolean;
}): JourneyOptions {
  return {
    subcategory: spaceSubcategory(input.unitType, input.spaceCategory),
    emirate: input.emirate ?? null,
    bookedVia: key === 'booked' ? (input.direct ? 'book_now' : bookedViaOf(input.viewing ?? null)) : undefined,
  };
}
