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

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, FileText, FileSignature, Stamp, Zap, Key, BadgeCheck,
  ChevronRight, ChevronDown, MapPin, Clock, Bell, Search,
  User, Building2, Calendar, DollarSign, CreditCard, Paperclip,
  ClipboardList, ListChecks, RotateCcw, X, AlertCircle, Check,
  UploadCloud, Eye, Download, ExternalLink, Pencil, ClipboardCheck,
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
  amountPaid: number;
  transactionDate: string | null;
  chequeStatus?: string | null;
  paidAt?: string | null;
  reference?: string | null;
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
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
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
  parentContractId?: number | null;
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

type StepKey = 'issue' | 'sign' | 'ejari' | 'utility' | 'movein' | 'active' | 'terms';
type Tone = 'action' | 'waiting' | 'celebrate' | 'declined';
type IconKey = 'document' | 'pen' | 'stamp' | 'bolt' | 'key' | 'active' | 'envelope' | 'alert' | 'clock';

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

interface DerivedState {
  status: ContractDetail['status'];
  ejariStatus: ContractDetail['ejariStatus'];
  tenantSigned: boolean;
  landlordSigned: boolean;
  utilityDoc: boolean;
  moveIn: { rpSubmitted: boolean; tenantSig: boolean; rpCounterSig: boolean };
}

function isDone(key: StepKey, st: DerivedState): boolean {
  switch (key) {
    case 'issue':   return st.status !== 'pending';
    case 'sign':    return st.tenantSigned && st.landlordSigned;
    case 'ejari':   return st.ejariStatus === 'registered';
    case 'utility': return st.utilityDoc;
    case 'movein':  return st.moveIn.rpCounterSig;
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

function spaceCategoryFromUnitType(unitType: string | null): string {
  if (!unitType) return 'residential';
  const t = unitType.toLowerCase();
  if (['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'].includes(t)) return 'industrial';
  if (['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical',
       'coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue',
       'conference_hall','private_dining','outdoor_venue'].includes(t)) return 'commercial';
  return 'residential';
}

function deriveState(contract: ContractDetail, signatures: { role: string }[], insp: MoveInInsp | null): DerivedState {
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
  };
  const Ic = map[icon];
  return <div className={'heroicon ' + tone}><Ic size={26} /></div>;
}

function Completed({ title, sub, onUndo, undoLabel }: { title: string; sub?: string; onUndo?: () => void; undoLabel?: string }) {
  return (
    <div className="donepanel">
      <span className="dp-ic"><Check size={18} /></span>
      <div>
        <div className="dp-t">{title}</div>
        {sub && <div className="dp-s">{sub}</div>}
      </div>
      {onUndo && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={onUndo}>{undoLabel || 'Update'}</button>}
    </div>
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
  onRevertToDraft: () => Promise<void>;
  signActionUrl: string;
  inspectionUrl: string;
  printUrl: string;
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
    return done
      ? {
          tone: 'celebrate', icon: 'stamp', sub: 'Stop 3 · complete', label: 'Ejari',
          headline: mode === 'renewal' ? 'Ejari renewed.' : 'Ejari registered.',
          body: 'Certificate is on file with the Dubai Land Department.',
          timing: null,
          node: <Completed title="Registered with DLD" sub="Ejari-certificate.pdf" />,
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
    return done
      ? {
          tone: 'celebrate', icon: 'bolt', sub: 'Stop 4 · complete', label: 'Utility',
          headline: 'Utility account confirmed.',
          body: 'DEWA activation proof is on file.',
          timing: null,
          node: <Completed title="DEWA proof uploaded" sub="DEWA-activation.pdf" />,
        }
      : {
          tone: 'action', icon: 'bolt', sub: stopOf(4), label: 'Utility',
          headline: 'Attach the utility activation.',
          body: `Add the DEWA proof, let ${TEN} upload it, or mark it on file for imported leases.`,
          timing: 'Takes ~1 min',
          node: <UploadAction fileLabel="DEWA-activation.pdf" onUpload={h.onUploadUtility} onMark={() => h.onMarkUtility()} />,
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
        <div className="qbanner waiting">
          <span className="bic"><Clock size={18} /></span>
          <div style={{ flex: 1 }}>
            <p className="bt">Effective {fmtDate(h.contract.termination.effectiveDate)}</p>
            <p className="bp">Both parties have agreed. Prepare the final inspection and security-deposit settlement.</p>
          </div>
        </div>
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
              <div className="sv">{next ? fmtAed(next.amountPaid) : '—'}</div>
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
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-jade" onClick={() => h.openDrawer('payments')}>
              <CreditCard size={14} /> Record payment
            </button>
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
          <div className="drow"><span className="k">Annual rent</span><span className="v">{fmtAed(contract.annualRent)}</span></div>
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
          <span className="se-link" style={{ marginTop: 6, alignSelf: 'flex-start' }}>View all documents <ChevronRight size={13} /></span>
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
}: {
  open: boolean; tab: DrawerTab; setTab: (t: DrawerTab) => void; onClose: () => void;
  contract: ContractDetail; payments: ContractPayment[]; kycDocs: ContractDoc[];
  onApproveDoc: (id: number) => void; onRejectDoc: (id: number) => void;
}) {
  const rentTotal = payments.reduce((s, p) => s + (p.amountPaid || 0), 0);
  const depositRow = payments.find(p => p.paymentType === 'security_deposit');
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
                      <thead><tr><th>Amount</th><th>Reference</th><th>Date</th><th>Status</th></tr></thead>
                      <tbody>
                        <tr>
                          <td className="amt">{fmtAed(depositRow.amountPaid)}</td>
                          <td style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{depositRow.reference ?? '—'}</td>
                          <td>{fmtDate(depositRow.transactionDate)}</td>
                          <td><span className={'cstat ' + (depositRow.chequeStatus ?? 'cleared')}>{(depositRow.chequeStatus ?? 'Cleared').replace(/^./, c => c.toUpperCase())}</span></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="sec">
                <div className="sech"><span className="si"><CreditCard size={16} /></span><span className="st">Rental instalments</span></div>
                <div className="secb">
                  <table className="ptable">
                    <thead><tr><th>#</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {payments.filter(p => p.paymentType !== 'security_deposit').map((p, i) => (
                        <tr key={p.id}>
                          <td>{i + 1}</td>
                          <td>{p.description ?? '—'}</td>
                          <td className="amt">{fmtAed(p.amountPaid)}</td>
                          <td><span className={'cstat ' + (p.chequeStatus ?? 'pending')}>{(p.chequeStatus ?? 'Pending').replace(/^./, c => c.toUpperCase())}</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={2}>Total</td><td className="tot">{fmtAed(rentTotal)}</td><td /></tr>
                    </tfoot>
                  </table>
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
            const openAll = () => all.forEach(d => d.fileUrl && window.open(d.fileUrl, '_blank', 'noopener'));
            return (
              <div className="sec">
                <div className="sech">
                  <span className="si"><Paperclip size={16} /></span>
                  <span className="st">All documents ({all.length})</span>
                  {all.length > 0 && (
                    <button type="button" className="mini-btn view" style={{ marginLeft: 'auto' }} onClick={openAll}>
                      <ExternalLink size={12} /> View all together
                    </button>
                  )}
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
                </div>
              </div>
            );
          })()}
          {tab === 'clauses' && (
            <div className="sec">
              <div className="sech"><span className="si"><ClipboardList size={16} /></span><span className="st">Clauses &amp; notes</span></div>
              <div className="secb">
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
      const res = await fetch(`/api/contracts/${contract.id}/renew/propose`, {
        method: 'POST',
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<StepKey | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);
  const [modal, setModal] = useState<'sign' | 'terminate' | 'renew' | null>(null);

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
    () => contract ? deriveState(contract, signatures, moveInInsp) : null,
    [contract, signatures, moveInInsp],
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
  const steps = mode === 'renewal' ? STEPS_RENEWAL : STEPS_NEW;
  const doneArr = steps.map(s => isDone(s.key, derived));
  const firstTodo = doneArr.findIndex(x => !x);
  const autoIdx = firstTodo >= 0 ? firstTodo : steps.length - 1;
  const selIdx = selKey ? Math.max(0, steps.findIndex(s => s.key === selKey)) : autoIdx;
  const selStep = steps[selIdx];

  // Lifecycle dead-ends
  const isDeclinedRenewal = contract.contractType === 'renewal' && contract.renewalAccepted === 'rejected';
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
  const onUploadEjari = () => {
    router.push(`${contractsBase}/${contract.id}#ejari-upload`);
  };
  const onMarkEjari = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/mark-registered`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark Ejari failed: ${res.status}`);
      void reload();
    } catch { setLocalState({ ejariStatus: 'registered' }); }
  };
  const onUploadUtility = () => {
    router.push(`${contractsBase}/${contract.id}#utility-upload`);
  };
  const onMarkUtility = async () => {
    try {
      const res = await fetch(`/api/contracts/${contract.id}/utility/mark-on-file`, { method: 'PATCH', credentials: 'include' });
      if (!res.ok) throw new Error(`Mark utility failed: ${res.status}`);
      void reload();
    } catch { setLocalState({ utilityDoc: true }); }
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
    onActivate, onIssue, onUploadEjari, onMarkEjari, onUploadUtility, onMarkUtility, onRevertToDraft,
    signActionUrl: `${contractsBase}/${contract.id}`,
    inspectionUrl: `${contractsBase}/${contract.id}/inspection?type=move_in`,
    printUrl: `${contractsBase}/${contract.id}/print`,
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
    content = {
      tone: 'declined', icon: 'alert', sub: 'Renewal closed', label: 'Renewal declined',
      headline: 'The customer declined this renewal.',
      body: 'The proposal is archived and the original lease keeps running. You can propose fresh terms anytime.',
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
          {contract.successorProposal ? (
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

  // KYC docs = customer-owned documents in contract.documents
  const kycDocs = (contract.documents ?? []).filter(d => d.ownerType === 'customer' || d.ownerType === 'tenant');

  return (
    <div className="quest-page">
      <div className="wrap">
        <div className="qhead">
          <div className="lhs">
            <button className="backbtn" onClick={() => router.back()}><ArrowLeft size={18} /></button>
            <div>
              <h1>
                CID-{contract.id} <span className={'pill ' + content.tone}>{content.label}</span>
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
          </div>
        </div>

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
      />

      {modal === 'sign' && <SignModal contract={contract} onClose={() => setModal(null)} onSigned={() => { setModal(null); void reload(); }} />}
      {modal === 'terminate' && <TerminateModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}
      {modal === 'renew' && <RenewalProposeModal contract={contract} onClose={() => setModal(null)} onSubmitted={() => { setModal(null); void reload(); }} />}

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
      .quest-page .chkrow .ca { font-size: 12px; font-weight: 700; color: var(--jade-deep); background: none; border: 0; cursor: pointer; text-decoration: underline; white-space: nowrap; }

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
