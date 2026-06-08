/**
 * Rental Provider — Contract Detail page (rental-provider/dashboard/contracts/[id])
 *
 * Full contract management view for the RP. Includes:
 *   - 5-step non-renewal timeline: Contract Issued → Signatures → Ejari
 *     Registration → Move-In & Utility → Active Tenancy
 *     (Payment collection happens upstream on the lead/plan, not on the contract.)
 *   - 4-step renewal timeline (separate branch): Terms Agreed → Signatures
 *     → Ejari Renewal → Active Renewal
 *   - Payment ledger, security deposits, signatures, custom clauses
 *   - Ejari status update, contract activation, document attachments
 *
 * The ContractDetail TypeScript interface has NO `viewing` field. The backend
 * returns it (reserved for SCRUM-403 move-in inspection) but this page does
 * not consume it — do not add it to the interface until building SCRUM-403.
 *
 * GAP-G9: The "Activate tenancy" button is a known open bug — it is missing
 * from this page's current implementation.
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, FileText, CheckCircle, Loader2, AlertCircle, X,
  User, Building2, Calendar, DollarSign, Pencil, RotateCcw,
  FileSignature, Download, BadgeCheck, ChevronDown, ChevronUp,
  ClipboardList, Plus, Trash2, Paperclip, UploadCloud, ExternalLink,
  CreditCard, ListChecks, Eye, ChevronRight, ClipboardCheck, ZoomIn,
} from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
import LbZoom from 'yet-another-react-lightbox/plugins/zoom';
import LbCaptions from 'yet-another-react-lightbox/plugins/captions';
import LbThumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import { AddendumsPanel } from '@/components/upnow/AddendumsPanel';

// ─── Types ─────────────────────────────────────────────────────────────────

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
  amount: number;
  charges: number;
  chequeNumber: string | null;
  chequeStatus: string;
  payerName: string | null;
  transactionDate: string | null;
  createdAt: string;
}

interface ContractDetail {
  id: number;
  ref: string;
  contractType: string;
  status: string;
  ejariStatus: string | null;
  contractActive: boolean;
  contractSent: boolean;
  pdcConfirmed: boolean;
  pdcConfirmedAt: string | null;
  tenantChequesSubmittedAt: string | null;
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
  // Renewal fields (SCRUM-272/273 + Phase 6c reject reason)
  renewalAccepted: 'pending' | 'accepted' | 'rejected' | null;
  renewalStatus: string | null;
  renewalRejectionReason?: string | null;
  parentContractId?: number | null;
  /** Phase 6c — when this contract is a DECLINED renewal child and the RP has
   *  subsequently proposed a fresh renewal on the same parent, the backend
   *  inlines the active sibling here so the declined detail page can link
   *  forward to "the proposal that replaced this one". */
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

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Map a unit type (apartment / villa / retail_shop / warehouse / …) to the
 *  space category used by the RP's fee rule settings. Mirrors the backend
 *  classifier in fee-rules.service so the renewal modal auto-fills from the
 *  correct rule set. Unknown types default to residential. */
function spaceCategoryFromUnitType(unitType: string | null): string {
  if (!unitType) return 'residential';
  const t = unitType.toLowerCase();
  if (['warehouse','open_yard','storage_unit','cold_storage','logistics_facility'].includes(t)) return 'industrial';
  if (['retail_shop','showroom','office_fitted','office_shell_core','restaurant_fnb','clinic_medical',
       'coworking_desk','private_office','meeting_room','day_office','event_hall','wedding_venue',
       'conference_hall','private_dining','outdoor_venue'].includes(t)) return 'commercial';
  return 'residential';
}

function fmtAed(fils: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(fils);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Signature Pad ─────────────────────────────────────────────────────────

function SignaturePad({ onSignatureChange }: { onSignatureChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  const getPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1916';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [isDrawing, getPos]);

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      setHasDrawn(true);
      const canvas = canvasRef.current;
      if (canvas) onSignatureChange(canvas.toDataURL('image/png'));
    }
  }, [isDrawing, onSignatureChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(false);
      onSignatureChange(null);
    }
  }, [onSignatureChange]);

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-[#e8e6e0] rounded-xl bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={560}
          height={140}
          className="w-full cursor-crosshair touch-none"
          style={{ height: '140px' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[#c0bdb8] text-sm">Draw your signature here</span>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button onClick={clear} type="button"
          className="flex items-center gap-1.5 text-xs text-[#9b9890] hover:text-[#1a1916] transition">
          <RotateCcw size={12} /> Clear signature
        </button>
      )}
    </div>
  );
}

// ─── Row helper ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-[#f4f3ef] last:border-0">
      <span className="text-xs text-[#9b9890] shrink-0 w-36">{label}</span>
      <span className="text-xs font-semibold text-[#1a1916] text-right">{value ?? '—'}</span>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, defaultOpen = true, headerAction }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
  headerAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => setOpen(o => !o)}
        >
          <Icon size={15} className="text-[#2e9f82]" />
          <span className="text-sm font-semibold text-[#1a1916]">{title}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {headerAction}
          <button type="button" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronUp size={14} className="text-[#9b9890]" /> : <ChevronDown size={14} className="text-[#9b9890]" />}
          </button>
        </div>
      </div>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    issued: 'bg-blue-50 text-blue-700 border-blue-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    expired: 'bg-[#f4f3ef] text-[#6b6860] border-[#e8e6e0]',
    terminated: 'bg-red-50 text-red-700 border-red-200',
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Sign Modal ────────────────────────────────────────────────────────────

type SignMode = 'online' | null;

function SignModal({
  contract,
  onClose,
  onSigned,
}: {
  contract: ContractDetail;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const signatoryName = contract.landlord.companyName ?? contract.landlord.name ?? 'Landlord';

  async function handleOnlineSign() {
    if (!signatureImage) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/sign`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'landlord', signatureImage, signatoryName, method: 'online' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string })?.message ?? `Error ${res.status}`);
      }
      setDone(true);
      setTimeout(() => onSigned(), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save signature');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#f0ede8] flex items-center justify-between" style={{ background: '#2e9f82' }}>
          <div className="flex items-center gap-2">
            <FileSignature size={16} className="text-white" />
            <span className="text-sm font-bold text-white">Sign Contract — {contract.ref}</span>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white text-xs">✕</button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 gap-3">
            <CheckCircle size={40} className="text-[#2e9f82]" />
            <p className="text-sm font-semibold text-[#1a1916]">Signature recorded!</p>
          </div>
        ) : (
          /* Online sign */
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#f0faf6] border border-[#c5e8df]">
              <BadgeCheck size={15} className="text-[#2e9f82] shrink-0" />
              <div>
                <p className="text-[11px] text-[#6b6860]">Signing as Landlord</p>
                <p className="text-sm font-semibold text-[#1a1916]">{signatoryName}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6b6860]">Draw your signature</label>
              <SignaturePad onSignatureChange={setSignatureImage} />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <button
              onClick={handleOnlineSign}
              disabled={!signatureImage || submitting}
              className="w-full py-3 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting
                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : <><Pencil size={14} /> Sign as Landlord</>
              }
            </button>
            <p className="text-[10px] text-center text-[#b0ada8]">By signing, you agree to the terms of this contract.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────

// ── Reusable vertical timeline step row ──────────────────────────────────────
type TLStepState = 'done' | 'current' | 'upcoming';
function StepRow({ num, label, state, last, children }: {
  num: number; label: string; state: TLStepState; last: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-[11px] font-bold shrink-0 ${
          state === 'done'    ? 'bg-[#2e9f82] border-[#2e9f82] text-white' :
          state === 'current' ? 'bg-white border-[#2e9f82] text-[#2e9f82]' :
                                 'bg-white border-[#e8e6e0] text-[#c0bdb8]'
        }`}>{state === 'done' ? '✓' : num}</div>
        {!last && <div className={`w-0.5 flex-1 min-h-[20px] mt-1 mb-1 ${ state === 'done' ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? 'pb-2' : 'pb-4'}`}>
        <p className={`text-sm font-semibold leading-tight ${
          state === 'done'    ? 'text-[#2e9f82]' :
          state === 'current' ? 'text-[#1a1916]' : 'text-[#c0bdb8]'
        }`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSignModal, setShowSignModal] = useState(false);
  const [signedMode, setSignedMode] = useState<'online' | null>(null);
  const [clauses, setClauses] = useState<string[]>([]);
  const [clauseNotes, setClauseNotes] = useState('');
  const [clauseInput, setClauseInput] = useState('');
  const [savingClauses, setSavingClauses] = useState(false);
  const [clauseSaved, setClauseSaved] = useState(false);
  const [clauseSaveError, setClauseSaveError] = useState<string | null>(null);
  const [payments, setPayments] = useState<ContractPayment[]>([]);
  const [updatingPayment, setUpdatingPayment] = useState<number | null>(null);
  const [showAddInstalment, setShowAddInstalment] = useState(false);
  const [addingInstalment, setAddingInstalment] = useState(false);
  const [newInstalment, setNewInstalment] = useState({ description: '', amount: '', chequeNumber: '', transactionDate: '' });
  const [docs, setDocs] = useState<ContractDoc[]>([]);
  const [tenantUtilityDoc, setTenantUtilityDoc] = useState<ContractDoc | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDocType, setUploadDocType] = useState('');
  const [uploadVisible, setUploadVisible] = useState(false);
  const [uploadExpiry, setUploadExpiry] = useState('');
  const [feeError, setFeeError] = useState<string | null>(null);
  const [hasTenantSigned, setHasTenantSigned] = useState(false);
  const [moveInConfirmed, setMoveInConfirmed] = useState(false);
  const [markingStep, setMarkingStep] = useState<string | null>(null);
  const [confirmingPdc, setConfirmingPdc] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);
  const [terminateReason, setTerminateReason] = useState('');
  const [terminateEffectiveDate, setTerminateEffectiveDate] = useState('');
  const [terminateSubmitting, setTerminateSubmitting] = useState(false);
  const [terminateError, setTerminateError] = useState<string | null>(null);
  const [terminateResponding, setTerminateResponding] = useState(false);
  // Renewal proposal (SCRUM-273)
  const [showRenewalModal, setShowRenewalModal] = useState(false);
  const [renewalSubmitting, setRenewalSubmitting] = useState(false);
  const [renewalError, setRenewalError] = useState<string | null>(null);
  const [renewalForm, setRenewalForm] = useState({
    newAnnualRent: '',
    newStartDate: '',
    newEndDate: '',
    numberOfInstallments: '4',
    modeOfPayment: 'cheque',
    samePayee: true,
    chequePayeeName: '',
    adminFee: '',
    ejariFee: '',
    commission: '',
  });

  // Phase 6 — RP's saved fee rules, fetched when the modal opens. Used to
  // auto-compute admin / ejari / commission from the typed annual rent so the
  // renewal proposal mirrors the RP's settings instead of just copying the
  // previous contract's numbers. Each fee carries a "touched" flag — once the
  // RP edits a field by hand, auto-recompute stops touching it.
  type FeeRule = { feeType: string; valueType: 'fixed_aed' | 'percentage'; value: number; isActive: boolean };
  const [feeRules, setFeeRules] = useState<Record<string, FeeRule[]> | null>(null);
  const [feesTouched, setFeesTouched] = useState({ adminFee: false, ejariFee: false, commission: false });
  const [renewalExtras, setRenewalExtras] = useState<Array<{ description: string; amount: string; dueDate: string }>>([]);
  type TenantKycDoc = { id: number; documentKey: string; displayName: string | null; fileUrl: string; mimeType: string | null; status: string; notes: string | null };
  const [tenantKycDocs, setTenantKycDocs] = useState<TenantKycDoc[] | null>(null);
  const [tenantKycLoading, setTenantKycLoading] = useState(false);
  const [reviewingDocId, setReviewingDocId] = useState<number | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<number | null>(null);
  const [viewAllOpen,   setViewAllOpen]   = useState(false);
  const [lightboxOpen,  setLightboxOpen]  = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [rejectionReason, setRejectionReason] = useState('');
  const [docRequestInput, setDocRequestInput] = useState('');
  const [docRequestNotes, setDocRequestNotes] = useState('');
  const [docRequesting, setDocRequesting] = useState(false);
  const [depChequeNo, setDepChequeNo] = useState('');
  const [depDate, setDepDate] = useState('');
  const [recordingDeposit, setRecordingDeposit] = useState(false);
  const ejariInputRef = useRef<HTMLInputElement>(null);
  const [ejariFile, setEjariFile] = useState<File | null>(null);
  const [ejariUploading, setEjariUploading] = useState(false);
  const [ejariError, setEjariError] = useState<string | null>(null);
  const [ejariResetting, setEjariResetting] = useState(false);
  const utilityInputRef = useRef<HTMLInputElement>(null);
  const [utilityFile, setUtilityFile] = useState<File | null>(null);
  const [utilityUploading, setUtilityUploading] = useState(false);
  const [utilityError, setUtilityError] = useState<string | null>(null);
  const [moveInInsp, setMoveInInsp] = useState<{
    rpSubmittedAt?: string | null;
    tenantSig?: string | null;
    rpCounterSig?: string | null;
    rpCounterSignedAt?: string | null;
  } | null>(null);
  // Inline RP counter-sign for the move-in inspection (Step 5).
  const [inspSigImg, setInspSigImg]       = useState<string | null>(null);
  const [inspSigBusy, setInspSigBusy]     = useState(false);
  const [inspSigError, setInspSigError]   = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    // AbortController guards against StrictMode's double-mount (and fast
    // navigation) firing duplicate concurrent loads — aborted on cleanup.
    const ctrl = new AbortController();
    const { signal } = ctrl;
    Promise.all([
      fetch(`/api/contracts/${params.id}`, { credentials: 'include', signal }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      }),
      fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include', signal }).then(r =>
        r.ok ? r.json() : []
      ),
    ])
      .then(([data, sigs]) => {
        setContract(data);
        setClauses(data.customClauses ?? []);
        setClauseNotes(data.notes ?? '');
        setDocs(data.documents ?? []);
        setPayments(data.payments ?? []);
        const hasLandlordSig = Array.isArray(sigs) && sigs.some((s: { role: string }) => s.role === 'landlord');
        const hasTenantSig   = Array.isArray(sigs) && sigs.some((s: { role: string }) => s.role === 'tenant');
        if (hasLandlordSig) setSignedMode('online');
        if (hasTenantSig)   setHasTenantSigned(true);

        // Load move-in inspection signing state for Step 4 status display.
        fetch(`/api/contracts/${params.id}/inspection?type=move_in`, { credentials: 'include', signal })
          .then(r => r.ok ? r.json() : null)
          .then((insp: { rpSubmittedAt?: string | null; tenantSig?: string | null; rpCounterSig?: string | null; rpCounterSignedAt?: string | null } | null) => {
            if (insp) setMoveInInsp({ rpSubmittedAt: insp.rpSubmittedAt, tenantSig: insp.tenantSig, rpCounterSig: insp.rpCounterSig, rpCounterSignedAt: insp.rpCounterSignedAt });
          })
          .catch(() => null);

        // Also check tenant's own documents for utility proof (uploaded by tenant or admin)
        const tenantId = data?.tenant?.id;
        if (tenantId) {
          fetch(`/api/documents?ownerType=customer&ownerId=${tenantId}`, { credentials: 'include', signal })
            .then(r => r.ok ? r.json() : [])
            .then((tenantDocs: ContractDoc[]) => {
              const utilityDocFound = Array.isArray(tenantDocs) ? tenantDocs.find((d) => d.documentKey === 'utility_proof_of_payment') : null;
              if (utilityDocFound) setTenantUtilityDoc(utilityDocFound);
            })
            .catch(() => null);
        }
      })
      .catch(e => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [params?.id]);

  // Phase 6 — auto-fill admin / ejari / commission from the RP's saved fee
  // rules whenever the renewal rent changes, unless the RP has manually
  // touched that specific field. Keeps the modal aligned with /settings/fees
  // and removes the "remember to blank the field" trick.
  useEffect(() => {
    if (!showRenewalModal || !feeRules || !contract) return;
    const cat = spaceCategoryFromUnitType(contract.unit?.type ?? null);
    const rules = feeRules[cat] ?? feeRules['residential'] ?? [];
    const rent = parseFloat(renewalForm.newAnnualRent) || 0;
    const applyRule = (feeType: string): string => {
      const r = rules.find(x => x.feeType === feeType && x.isActive !== false);
      if (!r) return '';
      const v = r.valueType === 'percentage' ? rent * Number(r.value) / 100 : Number(r.value);
      return v > 0 ? String(Math.round(v)) : '';
    };
    setRenewalForm(f => ({
      ...f,
      adminFee:   feesTouched.adminFee   ? f.adminFee   : applyRule('admin_fee'),
      ejariFee:   feesTouched.ejariFee   ? f.ejariFee   : applyRule('ejari_fee'),
      commission: feesTouched.commission ? f.commission : applyRule('commission'),
    }));
  }, [showRenewalModal, feeRules, renewalForm.newAnnualRent, feesTouched, contract]);

  // Load tenant rental documents when the Documents drawer opens.
  // For RENEWAL contracts the tenant uploads to ownerType='tenancy_contract', ownerId=<child id>
  // (isolated per renewal). For the original lease, docs sit on the customer profile.
  useEffect(() => {
    if (activeDrawer !== 'documents') return;
    if (tenantKycDocs !== null) return; // already loaded
    if (!contract) return;
    const tenantId = contract.tenant?.id;
    const isRenewal = contract.contractType === 'renewal';
    if (!isRenewal && !tenantId) return;
    setTenantKycLoading(true);
    const url = isRenewal
      ? `/api/documents?ownerType=tenancy_contract&ownerId=${contract.id}`
      : `/api/documents?ownerType=customer&ownerId=${tenantId}`;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setTenantKycDocs(Array.isArray(data) ? data : []))
      .catch(() => setTenantKycDocs([]))
      .finally(() => setTenantKycLoading(false));
  }, [activeDrawer, contract, tenantKycDocs]);

  async function handleKycDocAction(docId: number, action: 'verify' | 'reject', reason?: string) {
    setReviewingDocId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'reject' ? JSON.stringify({ reason: reason ?? '' }) : undefined,
      });
      if (!res.ok) return;
      setRejectingDocId(null);
      setRejectionReason('');
      // Refresh docs list after action
      setTenantKycDocs(null); // triggers reload in useEffect
    } finally {
      setReviewingDocId(null);
    }
  }

  async function handleRequestDoc() {
    const label = docRequestInput.trim();
    if (!label || !contract?.tenant?.id) return;
    setDocRequesting(true);
    try {
      const docKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now();
      const res = await fetch('/api/documents/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'customer',
          ownerId: contract.tenant.id,
          documentKey: docKey,
          displayName: label,
          category: 'contract',
          notes: docRequestNotes.trim() || undefined,
        }),
      });
      if (res.ok) {
        setDocRequestInput('');
        setDocRequestNotes('');
        setTenantKycDocs(null); // triggers reload
      }
    } finally {
      setDocRequesting(false);
    }
  }

  async function uploadDocument(file: File, docTypeMeta: { key: string; label: string; category: string }, visibleToTenant: boolean, expiryDate: string) {
    if (!contract) return;
    setUploadingDoc(true);
    setUploadError(null);
    const docKey = `${docTypeMeta.key}_${Date.now()}`;
    try {
      // Step 1: get upload URL
      let urlRes: Response;
      try {
        urlRes = await fetch('/api/documents/upload-url', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerType: 'tenancy_contract',
            ownerId: contract.id,
            documentKey: docKey,
            mimeType: file.type || 'application/octet-stream',
            originalName: file.name,
          }),
        });
      } catch (netErr) {
        throw new Error(`Step 1 network error: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
      }
      if (!urlRes.ok) {
        const errBody = await urlRes.json().catch(() => ({})) as { message?: string | string[] };
        const msg = Array.isArray(errBody.message) ? errBody.message.join(', ') : (errBody.message ?? `Status ${urlRes.status}`);
        throw new Error(`Step 1 failed: ${msg}`);
      }
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };

      // Step 2: upload the file binary
      // Use a relative path when the uploadUrl targets our own proxy (/api/…) to avoid
      // a localhost vs 127.0.0.1 origin mismatch that causes a CORS failure in dev.
      const uploadTarget = (() => {
        try {
          const p = new URL(uploadUrl);
          return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl;
        } catch { return uploadUrl; }
      })();
      let putRes: Response;
      try {
        putRes = await fetch(uploadTarget, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
      } catch (netErr) {
        throw new Error(`Step 2 network error (url=${uploadTarget}): ${netErr instanceof Error ? netErr.message : String(netErr)}`);
      }
      if (!putRes.ok) throw new Error(`Step 2 failed: status ${putRes.status}`);

      // Step 3: record the document
      const body: Record<string, unknown> = {
        ownerType: 'tenancy_contract',
        ownerId: contract.id,
        category: docTypeMeta.category,
        documentKey: docKey,
        displayName: docTypeMeta.label,
        fileUrl,
        mimeType: file.type || 'application/octet-stream',
        isVisibleToTenant: visibleToTenant,
      };
      if (expiryDate) body.expiryDate = expiryDate;

      let docRes: Response;
      try {
        docRes = await fetch('/api/documents', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (netErr) {
        throw new Error(`Step 3 network error: ${netErr instanceof Error ? netErr.message : String(netErr)}`);
      }
      if (!docRes.ok) {
        const errBody = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        const msg = Array.isArray(errBody.message) ? errBody.message.join(', ') : (errBody.message ?? `Status ${docRes.status}`);
        throw new Error(`Step 3 failed: ${msg}`);
      }
      const newDoc: ContractDoc = await docRes.json();
      setDocs(prev => [...prev, newDoc]);
      setShowUploadForm(false);
      setUploadFile(null);
      setUploadDocType('');
      setUploadVisible(false);
      setUploadExpiry('');
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadingDoc(false);
      if (docInputRef.current) docInputRef.current.value = '';
    }
  }

  async function updatePaymentStatus(paymentId: number, field: 'chequeStatus' | 'chequeNumber' | 'transactionDate', value: string) {
    if (!contract) return;
    setUpdatingPayment(paymentId);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/payments/${paymentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value || null }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setPayments(prev => prev.map(p => p.id === paymentId ? { ...p, ...updated } : p));
    } catch {
      // silently ignore — the select will snap back on next render
    } finally {
      setUpdatingPayment(null);
    }
  }

  async function uploadEjariDoc(file: File) {
    if (!contract) return;
    setEjariUploading(true);
    setEjariError(null);
    const docKey = `ejari_${Date.now()}`;
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const ejariUploadTarget = (() => {
        try {
          const p = new URL(uploadUrl);
          return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl;
        } catch { return uploadUrl; }
      })();
      const putRes = await fetch(ejariUploadTarget, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!putRes.ok) throw new Error('File upload failed');
      const docRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, category: 'property', documentKey: docKey, displayName: 'Ejari', fileUrl, mimeType: file.type || 'application/octet-stream', isVisibleToTenant: true }),
      });
      if (!docRes.ok) throw new Error('Failed to record document');
      const newDoc: ContractDoc = await docRes.json();
      setDocs(prev => [...prev, newDoc]);
      setEjariFile(null);
      if (ejariInputRef.current) ejariInputRef.current.value = '';

      // Register Ejari with DLD. Tenancy activation happens automatically when
      // the RP counter-signs the move-in inspection (step 4 of the workflow).
      const ejariRes = await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      });
      if (!ejariRes.ok) throw new Error('Failed to mark Ejari registered');
      const updated = await ejariRes.json();
      setContract(updated);
    } catch (e: unknown) {
      setEjariError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setEjariUploading(false);
    }
  }

  async function resetEjariUpload() {
    if (!contract) return;
    if (!confirm('Roll the tenancy back to issued and clear the existing Ejari? You will then be able to upload a corrected certificate.')) return;
    setEjariResetting(true);
    setEjariError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari/reset`, {
        method: 'PATCH', credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setContract(updated);
      setDocs(prev => prev.filter(d => !d.documentKey?.startsWith('ejari')));
    } catch (e: unknown) {
      setEjariError(e instanceof Error ? e.message : 'Failed to reset Ejari');
    } finally {
      setEjariResetting(false);
    }
  }

  async function uploadUtilityDoc(file: File) {
    if (!contract) return;
    setUtilityUploading(true);
    setUtilityError(null);
    const docKey = `utility_${Date.now()}`;
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, documentKey: docKey, mimeType: file.type || 'application/octet-stream', originalName: file.name }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, fileUrl } = await urlRes.json() as { uploadUrl: string; fileUrl: string };
      const uploadTarget = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; }
      })();
      const putRes = await fetch(uploadTarget, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!putRes.ok) throw new Error('File upload failed');
      const docRes = await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, category: 'property', documentKey: docKey, displayName: 'Utility Proof', fileUrl, mimeType: file.type || 'application/octet-stream', isVisibleToTenant: true }),
      });
      if (!docRes.ok) throw new Error('Failed to record document');
      const newDoc: ContractDoc = await docRes.json();
      setDocs(prev => [...prev, newDoc]);
      setUtilityFile(null);
      if (utilityInputRef.current) utilityInputRef.current.value = '';
    } catch (e: unknown) {
      setUtilityError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUtilityUploading(false);
    }
  }

  async function addDepositCheque() {
    if (!contract) return;
    setRecordingDeposit(true);
    setFeeError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentType: 'security_deposit',
          description: 'Security Deposit (PDC)',
          amount: contract.securityDepositAmount ?? 0,
          paymentMethod: 'cheque',
          chequeStatus: 'pending',
          chequeNumber: depChequeNo || undefined,
          transactionDate: depDate || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string })?.message ?? `Error ${res.status}`);
      }
      const saved = await res.json();
      setPayments(prev => [...prev, { ...saved, charges: 0, payerName: null }]);
      setDepChequeNo('');
      setDepDate('');
    } catch (e: unknown) {
      setFeeError(e instanceof Error ? e.message : 'Failed to record deposit');
    } finally {
      setRecordingDeposit(false);
    }
  }

  async function addPaymentInstalment() {
    if (!contract || !newInstalment.amount) return;
    setAddingInstalment(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/payments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newInstalment.description || `Rental Instalment ${rentChequePayments.length + 1}`,
          amount: Number(newInstalment.amount),
          chequeNumber: newInstalment.chequeNumber || undefined,
          transactionDate: newInstalment.transactionDate || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const saved = await res.json();
      setPayments(prev => [...prev, { ...saved, amount: saved.amount ?? Number(newInstalment.amount), charges: 0, payerName: null }]);
      setNewInstalment({ description: '', amount: '', chequeNumber: '', transactionDate: '' });
      setShowAddInstalment(false);
    } catch {
      // ignore
    } finally {
      setAddingInstalment(false);
    }
  }

  /**
   * Phase 6c — opens the Propose Renewal modal pre-filled from the current
   * (parent) contract. Reused by:
   *   - the header "Propose Renewal" button (active, never-proposed)
   *   - the "Customer declined this renewal" banner's CTA (re-propose after
   *     a rejection — backend already allows re-proposing on REJECTED parents)
   */
  function openProposeRenewalModal() {
    if (!contract) return;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const newStart = new Date(contract.endDate);
    newStart.setDate(newStart.getDate() + 1);
    const newEnd = new Date(newStart);
    newEnd.setFullYear(newStart.getFullYear() + 1);
    newEnd.setDate(newEnd.getDate() - 1);
    setRenewalForm({
      newAnnualRent: String(contract.annualRent ?? ''),
      newStartDate: fmt(newStart),
      newEndDate: fmt(newEnd),
      numberOfInstallments: String(contract.numberOfInstallments ?? 4),
      modeOfPayment: contract.modeOfPayment ?? 'cheque',
      samePayee: true,
      chequePayeeName: '',
      adminFee: '',
      ejariFee: '',
      commission: '',
    });
    setFeesTouched({ adminFee: false, ejariFee: false, commission: false });
    setRenewalExtras([]);
    setRenewalError(null);
    setShowRenewalModal(true);
    fetch('/api/fee-rules', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: Record<string, FeeRule[]> | null) => setFeeRules(data))
      .catch(() => setFeeRules(null));
    fetch('/api/profiles/rental-provider/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((data: { profile?: { renewalRentIncrementPct?: number | string | null } } | null) => {
        const raw = data?.profile?.renewalRentIncrementPct;
        const pct = raw == null ? 0 : Number(raw);
        if (pct > 0 && contract.annualRent) {
          const bumped = Math.round(contract.annualRent * (1 + pct / 100));
          setRenewalForm(f => ({ ...f, newAnnualRent: String(bumped) }));
        }
      })
      .catch(() => undefined);
  }

  async function submitProposeRenewal() {
    if (!contract) return;
    setRenewalError(null);

    // Validation
    const newRent = parseFloat(renewalForm.newAnnualRent);
    if (!newRent || newRent <= 0) { setRenewalError('Enter a valid annual rent'); return; }
    if (!renewalForm.newStartDate || !renewalForm.newEndDate) { setRenewalError('Pick start and end dates'); return; }
    if (new Date(renewalForm.newStartDate) >= new Date(renewalForm.newEndDate)) {
      setRenewalError('End date must be after start date');
      return;
    }

    setRenewalSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        newAnnualRent: newRent,
        newStartDate: renewalForm.newStartDate,
        newEndDate: renewalForm.newEndDate,
        numberOfInstallments: parseInt(renewalForm.numberOfInstallments, 10) || undefined,
        modeOfPayment: renewalForm.modeOfPayment || undefined,
      };
      if (!renewalForm.samePayee && renewalForm.chequePayeeName.trim()) {
        body.chequePayeeName = renewalForm.chequePayeeName.trim();
      }
      const adminFeeNum  = parseFloat(renewalForm.adminFee);
      const ejariFeeNum  = parseFloat(renewalForm.ejariFee);
      const commissionN  = parseFloat(renewalForm.commission);
      if (Number.isFinite(adminFeeNum) && adminFeeNum >= 0)   body.adminFee   = adminFeeNum;
      if (Number.isFinite(ejariFeeNum) && ejariFeeNum >= 0)   body.ejariFee   = ejariFeeNum;
      if (Number.isFinite(commissionN) && commissionN >= 0)   body.commission = commissionN;
      const cleanExtras = renewalExtras
        .map(e => ({
          description: e.description.trim(),
          amount: parseFloat(e.amount),
          dueDate: e.dueDate || undefined,
        }))
        .filter(e => e.description && Number.isFinite(e.amount) && e.amount > 0);
      if (cleanExtras.length > 0) body.extraCharges = cleanExtras;
      const res = await fetch(`/api/contracts/${contract.id}/renewal/propose`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => `Error ${res.status}`);
        throw new Error(msg || `Error ${res.status}`);
      }
      // Refetch contract so the page reflects renewalAccepted='pending'
      const refresh = await fetch(`/api/contracts/${contract.id}`, { credentials: 'include' });
      if (refresh.ok) setContract(await refresh.json());
      setShowRenewalModal(false);
    } catch (e: unknown) {
      setRenewalError(e instanceof Error ? e.message : 'Could not propose renewal');
    } finally {
      setRenewalSubmitting(false);
    }
  }

  async function markEjariRegistered() {
    if (!contract) return;
    setMarkingStep('ejari');
    setFeeError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/ejari`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ejariStatus: 'registered' }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setContract(updated);
    } catch (e: unknown) {
      setFeeError(e instanceof Error ? e.message : 'Failed to update Ejari');
    } finally {
      setMarkingStep(null);
    }
  }

  async function doActivateContract() {
    if (!contract) return;
    setMarkingStep('activate');
    setFeeError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/activate`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setContract(updated);
    } catch (e: unknown) {
      setFeeError(e instanceof Error ? e.message : 'Failed to activate contract');
    } finally {
      setMarkingStep(null);
    }
  }

  async function doIssueContract() {
    if (!contract) return;
    setMarkingStep('issue');
    setFeeError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/issue`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setContract(updated);
    } catch (e: unknown) {
      setFeeError(e instanceof Error ? e.message : 'Failed to issue contract');
    } finally {
      setMarkingStep(null);
    }
  }

  async function handleConfirmPdc() {
    if (!contract) return;
    setConfirmingPdc(true);
    setFeeError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/confirm-pdc`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const updated = await res.json();
      setContract(prev => prev ? { ...prev, pdcConfirmed: updated.pdcConfirmed ?? true, pdcConfirmedAt: updated.pdcConfirmedAt ?? null } : prev);
    } catch (e: unknown) {
      setFeeError(e instanceof Error ? e.message : 'Failed to confirm PDC collection');
    } finally {
      setConfirmingPdc(false);
    }
  }

  async function submitTerminationRequest() {
    if (!contract) return;
    const reason = terminateReason.trim();
    if (!reason) { setTerminateError('Please provide a reason'); return; }
    if (!terminateEffectiveDate) { setTerminateError('Please pick an effective date'); return; }
    setTerminateSubmitting(true);
    setTerminateError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/request`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, effectiveDate: terminateEffectiveDate }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
      const updated = await res.json();
      setContract(updated);
      setShowTerminateConfirm(false);
      setTerminateReason('');
      setTerminateEffectiveDate('');
    } catch (e: unknown) {
      setTerminateError(e instanceof Error ? e.message : 'Failed to send termination request');
    } finally {
      setTerminateSubmitting(false);
    }
  }

  async function respondToTermination(response: 'accepted' | 'rejected') {
    if (!contract) return;
    setTerminateResponding(true);
    setTerminateError(null);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/termination/respond`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { message?: string }).message ?? `Error ${res.status}`); }
      const updated = await res.json();
      setContract(updated);
    } catch (e: unknown) {
      setTerminateError(e instanceof Error ? e.message : 'Failed to respond to termination request');
    } finally {
      setTerminateResponding(false);
    }
  }

  async function saveClauses() {
    if (!contract) return;
    setSavingClauses(true);
    setClauseSaveError(null);
    setClauseSaved(false);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/clauses`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customClauses: clauses, notes: clauseNotes || null }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setClauseSaved(true);
      setTimeout(() => setClauseSaved(false), 2500);
    } catch (e: unknown) {
      setClauseSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingClauses(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-[#2e9f82]" />
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm text-center space-y-3 shadow-sm">
          <AlertCircle size={36} className="text-red-400 mx-auto" />
          <p className="text-sm font-semibold text-[#1a1916]">Contract not found</p>
          <p className="text-xs text-[#9b9890]">{error}</p>
          <button onClick={() => router.back()} className="text-xs text-[#2e9f82] hover:underline">← Go back</button>
        </div>
      </div>
    );
  }

  const isRenewalContract = contract.contractType === 'renewal';
  /** Phase 6c — a renewal proposal the customer declined. The child row is
   *  archived (`contractActive=false`), so we suppress the payment-collection
   *  drawer, the activation timeline, and the Sign Contract CTA, leaving
   *  only the declined banner + a routing card pointing back to the parent. */
  const isDeclinedRenewalChild = isRenewalContract && contract.contractActive === false;

  // Derived from payment records — used in timeline + sidebar
  const hasAdminFeePaid = payments.some(
    p => p.paymentType === 'admin_fee' &&
      (p.paymentMethod === 'cash' || p.paymentMethod === 'bank_transfer' ||
       (p.paymentMethod === 'cheque' && p.chequeStatus === 'pending') || p.chequeStatus === 'cleared')
  );
  const hasDepositRecorded = payments.some(p => p.paymentType === 'security_deposit');
  const hasEjariFeePaid = payments.some(
    p => p.description?.toLowerCase().includes('ejari'));

  // ── Contract activation timeline (6-step new / 4-step renewal) ──────────
  const tl_s         = contract.status;
  const tl_isActive  = tl_s === 'active';
  const tl_isPending = tl_s === 'pending';
  const tl_isIssued  = tl_s === 'issued';
  const tl_isTerm    = tl_s === 'terminated';
  const tl_hasEjari  = !!contract.ejariStatus && contract.ejariStatus === 'registered';
  const tl_isSigned  = !!signedMode;
  const tl_isIssued_or_active = tl_isIssued || tl_isActive;

  // Show every cheque except the security deposit (rendered in its own section).
  // The old code also excluded payments whose description contained "ejari" — that filter
  // accidentally hid the "Admin Fee + Ejari + Commission + Installment 1" bundle row that's
  // now created from the lead's plan, so it's removed.
  const rentChequePayments = payments.filter(p =>
    p.paymentType !== 'admin_fee' &&
    p.paymentType !== 'security_deposit'
  );
  const expectedCheques = contract.numberOfInstallments ?? 0;
  const allChequesRecorded = expectedCheques > 0 && rentChequePayments.length >= expectedCheques;

  const depositPayment = payments.find(p => p.paymentType === 'security_deposit');
  const allCollectedCheques = [
    ...(depositPayment ? [depositPayment] : []),
    ...rentChequePayments,
  ];
  const totalExpectedCheques = 1 + expectedCheques; // 1 deposit + N instalments
  const allChequesComplete = allCollectedCheques.length >= totalExpectedCheques;

  const allPaymentsDone = allChequesComplete;
  const allSigsDone     = tl_isSigned && hasTenantSigned;
  const utilityDoc     = docs.find(d => d.documentKey?.startsWith('utility')) ?? tenantUtilityDoc ?? null;

  // Step state helpers
  const st1Done = tl_isIssued_or_active;
  // For new contracts the payments are collected upstream on the lead, so step 2 is auto-true.
  // For renewals there's no lead to collect against — the RP records cheques on the renewal
  // child itself, so this gates on the contract's pdcConfirmed flag.
  const st2Done = isRenewalContract ? (contract.pdcConfirmed ?? false) : true;
  const st3Done = allSigsDone;
  const st4Done = tl_hasEjari;
  // Utility step (NEW, between Ejari and Move-In). Either party can upload —
  // tenant via their portal OR RP here. The utility doc presence is the truth.
  const stUtilityDone = !!utilityDoc;
  // Move-in inspection complete once RP counter-signs.
  const stMoveInDone  = !!moveInInsp?.rpCounterSig || tl_isActive;
  // st5Done kept as alias for tl_isActive so the renewal-flow steps (which
  // still use the 4-step model: Terms → Sigs → Ejari → Active) keep working.
  const st5Done = tl_isActive;

  type TLStep = 'done' | 'current' | 'upcoming';
  function stepState(prevDone: boolean, thisDone: boolean): TLStep {
    if (!prevDone) return 'upcoming';
    if (thisDone)  return 'done';
    return 'current';
  }

  // For the new contract: 6 steps (no renewal/exit when active)
  // For renewal: 4 steps
  const tlIsRenewal = isRenewalContract;


  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      {/* Top bar */}
      <div className="bg-white border-b border-[#e8e6e0] px-4 sm:px-6 py-4 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/rental-provider/dashboard/orders" className="text-[#6b6860] hover:text-[#1a1916]" title="Back to orders">
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-[#1a1916]">{contract.ref}</span>
                <StatusBadge status={contract.status} />
              </div>
              <p className="text-[11px] text-[#9b9890] mt-0.5 truncate">
                {contract.unit.number ? `Unit ${contract.unit.number} · ` : ''}{contract.property.buildingName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/rental-provider/dashboard/contracts/${contract.id}/print`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Eye size={14} /> Preview
            </Link>
            <Link
              href={`/rental-provider/dashboard/contracts/${contract.id}/print`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Download size={14} /> Download PDF
            </Link>
            {/* Propose Renewal CTA — shown on active, NEW (non-renewal) contracts when no proposal is in flight */}
            {contract.status === 'active' && contract.contractType !== 'renewal' && !contract.renewalAccepted && (
              <button
                onClick={openProposeRenewalModal}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border border-[#2e9f82] text-[#2e9f82] hover:bg-[#f0faf6] transition-colors bg-white"
              >
                <RotateCcw size={14} /> Propose Renewal
              </button>
            )}
            {contract.renewalAccepted === 'pending' && (
              <span className="flex items-center gap-1.5 text-xs text-[#a85b15] font-semibold bg-[#fdf3e3] px-3 py-1.5 rounded-full border border-[#f3d08a]">
                <RotateCcw size={13} /> Renewal Proposed — awaiting tenant
              </span>
            )}
            {contract.renewalAccepted === 'rejected' && (
              <span className="flex items-center gap-1.5 text-xs text-red-700 font-semibold bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
                <X size={13} /> Renewal Rejected by tenant
              </span>
            )}
            {contract.renewalAccepted === 'accepted' && (
              <span className="flex items-center gap-1.5 text-xs text-[#2e9f82] font-semibold bg-[#f0faf6] px-3 py-1.5 rounded-full border border-[#c5e8df]">
                <CheckCircle size={13} /> Renewal Accepted
              </span>
            )}
            {contract.status === 'active' && contract.termination?.response !== 'pending' && (
              <button
                onClick={() => setShowTerminateConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors bg-white"
              >
                <X size={14} /> Request Termination
              </button>
            )}
            {isDeclinedRenewalChild ? null : signedMode ? (
              <span className="flex items-center gap-1.5 text-xs text-[#2e9f82] font-semibold bg-[#f0faf6] px-3 py-1.5 rounded-full border border-[#c5e8df]">
                <BadgeCheck size={13} /> Signed Online
              </span>
            ) : (
              <button
                onClick={() => setShowSignModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ background: '#2e9f82' }}
              >
                <FileSignature size={14} /> Sign Contract
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Addendums — visible at all times. Attach/remove gated to draft state inside the component. */}
        <AddendumsPanel contractId={contract.id} role="landlord" contractStatus={contract.status} />

        {/* ── Renewal declined banner (Phase 6c). Shown when either:
             - the RP is on the PARENT contract and the customer rejected
               (`renewalAccepted === 'rejected'`); or
             - the RP opened the renewal CHILD directly and its parent
               carries the rejection (renewalAccepted mirrored from parent).
             The backend inlines the parent's `renewalRejectionReason` on
             child responses so this banner works on either page. */}
        {(contract.renewalAccepted === 'rejected') && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <X size={18} className="text-red-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-900">Customer declined this renewal</p>
              <p className="text-xs text-red-800 mt-0.5">
                The proposal is archived. The original lease keeps running until{' '}
                <b>{fmtDate(contract.contractType === 'renewal' && contract.parentContractId ? contract.endDate : contract.endDate)}</b>.
                You can propose new terms anytime.
              </p>
              {contract.renewalRejectionReason ? (
                <div className="mt-2 bg-white border border-red-200 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-red-700 uppercase tracking-wide mb-1">Reason from customer</p>
                  <p className="text-xs text-[#1a1916] whitespace-pre-wrap">“{contract.renewalRejectionReason}”</p>
                </div>
              ) : (
                <p className="text-[11px] text-red-700 italic mt-2">No reason provided.</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              {/* If a fresh proposal has already been created on the same
                  parent (Phase 6c successor), link straight to it. Otherwise
                  offer the re-propose CTA — routed via the parent contract
                  when we're viewing a child, so the modal targets the right id. */}
              {contract.successorProposal ? (
                <Link
                  href={`/rental-provider/dashboard/contracts/${contract.successorProposal.id}/v2`}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1f6655] flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={12} /> View new proposal · CID-{contract.successorProposal.id}
                </Link>
              ) : contract.contractType === 'renewal' && contract.parentContractId ? (
                <Link
                  href={`/rental-provider/dashboard/contracts/${contract.parentContractId}/v2`}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1f6655] flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={12} /> Open original lease to re-propose
                </Link>
              ) : (
                <button
                  onClick={openProposeRenewalModal}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1f6655] flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={12} /> Propose new renewal
                </button>
              )}
            </div>
          </div>
        )}

        {/* Phase 6c — when the RP is viewing a declined renewal child and a
             successor proposal exists, render an informational strip so the
             RP knows the lifecycle continued: this row was rejected, the
             follow-up is the row they should act on. */}
        {isDeclinedRenewalChild && contract.successorProposal && (
          <div className="bg-[#f0faf6] border border-[#c5e8df] rounded-2xl p-4 flex items-start gap-3">
            <RotateCcw size={18} className="text-[#2e9f82] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">A new renewal has been proposed</p>
              <p className="text-xs text-[#4b4a44] mt-0.5">
                After this proposal was declined, you proposed a fresh renewal on{' '}
                <b>{fmtDate(contract.successorProposal.createdAt)}</b>. The customer's decision is tracked there.
              </p>
            </div>
            <Link
              href={`/rental-provider/dashboard/contracts/${contract.successorProposal.id}/v2`}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1f6655] flex items-center gap-1.5 shrink-0"
            >
              Open CID-{contract.successorProposal.id}
            </Link>
          </div>
        )}

        {/* ── Termination request banner (only shows when one is in flight) ── */}
        {contract.termination?.response === 'pending' && contract.termination.requestedByRole === 'tenant' && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-900">Tenant has requested termination</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Effective <b>{fmtDate(contract.termination.effectiveDate)}</b>
                {contract.termination.requestedAt && <> · requested {fmtDate(contract.termination.requestedAt)}</>}
              </p>
              {contract.termination.reason && (
                <p className="text-xs text-amber-900 mt-2 whitespace-pre-wrap">“{contract.termination.reason}”</p>
              )}
              {terminateError && <p className="text-xs text-red-600 mt-2">{terminateError}</p>}
            </div>
            <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
              <button
                onClick={() => respondToTermination('accepted')}
                disabled={terminateResponding}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                {terminateResponding ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Accept
              </button>
              <button
                onClick={() => respondToTermination('rejected')}
                disabled={terminateResponding}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-900 hover:bg-amber-100 disabled:opacity-50 flex items-center justify-center gap-1.5">
                <X size={12} /> Reject
              </button>
            </div>
          </div>
        )}
        {contract.termination?.response === 'pending' && contract.termination.requestedByRole === 'rental_provider' && (
          <div className="bg-[#fafaf8] border border-[#e8e6e0] rounded-2xl p-4 flex items-start gap-3">
            <RotateCcw size={18} className="text-[#6b6860] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">Termination request sent</p>
              <p className="text-xs text-[#6b6860] mt-0.5">
                Awaiting tenant response · effective <b>{fmtDate(contract.termination.effectiveDate)}</b>
              </p>
              {contract.termination.reason && (
                <p className="text-xs text-[#6b6860] mt-2 whitespace-pre-wrap">“{contract.termination.reason}”</p>
              )}
            </div>
          </div>
        )}
        {contract.termination?.response === 'rejected' && (
          <div className="bg-[#fafaf8] border border-[#e8e6e0] rounded-2xl px-4 py-2.5">
            <p className="text-xs text-[#6b6860]">
              Last termination request ({contract.termination.requestedByRole === 'tenant' ? 'tenant' : 'you'}) was rejected on {fmtDate(contract.termination.respondedAt)}.
            </p>
          </div>
        )}

        {/* ── Quick-glance strip ── */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Tenant</p>
            <p className="text-sm font-semibold text-[#1a1916]">{contract.tenant.name ?? '—'}</p>
          </div>
          <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Property</p>
            <p className="text-sm font-semibold text-[#1a1916]">{contract.unit.number ? `Unit ${contract.unit.number} · ` : ''}{contract.property.buildingName ?? '—'}</p>
          </div>
          <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Annual Rent</p>
            <p className="text-sm font-bold" style={{ color: '#2e9f82' }}>{fmtAed(contract.annualRent)}</p>
          </div>
          <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Period</p>
            <p className="text-sm font-semibold text-[#1a1916]">{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</p>
          </div>
          {contract.numberOfInstallments != null && (
            <>
              <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
              <div>
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Payments</p>
                <p className="text-sm font-semibold text-[#1a1916]">{contract.numberOfInstallments}</p>
              </div>
            </>
          )}
          <div className="ml-auto shrink-0">
            <StatusBadge status={contract.status} />
          </div>
        </div>

        {/* ── Contract Details Drawer ── */}
        {activeDrawer && (
          <>
            <style>{`@keyframes rpDrawer{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
              <div className="absolute inset-0 bg-black/30" onClick={() => setActiveDrawer(null)} />
              <div
                className="absolute right-0 inset-y-0 w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
                style={{ animation: 'rpDrawer 0.22s ease-out' }}
              >
                <div className="px-5 py-4 border-b border-[#f0ede8] flex items-center justify-between shrink-0">
                  <span className="text-sm font-bold text-[#1a1916]">Contract Details</span>
                  <button
                    onClick={() => setActiveDrawer(null)}
                    className="text-[#9b9890] hover:text-[#1a1916] p-1.5 rounded-lg hover:bg-[#f4f3ef] transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex overflow-x-auto border-b border-[#f0ede8] px-2 shrink-0 bg-[#fafaf8]">
                  {([
                    { key: 'parties',   icon: User,          label: 'Parties'   },
                    { key: 'property',  icon: Building2,     label: 'Property'  },
                    { key: 'period',    icon: Calendar,      label: 'Period'    },
                    { key: 'payments',  icon: CreditCard,    label: 'Payments'  },
                    { key: 'documents', icon: Paperclip,     label: 'Documents' },
                    { key: 'clauses',   icon: ClipboardList, label: 'Clauses'   },
                    { key: 'summary',   icon: FileText,      label: 'Summary'   },
                  ] as const).map(({ key, icon: Icon, label }) => (
                    <button
                      key={key}
                      onClick={() => setActiveDrawer(key)}
                      className={`flex items-center gap-1.5 px-3 py-3 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                        activeDrawer === key ? 'border-[#2e9f82] text-[#2e9f82]' : 'border-transparent text-[#9b9890] hover:text-[#1a1916]'
                      }`}
                    >
                      <Icon size={11} className="shrink-0" />{label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className={activeDrawer !== 'parties' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Parties */}
                  <SectionCard title="Parties" icon={User}>
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-bold text-[#2e9f82] uppercase tracking-wide mb-2">Landlord / Lessor</p>
                  <Row label="Name" value={contract.landlord.companyName ?? contract.landlord.name} />
                  <Row label="Email" value={contract.landlord.email} />
                  <Row label="Phone" value={contract.landlord.phone} />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Tenant / Lessee</p>
                  <Row label="Name" value={contract.tenant.name} />
                  <Row label="Email" value={contract.tenant.email} />
                  <Row label="Phone" value={contract.tenant.phone} />
                </div>
              </div>
                  </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'property' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Property & Unit */}
                  <SectionCard title="Property & Unit" icon={Building2}>
              <Row label="Building" value={contract.property.buildingName} />
              <Row label="Community" value={contract.property.community} />
              <Row label="Emirate" value={contract.property.emirate} />
              <Row label="Address" value={contract.property.fullAddress} />
              <Row label="Unit No." value={contract.unit.number ? `Unit ${contract.unit.number}` : null} />
              <Row label="Type" value={contract.unit.type} />
              <Row label="Floor" value={contract.unit.floor} />
              <Row label="Bedrooms" value={contract.unit.bedrooms} />
              <Row label="Bathrooms" value={contract.unit.bathrooms} />
            </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'period' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Rental Period */}
                  <SectionCard title="Rental Period" icon={Calendar}>
                    {(() => {
                      // Derive a human duration label from start/end so we don't depend on the
                      // optional contract.durationYears column (which isn't populated for new contracts).
                      const dur = (() => {
                        if (contract.durationYears) return `${contract.durationYears} year(s)`;
                        if (!contract.startDate || !contract.endDate) return null;
                        const s = new Date(contract.startDate);
                        const e = new Date(contract.endDate);
                        if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
                        // Whole months between dates (inclusive end day)
                        const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + (e.getDate() >= s.getDate() ? 0 : -1) + 1;
                        const years = Math.floor(months / 12);
                        const rem = months - years * 12;
                        if (years > 0 && rem === 0) return `${years} year${years === 1 ? '' : 's'}`;
                        if (years > 0) return `${years} year${years === 1 ? '' : 's'}, ${rem} month${rem === 1 ? '' : 's'}`;
                        return `${months} month${months === 1 ? '' : 's'}`;
                      })();
                      return (
                        <>
                          <Row label="Start Date" value={fmtDate(contract.startDate)} />
                          <Row label="End Date" value={fmtDate(contract.endDate)} />
                          <Row label="Duration" value={dur} />
                          <Row label="Contract Type" value={contract.contractType} />
                          <Row label="Status" value={<StatusBadge status={contract.status} />} />
                          <Row label="Ejari Status" value={contract.ejariStatus} />
                        </>
                      );
                    })()}
                  </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'payments' ? 'hidden' : 'p-5 space-y-4'}>

                  {/* Security Deposit Payment */}
                  <SectionCard title="Security Deposit Payment" icon={DollarSign}>
                    {depositPayment ? (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs min-w-[400px]">
                          <thead>
                            <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                              <th className="px-2 py-2 font-medium">Amount</th>
                              <th className="px-2 py-2 font-medium">Reference</th>
                              <th className="px-2 py-2 font-medium">Due Date</th>
                              <th className="px-2 py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const p = depositPayment;
                              const isSaving = updatingPayment === p.id;
                              const statusColor =
                                p.chequeStatus === 'cleared'   ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                                p.chequeStatus === 'bounced'   ? 'bg-[#fee2e2] text-[#b91c1c]' :
                                p.chequeStatus === 'cancelled' ? 'bg-[#e5e7eb] text-[#374151]' :
                                'bg-[#fef3c7] text-[#92400e]';
                              return (
                                <tr className="bg-white">
                                  <td className="px-2 py-2 font-semibold text-[#1a1916]">{fmtAed(p.amount)}</td>
                                  <td className="px-2 py-2">
                                    <input type="text" defaultValue={p.chequeNumber ?? ''} placeholder="—" disabled={isSaving}
                                      onBlur={e => { const val = e.target.value.trim(); if (val !== (p.chequeNumber ?? '')) updatePaymentStatus(p.id, 'chequeNumber', val); }}
                                      className="w-28 font-mono text-xs px-2 py-1 border border-transparent rounded-lg bg-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none focus:bg-white transition-colors" />
                                  </td>
                                  <td className="px-2 py-2">
                                    <input type="date" defaultValue={p.transactionDate ? p.transactionDate.split('T')[0] : ''} disabled={isSaving}
                                      onChange={e => updatePaymentStatus(p.id, 'transactionDate', e.target.value)}
                                      className="text-xs px-2 py-1 border border-transparent rounded-lg bg-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none focus:bg-white transition-colors text-[#6b6860]" />
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="flex items-center gap-1.5">
                                      {isSaving && <Loader2 size={10} className="animate-spin text-[#9b9890]" />}
                                      <select value={p.chequeStatus} disabled={isSaving} onChange={e => updatePaymentStatus(p.id, 'chequeStatus', e.target.value)}
                                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none ${statusColor}`}>
                                        <option value="pending">Pending</option>
                                        <option value="cleared">Cleared</option>
                                        <option value="bounced">Bounced</option>
                                        <option value="cancelled">Cancelled</option>
                                      </select>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-xs text-[#9b9890]">Amount: <strong className="text-[#1a1916]">{fmtAed(contract.securityDepositAmount ?? 0)}</strong> — enter the payment details to record receipt.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Reference</label>
                            <input type="text" value={depChequeNo} onChange={e => setDepChequeNo(e.target.value)}
                              placeholder="Cheque #, transfer ID, auth code…"
                              className="w-full font-mono text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Date</label>
                            <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)}
                              className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none text-[#6b6860]" />
                          </div>
                        </div>
                        {feeError && <p className="text-xs text-red-600">{feeError}</p>}
                        <button onClick={addDepositCheque} disabled={recordingDeposit}
                          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1a7a63] disabled:opacity-50 transition-colors">
                          {recordingDeposit ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          Record Deposit Payment
                        </button>
                      </div>
                    )}
                  </SectionCard>

                  {/* Rental Instalments — includes the first-bundle payment (Admin + Ejari + Commission + Installment 1)
                       and any extra plan items (Tax, VAT, etc.). Security deposit is rendered separately above. */}
                  <SectionCard
                    title={`Rental Instalments (${rentChequePayments.length} payment${rentChequePayments.length === 1 ? '' : 's'})`}
                    icon={CreditCard}
                  >
              {rentChequePayments.length === 0 && !showAddInstalment && (
                <p className="text-xs text-[#9b9890] text-center py-4">No payments recorded yet.</p>
              )}

              {rentChequePayments.length > 0 && (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs min-w-[600px]">
                    <thead>
                      <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">Description</th>
                        <th className="px-2 py-2 font-medium">Amount</th>
                        <th className="px-2 py-2 font-medium">Reference</th>
                        <th className="px-2 py-2 font-medium">Due Date</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rentChequePayments.map((p, i) => {
                        const isSaving = updatingPayment === p.id;
                        const statusColor =
                          p.chequeStatus === 'cleared'   ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                          p.chequeStatus === 'bounced'   ? 'bg-[#fee2e2] text-[#b91c1c]' :
                          p.chequeStatus === 'cancelled' ? 'bg-[#e5e7eb] text-[#374151]' :
                          'bg-[#fef3c7] text-[#92400e]';
                        return (
                          <tr key={p.id} className={`border-b border-[#f4f3ef] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafaf8]'}`}>
                            <td className="px-2 py-2 text-[#9b9890]">{i + 1}</td>
                            <td className="px-2 py-2 text-[#1a1916]">{p.description ?? p.paymentType?.replace(/_/g, ' ') ?? '—'}</td>
                            <td className="px-2 py-2 font-semibold text-[#1a1916]">{fmtAed(p.amount)}</td>
                            <td className="px-2 py-2">
                              <input type="text" defaultValue={p.chequeNumber ?? ''} placeholder="—" disabled={isSaving}
                                onBlur={e => { const val = e.target.value.trim(); if (val !== (p.chequeNumber ?? '')) updatePaymentStatus(p.id, 'chequeNumber', val); }}
                                className="w-24 font-mono text-xs px-2 py-1 border border-transparent rounded-lg bg-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none focus:bg-white transition-colors" />
                            </td>
                            <td className="px-2 py-2">
                              <input type="date" defaultValue={p.transactionDate ? p.transactionDate.split('T')[0] : ''} disabled={isSaving}
                                onChange={e => updatePaymentStatus(p.id, 'transactionDate', e.target.value)}
                                className="text-xs px-2 py-1 border border-transparent rounded-lg bg-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none focus:bg-white transition-colors text-[#6b6860]" />
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                {isSaving && <Loader2 size={10} className="animate-spin text-[#9b9890] shrink-0" />}
                                <select value={p.chequeStatus} disabled={isSaving} onChange={e => updatePaymentStatus(p.id, 'chequeStatus', e.target.value)}
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30 ${statusColor}`}>
                                  <option value="pending">Pending</option>
                                  <option value="cleared">Cleared</option>
                                  <option value="bounced">Bounced</option>
                                  <option value="cancelled">Cancelled</option>
                                </select>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#c5e8df] bg-[#f0faf6]">
                        <td colSpan={2} className="px-2 py-2.5 text-xs font-bold text-[#1a1916]">Total</td>
                        <td className="px-2 py-2.5 text-sm font-bold" style={{ color: '#2e9f82' }}>
                          {fmtAed(rentChequePayments.reduce((s, p) => s + p.amount, 0))}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* Add Instalment inline form */}
              {showAddInstalment && (
                <div className="mt-4 p-4 border border-[#c5e8df] rounded-xl bg-[#f0faf6] space-y-3">
                  <p className="text-xs font-semibold text-[#1a5a4a]">New Rental Instalment</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Description</label>
                      <input type="text" value={newInstalment.description} onChange={e => setNewInstalment(v => ({ ...v, description: e.target.value }))}
                        placeholder={`Rental Instalment ${rentChequePayments.length + 1}`}
                        className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Amount (AED) *</label>
                      <input type="number" min="0" step="0.01" value={newInstalment.amount} onChange={e => setNewInstalment(v => ({ ...v, amount: e.target.value }))}
                        placeholder="0.00" className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Reference</label>
                      <input type="text" value={newInstalment.chequeNumber} onChange={e => setNewInstalment(v => ({ ...v, chequeNumber: e.target.value }))}
                        placeholder="Cheque #, transfer ID…" className="w-full font-mono text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Due Date</label>
                      <input type="date" value={newInstalment.transactionDate} onChange={e => setNewInstalment(v => ({ ...v, transactionDate: e.target.value }))}
                        className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none text-[#6b6860]" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={addPaymentInstalment} disabled={!newInstalment.amount || addingInstalment}
                      className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1a7a63] disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                      {addingInstalment ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      Save Instalment
                    </button>
                    <button onClick={() => { setShowAddInstalment(false); setNewInstalment({ description: '', amount: '', chequeNumber: '', transactionDate: '' }); }}
                      className="text-xs font-semibold px-4 py-2 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors">Cancel</button>
                  </div>
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <button onClick={() => setShowAddInstalment(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#c5e8df] text-[#2e9f82] hover:bg-[#f0faf6] transition-colors">
                  <Plus size={12} /> Add Instalment
                </button>
              </div>
                  </SectionCard>

                  {/* Combined Contract Total — Security Deposit + Rental Instalments so the RP sees
                       the same figure the lead and the tenant view. */}
                  {(() => {
                    const rentTotal = rentChequePayments.reduce((s, p) => s + (p.amount || 0), 0);
                    const depositTotal = depositPayment?.amount ?? Number(contract.securityDepositAmount ?? 0);
                    const grand = rentTotal + depositTotal;
                    return (
                      <div className="rounded-2xl border-2 border-[#c5e8df] bg-[#f0faf6] px-5 py-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-[#1a7a5a] mb-2">Contract Total</p>
                        <div className="grid grid-cols-3 gap-3 text-xs">
                          <div>
                            <p className="text-[10px] text-[#6b6860] uppercase tracking-wide mb-0.5">Security Deposit</p>
                            <p className="text-sm font-semibold text-[#1a1916]">{fmtAed(depositTotal)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[#6b6860] uppercase tracking-wide mb-0.5">Rental Instalments ({rentChequePayments.length})</p>
                            <p className="text-sm font-semibold text-[#1a1916]">{fmtAed(rentTotal)}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[#6b6860] uppercase tracking-wide mb-0.5">Grand Total</p>
                            <p className="text-base font-bold" style={{ color: '#2e9f82' }}>{fmtAed(grand)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  </div>
                  <div className={activeDrawer !== 'documents' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Documents */}
                  <SectionCard title="Contract Documents" icon={Paperclip}>
              {(() => {
                // Document type definitions
                const DOC_TYPES = [
                  { value: 'trade_license',           label: 'Trade License',            category: 'license',     needsExpiry: true  },
                  { value: 'initial_approval',        label: 'Initial Approval',         category: 'compliance',  needsExpiry: false },
                  { value: 'trade_name_reservation',  label: 'Trade Name Reservation',   category: 'compliance',  needsExpiry: false },
                  { value: 'passport',                label: 'Passport',                 category: 'identity',    needsExpiry: true  },
                  { value: 'visa',                    label: 'Visa',                     category: 'identity',    needsExpiry: true  },
                  { value: 'emirates_id',             label: 'Emirates ID',              category: 'identity',    needsExpiry: true  },
                  { value: 'noc',                     label: 'NOC',                      category: 'legal',       needsExpiry: true  },
                  { value: 'undertaking_letter',      label: 'Undertaking Letter',       category: 'legal',       needsExpiry: false },
                  { value: 'ejari',                   label: 'Ejari',                    category: 'property',    needsExpiry: true  },
                  { value: 'visa_copy',               label: 'Visa Copy',                category: 'identity',    needsExpiry: true  },
                  { value: 'poa',                     label: 'POA',                      category: 'legal',       needsExpiry: false },
                  { value: 'pdc',                     label: 'PDC',                      category: 'payment',     needsExpiry: false },
                  { value: 'credit_card',             label: 'Credit Card',              category: 'payment',     needsExpiry: false },
                  { value: 'bank_transfer',           label: 'Bank Transfer',            category: 'banking',     needsExpiry: false },
                  { value: 'cash_receipt',            label: 'Cash Receipt',             category: 'payment',     needsExpiry: false },
                  { value: 'agreement',               label: 'Agreement',                category: 'contract',    needsExpiry: false },
                  { value: 'other',                   label: 'Others',                   category: 'other',       needsExpiry: false },
                ] as const;

                const selectedType = DOC_TYPES.find(t => t.value === uploadDocType);
                const showExpiry = selectedType?.needsExpiry ?? false;
                const today = new Date().toISOString().split('T')[0];

                function isExpired(expiryDate: string | null) {
                  if (!expiryDate) return false;
                  return new Date(expiryDate) < new Date(today);
                }

                return (
                  <div className="space-y-3">
                    {/* Document list */}
                    {docs.length === 0 && !showUploadForm && (
                      <p className="text-xs text-[#9b9890] text-center py-4">No documents attached yet.</p>
                    )}
                    {docs.length > 0 && (
                      <ul className="space-y-2">
                        {docs.map(doc => {
                          const expired = isExpired(doc.expiryDate);
                          return (
                            <li key={doc.id} className="flex items-center gap-3 bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                              <FileText size={14} className="shrink-0 text-[#2e9f82]" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-[#1a1916] truncate font-medium">{doc.displayName ?? doc.documentKey}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {doc.expiryDate && (
                                    <span className={`text-[10px] font-medium ${expired ? 'text-red-500' : 'text-[#9b9890]'}`}>
                                      {expired ? '⚠ Expired' : 'Exp'}: {fmtDate(doc.expiryDate)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {/* Visibility toggle */}
                              <button
                                type="button"
                                title={doc.isVisibleToTenant ? 'Click to make Internal' : 'Click to make visible to Customer'}
                                onClick={async () => {
                                  const res = await fetch(`/api/documents/${doc.id}`, {
                                    method: 'PATCH',
                                    credentials: 'include',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ isVisibleToTenant: !doc.isVisibleToTenant }),
                                  });
                                  if (res.ok) {
                                    const updated: ContractDoc = await res.json();
                                    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, isVisibleToTenant: updated.isVisibleToTenant } : d));
                                  }
                                }}
                                className={`shrink-0 flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full transition-colors cursor-pointer ${
                                  doc.isVisibleToTenant
                                    ? 'bg-[#d8f2e8] text-[#1a7a5a] hover:bg-[#c0e8d4]'
                                    : 'bg-[#f4f3ef] text-[#6b6860] hover:bg-[#e8e6e0]'
                                }`}
                              >
                                {doc.isVisibleToTenant ? <><Eye size={10} /> Customer</> : <>🔒 Internal</>}
                              </button>
                              {expired && (
                                <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">
                                  Expired
                                </span>
                              )}
                              <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#2e9f82] hover:text-[#1a5a4a]">
                                <ExternalLink size={13} />
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {/* Upload form (shown inline when triggered) */}
                    {showUploadForm && (
                      <div className="border border-[#e8e6e0] rounded-xl p-4 space-y-3 bg-[#fafaf8]">
                        {/* File picker */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#6b6860] mb-1">File</label>
                          <div className="flex items-center gap-2">
                            <input
                              ref={docInputRef}
                              type="file"
                              className="hidden"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                            />
                            <button
                              type="button"
                              onClick={() => docInputRef.current?.click()}
                              className="px-3 py-1.5 text-xs rounded-lg border border-[#d4d0c8] bg-white text-[#4a4844] hover:bg-[#f4f3ef] transition-colors"
                            >
                              Choose file
                            </button>
                            <span className="text-xs text-[#9b9890] truncate max-w-[200px]">
                              {uploadFile ? uploadFile.name : 'No file chosen'}
                            </span>
                          </div>
                        </div>

                        {/* Document type */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#6b6860] mb-1">Document Type <span className="text-red-500">*</span></label>
                          <select
                            value={uploadDocType}
                            onChange={e => { setUploadDocType(e.target.value); setUploadExpiry(''); }}
                            className="w-full border border-[#d4d0c8] rounded-lg px-3 py-1.5 text-xs text-[#1a1916] bg-white focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
                          >
                            <option value="">Select type…</option>
                            {DOC_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Visibility */}
                        <div>
                          <label className="block text-[11px] font-medium text-[#6b6860] mb-1.5">Visibility</label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="radio"
                                name="docVisibility"
                                checked={!uploadVisible}
                                onChange={() => setUploadVisible(false)}
                                className="accent-[#2e9f82]"
                              />
                              <span className="text-[#4a4844]">🔒 Internal only</span>
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="radio"
                                name="docVisibility"
                                checked={uploadVisible}
                                onChange={() => setUploadVisible(true)}
                                className="accent-[#2e9f82]"
                              />
                              <span className="text-[#4a4844]">👁 Visible to customer</span>
                            </label>
                          </div>
                        </div>

                        {/* Expiry date (conditional) */}
                        {showExpiry && (
                          <div>
                            <label className="block text-[11px] font-medium text-[#6b6860] mb-1">
                              Expiry Date <span className="text-[10px] text-[#9b9890]">(required for {selectedType?.label})</span>
                            </label>
                            <input
                              type="date"
                              value={uploadExpiry}
                              onChange={e => setUploadExpiry(e.target.value)}
                              className="border border-[#d4d0c8] rounded-lg px-3 py-1.5 text-xs text-[#1a1916] bg-white focus:outline-none focus:ring-2 focus:ring-[#2e9f82]/30"
                            />
                          </div>
                        )}

                        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            disabled={uploadingDoc || !uploadFile || !uploadDocType || (showExpiry && !uploadExpiry)}
                            onClick={() => {
                              if (!uploadFile || !uploadDocType) return;
                              const meta = DOC_TYPES.find(t => t.value === uploadDocType)!;
                              uploadDocument(uploadFile, { key: meta.value, label: meta.label, category: meta.category }, uploadVisible, uploadExpiry);
                            }}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#2e9f82] text-white text-xs font-medium hover:bg-[#26876d] disabled:opacity-50 transition-colors"
                          >
                            {uploadingDoc ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                            {uploadingDoc ? 'Uploading…' : 'Upload'}
                          </button>
                          <button
                            type="button"
                            disabled={uploadingDoc}
                            onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadDocType(''); setUploadVisible(false); setUploadExpiry(''); setUploadError(null); }}
                            className="px-4 py-1.5 rounded-lg border border-[#d4d0c8] text-[#4a4844] text-xs hover:bg-[#f4f3ef] transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Trigger button */}
                    {!showUploadForm && (
                      <button
                        type="button"
                        onClick={() => { setShowUploadForm(true); setUploadError(null); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-[#2e9f82] text-[#2e9f82] text-xs font-medium hover:bg-[#f0faf6] transition-colors"
                      >
                        <UploadCloud size={13} />
                        Upload Document
                      </button>
                    )}
                  </div>
                );
              })()}
                  </SectionCard>

                  {/* ── Tenant Rental Documents ──
                       For renewal contracts these are the fresh docs the tenant uploaded against
                       the renewal child specifically (ownerType=tenancy_contract). For the original
                       lease they're the tenant's customer-scoped KYC pack. */}
                  <SectionCard
                    title={isRenewalContract ? 'Renewal Documents' : 'Rental Documents'}
                    icon={User}
                    headerAction={
                      tenantKycDocs && tenantKycDocs.filter(d => d.documentKey !== 'profile_picture').length > 0 ? (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setViewAllOpen(true); }}
                          className="flex items-center gap-1 text-xs font-semibold text-[#2e9f82] border border-[#2e9f82] rounded-lg px-2.5 py-1 hover:bg-[#f0faf6] transition-colors cursor-pointer"
                        >
                          <FileText size={11} /> View All
                        </button>
                      ) : undefined
                    }
                  >
                    {tenantKycLoading ? (
                      <p className="flex items-center gap-1.5 text-xs text-[#9b9890]"><Loader2 size={11} className="animate-spin" /> Loading…</p>
                    ) : (
                      <div className="space-y-4">
                        {/* Uploaded docs */}
                        {(!tenantKycDocs || tenantKycDocs.filter(d => d.status !== 'pending').length === 0) ? (
                          <p className="text-xs text-[#9b9890] text-center py-2">No documents uploaded by customer yet.</p>
                        ) : (
                          <ul className="space-y-2">
                            {tenantKycDocs.filter(d => d.status !== 'pending').map(doc => {
                              const isApproved = doc.status === 'processed' || doc.status === 'complete';
                              const isRejected = doc.status === 'rejected';
                              const isReviewing = reviewingDocId === doc.id;
                              const isRejectOpen = rejectingDocId === doc.id;
                              const statusLabel = isApproved ? 'Approved' : isRejected ? 'Rejected' : 'Pending review';
                              const statusColor = isApproved ? 'text-[#2e9f82]' : isRejected ? 'text-[#b91c1c]' : 'text-[#92400e]';
                              const bgBorder = isApproved
                                ? 'bg-[#f0faf6] border-[#c6f0e0]'
                                : isRejected
                                ? 'bg-[#fff1f2] border-[#fecaca]'
                                : 'bg-[#fefce8] border-[#fde68a]';
                              return (
                                <li key={doc.id} className={`rounded-xl border overflow-hidden ${bgBorder}`}>
                                  <div className="flex items-center gap-3 px-4 py-2.5">
                                    <FileText size={14} className={`shrink-0 ${isApproved ? 'text-[#2e9f82]' : isRejected ? 'text-[#b91c1c]' : 'text-[#92400e]'}`} />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-[#1a1916] truncate font-medium">{doc.displayName ?? doc.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                                      <span className={`text-[10px] font-semibold ${statusColor}`}>{statusLabel}</span>
                                      {isRejected && doc.notes && (
                                        <p className="text-[9px] text-[#b91c1c] mt-0.5">Reason: {doc.notes}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {doc.fileUrl && (
                                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                                          className="flex items-center gap-0.5 text-[11px] font-medium text-[#2e9f82] hover:underline">
                                          <ExternalLink size={11} /> View
                                        </a>
                                      )}
                                      {!isApproved && !isRejectOpen && (
                                        <button disabled={isReviewing} onClick={() => handleKycDocAction(doc.id, 'verify')}
                                          className="flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-lg bg-[#d8f2e8] text-[#1a7a5a] hover:bg-[#c5e8df] disabled:opacity-50 transition-colors cursor-pointer">
                                          {isReviewing ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />} Approve
                                        </button>
                                      )}
                                      {!isRejected && !isRejectOpen && (
                                        <button disabled={isReviewing} onClick={() => { setRejectingDocId(doc.id); setRejectionReason(''); }}
                                          className="flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-lg bg-[#fee2e2] text-[#b91c1c] hover:bg-[#fecaca] disabled:opacity-50 transition-colors cursor-pointer">
                                          <X size={10} /> Reject
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {/* Inline rejection reason form */}
                                  {isRejectOpen && (
                                    <div className="px-4 pb-3 pt-0 space-y-2 border-t border-[#fecaca]">
                                      <p className="text-[10px] font-semibold text-[#b91c1c] pt-2">Reason for rejection (shown to customer)</p>
                                      <input
                                        type="text"
                                        value={rejectionReason}
                                        onChange={e => setRejectionReason(e.target.value)}
                                        placeholder="e.g. Document is blurry, please re-upload"
                                        className="w-full text-xs px-3 py-2 border border-[#fecaca] rounded-xl bg-white focus:outline-none focus:border-[#b91c1c] placeholder:text-[#c0bdb8]"
                                        autoFocus
                                      />
                                      <div className="flex gap-2">
                                        <button
                                          disabled={isReviewing}
                                          onClick={() => handleKycDocAction(doc.id, 'reject', rejectionReason)}
                                          className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#b91c1c] text-white hover:bg-[#991b1b] disabled:opacity-50 transition-colors cursor-pointer">
                                          {isReviewing ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />} Confirm Reject
                                        </button>
                                        <button
                                          onClick={() => { setRejectingDocId(null); setRejectionReason(''); }}
                                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors cursor-pointer">
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {/* RP-requested pending docs (awaiting tenant upload) */}
                        {tenantKycDocs && tenantKycDocs.filter(d => d.status === 'pending').length > 0 && (
                          <div>
                            <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-1.5">Awaiting customer upload</p>
                            <ul className="space-y-1.5">
                              {tenantKycDocs.filter(d => d.status === 'pending').map(doc => (
                                <li key={doc.id} className="flex items-center gap-3 rounded-xl px-4 py-2.5 bg-[#fff7ed] border border-[#fed7aa]">
                                  <FileText size={13} className="shrink-0 text-[#f97316]" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs text-[#9a3412] truncate font-medium">{doc.displayName ?? doc.documentKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                                    {doc.notes && <p className="text-[9px] text-[#9b9890] mt-0.5">{doc.notes}</p>}
                                  </div>
                                  <span className="text-[10px] font-semibold text-[#f97316] shrink-0">Waiting</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Request additional document */}
                        <div className="border-t border-[#f4f3ef] pt-3 space-y-2">
                          <p className="text-[11px] font-semibold text-[#3d3b35]">Request additional document</p>
                          <input
                            type="text"
                            value={docRequestInput}
                            onChange={e => setDocRequestInput(e.target.value)}
                            placeholder="e.g. NOC from previous landlord"
                            className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f9f8f6] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]"
                          />
                          <input
                            type="text"
                            value={docRequestNotes}
                            onChange={e => setDocRequestNotes(e.target.value)}
                            placeholder="Instructions for customer (optional)"
                            className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f9f8f6] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]"
                          />
                          <button
                            disabled={!docRequestInput.trim() || docRequesting}
                            onClick={handleRequestDoc}
                            className="w-full py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                            style={{ background: '#2e9f82' }}
                          >
                            {docRequesting ? <Loader2 size={12} className="animate-spin" /> : null}
                            Send Request to Customer
                          </button>
                        </div>
                      </div>
                    )}
                  </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'clauses' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Special Clauses & Notes */}
                  <SectionCard title="Additional Clauses & Notes" icon={ClipboardList}>
              {tl_isPending ? (
                /* ── Editable (draft/pending only) ── */
                <div className="space-y-3">
                  {/* Existing clauses */}
                  {clauses.length > 0 && (
                    <ol className="space-y-2">
                      {clauses.map((clause, i) => (
                        <li key={i} className="flex items-start gap-3 bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                          <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span className="flex-1 text-sm text-[#1a1916]">{clause}</span>
                          <button
                            type="button"
                            onClick={() => setClauses(prev => prev.filter((_, j) => j !== i))}
                            className="shrink-0 text-[#c0bdb8] hover:text-red-500 transition-colors mt-0.5"
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* Add clause input */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clauseInput}
                      onChange={e => setClauseInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const t = clauseInput.trim();
                          if (t) { setClauses(prev => [...prev, t]); setClauseInput(''); }
                        }
                      }}
                      placeholder="Type a clause and press Enter or click +"
                      className="flex-1 text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const t = clauseInput.trim();
                        if (t) { setClauses(prev => [...prev, t]); setClauseInput(''); }
                      }}
                      className="px-3 py-2 rounded-xl bg-[#2e9f82] text-white hover:bg-[#27896f] transition-colors"
                    >
                      <Plus size={15} />
                    </button>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs font-medium text-[#6b6860] mb-1.5 block">Notes</label>
                    <textarea
                      value={clauseNotes}
                      onChange={e => setClauseNotes(e.target.value)}
                      rows={3}
                      placeholder="Any additional notes for this contract…"
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] focus:outline-none focus:border-[#2e9f82] resize-none placeholder:text-[#c0bdb8]"
                    />
                  </div>

                  {/* Save row */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={saveClauses}
                      disabled={savingClauses}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-xs font-semibold hover:bg-[#27896f] transition-colors disabled:opacity-50"
                    >
                      {savingClauses ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                      Save Clauses
                    </button>
                    {clauseSaved && <span className="text-xs text-[#2e9f82] font-medium">Saved ✓</span>}
                    {clauseSaveError && <span className="text-xs text-red-500">{clauseSaveError}</span>}
                  </div>
                </div>
              ) : (
                /* ── Read-only (issued / active / terminated / expired) ── */
                <div className="space-y-3">
                  {clauses.length > 0 ? (
                    <ol className="space-y-2">
                      {clauses.map((clause, i) => (
                        <li key={i} className="flex items-start gap-3 bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl px-4 py-2.5">
                          <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[#2e9f82] text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                          <span className="flex-1 text-sm text-[#1a1916]">{clause}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-[#b0ada8] italic">No additional clauses.</p>
                  )}
                  {clauseNotes && (
                    <div className="pt-1">
                      <p className="text-xs font-medium text-[#6b6860] mb-1">Notes</p>
                      <p className="text-sm text-[#1a1916] bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl px-4 py-2.5 whitespace-pre-wrap">{clauseNotes}</p>
                    </div>
                  )}
                  <p className="text-[11px] text-[#b0ada8] flex items-center gap-1.5">
                    <BadgeCheck size={12} className="text-[#2e9f82]" />
                    Contract sent to customer — clauses are locked.
                  </p>
                </div>
              )}
                  </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'summary' ? 'hidden' : 'p-5 space-y-4'}>
                  {/* Contract Summary */}
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4" style={{ background: '#2e9f82' }}>
                      <div className="flex items-center gap-2">
                        <FileText size={15} className="text-white/80" />
                        <span className="text-sm font-bold text-white">Contract Summary</span>
                      </div>
                      <p className="text-xs text-white/70 mt-1">{contract.ref}</p>
                    </div>
                    <div className="px-5 py-4 space-y-0">
                      {/* Total contract value comes from the actual payment rows + deposit so it
                          always matches the Payments tab and the tenant view. */}
                      {(() => {
                        const rentTotal = rentChequePayments.reduce((s, p) => s + (p.amount || 0), 0);
                        const depositTotal = depositPayment?.amount ?? Number(contract.securityDepositAmount ?? 0);
                        const grand = rentTotal + depositTotal;
                        const totalCheques = rentChequePayments.length + (depositPayment ? 1 : (contract.securityDepositAmount ? 1 : 0));
                        return (
                          <>
                            <div className="flex justify-between py-2.5 border-b border-[#f4f3ef]">
                              <span className="text-xs text-[#9b9890]">Status</span>
                              <StatusBadge status={contract.status} />
                            </div>
                            <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                              <span className="text-xs text-[#9b9890]">Period</span>
                              <span className="text-xs font-semibold text-[#1a1916] text-right">{fmtDate(contract.startDate)}<br />→ {fmtDate(contract.endDate)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                              <span className="text-xs text-[#9b9890]">Annual Rent</span>
                              <span className="text-sm font-bold text-[#1a1916]">{fmtAed(contract.annualRent)}</span>
                            </div>
                            <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                              <span className="text-xs text-[#9b9890]">Security Deposit</span>
                              <span className="text-xs font-semibold text-[#1a1916]">{isRenewalContract ? 'Extended from prior' : depositTotal > 0 ? `${fmtAed(depositTotal)} (PDC)` : '—'}</span>
                            </div>
                            {totalCheques > 0 && (
                              <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                                <span className="text-xs text-[#9b9890]">Total Payments</span>
                                <span className="text-xs font-semibold text-[#1a1916]">{totalCheques}</span>
                              </div>
                            )}
                            <div className="flex justify-between items-center pt-3 pb-1">
                              <span className="text-xs font-bold text-[#6b6860]">Total Contract Value</span>
                              <span className="text-base font-bold" style={{ color: '#2e9f82' }}>{fmtAed(grand)}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/rental-provider/dashboard/contracts/${contract.id}/print`} target="_blank" className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white">
                      <Eye size={14} /> Preview
                    </Link>
                    <Link href={`/rental-provider/dashboard/contracts/${contract.id}/print`} target="_blank" className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white">
                      <Download size={14} /> Download PDF
                    </Link>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── grid: nav (3) + timeline (9) ──
             Hidden on declined renewal children — the proposal is archived,
             so payment collection drawers, the activation timeline, and the
             Sign Contract CTA would all be misleading. The red declined
             banner + quick-glance strip above already give the RP everything
             they need; the re-propose CTA routes them back to the parent. */}
        {!isDeclinedRenewalChild && (
        <div className="grid grid-cols-12 gap-5 items-start">

          {/* Contract Details vertical nav */}
          <div className="col-span-3 lg:sticky lg:top-20 bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-2 border-b border-[#f0ede8]">
            <p className="text-sm font-bold text-[#1a1916]">Contract Details</p>
            <p className="text-xs text-[#9b9890] mt-0.5">Click any section below to open details</p>
          </div>
          <div className="flex flex-col">
            {([
              { key: 'parties',   icon: User,          label: 'Parties'   },
              { key: 'property',  icon: Building2,     label: 'Property'  },
              { key: 'period',    icon: Calendar,      label: 'Period'    },
              { key: 'payments',  icon: CreditCard,    label: 'Payments'  },
              { key: 'documents', icon: Paperclip,     label: 'Docs'      },
              { key: 'clauses',   icon: ClipboardList, label: 'Clauses'   },
              { key: 'summary',   icon: FileText,      label: 'Summary'   },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveDrawer(key)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium border-l-2 border-transparent text-[#6b6860] hover:border-[#2e9f82] hover:bg-[#f0faf6] hover:text-[#2e9f82] transition-colors text-left group"
              >
                <Icon size={14} className="shrink-0 text-[#2e9f82]" />
                <span className="flex-1">{label}</span>
                <ChevronRight size={12} className="shrink-0 text-[#c0bdb8] group-hover:text-[#2e9f82] transition-colors" />
              </button>
            ))}
          </div>
          </div>{/* end nav col */}

          {/* Tenancy Activation Timeline */}
          <div className="col-span-9 space-y-4">

            {/* ── Tenancy Activation Timeline ── */}
            <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#2e9f82' }}>
                <div>
                  <p className="text-sm font-bold text-white uppercase tracking-wider">
                    {tlIsRenewal ? 'Renewal Workflow' : 'Tenancy Activation'}
                  </p>
                  <p className="text-[11px] text-white/70 mt-0.5">
                    {tl_isActive
                      ? `Active · ends ${fmtDate(contract.endDate)}`
                      : tl_isTerm
                        ? 'Contract terminated'
                        : 'Track & take action on each step'}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                  tl_isActive  ? 'bg-white/20 border-white/30 text-white' :
                  tl_isTerm    ? 'bg-red-200/30 border-red-300/30 text-red-100' :
                                  'bg-amber-100/20 border-amber-200/30 text-amber-100'
                }`}>{tl_s.charAt(0).toUpperCase() + tl_s.slice(1)}</span>
              </div>

              {/* Steps */}
              <div className="px-5 pt-4 pb-3">
                {!tlIsRenewal ? (
                  /* ── NEW CONTRACT: 6 steps ── */
                  <>
                    {/* Step 1: Contract Issued */}
                    {(()=>{ const state: TLStep = stepState(true, st1Done); return (
                    <StepRow num={1} label="Contract Issued" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2">
                          <p className="text-[10px] text-[#9b9890] mb-2">Review the contract in the left panel, then issue it to the customer to begin the signing process.</p>
                          <button
                            onClick={doIssueContract}
                            disabled={markingStep === 'issue'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'issue' ? <Loader2 size={10} className="animate-spin" /> : <FileSignature size={10} />}
                            Issue Contract to Customer
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Issued to customer ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 2: Signatures — tenant signs first, then landlord countersigns.
                         Payments are collected upstream so this immediately follows Contract Issued. */}
                    {(()=>{ const state: TLStep = stepState(st1Done, st3Done); return (
                    <StepRow num={2} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          {/* Tenant first */}
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                            {!hasTenantSigned && <span className="text-[9px] text-[#9b9890] ml-1">(awaiting customer — they sign via their portal)</span>}
                          </div>
                          {/* Landlord countersigns only after tenant has signed */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && hasTenantSigned && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Ejari Registration */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done); return (
                    <StepRow num={3} label="Ejari Registration" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] text-[#9b9890]">Upload the Ejari certificate from DLD — the tenancy will be activated automatically.</p>

                          <div className="space-y-1">
                            <input
                              ref={ejariInputRef}
                              type="file"
                              accept="application/pdf,image/jpeg,image/png"
                              className="hidden"
                              onChange={e => setEjariFile(e.target.files?.[0] ?? null)}
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => ejariInputRef.current?.click()}
                                disabled={ejariUploading}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white disabled:opacity-50">
                                <UploadCloud size={10} /> {ejariFile ? ejariFile.name : 'Choose file'}
                              </button>
                              {ejariFile && (
                                <button
                                  onClick={() => uploadEjariDoc(ejariFile)}
                                  disabled={ejariUploading}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                  {ejariUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />}
                                  {ejariUploading ? 'Uploading & activating…' : 'Upload & Activate'}
                                </button>
                              )}
                            </div>
                            {ejariError && <p className="text-[9px] text-red-600">{ejariError}</p>}
                          </div>
                        </div>
                      )}
                      {state === 'done' && (
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-[#2e9f82]">Registered with DLD ✓</p>
                          <button
                            onClick={resetEjariUpload}
                            disabled={ejariResetting}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white disabled:opacity-50 flex items-center gap-1">
                            {ejariResetting ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />}
                            Re-upload Ejari
                          </button>
                        </div>
                      )}
                      {state === 'done' && ejariError && (
                        <p className="text-[9px] text-red-600 mt-1">{ejariError}</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 4: Utility Account — either party can upload */}
                    {(()=>{ const state: TLStep = stepState(st4Done, stUtilityDone); return (
                    <StepRow num={4} label="Utility Account" state={state} last={false}>
                      <p className="text-[10px] text-[#9b9890] mt-0.5">
                        DEWA / utility proof — customer can upload from their portal, or you can attach it here.
                      </p>

                      {/* Utility upload — shown when step is current OR when doc exists */}
                      {(state === 'current' || utilityDoc) && (
                        <div className="mt-2 space-y-1">
                          <input ref={utilityInputRef} type="file" accept="image/*,application/pdf" className="hidden"
                            onChange={e => setUtilityFile(e.target.files?.[0] ?? null)} />
                          {utilityDoc ? (
                            <div className="flex items-center gap-1.5 text-[10px] text-[#2e9f82]">
                              <CheckCircle size={10} />
                              <span className="font-medium">Proof uploaded ✓</span>
                              {utilityDoc.fileUrl && (
                                <a href={utilityDoc.fileUrl} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-0.5 text-[#2e9f82] hover:underline font-normal">
                                  <ExternalLink size={9} /> View
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => utilityInputRef.current?.click()}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white">
                                  <UploadCloud size={10} /> {utilityFile ? utilityFile.name : 'Upload proof'}
                                </button>
                                {utilityFile && (
                                  <button onClick={() => uploadUtilityDoc(utilityFile)} disabled={utilityUploading}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                    {utilityUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />} Upload
                                  </button>
                                )}
                              </div>
                              {utilityError && <p className="text-[9px] text-red-600">{utilityError}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 5: Move-In Inspection */}
                    {(()=>{ const state: TLStep = stepState(stUtilityDone, stMoveInDone); return (
                    <StepRow num={5} label="Move-In Inspection" state={state} last={false}>
                      <Link href={`/rental-provider/dashboard/contracts/${contract.id}/inspection?type=move_in`}
                        className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#2e9f82] text-[#2e9f82] hover:bg-[#f0faf7] w-fit">
                        <ClipboardCheck size={10} /> {state === 'done' ? 'View Move-In Inspection' : 'Open Move-In Inspection'}
                      </Link>

                      {state !== 'upcoming' && (
                        <div className="mt-2 space-y-1">
                          <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide">Inspection signing progress</p>
                          {[
                            { label: 'RP submitted inspection', done: !!moveInInsp?.rpSubmittedAt },
                            { label: 'Tenant signed', done: !!moveInInsp?.tenantSig },
                            { label: 'RP counter-signed → tenancy activated', done: !!moveInInsp?.rpCounterSig },
                          ].map(({ label, done }) => (
                            <div key={label} className="flex items-center gap-1.5">
                              <span className={`w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${done ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{done ? '✓' : '○'}</span>
                              <span className={`text-[10px] ${done ? 'text-[#2e9f82] font-medium' : 'text-[#9b9890]'}`}>{label}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Inline RP counter-sign — visible when tenant has signed but RP hasn't yet.
                          Posting here auto-activates the tenancy server-side. */}
                      {moveInInsp?.tenantSig && !moveInInsp?.rpCounterSig && state !== 'upcoming' && (
                        <div className="mt-3 p-3 rounded-lg border border-[#fed7aa] bg-[#fff7ed] space-y-2">
                          <p className="text-[10px] font-semibold text-[#9a3412]">Counter-sign to activate the tenancy</p>
                          <p className="text-[10px] text-[#c2410c]">Tenant has signed. Add your signature below to lock the inspection record and activate the contract.</p>
                          <div className="bg-white rounded-md border border-[#fed7aa] overflow-hidden">
                            <SignaturePad onSignatureChange={setInspSigImg} />
                          </div>
                          {inspSigError && <p className="text-[9px] text-red-600">{inspSigError}</p>}
                          <button
                            type="button"
                            disabled={inspSigBusy || !inspSigImg}
                            onClick={async () => {
                              if (!inspSigImg) { setInspSigError('Please draw your signature.'); return; }
                              setInspSigBusy(true); setInspSigError(null);
                              try {
                                const res = await fetch(`/api/contracts/${contract.id}/inspection/sign?type=move_in`, {
                                  method: 'POST', credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ signatureImage: inspSigImg }),
                                });
                                if (!res.ok) {
                                  const b = await res.json().catch(() => ({}));
                                  throw new Error(b?.message ?? `Error ${res.status}`);
                                }
                                // Re-fetch inspection so rpCounterSig is reflected; reload the contract too
                                // since signing here auto-activates the tenancy.
                                const ir = await fetch(`/api/contracts/${contract.id}/inspection?type=move_in`, { credentials: 'include' });
                                if (ir.ok) {
                                  const insp = await ir.json();
                                  setMoveInInsp({ rpSubmittedAt: insp.rpSubmittedAt, tenantSig: insp.tenantSig, rpCounterSig: insp.rpCounterSig, rpCounterSignedAt: insp.rpCounterSignedAt });
                                }
                                const cr = await fetch(`/api/contracts/${contract.id}`, { credentials: 'include' });
                                if (cr.ok) setContract(await cr.json());
                                setInspSigImg(null);
                              } catch (e) {
                                setInspSigError(e instanceof Error ? e.message : 'Failed to sign');
                              } finally {
                                setInspSigBusy(false);
                              }
                            }}
                            className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#c2410c] text-white text-[10px] font-semibold hover:bg-[#9a3412] disabled:opacity-50"
                          >
                            {inspSigBusy ? <Loader2 size={10} className="animate-spin" /> : <FileSignature size={10} />}
                            {inspSigBusy ? 'Signing…' : 'Counter-sign & activate tenancy'}
                          </button>
                        </div>
                      )}

                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Unit handed over ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 6: Active Tenancy */}
                    {(()=>{ const state: TLStep = tl_isActive ? 'current' : 'upcoming'; return (
                    <StepRow num={6} label="Active Tenancy" state={state} last={true}>
                      {tl_isActive && (
                        <div className="mt-1 space-y-2">
                          <p className="text-[10px] text-[#2e9f82] font-medium">Contract is live</p>
                          <p className="text-[10px] text-[#9b9890]">Ends {fmtDate(contract.endDate)} · {contract.numberOfInstallments ?? '—'} payments</p>
                          <div className="flex gap-2 pt-1">
                            <Link
                              href={`/rental-provider/dashboard/contracts/${contract.id}/print`}
                              target="_blank"
                              className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md border border-[#2e9f82] text-[#2e9f82] hover:bg-[#f0faf7] transition-colors"
                            >
                              <Eye size={10} /> Preview Rental Agreement
                            </Link>
                            <Link
                              href={`/rental-provider/dashboard/contracts/${contract.id}/print/receipt`}
                              target="_blank"
                              className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] transition-colors"
                            >
                              <FileText size={10} /> Preview Receipt
                            </Link>
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}
                  </>
                ) : (
                  /* ── RENEWAL CONTRACT: 5 steps ── */
                  <>
                    {/* Step 1: Terms Agreed */}
                    {(()=>{ const state: TLStep = 'done'; return (
                    <StepRow num={1} label="Renewal Terms Agreed" state={state} last={false}>
                      <p className="text-[10px] text-[#2e9f82] mt-0.5">New rent & duration confirmed ✓</p>
                    </StepRow>
                    );})()}

                    {/* Step 2: Payment Collection — customer submits payment references, RP records them.
                         For renewals there's no upstream lead, so payments are collected on this
                         contract before signatures can proceed. */}
                    {(()=>{ const state: TLStep = stepState(true, st2Done); return (
                    <StepRow num={2} label="Payment Collection" state={state} last={false}>
                      <p className="text-[10px] text-[#9b9890] mt-0.5">Customer prepares the payments — record each one and confirm receipt.</p>
                      {/* Customer submission status — mirrors the lead's CHEQUES_SUBMITTED stage.
                          The customer signals readiness from their portal before the RP records. */}
                      {state === 'current' && contract.tenantChequesSubmittedAt && (
                        <div className="mt-2 flex items-start gap-1.5 text-[10px] bg-[#fef9c3] border border-[#fde68a] rounded-lg px-2.5 py-1.5">
                          <CheckCircle size={11} className="text-[#854d0e] shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="font-semibold text-[#854d0e]">Customer confirmed payments submitted</p>
                            <p className="text-[9px] text-[#854d0e] opacity-80">
                              {new Date(contract.tenantChequesSubmittedAt).toLocaleString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              {' '}— record each one below and confirm receipt.
                            </p>
                          </div>
                        </div>
                      )}
                      {state === 'current' && !contract.tenantChequesSubmittedAt && (
                        <p className="mt-2 text-[10px] text-[#9b9890] italic">Awaiting customer to confirm payments.</p>
                      )}
                      {state === 'current' && (
                        <div className="mt-2 space-y-1.5">
                          {feeError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                              <AlertCircle size={11} />{feeError}
                            </div>
                          )}
                          {/* Security Deposit row — N/A for renewals (carries forward from parent) */}
                          {(contract.securityDepositAmount ?? 0) > 0 && (
                            <div className="flex items-center justify-between rounded-lg border border-[#e8e6e0] px-2.5 py-2">
                              <div>
                                <p className="text-[10px] font-semibold text-[#1a1916]">Security Deposit</p>
                                <p className="text-[9px] text-[#9b9890]">{fmtAed(contract.securityDepositAmount ?? 0)}</p>
                              </div>
                              {depositPayment ? (
                                <span className="text-[9px] font-semibold text-[#2e9f82] flex items-center gap-0.5"><CheckCircle size={9} /> Recorded</span>
                              ) : (
                                <span className="text-[9px] text-[#9b9890] italic">Not recorded</span>
                              )}
                            </div>
                          )}
                          {/* Rental Instalments row */}
                          <div className="flex items-center justify-between rounded-lg border border-[#e8e6e0] px-2.5 py-2">
                            <div>
                              <p className="text-[10px] font-semibold text-[#1a1916]">Rental Instalments</p>
                              <p className="text-[9px] text-[#9b9890]">{expectedCheques} payment{expectedCheques === 1 ? '' : 's'}</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              allChequesRecorded ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#fef9c3] text-[#854d0e]'
                            }`}>
                              {rentChequePayments.length} / {expectedCheques}
                            </span>
                          </div>
                          {/* Open payments drawer */}
                          <button
                            onClick={() => setActiveDrawer('payments')}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-lg border border-[#e8e6e0] text-[#1a1916] hover:bg-white flex items-center justify-center gap-1.5">
                            <CreditCard size={10} /> Manage Payments
                            <ChevronRight size={9} className="ml-auto opacity-50" />
                          </button>
                          {/* Confirm PDC Received button */}
                          <div className={`pt-0.5 ${!allChequesRecorded ? 'opacity-40 pointer-events-none' : ''}`}>
                            <button
                              onClick={handleConfirmPdc}
                              disabled={confirmingPdc || !allChequesRecorded}
                              className="w-full flex items-center justify-center gap-1.5 text-[10px] font-semibold py-2 rounded-lg text-white disabled:opacity-50"
                              style={{ background: '#2e9f82' }}
                            >
                              {confirmingPdc
                                ? <><Loader2 size={10} className="animate-spin" /> Confirming…</>
                                : <><CheckCircle size={10} /> Confirm PDC Received</>
                              }
                            </button>
                            {!allChequesRecorded && (
                              <p className="text-[9px] text-[#9b9890] text-center mt-1">
                                Record all {expectedCheques} rental cheques above first
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5 flex items-center gap-1">
                          <CheckCircle size={9} /> PDC collection confirmed — proceed to signatures
                        </p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Signatures — tenant first, then landlord countersigns */}
                    {(()=>{ const state: TLStep = stepState(st2Done, st3Done); return (
                    <StepRow num={3} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                            {!hasTenantSigned && <span className="text-[9px] text-[#9b9890] ml-1">(awaiting customer — they sign via their portal)</span>}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && hasTenantSigned && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Ejari Renewal */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done);
                      return (
                    <StepRow num={4} label="Ejari Renewal" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] text-[#9b9890]">Upload the renewed Ejari certificate — the renewal will be activated automatically.</p>
                          <div className="space-y-1">
                            <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => setEjariFile(e.target.files?.[0] ?? null)} />
                            <div className="flex items-center gap-2">
                              <button onClick={() => ejariInputRef.current?.click()} disabled={ejariUploading}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white disabled:opacity-50">
                                <UploadCloud size={10} /> {ejariFile ? ejariFile.name : 'Choose file'}
                              </button>
                              {ejariFile && (
                                <button onClick={() => uploadEjariDoc(ejariFile)} disabled={ejariUploading}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                  {ejariUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />}
                                  {ejariUploading ? 'Uploading & activating…' : 'Upload & Activate'}
                                </button>
                              )}
                            </div>
                            {ejariError && <p className="text-[9px] text-red-600">{ejariError}</p>}
                          </div>
                        </div>
                      )}
                      {state === 'done' && (
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] text-[#2e9f82]">Ejari renewed with DLD ✓</p>
                          <button
                            onClick={resetEjariUpload}
                            disabled={ejariResetting}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white disabled:opacity-50 flex items-center gap-1">
                            {ejariResetting ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />}
                            Re-upload Ejari
                          </button>
                        </div>
                      )}
                      {state === 'done' && ejariError && <p className="text-[9px] text-red-600 mt-1">{ejariError}</p>}
                    </StepRow>
                    );})()}

                    {/* Step 4: Active Renewal */}
                    {(()=>{ const state: TLStep = stepState(st4Done, st5Done); return (
                    <StepRow num={5} label="Active Renewal" state={state} last={true}>
                      {tl_isActive && (
                        <div className="mt-1">
                          <p className="text-[10px] text-[#2e9f82] font-medium">Renewal is live</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Until {fmtDate(contract.endDate)}</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Termination / re-renewal will appear when initiated.</p>
                        </div>
                      )}
                      {state === 'current' && !tl_isActive && (
                        <div className="mt-2">
                          <button onClick={doActivateContract}
                            disabled={!moveInConfirmed || !utilityDoc || markingStep === 'activate'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Activate Renewal
                          </button>
                        </div>
                      )}
                    </StepRow>
                    );})()}
                  </>
                )}

                {/* Global error */}
                {feeError && !tl_isActive && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                    <AlertCircle size={11} />{feeError}
                  </div>
                )}
              </div>
            </div>

            {/* Created at */}
            <p className="text-[10px] text-center text-[#b0ada8]">
              Created {fmtDate(contract.createdAt)}
            </p>
          </div>{/* end timeline col */}

        </div>
        )}{/* end grid */}
      </div>

      {/* Sign modal */}
      {showSignModal && (
        <SignModal
          contract={contract}
          onClose={() => setShowSignModal(false)}
          onSigned={() => {
            setSignedMode('online');
            setShowSignModal(false);
          }}
        />
      )}

      {/* Propose Renewal modal — SCRUM-273 */}
      {showRenewalModal && contract && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => !renewalSubmitting && setShowRenewalModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[#e8e6e0] flex items-center justify-between sticky top-0 bg-white z-10">
              <div className="flex items-center gap-2">
                <RotateCcw size={18} className="text-[#2e9f82]" />
                <h2 className="text-base font-bold text-[#1a1916]">Propose Renewal</h2>
              </div>
              <button onClick={() => !renewalSubmitting && setShowRenewalModal(false)} className="text-[#9b9890] hover:text-[#1a1916] p-1 rounded-lg hover:bg-[#f4f3ef] transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {/* Current contract summary — read only */}
              <div>
                <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Current Contract</p>
                <div className="bg-[#f7f6f2] border border-[#e8e6e0] rounded-xl p-3.5 grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                  <div><span className="text-[#9b9890]">Tenant </span><span className="font-semibold text-[#1a1916]">{contract.tenant.name ?? <span className="text-red-600">missing</span>}</span></div>
                  <div><span className="text-[#9b9890]">Period </span><span className="font-semibold text-[#1a1916]">{fmtDate(contract.startDate)} → {fmtDate(contract.endDate)}</span></div>
                  <div><span className="text-[#9b9890]">Building </span><span className="font-semibold text-[#1a1916]">{contract.property.buildingName ?? '—'}</span></div>
                  <div><span className="text-[#9b9890]">Unit </span><span className="font-semibold text-[#1a1916]">{contract.unit.number ?? '—'}</span></div>
                  <div><span className="text-[#9b9890]">Location </span><span className="font-semibold text-[#1a1916]">{[contract.property.community, contract.property.emirate].filter(Boolean).join(', ') || '—'}</span></div>
                  <div><span className="text-[#9b9890]">Annual Rent </span><span className="font-semibold text-[#1a1916]">{fmtAed(contract.annualRent)}</span></div>
                  <div><span className="text-[#9b9890]">Installments </span><span className="font-semibold text-[#1a1916]">{contract.numberOfInstallments ?? '—'} payment{contract.numberOfInstallments === 1 ? '' : 's'}</span></div>
                  <div><span className="text-[#9b9890]">Security Deposit </span><span className="font-semibold text-[#1a1916]">{fmtAed(contract.securityDepositAmount ?? 0)}</span></div>
                  <div className="col-span-2"><span className="text-[#9b9890]">Cheques payable to </span><span className="font-semibold text-[#1a1916]">{contract.landlord.companyName ?? contract.landlord.name ?? '—'}</span></div>
                </div>
              </div>

              {/* Renewal period — start / end / installments / method */}
              <div>
                <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Renewal Period</p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-[#6b6860] block mb-1">Start date</label>
                      <input
                        type="date"
                        value={renewalForm.newStartDate}
                        onChange={e => setRenewalForm(f => ({ ...f, newStartDate: e.target.value }))}
                        className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-[#6b6860] block mb-1">End date</label>
                      <input
                        type="date"
                        value={renewalForm.newEndDate}
                        onChange={e => setRenewalForm(f => ({ ...f, newEndDate: e.target.value }))}
                        className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] font-medium text-[#6b6860] block mb-1">Installments</label>
                      <select
                        value={renewalForm.numberOfInstallments}
                        onChange={e => setRenewalForm(f => ({ ...f, numberOfInstallments: e.target.value }))}
                        className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      >
                        {[1, 2, 3, 4, 6, 12].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-[#6b6860] block mb-1">Payment method</label>
                      <select
                        value={renewalForm.modeOfPayment}
                        onChange={e => setRenewalForm(f => ({ ...f, modeOfPayment: e.target.value }))}
                        className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      >
                        <option value="cheque">Cheque</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="online">Online</option>
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      checked={renewalForm.samePayee}
                      onChange={e => setRenewalForm(f => ({ ...f, samePayee: e.target.checked }))}
                      className="h-4 w-4 accent-[#2e9f82]"
                    />
                    <span className="text-xs text-[#6b6860]">
                      Issue cheques to same payee (<span className="font-semibold text-[#1a1916]">{contract.landlord.companyName ?? contract.landlord.name ?? '—'}</span>)
                    </span>
                  </label>
                  {!renewalForm.samePayee && (
                    <input
                      type="text"
                      value={renewalForm.chequePayeeName}
                      onChange={e => setRenewalForm(f => ({ ...f, chequePayeeName: e.target.value }))}
                      placeholder="New payee name (used when payment method is cheque)"
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                    />
                  )}
                </div>
              </div>

              {/* Rent & Fees — single grouped block (admin + ejari + commission bundle into payment 1; deposit carries forward) */}
              <div>
                <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Rent &amp; Fees (AED)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] font-medium text-[#6b6860] block mb-1">New annual rent</label>
                    <input
                      type="number"
                      min={0}
                      value={renewalForm.newAnnualRent}
                      onChange={e => setRenewalForm(f => ({ ...f, newAnnualRent: e.target.value }))}
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      placeholder="90000"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#6b6860] flex items-center justify-between mb-1">
                      <span>Admin fee</span>
                      {feesTouched.adminFee && (
                        <button
                          type="button"
                          onClick={() => setFeesTouched(t => ({ ...t, adminFee: false }))}
                          className="text-[10px] text-[#2e9f82] hover:underline cursor-pointer"
                        >Reset to rule</button>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={renewalForm.adminFee}
                      onChange={e => { setFeesTouched(t => ({ ...t, adminFee: true })); setRenewalForm(f => ({ ...f, adminFee: e.target.value })); }}
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      placeholder="From your fee rule"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#6b6860] flex items-center justify-between mb-1">
                      <span>Ejari fee</span>
                      {feesTouched.ejariFee && (
                        <button
                          type="button"
                          onClick={() => setFeesTouched(t => ({ ...t, ejariFee: false }))}
                          className="text-[10px] text-[#2e9f82] hover:underline cursor-pointer"
                        >Reset to rule</button>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={renewalForm.ejariFee}
                      onChange={e => { setFeesTouched(t => ({ ...t, ejariFee: true })); setRenewalForm(f => ({ ...f, ejariFee: e.target.value })); }}
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      placeholder="From your fee rule"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#6b6860] flex items-center justify-between mb-1">
                      <span>Commission</span>
                      {feesTouched.commission && (
                        <button
                          type="button"
                          onClick={() => setFeesTouched(t => ({ ...t, commission: false }))}
                          className="text-[10px] text-[#2e9f82] hover:underline cursor-pointer"
                        >Reset to rule</button>
                      )}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={renewalForm.commission}
                      onChange={e => { setFeesTouched(t => ({ ...t, commission: true })); setRenewalForm(f => ({ ...f, commission: e.target.value })); }}
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-white focus:outline-none focus:border-[#2e9f82]"
                      placeholder="From your fee rule"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-[#6b6860] block mb-1">Security deposit (carried forward)</label>
                    <input
                      type="number"
                      value={contract.securityDepositAmount ?? 0}
                      disabled
                      className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] text-[#6b6860] cursor-not-allowed"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-[#9b9890] mt-1.5">
                  Admin, ejari and commission auto-fill from your <a href="/rental-provider/dashboard/settings" target="_blank" rel="noreferrer" className="text-[#2e9f82] hover:underline">fee rules</a> against the new annual rent — edit any value to override. They bundle into the first installment. Security deposit stays the same and is not re-collected.
                </p>
              </div>

              {/* Planned Installments preview — mirrors the new-lease auto-plan:
                  payment #1 wraps admin + ejari + commission + first rent installment,
                  payments 2..N are rent-only at month-stepped due dates. */}
              {(() => {
                const n      = parseInt(renewalForm.numberOfInstallments, 10) || 0;
                const rent   = parseFloat(renewalForm.newAnnualRent) || 0;
                const admin  = Math.max(0, parseFloat(renewalForm.adminFee)   || 0);
                const ejari  = Math.max(0, parseFloat(renewalForm.ejariFee)   || 0);
                const comm   = Math.max(0, parseFloat(renewalForm.commission) || 0);
                const start  = renewalForm.newStartDate ? new Date(renewalForm.newStartDate) : null;
                const end    = renewalForm.newEndDate   ? new Date(renewalForm.newEndDate)   : null;
                if (!n || !rent || !start || !end) return null;
                const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
                const stepDays  = Math.max(1, Math.floor(totalDays / n));
                const base      = Math.floor(rent / n);
                const last      = rent - base * (n - 1);
                const firstRent = n === 1 ? last : base;
                const bundleAmount = admin + ejari + comm + firstRent;
                const bundleParts: string[] = [];
                if (admin > 0) bundleParts.push('Admin');
                if (ejari > 0) bundleParts.push('Ejari');
                if (comm  > 0) bundleParts.push('Commission');
                bundleParts.push(n === 1 ? 'Annual Rent' : 'Installment 1');
                const bundleLabel = bundleParts.length > 1
                  ? `${bundleParts.join(' + ')} (Payment 1/${n})`
                  : `Rent — Payment 1/${n}`;
                const rows = [
                  { idx: 1, due: new Date(start), description: bundleLabel, amount: bundleAmount, bundled: bundleParts.length > 1 },
                  ...Array.from({ length: Math.max(0, n - 1) }, (_, i) => {
                    const d = new Date(start);
                    d.setDate(d.getDate() + (i + 1) * stepDays);
                    return {
                      idx: i + 2,
                      due: d,
                      description: `Rent — Payment ${i + 2}/${n}`,
                      amount: i === n - 2 ? last : base,
                      bundled: false,
                    };
                  }),
                ];
                const total = rows.reduce((s, r) => s + r.amount, 0);
                return (
                  <div>
                    <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Planned Installments</p>
                    <div className="border border-[#e8e6e0] rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-[#f7f6f2] text-[10px] text-[#9b9890] uppercase tracking-wide">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">#</th>
                            <th className="px-3 py-2 text-left font-medium">Description</th>
                            <th className="px-3 py-2 text-left font-medium">Due date</th>
                            <th className="px-3 py-2 text-right font-medium">Amount (AED)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr key={r.idx} style={{ borderTop: '1px solid #f0ede8', background: r.bundled ? '#fef9ed' : undefined }}>
                              <td className="px-3 py-2 text-[#9b9890]">{r.idx}</td>
                              <td className="px-3 py-2 text-[#1a1916]">{r.description}</td>
                              <td className="px-3 py-2 text-[#1a1916] tabular-nums">{fmtDate(r.due.toISOString())}</td>
                              <td className="px-3 py-2 text-right text-[#1a1916] font-semibold tabular-nums">{r.amount.toLocaleString('en-AE')}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: '2px solid #e8e6e0' }} className="bg-[#f7f6f2]">
                            <td className="px-3 py-2 text-[10px] text-[#9b9890] uppercase font-semibold" colSpan={3}>Total</td>
                            <td className="px-3 py-2 text-right text-[#1a1916] font-bold tabular-nums">{total.toLocaleString('en-AE')}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-[#9b9890] mt-1.5">
                      Payment 1 bundles admin + ejari + commission + rent installment 1. Subsequent payments are rent-only, month-stepped to the renewal end date.
                    </p>
                  </div>
                );
              })()}

              {/* Extra installments / charges */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide">Additional Charges (optional)</p>
                  <button
                    type="button"
                    onClick={() => setRenewalExtras(prev => [...prev, { description: '', amount: '', dueDate: renewalForm.newStartDate }])}
                    className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-[#2e9f82] text-[#2e9f82] hover:bg-[#f0faf6] transition-colors"
                  >
                    <Plus size={11} /> Add line
                  </button>
                </div>
                {renewalExtras.length === 0 ? (
                  <p className="text-[11px] text-[#9b9890] italic">No additional charges. Use this for VAT, Municipality Fee, parking add-on, etc.</p>
                ) : (
                  <div className="space-y-2">
                    {renewalExtras.map((ec, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_120px_140px_28px] gap-2 items-center">
                        <input
                          type="text"
                          value={ec.description}
                          onChange={e => setRenewalExtras(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                          placeholder="e.g. Municipality Fee"
                          className="text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]"
                        />
                        <input
                          type="number"
                          min={0}
                          value={ec.amount}
                          onChange={e => setRenewalExtras(prev => prev.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                          placeholder="Amount AED"
                          className="text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82] text-right tabular-nums"
                        />
                        <input
                          type="date"
                          value={ec.dueDate}
                          onChange={e => setRenewalExtras(prev => prev.map((x, i) => i === idx ? { ...x, dueDate: e.target.value } : x))}
                          className="text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]"
                        />
                        <button
                          type="button"
                          onClick={() => setRenewalExtras(prev => prev.filter((_, i) => i !== idx))}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-[#9b9890] hover:text-red-600 hover:bg-red-50 transition-colors"
                          aria-label="Remove charge"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {renewalError && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" />
                  <span>{renewalError}</span>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-[#e8e6e0] flex justify-end gap-2 sticky bottom-0 bg-white">
              <button
                onClick={() => setShowRenewalModal(false)}
                disabled={renewalSubmitting}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitProposeRenewal}
                disabled={renewalSubmitting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: '#2e9f82' }}
              >
                {renewalSubmitting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                {renewalSubmitting ? 'Proposing…' : 'Propose Renewal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Termination request modal */}
      {showTerminateConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <AlertCircle size={18} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#1a1916]">Request termination</p>
                <p className="text-xs text-[#6b6860] mt-1">
                  The customer must accept this request before the contract terminates.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#1a1916] mb-1">Reason</label>
                <textarea
                  value={terminateReason}
                  onChange={e => setTerminateReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why you want to terminate this contract…"
                  className="w-full text-xs px-2.5 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#1a1916] mb-1">Effective date</label>
                <input
                  type="date"
                  value={terminateEffectiveDate}
                  onChange={e => setTerminateEffectiveDate(e.target.value)}
                  className="w-full text-xs px-2.5 py-2 border border-[#e8e6e0] rounded-lg focus:outline-none focus:border-[#2e9f82]"
                />
              </div>
              {terminateError && <p className="text-xs text-red-600">{terminateError}</p>}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowTerminateConfirm(false); setTerminateError(null); }}
                disabled={terminateSubmitting}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={submitTerminationRequest}
                disabled={terminateSubmitting}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                {terminateSubmitting && <Loader2 size={12} className="animate-spin" />}
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View All Documents modal ── */}
      {(() => {
        const KYC_1  = new Set(['emirates_id', 'passport', 'uae_visa']);
        const RENTAL = new Set(['employment_letter','bank_statement','marriage_certificate','rental_history','credit_report','utility_clearance','trade_license','tax_registration','moa','business_license','utility_proof_of_payment']);
        const allDocs = (tenantKycDocs ?? []).filter(d => d.documentKey !== 'profile_picture');

        const imgDocs = allDocs.filter(d => {
          const up = d.fileUrl.split('?')[0].toLowerCase();
          const isPdf = d.mimeType === 'application/pdf' || up.endsWith('.pdf');
          return !isPdf && (d.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(up));
        });
        const lightboxSlides = imgDocs.map(d => ({
          src: d.fileUrl,
          title: d.displayName ?? d.documentKey.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          description: d.status === 'processed' ? '✓ Approved' : d.status === 'rejected' ? '✗ Rejected' : 'Uploaded',
        }));

        if (!viewAllOpen) {
          return lightboxOpen ? (
            <Lightbox
              open={lightboxOpen}
              close={() => setLightboxOpen(false)}
              index={lightboxIndex}
              slides={lightboxSlides}
              plugins={[LbZoom, LbCaptions, LbThumbnails]}
              zoom={{ maxZoomPixelRatio: 4 }}
              captions={{ showToggle: true }}
            />
          ) : null;
        }

        const occ1   = allDocs.filter(d => KYC_1.has(d.documentKey));
        const rental = allDocs.filter(d => RENTAL.has(d.documentKey));
        const extraMap = new Map<number, TenantKycDoc[]>();
        const other: TenantKycDoc[] = [];
        for (const d of allDocs) {
          const m = d.documentKey.match(/^(emirates_id|passport|uae_visa)_(\d+)$/);
          if (m) { const n = parseInt(m[2]); if (!extraMap.has(n)) extraMap.set(n, []); extraMap.get(n)!.push(d); }
          else if (!KYC_1.has(d.documentKey) && !RENTAL.has(d.documentKey)) other.push(d);
        }
        type DocGroup = { heading: string; sub?: string; docs: TenantKycDoc[] };
        const groups: DocGroup[] = [];
        if (occ1.length)   groups.push({ heading: 'Occupant 1 — Identity', docs: occ1 });
        [...extraMap.keys()].sort((a,b) => a-b).forEach(n =>
          groups.push({ heading: `Occupant ${n} — Identity`, sub: 'optional', docs: extraMap.get(n)! })
        );
        if (rental.length) groups.push({ heading: 'Rental Documents', docs: rental });
        if (other.length)  groups.push({ heading: 'Other', docs: other });

        const tenantName = contract.tenant.name?.trim() || '—';
        const unitLabel  = contract.unit.name ?? (contract.unit.number ? `Unit ${contract.unit.number}` : '—');

        function StatusChip({ status }: { status: string }) {
          if (status === 'processed') return <span className="text-[9px] font-bold bg-[#dcfce7] text-[#16a34a] rounded px-1.5 py-0.5">Approved</span>;
          if (status === 'rejected')  return <span className="text-[9px] font-bold bg-[#fee2e2] text-[#b91c1c] rounded px-1.5 py-0.5">Rejected</span>;
          return <span className="text-[9px] font-bold bg-[#f4f3ef] text-[#6b6860] rounded px-1.5 py-0.5">Uploaded</span>;
        }

        function DocEntry({ doc }: { doc: TenantKycDoc }) {
          const label = doc.displayName ?? doc.documentKey.replace(/_\d+$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const urlPath = doc.fileUrl.split('?')[0].toLowerCase();
          const isPdf = doc.mimeType === 'application/pdf' || urlPath.endsWith('.pdf');
          const isImg = !isPdf && (doc.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(urlPath));
          const imgIdx = isImg ? imgDocs.findIndex(d => d.id === doc.id) : -1;
          return (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-semibold text-[#1a1916]">{label}</span>
                <StatusChip status={doc.status} />
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[10px] text-[#2e9f82] hover:underline shrink-0">
                  Open <ExternalLink size={10} />
                </a>
              </div>
              {isPdf ? (
                <iframe src={doc.fileUrl} className="w-full h-[480px] rounded-xl border border-[#e8e6e0]" />
              ) : isImg ? (
                <button type="button" onClick={() => { setLightboxIndex(imgIdx); setLightboxOpen(true); }}
                  className="group relative block w-full rounded-xl overflow-hidden border border-[#e8e6e0] bg-[#f8f7f4] cursor-zoom-in">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.fileUrl} alt={label} loading="lazy"
                    className="max-h-[320px] w-full object-contain block transition-transform duration-200 group-hover:scale-[1.02]" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                    <span className="bg-white/90 rounded-full p-2 shadow"><ZoomIn size={18} className="text-[#1a1916]" /></span>
                  </div>
                </button>
              ) : (
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-[#2e9f82] hover:underline">
                  <FileText size={14} /> Open file
                </a>
              )}
            </div>
          );
        }

        return (
          <>
            <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4"
              onClick={(e) => { if (e.target === e.currentTarget) setViewAllOpen(false); }}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl">
                <div className="sticky top-0 bg-white rounded-t-2xl border-b border-[#e8e6e0] px-6 py-4 flex items-center justify-between z-10">
                  <div>
                    <p className="text-sm font-bold text-[#1a1916]">{tenantName}</p>
                    <p className="text-[11px] text-[#9b9890]">{unitLabel} · {allDocs.length} document{allDocs.length !== 1 ? 's' : ''}</p>
                  </div>
                  <button onClick={() => setViewAllOpen(false)}
                    className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#f4f3ef] text-[#6b6860] transition-colors cursor-pointer">
                    <X size={16} />
                  </button>
                </div>
                <div className="px-6 py-6 space-y-8">
                  {groups.map((g, gi) => (
                    <section key={gi}>
                      <div className="flex items-baseline gap-2 mb-4 border-b-2 border-[#2e9f82] pb-1.5">
                        <h2 className="text-[13px] font-bold text-[#1a1916]">{g.heading}</h2>
                        {g.sub && <span className="text-[10px] text-[#9b9890]">{g.sub}</span>}
                      </div>
                      {g.docs.map(doc => <DocEntry key={doc.id} doc={doc} />)}
                    </section>
                  ))}
                </div>
              </div>
            </div>
            <Lightbox
              open={lightboxOpen}
              close={() => setLightboxOpen(false)}
              index={lightboxIndex}
              slides={lightboxSlides}
              plugins={[LbZoom, LbCaptions, LbThumbnails]}
              zoom={{ maxZoomPixelRatio: 4 }}
              captions={{ showToggle: true }}
            />
          </>
        );
      })()}
    </div>
  );
}
