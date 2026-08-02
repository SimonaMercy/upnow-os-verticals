/**
 * The customer tenancy journey — ONE resolver, shared by every surface that
 * has to say where a customer has got to.
 *
 * It used to live inside the space DETAIL page only, so the "My Spaces" LIST
 * had to invent its own coarse mapping off `lead.stage` / `contract.status`.
 * The two disagreed: a customer sitting on "Documents required — Step 2 of 8"
 * read "Awaiting Next Step / In progress" on the list, which names neither the
 * step nor the fact that it is waiting on THEM. Both screens now call
 * `deriveStateKey` on the same inputs, so they cannot drift apart again.
 *
 * The input types here are deliberately MINIMAL structural subsets — only the
 * fields the resolver actually reads. A caller's richer contract/viewing/doc
 * objects satisfy them structurally, so nobody has to reshape their payloads.
 */
import { isDocKeySatisfied } from './docRequirements';
import { additionalDocKey, resolveRequestedDocKey } from './requestableDocs';
import { APP_TIME_ZONE } from './datetime';

/* ── The states ────────────────────────────────────────────────────────────── */

export type CustomerStateKey =
  | 'booked'
  | 'docs_required'
  | 'docs_under_review'
  | 'payment_review'
  | 'awaiting_rp_confirm'
  | 'signature' | 'ejari' | 'utility' | 'utility_review'
  | 'move_in' | 'move_in_review' | 'active'
  | 'termination_request_received' | 'termination_request_sent'
  | 'renewal_offered' | 'renewal_documents' | 'renewal_cheques' | 'renewal_cheques_review'
  | 'renewal_progress' | 'renewal_ejari' | 'renewal_active'
  | 'rejected' | 'withdrawn' | 'terminated' | 'renewal_rejected'
  | 'superseded' | 'terminating';

export type CustomerJourneyMode = 'new' | 'renewal' | 'rejected';
export type CustomerJourneyTone = 'action' | 'waiting' | 'celebrate' | 'declined';

/* ── Resolver inputs ───────────────────────────────────────────────────────── */

export interface JourneyContract {
  status: string;
  contractType?: string | null;
  contractActive?: boolean;
  ejariStatus?: string | null;
  utilityStatus?: string | null;
  pdcConfirmed?: boolean;
  renewalDocsRequiredAt?: string | null;
  renewalDocsAcceptedAt?: string | null;
  tenantSignedAt?: string | null;
  landlordSignedAt?: string | null;
  /** Customer has handed the renewal cheques over — the step becomes a waiting
   *  screen until the RP confirms collection (pdcConfirmed). */
  tenantChequesSubmittedAt?: string | null;
  renewalAccepted?: 'pending' | 'accepted' | 'rejected' | null;
  vacateAtEnd?: boolean;
  moveInInspection?: { submitted: boolean; signedByTenant: boolean } | null;
  termination?: {
    requestedByRole?: 'tenant' | 'rental_provider' | null;
    response?: 'pending' | 'accepted' | 'rejected' | null;
  } | null;
}

export interface JourneyViewing {
  status?: string | null;
  outcome?: string | null;
}

export interface JourneyDoc {
  documentKey: string;
  /** Optional because the detail page's TenantDoc leaves it undefined for a
   *  freshly-uploaded row that hasn't been re-read from the server yet. */
  status?: string | null;
}

export interface JourneyInput {
  contract: JourneyContract | null;
  renewalContract: JourneyContract | null;
  viewing: JourneyViewing | null;
  /** lead.stage */
  stage: string | null;
  paymentPlan: unknown;
  allRequiredDocsUploaded: boolean;
  /** Customer tapped "Submit documents" (client-side gate, localStorage). */
  docsSubmitted?: boolean;
  myDocs: JourneyDoc[];
  /** Free-text names the RP asked for (leads.additionalDocsNote). */
  requestedAdditionalDocs: string[];
}

/* ── Per-state copy ────────────────────────────────────────────────────────── */

export interface CustomerStateDef {
  label: string;
  sub: string;
  mode: CustomerJourneyMode;
  currentIndex: number;
  tone: CustomerJourneyTone;
  headline: string;
  body: string;
  timing: string | null;
}

// Copy guideline: headline carries the state, body adds the next action or
// new context — never restates what the headline already says. Keep both
// short; the timing row carries the "how long" beat.
export const CUSTOMER_STATE_DEFS: Record<CustomerStateKey, CustomerStateDef> = {
  booked:                        { label: 'Viewing booked',                sub: 'Step 1 of 8',                     mode: 'new',     currentIndex: 0,  tone: 'action',    headline: 'Your viewing is confirmed.',                              body: 'Look over the cost summary below. Tap “I’m Interested” when you’re ready to commit to this unit.',                                                                                              timing: null },
  docs_required:                 { label: 'Documents required',            sub: 'Step 2 of 8',                     mode: 'new',     currentIndex: 1,  tone: 'action',    headline: 'Almost there. Let us gather your paperwork.',             body: 'Add the missing identity and supporting documents below. Most customers finish in under 5 minutes.',                                                                                            timing: 'Takes ~5 min' },
  docs_under_review:             { label: 'Documents under review',        sub: 'Step 2 of 8',                     mode: 'new',     currentIndex: 1,  tone: 'waiting',   headline: 'Your documents are being reviewed.',                       body: 'Once approved, your payment summary and contract preview unlock so you can prepare payments.',                                                                                                  timing: 'Usually within 1 business day' },
  payment_review:                { label: 'Payment & references',          sub: 'Step 3 of 8',                     mode: 'new',     currentIndex: 2,  tone: 'action',    headline: 'Review your plan and prepare your cheques or payments accordingly.', body: 'Attach a reference for each one — cheque photo, transfer screenshot, card slip or cash receipt — so it can be verified.',                                                                       timing: 'Takes ~5 min' },
  awaiting_rp_confirm:           { label: 'Payments under review',         sub: 'Step 3 of 8',                     mode: 'new',     currentIndex: 2,  tone: 'waiting',   headline: 'Your rental provider is reviewing your payments.',       body: 'Each reference is being verified against your contract before it’s issued for signature.',                                                                                                       timing: 'Usually within 1 business day' },
  signature:                     { label: 'Awaiting your signature',       sub: 'Step 4 of 8',                     mode: 'new',     currentIndex: 3,  tone: 'action',    headline: 'Review and sign your tenancy contract.',          body: 'Open the final contract, then add your signature below.',                                                                                                                                         timing: 'Takes ~2 min' },
  ejari:                         { label: 'Contract Registration in progress', sub: 'Step 7 of 8',                 mode: 'new',     currentIndex: 6,  tone: 'waiting',   headline: 'Your rental provider is registering your Contract Registration Certificate.', body: 'The certificate will appear here for download the moment it’s uploaded.',                                                                                                                       timing: '2-5 business days' },
  utility:                       { label: 'Confirm utility account',       sub: 'Step 5 of 8',                     mode: 'new',     currentIndex: 4,  tone: 'action',    headline: 'Confirm your utility account.',                    body: 'Premises number is pre-filled. Add your account number, upload a proof of payment, and submit.',                                                                                                timing: 'Takes ~1 min' },
  utility_review:                { label: 'Utility under review',          sub: 'Step 5 of 8',                     mode: 'new',     currentIndex: 4,  tone: 'waiting',   headline: 'Your utility submission is under review.',         body: 'Your rental provider is checking your account number and proof of payment. You’ll move on to the inspection once it’s approved.',                                                               timing: 'Usually within 1 business day' },
  move_in:                       { label: 'Move-in inspection',            sub: 'Step 6 of 8',                     mode: 'new',     currentIndex: 5,  tone: 'action',    headline: 'Review the inspection. Then collect your keys.',          body: 'Walk through every room and meter reading, then counter-sign so the record is official.',                                                                                                       timing: 'Takes ~3 min' },
  // Customer has counter-signed; the inspection now sits with the rental provider
  // (or their property manager) — their counter-signature is what activates the tenancy.
  move_in_review:                { label: 'Inspection under review',       sub: 'Step 6 of 8',                     mode: 'new',     currentIndex: 5,  tone: 'waiting',   headline: 'You’ve signed — awaiting your rental provider’s approval.', body: 'Your rental provider or their property manager will counter-sign the inspection. Once they do, your tenancy goes live and you can collect your keys.',                                            timing: 'Usually within 1 business day' },
  active:                        { label: 'Active tenancy',                sub: 'Step 8 of 8 — tenancy is live',   mode: 'new',     currentIndex: 7,  tone: 'celebrate', headline: 'Your tenancy is live.',                                   body: '',                                                                                                                                                                                             timing: null },
  termination_request_received:  { label: 'Provider requested termination',sub: 'Respond required',                mode: 'new',     currentIndex: 7,  tone: 'action',    headline: 'Your rental provider wants to end the contract early.',   body: 'Check the reason and effective date below, then accept or reject.',                                                                                                                             timing: 'Awaiting your response' },
  termination_request_sent:      { label: 'Your termination request',      sub: 'Awaiting rental provider',        mode: 'new',     currentIndex: 7,  tone: 'waiting',   headline: 'Your request is with the rental provider.',               body: "Your contract stays active until they accept. We'll notify you the moment they respond.",                                                                                                       timing: 'Awaiting rental provider response' },

  renewal_offered:               { label: 'Renewal offered',               sub: 'Renewal step 1 of 6',             mode: 'renewal', currentIndex: 0,  tone: 'action',    headline: 'Stay another year? Here are the new terms.',             body: 'Preview the contract, then accept to lock the terms in.',                                                                                                       timing: 'Awaiting your decision' },
  // Kept defined so the state map stays exhaustive, but no longer rendered
  // as a default timeline step. Routing only lands here if a future phase
  // turns the renewal docs step back on for expired KYC.
  renewal_documents:             { label: 'Renewal documents',             sub: 'Renewal step 2 of 6',                mode: 'renewal', currentIndex: 1,  tone: 'action',    headline: 'Quick paperwork refresh for the renewal.',               body: "Some of your ID documents expired since your last lease — please re-upload current copies.",                                                                                                    timing: 'Takes ~3 min' },
  // Cheques/PDC step — the customer reviews + confirms the renewal cheques and
  // the RP confirms collection BEFORE signature is unlocked (matches the RP
  // renewal pipeline / Operations kanban and the new-lease payment step).
  renewal_cheques:               { label: 'Renewal payments',              sub: 'Renewal step 3 of 6',                mode: 'renewal', currentIndex: 2,  tone: 'action',    headline: 'New year, new payments.',                                 body: 'Prepare each one against the renewal schedule below, then confirm.',                                                                                                                            timing: 'Confirm when ready' },
  // Same stop on the rail (currentIndex 2) — the customer has handed the cheques
  // over and is waiting on the RP, so the copy switches from "do this" to
  // "we're on it", mirroring awaiting_rp_confirm on the new-lease side.
  renewal_cheques_review:        { label: 'Payments under review',         sub: 'Renewal step 3 of 6',                mode: 'renewal', currentIndex: 2,  tone: 'waiting',   headline: 'Your rental provider is reviewing your payments.',        body: 'Each cheque is being verified and collected before your renewal goes for signature.',                                                                                                           timing: 'Usually within 1 business day' },
  renewal_progress:              { label: 'Sign your renewal',             sub: 'Renewal step 4 of 6',             mode: 'renewal', currentIndex: 3,  tone: 'action',    headline: 'Last bit — sign your renewal.',                          body: 'Add your signature to lock in the renewed lease.',                                                                                                                                                timing: 'Takes ~2 min' },
  renewal_ejari:                 { label: 'Renewing Contract Registration',                sub: 'Renewal step 5 of 6',             mode: 'renewal', currentIndex: 4,  tone: 'waiting',   headline: 'Your rental provider is renewing your Contract Registration Certificate.',                 body: '',                                                                                                                                                                                             timing: '2-5 business days' },
  renewal_active:                { label: 'Renewal active',                sub: 'Renewal step 6 of 6 — done',      mode: 'renewal', currentIndex: 5,  tone: 'celebrate', headline: 'Your renewal is live.',                                   body: 'Everything carries over — same unit, same deposit, fresh paperwork.',                                                                                                                           timing: null },

  rejected:                      { label: 'Application declined',          sub: 'This unit',                       mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your rental provider declined this application.',        body: "Sometimes it's the provider, sometimes it's timing. We'll help you find a place that fits.",                                                                                                  timing: null },
  withdrawn:                     { label: 'You declined this unit',        sub: 'This unit',                       mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'You declined this offer.',                               body: "No problem — this unit is off your list. Whenever you're ready, we'll help you find a place that fits.",                                                                                       timing: null },
  terminated:                    { label: 'Tenancy terminated',            sub: 'Contract closed',                 mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'Your tenancy has ended.',                                body: 'Final settlements processed; security deposit return pending move-out inspection.',                                                                                                             timing: null },
  renewal_rejected:              { label: 'Renewal declined',              sub: 'Renewal closed',                  mode: 'renewal',  currentIndex: -1, tone: 'declined', headline: 'You declined this renewal offer.',                       body: 'New terms can still be proposed, or your tenancy will end as scheduled.',                                                                                                                       timing: null },
  // Phase 6c — a stale draft that the RP archived because the unit was
  // leased to another customer before this draft could activate. The
  // customer journey dead-ends here; we route them to the listings.
  superseded:                    { label: 'Unit no longer available',      sub: 'Browse other listings',           mode: 'rejected', currentIndex: -1, tone: 'declined', headline: 'This unit has been leased to another customer.',         body: "Your draft contract has been archived. Browse other listings to find a new home — we've kept your documents on file to speed up the next booking.",                                            timing: null },
  // Phase 6c — accepted termination, contract still ACTIVE until the
  // move-out date. Wind-down view: no renewals, no money flow changes,
  // just a count-down to the effective date.
  terminating:                    { label: 'Move-out scheduled',           sub: 'Tenancy winding down',            mode: 'new',      currentIndex: 7,  tone: 'waiting',  headline: 'Move-out is scheduled.',                                  body: 'Your tenancy stays active until the effective date. Get your move-out checklist ready and arrange the final inspection.',                                                                       timing: 'Until effective date' },
};

/* ── Which contract is the current lease, and which is the renewal? ────────── */

export interface ChainContract {
  id: number;
  parentContractId?: number | null;
  status: string;
  startDate?: string | null;
}

/**
 * Split a unit's contracts into the IN-FORCE lease and the renewal in flight.
 *
 * A renewal chain hangs off parentContractId and can run many generations deep
 * (root → … → current lease → proposed renewal). Resolving from the root
 * collapses to the ORIGINAL lease and its FIRST renewal, so a customer on their
 * 3rd renewal sees stale year-1 amounts. Walk from the TIP instead — the newest
 * contract in the chain:
 *   • If the tip is a renewal still being processed (a pending/issued child),
 *     the current lease is its parent and the tip is the proposed renewal —
 *     this keeps the renewal_* journey framing intact.
 *   • Otherwise the tip is itself the current contract (active lease, or a
 *     brand-new draft with no renewal yet).
 *
 * Recency = latest start date, then highest id (newer rows / superseded
 * re-proposals win, so a stale duplicate proposal never shadows the live one).
 */
export function resolveContractChain<T extends ChainContract>(
  forUnit: T[],
): { contract: T | null; renewalContract: T | null } {
  const byRecency = (a: T, b: T) =>
    (b.startDate ?? '').localeCompare(a.startDate ?? '') || (b.id - a.id);
  const tip = forUnit.slice().sort(byRecency)[0] ?? null;
  // Today (Asia/Dubai) — to compare against the term start.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
  const tipStartIso = (tip?.startDate ?? '').slice(0, 10);
  // A tip is "not yet the current tenancy" when it's still being processed
  // (issued/pending renewal child) OR when it was activated BEFORE its term
  // starts — the double-active glitch where a renewal's Ejari was registered
  // early, so a future-dated lease is wrongly `active`. In BOTH cases the
  // in-force lease is the parent and the tip is the renewal, so the customer
  // sees their current lease + the renewal, never next year's lease as "live".
  const tipNotYetCurrent = !!tip && !!tip.parentContractId &&
    (tip.status !== 'active' || (!!tipStartIso && tipStartIso > todayIso));
  if (tip && tipNotYetCurrent) {
    return {
      contract: forUnit.find(c => c.id === tip.parentContractId) ?? tip,
      renewalContract: tip,
    };
  }
  return {
    contract: tip,
    renewalContract: tip
      ? (forUnit.filter(c => c.parentContractId === tip.id).sort(byRecency)[0] ?? null)
      : null,
  };
}

/* ── Customer "submit documents" gate ──────────────────────────────────────── */

// The uploaded files are already visible to the RP; this just lets the customer
// decide WHEN their docs flip from "upload" to "submitted / under review",
// instead of auto-advancing the moment the last file lands.
//
// THE SERVER IS NOW THE RECORD. This used to live ONLY in localStorage, which
// meant clearing site data or opening the page on another device silently
// reverted the customer to "documents required" — with no way for them to know
// why — and the landlord had no record the customer had ever submitted. The one
// signal that a pack was ready to review existed on a single laptop.
//
// `lead.docsSubmittedAt` is the fact now. The local flag is kept ONLY as an
// optimistic echo so the UI does not flicker between the click and the refetch.
const docsSubmitKey = (spaceKey: string) => `upnow_docs_submitted_${spaceKey}`;

/**
 * Has the customer declared their pack final?
 *
 * The SERVER value wins whenever there is one, so a stale browser can no longer
 * contradict the record. The local flag is a fallback for the moment between
 * clicking and the refetch landing.
 */
export function readDocsSubmitted(spaceKey: string, serverAt?: string | null): boolean {
  if (serverAt) return true;
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(docsSubmitKey(spaceKey)) === '1'; } catch { return false; }
}

/** Optimistic echo only — the durable write is PATCH /leads/:id/documents-ready. */
export function writeDocsSubmitted(spaceKey: string) {
  try { window.localStorage.setItem(docsSubmitKey(spaceKey), '1'); } catch { /* ignore */ }
}

/* ── Resolver ──────────────────────────────────────────────────────────────── */

/** Requested additional docs still needing a (non-rejected) upload from the customer.
 *  A request that maps to a standard slot we already collect (e.g. UAE Visa) is
 *  fulfilled by that standard upload, not a duplicate `additional_*` file. */
export function pendingAdditionalDocs(r: JourneyInput): number {
  if (!r.requestedAdditionalDocs.length) return 0;
  const ok = new Set(r.myDocs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey));
  return r.requestedAdditionalDocs.filter(name => {
    const std = resolveRequestedDocKey(name);
    return std ? !isDocKeySatisfied(std, ok) : !ok.has(additionalDocKey(name));
  }).length;
}

/**
 * Map current backend state (contract + lead.stage + viewing + docs + payment plan)
 * to one of the 8 customer-visible steps (plus cross-cutting states).
 *
 * Order matters: termination wins over active, renewal-pending wins over the
 * child contract's own state, terminated/rejected dead-ends short-circuit
 * everything else.
 *
 * `pending`-status contracts are treated as "no contract yet" so the customer
 * still sees Steps 1–3 instead of Step 4. The contract object is only consulted
 * once the RP has actually issued it.
 */
export function deriveStateKey(r: JourneyInput): CustomerStateKey {
  const c = r.contract?.status === 'pending' ? null : r.contract;
  const rc = r.renewalContract;
  const viewing = r.viewing;
  const stage = r.stage;

  // ── 0. Lifecycle dead-ends that override everything below
  //   (docs/CONTRACT_LIFECYCLE.md §3.2 + §4.3).
  //
  // A new-lease draft whose unit was leased to another customer before it
  // could activate is marked contractActive=false. We dead-end the journey
  // here so the customer is steered back to /listings instead of staring at
  // a half-finished step they can't complete.
  if (
    r.contract &&
    r.contract.contractActive === false &&
    r.contract.contractType !== 'renewal' &&
    (r.contract.status === 'pending' || r.contract.status === 'issued')
  ) {
    return 'superseded';
  }

  // ── 1. Renewal proposal status on the original contract wins over child state.
  if (c?.renewalAccepted === 'pending') return 'renewal_offered';
  if (c?.renewalAccepted === 'rejected') {
    // Declined to VACATE → move-out wind-down on the still-active lease (handled
    // by ActiveAction, which shows the move-out inspection + deposit settlement).
    // Declined to NEGOTIATE → dead-end until the provider re-proposes.
    if (c?.vacateAtEnd && c?.status === 'active') return 'active';
    if (c?.vacateAtEnd && c?.status === 'expired') return 'terminated';
    return 'renewal_rejected';
  }

  // ── 2. Renewal child in flight — only consulted AFTER customer accepted.
  if (rc) {
    if (rc.status === 'terminated') return 'renewal_rejected';
    if (rc.status === 'active') return 'renewal_active';
    if (rc.ejariStatus === 'registered') return 'renewal_ejari';
    if (rc.status === 'issued') {
      // Renewal setup order MATCHES the RP renewal pipeline (Operations kanban):
      //   Terms → Documents (expired KYC) → Cheques/PDC → Signatures → Ejari → Active.
      // 1. Expired KYC: re-upload the expired docs; the RP must accept them before
      //    cheques unlock. Gate on the DURABLE renewalDocsRequiredAt (snapshotted at
      //    accept-time) — the live expiredKycDocKeys empties the instant the customer
      //    re-uploads, which would otherwise skip the RP-review step. Stay here until
      //    the RP has accepted (renewalDocsAcceptedAt).
      if (rc.renewalDocsRequiredAt && !rc.renewalDocsAcceptedAt) return 'renewal_documents';
      // 2. Cheques/PDC BEFORE signing: the customer uploads + submits, the RP
      //    confirms collection (pdcConfirmed) before signature unlocks.
      // Handed over but not yet collected → a waiting screen, exactly as the
      // new-lease flow splits payment_review from awaiting_rp_confirm. Without
      // the split the step still read "Prepare each one against the renewal
      // schedule below, then confirm" over a screen with no schedule and
      // nothing left to confirm.
      if (rc.tenantChequesSubmittedAt && !rc.pdcConfirmed) return 'renewal_cheques_review';
      if (!rc.pdcConfirmed) return 'renewal_cheques';
      // 3. Signatures: advance to Ejari only once BOTH have signed — the customer
      //    signs and the RP countersigns. While the customer has signed but the RP
      //    hasn't, SignatureAction shows a "waiting for your landlord" state, so the
      //    customer is never asked to sign twice.
      if (!(rc.tenantSignedAt && rc.landlordSignedAt)) return 'renewal_progress';
      // 4. Both signed → Awaiting Ejari (RP uploads it → auto-activates).
      return 'renewal_ejari';
    }
    return 'renewal_cheques';
  }

  // ── 3. Original contract drives Steps 4–8.
  if (c) {
    if (c.status === 'terminated') return 'terminated';

    const t = c.termination;
    if (t?.response === 'pending') {
      if (t.requestedByRole === 'rental_provider') return 'termination_request_received';
      if (t.requestedByRole === 'tenant') return 'termination_request_sent';
    }
    // Deferred-end termination (docs/CONTRACT_LIFECYCLE.md §4.3): both
    // parties have agreed, contract stays ACTIVE until effective date.
    if (t?.response === 'accepted' && c.status === 'active') return 'terminating';

    if (c.status === 'active') return 'active';

    // The utility step only clears once the RP has VERIFIED the submission.
    // A bare `submitted` holds the customer on a review-waiting screen rather
    // than advancing to move-in.
    const utilityVerified = c.utilityStatus === 'verified';
    const utilitySubmitted = c.utilityStatus === 'submitted';

    // THE ORDER IS SIGNATURES → UTILITY → MOVE-IN → REGISTRATION → ACTIVE.
    //
    // Registration is the LAST gate — it is what makes the tenancy legally live
    // — so it can no longer be the PRECONDITION of the two steps before it.
    // While it was, the utility step opened at almost the same moment
    // registration activated the lease, and the `status === 'active'` branch
    // above returns first, so in the common case the customer never saw the step
    // at all. It shows: the customer-side utility submit has zero audit rows
    // while the landlord-side verify has eight.
    //
    // Mirrors the server gate in contracts.service.submitUtility exactly, so the
    // customer is never shown a form that would 400.
    const bothSigned = !!c.tenantSignedAt && !!c.landlordSignedAt;
    const utilityOpen = bothSigned || c.ejariStatus === 'registered';

    if (!utilityOpen) return 'signature';
    if (!utilityVerified) return utilitySubmitted ? 'utility_review' : 'utility';

    // Move-in covers both halves of the inspection flow — waiting for the
    // landlord to submit AND awaiting the customer's signature. MoveInAction
    // decides the sub-UI from `inspectionSubmitted` + `inspectionSignedByTenant`.
    if (!c.moveInInspection?.signedByTenant) return 'move_in';

    // Signed. Registration is the only gate left before the lease goes live —
    // so `ejari` (the "we are registering it" wait) belongs on the NOT-yet-
    // registered arm. Once it IS registered the customer is waiting on the
    // counter-signature, which is `move_in_review`.
    return c.ejariStatus === 'registered' ? 'move_in_review' : 'ejari';
  }

  // ── 4. Dead-end states (no contract yet).
  // Attribute the decline to the right party. A customer who tapped
  // "Not interested" is the ONLY actor that sets viewing.outcome =
  // 'not_interested' (leads.service markNotInterested), so it must be
  // checked BEFORE the generic stage==='rejected' branch — that same
  // customer action also flips lead.stage to 'rejected', which would
  // otherwise mislabel their own decline as a provider decline.
  if (viewing?.outcome === 'not_interested') return 'withdrawn';
  if (stage === 'rejected') return 'rejected';
  if (viewing?.status === 'no_show' || viewing?.status === 'cancelled') return 'rejected';

  // ── 4b. Additional-docs gate. If the RP requested extra documents that aren't
  // yet on file, roll the customer back to the Documents step — even if a payment
  // plan was shared or cheques submitted — until every requested doc is uploaded.
  // Clears automatically (→ resumes payment/cheques below) once all are on file.
  if (pendingAdditionalDocs(r) > 0) return 'docs_required';

  // ── 4c. Rejected-doc gate. When the RP rejects ANY document (KYC, supporting,
  // optional or additional) the customer must go back to the upload step to
  // replace it — even past "submitted"/payment. `allRequiredDocsUploaded` only
  // covers required KYC, so a rejected supporting/optional doc would otherwise
  // leave them stuck on "Your documents are with our team". A rejection is
  // "unresolved" until a NON-rejected file exists under the same key (i.e. they
  // re-uploaded), at which point the gate clears and normal resolution resumes.
  {
    const okDocKeys = new Set(r.myDocs.filter(d => d.status !== 'missing' && d.status !== 'rejected').map(d => d.documentKey));
    if (r.myDocs.some(d => d.status === 'rejected' && !okDocKeys.has(d.documentKey))) return 'docs_required';
  }

  // ── 5. Steps 1–3 (pre-contract). Order matters here.

  // 5a. Cheques flow always wins — once the customer has submitted them,
  // they're past Steps 1 and 2 by definition.
  if (stage === 'cheques_submitted' || stage === 'cheques_collected') return 'awaiting_rp_confirm';

  // 5b. Once the customer expresses interest, check docs FIRST. The
  // backend auto-generates a payment plan on express-interest, so
  // `r.paymentPlan` is truthy from the moment they confirm — but we
  // still owe a manual admin/RP review before unlocking Step 3.
  //
  //   docs missing       → docs_required
  //   docs uploaded      → docs_under_review (admin/RP review gate)
  //   stage `payment_plan_shared` / approved / converted
  //                      → payment_review (review complete, unlocked)
  //
  // The RP/admin issues the payment plan via /leads/:id/issue-payment-plan
  // (or marks the lead approved) which flips lead.stage. On the next
  // customer refresh we drop into the `payment_plan_shared` branch
  // below and Step 3 unlocks.
  if (stage === 'interested') {
    return (r.allRequiredDocsUploaded && r.docsSubmitted) ? 'docs_under_review' : 'docs_required';
  }

  // 5c. Documents-collection stage (legacy path before the 'interested'
  // stage existed) — same gate as above.
  if (stage === 'documents_collection') {
    return (r.allRequiredDocsUploaded && r.docsSubmitted) ? 'docs_under_review' : 'docs_required';
  }

  // 5d-i. Documents approved but the plan is NOT shared yet — the RP is still
  // reviewing/editing the payment plan (two-step flow). Keep the customer on the
  // "under review" waiting state; the plan must not appear until it's shared.
  if (stage === 'approved') return 'docs_under_review';

  // 5d. Plan shared — the RP has explicitly shared the plan. Customer unlocks
  // Step 3 (`payment_review`) with the cheque schedule + contract preview.
  if (stage === 'payment_plan_shared' || stage === 'converted') return 'payment_review';

  // 5e. Stale auto-generated plan with no stage transition — we still
  // hold the customer at docs_under_review until RP/admin signals
  // approval explicitly. Avoids the previous bug where the auto-plan
  // alone teleported the customer past the review gate.
  if (r.paymentPlan && r.allRequiredDocsUploaded && r.docsSubmitted) return 'docs_under_review';
  if (r.paymentPlan) return 'docs_required';

  // ── 6. Step 1 — booked. Customer hasn't expressed Interest yet (or hasn't
  // attended the viewing). The Booked card carries the "I'm Interested" CTA.
  return 'booked';
}

/* ── Presentation helpers shared by the list + detail surfaces ─────────────── */

/** Total stops in the journey this state belongs to — 8 for a new lease, 6 for
 *  a renewal. Dead-end states have no position, so they report 0. */
export function journeyTotalSteps(key: CustomerStateKey): number {
  const def = CUSTOMER_STATE_DEFS[key];
  if (def.currentIndex < 0) return 0;
  return def.mode === 'renewal' ? 6 : 8;
}

/** "Step 2 of 8" / "Renewal step 3 of 6" / "" for dead-ends. Read off the same
 *  `currentIndex` the detail page's timeline uses, so the number on the card and
 *  the highlighted stop on the timeline are always the same stop. */
export function journeyStepLabel(key: CustomerStateKey): string {
  const def = CUSTOMER_STATE_DEFS[key];
  const total = journeyTotalSteps(key);
  if (!total) return '';
  return `${def.mode === 'renewal' ? 'Renewal step' : 'Step'} ${def.currentIndex + 1} of ${total}`;
}
