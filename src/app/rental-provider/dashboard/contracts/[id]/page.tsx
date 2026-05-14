/**
 * Rental Provider — Contract Detail page (rental-provider/dashboard/contracts/[id])
 *
 * Full contract management view for the RP. Includes:
 *   - 6-step non-renewal timeline: Contract Issued → Payment Collection →
 *     Signatures → Ejari Registration → Move-In & DEWA → Active Tenancy
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
  CreditCard, ListChecks, Eye, ChevronRight,
} from 'lucide-react';

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
  tenant: { id: number | null; name: string | null; email: string | null; phone: string | null };
  landlord: { id: number | null; name: string | null; email: string | null; phone: string | null; companyName: string | null };
  property: { buildingName: string | null; fullAddress: string | null; community: string | null; emirate: string | null };
  unit: { number: string | null; name: string | null; type: string | null; floor: string | null; bedrooms: number | null; bathrooms: number | null };
  documents: ContractDoc[];
  payments: ContractPayment[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function SectionCard({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-4 border-b border-[#f0ede8]"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-[#2e9f82]" />
          <span className="text-sm font-semibold text-[#1a1916]">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="text-[#9b9890]" /> : <ChevronDown size={14} className="text-[#9b9890]" />}
      </button>
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
  const [rentChequesConsented, setRentChequesConsented] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);
  const [tenantKycDocs, setTenantKycDocs] = useState<{ id: number; documentKey: string; displayName: string | null; fileUrl: string; status: string; notes: string | null }[] | null>(null);
  const [tenantKycLoading, setTenantKycLoading] = useState(false);
  const [reviewingDocId, setReviewingDocId] = useState<number | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<number | null>(null);
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
  const dewaInputRef = useRef<HTMLInputElement>(null);
  const [dewaFile, setDewaFile] = useState<File | null>(null);
  const [dewaUploading, setDewaUploading] = useState(false);
  const [dewaError, setDewaError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    Promise.all([
      fetch(`/api/contracts/${params.id}`, { credentials: 'include' }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      }),
      fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include' }).then(r =>
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
        // Restore cheque consent from localStorage
        const stored = typeof window !== 'undefined' ? localStorage.getItem(`rent_cheques_consented_${data.id}`) : null;
        if (stored === '1') setRentChequesConsented(true);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [params?.id]);

  // Load tenant KYC docs when the Documents drawer opens
  useEffect(() => {
    if (activeDrawer !== 'documents') return;
    if (tenantKycDocs !== null) return; // already loaded
    const tenantId = contract?.tenant?.id;
    if (!tenantId) return;
    setTenantKycLoading(true);
    fetch(`/api/documents?ownerType=customer&ownerId=${tenantId}`, { credentials: 'include' })
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
    } catch (e: unknown) {
      setEjariError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setEjariUploading(false);
    }
  }

  async function uploadDewaDoc(file: File) {
    if (!contract) return;
    setDewaUploading(true);
    setDewaError(null);
    const docKey = `dewa_${Date.now()}`;
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
        body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contract.id, category: 'property', documentKey: docKey, displayName: 'DEWA Proof', fileUrl, mimeType: file.type || 'application/octet-stream', isVisibleToTenant: true }),
      });
      if (!docRes.ok) throw new Error('Failed to record document');
      const newDoc: ContractDoc = await docRes.json();
      setDocs(prev => [...prev, newDoc]);
      setDewaFile(null);
      if (dewaInputRef.current) dewaInputRef.current.value = '';
    } catch (e: unknown) {
      setDewaError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setDewaUploading(false);
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

  const totalAtSigning = contract.adminFeeFils + contract.ejariFeeFils;
  const isRenewalContract = contract.contractType === 'renewal';

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

  const rentChequePayments = payments.filter(p =>
    p.paymentType !== 'admin_fee' &&
    p.paymentType !== 'security_deposit' &&
    !p.description?.toLowerCase().includes('ejari')
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
  const dewaDoc         = docs.find(d => d.documentKey?.startsWith('dewa'));

  // Step state helpers
  const st1Done = tl_isIssued_or_active;
  const st2Done = isRenewalContract ? true : (allChequesComplete && rentChequesConsented);  // renewal skips payment step
  const st3Done = allSigsDone;
  const st4Done = tl_hasEjari;
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
            <Link href="/rental-provider/dashboard" className="text-[#6b6860] hover:text-[#1a1916]">
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
              href={`/rental-provider/dashboard/contracts/${contract.id}/print?download=1`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Download size={14} /> Download PDF
            </Link>
            {signedMode ? (
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
                <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Cheques</p>
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
                    <Row label="Start Date" value={fmtDate(contract.startDate)} />
                    <Row label="End Date" value={fmtDate(contract.endDate)} />
                    <Row label="Duration" value={contract.durationYears ? `${contract.durationYears} year(s)` : null} />
                    <Row label="Contract Type" value={contract.contractType} />
                    <Row label="Status" value={<StatusBadge status={contract.status} />} />
                    <Row label="Ejari Status" value={contract.ejariStatus} />
                  </SectionCard>
                  </div>
                  <div className={activeDrawer !== 'payments' ? 'hidden' : 'p-5 space-y-4'}>

                  {/* Security Deposit */}
                  <SectionCard title="Security Deposit" icon={DollarSign}>
                    {depositPayment ? (
                      <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-xs min-w-[400px]">
                          <thead>
                            <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                              <th className="px-2 py-2 font-medium">Amount</th>
                              <th className="px-2 py-2 font-medium">Cheque No.</th>
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
                        <p className="text-xs text-[#9b9890]">Amount: <strong className="text-[#1a1916]">{fmtAed(contract.securityDepositAmount ?? 0)}</strong> — enter the cheque details to record receipt.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Cheque No.</label>
                            <input type="text" value={depChequeNo} onChange={e => setDepChequeNo(e.target.value)}
                              placeholder="e.g. 001234"
                              className="w-full font-mono text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
                          </div>
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Cheque Date</label>
                            <input type="date" value={depDate} onChange={e => setDepDate(e.target.value)}
                              className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none text-[#6b6860]" />
                          </div>
                        </div>
                        {feeError && <p className="text-xs text-red-600">{feeError}</p>}
                        <button onClick={addDepositCheque} disabled={recordingDeposit}
                          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#1a7a63] disabled:opacity-50 transition-colors">
                          {recordingDeposit ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          Record Deposit Cheque
                        </button>
                      </div>
                    )}
                  </SectionCard>

                  {/* Rental Instalments */}
                  <SectionCard
                    title={`Rental Instalments (${rentChequePayments.length} / ${expectedCheques})`}
                    icon={CreditCard}
                  >
              {rentChequePayments.length === 0 && !showAddInstalment && (
                <p className="text-xs text-[#9b9890] text-center py-4">No instalments recorded yet.</p>
              )}

              {rentChequePayments.length > 0 && (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full text-xs min-w-[600px]">
                    <thead>
                      <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">Description</th>
                        <th className="px-2 py-2 font-medium">Amount</th>
                        <th className="px-2 py-2 font-medium">Cheque No.</th>
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
                      <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1">Cheque No.</label>
                      <input type="text" value={newInstalment.chequeNumber} onChange={e => setNewInstalment(v => ({ ...v, chequeNumber: e.target.value }))}
                        placeholder="optional" className="w-full font-mono text-xs px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:border-[#2e9f82] focus:outline-none" />
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
                                title={doc.isVisibleToTenant ? 'Click to make Internal' : 'Click to make visible to Tenant'}
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
                                {doc.isVisibleToTenant ? <><Eye size={10} /> Tenant</> : <>🔒 Internal</>}
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
                              <span className="text-[#4a4844]">👁 Visible to tenant</span>
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

                  {/* ── Tenant Rental Documents ── */}
                  <SectionCard title="Rental Documents" icon={User}>
                    {tenantKycLoading ? (
                      <p className="flex items-center gap-1.5 text-xs text-[#9b9890]"><Loader2 size={11} className="animate-spin" /> Loading…</p>
                    ) : (
                      <div className="space-y-4">
                        {/* Uploaded docs */}
                        {(!tenantKycDocs || tenantKycDocs.filter(d => d.status !== 'pending').length === 0) ? (
                          <p className="text-xs text-[#9b9890] text-center py-2">No documents uploaded by tenant yet.</p>
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
                                      <p className="text-[10px] font-semibold text-[#b91c1c] pt-2">Reason for rejection (shown to tenant)</p>
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
                            <p className="text-[10px] text-[#9b9890] uppercase font-semibold tracking-wide mb-1.5">Awaiting tenant upload</p>
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
                            placeholder="Instructions for tenant (optional)"
                            className="w-full text-xs px-3 py-2 border border-[#e8e6e0] rounded-xl bg-[#f9f8f6] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]"
                          />
                          <button
                            disabled={!docRequestInput.trim() || docRequesting}
                            onClick={handleRequestDoc}
                            className="w-full py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                            style={{ background: '#2e9f82' }}
                          >
                            {docRequesting ? <Loader2 size={12} className="animate-spin" /> : null}
                            Send Request to Tenant
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
                    Contract sent to tenant — clauses are locked.
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
                      {contract.contractValue != null && (
                        <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                          <span className="text-xs text-[#9b9890]">Contract Value</span>
                          <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.contractValue)}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                        <span className="text-xs text-[#9b9890]">Security Deposit</span>
                        <span className="text-xs font-semibold text-[#1a1916]">{isRenewalContract ? 'Extended from prior' : contract.securityDepositAmount != null ? `${fmtAed(contract.securityDepositAmount)} (PDC)` : '—'}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                        <span className="text-xs text-[#9b9890]">Admin Fee</span>
                        <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.adminFeeFils)}</span>
                      </div>
                      <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                        <span className="text-xs text-[#9b9890]">Ejari Fee</span>
                        <span className="text-xs font-semibold text-[#1a1916]">{fmtAed(contract.ejariFeeFils)}</span>
                      </div>
                      {contract.numberOfInstallments != null && (
                        <div className="flex justify-between items-center py-2.5 border-b border-[#f4f3ef]">
                          <span className="text-xs text-[#9b9890]">No. of Cheques</span>
                          <span className="text-xs font-semibold text-[#1a1916]">{contract.numberOfInstallments}</span>
                        </div>
                      )}
                      <div className="flex justify-between items-center pt-3 pb-1">
                        <span className="text-xs font-bold text-[#6b6860]">Due at Signing <span className="font-normal text-[#9b9890] text-[10px]">(excl. PDC)</span></span>
                        <span className="text-base font-bold" style={{ color: '#2e9f82' }}>{fmtAed(totalAtSigning)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/rental-provider/dashboard/contracts/${contract.id}/print`} target="_blank" className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white">
                      <Eye size={14} /> Preview
                    </Link>
                    <Link href={`/rental-provider/dashboard/contracts/${contract.id}/print?download=1`} target="_blank" className="flex items-center justify-center gap-1.5 py-2.5 rounded-2xl text-sm font-semibold border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white">
                      <Download size={14} /> Download PDF
                    </Link>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── grid: nav (3) + timeline (9) ── */}
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
                          <p className="text-[10px] text-[#9b9890] mb-2">Review the contract in the left panel, then issue it to the tenant to begin the signing process.</p>
                          <button
                            onClick={doIssueContract}
                            disabled={markingStep === 'issue'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'issue' ? <Loader2 size={10} className="animate-spin" /> : <FileSignature size={10} />}
                            Issue Contract to Tenant
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Issued to tenant ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 2: Payment Collection */}
                    {(()=>{ const state: TLStep = stepState(st1Done, st2Done); return (
                    <StepRow num={2} label="Payment Collection" state={state} last={false}>
                      <p className="text-[10px] text-[#9b9890] mt-0.5">All cheques collected as PDC · Deposit + {expectedCheques} instalments</p>
                      {state === 'current' && (
                        <div className="mt-2 space-y-1.5">
                          {feeError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                              <AlertCircle size={11} />{feeError}
                            </div>
                          )}

                          {/* Security Deposit row */}
                          <div className="flex items-center justify-between rounded-lg border border-[#e8e6e0] px-2.5 py-2">
                            <div>
                              <p className="text-[10px] font-semibold text-[#1a1916]">Security Deposit</p>
                              <p className="text-[9px] text-[#9b9890]">{fmtAed(contract.securityDepositAmount ?? 0)}</p>
                            </div>
                            {depositPayment ? (
                              <span className="text-[9px] font-semibold text-[#2e9f82] flex items-center gap-0.5"><CheckCircle size={9} /> Received</span>
                            ) : (
                              <span className="text-[9px] text-[#9b9890] italic">Pending</span>
                            )}
                          </div>

                          {/* Rental Instalments row */}
                          <div className="flex items-center justify-between rounded-lg border border-[#e8e6e0] px-2.5 py-2">
                            <div>
                              <p className="text-[10px] font-semibold text-[#1a1916]">Rental Instalments</p>
                              <p className="text-[9px] text-[#9b9890]">{expectedCheques} cheques (PDC)</p>
                            </div>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                              allChequesRecorded ? 'bg-[#d8f2e8] text-[#1a7a5a]' : 'bg-[#fef9c3] text-[#854d0e]'
                            }`}>
                              {rentChequePayments.length} / {expectedCheques}
                            </span>
                          </div>

                          {/* Open payments drawer */}
                          {!allChequesComplete && (
                            <button
                              onClick={() => setActiveDrawer('payments')}
                              className="w-full text-[10px] font-semibold py-1.5 rounded-lg border border-[#e8e6e0] text-[#1a1916] hover:bg-white flex items-center justify-center gap-1.5">
                              <CreditCard size={10} /> Manage Cheques
                              <ChevronRight size={9} className="ml-auto opacity-50" />
                            </button>
                          )}

                          {/* Consent */}
                          <label className={`flex items-start gap-2 pt-0.5 cursor-pointer ${
                            !allChequesComplete ? 'opacity-40 pointer-events-none' : ''
                          }`}>
                            <input
                              type="checkbox"
                              checked={rentChequesConsented}
                              onChange={e => {
                                setRentChequesConsented(e.target.checked);
                                if (typeof window !== 'undefined') {
                                  e.target.checked
                                    ? localStorage.setItem(`rent_cheques_consented_${contract.id}`, '1')
                                    : localStorage.removeItem(`rent_cheques_consented_${contract.id}`);
                                }
                              }}
                              className="mt-0.5 rounded border-[#c0bdb8] text-[#2e9f82] focus:ring-[#2e9f82] shrink-0"
                            />
                            <span className="text-[9px] text-[#6b6860] leading-tight">
                              {!allChequesComplete
                                ? `Add all ${totalExpectedCheques} cheques to confirm receipt`
                                : <><strong className="text-[#1a1916]">All {totalExpectedCheques} cheques collected</strong> — tick to confirm and proceed to signatures</>}
                            </span>
                          </label>
                          {rentChequesConsented && (
                            <p className="text-[9px] text-[#2e9f82] font-semibold flex items-center gap-1">
                              <CheckCircle size={9} /> Confirmed — proceed to signatures
                            </p>
                          )}
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Signatures */}
                    {(()=>{ const state: TLStep = stepState(st2Done, st3Done); return (
                    <StepRow num={3} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          {/* Landlord */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                          {/* Tenant */}
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                            {!hasTenantSigned && <span className="text-[9px] text-[#9b9890] ml-1">(tenant signs via their portal)</span>}
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 4: Ejari Registration */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done);
                      const ejariDoc = docs.find(d => d.documentKey?.startsWith('ejari'));
                      return (
                    <StepRow num={4} label="Ejari Registration" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] text-[#9b9890]">Upload the Ejari certificate from DLD, then mark as registered.</p>

                          {/* Step A: Upload */}
                          {ejariDoc ? (
                            <div className="flex items-center gap-2 text-[10px] text-[#2e9f82] font-medium">
                              <CheckCircle size={11} /> Ejari doc uploaded
                              <span className="text-[#9b9890] font-normal truncate max-w-[120px]">{ejariDoc.displayName}</span>
                            </div>
                          ) : (
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
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white">
                                  <UploadCloud size={10} /> {ejariFile ? ejariFile.name : 'Choose file'}
                                </button>
                                {ejariFile && (
                                  <button
                                    onClick={() => uploadEjariDoc(ejariFile)}
                                    disabled={ejariUploading}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                    {ejariUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />} Upload
                                  </button>
                                )}
                              </div>
                              {ejariError && <p className="text-[9px] text-red-600">{ejariError}</p>}
                            </div>
                          )}

                          {/* Step B: Mark registered — only after doc uploaded */}
                          <button
                            onClick={markEjariRegistered}
                            disabled={!ejariDoc || markingStep === 'ejari'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'ejari' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Mark Ejari Registered
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Registered with DLD ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 5: Move-In & DEWA */}
                    {(()=>{ const state: TLStep = stepState(st4Done, st5Done); return (
                    <StepRow num={5} label="Move-In & DEWA" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          {feeError && (
                            <div className="flex items-center gap-1.5 text-[10px] text-red-600 bg-red-50 rounded-lg px-2.5 py-1.5 border border-red-200">
                              <AlertCircle size={11} />{feeError}
                            </div>
                          )}
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={moveInConfirmed} onChange={e => setMoveInConfirmed(e.target.checked)}
                              className="rounded border-[#c8c6be] text-[#2e9f82] focus:ring-[#2e9f82]" />
                            <span className="text-[10px] text-[#6b6860]">Move-in inspection done & keys handed over</span>
                          </label>
                          {/* DEWA proof upload */}
                          <input ref={dewaInputRef} type="file" accept="image/*,application/pdf" className="hidden"
                            onChange={e => setDewaFile(e.target.files?.[0] ?? null)} />
                          <div className="space-y-1">
                            <p className="text-[10px] text-[#6b6860] font-medium">DEWA account activation verified</p>
                            {dewaDoc ? (
                              <div className="flex items-center gap-1.5 text-[10px] text-[#2e9f82]">
                                <CheckCircle size={10} />
                                <span className="font-medium">Proof uploaded</span>
                                <span className="text-[#9b9890] font-normal truncate max-w-[140px]">{dewaDoc.displayName}</span>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => dewaInputRef.current?.click()}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white">
                                    <UploadCloud size={10} /> {dewaFile ? dewaFile.name : 'Upload proof'}
                                  </button>
                                  {dewaFile && (
                                    <button onClick={() => uploadDewaDoc(dewaFile)} disabled={dewaUploading}
                                      className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                      {dewaUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />} Upload
                                    </button>
                                  )}
                                </div>
                                {dewaError && <p className="text-[9px] text-red-600">{dewaError}</p>}
                              </div>
                            )}
                          </div>
                          <button onClick={doActivateContract}
                            disabled={!moveInConfirmed || !dewaDoc || markingStep === 'activate'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1 mt-1">
                            {markingStep === 'activate' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Activate Contract
                          </button>
                        </div>
                      )}
                      {state === 'done' && (
                        <p className="text-[10px] text-[#2e9f82] mt-0.5">Unit handed over · DEWA active ✓</p>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 6: Active Tenancy */}
                    {(()=>{ const state: TLStep = tl_isActive ? 'current' : 'upcoming'; return (
                    <StepRow num={6} label="Active Tenancy" state={state} last={true}>
                      {tl_isActive && (
                        <div className="mt-1">
                          <p className="text-[10px] text-[#2e9f82] font-medium">Contract is live</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Ends {fmtDate(contract.endDate)} · {contract.numberOfInstallments ?? '—'} cheques</p>
                          <p className="text-[10px] text-[#9b9890] mt-0.5">Renewal / termination will appear here when initiated.</p>
                        </div>
                      )}
                    </StepRow>
                    );})()}
                  </>
                ) : (
                  /* ── RENEWAL CONTRACT: 4 steps ── */
                  <>
                    {/* Step 1: Terms Agreed */}
                    {(()=>{ const state: TLStep = 'done'; return (
                    <StepRow num={1} label="Renewal Terms Agreed" state={state} last={false}>
                      <p className="text-[10px] text-[#2e9f82] mt-0.5">New rent & duration confirmed ✓</p>
                    </StepRow>
                    );})()}

                    {/* Step 2: Signatures */}
                    {(()=>{ const state: TLStep = stepState(true, st3Done); return (
                    <StepRow num={2} label="Signatures" state={state} last={false}>
                      {state !== 'upcoming' && (
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${tl_isSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{tl_isSigned ? '✓' : '○'}</span>
                              <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                            </div>
                            {!tl_isSigned && state === 'current' && (
                              <button onClick={() => setShowSignModal(true)}
                                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                                Sign Now
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'}`}>{hasTenantSigned ? '✓' : '○'}</span>
                            <span className="text-[10px] text-[#6b6860]">Tenant signed</span>
                          </div>
                        </div>
                      )}
                    </StepRow>
                    );})()}

                    {/* Step 3: Ejari Renewal */}
                    {(()=>{ const state: TLStep = stepState(st3Done, st4Done);
                      const ejariDoc = docs.find(d => d.documentKey?.startsWith('ejari'));
                      return (
                    <StepRow num={3} label="Ejari Renewal" state={state} last={false}>
                      {state === 'current' && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] text-[#9b9890]">Upload the renewed Ejari certificate, then mark as renewed.</p>
                          {ejariDoc ? (
                            <div className="flex items-center gap-2 text-[10px] text-[#2e9f82] font-medium">
                              <CheckCircle size={11} /> Ejari doc uploaded
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <input ref={ejariInputRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={e => setEjariFile(e.target.files?.[0] ?? null)} />
                              <div className="flex items-center gap-2">
                                <button onClick={() => ejariInputRef.current?.click()}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md border border-[#e8e6e0] text-[#6b6860] hover:bg-white">
                                  <UploadCloud size={10} /> {ejariFile ? ejariFile.name : 'Choose file'}
                                </button>
                                {ejariFile && (
                                  <button onClick={() => uploadEjariDoc(ejariFile)} disabled={ejariUploading}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50">
                                    {ejariUploading ? <Loader2 size={9} className="animate-spin" /> : <UploadCloud size={9} />} Upload
                                  </button>
                                )}
                              </div>
                              {ejariError && <p className="text-[9px] text-red-600">{ejariError}</p>}
                            </div>
                          )}
                          <button onClick={markEjariRegistered} disabled={!ejariDoc || markingStep === 'ejari'}
                            className="w-full text-[10px] font-semibold py-1.5 rounded-md bg-[#2e9f82] text-white hover:bg-[#27896f] disabled:opacity-50 flex items-center justify-center gap-1">
                            {markingStep === 'ejari' ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            Mark Ejari Renewed
                          </button>
                        </div>
                      )}
                      {state === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Ejari renewed with DLD ✓</p>}
                    </StepRow>
                    );})()}

                    {/* Step 4: Active Renewal */}
                    {(()=>{ const state: TLStep = stepState(st4Done, st5Done); return (
                    <StepRow num={4} label="Active Renewal" state={state} last={true}>
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
                            disabled={!moveInConfirmed || !dewaDoc || markingStep === 'activate'}
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

        </div>{/* end grid */}
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
    </div>
  );
}
