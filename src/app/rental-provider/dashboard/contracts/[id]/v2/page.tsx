/**
 * RP Contract Detail — v2 (Quest layout)
 *
 * Parallel route at /rental-provider/dashboard/contracts/[id]/v2.
 * Implements the "UpNow RP Contract v2" design with full feature parity
 * with the v1 page at /rental-provider/dashboard/contracts/[id]:
 *   - All 6 NEW-lease steps (Issue → Sign → Ejari → Utility → Move-in → Active)
 *   - All 4 RENEWAL steps (Terms → Sign → Ejari → Active)
 *   - Phase 6c lifecycle states: superseded, terminating (active+termination accepted)
 *   - Termination request flow (initiate + respond)
 *   - Renewal propose / accept / decline (+ successor proposal link)
 *   - Sign modal (canvas + typed-name fallback)
 *   - Payment recording (status + paid date + reference)
 *   - Ejari upload / mark as registered
 *   - Utility doc surfacing (RP or customer)
 *   - Move-in inspection state mirror (rpSubmitted / tenantSig / rpCounterSig)
 *   - Addendums panel (kept below detail cards per product decision)
 *
 * Data fetching matches v1 exactly so the same backend endpoints power both:
 *   GET  /api/contracts/:id
 *   GET  /api/contracts/:id/signatures
 *   GET  /api/contracts/:id/inspection?type=move_in
 *   GET  /api/documents?ownerType=customer&ownerId=:tenantId
 *
 * Styling: design tokens (jade/saffron/brick palette + r-lg/r-md radius)
 * are injected via a <style jsx global> block at the bottom of the page
 * so we don't pollute the global stylesheet.
 */
'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { REQUESTABLE_DOCS } from '@/lib/requestableDocs';
import {
  ArrowLeft, FileText, FileSignature, Stamp, Zap, Key, BadgeCheck,
  ChevronRight, ChevronDown, MapPin, Clock, Bell, Search,
  User, Building2, Calendar, DollarSign, CreditCard, Paperclip,
  ClipboardList, ListChecks, RotateCcw, X, AlertCircle, Check,
  UploadCloud, Eye, Download, ExternalLink, Pencil, ClipboardCheck, Send, Wallet,
} from 'lucide-react';
import { AddendumsPanel } from '@/components/upnow/AddendumsPanel';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ContractDoc {
  id: number;
  ownerType: string;
  ownerId: number;
  category: string;
  documentKey: string;
  displayName: string | null;
  fileUrl: string;
  status: string;
  issueDate: string | null;
  expiryDate: string | null;
  isVisibleToTenant: boolean;
}

interface ContractPayment {
  id: number;
  description: string | null;
  paymentType: string | null;
  paymentMethod: string | null;
  amount: number;            // gross (incl. rent VAT) — matches API field name
  vatAmount?: number;        // rent VAT portion of amount (0 = exempt)
  transactionDate: string | null;
  chequeStatus?: string | null;
  paidAt?: string | null;
  chequeNumber?: string | null;
}

interface MoveInInsp {
  rpSubmittedAt?: string | null;
  tenantSig?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}

interface ContractDetail {
  id: number;
  ref: string;
  contractType: 'new' | 'renewal';
  status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
  ejariStatus: string | null;
  contractActive: boolean;
  contractSent: boolean;
  pdcConfirmed: boolean;
  pdcConfirmedAt: string | null;
  tenantChequesSubmittedAt: string | null;
  utilityStatus?: string | null;
  utilityAccountNumber?: string | null;
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
  rentVatRate?: number;
  contractValue: number | null;
  securityDepositAmount: number | null;
  numberOfInstallments: number | null;
  modeOfPayment: string | null;
  adminFeeFils: number;
  ejariFeeFils: number;
  customClauses: string[];
  notes: string | null;
  createdAt: string;
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
  renewalRejectionReason?: string | null;
  /** Customer declined the renewal with intent to leave → move-out wind-down. */
  vacateAtEnd?: boolean;
  parentContractId?: number | null;
  /** Live renewal child of THIS contract (when viewing a parent) — the agreed
   *  or in-flight renewal lives in its own contract row. */
  renewalChild?: { id: number; status: string; startDate?: string | null; endDate?: string | null; annualRent?: number } | null;
  successorProposal?: {
    id: number;
    status: 'pending' | 'issued' | 'active' | 'expired' | 'terminated';
    contractActive: boolean;
    createdAt: string;
  } | null;
  termination: {
    requestedByRole: 'tenant' | 'rental_provider' | null;
    requestedAt: string | null;
    reason: string | null;
    effectiveDate: string | null;
    response: 'pending' | 'accepted' | 'rejected' | null;
    respondedAt: string | null;
  } | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null };
  documents: ContractDoc[];
  payments: ContractPayment[];
}

// ────────────────────────────────────────────────────────────────────────────
// Step model
// ────────────────────────────────────────────────────────────────────────────

type StepKey = 'issue' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active' | 'terms' | 'moveout' | 'settlement';
type Tone = 'action' | 'waiting' | 'celebrate' | 'declined';
type IconKey = 'document' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope' | 'alert' | 'clock' | 'wallet';

interface Step { key: StepKey; short: string; label: string; icon: IconKey }

const STEPS_NEW: Step[] = [
  { key: 'issue',   short: 'Issue',   label: 'Contract issued',  icon: 'document' },
  { key: 'sign',    short: 'Sign',    label: 'Signatures',        icon: 'pen'      },
  { key: 'ejari',   short: 'Ejari',   label: 'Ejari registration',icon: 'stamp'    },
  { key: 'utility', short: 'Utility', label: 'Utility account',   icon: 'bolt'     },
  { key: 'movein',  short: 'Move-in', label: 'Move-in inspection',icon: 'key'      },
  { key: 'active',  short: 'Active',  label: 'Active tenancy',    icon: 'active'   },
];
const STEPS_RENEWAL: Step[] = [
  { key: 'terms',  short: 'Terms',   label: 'Terms agreed',    icon: 'envelope' },
  { key: 'sign',   short: 'Sign',    label: 'Signatures',       icon: 'pen'      },
  { key: 'ejari',  short: 'Ejari',   label: 'Ejari renewal',    icon: 'stamp'    },
  { key: 'active', short: 'Active',  label: 'Renewal active',   icon: 'active'   },
];
// Appended after "Active" once a termination is accepted and the lease is
// winding down (Phase 6c) — the actionable move-out inspection + settlement steps.
const MOVE_OUT_STEP: Step = { key: 'moveout', short: 'Move-out', label: 'Move-out inspection', icon: 'key' };
const SETTLEMENT_STEP: Step = { key: 'settlement', short: 'Settlement', label: 'Deposit settlement', icon: 'wallet' };

interface DerivedState {
  status: ContractDetail['status'];
  ejariStatus: ContractDetail['ejariStatus'];
  tenantSigned: boolean;
  landlordSigned: boolean;
  utilityDoc: boolean;
  moveIn: { rpSubmitted: boolean; tenantSig: boolean; rpCounterSig: boolean };
  moveOut: { rpSubmitted: boolean; tenantSig: boolean; rpCounterSig: boolean };
  settlementStatus: 'draft' | 'sent' | 'agreed' | 'paid' | null;
}

function isDone(key: StepKey, st: DerivedState): boolean {
  switch (key) {
    case 'issue':   return st.status !== 'pending';
    case 'sign':    return st.tenantSigned && st.landlordSigned;
    case 'ejari':   return st.ejariStatus === 'registered';
    case 'utility': return st.utilityDoc;
    case 'movein':  return st.moveIn.rpCounterSig;
    case 'moveout': return st.moveOut.rpCounterSig;
    case 'settlement': return st.settlementStatus === 'paid';
    case 'active':  return st.status === 'active';
    case 'terms':   return true; // renewal flow only shows terms once accepted by customer
    default:        return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtAed(n: number | null | undefined): string {
  if (n == null) return '—';
  return 'AED ' + new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMethod(m: string | null | undefined): string {
  if (!m) return '—';
  return m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'online', label: 'Online' },
];

function spaceCategoryFromUnitType(unitType: string | null): string {
  if (!unitType) return 'residential';
  const t = unitType.toLowerCase();
  if (['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'].includes(t)) return 'industrial';
  if (['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical',
       'coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue',
       'conference_hall','private_dining','outdoor_venue'].includes(t)) return 'commercial';
  return 'residential';
}

function deriveState(contract: ContractDetail, signatures: { role: string }[], insp: MoveInInsp | null, moveOutInsp: MoveInInsp | null, settlementStatus: DerivedState['settlementStatus']): DerivedState {
  return {
    status: contract.status,
    ejariStatus: contract.ejariStatus,
    tenantSigned: signatures.some(s => s.role === 'tenant'),
    landlordSigned: signatures.some(s => s.role === 'landlord'),
    utilityDoc: contract.utilityStatus === 'submitted' || contract.utilityStatus === 'verified',
    moveIn: {
      rpSubmitted: !!insp?.rpSubmittedAt,
      tenantSig: !!insp?.tenantSig,
      rpCounterSig: !!insp?.rpCounterSig,
    },
    moveOut: {
      rpSubmitted: !!moveOutInsp?.rpSubmittedAt,
      tenantSig: !!moveOutInsp?.tenantSig,
      rpCounterSig: !!moveOutInsp?.rpCounterSig,
    },
    settlementStatus,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// QuestMap (SVG journey with clickable waypoints)
// ────────────────────────────────────────────────────────────────────────────

const STEP_ICON_PATHS: Record<IconKey, string> = {
  document: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  pen:      'M14 4l6 6L9 21H3v-6z',
  stamp:    'M9 3v6.5a2.5 2.5 0 0 1-5 0 M15 3v6.5a2.5 2.5 0 0 0 5 0 M3 13h18v4H3z',
  bolt:     'M13 2 4 14h7l-1 8 9-12h-7z',
  key:      'M7.5 11A4.5 4.5 0 1 0 12 15.5 M12 9.5 21 9.5 M18 9.5v3',
  active:   'M12 3 a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 12 l3 3 5-6',
  envelope: 'M3 5h18v14H3z M3 7l9 7 9-7',
  alert:    'M12 2L1 21h22z M12 9v5 M12 17h.01',
  clock:    'M12 3 a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  wallet:   'M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1z M3 7l0-1a2 2 0 0 1 2-2h11 M16 13h.01',
};

function Waypoint({
  step, done, selected, cx, cy, index, onSelect,
}: { step: Step; done: boolean; selected: boolean; cx: number; cy: number; index: number; onSelect: () => void }) {
  const r = selected ? 22 : 18;
  const fill = done ? 'var(--jade-deep)' : '#fff';
  const stroke = selected ? 'var(--brick)' : done ? 'var(--jade-deep)' : 'var(--mist-strong)';
  const icol = done ? '#fff' : selected ? 'var(--brick)' : 'var(--mute)';
  const lcol = done ? 'var(--jade-deep)' : selected ? 'var(--brick)' : 'var(--mute)';
  return (
    <g className="wpclick" onClick={onSelect} style={{ cursor: 'pointer' }}>
      {selected && !done && (
        <circle cx={cx} cy={cy} r={30} fill="var(--brick)" opacity={0.14}>
          <animate attributeName="r" values="22;34;22" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.22;0;0.22" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <ellipse cx={cx + 1} cy={cy + r + 3} rx={r * 0.7} ry={3} fill="var(--ink)" opacity={0.08} />
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={selected ? 3 : 2} />
      <g transform={`translate(${cx + r - 5}, ${cy - r + 5})`}>
        <circle r={8} fill="var(--ink)" />
        <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight={700}>{index + 1}</text>
      </g>
      <g transform={`translate(${cx - 11}, ${cy - 11})`}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={icol} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          {STEP_ICON_PATHS[step.icon].split(' M').map((seg, i) => (
            <path key={i} d={(i === 0 ? '' : 'M') + seg} />
          ))}
        </svg>
      </g>
      <text x={cx} y={cy + r + 18} textAnchor="middle" fontSize={11} fontWeight={600} fill={lcol}>{step.short}</text>
      <text x={cx} y={cy + r + 30} textAnchor="middle" fontSize={10} fill={selected ? 'var(--brick)' : 'var(--mute)'}>
        {done ? '✓ done' : selected ? 'now →' : 'tap'}
      </text>
    </g>
  );
}

function QuestMap({
  steps, doneArr, selectedIdx, onSelect, mode,
}: { steps: Step[]; doneArr: boolean[]; selectedIdx: number; onSelect: (i: number) => void; mode: 'new' | 'renewal' }) {
  const n = steps.length;
  const W = 332;
  const topPad = 56;
  const gap = 108;
  const innerH = topPad + 56 + (n - 1) * gap;
  const xs = steps.map((_, i) => 166 + (i % 4 === 1 ? 70 : i % 4 === 3 ? -70 : 0));
  const ys = steps.map((_, i) => topPad + i * gap);
  const doneCount = doneArr.filter(Boolean).length;
  const seg = (i: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[i] + ys[i + 1]) / 2;
    return `M ${xs[i]} ${ys[i]} C ${cx} ${cy}, ${cx} ${cy}, ${xs[i + 1]} ${ys[i + 1]}`;
  };
  const selStep = selectedIdx >= 0 ? steps[selectedIdx] : null;
  const selDone = selectedIdx >= 0 ? doneArr[selectedIdx] : false;
  return (
    <div className="qmap">
      <div className="qmap-h">
        <span className="qmap-l">
          <MapPin size={13} />{' '}{mode === 'renewal' ? 'Renewal journey' : 'Activation journey'}
        </span>
        <span className="qmap-c">{doneCount}/{n} complete</span>
      </div>
      <svg viewBox={`0 0 ${W} ${innerH}`} width="100%" height={innerH} style={{ display: 'block' }}>
        {steps.slice(0, -1).map((_, i) => {
          const solid = doneArr[i] && doneArr[i + 1];
          return (
            <path
              key={i}
              d={seg(i)}
              fill="none"
              stroke={solid ? 'var(--jade-deep)' : 'var(--mute)'}
              strokeWidth={solid ? 3 : 2}
              strokeDasharray={solid ? undefined : '2 7'}
              strokeLinecap="round"
              opacity={solid ? 1 : 0.5}
            />
          );
        })}
        {steps.map((s, i) => (
          <Waypoint key={s.key} step={s} done={doneArr[i]} selected={i === selectedIdx} cx={xs[i]} cy={ys[i]} index={i} onSelect={() => onSelect(i)} />
        ))}
      </svg>
      {selStep && (
        <div className="youare">
          <span className={'yi ' + (selDone ? 'done' : 'here')}>
            {selDone ? <BadgeCheck size={15} /> : <MapPin size={14} />}
          </span>
          <div style={{ flex: 1 }}>
            <div className="yl">{selDone ? 'Reviewing · complete' : 'Working on this step'}</div>
            <div className="yv">{selStep.label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Action card primitives
// ────────────────────────────────────────────────────────────────────────────

function HeroIcon({ tone, icon }: { tone: Tone; icon: IconKey }) {
  const map: Record<IconKey, React.ComponentType<{ size?: number }>> = {
    document: FileText,
    pen:      Pencil,
    stamp:    Stamp,
    bolt:     Zap,
    key:      Key,
    active:   BadgeCheck,
    envelope: FileText,
    alert:    AlertCircle,
    clock:    Clock,
    wallet:   Wallet,
  };
  const Ic = map[icon];
  return <div className={'heroicon ' + tone}><Ic size={26} /></div>;
}

function Completed({ title, sub, onUndo, undoLabel, viewUrl, viewLabel }: { title: string; sub?: string; onUndo?: () => void; undoLabel?: string; viewUrl?: string | null; viewLabel?: string }) {
  return (
    <div className="donepanel">
      <span className="dp-ic"><Check size={18} /></span>
      <div>
        <div className="dp-t">{title}</div>
        {sub && <div className="dp-s">{sub}</div>}
      </div>
      {viewUrl && <a href={viewUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}><ExternalLink size={13} /> {viewLabel || 'View'}</a>}
      {onUndo && <button className="btn btn-ghost btn-sm" style={{ marginLeft: viewUrl ? 8 : 'auto' }} onClick={onUndo}>{undoLabel || 'Update'}</button>}
    </div>
  );
}

/** RP review of the customer-uploaded utility proof: view the bill + confirm. */
function UtilityReview({ proof, accountNumber, onConfirm, onUpload, lock }: {
  proof: ContractDoc; accountNumber?: string | null; onConfirm: () => void; onUpload: () => void; lock?: boolean;
}) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span>
          {proof.displayName ?? 'Utility proof'}{accountNumber ? ` · ${accountNumber}` : ''}
        </span>
        <a href={proof.fileUrl} target="_blank" rel="noreferrer" className="mini-btn view" style={{ marginLeft: 'auto' }}><ExternalLink size={12} /> View bill</a>
      </div>
      {!lock && (
        <button className="btn btn-jade btn-sm" style={{ justifySelf: 'start', marginTop: 6 }} onClick={onConfirm}>
          <Check size={13} /> Confirm utility account
        </button>
      )}
      {!lock && <button className="ca" style={{ justifySelf: 'start', marginTop: 4, padding: 0 }} onClick={onUpload}>Upload a different proof</button>}
    </>
  );
}

function ChkRow({
  on, label, hint, onToggle, actionLabel, onAction, locked,
}: {
  on: boolean;
  label: string;
  hint?: string | null;
  onToggle: () => void;
  actionLabel?: string;
  onAction?: () => void;
  /** When true: hide the right-side Undo/action button entirely and
   *  make the checkbox a no-op. Used post-activation so the signing
   *  record can't be silently un-signed. */
  locked?: boolean;
}) {
  return (
    <div className={'chkrow ' + (on ? 'on' : '')}>
      <span className="cb" onClick={locked ? undefined : onToggle}>
        {on ? <Check size={12} /> : null}
      </span>
      <span className="ct">
        {label}
        {hint && <span style={{ color: 'var(--mute)', fontWeight: 500 }}> — {hint}</span>}
      </span>
      {!locked && (on
        ? <button className="ca" onClick={onToggle}>Undo</button>
        : onAction && <button className="ca" onClick={onAction}>{actionLabel}</button>)}
    </div>
  );
}

function UploadAction({
  fileLabel, onUpload, onMark,
}: { fileLabel: string; onUpload: () => void; onMark: () => void }) {
  return (
    <>
      <div className="upbox">
        <span className="uf">
          <span className="ufi"><FileText size={15} /></span> {fileLabel}
        </span>
        <button className="btn btn-jade btn-sm" style={{ marginLeft: 'auto' }} onClick={onUpload}>
          <UploadCloud size={13} /> Upload &amp; register
        </button>
      </div>
      <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0 }} onClick={onMark}>
        Mark as already on file
      </button>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Step content
// ────────────────────────────────────────────────────────────────────────────

interface StepContent {
  tone: Tone;
  icon: IconKey;
  sub: string;
  label: string;
  headline: string;
  body: string;
  timing: string | null;
  node: React.ReactNode;
}

interface StepHandlers {
  contract: ContractDetail;
  state: DerivedState;
  setState: (patch: Partial<DerivedState>) => void;
  openModal: (m: 'sign' | 'terminate' | 'renew') => void;
  openDrawer: (tab: DrawerTab) => void;
  patchContract: (patch: Partial<ContractDetail>) => void;
  onActivate: () => Promise<void>;
  onIssue: () => Promise<void>;
  onUploadEjari: () => void;
  onMarkEjari: () => Promise<void>;
  onUploadUtility: () => void;
  onMarkUtility: () => Promise<void>;
  onVerifyUtility: () => Promise<void>;
  onRevertToDraft: () => Promise<void>;
  signActionUrl: string;
  inspectionUrl: string;
  moveOutInspectionUrl: string;
  settlementUrl: string;
  printUrl: string;
  /** Role-aware contracts list base (RP vs manager) for child/parent links. */
  contractsBase: string;
  /** When true, all workflow rollback / re-do affordances are hidden:
   *  the "Update" / "Re-upload" / "Revert to draft" buttons on completed
   *  steps and the ChkRow undo toggles on the Sign step. Set to true
   *  whenever the contract has reached its terminal lifecycle (active,
   *  terminated, expired) so the activation history can't be rewritten
   *  after the fact. Active-state actions in the Active step
   *  (record payment / propose renewal / request termination) are
   *  unaffected — those are live management, not workflow rollback. */
  readOnlyWorkflow: boolean;
}

function stepContent(key: StepKey, st: DerivedState, h: StepHandlers, mode: 'new' | 'renewal'): StepContent {
  const TEN = h.contract.tenant.name || 'the customer';
  const totalSteps = mode === 'renewal' ? 4 : 6;
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of ${totalSteps}`;

  // Once a contract is active/terminated/expired, the activation steps
  // are frozen: no Re-upload, no undo toggles, no "Revert to draft".
  // Only the read-only "complete" panel shows.
  const lock = h.readOnlyWorkflow;

  if (key === 'issue') {
    const done = isDone('issue', st);
    return done
      ? {
          tone: 'celebrate', icon: 'document', sub: 'Stop 1 · complete', label: 'Issued',
          headline: 'Contract issued.',
          body: `Sent to ${TEN} — the signing process is underway.`,
          timing: null,
          node: (
            <Completed
              title="Issued to customer"
              sub="Signing in progress"
              onUndo={lock ? undefined : h.onRevertToDraft}
              undoLabel="Revert to draft"
            />
          ),
        }
      : {
          tone: 'action', icon: 'document', sub: stopOf(1), label: 'Draft',
          headline: 'Issue this contract.',
          body: `Review the terms below, then send it to ${TEN} to begin signing.`,
          timing: null,
          node: (
            <button className="btn btn-jade btn-lg btn-block" onClick={() => h.onIssue()}>
              <FileSignature size={15} /> Issue contract to {TEN}
            </button>
          ),
        };
  }

  if (key === 'sign') {
    const done = isDone('sign', st);
    return done
      ? {
          tone: 'celebrate', icon: 'pen', sub: 'Stop 2 · complete', label: 'Signed',
          headline: 'Both parties have signed.',
          body: 'Customer and landlord signatures are on file.',
          timing: null,
          node: (
            <div className="chklist">
              <ChkRow on locked={lock} label={`${TEN} signed`} onToggle={() => h.setState({ tenantSigned: false })} />
              <ChkRow on locked={lock} label="Landlord signed" onToggle={() => h.setState({ landlordSigned: false })} />
            </div>
          ),
        }
      : {
          tone: 'action', icon: 'pen', sub: stopOf(2), label: 'Signatures',
          headline: 'Capture both signatures.',
          body: `${TEN} signs from their portal and you countersign here.`,
          timing: 'Takes ~2 min',
          node: (
            <div className="chklist">
              <ChkRow
                on={st.tenantSigned}
                label={`${TEN} signed`}
                hint={st.tenantSigned ? undefined : 'awaiting customer'}
                onToggle={() => h.setState({ tenantSigned: !st.tenantSigned })}
              />
              <ChkRow
                on={st.landlordSigned}
                label="Landlord signed (you)"
                onToggle={() => h.setState({ landlordSigned: !st.landlordSigned })}
                actionLabel="Sign now"
                onAction={() => h.openModal('sign')}
              />
            </div>
          ),
        };
  }

  if (key === 'ejari') {
    const done = isDone('ejari', st);
    // The uploaded certificate — base key first, then any extra slots (ejari_certificate_2…).
    const ejariDoc = (h.contract.documents ?? []).find(d => d.documentKey === 'ejari_certificate')
      ?? (h.contract.documents ?? []).find(d => d.documentKey.startsWith('ejari'));
    return done
      ? {
          tone: 'celebrate', icon: 'stamp', sub: 'Stop 3 · complete', label: 'Ejari',
          headline: mode === 'renewal' ? 'Ejari renewed.' : 'Ejari registered.',
          body: 'Certificate is on file with the Dubai Land Department.',
          timing: null,
          node: <Completed title="Registered with DLD" sub={ejariDoc?.displayName ?? 'Ejari-certificate.pdf'} viewUrl={ejariDoc?.fileUrl} viewLabel="View Ejari" />,
        }
      : {
          tone: 'action', icon: 'stamp', sub: mode === 'renewal' ? 'Renewal · Ejari' : stopOf(3), label: 'Ejari',
          headline: 'Register Ejari with the DLD.',
          body: 'Upload the certificate, or mark it as already on file when importing an existing lease.',
          timing: '2–5 business days',
          node: <UploadAction fileLabel="Ejari-certificate.pdf" onUpload={h.onUploadEjari} onMark={() => h.onMarkEjari()} />,
        };
  }

  if (key === 'utility') {
    const done = isDone('utility', st);
    // Customer uploads "utility_proof_of_payment" (owner customer); RP may upload "utility".
    const proof = (h.contract.documents || []).find(d =>
      d.documentKey === 'utility_proof_of_payment' || d.documentKey === 'utility' || /utility|dewa/i.test(d.documentKey));
    const acc = h.contract.utilityAccountNumber;
    const accSub = acc ? `DEWA account ${acc}` : 'DEWA activation proof on file';
    return done
      ? {
          tone: 'celebrate', icon: 'bolt', sub: 'Stop 4 · complete', label: 'Utility',
          headline: 'Utility account confirmed.',
          body: proof ? `${TEN}'s utility proof is on file.` : 'DEWA activation proof is on file.',
          timing: null,
          node: <Completed title="Utility account confirmed" sub={accSub} viewUrl={proof?.fileUrl} viewLabel="View bill" />,
        }
      : {
          tone: 'action', icon: 'bolt', sub: stopOf(4), label: 'Utility',
          headline: proof ? `${TEN} uploaded the utility proof.` : 'Attach the utility activation.',
          body: proof
            ? 'Review the proof the customer uploaded, then confirm the utility account to advance.'
            : `Add the DEWA proof, let ${TEN} upload it, or mark it on file for imported leases.`,
          timing: proof ? null : 'Takes ~1 min',
          node: proof
            ? <UtilityReview proof={proof} accountNumber={acc} onConfirm={() => h.onVerifyUtility()} onUpload={h.onUploadUtility} lock={lock} />
            : <UploadAction fileLabel="DEWA-activation.pdf" onUpload={h.onUploadUtility} onMark={() => h.onMarkUtility()} />,
        };
  }

  if (key === 'movein') {
    const done = isDone('movein', st);
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Stop 5 · complete', label: 'Move-in',
          headline: 'Move-in complete.',
          body: 'Inspection signed by both parties — keys handed over.',
          timing: null,
          node: <Completed title="Inspection counter-signed" sub="Keys handed to customer" />,
        }
      : {
          tone: 'action', icon: 'key', sub: stopOf(5), label: 'Move-in',
          headline: 'Complete the move-in inspection.',
          body: 'Walk the unit, collect signatures and counter-sign. Open the inspection page to act.',
          timing: 'Takes ~2 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow on={st.moveIn.rpSubmitted} label="Inspection submitted" onToggle={() => {}} />
                <ChkRow on={st.moveIn.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow on={st.moveIn.rpCounterSig} label="You counter-signed" onToggle={() => {}} />
              </div>
              <Link href={h.inspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open inspection workspace
              </Link>
            </>
          ),
        };
  }

  if (key === 'moveout') {
    const done = isDone('moveout', st);
    const eff = h.contract.termination?.effectiveDate;
    return done
      ? {
          tone: 'celebrate', icon: 'key', sub: 'Move-out · complete', label: 'Move-out',
          headline: 'Move-out inspection complete.',
          body: 'Both parties signed the move-out condition report. Proceed to the deposit settlement.',
          timing: null,
          node: <Completed title="Move-out inspection counter-signed" sub="Ready for final settlement" viewUrl={h.moveOutInspectionUrl} viewLabel="View inspection" />,
        }
      : {
          tone: 'action', icon: 'key', sub: 'Wind-down', label: 'Move-out',
          headline: 'Complete the move-out inspection.',
          body: `Walk the unit against the move-in report${eff ? ` before ${fmtDate(eff)}` : ''}, record the move-out condition, collect the customer signature and counter-sign.`,
          timing: 'Takes ~3 min',
          node: (
            <>
              <div className="chklist">
                <ChkRow on={st.moveOut.rpSubmitted} label="Move-out inspection submitted" onToggle={() => {}} />
                <ChkRow on={st.moveOut.tenantSig} label={`${TEN} signed`} onToggle={() => {}} />
                <ChkRow on={st.moveOut.rpCounterSig} label="You counter-signed" onToggle={() => {}} />
              </div>
              <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
                <ClipboardCheck size={14} /> Open move-out inspection
              </Link>
            </>
          ),
        };
  }

  if (key === 'settlement') {
    const ss = st.settlementStatus;
    if (ss === 'paid') {
      return {
        tone: 'celebrate', icon: 'wallet', sub: 'Settlement · complete', label: 'Settlement',
        headline: 'Deposit settled.',
        body: 'The deposit refund has been reconciled and marked paid. This tenancy is fully closed out.',
        timing: null,
        node: <Completed title="Deposit refund paid" sub="Settlement closed" viewUrl={h.settlementUrl} viewLabel="View settlement" />,
      };
    }
    const statusLine =
      ss === 'agreed' ? `${TEN} agreed — pay the refund and mark it paid.`
      : ss === 'sent' ? `Sent to ${TEN} — awaiting their agreement.`
      : 'Reconcile the deposit: deductions, dues, and the net refund.';
    return {
      tone: 'action', icon: 'wallet', sub: 'Wind-down', label: 'Settlement',
      headline: 'Settle the security deposit.',
      body: statusLine,
      timing: null,
      node: (
        <>
          <div className="chklist">
            <ChkRow on={ss === 'sent' || ss === 'agreed'} label="Settlement sent to customer" onToggle={() => {}} />
            <ChkRow on={ss === 'agreed'} label={`${TEN} agreed`} onToggle={() => {}} />
            <ChkRow on={false} label="Refund marked paid" onToggle={() => {}} />
          </div>
          <Link href={h.settlementUrl} className="btn btn-jade btn-block">
            <Wallet size={14} /> Open settlement workspace
          </Link>
        </>
      ),
    };
  }

  if (key === 'terms') {
    return {
      tone: 'celebrate', icon: 'envelope', sub: 'Renewal · step 1', label: 'Terms agreed',
      headline: 'Renewal terms agreed.',
      body: `${TEN} accepted the new annual rent of ${fmtAed(h.contract.annualRent)}.`,
      timing: null,
      node: <Completed title="Customer accepted the terms" sub="Renewal locked in" />,
    };
  }

  // active
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'tenant') {
    return {
      tone: 'action', icon: 'alert', sub: 'Response required', label: 'Termination requested',
      headline: `${TEN} wants to end the lease early.`,
      body: 'Review the reason and effective date, then accept or reject.',
      timing: 'Awaiting your response',
      node: (
        <>
          <div className="qbanner action">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">Requested {fmtDate(h.contract.termination.requestedAt)}</p>
              {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-brick" data-action="accept-termination"><Check size={14} /> Accept termination</button>
            <button className="btn btn-ghost" data-action="reject-termination"><X size={14} /> Reject</button>
          </div>
        </>
      ),
    };
  }
  if (h.contract.termination && h.contract.termination.response === 'pending' && h.contract.termination.requestedByRole === 'rental_provider') {
    return {
      tone: 'waiting', icon: 'clock', sub: 'Awaiting customer', label: 'Termination sent',
      headline: 'Termination request sent.',
      body: `The lease stays active until ${TEN} accepts.`,
      timing: 'Awaiting customer response',
      node: (
        <div className="qbanner waiting">
          <span className="bic"><Clock size={18} /></span>
          <div style={{ flex: 1 }}>
            <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
            {h.contract.termination.reason && <div className="quote">&ldquo;{h.contract.termination.reason}&rdquo;</div>}
          </div>
        </div>
      ),
    };
  }
  if (h.contract.termination && h.contract.termination.response === 'accepted' && h.contract.status === 'active') {
    return {
      tone: 'waiting', icon: 'clock', sub: 'Winding down', label: 'Terminating',
      headline: 'Move-out scheduled.',
      body: `The tenancy stays active until ${fmtDate(h.contract.termination.effectiveDate)}, then auto-terminates.`,
      timing: 'Until effective date',
      node: (
        <>
          <div className="qbanner waiting">
            <span className="bic"><Clock size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
              <p className="bp">Both parties have agreed. Complete the move-out inspection, then settle the security deposit.</p>
            </div>
          </div>
          <Link href={h.moveOutInspectionUrl} className="btn btn-jade btn-block">
            <ClipboardCheck size={14} /> {st.moveOut.rpCounterSig ? 'View move-out inspection' : 'Open move-out inspection'}
          </Link>
        </>
      ),
    };
  }

  if (isDone('active', st)) {
    const next = h.contract.payments.find(p => (p.chequeStatus === 'pending' || (!p.paidAt && !p.chequeStatus)));
    return {
      tone: 'celebrate', icon: 'active', sub: mode === 'renewal' ? 'Renewal · live' : 'Stop 6 · live',
      label: mode === 'renewal' ? 'Renewal active' : 'Active tenancy',
      headline: mode === 'renewal' ? 'The renewal is live.' : 'This tenancy is live.',
      body: 'Manage payments, propose a renewal, or request termination at any time.',
      timing: null,
      node: (
        <>
          <div className="stats">
            <div className="stat">
              <div className="sl">Next payment</div>
              <div className="sv">{next ? fmtAed(next.amount) : '—'}</div>
            </div>
            <div className="stat">
              <div className="sl">Due</div>
              <div className="sv" style={{ fontSize: 15 }}>{next ? fmtDate(next.transactionDate) : '—'}</div>
            </div>
            <div className="stat">
              <div className="sl">Deposit held</div>
              <div className="sv jade">{fmtAed(h.contract.securityDepositAmount)}</div>
            </div>
          </div>
          {h.contract.renewalAccepted === 'pending' && (
            <div className="flag waiting" style={{ alignSelf: 'flex-start' }}>
              <RotateCcw size={13} /> Renewal proposed — awaiting {TEN}
              {h.contract.renewalChild && (
                <>
                  {' · '}
                  <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} style={{ fontWeight: 700, textDecoration: 'underline' }}>
                    View proposal · CID-{h.contract.renewalChild.id}
                  </Link>
                </>
              )}
            </div>
          )}
          {/* Customer accepted — the renewal now lives in its own contract.
              Without this block the renewal VANISHED from the parent page the
              moment it was accepted/issued. */}
          {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
            <div className="flag" style={{ alignSelf: 'flex-start', background: 'var(--jade-soft, #e7f5ef)', borderColor: 'var(--jade, #2e9f82)', color: 'var(--jade-deep, #1a7a5a)' }}>
              <RotateCcw size={13} /> Renewal agreed — {fmtDate(h.contract.renewalChild.startDate ?? null)} → {fmtDate(h.contract.renewalChild.endDate ?? null)}
              {h.contract.renewalChild.annualRent ? <> @ {fmtAed(h.contract.renewalChild.annualRent)}</> : null}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-jade" onClick={() => h.openDrawer('payments')}>
              <CreditCard size={14} /> Record payment
            </button>
            {h.contract.renewalAccepted === 'accepted' && h.contract.renewalChild && (
              <Link href={`${h.contractsBase}/${h.contract.renewalChild.id}/v2`} className="btn btn-jade">
                <RotateCcw size={14} /> Open renewal contract · CID-{h.contract.renewalChild.id}
              </Link>
            )}
            {mode !== 'renewal' && !h.contract.renewalAccepted && (
              <button className="btn btn-ghost" onClick={() => h.openModal('renew')}>
                <RotateCcw size={14} /> Propose renewal
              </button>
            )}
            <button className="btn btn-ghost" style={{ color: 'var(--brick)', borderColor: 'var(--brick-edge)' }} onClick={() => h.openModal('terminate')}>
              <X size={14} /> Request termination
            </button>
          </div>
        </>
      ),
    };
  }

  // not yet active — manual activation override
  const stepsAll = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const missing = stepsAll.filter(s => s.key !== 'active' && !isDone(s.key, st)).map(s => s.label);
  return {
    tone: 'action', icon: 'active', sub: mode === 'renewal' ? 'Renewal · activate' : `Stop 6 of 6`, label: 'Activate',
    headline: 'Activate the tenancy.',
    body: 'Go live now and backfill any records later, or finish the open steps first — your call.',
    timing: null,
    node: (
      <>
        {missing.length > 0 && (
          <div className="qbanner waiting">
            <span className="bic"><AlertCircle size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Still open</p>
              <p className="bp">{missing.join(' · ')}. You can activate anyway and complete these afterwards.</p>
            </div>
          </div>
        )}
        <button className="btn btn-jade btn-lg btn-block" onClick={() => h.onActivate()}>
          <BadgeCheck size={15} /> Activate tenancy now
        </button>
      </>
    ),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Missing strip
// ────────────────────────────────────────────────────────────────────────────

function MissingStrip({
  missing, allActive, onJump,
}: { missing: Step[]; allActive: boolean; onJump: (k: StepKey) => void }) {
  if (missing.length > 0) {
    return (
      <div className="missing">
        <span className="ml"><AlertCircle size={14} /> {missing.length} step{missing.length > 1 ? 's' : ''} need attention</span>
        {missing.map(s => (
          <button key={s.key} className="mchip" onClick={() => onJump(s.key)}>
            {s.label} <ChevronRight size={12} />
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="missing allgood">
      <span className="ml">
        <Check size={14} /> {allActive ? 'Every step complete — tenancy is fully on file.' : 'All records complete — ready to activate the tenancy.'}
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Detail cards row
// ────────────────────────────────────────────────────────────────────────────

type DrawerTab = 'parties' | 'property' | 'period' | 'payments' | 'documents' | 'clauses';

/** Generates + emails the tenant a secure magic link, deep-linked to the section
 *  relevant to where it's shown (documents vs the contract review/sign page),
 *  and shows the link so the RP can copy/share it directly (e.g. WhatsApp). */
function SendTenantLinkButton({ tenantId, contractId, section = 'documents', label = 'Get / send link', role = 'tenant' }: {
  tenantId: number; contractId: number; section?: 'documents' | 'contract' | 'move_in' | 'move_out'; label?: string; role?: 'tenant' | 'inspector';
}) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [link, setLink] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = async () => {
    setState('sending');
    try {
      const res = await fetch('/api/portal/generate', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        // Each link is scoped to one purpose — the backend enforces it and
        // returns a ready-to-share URL already deep-linked to the right page.
        body: JSON.stringify({ tenantId, contractId, purpose: section, signerRole: role }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const finalLink = d.link ?? '';
      setLink(finalLink); setEmail(d.email ?? null); setState('done');
      if (finalLink) { try { await navigator.clipboard.writeText(finalLink); setCopied(true); } catch { /* ignore */ } }
    } catch { setState('error'); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } };

  if (state === 'done' && link) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', maxWidth: 360 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
          <input readOnly value={link} onFocus={e => e.currentTarget.select()}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', border: '1px solid var(--line, #e8e6e0)', borderRadius: 8, background: '#fafaf8', color: '#1a1916' }} />
          <button type="button" className="mini-btn ok" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <a href={link} target="_blank" rel="noreferrer" className="mini-btn view"><ExternalLink size={12} /> Open</a>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--mute, #9b9890)' }}>
          {email ? `Emailed to ${email} · ` : ''}
          {role === 'inspector'
            ? 'share this link with your inspection manager to counter-sign on site (valid 14 days)'
            : 'share this link with the customer to upload & sign (valid 14 days)'}
        </span>
      </div>
    );
  }
  return (
    <button type="button" className="mini-btn view" onClick={send} disabled={state === 'sending'} title="Generate a secure link for the tenant">
      <Send size={12} /> {state === 'sending' ? 'Generating…' : state === 'error' ? 'Retry' : label}
    </button>
  );
}

function DetailCards({
  contract, payments, kycDocs, onOpen,
}: { contract: ContractDetail; payments: ContractPayment[]; kycDocs: ContractDoc[]; onOpen: (t: DrawerTab) => void }) {
  const pendingKyc = kycDocs.filter(d => d.status === 'pending').length;
  const landlordShort = (contract.landlord.companyName ?? contract.landlord.name ?? '—').split(' ')[0];
  return (
    <div className="details-wrap">
      <div className="section-eyebrow">
        <span className="se-t">Contract details</span>
        <span className="se-line" />
        <button className="se-link" onClick={() => onOpen('parties')}>
          Open full details <ChevronRight size={13} />
        </button>
      </div>
      <div className="detail-cards">
        <button type="button" className="dcard" onClick={() => onOpen('parties')}>
          <div className="dch"><span className="dci"><User size={16} /></span><span className="dct">Parties</span><span className="dca"><ChevronRight size={14} /></span></div>
          <div className="drow"><span className="k">Customer</span><span className="v">{contract.tenant.name ?? '—'}</span></div>
          <div className="drow"><span className="k">Landlord</span><span className="v">{landlordShort}</span></div>
        </button>
        <button type="button" className="dcard" onClick={() => onOpen('payments')}>
          <div className="dch"><span className="dci"><CreditCard size={16} /></span><span className="dct">Payments</span><span className="dca"><ChevronRight size={14} /></span></div>
          <div className="drow"><span className="k">Annual rent{(contract.rentVatRate ?? 0) > 0 ? ' (net)' : ''}</span><span className="v">{fmtAed(contract.annualRent)}</span></div>
          {(contract.rentVatRate ?? 0) > 0 && (
            <div className="drow"><span className="k">+ VAT ({contract.rentVatRate}%)</span><span className="v">{fmtAed(Math.round(contract.annualRent * (contract.rentVatRate ?? 0)) / 100)}</span></div>
          )}
          <div className="drow"><span className="k">Instalments</span><span className="v">{contract.numberOfInstallments ?? '—'}</span></div>
        </button>
        <button type="button" className="dcard" onClick={() => onOpen('documents')}>
          <div className="dch">
            <span className="dci"><Paperclip size={16} /></span>
            <span className="dct">Documents</span>
            {pendingKyc > 0
              ? <span className="dbadge">{pendingKyc} to review</span>
              : <span className="dca"><ChevronRight size={14} /></span>}
          </div>
          <div className="drow"><span className="k">All documents</span><span className="v">{(contract.documents ?? []).length} files</span></div>
          <div className="drow"><span className="k">Customer KYC</span><span className="v">{kycDocs.length} files</span></div>
        </button>
        <button type="button" className="dcard" onClick={() => onOpen('period')}>
          <div className="dch"><span className="dci"><Calendar size={16} /></span><span className="dct">Period</span><span className="dca"><ChevronRight size={14} /></span></div>
          <div className="drow"><span className="k">Start</span><span className="v">{fmtDate(contract.startDate)}</span></div>
          <div className="drow"><span className="k">End</span><span className="v">{fmtDate(contract.endDate)}</span></div>
        </button>
      </div>
      {/* unused vars to keep typecheck happy when payments comes empty */}
      <span className="sr-only" hidden>{payments.length}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Drawer
// ────────────────────────────────────────────────────────────────────────────

function DRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="drow2">
      <span className="k">{k}</span>
      <span className="v">{v ?? '—'}</span>
    </div>
  );
}

const DRAWER_TABS: { key: DrawerTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { key: 'parties',   label: 'Parties',   icon: User },
  { key: 'property',  label: 'Property',  icon: Building2 },
  { key: 'period',    label: 'Period',    icon: Calendar },
  { key: 'payments',  label: 'Payments',  icon: CreditCard },
  { key: 'documents', label: 'Documents', icon: Paperclip },
  { key: 'clauses',   label: 'Clauses',   icon: ClipboardList },
];

function DetailsDrawer({
  open, tab, setTab, onClose, contract, payments, kycDocs, onApproveDoc, onRejectDoc,
  onRecordPayment, onUpdatePayment, onSaveClauses, onConfirmPdc, onUploadDoc, onRequestDoc,
}: {
  open: boolean; tab: DrawerTab; setTab: (t: DrawerTab) => void; onClose: () => void;
  contract: ContractDetail; payments: ContractPayment[]; kycDocs: ContractDoc[];
  onApproveDoc: (id: number) => void; onRejectDoc: (id: number) => void;
  /** POST /api/contracts/:id/payments — record a new instalment / payment. */
  onRecordPayment: (body: {
    description?: string; amount: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/payments/:paymentId — edit status / amount / reference / description. */
  onUpdatePayment: (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string;
  }) => Promise<void>;
  /** PATCH /api/contracts/:id/clauses — save edited custom clauses + notes. */
  onSaveClauses: (customClauses: string[], notes: string | null) => Promise<void>;
  /** PATCH /api/contracts/:id/confirm-pdc — confirm post-dated cheques received. */
  onConfirmPdc: () => Promise<void>;
  /** upload-url → PUT → POST /api/documents — attach a contract document. */
  onUploadDoc: (file: File, meta: { key: string; label: string; category: string }, visibleToTenant: boolean, expiryDate: string) => Promise<void>;
  /** POST /api/documents/request — request a document from the tenant. */
  onRequestDoc: (label: string, notes: string) => Promise<void>;
}) {
  const depositRow = payments.find(p => p.paymentType === 'security_deposit');
  // ── Record-payment form state (Flow 1) ──
  const [showRec, setShowRec] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [rec, setRec] = useState({
    description: '', amount: '', paymentType: 'rental_income',
    paymentMethod: 'cheque', chequeNumber: '', transactionDate: '',
  });
  const [statusBusy, setStatusBusy] = useState<number | null>(null);
  // ── Inline cheque editor — correct amount / reference / description on existing rows ──
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ amount: '', chequeNumber: '', description: '', paymentMethod: 'cheque' });
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const startEdit = (p: ContractPayment) => {
    setEditingId(p.id); setEditErr(null);
    setEditForm({
      amount: p.amount != null ? String(p.amount) : '',
      chequeNumber: p.chequeNumber ?? '',
      description: p.description ?? '',
      paymentMethod: p.paymentMethod ?? 'cheque',
    });
  };
  const saveEdit = async (paymentId: number) => {
    const amt = Number(editForm.amount);
    if (editForm.amount.trim() === '' || !Number.isFinite(amt) || amt < 0) { setEditErr('Enter a valid amount'); return; }
    setEditBusy(true); setEditErr(null);
    try {
      await onUpdatePayment(paymentId, {
        amount: amt,
        chequeNumber: editForm.chequeNumber.trim() || null,
        description: editForm.description.trim() || null,
        paymentMethod: editForm.paymentMethod,
      });
      setEditingId(null);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setEditBusy(false);
    }
  };
  const submitRec = async () => {
    const amt = Number(rec.amount);
    if (!amt || amt <= 0) { setRecErr('Enter a valid amount'); return; }
    setRecBusy(true); setRecErr(null);
    try {
      await onRecordPayment({
        description: rec.description.trim() || undefined,
        amount: amt,
        paymentType: rec.paymentType,
        paymentMethod: rec.paymentMethod,
        chequeNumber: rec.chequeNumber.trim() || undefined,
        transactionDate: rec.transactionDate || undefined,
      });
      setRec({ description: '', amount: '', paymentType: 'rental_income', paymentMethod: 'cheque', chequeNumber: '', transactionDate: '' });
      setShowRec(false);
    } catch (e) {
      setRecErr(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setRecBusy(false);
    }
  };
  const changeStatus = async (paymentId: number, status: string) => {
    setStatusBusy(paymentId);
    try { await onUpdatePayment(paymentId, { chequeStatus: status }); }
    finally { setStatusBusy(null); }
  };
  // ── Clause editor state (Flow 2) — editable only while the contract is a draft. ──
  const clausesEditable = contract.status === 'pending';
  const [clauseList, setClauseList] = useState<string[]>(contract.customClauses ?? []);
  const [clauseNotes, setClauseNotes] = useState(contract.notes ?? '');
  const [clauseInput, setClauseInput] = useState('');
  const [clauseBusy, setClauseBusy] = useState(false);
  const [clauseSaved, setClauseSaved] = useState(false);
  const [clauseErr, setClauseErr] = useState<string | null>(null);
  // Keep the local editor in sync when the contract reloads.
  useEffect(() => {
    setClauseList(contract.customClauses ?? []);
    setClauseNotes(contract.notes ?? '');
  }, [contract.customClauses, contract.notes]);
  const addClause = () => {
    const t = clauseInput.trim();
    if (t) { setClauseList(prev => [...prev, t]); setClauseInput(''); }
  };
  const saveClauses = async () => {
    setClauseBusy(true); setClauseErr(null); setClauseSaved(false);
    try {
      await onSaveClauses(clauseList, clauseNotes || null);
      setClauseSaved(true);
      setTimeout(() => setClauseSaved(false), 2500);
    } catch (e) {
      setClauseErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setClauseBusy(false);
    }
  };
  // ── Confirm PDC state (Flow 3) ──
  const [pdcBusy, setPdcBusy] = useState(false);
  const rentRows = payments.filter(p => p.paymentType !== 'security_deposit');
  // Rent VAT (commercial/industrial): amounts are GROSS; split net vs VAT for display.
  const rentGross = rentRows.reduce((s, p) => s + (p.amount || 0), 0);
  const rentVat   = rentRows.reduce((s, p) => s + (p.vatAmount || 0), 0);
  const rentNet   = rentGross - rentVat;
  const showVat   = (contract.rentVatRate ?? 0) > 0 || rentVat > 0;
  const allRecorded = rentRows.length > 0;
  const confirmPdc = async () => {
    setPdcBusy(true);
    try { await onConfirmPdc(); } finally { setPdcBusy(false); }
  };
  // ── Upload document state (Flow 5) ──
  const docFileRef = useRef<HTMLInputElement>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [upFile, setUpFile] = useState<File | null>(null);
  const [upType, setUpType] = useState('');
  const [upVisible, setUpVisible] = useState(false);
  const [upExpiry, setUpExpiry] = useState('');
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const DOC_TYPES = [
    { value: 'trade_license',          label: 'Trade License',          category: 'license',    needsExpiry: true  },
    { value: 'initial_approval',       label: 'Initial Approval',       category: 'compliance', needsExpiry: false },
    { value: 'trade_name_reservation', label: 'Trade Name Reservation', category: 'compliance', needsExpiry: false },
    { value: 'passport',               label: 'Passport',               category: 'identity',   needsExpiry: true  },
    { value: 'visa',                   label: 'Visa',                   category: 'identity',   needsExpiry: true  },
    { value: 'emirates_id',            label: 'Emirates ID',            category: 'identity',   needsExpiry: true  },
    { value: 'noc',                    label: 'NOC',                    category: 'legal',      needsExpiry: true  },
    { value: 'undertaking_letter',     label: 'Undertaking Letter',     category: 'legal',      needsExpiry: false },
    { value: 'ejari',                  label: 'Ejari',                  category: 'property',   needsExpiry: true  },
    { value: 'poa',                    label: 'POA',                    category: 'legal',      needsExpiry: false },
    { value: 'pdc',                    label: 'PDC',                    category: 'payment',    needsExpiry: false },
    { value: 'agreement',              label: 'Agreement',              category: 'contract',   needsExpiry: false },
    { value: 'other',                  label: 'Others',                 category: 'other',      needsExpiry: false },
  ] as const;
  const upSelected = DOC_TYPES.find(t => t.value === upType);
  const upShowExpiry = upSelected?.needsExpiry ?? false;
  const submitUpload = async () => {
    if (!upFile || !upType) return;
    const meta = DOC_TYPES.find(t => t.value === upType)!;
    setUpBusy(true); setUpErr(null);
    try {
      await onUploadDoc(upFile, { key: meta.value, label: meta.label, category: meta.category }, upVisible, upExpiry);
      setShowUpload(false); setUpFile(null); setUpType(''); setUpVisible(false); setUpExpiry('');
      if (docFileRef.current) docFileRef.current.value = '';
    } catch (e) {
      setUpErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUpBusy(false);
    }
  };
  // ── Request document state (Flow 6) ──
  const [reqLabel, setReqLabel] = useState('');
  const [reqNotes, setReqNotes] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState<string | null>(null);
  const [reqMenuOpen, setReqMenuOpen] = useState(false);
  const submitRequest = async () => {
    const label = reqLabel.trim();
    if (!label) return;
    setReqBusy(true); setReqErr(null);
    try {
      await onRequestDoc(label, reqNotes.trim());
      setReqLabel(''); setReqNotes('');
    } catch (e) {
      setReqErr(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setReqBusy(false);
    }
  };
  return (
    <>
      <div className={'scrim ' + (open ? 'open' : '')} onClick={onClose} />
      <div className={'drawer ' + (open ? 'open' : '')}>
        <div className="dh">
          <span className="t">Contract details</span>
          <button className="x" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="dtabs">
          {DRAWER_TABS.map(({ key, label, icon: Ic }) => (
            <button key={key} className={'dtab ' + (tab === key ? 'on' : '')} onClick={() => setTab(key)}>
              <Ic size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="dbody">
          {tab === 'parties' && (
            <div className="sec">
              <div className="sech"><span className="si"><User size={16} /></span><span className="st">Parties</span></div>
              <div className="secb">
                <div className="grid2" style={{ gap: 24 }}>
                  <div>
                    <p className="subhead">Landlord</p>
                    <DRow k="Company" v={contract.landlord.companyName} />
                    <DRow k="Contact" v={contract.landlord.name} />
                    <DRow k="Email"   v={contract.landlord.email} />
                    <DRow k="Phone"   v={contract.landlord.phone} />
                  </div>
                  <div>
                    <p className="subhead mut">Customer</p>
                    <DRow k="Name"  v={contract.tenant.name} />
                    <DRow k="Email" v={contract.tenant.email} />
                    <DRow k="Phone" v={contract.tenant.phone} />
                  </div>
                </div>
              </div>
            </div>
          )}
          {tab === 'property' && (
            <div className="sec">
              <div className="sech"><span className="si"><Building2 size={16} /></span><span className="st">Property &amp; unit</span></div>
              <div className="secb">
                <DRow k="Building"  v={contract.property.buildingName} />
                <DRow k="Community" v={contract.property.community} />
                <DRow k="Emirate"   v={contract.property.emirate} />
                <DRow k="Unit"      v={contract.unit.number ? `Unit ${contract.unit.number}` : null} />
                <DRow k="Type"      v={contract.unit.type} />
                <DRow k="Floor"     v={contract.unit.floor} />
                <DRow k="Bedrooms"  v={contract.unit.bedrooms} />
                <DRow k="Bathrooms" v={contract.unit.bathrooms} />
              </div>
            </div>
          )}
          {tab === 'period' && (
            <div className="sec">
              <div className="sech"><span className="si"><Calendar size={16} /></span><span className="st">Rental period</span></div>
              <div className="secb">
                <DRow k="Start"        v={fmtDate(contract.startDate)} />
                <DRow k="End"          v={fmtDate(contract.endDate)} />
                <DRow k="Duration"     v={contract.durationYears ? `${contract.durationYears} year${contract.durationYears !== 1 ? 's' : ''}` : '12 months'} />
                <DRow k="Instalments"  v={contract.numberOfInstallments ? `${contract.numberOfInstallments} payments` : '—'} />
                <DRow k="Mode"         v={contract.modeOfPayment ? contract.modeOfPayment.charAt(0).toUpperCase() + contract.modeOfPayment.slice(1) : '—'} />
              </div>
            </div>
          )}
          {tab === 'payments' && (
            <>
              {depositRow && (
                <div className="sec">
                  <div className="sech"><span className="si"><DollarSign size={16} /></span><span className="st">Security deposit</span></div>
                  <div className="secb">
                    <table className="ptable">
                      <thead><tr><th>Amount</th><th>Reference</th><th>Method</th><th>Date</th><th>Status</th></tr></thead>
                      <tbody>
                        <Fragment>
                          <tr>
                            <td className="amt">{fmtAed(depositRow.amount)}</td>
                            <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{depositRow.chequeNumber ?? '—'}</td>
                            <td>{fmtMethod(depositRow.paymentMethod)}</td>
                            <td>{fmtDate(depositRow.transactionDate)}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <select
                                  className={'cstat ' + (depositRow.chequeStatus ?? 'cleared')}
                                  style={{ cursor: 'pointer' }}
                                  value={depositRow.chequeStatus ?? 'cleared'}
                                  disabled={statusBusy === depositRow.id}
                                  onChange={e => void changeStatus(depositRow.id, e.target.value)}
                                >
                                  <option value="pending">Pending</option>
                                  <option value="cleared">Cleared</option>
                                  <option value="bounced">Bounced</option>
                                  <option value="cancelled">Cancelled</option>
                                </select>
                                <button
                                  type="button"
                                  className="mini-btn view"
                                  title="Edit amount / reference / description"
                                  onClick={() => editingId === depositRow.id ? setEditingId(null) : startEdit(depositRow)}
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                          {editingId === depositRow.id && (
                            <tr>
                              <td colSpan={5} style={{ background: 'var(--jade-tint)' }}>
                                <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                  <p className="subhead">Correct security-deposit details</p>
                                  <div className="field"><label>Description</label>
                                    <input className="input" value={editForm.description} placeholder="e.g. Security deposit"
                                      onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                  </div>
                                  <div className="grid2">
                                    <div className="field"><label>Amount (AED)</label>
                                      <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                        onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                    </div>
                                    <div className="field"><label>Payment method</label>
                                      <select className="input" value={editForm.paymentMethod}
                                        onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                        {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                      </select>
                                    </div>
                                  </div>
                                  <div className="field"><label>Cheque / reference no.</label>
                                    <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                      onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                  </div>
                                  {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                    <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(depositRow.id)}>
                                      <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                    </button>
                                    <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="sec">
                <div className="sech">
                  <span className="si"><CreditCard size={16} /></span>
                  <span className="st">Rental instalments</span>
                  <button type="button" className="mini-btn view" style={{ marginLeft: 'auto' }} onClick={() => { setShowRec(s => !s); setRecErr(null); }}>
                    {showRec ? <><X size={12} /> Close</> : <><CreditCard size={12} /> Record payment</>}
                  </button>
                </div>
                <div className="secb">
                  <table className="ptable">
                    <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Reference</th><th>Method</th><th>Due date</th><th>Status</th></tr></thead>
                    <tbody>
                      {rentRows.map((p, i) => (
                        <Fragment key={p.id}>
                        <tr>
                          <td>{i + 1}</td>
                          <td>{p.description ?? '—'}</td>
                          <td className="amt">
                            {fmtAed(p.amount)}
                            {(p.vatAmount ?? 0) > 0 && (
                              <span className="note" style={{ display: 'block', fontSize: 11 }}>incl. {fmtAed(p.vatAmount ?? 0)} VAT</span>
                            )}
                          </td>
                          <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{p.chequeNumber ?? '—'}</td>
                          <td>{fmtMethod(p.paymentMethod)}</td>
                          <td>{fmtDate(p.transactionDate)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <select
                                className={'cstat ' + (p.chequeStatus ?? 'pending')}
                                style={{ cursor: 'pointer' }}
                                value={p.chequeStatus ?? 'pending'}
                                disabled={statusBusy === p.id}
                                onChange={e => void changeStatus(p.id, e.target.value)}
                              >
                                <option value="pending">Pending</option>
                                <option value="cleared">Cleared</option>
                                <option value="bounced">Bounced</option>
                                <option value="cancelled">Cancelled</option>
                              </select>
                              <button
                                type="button"
                                className="mini-btn view"
                                title="Edit amount / reference / description"
                                onClick={() => editingId === p.id ? setEditingId(null) : startEdit(p)}
                              >
                                <Pencil size={12} /> Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingId === p.id && (
                          <tr>
                            <td colSpan={7} style={{ background: 'var(--jade-tint)' }}>
                              <div style={{ padding: 12, border: '1px solid #cfe9df', borderRadius: 12 }}>
                                <p className="subhead">Correct cheque details</p>
                                <div className="field"><label>Description</label>
                                  <input className="input" value={editForm.description} placeholder="e.g. Rental Instalment 1 of 4"
                                    onChange={e => setEditForm(v => ({ ...v, description: e.target.value }))} />
                                </div>
                                <div className="grid2">
                                  <div className="field"><label>Amount (AED)</label>
                                    <input type="number" min="0" step="0.01" className="input" value={editForm.amount}
                                      onChange={e => setEditForm(v => ({ ...v, amount: e.target.value }))} />
                                  </div>
                                  <div className="field"><label>Payment method</label>
                                    <select className="input" value={editForm.paymentMethod}
                                      onChange={e => setEditForm(v => ({ ...v, paymentMethod: e.target.value }))}>
                                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                    </select>
                                  </div>
                                </div>
                                <div className="field"><label>Cheque / reference no.</label>
                                  <input className="input" value={editForm.chequeNumber} placeholder="Cheque #, transfer ID…"
                                    onChange={e => setEditForm(v => ({ ...v, chequeNumber: e.target.value }))} />
                                </div>
                                {showVat && (
                                  <p className="note" style={{ marginTop: 2 }}>VAT ({contract.rentVatRate ?? 0}%) is recalculated from the corrected amount automatically.</p>
                                )}
                                {editErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{editErr}</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                  <button className="btn btn-jade btn-sm" disabled={editBusy} onClick={() => void saveEdit(p.id)}>
                                    <Check size={14} /> {editBusy ? 'Saving…' : 'Save changes'}
                                  </button>
                                  <button className="btn btn-ghost btn-sm" disabled={editBusy} onClick={() => { setEditingId(null); setEditErr(null); }}>Cancel</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      ))}
                      {rentRows.length === 0 && (
                        <tr><td colSpan={7}><span className="note">No payments recorded yet.</span></td></tr>
                      )}
                    </tbody>
                    <tfoot>
                      {showVat && (
                        <>
                          <tr><td colSpan={2}>Net rent</td><td className="amt">{fmtAed(rentNet)}</td><td colSpan={4} /></tr>
                          <tr><td colSpan={2}>VAT{(contract.rentVatRate ?? 0) > 0 ? ` (${contract.rentVatRate}%)` : ''}</td><td className="amt">{fmtAed(rentVat)}</td><td colSpan={4} /></tr>
                        </>
                      )}
                      <tr><td colSpan={2}>{showVat ? 'Total (incl. VAT)' : 'Total'}</td><td className="tot">{fmtAed(rentGross)}</td><td colSpan={4} /></tr>
                    </tfoot>
                  </table>

                  {/* Record-payment form (Flow 1) */}
                  {showRec && (
                    <div style={{ marginTop: 14, padding: 14, border: '1px solid #cfe9df', borderRadius: 12, background: 'var(--jade-tint)' }}>
                      <p className="subhead">New payment</p>
                      <div className="grid2">
                        <div className="field"><label>Type</label>
                          <select className="input" value={rec.paymentType} onChange={e => setRec(v => ({ ...v, paymentType: e.target.value }))}>
                            <option value="rental_income">Rental income</option>
                            <option value="security_deposit">Security deposit</option>
                            <option value="admin_fee">Admin fee</option>
                            <option value="maintenance_fee">Maintenance fee</option>
                            <option value="service_charge">Service charge</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <div className="field"><label>Method</label>
                          <select className="input" value={rec.paymentMethod} onChange={e => setRec(v => ({ ...v, paymentMethod: e.target.value }))}>
                            <option value="cheque">Cheque</option>
                            <option value="bank_transfer">Bank transfer</option>
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="online">Online</option>
                          </select>
                        </div>
                      </div>
                      <div className="field"><label>Description</label>
                        <input className="input" value={rec.description} placeholder={`Rental Instalment ${rentRows.length + 1}`} onChange={e => setRec(v => ({ ...v, description: e.target.value }))} />
                      </div>
                      <div className="grid2">
                        <div className="field"><label>Amount (AED)</label>
                          <input type="number" min="0" step="0.01" className="input" value={rec.amount} onChange={e => setRec(v => ({ ...v, amount: e.target.value }))} />
                        </div>
                        <div className="field"><label>Cheque / reference no.</label>
                          <input className="input" value={rec.chequeNumber} placeholder="Cheque #, transfer ID…" onChange={e => setRec(v => ({ ...v, chequeNumber: e.target.value }))} />
                        </div>
                      </div>
                      <div className="field" style={{ margin: 0 }}><label>Date</label>
                        <input type="date" className="input" value={rec.transactionDate} onChange={e => setRec(v => ({ ...v, transactionDate: e.target.value }))} />
                      </div>
                      {recErr && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{recErr}</p>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                        <button className="btn btn-jade btn-sm" disabled={recBusy || !rec.amount} onClick={() => void submitRec()}>
                          <Check size={14} /> {recBusy ? 'Saving…' : 'Save payment'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={recBusy} onClick={() => { setShowRec(false); setRecErr(null); }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Confirm PDC received (Flow 3) */}
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--mist-strong)' }}>
                    {contract.pdcConfirmed ? (
                      <p className="note" style={{ color: 'var(--jade-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Check size={13} /> PDC collection confirmed{contract.pdcConfirmedAt ? ` on ${fmtDate(contract.pdcConfirmedAt)}` : ''}.
                      </p>
                    ) : (
                      <>
                        <button className="btn btn-jade btn-sm" disabled={pdcBusy || !allRecorded} onClick={() => void confirmPdc()}>
                          <ClipboardCheck size={14} /> {pdcBusy ? 'Confirming…' : 'Confirm PDC received'}
                        </button>
                        {!allRecorded && <p className="note" style={{ marginTop: 6 }}>Record the rental cheques above first.</p>}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === 'documents' && (() => {
            const all = contract.documents ?? [];
            const groups = [
              { key: 'customer', label: 'Customer documents', items: all.filter(d => d.ownerType === 'customer' || d.ownerType === 'tenant') },
              { key: 'contract', label: 'Contract documents', items: all.filter(d => d.ownerType === 'tenancy_contract') },
              { key: 'deposit',  label: 'Deposit documents',  items: all.filter(d => d.ownerType === 'security_deposit') },
              { key: 'other',    label: 'Other documents',    items: all.filter(d => !['customer', 'tenant', 'tenancy_contract', 'security_deposit'].includes(d.ownerType)) },
            ].filter(g => g.items.length);
            const openAll = () => openDocsTogether(all);
            return (
              <div className="sec">
                <div className="sech">
                  <span className="si"><Paperclip size={16} /></span>
                  <span className="st">All documents ({all.length})</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {all.length > 0 && (
                      <button type="button" className="mini-btn view" onClick={openAll}>
                        <ExternalLink size={12} /> View all
                      </button>
                    )}
                    <button type="button" className="mini-btn ok" onClick={() => { setShowUpload(s => !s); setUpErr(null); }}>
                      <UploadCloud size={12} /> Upload
                    </button>
                    {contract.tenant.id && <SendTenantLinkButton tenantId={contract.tenant.id} contractId={contract.id} section="documents" label="Send docs link" />}
                  </div>
                </div>
                <div className="secb">
                  {all.length === 0 && <p className="note">No documents yet.</p>}
                  {groups.map(g => (
                    <div key={g.key} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--color-neutral-400, #9b9890)', margin: '4px 0 8px' }}>
                        {g.label} ({g.items.length})
                      </div>
                      <div className="doclist">
                        {g.items.map(d => {
                          const isKyc = d.ownerType === 'customer' || d.ownerType === 'tenant';
                          const ok  = ['approved', 'processed', 'complete'].includes(d.status);
                          const stt = ok ? 'approved' : d.status === 'rejected' ? 'rejected' : 'pending';
                          const lbl = ok ? (d.status === 'approved' ? 'Approved' : 'On file')
                            : d.status === 'rejected' ? 'Rejected' : 'Pending review';
                          const exp = d.expiryDate ? ' · exp ' + new Date(d.expiryDate).toLocaleDateString('en-AE') : '';
                          return (
                            <div key={d.id} className={'docitem ' + stt}>
                              <FileText size={16} />
                              <div>
                                <div className="dn">{d.displayName ?? d.documentKey.replace(/_/g, ' ')}</div>
                                <div className="ds">{lbl}{exp}</div>
                              </div>
                              <div className="dacts">
                                <a href={d.fileUrl} target="_blank" rel="noreferrer" className="mini-btn view"><ExternalLink size={12} /> View</a>
                                {isKyc && d.status !== 'approved' && <button className="mini-btn ok" onClick={() => onApproveDoc(d.id)}><Check size={12} /></button>}
                                {isKyc && d.status !== 'rejected' && <button className="mini-btn no" onClick={() => onRejectDoc(d.id)}><X size={12} /></button>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Upload document (Flow 5) */}
                  {showUpload && (
                    <div style={{ margin: '6px 0 14px', padding: 14, border: '1px solid var(--mist-strong)', borderRadius: 12, background: 'var(--surface)' }}>
                      <p className="subhead">Upload a document</p>
                      <input ref={docFileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                        onChange={e => setUpFile(e.target.files?.[0] ?? null)} />
                      <div className="field">
                        <label>File</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => docFileRef.current?.click()}>Choose file</button>
                          <span className="note" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{upFile ? upFile.name : 'No file chosen'}</span>
                        </div>
                      </div>
                      <div className="field">
                        <label>Document type</label>
                        <select className="input" value={upType} onChange={e => { setUpType(e.target.value); setUpExpiry(''); }}>
                          <option value="">Select type…</option>
                          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>Visibility</label>
                        <div style={{ display: 'flex', gap: 18 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                            <input type="radio" name="v2DocVisibility" checked={!upVisible} onChange={() => setUpVisible(false)} /> Internal only
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                            <input type="radio" name="v2DocVisibility" checked={upVisible} onChange={() => setUpVisible(true)} /> Visible to customer
                          </label>
                        </div>
                      </div>
                      {upShowExpiry && (
                        <div className="field">
                          <label>Expiry date (required for {upSelected?.label})</label>
                          <input type="date" className="input" value={upExpiry} onChange={e => setUpExpiry(e.target.value)} />
                        </div>
                      )}
                      {upErr && <p className="note" style={{ color: 'var(--brick)' }}>{upErr}</p>}
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <button className="btn btn-jade btn-sm" disabled={upBusy || !upFile || !upType || (upShowExpiry && !upExpiry)} onClick={() => void submitUpload()}>
                          <UploadCloud size={14} /> {upBusy ? 'Uploading…' : 'Upload'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={upBusy} onClick={() => { setShowUpload(false); setUpErr(null); }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Request a document from the tenant (Flow 6) */}
                  <div style={{ marginTop: 8, paddingTop: 14, borderTop: '1px dashed var(--mist-strong)' }}>
                    <p className="subhead">Request a document from {contract.tenant.name ?? 'the customer'}</p>
                    <div className="field" style={{ position: 'relative' }}>
                      <input
                        className="input"
                        value={reqLabel}
                        placeholder="Search or type a document name…"
                        onChange={e => { setReqLabel(e.target.value); setReqMenuOpen(true); }}
                        onFocus={() => setReqMenuOpen(true)}
                        onBlur={() => setTimeout(() => setReqMenuOpen(false), 150)}
                        onKeyDown={e => { if (e.key === 'Escape') setReqMenuOpen(false); }}
                      />
                      {reqMenuOpen && (() => {
                        const q = reqLabel.trim().toLowerCase();
                        const matches = REQUESTABLE_DOCS.filter(d => d.toLowerCase().includes(q));
                        if (matches.length === 0 || (matches.length === 1 && matches[0].toLowerCase() === q)) return null;
                        return (
                          <div style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto', background: '#fff', border: '1px solid #e8e6e0', borderRadius: 10, boxShadow: '0 8px 22px rgba(0,0,0,0.10)' }}>
                            {matches.map(d => (
                              <button
                                key={d} type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => { setReqLabel(d); setReqMenuOpen(false); }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#f0faf6')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 13, color: '#1a1916', cursor: 'pointer', background: 'transparent', border: 'none' }}
                              >
                                <FileText size={12} style={{ color: '#9b9890', flexShrink: 0 }} /> {d}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="field">
                      <input className="input" value={reqNotes} placeholder="Instructions for the customer (optional)" onChange={e => setReqNotes(e.target.value)} />
                    </div>
                    {reqErr && <p className="note" style={{ color: 'var(--brick)' }}>{reqErr}</p>}
                    <button className="btn btn-jade btn-sm" disabled={!reqLabel.trim() || reqBusy} onClick={() => void submitRequest()}>
                      <Paperclip size={14} /> {reqBusy ? 'Sending…' : 'Send request'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
          {tab === 'clauses' && (
            <div className="sec">
              <div className="sech"><span className="si"><ClipboardList size={16} /></span><span className="st">Clauses &amp; notes</span></div>
              <div className="secb">
                {clausesEditable ? (
                  /* Editable (draft only) — Flow 2 */
                  <>
                    {clauseList.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                        <button type="button" className="mini-btn no" style={{ marginLeft: 'auto' }} onClick={() => setClauseList(prev => prev.filter((_, j) => j !== i))}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input
                        className="input"
                        value={clauseInput}
                        placeholder="Type a clause and press Enter"
                        onChange={e => setClauseInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addClause(); } }}
                      />
                      <button type="button" className="btn btn-jade btn-sm" onClick={addClause}>Add</button>
                    </div>
                    <div className="field">
                      <label>Notes</label>
                      <textarea className="input" value={clauseNotes} placeholder="Any additional notes for this contract…" onChange={e => setClauseNotes(e.target.value)} />
                    </div>
                    {clauseErr && <p className="note" style={{ color: 'var(--brick)' }}>{clauseErr}</p>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button className="btn btn-jade btn-sm" disabled={clauseBusy} onClick={() => void saveClauses()}>
                        <Check size={14} /> {clauseBusy ? 'Saving…' : 'Save clauses'}
                      </button>
                      {clauseSaved && <span className="note" style={{ color: 'var(--jade-deep)', fontWeight: 700 }}>Saved ✓</span>}
                    </div>
                  </>
                ) : (
                  /* Read-only (issued / active / terminated / expired) */
                  <>
                    {contract.customClauses.map((c, i) => (
                      <div key={i} className="clause">
                        <span className="cn">{i + 1}</span>
                        <span className="ct">{c}</span>
                      </div>
                    ))}
                    {contract.customClauses.length === 0 && <p className="note">No custom clauses on this contract.</p>}
                    {contract.notes && (
                      <div className="field" style={{ marginTop: 12 }}>
                        <label>Notes</label>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--mist-strong)', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--ink-2)' }}>{contract.notes}</div>
                      </div>
                    )}
                    <p className="note" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <BadgeCheck size={12} style={{ color: 'var(--jade-deep)' }} /> Contract sent to customer — clauses are locked.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SignaturePad + Modals (full feature parity with v1)
// ────────────────────────────────────────────────────────────────────────────

function SignaturePad({ onChange }: { onChange: (d: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [has, setHas] = useState(false);
  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    if ('touches' in e) {
      const t = e.touches[0];
      return { x: (t.clientX - r.left) * sx, y: (t.clientY - r.top) * sy };
    }
    return { x: ((e as React.MouseEvent).clientX - r.left) * sx, y: ((e as React.MouseEvent).clientY - r.top) * sy };
  };
  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); setDrawing(true);
  };
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke();
  };
  const end = () => {
    if (drawing) { setDrawing(false); setHas(true); onChange(ref.current!.toDataURL()); }
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHas(false);
    onChange(null);
  };
  return (
    <div>
      <div className="sigpad">
        <canvas
          ref={ref} width={600} height={170}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {!has && <div className="ph">Draw your signature here</div>}
      </div>
      {has && (
        <button className="note" style={{ marginTop: 8, background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={clear}>
          Clear signature
        </button>
      )}
    </div>
  );
}

/** Inline landlord-signature field shown on the page (no modal) so the landlord
 *  can countersign directly. Same role/endpoint as SignModal. */
function InlineLandlordSign({ contract, onSigned }: { contract: ContractDetail; onSigned: () => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(contract.landlord.companyName || contract.landlord.name || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'canvas' | 'typed'>('canvas');

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: { role: 'landlord'; signatoryName: string; method: 'online'; signatureImage?: string; typedName?: string } = {
        role: 'landlord',
        signatoryName: name.trim() || (contract.landlord.companyName || 'Landlord'),
        method: 'online',
      };
      if (mode === 'canvas') body.signatureImage = sig!;
      else                   body.typedName     = name.trim();
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
      setDone(true);          // hold the success state until the parent reload swaps this out
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
      setBusy(false);
    }
  };
  const canSubmit = (mode === 'canvas' ? !!sig : name.trim().length > 0) && !busy;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Sign this contract</div>
          <div className="note">Add your landlord signature below to countersign — no extra steps.</div>
        </div>
      </div>
      <div className="signas">
        <span className="sa-ic"><BadgeCheck size={20} /></span>
        <div>
          <div className="sa-l">Signing as Landlord</div>
          <div className="sa-n">{contract.landlord.companyName || contract.landlord.name || '—'}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={'btn btn-sm ' + (mode === 'canvas' ? 'btn-jade' : 'btn-ghost')} onClick={() => setMode('canvas')}>
          Draw signature
        </button>
        <button type="button" className={'btn btn-sm ' + (mode === 'typed' ? 'btn-jade' : 'btn-ghost')} onClick={() => setMode('typed')}>
          Type name
        </button>
      </div>
      {mode === 'canvas' ? (
        <SignaturePad onChange={setSig} />
      ) : (
        <div className="field">
          <label>Typed name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
      )}
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-jade" disabled={!canSubmit || done} onClick={submit}>
          <Pencil size={14} /> {done ? 'Signed ✓' : busy ? 'Signing…' : 'Sign as Landlord'}
        </button>
      </div>
    </div>
  );
}

/** Inline RP counter-signature for the move-in / move-out inspection — shown on
 *  the step card once the customer has signed, so the landlord doesn't have to
 *  open the inspection workspace just to countersign. Move-in auto-activates. */
function InlineInspectionCounterSign({ contractId, type, onSigned }: {
  contractId: number; type: 'move_in' | 'move_out'; onSigned: () => void;
}) {
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection/sign?type=${type}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureImage: sig }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.message ?? `Sign failed: ${res.status}`);
      }
      setDone(true);          // hold the success state until the parent reload swaps this out
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
      setBusy(false);
    }
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #1a1916)' }}>Counter-sign the inspection</div>
          <div className="note">
            {type === 'move_in'
              ? 'The customer has signed — add your signature to complete move-in and activate the tenancy.'
              : 'The customer has signed — add your signature to complete the move-out inspection.'}
          </div>
        </div>
      </div>
      <SignaturePad onChange={setSig} />
      {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-jade" disabled={!sig || busy || done} onClick={submit}>
          <Pencil size={14} /> {done ? 'Signed ✓' : busy ? 'Signing…' : 'Counter-sign inspection'}
        </button>
      </div>
    </div>
  );
}

function SignModal({
  contract, onClose, onSigned,
}: { contract: ContractDetail; onClose: () => void; onSigned: () => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(contract.landlord.companyName || contract.landlord.name || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'canvas' | 'typed'>('canvas');

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const body: { role: 'landlord'; signatoryName: string; method: 'online'; signatureImage?: string; typedName?: string } = {
        role: 'landlord',
        signatoryName: name.trim() || (contract.landlord.companyName || 'Landlord'),
        method: 'online',
      };
      if (mode === 'canvas') body.signatureImage = sig!;
      else                   body.typedName     = name.trim();
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
      onSigned();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Sign failed');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = (mode === 'canvas' ? !!sig : name.trim().length > 0) && !busy;

  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={17} /></span>
            Sign contract
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <div className="signas">
            <span className="sa-ic"><BadgeCheck size={20} /></span>
            <div>
              <div className="sa-l">Signing as Landlord</div>
              <div className="sa-n">{contract.landlord.companyName || contract.landlord.name || '—'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" className={'btn btn-sm ' + (mode === 'canvas' ? 'btn-jade' : 'btn-ghost')} onClick={() => setMode('canvas')}>
              Draw signature
            </button>
            <button type="button" className={'btn btn-sm ' + (mode === 'typed' ? 'btn-jade' : 'btn-ghost')} onClick={() => setMode('typed')}>
              Type name
            </button>
          </div>
          {mode === 'canvas' ? (
            <SignaturePad onChange={setSig} />
          ) : (
            <div className="field">
              <label>Typed name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-jade btn-sm" disabled={!canSubmit} onClick={submit}>
            <Pencil size={14} /> Sign as Landlord
          </button>
        </div>
      </div>
    </div>
  );
}

function TerminateModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const [reason, setReason] = useState('');
  const [effective, setEffective] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/request`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, effectiveDate: effective }),
      });
      if (!res.ok) throw new Error(`Termination request failed: ${res.status}`);
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Termination request failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--brick)' }}><AlertCircle size={17} /></span>
            Request termination
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="note" style={{ marginBottom: 14 }}>
            {contract.tenant.name ?? 'The customer'} must accept this request before the contract terminates.
          </p>
          <div className="field">
            <label>Reason</label>
            <textarea className="input" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you ending this contract?" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Effective date</label>
            <input type="date" className="input" value={effective} onChange={e => setEffective(e.target.value)} />
          </div>
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-brick btn-sm" disabled={!reason.trim() || !effective || busy} onClick={submit}>
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}

function RenewalProposeModal({
  contract, onClose, onSubmitted,
}: { contract: ContractDetail; onClose: () => void; onSubmitted: () => void }) {
  const ns = new Date(contract.endDate); ns.setDate(ns.getDate() + 1);
  const ne = new Date(ns); ne.setFullYear(ne.getFullYear() + 1); ne.setDate(ne.getDate() - 1);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const [f, setF] = useState({
    newAnnualRent: String(Math.round(contract.annualRent * 1.05)),
    newStartDate: iso(ns),
    newEndDate: iso(ne),
    numberOfInstallments: String(contract.numberOfInstallments ?? 4),
    adminFee: '2000',
    ejariFee: '515',
    commission: '7250',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  const n = parseInt(f.numberOfInstallments) || 0;
  const rent = parseFloat(f.newAnnualRent) || 0;
  const adminN = parseFloat(f.adminFee) || 0;
  const ejariN = parseFloat(f.ejariFee) || 0;
  const commN = parseFloat(f.commission) || 0;
  const base = n ? Math.floor(rent / n) : 0;
  const last = rent - base * (n - 1);
  const rows: { i: number; d: string; a: number; b: boolean }[] = [];
  if (n && rent) {
    rows.push({ i: 1, d: `Admin + Ejari + Commission + Installment 1 (1/${n})`, a: adminN + ejariN + commN + (n === 1 ? last : base), b: true });
    for (let i = 1; i < n; i++) rows.push({ i: i + 1, d: `Rent — Payment ${i + 1}/${n}`, a: i === n - 1 ? last : base, b: false });
  }
  const total = rows.reduce((s, r) => s + r.a, 0);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/renewal/propose`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newAnnualRent: rent,
          newStartDate: f.newStartDate,
          newEndDate: f.newEndDate,
          numberOfInstallments: n,
          adminFee: adminN,
          ejariFee: ejariN,
          commission: commN,
        }),
      });
      if (!res.ok) throw new Error(`Renewal propose failed: ${res.status}`);
      onSubmitted();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Renewal propose failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal lg" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><RotateCcw size={17} /></span>
            Propose renewal
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <p className="subhead mut">Current contract</p>
          <div className="infopanel" style={{ marginBottom: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px' }}>
            <div className="note"><b style={{ color: 'var(--ink)' }}>{contract.tenant.name ?? '—'}</b></div>
            <div className="note">{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</div>
            <div className="note">Unit {contract.unit.number ?? '—'} · {contract.property.buildingName ?? '—'}</div>
            <div className="note">Current rent <b style={{ color: 'var(--ink)' }}>{fmtAed(contract.annualRent)}</b></div>
          </div>
          <p className="subhead mut">Renewal period</p>
          <div className="grid2">
            <div className="field"><label>Start date</label><input type="date" className="input" value={f.newStartDate} onChange={e => set('newStartDate', e.target.value)} /></div>
            <div className="field"><label>End date</label><input type="date" className="input" value={f.newEndDate} onChange={e => set('newEndDate', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Installments</label>
              <select className="input" value={f.numberOfInstallments} onChange={e => set('numberOfInstallments', e.target.value)}>
                {[1, 2, 3, 4, 6, 12].map(x => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>New annual rent (AED)</label>
              <input type="number" className="input" value={f.newAnnualRent} onChange={e => set('newAnnualRent', e.target.value)} />
            </div>
          </div>
          <p className="subhead mut">Fees (AED) — bundle into payment 1</p>
          <div className="grid2">
            <div className="field"><label>Admin fee</label><input type="number" className="input" value={f.adminFee} onChange={e => set('adminFee', e.target.value)} /></div>
            <div className="field"><label>Ejari fee</label><input type="number" className="input" value={f.ejariFee} onChange={e => set('ejariFee', e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="field"><label>Commission</label><input type="number" className="input" value={f.commission} onChange={e => set('commission', e.target.value)} /></div>
            <div className="field"><label>Deposit (carries over)</label><input className="input" value={fmtAed(contract.securityDepositAmount)} disabled style={{ background: 'var(--surface)', color: 'var(--ink-3)' }} /></div>
          </div>
          {rows.length > 0 && (
            <>
              <p className="subhead mut">Planned installments</p>
              <table className="ptable" style={{ border: '1px solid var(--mist-strong)', borderRadius: 12, overflow: 'hidden' }}>
                <thead><tr><th>#</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.i} style={r.b ? { background: '#fdf7ea' } : undefined}>
                      <td>{r.i}</td><td>{r.d}</td>
                      <td className="amt" style={{ textAlign: 'right' }}>{r.a.toLocaleString('en-AE')}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>Total</td><td className="tot" style={{ textAlign: 'right' }}>{total.toLocaleString('en-AE')}</td></tr></tfoot>
              </table>
            </>
          )}
          {err && <p className="note" style={{ color: 'var(--brick)', marginTop: 8 }}>{err}</p>}
        </div>
        <div className="mf">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-jade btn-sm" disabled={busy} onClick={submit}>
            <RotateCcw size={14} /> Propose renewal
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export default function ContractV2Page() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  // Context-aware navigation base: this page is reused by the manager route
  // (/dashboard/manager/contracts/[id]) via re-export. When loaded there, all
  // internal contract links must stay within the manager area instead of the
  // landlord (rental-provider) area. Backend endpoints are already role-aware.
  const pathname = usePathname();
  const contractsBase = pathname.startsWith('/dashboard/manager')
    ? '/dashboard/manager/contracts'
    : '/rental-provider/dashboard/contracts';
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [signatures, setSignatures] = useState<{ role: string; signedAt?: string }[]>([]);
  const [moveInInsp, setMoveInInsp] = useState<MoveInInsp | null>(null);
  const [moveOutInsp, setMoveOutInsp] = useState<MoveInInsp | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<DerivedState['settlementStatus']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<StepKey | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);
  const [modal, setModal] = useState<'sign' | 'terminate' | 'renew' | null>(null);
  // Ejari / DEWA-utility upload (ported from the old page so v2 is self-contained).
  const ejariInputRef = useRef<HTMLInputElement>(null);
  const utilityInputRef = useRef<HTMLInputElement>(null);
  const [ejariUploading, setEjariUploading] = useState(false);
  const [utilityUploading, setUtilityUploading] = useState(false);

  const reload = useCallback(() => {
    if (!params?.id) return;
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/contracts/${params.id}`, { credentials: 'include', signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json() as Promise<ContractDetail>;
      }),
      fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include', signal: ctrl.signal }).then(r =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([data, sigs]) => {
        setContract(data);
        setSignatures(Array.isArray(sigs) ? sigs : []);
        fetch(`/api/contracts/${params.id}/inspection?type=move_in`, { credentials: 'include', signal: ctrl.signal })
          .then(r => (r.ok ? r.json() : null))
          .then((insp: MoveInInsp | null) => setMoveInInsp(insp ?? null))
          .catch(() => null);
        // Load the move-out inspection + settlement once the lease is winding
        // down — either an accepted early termination, or the customer declined
        // the renewal to vacate (move-out at the scheduled lease end).
        const winding = (data.termination?.response === 'accepted' && data.status === 'active')
          || !!data.vacateAtEnd;
        // The wind-down (move-out inspection + deposit settlement) lives on the
        // ACTIVE lease. When the RP opened the archived renewal proposal whose
        // parent is vacating, pull the status from the parent so the declined
        // renewal can show "declined → move-out → settlement" in one place.
        const isArchivedVacateChild = !!data.vacateAtEnd
          && data.contractActive === false && !!data.parentContractId;
        const windDownId = isArchivedVacateChild ? data.parentContractId : params.id;
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
  }, [params?.id]);

  useEffect(() => { void reload(); }, [reload]);

  const derived = useMemo(
    () => contract ? deriveState(contract, signatures, moveInInsp, moveOutInsp, settlementStatus) : null,
    [contract, signatures, moveInInsp, moveOutInsp, settlementStatus],
  );

  // Loading / error
  if (loading && !contract) {
    return <div className="quest-page"><div style={{ padding: 40, textAlign: 'center', color: 'var(--mute)' }}>Loading contract…</div><GlobalStyle /></div>;
  }
  if (error || !contract || !derived) {
    return (
      <div className="quest-page">
        <div style={{ padding: 40, textAlign: 'center' }}>
          <AlertCircle size={36} style={{ color: 'var(--brick)' }} />
          <p style={{ fontWeight: 700, marginTop: 12 }}>Contract not found</p>
          <p className="note">{error ?? 'No data'}</p>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => router.back()}>← Go back</button>
        </div>
        <GlobalStyle />
      </div>
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
  const isWinding = (contract.termination?.response === 'accepted' && contract.status === 'active')
    || (!!contract.vacateAtEnd && contract.contractActive !== false);
  const baseSteps = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const steps = isWinding ? [...baseSteps, MOVE_OUT_STEP, SETTLEMENT_STEP] : baseSteps;
  const doneArr = steps.map(s => isDone(s.key, derived));
  const firstTodo = doneArr.findIndex(x => !x);
  const autoIdx = firstTodo >= 0 ? firstTodo : steps.length - 1;
  const selIdx = selKey ? Math.max(0, steps.findIndex(s => s.key === selKey)) : autoIdx;
  const selStep = steps[selIdx];

  // Lifecycle dead-ends — only the ARCHIVED renewal proposal row is a dead-end.
  // An active lease whose own renewal was declined (incl. decline-to-vacate) is
  // NOT a dead-end: it keeps running to its end and shows the move-out wind-down.
  const isDeclinedRenewal = contract.contractType === 'renewal'
    && contract.renewalAccepted === 'rejected'
    && contract.contractActive === false;
  const isSuperseded = contract.contractType !== 'renewal' && !contract.contractActive && (contract.status === 'pending' || contract.status === 'issued');

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
  // Upload a file to GCS/local via presigned URL, then record the document row.
  async function uploadContractDoc(file: File, displayName: string, keyPrefix: string) {
    if (!contract) return;
    const docKey = `${keyPrefix}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) throw new Error('Failed to get upload URL');
    const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error('File upload failed');
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, category: 'property', documentKey: docKey, displayName, fileUrl, mimeType: file.type || 'application/octet-stream', isVisibleToTenant: true }),
    });
    if (!docRes.ok) throw new Error('Failed to record document');
  }

  const onUploadEjari = () => ejariInputRef.current?.click();
  const onEjariFilePicked = async (file: File) => {
    setEjariUploading(true);
    try {
      await uploadContractDoc(file, 'Ejari', 'ejari');
      // Register Ejari once the certificate is on file.
      await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      });
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Ejari upload failed'); }
    finally { setEjariUploading(false); if (ejariInputRef.current) ejariInputRef.current.value = ''; }
  };
  const onMarkEjari = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/mark-registered`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark Ejari failed: ${res.status}`);
      void reload();
    } catch { setLocalState({ ejariStatus: 'registered' }); }
  };
  const onUploadUtility = () => utilityInputRef.current?.click();
  const onUtilityFilePicked = async (file: File) => {
    setUtilityUploading(true);
    try {
      await uploadContractDoc(file, 'Utility Proof', 'utility');
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
  const onVerifyUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/verify`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Confirm utility failed: ${res.status}`);
      void reload();
    } catch (e) { alert(e instanceof Error ? e.message : 'Could not confirm utility'); }
  };

  // KYC approve / reject (uses existing /api/documents/:id endpoint)
  const onApproveDoc = (id: number) => {
    fetch(`/api/documents/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    }).then(r => { if (r.ok) void reload(); }).catch(() => {});
  };
  const onRejectDoc = (id: number) => {
    fetch(`/api/documents/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    }).then(r => { if (r.ok) void reload(); }).catch(() => {});
  };

  // ── Flow 1: record payment + update status ──
  // POST /api/contracts/:id/payments  (mirrors old page addPaymentInstalment)
  const onRecordPayment = async (body: {
    description?: string; amount: number; paymentType?: string; paymentMethod?: string;
    chequeNumber?: string; transactionDate?: string;
  }) => {
    const res = await fetch(`/api/contracts/${contract.id}/payments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { message?: string }).message ?? `Error ${res.status}`);
    }
    void reload();
  };
  // PATCH /api/contracts/:id/payments/:paymentId — status, or correct amount / reference / description.
  const onUpdatePayment = async (paymentId: number, patch: {
    chequeStatus?: string; amount?: number; chequeNumber?: string | null;
    description?: string | null; transactionDate?: string | null; paymentMethod?: string;
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

  // ── Flow 4: Ejari reset / redo ──  PATCH /api/contracts/:id/ejari/reset
  const onRedoEjari = async () => {
    if (!confirm('Roll the tenancy back to issued and clear the existing Ejari? You will then be able to upload a corrected certificate.')) return;
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/reset`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to reset Ejari'); }
  };

  // ── Flow 5: upload KYC / contract document ──
  // upload-url → PUT → POST /api/documents (mirrors old page uploadDocument payload:
  // ownerType 'tenancy_contract', ownerId = contract.id, with category/visibility/expiry).
  const onUploadDoc = async (
    file: File,
    meta: { key: string; label: string; category: string },
    visibleToTenant: boolean,
    expiryDate: string,
  ) => {
    const docKey = `${meta.key}_${Date.now()}`;
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
    });
    if (!urlRes.ok) {
      const b = await urlRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${urlRes.status}`));
    }
    const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
    const docBody: Record<string, unknown> = {
      ownerType: 'tenancy_contract', ownerId: contract.id, category: meta.category,
      documentKey: docKey, displayName: meta.label, fileUrl,
      mimeType: file.type || 'application/octet-stream', isVisibleToTenant: visibleToTenant,
    };
    if (expiryDate) docBody.expiryDate = expiryDate;
    const docRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(docBody),
    });
    if (!docRes.ok) {
      const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
      throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${docRes.status}`));
    }
    void reload();
  };

  // ── Flow 6: request a document from the tenant ──  POST /api/documents/request
  const onRequestDoc = async (label: string, notes: string) => {
    if (!contract.tenant.id) throw new Error('This contract has no linked customer.');
    const docKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
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
        body: JSON.stringify({ response }),
      });
      if (!res.ok) throw new Error(`Respond failed: ${res.status}`);
      void reload();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Respond failed'); }
  };

  // Once the tenancy reaches a terminal lifecycle (active / expired /
  // terminated) the workflow steps freeze — no "Revert to draft", no
  // "Re-upload" on Ejari / Utility, no undo toggles on the Sign step.
  // The Documents drawer tab stays editable (KYC approve/reject) and the
  // active step's live-management actions (record payment, propose
  // renewal, request termination) are unaffected.
  const readOnlyWorkflow = contract.status === 'active' || contract.status === 'expired' || contract.status === 'terminated';

  // Step content + jump-to-step handler
  const stopOf = (n: number) => mode === 'renewal' ? `Renewal · Stop ${n}` : `Stop ${n} of 6`;
  const handlers: StepHandlers = {
    contract, state: derived,
    setState: setLocalState,
    openModal: setModal,
    openDrawer: setDrawerTab,
    patchContract,
    onActivate, onIssue, onUploadEjari, onMarkEjari, onUploadUtility, onMarkUtility, onVerifyUtility, onRevertToDraft,
    signActionUrl: `${contractsBase}/${contract.id}`,
    inspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_in`,
    moveOutInspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_out`,
    settlementUrl: `${contractsBase}/${contract.id}/settlement`,
    printUrl: `${contractsBase}/${contract.id}/print`,
    contractsBase,
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
          ) : (
            <button className="btn btn-jade" style={{ alignSelf: 'flex-start' }} onClick={() => setModal('renew')}>
              <RotateCcw size={15} /> Propose new renewal
            </button>
          )}
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

  // KYC docs = customer-owned documents in contract.documents.
  // On a RENEWAL, valid documents are already on file, so we only surface the
  // ones that are EXPIRED (they're the only profile docs that need re-collecting).
  // New contracts show the full set.
  const allKycDocs = (contract.documents ?? []).filter(d => d.ownerType === 'customer' || d.ownerType === 'tenant');
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

  return (
    <div className="quest-page">
      <div className="wrap">
        <div className="qhead">
          <div className="lhs">
            <button className="backbtn" onClick={() => router.back()}><ArrowLeft size={18} /></button>
            <div>
              <h1>
                CID-{contract.id} <span className={'pill ' + pill.tone}>{pill.label}</span>
              </h1>
              <div className="hsub">
                <Building2 size={13} /> Unit {contract.unit.number ?? '—'} · {contract.property.buildingName ?? '—'}
                {contract.property.community && <> · {contract.property.community}</>}
              </div>
            </div>
          </div>
          <div className="rhs">
            <Link href={`${contractsBase}/${contract.id}/print`} className="btn btn-ghost btn-sm" target="_blank">
              <Eye size={14} /> Preview
            </Link>
            <Link href={`${contractsBase}/${contract.id}/print`} className="btn btn-ghost btn-sm" target="_blank">
              <Download size={14} /> PDF
            </Link>
            {derived.landlordSigned && (
              <span className="pill celebrate" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <BadgeCheck size={13} /> You signed
              </span>
            )}
          </div>
        </div>

        {/* Vacate-on-renewal-decline — customer won't renew and is moving out.
            The move-out inspection + deposit settlement steps are surfaced below. */}
        {contract.vacateAtEnd && (
          <div className="qbanner waiting" style={{ marginBottom: 4 }}>
            <span className="bic"><Key size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">Customer is vacating — renewal declined</p>
              <p className="bp">
                {contract.tenant.name ?? 'The customer'} won’t renew and will move out
                {contract.endDate ? ` on ${fmtDate(contract.endDate)}` : ' at lease end'}. Complete the move-out inspection and deposit settlement.
              </p>
              {contract.renewalRejectionReason && <div className="quote">&ldquo;{contract.renewalRejectionReason}&rdquo;</div>}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setSelKey('moveout')}>Go to move-out</button>
          </div>
        )}

        {/* Running-but-never-activated lease (imported/synced records land like
            this). The list calls it "Needs Activation" — give the RP the fix
            right here instead of a journey step that contradicts reality. */}
        {isRunningPending && (
          <div className="qbanner waiting" style={{ marginBottom: 4 }}>
            <span className="bic"><RotateCcw size={18} /></span>
            <div style={{ flex: 1 }}>
              <p className="bt">This lease is already running — it just needs activation</p>
              <p className="bp">
                The term started {fmtDate(contract.startDate)} and the tenant is in place, but the
                contract was never switched to Active. Activate it so it counts as a live tenancy
                everywhere; you can backfill documents and cheques afterwards.
              </p>
            </div>
            <button className="btn btn-jade btn-sm" style={{ alignSelf: 'center' }} onClick={() => void onActivate()}>
              Activate now
            </button>
          </div>
        )}

        {/* Missing strip */}
        {!isSuperseded && !isDeclinedRenewal && (
          <MissingStrip
            missing={missingSteps}
            allActive={allActive}
            onJump={(k) => setSelKey(k)}
          />
        )}

        <div className="quest">
          {!isSuperseded && !isDeclinedRenewal && (
            <QuestMap
              steps={steps}
              doneArr={doneArr}
              selectedIdx={selIdx}
              onSelect={(i) => setSelKey(steps[i].key)}
              mode={mode}
            />
          )}
          <div className="acard" style={isSuperseded || isDeclinedRenewal ? { gridColumn: '1 / -1' } : undefined}>
            <div className="ahead">
              <div className="ahl">
                <HeroIcon tone={content.tone} icon={content.icon} />
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow">{content.sub}</div>
                  <h2>{content.headline}</h2>
                </div>
              </div>
              <span className={'pill ' + content.tone}>{content.label}</span>
            </div>
            <p className="abody">{content.body}</p>
            <div className="action-body">{content.node}</div>
            {/* Send the customer a secure link to upload documents + sign — shown
                 at the Signatures / Move-in steps where tenant action is needed. */}
            {(selStep.key === 'sign' || selStep.key === 'movein') && contract.tenant.id && !readOnlyWorkflow && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  {selStep.key === 'movein' ? 'Customer move-in signing link' : 'Customer contract signing link'}
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section={selStep.key === 'movein' ? 'move_in' : 'contract'}
                  label={selStep.key === 'movein' ? 'Send move-in link' : 'Send signing link'}
                />
              </div>
            )}
            {/* Inline landlord signature pad — placed after the customer signing
                 link so the step reads top-to-bottom: statuses → send link →
                 countersign here. */}
            {selStep.key === 'sign' && canLandlordSign && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <InlineLandlordSign contract={contract} onSigned={() => void reload()} />
              </div>
            )}
            {/* Move-in: second link for the on-site inspection manager — they
                 counter-sign the RP side via the same no-login portal, so no
                 separate account is needed. */}
            {selStep.key === 'movein' && contract.tenant.id && !readOnlyWorkflow && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Inspection manager signing link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="move_in"
                  role="inspector"
                  label="Send inspector link"
                />
              </div>
            )}
            {/* Inline RP counter-signature — appears once the customer has signed
                 the move-in inspection, so it can be completed right here. */}
            {selStep.key === 'movein' && derived.moveIn.rpSubmitted && derived.moveIn.tenantSig && !derived.moveIn.rpCounterSig && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <InlineInspectionCounterSign contractId={contract.id} type="move_in" onSigned={() => void reload()} />
              </div>
            )}
            {/* Move-out signing link — available during wind-down even though the
                 onboarding workflow is otherwise frozen (status === active). */}
            {selStep.key === 'moveout' && contract.tenant.id && !derived.moveOut.rpCounterSig && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line, #eee)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink, #1a1916)', marginBottom: 6 }}>
                  Customer move-out signing link
                </div>
                <SendTenantLinkButton
                  tenantId={contract.tenant.id}
                  contractId={contract.id}
                  section="move_out"
                  label="Send move-out link"
                />
              </div>
            )}
            {/* Flow 4: Redo Ejari — roll back to issued so a corrected certificate
                 can be uploaded. Shown on the Ejari step once it is registered and
                 the workflow has not yet frozen (active / expired / terminated). */}
            {selStep.key === 'ejari' && derived.ejariStatus === 'registered' && !readOnlyWorkflow && (
              <button className="ca" style={{ justifySelf: 'start', marginTop: -4, padding: 0, color: 'var(--brick)' }} onClick={() => void onRedoEjari()}>
                <RotateCcw size={12} /> Redo Ejari (reset &amp; re-upload)
              </button>
            )}
            {content.timing && (
              <div className="timing"><Clock size={12} /> {content.timing}</div>
            )}
          </div>
        </div>

        {/* Detail cards */}
        <DetailCards
          contract={contract}
          payments={contract.payments ?? []}
          kycDocs={kycDocs}
          onOpen={(t) => setDrawerTab(t)}
        />

        {/* Addendums (kept below detail cards per product decision) */}
        <div style={{ marginTop: 24 }}>
          <AddendumsPanel contractId={contract.id} role="landlord" contractStatus={contract.status} />
        </div>
      </div>

      <DetailsDrawer
        open={!!drawerTab}
        tab={drawerTab ?? 'parties'}
        setTab={setDrawerTab}
        onClose={() => setDrawerTab(null)}
        contract={contract}
        payments={contract.payments ?? []}
        kycDocs={kycDocs}
        onApproveDoc={onApproveDoc}
        onRejectDoc={onRejectDoc}
        onRecordPayment={onRecordPayment}
        onUpdatePayment={onUpdatePayment}
        onSaveClauses={onSaveClauses}
        onConfirmPdc={onConfirmPdc}
        onUploadDoc={onUploadDoc}
        onRequestDoc={onRequestDoc}
      />

      {modal === 'sign' && <SignModal contract={contract} onClose={() => setModal(null)} onSigned={() => { setModal(null); void reload(); }} />}
      {modal === 'terminate' && <TerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}
      {modal === 'renew' && <RenewalProposeModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}

      {/* Hidden file pickers for inline Ejari / DEWA-utility upload (self-contained, no redirect to the old page). */}
      <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onEjariFilePicked(f); }} />
      <input ref={utilityInputRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUtilityFilePicked(f); }} />
      {(ejariUploading || utilityUploading) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'grid', placeItems: 'center', zIndex: 9999, color: '#fff', font: '600 14px system-ui' }}>
          Uploading {ejariUploading ? 'Ejari' : 'utility'} document…
        </div>
      )}

      <GlobalStyle />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Global style block (scoped to .quest-page wrapper)
// ────────────────────────────────────────────────────────────────────────────

function GlobalStyle() {
  return (
    <style jsx global>{`
      .quest-page {
        --ink: #1a1916; --ink-2: #3d3b35; --ink-3: #54534c;
        --mute: #9b9890; --mute-2: #bdbab2;
        --paper: #ffffff; --surface: #f9f8f6; --mist: #f0ede8; --mist-strong: #e8e6e0;
        --jade: #2e9f82; --jade-deep: #1f5a3f; --jade-soft: #d8f2e8; --jade-tint: #eef8f4;
        --saffron: #f59e0b; --saffron-deep: #c2410c; --saffron-soft: #fff7ed; --saffron-edge: #f0d68f;
        --brick: #c8492c; --brick-deep: #9a3520; --brick-soft: #fdede7; --brick-edge: #f3cabb;
        --r-lg: 22px; --r-md: 16px; --r-sm: 12px;
        --sh-card: 0 1px 2px rgba(26,23,20,.04);
        --sh-hero: 0 24px 60px -32px rgba(26,23,20,.2);
        --sh-pop:  0 30px 70px -24px rgba(26,23,20,.34);
        background: var(--surface); color: var(--ink); min-height: 100vh;
        font-family: inherit;
      }
      .quest-page .wrap { max-width: 1240px; margin: 0 auto; padding: 26px 28px 64px; width: 100%; }
      .quest-page button, .quest-page input, .quest-page select, .quest-page textarea { font-family: inherit; color: inherit; }
      .quest-page .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase; color: var(--mute); }
      .quest-page .note { font-size: 11.5px; color: var(--mute); line-height: 1.5; }

      .quest-page .qhead { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
      .quest-page .qhead .lhs { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .quest-page .backbtn { width: 42px; height: 42px; border-radius: 12px; border: 1px solid var(--mist-strong); background: #fff; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; flex-shrink: 0; }
      .quest-page .backbtn:hover { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .qhead h1 { margin: 0; font-size: 25px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .quest-page .qhead .hsub { font-size: 13px; color: var(--mute); margin-top: 3px; display: flex; align-items: center; gap: 7px; }
      .quest-page .qhead .rhs { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; justify-content: flex-end; }

      .quest-page .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; border-radius: 12px; font-weight: 700; font-size: 14px; border: 1px solid transparent; cursor: pointer; transition: all .15s; line-height: 1; white-space: nowrap; font-family: inherit; text-decoration: none; }
      .quest-page .btn:disabled { opacity: .55; cursor: not-allowed; }
      .quest-page .btn-jade { background: var(--jade); color: #fff; }
      .quest-page .btn-jade:hover:not(:disabled) { background: #268d72; }
      .quest-page .btn-brick { background: var(--brick); color: #fff; }
      .quest-page .btn-brick:hover:not(:disabled) { background: var(--brick-deep); }
      .quest-page .btn-ghost { background: #fff; color: var(--ink-2); border-color: var(--mist-strong); font-weight: 600; }
      .quest-page .btn-ghost:hover:not(:disabled) { border-color: var(--mute-2); color: var(--ink); }
      .quest-page .btn-sm { padding: 10px 15px; font-size: 13px; border-radius: 10px; }
      .quest-page .btn-lg { padding: 15px 24px; font-size: 14.5px; }
      .quest-page .btn-block { width: 100%; }

      .quest-page .pill { display: inline-flex; align-items: center; gap: 6px; padding: 6px 13px; border-radius: 99px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
      .quest-page .pill.action { background: var(--brick-soft); color: var(--brick); }
      .quest-page .pill.waiting { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .pill.celebrate { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .pill.declined { background: var(--mist); color: var(--ink-2); }
      .quest-page .flag { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; padding: 9px 15px; border-radius: 99px; border: 1px solid; white-space: nowrap; }
      .quest-page .flag.waiting { background: var(--saffron-soft); color: var(--saffron-deep); border-color: var(--saffron-edge); }

      .quest-page .quest { display: grid; grid-template-columns: minmax(300px,360px) minmax(0,1fr); gap: 26px; align-items: start; }
      @media (max-width: 1040px) { .quest-page .quest { grid-template-columns: 1fr; } }

      .quest-page .qmap { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 22px 14px; position: sticky; top: 84px; }
      @media (max-width: 1040px) { .quest-page .qmap { position: static; } }
      .quest-page .qmap-h { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding: 0 8px; }
      .quest-page .qmap-l { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--ink-2); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .qmap-l svg { color: var(--brick); }
      .quest-page .qmap-c { font-size: 12px; color: var(--mute); }
      .quest-page .youare { margin-top: 6px; padding: 12px 14px; background: #fff; border: 1px solid var(--mist-strong); border-radius: 14px; display: flex; align-items: center; gap: 11px; }
      .quest-page .youare .yi { width: 30px; height: 30px; border-radius: 99px; display: grid; place-items: center; color: #fff; flex-shrink: 0; }
      .quest-page .youare .yi.here { background: var(--brick); animation: qpulse 2s ease-in-out infinite; }
      .quest-page .youare .yi.done { background: var(--jade-deep); }
      .quest-page .youare .yl { font-size: 9px; color: var(--mute); text-transform: uppercase; letter-spacing: .12em; font-weight: 700; }
      .quest-page .youare .yv { font-size: 13.5px; font-weight: 700; margin-top: 2px; }
      @keyframes qpulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.09); } }

      .quest-page .acard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-lg); padding: 30px 34px; box-shadow: var(--sh-hero); display: flex; flex-direction: column; }
      @media (max-width: 560px) { .quest-page .acard { padding: 24px 20px; } }
      .quest-page .acard .ahead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
      .quest-page .acard .ahl { display: flex; align-items: flex-start; gap: 15px; flex: 1; min-width: 0; }
      .quest-page .heroicon { width: 56px; height: 56px; border-radius: 16px; display: grid; place-items: center; color: #fff; flex-shrink: 0; box-shadow: 0 8px 20px -8px rgba(26,23,20,.4); }
      .quest-page .heroicon.action { background: var(--brick); }
      .quest-page .heroicon.waiting { background: var(--saffron-deep); }
      .quest-page .heroicon.celebrate { background: var(--jade-deep); }
      .quest-page .heroicon.declined { background: var(--ink); }
      .quest-page .acard h2 { margin: 5px 0 0; font-size: 27px; line-height: 1.14; letter-spacing: -.02em; font-weight: 700; }
      .quest-page .acard .abody { font-size: 14.5px; color: var(--ink-2); line-height: 1.6; margin: 18px 0 0; }
      .quest-page .acard .action-body { margin-top: 22px; display: grid; gap: 16px; }
      .quest-page .acard .timing { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mute); margin-top: 22px; padding-top: 16px; border-top: 1px dashed var(--mist-strong); }

      .quest-page .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
      .quest-page .stat { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .stat .sl { font-size: 10px; color: var(--mute); text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
      .quest-page .stat .sv { font-size: 19px; font-weight: 700; letter-spacing: -.02em; margin-top: 6px; font-variant-numeric: tabular-nums; }
      .quest-page .stat .sv.jade { color: var(--jade-deep); }

      .quest-page .qbanner { display: flex; gap: 14px; border: 1px solid; border-radius: var(--r-md); padding: 16px 18px; }
      .quest-page .qbanner .bic { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; background: #fff; }
      .quest-page .qbanner .bt { font-size: 14.5px; font-weight: 700; margin: 0 0 3px; }
      .quest-page .qbanner .bp { font-size: 13px; margin: 0; line-height: 1.5; }
      .quest-page .qbanner .quote { margin-top: 10px; background: #fff; border-radius: 11px; padding: 10px 13px; font-size: 13px; line-height: 1.45; border: 1px solid; }
      .quest-page .qbanner.action { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .qbanner.action .bic { color: var(--brick); }
      .quest-page .qbanner.action .bt { color: var(--brick-deep); }
      .quest-page .qbanner.action .bp { color: var(--brick); }
      .quest-page .qbanner.action .quote { border-color: var(--brick-edge); color: var(--ink-2); }
      .quest-page .qbanner.waiting { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .qbanner.waiting .bic { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bt { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .bp { color: var(--saffron-deep); }
      .quest-page .qbanner.waiting .quote { border-color: var(--saffron-edge); color: var(--ink-2); }

      .quest-page .missing { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--saffron-soft); border: 1px solid var(--saffron-edge); border-radius: 14px; padding: 11px 16px; margin-bottom: 20px; }
      .quest-page .missing .ml { font-size: 11.5px; font-weight: 700; color: var(--saffron-deep); display: flex; align-items: center; gap: 7px; white-space: nowrap; }
      .quest-page .missing .mchip { font-size: 12.5px; font-weight: 600; color: var(--saffron-deep); background: #fff; border: 1px solid var(--saffron-edge); border-radius: 99px; padding: 6px 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .quest-page .missing .mchip:hover { background: var(--saffron-soft); }
      .quest-page .missing.allgood { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .missing.allgood .ml { color: var(--jade-deep); }

      .quest-page .donepanel { display: flex; align-items: center; gap: 13px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 14px; padding: 14px 16px; }
      .quest-page .donepanel .dp-ic { width: 36px; height: 36px; border-radius: 99px; background: var(--jade); color: #fff; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .donepanel .dp-t { font-size: 14px; font-weight: 700; color: var(--jade-deep); }
      .quest-page .donepanel .dp-s { font-size: 12px; color: var(--ink-3); margin-top: 1px; }

      .quest-page .chklist { display: flex; flex-direction: column; gap: 9px; }
      .quest-page .chkrow { display: flex; align-items: center; gap: 12px; font-size: 13.5px; padding: 11px 14px; border: 1px solid var(--mist-strong); border-radius: 12px; background: #fff; }
      .quest-page .chkrow.on { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .chkrow .cb { width: 22px; height: 22px; border-radius: 7px; display: grid; place-items: center; flex-shrink: 0; font-weight: 800; border: 1.5px solid var(--mist-strong); background: #fff; color: transparent; cursor: pointer; transition: all .14s; }
      .quest-page .chkrow.on .cb { background: var(--jade); border-color: var(--jade); color: #fff; }
      .quest-page .chkrow .ct { flex: 1; min-width: 0; }
      .quest-page .chkrow.on .ct { font-weight: 600; }
      .quest-page .ca { display: inline-flex; align-items: center; gap: 4px; width: fit-content; font-size: 12px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; }

      .quest-page .upbox { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; background: var(--surface); border: 1.5px dashed var(--mist-strong); border-radius: 12px; padding: 14px 16px; }
      .quest-page .upbox .uf { display: inline-flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--ink-2); }
      .quest-page .upbox .uf .ufi { width: 34px; height: 34px; border-radius: 9px; background: #fff; border: 1px solid var(--mist-strong); display: grid; place-items: center; color: var(--jade-deep); }

      .quest-page .details-wrap { margin-top: 32px; }
      .quest-page .section-eyebrow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
      .quest-page .section-eyebrow .se-t { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
      .quest-page .section-eyebrow .se-line { flex: 1; height: 1px; background: var(--mist-strong); }
      .quest-page .section-eyebrow .se-link { font-size: 12.5px; font-weight: 600; color: var(--jade-deep); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; background: none; border: 0; }
      .quest-page .detail-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
      .quest-page .dcard { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); padding: 18px 20px; cursor: pointer; transition: all .15s; text-align: left; font-family: inherit; }
      .quest-page .dcard:hover { border-color: var(--mute-2); box-shadow: var(--sh-card); transform: translateY(-2px); }
      .quest-page .dcard .dch { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
      .quest-page .dcard .dci { width: 34px; height: 34px; border-radius: 10px; background: var(--jade-tint); color: var(--jade-deep); display: grid; place-items: center; }
      .quest-page .dcard .dct { font-size: 13.5px; font-weight: 700; flex: 1; }
      .quest-page .dcard .dca { color: var(--mute-2); }
      .quest-page .dcard .drow { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; }
      .quest-page .dcard .drow .k { color: var(--mute); }
      .quest-page .dcard .drow .v { font-weight: 600; text-align: right; }
      .quest-page .dcard .dbadge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 99px; background: var(--saffron-soft); color: var(--saffron-deep); }

      .quest-page .scrim { position: fixed; inset: 0; background: rgba(26,23,20,.4); z-index: 60; opacity: 0; pointer-events: none; transition: opacity .22s; }
      .quest-page .scrim.open { opacity: 1; pointer-events: auto; }
      .quest-page .drawer { position: fixed; top: 0; right: 0; height: 100%; width: 640px; max-width: 94vw; background: var(--surface); z-index: 61; transform: translateX(100%); transition: transform .26s cubic-bezier(.4, 0, .2, 1); display: flex; flex-direction: column; box-shadow: var(--sh-pop); }
      .quest-page .drawer.open { transform: none; }
      .quest-page .drawer .dh { display: flex; align-items: center; justify-content: space-between; padding: 16px 22px; background: #fff; border-bottom: 1px solid var(--mist-strong); flex-shrink: 0; }
      .quest-page .drawer .dh .t { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
      .quest-page .drawer .dh .x { width: 36px; height: 36px; border-radius: 9px; background: var(--surface); border: 0; display: grid; place-items: center; color: var(--ink-2); cursor: pointer; }
      .quest-page .dtabs { display: flex; gap: 2px; overflow-x: auto; background: #fff; border-bottom: 1px solid var(--mist-strong); padding: 0 14px; flex-shrink: 0; scrollbar-width: none; }
      .quest-page .dtabs::-webkit-scrollbar { display: none; }
      .quest-page .dtab { display: flex; align-items: center; gap: 7px; padding: 13px; font-size: 12.5px; font-weight: 700; color: var(--mute); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; }
      .quest-page .dtab:hover { color: var(--ink-2); }
      .quest-page .dtab.on { color: var(--jade-deep); border-bottom-color: var(--jade); }
      .quest-page .dbody { flex: 1; overflow-y: auto; padding: 18px 22px; }
      .quest-page .sec { background: #fff; border: 1px solid var(--mist-strong); border-radius: var(--r-md); overflow: hidden; margin-bottom: 14px; }
      .quest-page .sec .sech { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--mist); }
      .quest-page .sec .sech .si { color: var(--jade-deep); }
      .quest-page .sec .sech .st { font-size: 14px; font-weight: 700; flex: 1; }
      .quest-page .sec .secb { padding: 14px 18px; }
      .quest-page .subhead { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--jade-deep); margin: 0 0 8px; }
      .quest-page .subhead.mut { color: var(--mute); }
      .quest-page .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 520px) { .quest-page .grid2 { grid-template-columns: 1fr; } }
      .quest-page .ptable { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .quest-page .ptable th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mute); font-weight: 700; padding: 8px 8px; border-bottom: 1px solid var(--mist-strong); }
      .quest-page .ptable td { padding: 10px 8px; border-bottom: 1px solid var(--mist); color: var(--ink-2); }
      .quest-page .ptable tr:last-child td { border-bottom: 0; }
      .quest-page .ptable .amt { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
      .quest-page .ptable tfoot td { border-top: 2px solid #bfe3d5; background: var(--jade-tint); font-weight: 800; }
      .quest-page .ptable tfoot .tot { color: var(--jade-deep); }
      .quest-page .cstat { font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; border: 0; }
      .quest-page .cstat.cleared { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .cstat.pending { background: var(--saffron-soft); color: var(--saffron-deep); }
      .quest-page .cstat.bounced { background: var(--brick-soft); color: var(--brick); }
      .quest-page .cstat.cancelled { background: var(--mist); color: var(--ink-3); }
      .quest-page .doclist { display: flex; flex-direction: column; gap: 9px; }
      .quest-page .docitem { display: flex; align-items: center; gap: 12px; border: 1px solid; border-radius: 12px; padding: 11px 14px; }
      .quest-page .docitem .dn { font-size: 13px; font-weight: 600; }
      .quest-page .docitem .ds { font-size: 11px; font-weight: 700; margin-top: 1px; }
      .quest-page .docitem.approved { background: var(--jade-tint); border-color: #cfe9df; }
      .quest-page .docitem.approved svg, .quest-page .docitem.approved .ds { color: var(--jade-deep); }
      .quest-page .docitem.pending { background: var(--saffron-soft); border-color: var(--saffron-edge); }
      .quest-page .docitem.pending svg, .quest-page .docitem.pending .ds { color: var(--saffron-deep); }
      .quest-page .docitem.rejected { background: var(--brick-soft); border-color: var(--brick-edge); }
      .quest-page .docitem.rejected svg, .quest-page .docitem.rejected .ds { color: var(--brick); }
      .quest-page .docitem .dacts { margin-left: auto; display: flex; gap: 6px; }
      .quest-page .mini-btn { font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; border: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
      .quest-page .mini-btn.ok { background: var(--jade-soft); color: var(--jade-deep); }
      .quest-page .mini-btn.no { background: var(--brick-soft); color: var(--brick); }
      .quest-page .mini-btn.view { background: #fff; color: var(--jade-deep); border: 1px solid var(--mist-strong); }
      .quest-page .clause { display: flex; gap: 11px; background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 12px; padding: 11px 14px; margin-bottom: 8px; }
      .quest-page .clause .cn { width: 22px; height: 22px; border-radius: 99px; background: var(--jade); color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; flex-shrink: 0; }
      .quest-page .clause .ct { flex: 1; font-size: 13px; color: var(--ink-2); line-height: 1.45; }
      .quest-page .drow2 { display: flex; justify-content: space-between; gap: 14px; padding: 9px 0; border-bottom: 1px solid var(--mist); font-size: 13px; }
      .quest-page .drow2:last-child { border-bottom: 0; }
      .quest-page .drow2 .k { color: var(--mute); }
      .quest-page .drow2 .v { font-weight: 600; text-align: right; }

      .quest-page .mscrim { position: fixed; inset: 0; background: rgba(26,23,20,.45); backdrop-filter: blur(3px); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 20px; }
      .quest-page .modal { background: #fff; border-radius: 20px; box-shadow: var(--sh-pop); width: 100%; display: flex; flex-direction: column; max-height: 92vh; overflow: hidden; }
      .quest-page .modal.sm { max-width: 460px; }
      .quest-page .modal.lg { max-width: 680px; }
      .quest-page .modal .mh { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid var(--mist); flex-shrink: 0; }
      .quest-page .modal .mt { font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 10px; }
      .quest-page .modal .mt .mti { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff; }
      .quest-page .modal .x { width: 34px; height: 34px; border-radius: 9px; border: 0; background: var(--surface); color: var(--ink-2); display: grid; place-items: center; cursor: pointer; }
      .quest-page .modal .mb { padding: 22px; overflow-y: auto; }
      .quest-page .modal .mf { padding: 14px 22px; border-top: 1px solid var(--mist); display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; }
      .quest-page .sigpad { border: 1.5px dashed var(--mist-strong); border-radius: 12px; background: var(--surface); position: relative; overflow: hidden; }
      .quest-page .sigpad canvas { display: block; width: 100%; height: 170px; cursor: crosshair; touch-action: none; }
      .quest-page .sigpad .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--mute-2); font-size: 13.5px; pointer-events: none; }
      .quest-page .signas { display: flex; align-items: center; gap: 11px; background: var(--jade-tint); border: 1px solid #cfe9df; border-radius: 12px; padding: 12px 15px; margin-bottom: 16px; }
      .quest-page .signas .sa-ic { color: var(--jade-deep); }
      .quest-page .signas .sa-l { font-size: 11px; color: var(--mute); }
      .quest-page .signas .sa-n { font-size: 14px; font-weight: 700; }
      .quest-page .field { margin-bottom: 13px; }
      .quest-page .field label { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink-3); margin-bottom: 5px; }
      .quest-page .input { width: 100%; font-size: 13.5px; padding: 11px 13px; border: 1px solid var(--mist-strong); border-radius: 10px; background: #fff; }
      .quest-page .input:focus { outline: none; border-color: var(--jade); }
      .quest-page textarea.input { resize: vertical; min-height: 70px; }
      .quest-page .infopanel { background: var(--surface); border: 1px solid var(--mist-strong); border-radius: 14px; padding: 16px 18px; }
    `}</style>
  );
}
