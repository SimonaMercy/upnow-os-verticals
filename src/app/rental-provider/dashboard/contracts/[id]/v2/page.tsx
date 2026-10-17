/**
 * Lease detail — Operations › Long-term leases (Genspark OS layout).
 *
 * One component, ContractV2View, in three views: 'record' (this route's default
 * export, also re-exported by /dashboard/manager/contracts/[id]/v2 and embedded by
 * the Leases Monthly/Yearly reports), 'full' (Operations › /operations/[id], manager
 * Operations via re-export) and 'pipeline'. Exports + props unchanged.
 *
 * Split: every former in-file component now lives VERBATIM under ./_sections/
 * (shared types/helpers, quest = step bodies, details = payments/deposit/documents/
 * notes/emails/WhatsApp/breaches ledger, signing, modals, record = figure helpers,
 * styles = legacy CSS). New kit parts: ./_sections/leaseOs.tsx.
 * Layout: PageHead → ScopeStrip → Callouts → Kpis → pipeline Card (kit Timeline, the
 * selected step's actions inside it) → details (Seg tabs on the record) + kit rail.
 *
 * Parity with previous page:
 *  Data (unchanged, same order/abort):
 *  - [x] GET /api/contracts/:id · GET /api/contracts/:id/signatures · fetchPaymentRefs(:id)
 *  - [x] GET /api/contracts/:id/inspection?type=move_in; when winding down, GET …/inspection?type=move_out
 *        + GET …/settlement on the lease (or the parent of an archived vacate child)
 *  - [x] GET/POST /api/contracts/:id/notes (notes journal)
 *  Header actions (same conditions + manager permission gates):
 *  - [x] Back (onBack ?? router.back) · Edit → …/edit[?rp=] (full view, not terminated, not editLocked,
 *        canManageAgreements for managers) · Preview + PDF → …/print (target _blank, hidden financeOnly)
 *  - [x] Send to customer (unsent renewal draft child → preview modal of the parent)
 *  - [x] Record view: Work on this lease → Operations[?rp=] · Propose renewal → ops?action=renew ·
 *        Terminate → ops?action=terminate · Cancel renewal / Reset to setup (modal) · Restore lease
 *        (POST …/termination/cancel)
 *  - [x] Full view: Propose renewal (modal) · Terminate directly (modal) · Cancel renewal / Reset to
 *        setup (modal) · Cancel termination (POST …/termination/cancel)
 *  - [x] ?action=renew / ?action=terminate deep links open the modal; closing drops `action`
 *  Banners (now Callouts): renewal-notice delivery (RenewalNoticeDelivery + resend), lease-ends-in-N
 *        days nudge (+ Propose renewal / "Renewal under way"), vacating (Go to move-out), needs
 *        activation (PATCH …/activate), ended/overdue close-out (Terminate directly), steps-need-
 *        attention chips (jump to step) / all-complete.            [x]
 *  Pipeline: STEPS_NEW (6) or STEPS_RENEWAL (4) — separate branch, never merged — plus move-out /
 *        closeout / settlement while winding down; done flags from deriveState/isDone; auto-focus
 *        of the first open step; click a step to open it. Dead-ends (superseded / declined renewal /
 *        cancelled renewal) render their panel alone.                [x]
 *  Step actions (stepContent, verbatim) — PATCH …/issue, …/revert, …/activate, …/ejari
 *        (Upload & activate — see below), …/ejari/reset (Redo registration), …/utility/mark-on-file,
 *        …/utility/verify, utility reject modal (…/utility/reject), …/sign/mark-on-file,
 *        …/cheques/mark-on-file, POST …/cheques/read, cheque attach/tag/remove (documents
 *        PATCH/DELETE + payment documentId), …/confirm-pdc, …/renewal/accept-docs, renewal draft
 *        send (preview modal) / DELETE …/renewal/draft, POST …/settlement/unsend, termination
 *        respond (PATCH …/termination/respond + optional note), move-in/move-out/closeout doc
 *        uploads, inspection + settlement links (?from=), signing audit trail.     [x]
 *  - [x] Send links (POST /api/portal/generate): customer signing / move-in / move-out / settlement,
 *        landlord link (sendLandlordLink), inspector links (inspections); inline landlord sign
 *        (POST …/sign) and move-in counter-sign (…/inspection/sign) — same perms
 *  Details (DetailsDrawer, verbatim; record = tabbed, now a kit Seg fed by the same tab list):
 *  - [x] Deposit add/edit/status (POST/PATCH …/deposits[/:id]) · payments record/edit/status/cancel
 *        reason/replacement (POST/PATCH …/payments[/:id]) · custody hand-over / return-to-customer
 *        (landlord or /api/manager/payments/*?rp=) · receipts · clauses (PATCH …/clauses)
 *  - [x] Documents: upload (KYC → customer owner / tenancy → contract owner, replace-in-place,
 *        landlord-link visibility, expiry), request (POST /documents/request), approve
 *        (POST /documents/:id/verify [+expiry]), reject (kit Modal → POST /documents/:id/reject),
 *        delete (canDeleteDocuments), addendums
 *  - [x] Notes, Emails (canReadEmails), WhatsApp (flag + canReadWhatsapp), Breaches (canManageLegal)
 *  - [x] financeOnly manager record: payments + deposit only, no links / contact / documents / pipeline
 *  Modals (unchanged components): Sign, Terminate (request), Direct terminate, Cancel lease,
 *        Renewal propose, Reject utility, Renewal notice preview. Hidden pickers + scanner +
 *        upload overlay kept.                                       [x]
 *  Summary (was boarding pass / summary strip / right rail; same figures via passFigures +
 *        collectedOf): KPIs annual rent, cheques cleared/instalments (+ Payment schedule), outstanding
 *        (red > 0; overdue / next due jump to payments), deposit held, days to expiry; rail: term,
 *        parties (customer link, email/call), payment summary, property & unit links.   [x]
 *  Added: ScopeStrip (status, lease type + parent link, Contract registration (Ejari) status,
 *        outstanding, documents); read-only pipeline strip on the record; error view retry.
 *  Changed to match AGENTS.md (owner decision):
 *  - Ejari one-click chain, new-lease AND renewal Ejari step: a single "Upload & activate"
 *        (file picker) runs upload-url → PUT → POST /documents, then PATCH …/ejari
 *        { ejariStatus: 'registered' }, then — only if not already active — PATCH …/activate.
 *        Upload/register failure stops with an inline Callout; an activate refusal keeps the
 *        registration, reloads and shows "Ejari registered. Activation didn't complete: <msg>"
 *        with Activate now. The manual "Mark as already on file" (…/ejari/mark-registered) is
 *        gone. Redo (…/ejari/reset) also drops the old ejari_* doc rows locally before reload.
 *  - Renewal branch is 4 steps: Terms agreed → Signatures → Contract Registration renewal →
 *        Renewal active. The former Documents and Cheques / PDC steps are sub-sections
 *        "1a Renewal documents" / "1b Cheques & PDC" of Terms agreed (same components and
 *        actions), and Terms agreed is done only when the offer is accepted AND both are done.
 *        Customer-side renewal journey unchanged.
 *  Not kept: the decorative SVG quest map + "you are here" box (replaced by the Timeline).
 */
'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { requestedDocKey } from '@/lib/requestableDocs';
import type { DocSection } from '@/lib/documentCatalogue';
import { ArrowLeft, Key, ChevronRight, Clock, ListChecks, RotateCcw, X, AlertCircle, Check, Eye, Download, Pencil } from 'lucide-react';
import { fileNameOfDoc, type ChequeIntake } from '@/lib/planAttach';
import { fetchPaymentRefs, EMPTY_PAYMENT_REFS, type PaymentRefs } from '@/lib/paymentRefs';
import { tenantDisplayName } from '@/lib/tenantName';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { useWhatsappEnabled } from '@/lib/useWhatsappEnabled';
import { useAuth } from '@/contexts/AuthContext';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';
import { unitHref as unitWorkspaceHref } from '@/lib/unitHref';
import RenewalNoticePreviewModal from '@/components/contract/RenewalNoticePreviewModal';
import RenewalNoticeDelivery from '@/components/contract/RenewalNoticeDelivery';
import { OsPage, PageHead, ScopeStrip, Card, Kpis, Kpi, Pill, Btn, Seg, Callout, Timeline, Modal, Field, humanize } from '@/components/os/kit';
import { DetailsDrawer, SendTenantLinkButton, leaseRecordTabs } from './_sections/details';
import { CancelLeaseModal, DirectTerminateModal, RejectUtilityModal, RenewalProposeModal, TerminateModal } from './_sections/modals';
import { stepContent } from './_sections/quest';
import { KIT_TONE, LeaseOsStyle, LeaseRail, StepExtra, StepStrip, depositHeld, leaseFigures } from './_sections/leaseOs';
import { ActorPerms, CLOSEOUT_STEP, ContractDetail, ContractNote, ContractPayment, CustodyHandler, DerivedState, DocReplaceTarget, DrawerTab, MOVE_OUT_STEP, MoveInInsp, SETTLEMENT_STEP, STEPS_RENEWAL, StepContent, StepHandlers, StepKey, deriveState, fmtAed, fmtDate, hasRenewalInFlight, isDone, isRenewalChild, stepsNewFor } from './_sections/shared';
import { InlineInspectionCounterSign, InlineLandlordSign, SignModal } from './_sections/signing';
import { GlobalStyle } from './_sections/styles';


/**
 * The contract detail component, rendered in one of three VIEWS:
 *   - 'full'     — the legacy whole page (default; unchanged behaviour).
 *   - 'pipeline' — the setup workflow only (stepper + step actions + modals).
 *                  Mounted INLINE inside the Operations worklist card.
 *   - 'record'   — the read-only contract record: header, summary, Payments,
 *                  Documents. This is what the standalone contract page shows.
 * `contractId` lets it be mounted outside its own route (e.g. in Operations);
 * it falls back to the route param on its own page.
 */
export function ContractV2View({ contractId: cidProp, view = 'full', onBack }: {
  contractId?: number; view?: 'full' | 'pipeline' | 'record';
  /** Where the header's back button goes when the view is embedded (e.g. inside
   *  the Leases - Monthly report). Omitted → browser back, as on its own route. */
  onBack?: () => void;
}) {
  const params = useParams<{ id: string }>();
  const id = cidProp != null ? String(cidProp) : params?.id;
  const router = useRouter();
  // Context-aware navigation base: this page is reused by the manager route
  // (/dashboard/manager/contracts/[id]) via re-export. When loaded there, all
  // internal contract links must stay within the manager area instead of the
  // landlord (rental-provider) area. Backend endpoints are already role-aware.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Camera captures pass through the scan modal (auto-crop + clean-up) BEFORE
  // each picker's uploading flag flips — that flag raises a fullscreen
  // "Uploading…" overlay which would otherwise cover the scanner.
  const { scan, scannerModal } = useDocumentScanner();
  const isManagerView = pathname.startsWith('/dashboard/manager');
  const contractsBase = pathname.startsWith('/dashboard/manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts';
  // Preserve the origin: sub-pages (settlement / inspection) read `from` so their
  // Back button returns to wherever we are now — the Operations pipeline detail
  // when opened from there, otherwise the lease record. (Fixes "back always goes
  // to the lease" when a record is worked from Operations.)
  const fromQ = `from=${encodeURIComponent(pathname)}`;
  // Manager permission gate for the Edit affordance — RP owners always see it,
  // managers only when they hold canManageAgreements for this contract's landlord.
  const { canForRp: managerCanForRp } = useManagerPermissions();
  // FINANCE-ONLY record (owner, 23 Sep 2026: the accountant "should not be able
  // to see documents or anything — just payments, security deposit, customer
  // name and tenancy details, no navigation to different pages"). A manager
  // who holds no lease authority for this landlord gets the record view with
  // every link out of it removed: no pipeline, no action row, no property /
  // unit / customer links, and the drawer reduced to payments + deposit.
  const rpParam = searchParams.get('rp') ?? '';
  const financeOnly = isManagerView && rpParam !== '' && !managerCanForRp('canManageAgreements', Number(rpParam));
  const showPipeline = view !== 'record' && !financeOnly;
  const showRecord = view !== 'pipeline';
  const waOn = useWhatsappEnabled();
  const { user: authUser } = useAuth();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [signatures, setSignatures] = useState<{ role: string; signedAt?: string; method?: string }[]>([]);
  const [paymentRefs, setPaymentRefs] = useState<PaymentRefs>(EMPTY_PAYMENT_REFS);
  const [notes, setNotes] = useState<ContractNote[]>([]);
  // Optional comment the RP types when accepting / rejecting a customer's
  // termination request — logged to the Notes journal alongside the decision.
  const [respComment, setRespComment] = useState('');
  const [moveInInsp, setMoveInInsp] = useState<MoveInInsp | null>(null);
  const [moveOutInsp, setMoveOutInsp] = useState<MoveInInsp | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<DerivedState['settlementStatus']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<StepKey | null>(null);
  // Record page tabs — remembered per viewer (a convenience, never required).
  const [recTab, setRecTabState] = useState<DrawerTab>(() => {
    if (typeof window === 'undefined') return 'payments';
    try {
      const t = window.localStorage.getItem('upnow.leaseRecord.tab') as DrawerTab | null;
      return t && ['payments', 'documents', 'notes', 'emails', 'whatsapp', 'breaches'].includes(t) ? t : 'payments';
    } catch { return 'payments'; }
  });
  const setRecTab = (t: DrawerTab) => { setRecTabState(t); try { window.localStorage.setItem('upnow.leaseRecord.tab', t); } catch { /* ignore */ } };
  const [modal, setModal] = useState<'sign' | 'terminate' | 'renew' | 'direct-terminate' | 'cancel-lease' | 'reject-utility' | null>(null);

  // Deep-link from the Leases (record) view: ?action=renew / ?action=terminate
  // jumps here into the full Operations view and opens that action directly, so
  // the lease's "Propose renewal" / "Terminate" buttons land on the live flow.
  const actionOpenedRef = useRef(false);
  useEffect(() => {
    if (view === 'record' || !contract || actionOpenedRef.current) return;
    const action = searchParams.get('action');
    if (action === 'renew') { actionOpenedRef.current = true; setModal('renew'); }
    else if (action === 'terminate') { actionOpenedRef.current = true; setModal('direct-terminate'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract]);
  // Closing a deep-linked modal (?action=renew / ?action=terminate) must also drop
  // `action` from the URL — otherwise a refresh or back-nav re-opens it every time.
  const closeDeepLinkedModal = useCallback(() => {
    setModal(null);
    if (!searchParams.get('action')) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('action');
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}`, { scroll: false });
  }, [searchParams, pathname, router]);
  // Ejari / utility upload (ported from the old page so v2 is self-contained).
  const ejariInputRef = useRef<HTMLInputElement>(null);
  const utilityInputRef = useRef<HTMLInputElement>(null);
  // Renewal Cheques/PDC step — RP uploads the Payment Advice on the customer's
  // behalf (paper-collected cheques, no portal submission).
  const chequesInputRef = useRef<HTMLInputElement>(null);
  // Wind-down doc uploads (move-out report + utility close-out). One shared
  // hidden input + a "pending kind" so a single onChange routes to the right key.
  const windDownInputRef = useRef<HTMLInputElement>(null);
  const [windDownKind, setWindDownKind] = useState<'move_in' | 'move_out' | 'clearance' | 'final_bill' | null>(null);
  const [ejariUploading, setEjariUploading] = useState(false);
  // Outcome of the Ejari upload → register → activate chain, shown as an inline
  // Callout. 'error' = the upload or the registration failed (chain stopped);
  // 'activation' = registered fine, but the activate call was refused.
  const [ejariNotice, setEjariNotice] = useState<{ kind: 'error' | 'activation'; msg: string } | null>(null);
  const [utilityUploading, setUtilityUploading] = useState(false);
  const [chequesUploading, setChequesUploading] = useState(false);
  // Renewal cheques: what the server's read-and-place step came back with
  // (declared up here, before the loading return, as every hook must be).
  const [chequeIntake, setChequeIntake] = useState<ChequeIntake | null>(null);
  const [chequeReading, setChequeReading] = useState(false);
  const [windDownUploading, setWindDownUploading] = useState(false);

  const reload = useCallback(() => {
    if (!id) return;
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/contracts/${id}`, { credentials: 'include', signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json() as Promise<ContractDetail>;
      }),
      fetch(`/api/contracts/${id}/signatures`, { credentials: 'include', signal: ctrl.signal }).then(r =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([data, sigs]) => {
        // For a company tenant the lease party is the entity, so surface the
        // company name as the displayed tenant name (every label on this page
        // reads contract.tenant.name). entityType/companyName are kept intact.
        const normalized: ContractDetail = data?.tenant
          ? { ...data, tenant: { ...data.tenant, name: tenantDisplayName(data.tenant) } }
          : data;
        setContract(normalized);
        setSignatures(Array.isArray(sigs) ? sigs : []);
        // RP reconciliation refs — plan number + per-payment receipt numbers.
        fetchPaymentRefs(id, ctrl.signal).then(setPaymentRefs).catch(() => { /* non-fatal */ });
        fetch(`/api/contracts/${id}/inspection?type=move_in`, { credentials: 'include', signal: ctrl.signal })
          .then(r => (r.ok ? r.json() : null))
          .then((insp: MoveInInsp | null) => setMoveInInsp(insp ?? null))
          .catch(() => null);
        // Load the move-out inspection + settlement once the lease is winding
        // down — either an accepted early termination, or the customer declined
        // the renewal to vacate (move-out at the scheduled lease end).
        const winding = (data.termination?.response === 'accepted' && data.status === 'active')
          || !!data.vacateAtEnd
          || data.termination?.method === 'direct';
        // The wind-down (move-out inspection + deposit settlement) lives on the
        // ACTIVE lease. When the RP opened the archived renewal proposal whose
        // parent is vacating, pull the status from the parent so the declined
        // renewal can show "declined → move-out → settlement" in one place.
        const isArchivedVacateChild = !!data.vacateAtEnd
          && data.contractActive === false && !!data.parentContractId;
        const windDownId = isArchivedVacateChild ? data.parentContractId : id;
        if (winding) {
          fetch(`/api/contracts/${windDownId}/inspection?type=move_out`, { credentials: 'include', signal: ctrl.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((insp: MoveInInsp | null) => setMoveOutInsp(insp ?? null))
            .catch(() => null);
          fetch(`/api/contracts/${windDownId}/settlement`, { credentials: 'include', signal: ctrl.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((s: { status?: DerivedState['settlementStatus']; exists?: boolean } | null) =>
              setSettlementStatus(s && s.exists ? (s.status ?? null) : null))
            .catch(() => null);
        } else {
          setMoveOutInsp(null);
          setSettlementStatus(null);
        }
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  // Tenancy notes log — loaded independently of the main contract fetch so the
  // journal renders even if a sub-fetch hiccups.
  const loadNotes = useCallback(() => {
    if (!id) return;
    fetch(`/api/contracts/${id}/notes`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: ContractNote[]) => setNotes(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
  }, [id]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const onAddNote = async (body: string) => {
    const res = await fetch(`/api/contracts/${id}/notes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? 'Failed to save note');
    const created = await res.json() as ContractNote;
    setNotes(prev => [created, ...prev]);
  };

  const derived = useMemo(
    () => contract ? deriveState(contract, signatures, moveInInsp, moveOutInsp, settlementStatus) : null,
    [contract, signatures, moveInInsp, moveOutInsp, settlementStatus],
  );

  // Reject-document dialog state. Declared HERE, above the loading/error returns
  // below — every hook has to run on every render, and a first paint that returns
  // early at "Loading contract…" would otherwise skip these four and change the
  // hook order on the next render. The handlers that use them are plain functions
  // and can stay down with the other action callbacks.
  const [rejectTarget, setRejectTarget] = useState<{ id: number; label: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  // Parent lease whose renewal notice is being reviewed before sending; null = closed.
  const [renewalPreviewFor, setRenewalPreviewFor] = useState<number | null>(null);
  // When a renewal notice was last sent from this page — the delivery line
  // reloads and waits for that send's record.
  const [noticeSentAt, setNoticeSentAt] = useState<number | null>(null);

  // Loading / error
  if (loading && !contract) {
    return (
      <OsPage className="lease-os">
        <PageHead eyebrow="Operations › Long-term leases" title="Loading lease…" />
        <Card pad>
          <div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
            {[70, 45, 60, 35].map(w => <div key={w} className="gx-skel" style={{ height: 12, width: `${w}%` }} />)}
          </div>
        </Card>
      </OsPage>
    );
  }
  if (error || !contract || !derived) {
    return (
      <OsPage className="lease-os">
        <PageHead
          eyebrow="Operations › Long-term leases"
          title="Contract not found"
          actions={<>
            <Btn onClick={() => router.back()}><ArrowLeft size={13} /> Go back</Btn>
            <Btn variant="primary" onClick={() => { setError(null); void reload(); }}>Try again</Btn>
          </>}
        />
        <Callout tone="bad" title="This lease could not be shown.">{error ?? 'No data'}</Callout>
      </OsPage>
    );
  }

  const mode: 'new' | 'renewal' = contract.contractType === 'renewal' ? 'renewal' : 'new';
  // Wind-down (Phase 6c): surface the actionable move-out inspection + deposit
  // settlement steps when the lease is ending — either an accepted early
  // termination (still active), or the customer declined the renewal to vacate
  // (move-out at the scheduled lease end). `vacateAtEnd` carries through expiry.
  // The move-out + settlement STEPS belong to the live lease being wound down.
  // The archived renewal proposal mirrors `vacateAtEnd` (from its parent) only so
  // its detail can show the declined-renewal summary — it must NOT render empty
  // wind-down steps, so gate the steps on the contract still being active.
  // A direct termination keeps the wind-down visible while active AND after it
  // closes to terminated (the lease only flips terminated once settlement is paid).
  // So does any lease that has ENDED after the customer gave notice — a mutual
  // termination closed by the effective-date cron, or a declined renewal that
  // expired. Its move-out and settlement may still be owed, and the Operations
  // board keeps its card until the settlement is paid (backend
  // ENDED_AWAITING_SETTLEMENT_SQL) — the card must open onto those steps. Unit
  // 302 (CID-167), 3 Oct 2026. A called-off renewal term never ran: no steps.
  const isWinding = (contract.termination?.response === 'accepted' && contract.status === 'active')
    || (!!contract.vacateAtEnd && contract.contractActive !== false)
    || contract.termination?.method === 'direct'
    || ((contract.status === 'terminated' || contract.status === 'expired')
      && (contract.termination?.response === 'accepted' || !!contract.vacateAtEnd)
      && contract.termination?.method !== 'cancelled');
  // New-lease rail in the lease's own words (residential / commercial / industrial / land).
  const baseSteps = mode === 'renewal' ? STEPS_RENEWAL : stepsNewFor(contract.unit?.type, contract.property?.spaceCategory, contract.property?.emirate);
  const steps = isWinding ? [...baseSteps, MOVE_OUT_STEP, CLOSEOUT_STEP, SETTLEMENT_STEP] : baseSteps;
  const doneArr = steps.map(s => isDone(s.key, derived));
  const firstTodo = doneArr.findIndex(x => !x);
  let autoIdx = firstTodo >= 0 ? firstTodo : steps.length - 1;
  // For a winding-down lease the setup steps are historical (the lease already
  // activated) — focus the RP on the live wind-down work (move-out → settlement),
  // not a setup step that might read incomplete. Default to the first unfinished
  // wind-down step (move-out, else closeout / settlement).
  if (isWinding) {
    const moveOutIdx = steps.findIndex(s => s.key === 'moveout');
    if (moveOutIdx >= 0) {
      const windDownTodo = steps.findIndex((s, i) => i >= moveOutIdx && !doneArr[i]);
      autoIdx = windDownTodo >= 0 ? windDownTodo : moveOutIdx;
    }
  }
  const selIdx = selKey ? Math.max(0, steps.findIndex(s => s.key === selKey)) : autoIdx;
  const selStep = steps[selIdx];

  // Lifecycle dead-ends — only the ARCHIVED renewal proposal row is a dead-end.
  // An active lease whose own renewal was declined (incl. decline-to-vacate) is
  // NOT a dead-end: it keeps running to its end and shows the move-out wind-down.
  const isDeclinedRenewal = contract.contractType === 'renewal'
    && contract.renewalAccepted === 'rejected'
    && contract.contractActive === false;
  const isSuperseded = contract.contractType !== 'renewal' && !contract.contractActive && (contract.status === 'pending' || contract.status === 'issued');
  // The RP cancelled this renewal before it started — the next term is void and
  // the parent lease keeps running. Another dead-end row: no setup work left.
  const isCancelledRenewal = isRenewalChild(contract)
    && contract.status === 'terminated'
    && contract.termination?.method === 'cancelled';

  // Actions
  const setLocalState = (patch: Partial<DerivedState>) => {
    if (!contract || !derived) return;
    // Local-only override — useful for "mark as already on file" before
    // the server round-trip lands.
    const merged: DerivedState = { ...derived, ...patch };
    if (patch.tenantSigned !== undefined) {
      setSignatures(p => {
        if (patch.tenantSigned && !p.some(s => s.role === 'tenant')) return [...p, { role: 'tenant' }];
        if (!patch.tenantSigned) return p.filter(s => s.role !== 'tenant');
        return p;
      });
    }
    if (patch.landlordSigned !== undefined) {
      setSignatures(p => {
        if (patch.landlordSigned && !p.some(s => s.role === 'landlord')) return [...p, { role: 'landlord' }];
        if (!patch.landlordSigned) return p.filter(s => s.role !== 'landlord');
        return p;
      });
    }
    if (patch.moveIn) {
      setMoveInInsp(p => ({
        ...p,
        rpSubmittedAt: patch.moveIn!.rpSubmitted ? (p?.rpSubmittedAt ?? new Date().toISOString()) : null,
        tenantSig:     patch.moveIn!.tenantSig    ? (p?.tenantSig    ?? 'data:image/png;base64,…') : null,
        rpCounterSig:  patch.moveIn!.rpCounterSig ? (p?.rpCounterSig ?? 'data:image/png;base64,…') : null,
      }));
    }
    if (patch.status || patch.ejariStatus || patch.utilityDoc !== undefined) {
      setContract(c => c ? { ...c, ...(patch.status ? { status: patch.status } : {}), ...(patch.ejariStatus ? { ejariStatus: patch.ejariStatus } : {}), ...(patch.utilityDoc !== undefined ? { utilityStatus: patch.utilityDoc ? 'submitted' : null } : {}) } : c);
    }
    void merged;
  };

  const patchContract = (patch: Partial<ContractDetail>) => setContract(c => c ? { ...c, ...patch } : c);

  const onActivate = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/activate`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Activate failed'); }
  };
  const onIssue = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/issue`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Issue failed: ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Issue failed'); }
  };
  const onRevertToDraft = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/revert`, { method: 'PATCH', credentials: 'include' });
      if (res.ok) void reload();
      else setLocalState({ status: 'pending' });
    } catch { setLocalState({ status: 'pending' }); }
  };

  // Send the saved renewal draft to the customer (notifies them) or discard it.
  const onRenewalDraft = async (action: 'send' | 'discard') => {
    // Sending is not undoable from this side, so it goes through the preview +
    // consent gate rather than straight to the API. The modal owns the PATCH.
    if (action === 'send') { setRenewalPreviewFor(contract.id); return; }
    if (!window.confirm('Discard this renewal draft? Its planned cheques will be voided.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/renewal/draft`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        window.alert(body?.message ?? `Could not ${action} the renewal (${res.status}).`);
        return;
      }
      void reload();
    } catch {
      window.alert(`Could not ${action} the renewal.`);
    }
  };

  // Send an unsent renewal DRAFT to the customer directly from the draft (child)
  // contract page. The send endpoint lives on the PARENT lease that owns the proposal.
  const onSendRenewalDraft = () => {
    // Viewed from the draft CHILD, but the renewal — and so the preview and the
    // send — belong to the parent lease that owns the proposal.
    const pid = contract.parentContractId;
    if (!pid) return;
    setRenewalPreviewFor(pid);
  };
  // Undo "settlement sent": pull the settlement back to draft so the figures can
  // be corrected and re-sent. Backend rejects once the customer has agreed/paid.
  const onUnsendSettlement = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/settlement/unsend`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not undo the settlement.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };

  // Undo a termination — reverts the lease to active (only while it hasn't
  // closed out). Any move-out / settlement draft started so far is kept but no
  // longer applies.
  const onCancelTermination = async () => {
    if (!window.confirm('Cancel this termination and return the lease to active? The move-out / settlement is no longer required.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not cancel the termination.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };

  // Undo a pre-active CANCELLATION — rolls the lease back to its previous state
  // (issued + active, cheques reinstated). Same endpoint as a termination undo;
  // the backend detects method='cancelled' and restores instead of reactivating.
  const onRestoreCancelled = async () => {
    if (!window.confirm('Restore this cancelled lease? It returns to its issued state and its cheques are reinstated.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/cancel`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b?.message ?? 'Could not restore the lease.');
        return;
      }
      void reload();
    } catch { alert('Unexpected error. Please try again.'); }
  };
  // Upload a file to GCS/local via presigned URL, then record the document row.
  async function uploadContractDoc(
    file: File,
    displayName: string,
    keyPrefix: string,
    opts?: { ownerType?: 'tenancy_contract' | 'customer'; ownerId?: number; category?: string; fixedKey?: boolean },
  ) {
    if (!contract) return;
    // `fixedKey` keeps the documentKey stable so the backend UPSERTs the same
    // row (one live doc per owner+key) — used when replacing a doc the customer
    // also reads (e.g. their utility proof), instead of stacking timestamped copies.
    const docKey = opts?.fixedKey ? keyPrefix : `${keyPrefix}_${Date.now()}`;
    const ownerType = opts?.ownerType ?? 'tenancy_contract';
    const ownerId = opts?.ownerId ?? contract.id;
    const category = opts?.category ?? 'property';
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) throw new Error('Failed to get upload URL');
    // fileKey MUST be persisted as s3Key — the bucket is private and the
    // backend can only re-sign View URLs for rows that carry their key.
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error('File upload failed');
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, category, documentKey: docKey, displayName, fileUrl, mimeType: file.type || 'application/octet-stream', s3Key: fileKey, isVisibleToTenant: true }),
    });
    if (!docRes.ok) throw new Error('Failed to record document');
    return (await docRes.json().catch(() => null)) as { id?: number } | null;
  }

  const onUploadEjari = () => ejariInputRef.current?.click();
  // Ejari one-click chain (AGENTS.md "Ejari upload → activate chain"):
  //   (a) upload-url → PUT → POST /api/documents   (uploadContractDoc, unchanged)
  //   (b) PATCH /api/contracts/:id/ejari { ejariStatus: 'registered' }
  //   (c) PATCH /api/contracts/:id/activate — only when not already active.
  // (a)/(b) failing stops the chain and shows the error. (c) failing does NOT roll
  // back (a)/(b): the contract is refreshed and a Callout explains, with the
  // existing Activate action still offered.
  const onEjariFilePicked = async (file: File) => {
    const scanned = await scan(file);
    if (!scanned) { if (ejariInputRef.current) ejariInputRef.current.value = ''; return; }
    file = scanned;
    setEjariUploading(true);
    setEjariNotice(null);
    const serverMsg = async (res: Response, fallback: string) => {
      const b = await res.json().catch(() => null) as { message?: string | string[] } | null;
      const m = Array.isArray(b?.message) ? b!.message.join(', ') : b?.message;
      return m || `${fallback} (${res.status})`;
    };
    try {
      // (a) the certificate
      try {
        await uploadContractDoc(file, 'Contract Registration Certificate', 'ejari_certificate');
      } catch (e) {
        setEjariNotice({ kind: 'error', msg: e instanceof Error ? e.message : 'Contract Registration Certificate upload failed' });
        return;
      }
      // (b) register Ejari once the certificate is on file
      const regRes = await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      }).catch(() => null);
      if (!regRes || !regRes.ok) {
        setEjariNotice({ kind: 'error', msg: regRes ? await serverMsg(regRes, 'Registering the contract failed') : 'Registering the contract failed' });
        void reload();
        return;
      }
      // (c) activate — skipped when the lease is already live.
      if (contract.status !== 'active') {
        const actRes = await fetch(`/api/contracts/${contract.id}/activate`, { method: 'PATCH', credentials: 'include' }).catch(() => null);
        if (!actRes || !actRes.ok) {
          setEjariNotice({ kind: 'activation', msg: actRes ? await serverMsg(actRes, 'Activate failed') : 'Activate failed' });
        }
      }
      void reload();
    } finally { setEjariUploading(false); if (ejariInputRef.current) ejariInputRef.current.value = ''; }
  };
  const onUploadUtility = () => utilityInputRef.current?.click();
  const onUtilityFilePicked = async (file: File) => {
    const scanned = await scan(file);
    if (!scanned) { if (utilityInputRef.current) utilityInputRef.current.value = ''; return; }
    file = scanned;
    setUtilityUploading(true);
    try {
      // Write the SAME document the customer reads (their utility_proof_of_payment)
      // so an RP-uploaded replacement is reflected on both sides, not stored under
      // a separate contract-owned key the customer never sees. Falls back to a
      // contract-owned doc only if the tenant profile id is somehow missing.
      const tenantProfileId = contract.tenant.id;
      if (tenantProfileId != null) {
        await uploadContractDoc(file, 'Utility Proof of Payment', 'utility_proof_of_payment',
          { ownerType: 'customer', ownerId: tenantProfileId, category: 'payment', fixedKey: true });
      } else {
        await uploadContractDoc(file, 'Utility Registration', 'utility_registration');
      }
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Utility upload failed'); }
    finally { setUtilityUploading(false); if (utilityInputRef.current) utilityInputRef.current.value = ''; }
  };
  const onMarkUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark utility failed: ${res.status}`);
      void reload();
    } catch { setLocalState({ utilityDoc: true }); }
  };
  // Renewal Cheques/PDC step — RP either uploads the Payment Advice on the
  // customer's behalf, or, once it's already attached, marks the cheques as
  // already on file (paper-collected) so the wait for a portal submission is
  // skipped and the step opens straight into the recording table.
  const onUploadCheques = () => chequesInputRef.current?.click();
  const onChequesFilePicked = async (file: File) => {
    const scanned = await scan(file);
    if (!scanned) { if (chequesInputRef.current) chequesInputRef.current.value = ''; return; }
    file = scanned;
    setChequesUploading(true);
    try {
      await uploadContractDoc(file, 'Payment Confirmation', 'payment_advice');
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Payment Confirmation upload failed'); }
    finally { setChequesUploading(false); if (chequesInputRef.current) chequesInputRef.current.value = ''; }
  };
  /** The rent payment a `Rent — <instalment>` slot stands for, so the file also
   *  lands on the row's cheque-image link (payments.document_id) and the
   *  Payments card shows it after activation. Fee groups are one slot for
   *  several rows and stay on the tag alone. */
  const rentRowForSlot = (slotLabel: string): ContractPayment | undefined => {
    const m = slotLabel.match(/^Rent — (.+)$/);
    if (!m) return undefined;
    return (contract?.payments ?? []).find(p => (p.paymentType ?? '') === 'rental_income' && (p.description ?? '') === m[1]);
  };
  // Renewal cheques: the server reads each file, places every cheque on the
  // payment it pays and fills an empty cheque number — this asks for that.
  const onReadCheques = async (retryDocumentId?: number) => {
    if (!contract || (contract.contractType ?? '').toLowerCase() !== 'renewal') return;
    setChequeReading(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cheques/read`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retryDocumentId: retryDocumentId ?? null }),
      });
      setChequeIntake(res.ok ? await res.json() as ChequeIntake : { files: [], open: [], ready: false });
      if (res.ok) await reload();
    } catch { setChequeIntake({ files: [], open: [], ready: false }); }
    finally { setChequeReading(false); }
  };
  const onAttachChequeForSlot = async (slotLabel: string, files: FileList | null, replaceIds?: number[]) => {
    if (!files || files.length === 0) return;
    const ready: File[] = [];
    for (const picked of Array.from(files)) { const scanned = await scan(picked); if (scanned) ready.push(scanned); }
    if (ready.length === 0) return;
    setChequesUploading(true);
    try {
      for (const f of ready) {
        const doc = await uploadContractDoc(f, slotLabel ? `${slotLabel} · ${f.name}` : f.name, 'payment_advice', { category: 'payment' });
        const row = rentRowForSlot(slotLabel);
        if (doc?.id && row) await onUpdatePayment(row.id, { documentId: doc.id });
      }
      for (const id of replaceIds ?? []) {
        await fetch(`/api/documents/${id}`, { method: 'DELETE', credentials: 'include' });
      }
      await reload();
      await onReadCheques();
    } catch (e) { alert(e instanceof Error ? e.message : 'Cheque upload failed'); }
    finally { setChequesUploading(false); }
  };
  const onRemoveChequeDoc = async (docId: number) => {
    const res = await fetch(`/api/documents/${docId}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Could not remove the file (${res.status})`); }
    const row = (contract?.payments ?? []).find(p => p.documentId === docId);
    if (row) await onUpdatePayment(row.id, { documentId: null });
    await reload();
    await onReadCheques();
  };
  const onTagChequeDoc = async (docId: number, slotLabel: string) => {
    const doc = (contract?.documents ?? []).find(d => d.id === docId);
    const file = doc ? fileNameOfDoc(doc.displayName) || 'cheque' : 'cheque';
    const res = await fetch(`/api/documents/${docId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: `${slotLabel} · ${file}` }) });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Could not tag the file (${res.status})`); }
    const row = rentRowForSlot(slotLabel);
    if (row) await onUpdatePayment(row.id, { documentId: docId });
    await reload();
  };
  const onMarkChequesOnFile = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/cheques/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark cheques failed: ${res.status}`);
      const data = await res.json().catch(() => ({ matched: true }));
      if (data.matched === false) {
        alert('No Payment Confirmation is on file for this lease yet. Please upload the cheques first.');
        return;
      }
      void reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not mark the cheques as already on file.');
    }
  };
  // Bypass digital signing for a paper-signed / imported lease: record BOTH
  // signatures as on-file (no signature image). Mirrors the Ejari/Utility
  // "Mark as already on file" actions; the step re-renders into the
  // "Signed on paper — on file" panel after reload.
  const onMarkSignedOnFile = async () => {
    if (!window.confirm('Mark this lease as signed on paper (already on file)? This records both signatures as on-file — use it for imported or physically-signed leases, not for contracts still awaiting a digital signature.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/sign/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark signed-on-file failed: ${res.status}`);
      void reload();
    } catch (e) {
      // Optimistic fallback so the step reflects the intent before the next
      // reload; the on-file panel only confirms once the server round-trip lands.
      setLocalState({ tenantSigned: true, landlordSigned: true });
      void e;
    }
  };

  // ── Escape-hatch document uploads (move-in / move-out report + utility
  // close-out) ── These stand in for a full inspection/workflow when clearing
  // the backlog on an imported or active lease, so they do NOT gate on lock /
  // readOnlyWorkflow. A single hidden input is reused; `windDownKind` routes the
  // picked file to the right doc key.
  const pickWindDownDoc = (kind: 'move_in' | 'move_out' | 'clearance' | 'final_bill') => {
    setWindDownKind(kind);
    windDownInputRef.current?.click();
  };
  const onUploadMoveInDoc = () => pickWindDownDoc('move_in');
  const onUploadMoveOutDoc = () => pickWindDownDoc('move_out');
  const onUploadCloseoutClearance = () => pickWindDownDoc('clearance');
  const onUploadCloseoutFinalBill = () => pickWindDownDoc('final_bill');
  const onWindDownFilePicked = async (file: File, kind: 'move_in' | 'move_out' | 'clearance' | 'final_bill') => {
    const spec = {
      move_in:    { name: 'Move-in report',      key: 'move_in_report' },
      move_out:   { name: 'Move-out report',     key: 'move_out_report' },
      clearance:  { name: 'Utility Clearance',   key: 'utility_clearance' },
      final_bill: { name: 'Utility Final Bill',  key: 'utility_final_bill' },
    }[kind];
    const scanned = await scan(file);
    if (!scanned) { if (windDownInputRef.current) windDownInputRef.current.value = ''; return; }
    file = scanned;
    setWindDownUploading(true);
    try {
      await uploadContractDoc(file, spec.name, spec.key);
      // Guide the RP to the next step after each upload: the move-in document
      // completes Stop 5 (the lease is already active — just reload in place);
      // the move-out document advances to the utility closeout; once both
      // closeout docs are in, advance to the settlement.
      if (kind === 'move_out') {
        setSelKey('closeout');
      } else if (kind === 'clearance' && derived?.closeout.finalBill) {
        setSelKey('settlement');
      } else if (kind === 'final_bill' && derived?.closeout.clearance) {
        setSelKey('settlement');
      }
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setWindDownUploading(false); setWindDownKind(null); if (windDownInputRef.current) windDownInputRef.current.value = ''; }
  };
  const onVerifyUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/verify`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Confirm utility failed: ${res.status}`);
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not confirm utility'); }
  };
  const onRejectUtility = () => setModal('reject-utility');

  // KYC approve / reject — use the dedicated verify/reject endpoints. A PATCH
  // with a `status` field is rejected by the API's whitelist validation (it's
  // not on UpdateDocumentDto) and silently does nothing, so this drawer's
  // approve/reject previously never persisted. Reject captures a reason that the
  // customer sees as their re-upload prompt (mirrors the leads page).
  const onApproveDoc = (id: number) => {
    fetch(`/api/documents/${id}/verify`, { method: 'POST', credentials: 'include' })
      .then(r => { if (r.ok) void reload(); }).catch(() => {});
  };
  // Same endpoint, but the RP also records the expiry printed on the document. Expiry is
  // captured RP-side at review time — /documents/:id/verify is role-guarded, so the date
  // can only ever be set by someone who reviewed the copy.
  const onApproveDocWithExpiry = async (id: number, expiryDate: string) => {
    const res = await fetch(`/api/documents/${id}/verify`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryDate }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    await reload();
  };
  // Reject opens the app's own dialog, not window.prompt(). The native prompt was
  // unstyled browser chrome in the middle of a designed page, it cannot say WHICH
  // document is being rejected, its Cancel returns null and looked identical to a
  // silent failure, and a rejection is the one action here the customer actually
  // reads — the reason becomes their re-upload instruction, so it deserves a real
  // field. Mirrors the reject dialog on the lead documents step. (Its state is
  // declared above the loading/error returns — see the Rules-of-Hooks note there.)
  const onRejectDoc = (id: number, label?: string) => {
    setRejectReason(''); setRejectErr(null);
    setRejectTarget({ id, label: label?.trim() || 'this document' });
  };
  const confirmRejectDoc = async () => {
    if (!rejectTarget) return;
    setRejectBusy(true); setRejectErr(null);
    try {
      const res = await fetch(`/api/documents/${rejectTarget.id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({} as { message?: string }));
        throw new Error((b as { message?: string }).message ?? `Could not reject (${res.status})`);
      }
      setRejectTarget(null);
      await reload();
    } catch (e) {
      // Surfaced in the dialog instead of vanishing — the old handler swallowed
      // every failure, so a reject that never landed looked exactly like one that did.
      setRejectErr(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setRejectBusy(false);
    }
  };

  // ── Flow 1: record payment + update status ──
  // POST /api/contracts/:id/payments  (mirrors old page addPaymentInstalment)
  const onRecordPayment = async (body: {
    description?: string; amount: number; vatAmount?: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string; chequeStatus?: string;
    /** The cheque on this contract that this payment makes good — one that
     *  bounced, or one the customer swapped. */
    replacesPaymentId?: number | null;
    /** Raise the bounce / replacement charge in the same request. */
    replacementFee?: number;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    const created = await res.json().catch(() => null) as { id?: number } | null;
    void reload();
    return created?.id;
  };
  // PATCH /api/contracts/:id/payments/:paymentId — status, or correct amount / VAT / reference / description.
  /** Custody (0323 / 0324) — the same two routes the Payments page uses,
   *  landlord's own or scoped to the manager's landlord. */
  const onCustody: CustodyHandler = async (paymentIds, action, extra) => {
    const mgrQ = isManagerView ? `?rp=${searchParams.get('rp') ?? ''}` : '';
    const isReturn = action === 'returned' || action === 'undo_return';
    const url = isManagerView
      ? `/api/manager/payments/${isReturn ? 'return-to-customer' : 'hand-over'}${mgrQ}`
      : `/api/contracts/payments/${isReturn ? 'return-to-customer' : 'hand-over'}`;
    const body = isReturn
      ? { paymentIds, returned: action === 'returned', reason: extra?.reason, note: extra?.note, documentId: extra?.documentId }
      : { paymentIds, handedOver: action === 'submit' };
    const res = await fetch(url, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  const onUpdatePayment = async (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; vatAmount?: number; chequeNumber?: string | null; bankName?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string; paymentType?: string;
    documentId?: number | null; replacesPaymentId?: number | null;
    /** Why a cheque is being cancelled (migration 0245). */
    cancellationReason?: string | null;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments/${paymentId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };
  // DELETE /api/contracts/:id/payments/:paymentId — remove a fee / payment line.
  const onDeletePayment = async (paymentId: number) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments/${paymentId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // Edit a held security deposit — PATCH /api/contracts/:id/deposits/:depositId
  const onUpdateDeposit = async (depositId: number, patch: {
    chequeStatus?: string; paymentMethod?: string | null; dueDate?: string | null;
    chequeNumber?: string | null; amount?: number; depositStatus?: string;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/deposits/${depositId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // Record a deposit on a lease that never had one. Until this existed the
  // register could only be added to by the June import, so a deposit collected
  // outside the lead payment plan had nowhere to go — the landlord's own tracker
  // lists one (Unit 315, AED 5,000) that the system has never held.
  const onCreateDeposit = async (body: {
    amount: number; chequeNumber?: string | null; paymentMethod?: string | null;
    dueDate?: string | null; chequeStatus?: string;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/deposits`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };

  // ── Flow 2: edit clauses ──  PATCH /api/contracts/:id/clauses
  const onSaveClauses = async (customClauses: string[], notes: string | null) => {
    const res = await fetch(`/api/contracts/${contract.id}/clauses`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customClauses, notes }),
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  // ── Flow 3: confirm PDCs ──  PATCH /api/contracts/:id/confirm-pdc
  const onConfirmPdc = async () => {
    const res = await fetch(`/api/contracts/${contract.id}/confirm-pdc`, {
      method: 'PATCH', credentials: 'include',
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  const onAcceptDocs = async () => {
    const res = await fetch(`/api/contracts/${contract.id}/renewal/accept-docs`, {
      method: 'PATCH', credentials: 'include',
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    void reload();
  };

  // ── Flow 4: Ejari reset / redo ──  PATCH /api/contracts/:id/ejari/reset
  const onRedoEjari = async () => {
    if (!confirm('Roll the tenancy back to issued and clear the existing Contract Registration? You will then be able to upload a corrected certificate.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/reset`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      // Back to issued / pending, and drop the old certificate rows from local
      // state so the Upload & activate UI reappears at once; reload() then
      // brings the authoritative record.
      setEjariNotice(null);
      patchContract({
        status: 'issued', ejariStatus: 'pending',
        documents: (contract.documents ?? []).filter(d => !(d.documentKey ?? '').startsWith('ejari')),
      });
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to reset Contract Registration'); }
  };

  // ── Flow 5: upload KYC / contract document ──
  // upload-url → PUT → POST /api/documents.
  //
  // The RP's chosen SECTION decides the owner, because the section is where the
  // document lives rather than how it is labelled:
  //   kyc     → owner_type 'customer'         — travels with the customer, so it
  //             shows on their profile and in every lease binder of theirs
  //   tenancy → owner_type 'tenancy_contract' — this lease only
  // Either way the contract detail API returns both owner scopes, so a KYC
  // upload made here still appears on this page.
  const onUploadDoc = async (
    file: File,
    meta: { key: string; label: string; category: string; section: DocSection },
    visibleToTenant: boolean,
    expiryDate: string,
    replaceOf?: DocReplaceTarget,
    // undefined = no choice made: the row keeps NULL (new) or its current
    // setting (replacement) and the default rule decides what the binder shows.
    visibleOnLandlordLink?: boolean,
  ) => {
    const asKyc = meta.section === 'kyc';
    if (asKyc && !replaceOf && !contract.tenant.id) {
      throw new Error('This contract has no linked customer, so the document cannot be filed as customer KYC.');
    }
    // A replacement is posted under the row it supersedes — its OWN owner and
    // key — so POST /documents' same-key upsert overwrites that row (id kept:
    // payments.document_id / audit rows still point at it) instead of adding a
    // fresh `${key}_${Date.now()}` row beside it. Anything else is a new file.
    const ownerType = replaceOf?.ownerType ?? (asKyc ? 'customer' : 'tenancy_contract');
    const ownerId = replaceOf?.ownerId ?? (asKyc ? contract.tenant.id! : contract.id);
    const docKey = replaceOf?.documentKey ?? `${meta.key}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) {
      const b = await urlRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${urlRes.status}`));
    }
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    const docBody: Record<string, unknown> = {
      ownerType, ownerId, category: meta.category, section: meta.section,
      documentKey: docKey, displayName: meta.label, fileUrl,
      // s3Key lets the backend re-sign View URLs (private bucket)
      s3Key: fileKey,
      mimeType: file.type || 'application/octet-stream', isVisibleToTenant: visibleToTenant,
    };
    if (visibleOnLandlordLink !== undefined) docBody.visibleOnLandlordLink = visibleOnLandlordLink;
    if (expiryDate) docBody.expiryDate = expiryDate;
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(docBody),
    });
    if (!docRes.ok) {
      const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${docRes.status}`));
    }
    const createdDoc = await docRes.json().catch(() => null) as { id?: number } | null;
    void reload();
    return createdDoc?.id;
  };

  // ── Flow 6: request a document from the tenant ──  POST /api/documents/request
  const onRequestDoc = async (label: string, notes: string) => {
    if (!contract.tenant.id) throw new Error('This contract has no linked customer.');
    // Ask under the CATALOGUE's key for this document, so the request lands on
    // the same checklist row the matching upload would. Slugifying the label
    // instead — which is what this did — meant requesting "Contract
    // Registration Certificate" wrote `contract_registration_certificate` while
    // uploading it wrote `ejari_certificate`: identical wording on screen, two
    // unrelated rows in the database. Off-catalogue names still get their
    // deterministic `additional_*` key.
    // The `_<timestamp>` suffix is kept: it is how a re-request creates a fresh
    // row rather than colliding with the existing one, and every reader strips
    // it (matchDocs' baseKey) before comparing.
    const docKey = `${requestedDocKey(label)}_${Date.now()}`;
    const res = await fetch('/api/documents/request', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerType: 'customer',
        ownerId: contract.tenant.id,
        documentKey: docKey,
        displayName: label,
        category: 'contract',
        notes: notes || undefined,
      }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${res.status}`));
    }
    void reload();
  };

  // Termination response
  const respondToTermination = async (response: 'accepted' | 'rejected') => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/respond`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, comment: respComment.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Respond failed: ${res.status}`);
      setRespComment('');
      void reload();
      loadNotes();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Respond failed'); }
  };

  // Once the tenancy reaches a TERMINAL lifecycle (expired / terminated) the
  // workflow steps freeze — no "Revert to draft", no "Re-upload" on Ejari /
  // Utility, no undo toggles on the Sign step: an ended lease's activation
  // history must not be rewritten after the fact.
  //
  // An ACTIVE lease is deliberately NOT frozen: imported / synced leases are
  // routinely activated with setup steps still incomplete (the "Needs
  // activation" banner explicitly promises you can backfill documents and
  // cheques afterwards), so the RP must still be able to clear that backlog —
  // register Ejari, confirm utility, upload the move-in document, and correct
  // signatures on a live lease. The Documents drawer (KYC approve/reject) and
  // the active step's live-management actions (record payment, propose renewal,
  // request termination) were already always editable.
  const readOnlyWorkflow = contract.status === 'expired' || contract.status === 'terminated';

  // Term-edit lock. Once any party has really signed (method 'online' / 'paper'),
  // the executed agreement is read-only — the Edit affordance is hidden and the
  // backend PATCH /contracts/:id rejects the change. Imported / paper leases
  // recorded only as "signed on file" stay editable for data correction.
  // (Optimistic local sig entries carry no method → treated as not-yet-locking;
  // a real sign triggers reload(), which brings the authoritative method.)
  const editLocked = signatures.some(s => s.method != null && s.method !== 'on_file');

  // Manager permission gates — RP owners always see every affordance; a manager
  // only sees one they hold the relevant flag for, for THIS contract's landlord.
  // Mirrors the Edit gate's exact mechanism (isManagerView + managerCanForRp +
  // the rp scope from ?rp= falling back to the contract's landlord id). The
  // backend already 403s a manager who lacks the flag — this just hides the
  // button so they never see an action they can't take.
  // `?rp=` arrives EMPTY (not absent) when the manager is on "All landlords", so
  // fall back on falsy — `??` would keep the empty string and gate every action off.
  const rpScope = searchParams.get('rp') || (contract.landlord?.id != null ? String(contract.landlord.id) : '');
  const mgrCan = (flag: Parameters<typeof managerCanForRp>[0]) =>
    !isManagerView || (rpScope !== '' && managerCanForRp(flag, Number(rpScope)));
  const perms: ActorPerms = {
    renewals:      mgrCan('canManageRenewals'),
    agreements:    mgrCan('canManageAgreements'),
    // "Sign as Landlord" needs POA in addition to signing rights (a manager may
    // only sign the landlord's signature with power of attorney).
    signLandlord:  mgrCan('canSignDocuments') && mgrCan('canActAsPoa'),
    // Sending the owner their signing link only invites them to sign themselves,
    // so it needs agreement management — not signing rights or POA. A manager who
    // can't sign can still send the owner the link.
    sendLandlordLink: mgrCan('canManageAgreements'),
    signDocuments: mgrCan('canSignDocuments'),
    // Inspection counter-sign = inspection-management, not contract signing.
    inspections:   mgrCan('canManageInspections'),
    // Deposit edit: either deposits OR collections permission.
    deposits:      mgrCan('canManageDeposits') || mgrCan('canManageCollections'),
    // Final-settlement sign-off (send / mark-paid / unsend) → canSettleDeposits.
    settleDeposits: mgrCan('canSettleDeposits'),
    // Record/edit payment + clear-cheque: the backend accepts the granular
    // carve-out flags OR the umbrella, so surface the buttons for any of them.
    collections:   mgrCan('canManageCollections') || mgrCan('canRecordPayments') || mgrCan('canClearCheques'),
    // Head office is the landlord's choice (0326): a manager sees it only when
    // granted; the landlord's own page keeps the cheque series without it.
    headOffice:    isManagerView && rpScope !== '' && managerCanForRp('canHandOverCheques', Number(rpScope)),
    // Deliberately NOT or-ed with anything. Deleting is its own grant, so a
    // manager who can upload documents does not thereby get the delete control.
    deleteDocuments: mgrCan('canDeleteDocuments'),
  };

  // Landlord-signature identity for the signing block. Three cases, all stamped
  // to match by the backend:
  //  1. A manager signing → their own name "on behalf of {landlord}" (POA act).
  //  2. Else, if the landlord (RP) has a Power of Attorney holder on file → the
  //     POA holder's name "on behalf of {landlord}". This is why an owner-path
  //     signature is attributed to the attorney, not the landlord directly.
  //  3. Otherwise the landlord signs directly, with no on-behalf-of line.
  const landlordName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  const poaHolder = contract.landlord.hasPoa && contract.landlord.poaPersonName?.trim() ? contract.landlord.poaPersonName.trim() : null;
  const landlordSignerName = isManagerView ? (authUser?.name || 'Authorised Manager') : (poaHolder ?? landlordName);
  const landlordOnBehalfOf = isManagerView ? landlordName : (poaHolder ? landlordName : null);

  // Step content + jump-to-step handler
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of 6`;
  const handlers: StepHandlers = {
    contract, state: derived,
    onDocsChanged: () => void reload(),
    setState: setLocalState,
    openModal: setModal,
    // In the tabbed record the section may be on another tab — switch to it first.
    openDrawer: (t) => { if (view === 'record') setRecTab(t); setTimeout(() => document.getElementById('sec-' + t)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); },
    patchContract,
    onActivate, onIssue, onUploadEjari, onUploadUtility, onMarkUtility, onMarkSignedOnFile, onVerifyUtility, onRejectUtility, onConfirmPdc, onUploadCheques, onAttachChequeForSlot, onRemoveChequeDoc, onTagChequeDoc, onMarkChequesOnFile, chequeIntake, chequeReading, onReadCheques, onAcceptDocs, onApproveDoc, onRejectDoc, onApproveDocWithExpiry, onUpdatePayment, onRevertToDraft,
    onRenewalDraft,
    noticeSentAt,
    onUnsendSettlement,
    onCancelTermination,
    onUploadMoveInDoc, onUploadMoveOutDoc, onUploadCloseoutClearance, onUploadCloseoutFinalBill,
    signActionUrl: `${contractsBase}/${contract.id}`,
    inspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_in&${fromQ}`,
    moveOutInspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_out&${fromQ}`,
    settlementUrl: `${contractsBase}/${contract.id}/settlement?${fromQ}`,
    printUrl: `${contractsBase}/${contract.id}/print`,
    contractsBase,
    operationsBase: isManagerView ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations',
    perms,
    readOnlyWorkflow,
  };

  let content: StepContent;
  if (isSuperseded) {
    content = {
      tone: 'declined', icon: 'alert', sub: 'Superseded', label: 'Superseded',
      headline: 'Another customer leased this unit.',
      body: 'This draft is archived. Browse other listings to find a fresh unit for the customer.',
      timing: null,
      node: (
        <Link href={contractsBase} className="btn btn-jade">
          <ChevronRight size={14} /> Back to contracts
        </Link>
      ),
    };
  } else if (isCancelledRenewal) {
    content = {
      tone: 'declined', icon: 'alert', sub: 'Renewal cancelled', label: 'Cancelled',
      headline: 'This renewal was cancelled before it started.',
      // Reached two ways — the RP cancelled the renewal outright, OR the current
      // lease was terminated and took its un-accepted renewal with it. Don't claim
      // the current lease "keeps running": in the termination case it is winding down.
      body: 'The next term is void and its cheques were cancelled. Nothing further happens on this row — if new terms are needed, propose a fresh renewal on the current lease.',
      timing: null,
      node: contract.parentContractId ? (
        <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
          <ChevronRight size={14} /> Go to the current lease
        </Link>
      ) : null,
    };
  } else if (isDeclinedRenewal) {
    // Two flavours of decline:
    //  • vacate  → the customer is leaving; the active lease winds down to a
    //              move-out inspection + deposit settlement. Show that here so
    //              the RP sees "declined → move-out → settlement" in one place,
    //              with the actions completing on the lease (their data home).
    //  • negotiate → lease keeps running; offer to re-propose.
    const vacating = !!contract.vacateAtEnd;
    const moveOutDone = !!derived?.moveOut?.rpCounterSig;
    const settlementDone = derived?.settlementStatus === 'paid';
    const settlementLabel = settlementDone
      ? 'Settled'
      : derived?.settlementStatus ? 'In progress' : 'Pending';
    content = {
      tone: 'declined', icon: 'alert',
      sub: vacating ? 'Moving out' : 'Renewal closed',
      label: vacating ? 'Declined — vacating' : 'Renewal declined',
      headline: vacating
        ? 'The customer declined and is moving out.'
        : 'The customer declined this renewal.',
      body: vacating
        ? 'They won’t renew and will vacate at lease end. Complete the move-out inspection and deposit settlement on the active lease.'
        : 'The proposal is archived and the original lease keeps running. You can propose fresh terms anytime.',
      timing: null,
      node: (
        <>
          {contract.renewalRejectionReason && (
            <div className="qbanner action">
              <span className="bic"><X size={18} /></span>
              <div style={{ flex: 1 }}>
                <p className="bt">Reason from {contract.tenant.name ?? 'customer'}</p>
                <div className="quote">&ldquo;{contract.renewalRejectionReason}&rdquo;</div>
              </div>
            </div>
          )}
          {vacating ? (
            <>
              {/* Wind-down status — lives on the active lease, surfaced here. */}
              <div className="qbanner waiting">
                <span className="bic"><Key size={18} /></span>
                <div style={{ flex: 1 }}>
                  <p className="bt">Move-out &amp; deposit settlement</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>Move-out inspection</span>
                      <strong>{moveOutDone ? 'Completed' : 'Pending'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>Deposit settlement</span>
                      <strong>{settlementLabel}</strong>
                    </div>
                  </div>
                </div>
              </div>
              {contract.parentContractId && (
                <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
                  <Key size={15} /> Complete move-out &amp; settlement
                </Link>
              )}
            </>
          ) : contract.successorProposal ? (
            <Link href={`${contractsBase}/${contract.successorProposal.id}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
              <RotateCcw size={15} /> View new proposal · CID-{contract.successorProposal.id}
            </Link>
          ) : contract.parentContractId ? (
            <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="btn btn-jade" style={{ alignSelf: 'flex-start' }}>
              <RotateCcw size={15} /> Open original lease to re-propose
            </Link>
          ) : perms.renewals ? (
            <button className="btn btn-jade" style={{ alignSelf: 'flex-start' }} onClick={() => setModal('renew')}>
              <RotateCcw size={15} /> Propose new renewal
            </button>
          ) : null}
        </>
      ),
    };
  } else {
    content = stepContent(selStep.key, derived, handlers, mode);
    // Bind termination Accept / Reject buttons (rendered as data-action by stepContent)
    if (content.node && typeof content.node === 'object' && 'props' in content.node) {
      // Walk the node to attach onClick to data-action buttons — simpler to
      // re-render this tone-specific block ourselves when termination is pending.
      const t = contract.termination;
      if (t && t.response === 'pending' && t.requestedByRole === 'tenant') {
        content = {
          ...content,
          node: (
            <>
              <div className="qbanner action">
                <span className="bic"><AlertCircle size={18} /></span>
                <div style={{ flex: 1 }}>
                  <p className="bt">Effective {fmtDate(t.effectiveDate)}</p>
                  <p className="bp">Requested {fmtDate(t.requestedAt)}</p>
                  {t.reason && <div className="quote">&ldquo;{t.reason}&rdquo;</div>}
                </div>
              </div>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Add a note (optional)</label>
                <textarea className="input" value={respComment} placeholder="A note recorded with your decision — visible in the tenancy Notes log" onChange={e => setRespComment(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-brick" onClick={() => respondToTermination('accepted')}><Check size={14} /> Accept termination</button>
                <button className="btn btn-ghost" onClick={() => respondToTermination('rejected')}><X size={14} /> Reject</button>
              </div>
            </>
          ),
        };
      }
    }
    void stopOf;
  }

  const missingSteps = steps.filter((s, i) => s.key !== 'active' && !doneArr[i]);
  const allActive = isDone('active', derived);

  // Landlord (you) can sign once the contract is issued and not yet countersigned.
  // Mirrors the customer page, which exposes a "Sign Contract" button in its top bar
  // rather than only inside the workflow stepper.
  const canLandlordSign = contract.status === 'issued' && !derived.landlordSigned && !isSuperseded && !isDeclinedRenewal;

  // KYC docs = customer-owned IDENTITY documents in contract.documents.
  // Exclude operational customer uploads — payment advice (cheque copies) and
  // receipts/payment proofs are cleared in the Cheques step, not doc-reviewed, so
  // they must never show up here in a "Pending review" state with Approve/Reject.
  // On a RENEWAL, valid documents are already on file, so we only surface the
  // ones that are EXPIRED (they're the only profile docs that need re-collecting).
  // New contracts show the full set.
  const NON_KYC_DOC_BASES = ['payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques', 'renewal_payment_proof', 'payment_proof', 'receipt', 'payment_receipt'];
  const docBase = (k: string | null | undefined) => (k ?? '').toLowerCase().replace(/_\d{10,}$/, '');
  const allKycDocs = (contract.documents ?? []).filter(d =>
    (d.ownerType === 'customer' || d.ownerType === 'tenant') && !NON_KYC_DOC_BASES.includes(docBase(d.documentKey)));
  const kycDocs = contract.contractType === 'renewal'
    ? allKycDocs.filter(d => d.expiryDate && new Date(d.expiryDate) < new Date())
    : allKycDocs;

  // Header pill kept consistent with the contracts LIST's time-aware statuses:
  // a pending contract whose term is already RUNNING is "Needs activation"
  // (the live lease awaiting its status flip), a future-start pending term is
  // "Starts later". Without this the header shows the journey-step label and
  // contradicts what the list says about the same contract.
  const todayIso = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const startIso = (contract.startDate ?? '').slice(0, 10);
  const endIso = (contract.endDate ?? '').slice(0, 10);
  const isRunningPending = contract.status === 'pending' && !isSuperseded && !isDeclinedRenewal
    && !!startIso && startIso <= todayIso && !!endIso && endIso >= todayIso;
  const isFuturePending = contract.status === 'pending' && !isSuperseded && !isDeclinedRenewal
    && !!startIso && startIso > todayIso;
  const pill = isRunningPending
    ? { tone: 'waiting', label: 'Needs activation' }
    : isFuturePending
      ? { tone: 'waiting', label: 'Starts later' }
      : { tone: content.tone, label: content.label };

  // Deep-links to the related entities (Property → portfolio popup, Unit → unit
  // page, Customer → customer page). The manager mirror gets the same links
  // against its own landlord-scoped routes (?rp=<landlord>): it has no per-unit
  // page, so the unit opens the units workspace pre-filtered to that unit
  // number. Mirrors the lead detail page's link block exactly.
  const mgrRpQ = rpScope !== '' ? `rp=${rpScope}` : '';
  const propertyHref = !contract.property.id || financeOnly ? null
    : isManagerView ? (mgrRpQ ? `/dashboard/manager/properties?${mgrRpQ}&property=${contract.property.id}` : null)
    : `/rental-provider/dashboard/portfolio?property=${contract.property.id}`;
  // The Units workspace on THIS unit, in whichever portal is rendering. The
  // manager branch used to search by unit NUMBER, which matches every unit
  // sharing that number across buildings; the id is exact.
  const unitHref = !contract.unit.id || financeOnly ? null
    : isManagerView
      ? (rpScope !== '' ? unitWorkspaceHref(contract.unit.id, { rp: Number(rpScope) }) : null)
      : unitWorkspaceHref(contract.unit.id);
  const customerHref = !contract.tenant.id || financeOnly ? null
    : isManagerView ? (mgrRpQ ? `/dashboard/manager/tenants/${contract.tenant.id}?${mgrRpQ}` : null)
    : `/rental-provider/dashboard/tenants/${contract.tenant.id}`;

  // ── Genspark OS layout ────────────────────────────────────────────────────
  // Everything below is presentation: every condition, href, handler and modal
  // is the one the previous header / info bar / banners / quest map used.
  const deadEnd = isSuperseded || isDeclinedRenewal || isCancelledRenewal;
  const opsBase = `${isManagerView ? '/dashboard/manager/operations' : '/rental-provider/dashboard/operations'}/${contract.id}`;
  const lf = leaseFigures(contract);
  const doneCount = doneArr.filter(Boolean).length;
  const kitPillTone = KIT_TONE[pill.tone as keyof typeof KIT_TONE] ?? 'neutral';
  // The renewal entry the summary offers — the Operations deep link from the
  // record (as the old summary strip did), the modal in the full view.
  const canProposeRenewal = contract.status === 'active' && !hasRenewalInFlight(contract)
    && contract.termination?.response !== 'accepted' && perms.renewals;
  const renewHref = canProposeRenewal ? `${opsBase}?action=renew` : null;
  const renewAction = !canProposeRenewal ? null
    : showPipeline
      ? <button type="button" className="lz-kpi-act" onClick={() => setModal('renew')}>Propose renewal →</button>
      : <Link href={renewHref!} className="lz-kpi-act">Propose renewal →</Link>;
  // Jump to a section: the record switches tab first (as its summary links did);
  // the full view scrolls to the stacked section.
  const goTab = (t: DrawerTab) => {
    if (view === 'record') {
      setRecTab(t);
      requestAnimationFrame(() => document.getElementById('lz-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    (document.getElementById('sec-' + t) ?? document.getElementById('lz-details'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const recordTabs = leaseRecordTabs({
    financeOnly, notesCount: notes.length,
    emails: {
      showEmails: !isManagerView || (rpScope !== '' && managerCanForRp('canReadEmails', Number(rpScope))),
      showWhatsapp: waOn && (!isManagerView || (rpScope !== '' && managerCanForRp('canReadWhatsapp', Number(rpScope)))),
    },
    hasLegal: mgrCan('canManageLegal'), hasTenant: contract.tenant.id != null,
  });
  const dep = depositHeld(contract);

  // Header actions — the previous top bar, one for one.
  const editAction = (() => {
    if (!(showPipeline && contract.status !== 'terminated' && !editLocked)) return null;
    // `||` not `??` — "All landlords" sends an EMPTY ?rp=, not a missing one.
    const rpForEdit = searchParams.get('rp') || (contract.landlord?.id != null ? String(contract.landlord.id) : '');
    const canEdit = !isManagerView
      || (rpForEdit !== '' && managerCanForRp('canManageAgreements', Number(rpForEdit)));
    if (!canEdit) return null;
    const editHref = isManagerView && rpForEdit
      ? `${contractsBase}/${contract.id}/edit?rp=${rpForEdit}`
      : `${contractsBase}/${contract.id}/edit`;
    return <Btn href={editHref}><Pencil size={13} /> Edit</Btn>;
  })();
  const recordActions = (() => {
    if (!(!showPipeline && contract.status !== 'terminated')) return null;
    const canTerminate = (contract.status === 'active' || contract.status === 'expired')
      && contract.termination?.response !== 'accepted' && perms.agreements;
    const canCancel = (contract.status === 'pending' || contract.status === 'issued') && perms.agreements;
    return (
      <>
        {/* The full workflow lives in Operations; one click away from the record. */}
        <Btn href={`${opsBase}${isManagerView && mgrRpQ ? `?${mgrRpQ}` : ''}`} title="Open the full workflow for this lease in Operations">
          <ListChecks size={13} /> Work on this lease
        </Btn>
        {canProposeRenewal && <Btn href={`${opsBase}?action=renew`} variant="primary"><RotateCcw size={13} /> Propose renewal</Btn>}
        {canTerminate && <Btn href={`${opsBase}?action=terminate`} variant="danger"><X size={13} /> Terminate</Btn>}
        {canCancel && (
          <Btn variant="danger" onClick={() => setModal('cancel-lease')}>
            <X size={13} /> {isRenewalChild(contract) ? 'Cancel renewal' : 'Reset to setup'}
          </Btn>
        )}
      </>
    );
  })();
  const headActions = (
    <>
      <Btn onClick={() => (onBack ? onBack() : router.back())} title="Back"><ArrowLeft size={13} /> Back</Btn>
      {editAction}
      {/* The contract document itself — not for the finance-only record. */}
      {!financeOnly && (
        <>
          <Btn href={`${contractsBase}/${contract.id}/print`} target="_blank"><Eye size={13} /> Preview</Btn>
          <Btn href={`${contractsBase}/${contract.id}/print`} target="_blank"><Download size={13} /> PDF</Btn>
        </>
      )}
      {/* Unsent renewal DRAFT (child) → send it from here (via the parent that owns it). */}
      {contract.contractType === 'renewal' && !!contract.parentContractId
        && contract.renewalStatus === 'draft' && contract.renewalAccepted !== 'pending'
        && !contract.renewalChild && perms.renewals && (
        <Btn variant="primary" onClick={() => void onSendRenewalDraft()}><RotateCcw size={13} /> Send to customer</Btn>
      )}
      {recordActions}
      {/* A cancelled (pre-active void) standalone lease can be restored. */}
      {!showPipeline && contract.status === 'terminated' && !isRenewalChild(contract)
        && contract.termination?.method === 'cancelled' && perms.agreements && (
        <Btn onClick={() => void onRestoreCancelled()} title="Undo the cancellation and return this lease to its issued state">
          <RotateCcw size={13} /> Restore lease
        </Btn>
      )}
      {showPipeline && canProposeRenewal && (
        <Btn onClick={() => setModal('renew')}><RotateCcw size={13} /> Propose renewal</Btn>
      )}
      {showPipeline && (contract.status === 'active' || contract.status === 'expired')
        && contract.termination?.response !== 'accepted' && perms.agreements && (
        <Btn variant="danger" onClick={() => setModal('direct-terminate')}><X size={13} /> Terminate directly</Btn>
      )}
      {showPipeline && (contract.status === 'pending' || contract.status === 'issued') && perms.agreements && (
        <Btn variant="danger" onClick={() => setModal('cancel-lease')}>
          <X size={13} /> {isRenewalChild(contract) ? 'Cancel renewal' : 'Reset to setup'}
        </Btn>
      )}
      {showPipeline && contract.status !== 'terminated' && contract.termination?.response === 'accepted' && perms.agreements && (
        <Btn variant="danger" onClick={() => void onCancelTermination()}><RotateCcw size={13} /> Cancel termination</Btn>
      )}
    </>
  );

  // The selected step's work — what the action card on the right of the quest
  // map used to hold, now rendered inside the pipeline Timeline under its step.
  const stepPanel = (
    <div className="lz-step">
      <div className="lz-step-hd">
        <div style={{ minWidth: 0 }}>
          <div className="ey">{content.sub}</div>
          <h2>{content.headline}</h2>
        </div>
        <Pill tone={KIT_TONE[content.tone]}>{content.label}</Pill>
      </div>
      {content.body && <p className="lz-step-body">{content.body}</p>}
      <div className="quest-page lz-legacy">
        <div className="action-body">{content.node}</div>
      </div>
      {/* Customer link to upload documents + sign — Signatures / Move-in steps. */}
      {(selStep.key === 'sign' || selStep.key === 'movein') && contract.tenant.id && !readOnlyWorkflow && (
        <StepExtra title={selStep.key === 'movein' ? 'Customer move-in signing link' : 'Customer contract signing link'}>
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id}
              section={selStep.key === 'movein' ? 'move_in' : 'contract'}
              label={selStep.key === 'movein' ? 'Send move-in link' : 'Send signing link'} />
          </div>
        </StepExtra>
      )}
      {/* Landlord signing link — the lessor's counterpart (no-login sign page). */}
      {selStep.key === 'sign' && contract.tenant.id && !readOnlyWorkflow && perms.sendLandlordLink && (
        <StepExtra title="Rental provider contract signing link">
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="contract" role="landlord" label="Send landlord link" />
          </div>
        </StepExtra>
      )}
      {/* Inline landlord signature pad. */}
      {selStep.key === 'sign' && canLandlordSign && perms.signLandlord && (
        <StepExtra title="Countersign as landlord">
          <div className="quest-page lz-legacy">
            <InlineLandlordSign contract={contract} signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onSigned={() => void reload()} />
          </div>
        </StepExtra>
      )}
      {/* Move-in: on-site inspection manager link (canManageInspections). */}
      {selStep.key === 'movein' && contract.tenant.id && !readOnlyWorkflow && perms.inspections && (
        <StepExtra title="Inspection manager link">
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="move_in" role="inspector" label="Send inspector link" />
          </div>
        </StepExtra>
      )}
      {/* Inline RP counter-signature once the customer has signed the move-in inspection. */}
      {selStep.key === 'movein' && derived.moveIn.rpSubmitted && derived.moveIn.tenantSig && !derived.moveIn.rpCounterSig && perms.inspections && (
        <StepExtra title="Counter-sign the move-in inspection">
          <div className="quest-page lz-legacy">
            <InlineInspectionCounterSign contractId={contract.id} type="move_in" signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onSigned={() => void reload()} />
          </div>
        </StepExtra>
      )}
      {/* Move-out signing link — available during wind-down. */}
      {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && (
        <StepExtra title="Customer move-out signing link">
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="move_out" label="Send move-out link" />
          </div>
        </StepExtra>
      )}
      {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && perms.inspections && (
        <StepExtra title="Inspection manager link">
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="move_out" role="inspector" label="Send inspector link" />
          </div>
        </StepExtra>
      )}
      {/* Customer settlement signing link (promotes a draft settlement to sent). */}
      {selStep.key === 'settlement' && contract.tenant.id && perms.settleDeposits
        && derived.settlementStatus != null && derived.settlementStatus !== 'paid' && (
        <StepExtra title="Customer settlement signing link">
          <div className="quest-page lz-legacy">
            <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="settlement" label="Send settlement link" />
          </div>
        </StepExtra>
      )}
      {/* Redo Contract Registration — roll back to issued for a corrected certificate. */}
      {selStep.key === 'ejari' && derived.ejariStatus === 'registered' && !readOnlyWorkflow && (
        <button type="button" className="lz-redo" onClick={() => void onRedoEjari()}>
          <RotateCcw size={12} /> Redo Contract Registration (reset &amp; re-upload)
        </button>
      )}
      {content.timing && <div className="lz-timing"><Clock size={12} /> {content.timing}</div>}
    </div>
  );

  return (
    <OsPage className="lease-os">
      <PageHead
        eyebrow="Operations › Long-term leases"
        title={
          <span className="lz-title">
            {/* The ref plus the place it is about. */}
            {contract.ref || `CID-${contract.id}`} · Unit {contract.unit.number ?? '—'}
            <Pill tone={kitPillTone}>{pill.label}</Pill>
          </span>
        }
        lede={
          <span className="lz-lede">
            {customerHref
              ? <Link href={customerHref} className="lz-link" title="Open customer details">{contract.tenant.name ?? 'Customer'}</Link>
              : <span>{contract.tenant.name ?? 'Customer'}</span>}
            {!financeOnly && contract.tenant.phone && (
              <><span className="sep">·</span><a href={`tel:${contract.tenant.phone}`} className="lz-link">{contract.tenant.phone}</a></>
            )}
            <span className="sep">·</span>
            <span>{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</span>
            <span className="sep">·</span>
            {/* Chain: Property → Unit → Contract (details live on their own pages). */}
            {propertyHref
              ? <Link href={propertyHref} className="lz-link" title="Open property details">{contract.property.buildingName ?? '—'}</Link>
              : <span>{contract.property.buildingName ?? '—'}</span>}
            <ChevronRight size={11} aria-hidden style={{ opacity: .5 }} />
            {unitHref
              ? <Link href={unitHref} className="lz-link" title="Open unit details">Unit {contract.unit.number ?? '—'}</Link>
              : <span>Unit {contract.unit.number ?? '—'}</span>}
            {contract.ref && contract.ref !== `CID-${contract.id}` && (
              <><ChevronRight size={11} aria-hidden style={{ opacity: .5 }} /><span>CID-{contract.id}</span></>
            )}
            {contract.property.community && <span>· {contract.property.community}</span>}
          </span>
        }
        actions={headActions}
      />

      <ScopeStrip items={[
        { label: 'Status', value: <Pill tone={kitPillTone}>{pill.label}</Pill> },
        { label: 'Lease type', value: mode === 'renewal'
          ? <span>Renewal{contract.parentContractId ? <> of <Link href={`${contractsBase}/${contract.parentContractId}/v2`} className="lz-link">CID-{contract.parentContractId}</Link></> : null}</span>
          : 'New lease' },
        { label: 'Contract registration (Ejari)', value: <Pill tone={derived.ejariStatus === 'registered' ? 'primary' : 'amber'}>{humanize(derived.ejariStatus ?? 'pending')}</Pill> },
        { label: 'Outstanding', value: <span className={lf.outstanding > 0 ? 'lz-bad' : 'lz-ok'}>{lf.outstanding > 0 ? fmtAed(lf.outstanding) : 'Nothing outstanding'}</span> },
        ...(!financeOnly ? [{ label: 'Documents', value: <span>{lf.files} on file{lf.asks > 0 && <span className="lz-warn"> · {lf.asks} requested</span>}</span> }] : []),
      ]} />

      <div className="lz-stack">
        {/* The offered renewal draft: was its notice actually EMAILED to the customer. */}
        {contract.contractType === 'renewal' && !!contract.parentContractId && contract.renewalAccepted === 'pending' && !contract.renewalChild && (
          <div className="quest-page lz-legacy">
            <RenewalNoticeDelivery
              parentContractId={contract.parentContractId}
              refreshAfter={noticeSentAt ?? undefined}
              onResend={perms.renewals ? onSendRenewalDraft : undefined}
            />
          </div>
        )}
        {/* Renewal nudge (was the record summary's banner). */}
        {lf.ending && (
          <Callout tone="warn" title={`Lease ends in ${lf.left} days —`}>
            {fmtDate(contract.endDate)}. Send a renewal offer at least 90 days before expiry.{' '}
            {canProposeRenewal
              ? (showPipeline
                ? <Btn size="sm" variant="primary" onClick={() => setModal('renew')}>Propose renewal</Btn>
                : <Btn size="sm" variant="primary" href={renewHref!}>Propose renewal</Btn>)
              : hasRenewalInFlight(contract) && <Pill tone="primary">Renewal under way</Pill>}
          </Callout>
        )}
        {/* Vacate-on-renewal-decline — customer won't renew and is moving out. */}
        {showPipeline && contract.vacateAtEnd && (
          <Callout tone="warn" title="Customer is vacating — renewal declined.">
            {contract.tenant.name ?? 'The customer'} won’t renew and will move out
            {contract.endDate ? ` on ${fmtDate(contract.endDate)}` : ' at lease end'}. Complete the move-out inspection and deposit settlement.
            {contract.renewalRejectionReason && <> &ldquo;{contract.renewalRejectionReason}&rdquo;</>}{' '}
            <Btn size="sm" onClick={() => setSelKey('moveout')}>Go to move-out</Btn>
          </Callout>
        )}
        {/* Running-but-never-activated lease (imported / synced records). */}
        {showPipeline && isRunningPending && (
          <Callout tone="warn" title="This lease is already running — it just needs activation.">
            The term started {fmtDate(contract.startDate)} and the customer is in place, but the contract was never
            switched to Active. Activate it so it counts as a live tenancy everywhere; you can backfill documents and
            cheques afterwards.{' '}
            <Btn size="sm" variant="primary" onClick={() => void onActivate()}>Activate now</Btn>
          </Callout>
        )}
        {/* Ended / overdue lease with no close-out recorded. */}
        {showPipeline && (contract.status === 'expired' || (contract.status === 'active' && !!endIso && endIso < todayIso))
          && contract.termination?.method !== 'direct'
          && contract.termination?.response !== 'accepted'
          && !contract.vacateAtEnd
          && !contract.hasSuccessor
          && !deadEnd && (
          <Callout tone="warn" title={`${contract.status === 'expired' ? 'This lease has ended' : 'This lease is overdue'} — record the close-out if the customer has vacated.`}>
            The term ended {fmtDate(contract.endDate)}. If {contract.tenant.name ?? 'the customer'} has already moved out,
            terminate it directly to record the move-out, utility closeout and final deposit settlement. The lease stays
            active until you mark the settlement paid.{' '}
            {perms.agreements && <Btn size="sm" variant="danger" onClick={() => setModal('direct-terminate')}>Terminate directly</Btn>}
          </Callout>
        )}
        {/* Ejari upload → register → activate chain outcome. */}
        {showPipeline && ejariNotice?.kind === 'error' && (
          <Callout tone="bad" title="Contract Registration not completed —">
            {ejariNotice.msg}{' '}
            <Btn size="xs" onClick={() => setEjariNotice(null)}>Dismiss</Btn>
          </Callout>
        )}
        {showPipeline && ejariNotice?.kind === 'activation' && contract.status !== 'active' && (
          <Callout tone="warn" title="Ejari registered.">
            Activation didn&apos;t complete: {ejariNotice.msg}{' '}
            <Btn size="sm" variant="primary" onClick={() => { setEjariNotice(null); void onActivate(); }}>Activate now</Btn>
          </Callout>
        )}
        {/* Steps still open (was the missing strip). */}
        {showPipeline && !deadEnd && (missingSteps.length > 0 ? (
          <Callout tone="warn" title={`${missingSteps.length} step${missingSteps.length > 1 ? 's' : ''} need attention:`}>
            <span className="gx-btn-row" style={{ display: 'inline-flex', marginLeft: 4 }}>
              {missingSteps.map(s => (
                <Btn key={s.key} size="xs" onClick={() => setSelKey(s.key)}>{s.label} →</Btn>
              ))}
            </span>
          </Callout>
        ) : (
          <Callout>{allActive ? 'Every step complete — tenancy is fully on file.' : 'All records complete — ready to activate the tenancy.'}</Callout>
        ))}
      </div>

      <Kpis>
        <Kpi k="Annual rent" v={fmtAed(contract.annualRent)}
          d={lf.f.rentVat > 0 ? `Rent incl. VAT ${lf.f.aed(lf.f.rentGross)}` : (mode === 'renewal' ? 'Renewal term rent' : 'Before fees & deposit')} />
        <Kpi k="Cheques / instalments"
          v={<>{lf.clearedCheques}<small> of {lf.rentCheques} cleared</small></>}
          d={<>
            {lf.rentCheques > 0 ? `${lf.rentCheques} × ${fmtAed((contract.annualRent || 0) / lf.rentCheques)}` : 'No cheques recorded'}
            <br /><button type="button" className="lz-kpi-act" onClick={() => goTab('payments')}>Payment schedule →</button>
          </>} />
        <Kpi k="Outstanding"
          v={<span className={lf.outstanding > 0 ? 'lz-bad' : undefined}>{fmtAed(lf.outstanding)}</span>}
          d={<>
            Collected {fmtAed(lf.collected)} of {fmtAed(lf.f.totalPayable)} · {Math.round(lf.collPct)}%
            <br />
            {lf.overdue.length > 0
              ? <button type="button" className="lz-kpi-act bad" onClick={() => goTab('payments')}>{lf.overdue.length} overdue · {fmtAed(lf.overdueAmt)} →</button>
              : lf.next
                ? <button type="button" className="lz-kpi-act" onClick={() => goTab('payments')}>Next {fmtAed(lf.next.amount)} · {fmtDate(lf.next.transactionDate)} →</button>
                : <span>{lf.collPct >= 100 ? 'Fully collected' : `${fmtAed(lf.outstanding)} still to collect`}</span>}
          </>} />
        <Kpi k="Deposit held" v={dep.v} d={dep.d} />
        <Kpi k="Days to expiry"
          v={lf.upcoming ? <>{lf.daysToStart}<small> days to start</small></>
            : lf.left < 0 ? <>Ended<small> {-lf.left} days ago</small></>
            : <span className={lf.ending ? 'lz-warn' : undefined}>{lf.left}<small> days left</small></span>}
          d={<>
            {fmtDate(contract.startDate)} → {fmtDate(contract.endDate)} · {lf.months} mo
            {lf.ending && renewAction && <><br />{renewAction}</>}
          </>} />
      </Kpis>

      {/* The pipeline — 6-step new lease, or the SEPARATE renewal branch (never
          merged), plus the move-out wind-down steps while the lease is ending. */}
      {showPipeline && (deadEnd ? (
        <Card title={mode === 'renewal' ? 'Renewal pipeline' : 'Lease pipeline'} sub={content.sub} pad>
          {stepPanel}
        </Card>
      ) : (
        <Card
          title={mode === 'renewal' ? 'Renewal pipeline' : 'Lease pipeline'}
          sub={(mode === 'renewal' ? 'Renewal branch — tracked separately from new leases' : 'New lease — Contract issued to Active tenancy')
            + (isWinding ? ' · then move-out, utility closeout and deposit settlement' : '')}
          right={<Pill tone={doneCount === steps.length ? 'primary' : 'amber'}>{doneCount}/{steps.length} complete</Pill>}
          pad
        >
          <Timeline items={steps.map((s, i) => ({
            state: doneArr[i] ? 'done' as const : i === selIdx ? 'now' as const : undefined,
            t: (
              <button type="button" className="lz-stepbtn" aria-expanded={i === selIdx} onClick={() => setSelKey(s.key)}>
                <span className="lb">{s.label}</span>
                {doneArr[i] ? <Pill tone="primary">Done</Pill> : i === selIdx ? <Pill tone={KIT_TONE[content.tone]}>{content.label}</Pill> : <Pill tone="neutral" dot={false}>To do</Pill>}
              </button>
            ),
            s: i === selIdx ? stepPanel : (doneArr[i] ? 'Complete — open to review' : 'Open this step to work on it'),
          }))} />
        </Card>
      ))}

      {/* The record view shows where the lease is in its pipeline (read-only —
          the work happens in Operations). */}
      {!showPipeline && !financeOnly && !deadEnd && (
        <Card
          title={mode === 'renewal' ? 'Renewal pipeline' : 'Lease pipeline'}
          sub={`${doneCount}/${steps.length} complete`}
          right={contract.status !== 'terminated'
            ? <Btn size="sm" href={`${opsBase}${isManagerView && mgrRpQ ? `?${mgrRpQ}` : ''}`}>Work on this lease</Btn>
            : undefined}
          pad
        >
          <StepStrip steps={steps} doneArr={doneArr} current={autoIdx} />
        </Card>
      )}

      {/* Contract details — payments ledger + deposit, documents, notes, emails,
          WhatsApp, breaches (the existing sections, reused). The record shows one
          at a time under a Seg; the full view keeps every section stacked. */}
      {showRecord && (
        <div className="lz-grid" id="lz-details">
          <div style={{ minWidth: 0 }}>
            {view === 'record' && recordTabs.length > 1 && (
              <div className="lz-tabs" id="lz-tabs">
                <Seg label="Lease record sections" value={recTab} onChange={setRecTab}
                  options={recordTabs.map(t => ({ v: t.key, l: t.label, n: t.count ?? undefined }))} />
              </div>
            )}
            <div className={'quest-page lz-legacy' + (view === 'record' ? ' is-record' : '')}>
              <DetailsDrawer
                inline
                open
                tabbed={view === 'record'}
                tabBar={false}
                tab={view === 'record' ? recTab : 'payments'}
                setTab={view === 'record' ? setRecTab : () => undefined}
                onClose={() => undefined}
                contract={contract}
                payments={contract.payments ?? []}
                kycDocs={kycDocs}
                onApproveDoc={onApproveDoc}
                onRejectDoc={onRejectDoc}
                onDocsChanged={() => void reload()}
                onRecordPayment={onRecordPayment}
                onUpdatePayment={onUpdatePayment}
                onDeletePayment={onDeletePayment}
                onUpdateDeposit={onUpdateDeposit}
                onCreateDeposit={onCreateDeposit}
                onSaveClauses={onSaveClauses}
                editLocked={editLocked}
                onConfirmPdc={onConfirmPdc}
                onUploadDoc={onUploadDoc}
                onRequestDoc={onRequestDoc}
                notes={notes}
                onAddNote={onAddNote}
                perms={perms}
                paymentRefs={paymentRefs}
                showExtras={view !== 'record' && !financeOnly}
                financeOnly={financeOnly}
                onCustody={onCustody}
                emails={{
                  rp: isManagerView ? (rpScope !== '' ? Number(rpScope) : null) : null, isManager: isManagerView,
                  showEmails: !isManagerView || (rpScope !== '' && managerCanForRp('canReadEmails', Number(rpScope))),
                  showWhatsapp: waOn && (!isManagerView || (rpScope !== '' && managerCanForRp('canReadWhatsapp', Number(rpScope)))),
                }}
                legal={!mgrCan('canManageLegal') ? undefined : {
                  base: isManagerView ? '/manager/legal' : '/legal',
                  rp: isManagerView && rpScope !== '' ? Number(rpScope) : undefined,
                  disputeHrefOf: (id: number) => isManagerView ? `/dashboard/manager/legal/${id}${rpScope !== '' ? `?rp=${rpScope}` : ''}` : `/rental-provider/dashboard/legal/${id}`,
                }}
              />
            </div>
          </div>
          <LeaseRail contract={contract} payments={contract.payments ?? []} tenantHref={customerHref}
            propertyHref={propertyHref} unitHref={unitHref} hideContact={financeOnly} />
        </div>
      )}

      {/* Modals + hidden pickers keep the legacy scope (their own styles). */}
      <div className="quest-page lz-legacy">
        {renewalPreviewFor != null && (
          <RenewalNoticePreviewModal
            parentContractId={renewalPreviewFor}
            open
            onClose={() => setRenewalPreviewFor(null)}
            onSent={() => { setNoticeSentAt(Date.now()); void reload(); loadNotes(); }}
          />
        )}
        {modal === 'sign' && perms.signLandlord && <SignModal contract={contract} signerName={landlordSignerName} onBehalfOf={landlordOnBehalfOf} onClose={() => setModal(null)} onSigned={() => { setModal(null); void reload(); }} />}
        {modal === 'terminate' && perms.agreements && <TerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
        {modal === 'direct-terminate' && perms.agreements && <DirectTerminateModal contract={contract} onClose={closeDeepLinkedModal} onSubmitted={() => { closeDeepLinkedModal(); setSelKey('moveout'); void reload(); loadNotes(); }} />}
        {modal === 'cancel-lease' && perms.agreements && <CancelLeaseModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); loadNotes(); }} />}
        {modal === 'renew' && perms.renewals && <RenewalProposeModal contract={contract} onClose={closeDeepLinkedModal} onSubmitted={() => { closeDeepLinkedModal(); void reload(); }} />}
        {modal === 'reject-utility' && perms.agreements && <RejectUtilityModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}

        {scannerModal}
        {/* Hidden file pickers for inline Ejari / utility / cheques / wind-down uploads. */}
        <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }} aria-label="Contract Registration Certificate file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onEjariFilePicked(f); }} />
        <input ref={utilityInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} aria-label="Utility document file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUtilityFilePicked(f); }} />
        <input ref={chequesInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} aria-label="Payment Confirmation file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onChequesFilePicked(f); }} />
        <input ref={windDownInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} aria-label="Wind-down document file"
          onChange={(e) => { const f = e.target.files?.[0]; const k = windDownKind; if (f && k) void onWindDownFilePicked(f, k); }} />
      </div>
      {(ejariUploading || utilityUploading || chequesUploading || windDownUploading) && (
        <div className="lz-upload" role="status" aria-live="polite">
          <div>Uploading {ejariUploading ? 'Contract Registration' : utilityUploading ? 'utility' : chequesUploading ? 'Payment Confirmation' : 'wind-down'} document…</div>
        </div>
      )}

      {/* Reject a customer document — names the document, optional reason the
          customer reads, failures reported in the dialog. */}
      <Modal
        open={!!rejectTarget}
        onClose={() => { if (!rejectBusy) setRejectTarget(null); }}
        title="Reject document"
        width={440}
        footer={
          <>
            <Btn variant="danger" disabled={rejectBusy} onClick={() => void confirmRejectDoc()}>
              <X size={13} /> {rejectBusy ? 'Rejecting…' : 'Reject'}
            </Btn>
            <Btn disabled={rejectBusy} onClick={() => setRejectTarget(null)}>Cancel</Btn>
          </>
        }
      >
        <p style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
          Rejecting <strong>{rejectTarget?.label}</strong>. {contract.tenant.name || 'The customer'} sees it as a re-upload slot, and your reason as the instruction.
        </p>
        <Field label="Reason (optional — shown to the customer)" htmlFor="lz-reject-reason" error={rejectErr ?? undefined}>
          <textarea id="lz-reject-reason" className="gx-ta" rows={3} value={rejectReason} disabled={rejectBusy}
            onChange={e => setRejectReason(e.target.value)} placeholder="What needs fixing…" />
        </Field>
      </Modal>

      <GlobalStyle />
      <LeaseOsStyle />
    </OsPage>
  );
}

/**
 * The standalone contract page (reached from the Leases register). Renders the
 * RECORD view — header + summary + Payments + Documents, read-only. The setup
 * pipeline + workflow actions live in Operations now (which mounts this same
 * component with view="full"). The manager contract route re-exports this default.
 */
export default function ContractV2Page() {
  return <ContractV2View view="record" />;
}
