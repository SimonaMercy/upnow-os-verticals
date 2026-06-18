/**
 * Customer — Contract Detail page (dashboard/customer/contracts/[id])
 *
 * Read-only view of a single tenancy contract for the tenant.
 * Tabs: Parties · Property · Period · Payments · Clauses
 *
 * IMPORTANT: There is NO documents tab here. Document management lives
 * exclusively in the My Spaces page (RentalDocumentsCard). Do not add
 * upload UI to this page — see AGENTS.md §9a and CID-326-FE.
 *
 * The tenant e-sign canvas (GAP-G6) has no typed-name fallback — this is
 * a known open bug blocking automated testing.
 */
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, FileText, CheckCircle, Loader2, AlertCircle, X,
  User, Building2, Calendar, DollarSign, RotateCcw, FileSignature,
  BadgeCheck, Eye, Download, CreditCard, ClipboardList,
  ChevronRight,
} from 'lucide-react';
import { AddendumsPanel } from '@/components/upnow/AddendumsPanel';
import { openDocViewer } from '@/lib/docViewer';
import { allowedInstallmentPlans } from '@/lib/installmentPlans';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ContractDoc {
  id: number;
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

interface Signature {
  id: number;
  role: string;
  signatoryName: string;
  method: string;
  signedAt: string;
  signatureImage?: string | null;
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
  startDate: string;
  endDate: string;
  durationYears: number | null;
  annualRent: number;
  contractValue: number | null;
  listedRent: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountAmount: number | null;
  securityDepositAmount: number | null;
  numberOfInstallments: number | null;
  // Installment plans the landlord offers (Settings → Rules). Empty = all allowed.
  allowedInstallments?: number[] | null;
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtAed(fils: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(fils);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_COLOR: Record<string, string> = {
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  issued:     'bg-blue-50 text-blue-700 border-blue-200',
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  expired:    'bg-[#f4f3ef] text-[#6b6860] border-[#e8e6e0]',
  terminated: 'bg-red-50 text-red-700 border-red-200',
};
const STATUS_LABEL: Record<string, string> = {
  pending:    'Pending Review',
  issued:     'Awaiting Your Signature',
  active:     'Active',
  expired:    'Expired',
  terminated: 'Terminated',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? STATUS_COLOR.pending;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── Row helper ─────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start py-2.5 border-b border-[#f4f3ef] last:border-0">
      <span className="text-xs text-[#9b9890] shrink-0 w-36">{label}</span>
      <span className="text-xs font-semibold text-[#1a1916] text-right">{value ?? '—'}</span>
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-[#f0ede8]">
        <Icon size={15} className="text-[#2e9f82]" />
        <span className="text-sm font-semibold text-[#1a1916]">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ─── Vertical timeline step ─────────────────────────────────────────────────

type TLState = 'done' | 'current' | 'upcoming';

function StepRow({ num, label, state, last, children }: {
  num: number; label: string; state: TLState; last: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-[11px] font-bold shrink-0 ${
          state === 'done'    ? 'bg-[#2e9f82] border-[#2e9f82] text-white' :
          state === 'current' ? 'bg-white border-[#2e9f82] text-[#2e9f82]' :
                                'bg-white border-[#e8e6e0] text-[#c0bdb8]'
        }`}>{state === 'done' ? '✓' : num}</div>
        {!last && <div className={`w-0.5 flex-1 min-h-[20px] mt-1 mb-1 ${state === 'done' ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? 'pb-2' : 'pb-5'}`}>
        <p className={`text-sm font-semibold leading-tight ${
          state === 'done'    ? 'text-[#2e9f82]' :
          state === 'current' ? 'text-[#1a1916]' : 'text-[#c0bdb8]'
        }`}>{label}</p>
        {children}
      </div>
    </div>
  );
}

// ─── Signature Pad ──────────────────────────────────────────────────────────

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
      const t = e.touches[0];
      return { x: (t.clientX - rect.left) * scaleX, y: (t.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
    setIsDrawing(true);
  }, [getPos]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
  }, [isDrawing, getPos]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false); setHasDrawn(true);
    const canvas = canvasRef.current;
    if (canvas) onSignatureChange(canvas.toDataURL('image/png'));
  }, [isDrawing, onSignatureChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); setHasDrawn(false); onSignatureChange(null); }
  }, [onSignatureChange]);

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-[#e8e6e0] rounded-xl bg-white overflow-hidden">
        <canvas ref={canvasRef} width={560} height={140}
          className="w-full cursor-crosshair touch-none" style={{ height: '140px' }}
          onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
          onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
        />
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[#c0bdb8] text-sm">Draw your signature here</span>
          </div>
        )}
      </div>
      {hasDrawn && (
        <button onClick={clear} type="button" className="flex items-center gap-1.5 text-xs text-[#9b9890] hover:text-[#1a1916] transition">
          <RotateCcw size={12} /> Clear signature
        </button>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function TenantContractDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [sigs, setSigs] = useState<Signature[]>([]);
  const [docs, setDocs] = useState<ContractDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);

  // Sign modal
  const [showSignModal, setShowSignModal] = useState(false);
  const [signatoryName, setSignatoryName] = useState('');
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signSuccess, setSignSuccess] = useState(false);

  // Payment preferences (editable while pending)
  const [prefInstallments, setPrefInstallments] = useState<number | ''>('');
  const [prefPaymentMethod, setPrefPaymentMethod] = useState('');
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefSaved, setPrefSaved] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);



  useEffect(() => {
    if (!params?.id) return;
    // AbortController guards against StrictMode's double-mount (and fast
    // navigation) firing two concurrent loads — the first is aborted on cleanup.
    const ctrl = new AbortController();
    Promise.all([
      fetch(`/api/contracts/tenant/${params.id}`, { credentials: 'include', signal: ctrl.signal }).then(r => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json() as Promise<ContractDetail>;
      }),
      fetch(`/api/contracts/${params.id}/signatures`, { credentials: 'include', signal: ctrl.signal }).then(r =>
        r.ok ? r.json() as Promise<Signature[]> : [] as Signature[]
      ),
    ])
      .then(([data, sigData]) => {
        setContract(data);
        setSigs(Array.isArray(sigData) ? sigData : []);
        setDocs(data.documents ?? []);
        setPrefInstallments(data.numberOfInstallments ?? '');
        setPrefPaymentMethod(data.modeOfPayment ?? '');
      })
      .catch(e => { if (e?.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [params?.id]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const tenantSig   = sigs.find(s => s.role === 'tenant');
  const landlordSig = sigs.find(s => s.role === 'landlord');
  const hasTenantSigned   = !!tenantSig;
  const hasLandlordSigned = !!landlordSig;
  const allSigned         = hasTenantSigned && hasLandlordSigned;

  const isPending = contract?.status === 'pending';
  const isIssued  = contract?.status === 'issued';
  const isActive  = contract?.status === 'active';
  const hasEjari  = contract?.ejariStatus === 'registered';
  const canSign   = isIssued && !hasTenantSigned && (contract?.pdcConfirmed ?? false);

  const rentPayments = (contract?.payments ?? []).filter(p =>
    p.paymentType !== 'admin_fee' && p.paymentType !== 'security_deposit' &&
    !p.description?.toLowerCase().includes('ejari')
  );
  const depositPayment = (contract?.payments ?? []).find(p => p.paymentType === 'security_deposit');

  // ── Timeline step states (mirrors RP 6-step journey) ────────────────────
  function ss(prevDone: boolean, thisDone: boolean): TLState {
    if (!prevDone) return 'upcoming';
    return thisDone ? 'done' : 'current';
  }
  const st1Done = !isPending;                           // Contract Issued
  const st2Done = contract?.pdcConfirmed ?? false;      // Payment Collection confirmed by RP
  const st3Done = allSigned;                            // Signatures
  const st4Done = hasEjari;                             // Ejari
  const st5Done = isActive;                             // Move-In & Utility
  const expectedCheques = contract?.numberOfInstallments ?? 0;
  const rentChequePayments = rentPayments.filter(p => p.chequeStatus === 'received');
  const allChequesReceived = rentChequePayments.length >= expectedCheques && expectedCheques > 0;

  // ── Actions ───────────────────────────────────────────────────────────────

  async function submitSignature() {
    if (!contract) return;
    if (!signatoryName.trim()) { setSignError('Please enter your full legal name.'); return; }
    if (!signatureImage)       { setSignError('Please draw your signature.'); return; }
    setSigning(true); setSignError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contract.id}/sign`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatoryName: signatoryName.trim(), signatureImage }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      const [updated, newSigs] = await Promise.all([
        fetch(`/api/contracts/tenant/${contract.id}`, { credentials: 'include' }).then(r => r.json() as Promise<ContractDetail>),
        fetch(`/api/contracts/${contract.id}/signatures`, { credentials: 'include' }).then(r => r.ok ? r.json() as Promise<Signature[]> : [] as Signature[]),
      ]);
      setContract(updated);
      setSigs(Array.isArray(newSigs) ? newSigs : []);
      setSignSuccess(true);
      setShowSignModal(false);
    } catch (e: unknown) {
      setSignError(e instanceof Error ? e.message : 'Failed to save signature');
    } finally {
      setSigning(false);
    }
  }

  async function savePreferences() {
    if (!contract) return;
    setSavingPrefs(true); setPrefError(null); setPrefSaved(false);
    try {
      const body: Record<string, unknown> = {};
      if (prefInstallments !== '') body.numberOfInstallments = Number(prefInstallments);
      if (prefPaymentMethod)        body.modeOfPayment = prefPaymentMethod;
      const res = await fetch(`/api/contracts/tenant/${contract.id}/preferences`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { message?: string };
        throw new Error(err.message ?? `Error ${res.status}`);
      }
      const updated = await fetch(`/api/contracts/tenant/${contract.id}`, { credentials: 'include' }).then(r => r.json() as Promise<ContractDetail>);
      setContract(updated);
      setPrefSaved(true);
      setTimeout(() => setPrefSaved(false), 3000);
    } catch (e: unknown) {
      setPrefError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingPrefs(false);
    }
  }

  // ── Loading / Error ───────────────────────────────────────────────────────

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
          <p className="text-xs text-[#9b9890]">{error ?? 'Error 404'}</p>
          <button onClick={() => router.back()} className="text-xs text-[#2e9f82] hover:underline">← Go back</button>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f7f6f2]">

      {/* ── Sticky top bar ── */}
      <div className="bg-white border-b border-[#e8e6e0] px-4 sm:px-6 py-4 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard/customer/contracts" className="text-[#6b6860] hover:text-[#1a1916]">
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
              href={`/dashboard/customer/contracts/${contract.id}/print`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Eye size={14} /> Preview
            </Link>
            <Link
              href={`/dashboard/customer/contracts/${contract.id}/print`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] transition-colors bg-white"
            >
              <Download size={14} /> Download
            </Link>
            {canSign && (
              <button
                onClick={() => setShowSignModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: '#2e9f82' }}
              >
                <FileSignature size={14} /> Sign Contract
              </button>
            )}
            {hasTenantSigned && (
              <span className="flex items-center gap-1.5 text-xs text-[#2e9f82] font-semibold bg-[#f0faf6] px-3 py-1.5 rounded-full border border-[#c5e8df]">
                <BadgeCheck size={13} /> Signed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Addendums — tenant can review + sign each. RP attaches/removes on their side. */}
        <AddendumsPanel contractId={contract.id} role="tenant" contractStatus={contract.status} />

        {/* Action required banner */}
        {canSign && (
          <div className="flex items-start gap-3 bg-[#fff7ed] border border-[#fed7aa] rounded-2xl px-5 py-4">
            <AlertCircle size={18} className="text-[#c2410c] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-[#9a3412]">Action required — Your signature is needed</p>
              <p className="text-xs text-[#c2410c] mt-0.5">Your landlord has issued this contract. Review the details and sign to proceed with your tenancy.</p>
            </div>
            <button
              onClick={() => setShowSignModal(true)}
              className="shrink-0 px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: '#c2410c' }}
            >
              Sign Now
            </button>
          </div>
        )}

        {/* Awaiting PDC confirmation banner */}
        {isIssued && !contract.pdcConfirmed && !hasTenantSigned && (
          <div className="flex items-start gap-3 bg-[#fdf3e3] border border-[#f3d08a] rounded-2xl px-5 py-4">
            <AlertCircle size={18} className="text-[#a85b15] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#7c3d0e]">Awaiting payment collection confirmation</p>
              <p className="text-xs text-[#a85b15] mt-0.5">Your landlord needs to confirm receipt of all PDC cheques and security deposit before you can review and sign this contract. You will be notified once confirmed.</p>
            </div>
          </div>
        )}

        {/* Signed success banner */}
        {signSuccess && (
          <div className="flex items-center gap-3 bg-[#f0faf6] border border-[#c5e8df] rounded-2xl px-5 py-4">
            <CheckCircle size={18} className="text-[#2e9f82]" />
            <p className="text-sm font-semibold text-[#1a7a5a]">Contract signed successfully. Your landlord has been notified.</p>
          </div>
        )}

        {/* Quick-glance strip */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm px-5 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Landlord</p>
            <p className="text-sm font-semibold text-[#1a1916]">{contract.landlord.companyName ?? contract.landlord.name ?? '—'}</p>
          </div>
          <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Property</p>
            <p className="text-sm font-semibold text-[#1a1916]">{contract.unit.number ? `Unit ${contract.unit.number} · ` : ''}{contract.property.buildingName ?? '—'}</p>
          </div>
          <div className="w-px h-8 bg-[#e8e6e0] hidden sm:block" />
          <div>
            <p className="text-[9px] text-[#9b9890] uppercase font-semibold tracking-wide mb-0.5">Annual Rent</p>
            <p className="text-sm font-bold" style={{ color: '#2e9f82' }}>
              {(contract.discountAmount ?? 0) > 0 && contract.listedRent != null && (
                <span className="text-xs font-normal text-[#9b9890] line-through mr-1.5">{fmtAed(contract.listedRent)}</span>
              )}
              {fmtAed(contract.annualRent)}
            </p>
            {(contract.discountAmount ?? 0) > 0 && (
              <p className="text-[9px] font-semibold mt-0.5" style={{ color: '#b91c1c' }}>− {fmtAed(contract.discountAmount!)} discount</p>
            )}
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

        {/* ── Drawer ── */}
        {activeDrawer && (
          <>
            <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
              <div className="absolute inset-0 bg-black/30" onClick={() => setActiveDrawer(null)} />
              <div
                className="absolute right-0 inset-y-0 w-full max-w-2xl bg-white shadow-2xl flex flex-col overflow-hidden"
                style={{ animation: 'slideIn 0.22s ease-out' }}
              >
                {/* Drawer header */}
                <div className="px-5 py-4 border-b border-[#f0ede8] flex items-center justify-between shrink-0">
                  <span className="text-sm font-bold text-[#1a1916]">Contract Details</span>
                  <button onClick={() => setActiveDrawer(null)} className="text-[#9b9890] hover:text-[#1a1916] p-1.5 rounded-lg hover:bg-[#f4f3ef] transition-colors">
                    <X size={16} />
                  </button>
                </div>
                {/* Tab bar */}
                <div className="flex overflow-x-auto border-b border-[#f0ede8] px-2 shrink-0 bg-[#fafaf8]">
                  {([
                    { key: 'parties',   icon: User,          label: 'Parties'   },
                    { key: 'property',  icon: Building2,     label: 'Property'  },
                    { key: 'period',    icon: Calendar,      label: 'Period'    },
                    { key: 'payments',  icon: CreditCard,    label: 'Payments'  },
                    { key: 'documents', icon: FileText,      label: 'Documents' },
                    { key: 'clauses',   icon: ClipboardList, label: 'Clauses'   },
                  ] as const).map(({ key, icon: Icon, label }) => (
                    <button key={key} onClick={() => setActiveDrawer(key)}
                      className={`flex items-center gap-1.5 px-3 py-3 text-[11px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                        activeDrawer === key ? 'border-[#2e9f82] text-[#2e9f82]' : 'border-transparent text-[#9b9890] hover:text-[#1a1916]'
                      }`}
                    >
                      <Icon size={11} className="shrink-0" />{label}
                    </button>
                  ))}
                </div>

                {/* Drawer body */}
                <div className="flex-1 overflow-y-auto">

                  {/* Parties */}
                  <div className={activeDrawer !== 'parties' ? 'hidden' : 'p-5 space-y-4'}>
                    <SectionCard title="Parties" icon={User}>
                      <div className="grid sm:grid-cols-2 gap-6">
                        <div>
                          <p className="text-[11px] font-bold text-[#2e9f82] uppercase tracking-wide mb-2">Landlord / Lessor</p>
                          <Row label="Name"  value={contract.landlord.companyName ?? contract.landlord.name} />
                          <Row label="Email" value={contract.landlord.email} />
                          <Row label="Phone" value={contract.landlord.phone} />
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-[#6b6860] uppercase tracking-wide mb-2">Tenant / Lessee</p>
                          <Row label="Name"  value={contract.tenant.name} />
                          <Row label="Email" value={contract.tenant.email} />
                          <Row label="Phone" value={contract.tenant.phone} />
                        </div>
                      </div>
                    </SectionCard>
                  </div>

                  {/* Property */}
                  <div className={activeDrawer !== 'property' ? 'hidden' : 'p-5 space-y-4'}>
                    <SectionCard title="Property & Unit" icon={Building2}>
                      <Row label="Building"  value={contract.property.buildingName} />
                      <Row label="Community" value={contract.property.community} />
                      <Row label="Emirate"   value={contract.property.emirate} />
                      <Row label="Address"   value={contract.property.fullAddress} />
                      <Row label="Unit No."  value={contract.unit.number ? `Unit ${contract.unit.number}` : null} />
                      <Row label="Type"      value={contract.unit.type} />
                      <Row label="Floor"     value={contract.unit.floor} />
                      <Row label="Bedrooms"  value={contract.unit.bedrooms} />
                      <Row label="Bathrooms" value={contract.unit.bathrooms} />
                    </SectionCard>
                  </div>

                  {/* Period */}
                  <div className={activeDrawer !== 'period' ? 'hidden' : 'p-5 space-y-4'}>
                    <SectionCard title="Rental Period" icon={Calendar}>
                      <Row label="Start Date"   value={fmtDate(contract.startDate)} />
                      <Row label="End Date"     value={fmtDate(contract.endDate)} />
                      <Row label="Duration"     value={contract.durationYears ? `${contract.durationYears} year(s)` : null} />
                      <Row label="Type"         value={contract.contractType} />
                      <Row label="Status"       value={<StatusBadge status={contract.status} />} />
                      <Row label="Ejari Status" value={contract.ejariStatus} />
                    </SectionCard>
                  </div>

                  {/* Payments */}
                  <div className={activeDrawer !== 'payments' ? 'hidden' : 'p-5 space-y-4'}>

                    {/* Preferences — only while pending */}
                    {isPending && (
                      <SectionCard title="Your Payment Preferences" icon={DollarSign}>
                        <p className="text-xs text-[#9b9890] mb-4">
                          Let your landlord know how you would like to pay. They will finalise the schedule when issuing the contract.
                        </p>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1.5">Number of Cheques</label>
                            <select
                              value={prefInstallments}
                              onChange={e => setPrefInstallments(e.target.value === '' ? '' : Number(e.target.value))}
                              className="w-full text-xs px-3 py-2.5 border border-[#e8e6e0] rounded-xl bg-white focus:border-[#2e9f82] focus:outline-none"
                            >
                              <option value="">— select —</option>
                              {allowedInstallmentPlans(contract.allowedInstallments, prefInstallments === '' ? [] : [Number(prefInstallments)]).map(p => (
                                <option key={p.value} value={p.value}>{p.value} cheque{p.value > 1 ? 's' : ''}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-[#9b9890] uppercase font-medium block mb-1.5">Payment Method</label>
                            <select
                              value={prefPaymentMethod}
                              onChange={e => setPrefPaymentMethod(e.target.value)}
                              className="w-full text-xs px-3 py-2.5 border border-[#e8e6e0] rounded-xl bg-white focus:border-[#2e9f82] focus:outline-none"
                            >
                              <option value="">— select —</option>
                              <option value="cheque">Cheque (PDC)</option>
                              <option value="bank_transfer">Bank Transfer</option>
                              <option value="cash">Cash</option>
                              <option value="online">Online Payment</option>
                            </select>
                          </div>
                        </div>
                        {prefError  && <p className="text-xs text-red-600 mt-2">{prefError}</p>}
                        {prefSaved  && <p className="text-xs text-[#2e9f82] mt-2 flex items-center gap-1"><CheckCircle size={12} /> Preferences saved</p>}
                        <button
                          onClick={savePreferences}
                          disabled={savingPrefs}
                          className="mt-4 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                          style={{ background: '#2e9f82' }}
                        >
                          {savingPrefs ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          {savingPrefs ? 'Saving…' : 'Save Preferences'}
                        </button>
                      </SectionCard>
                    )}

                    {/* Security Deposit (read-only) */}
                    <SectionCard title="Security Deposit" icon={DollarSign}>
                      {depositPayment ? (
                        <>
                          <Row label="Amount" value={fmtAed(depositPayment.amount)} />
                          <Row label="Method" value={depositPayment.paymentMethod} />
                          <Row label="Status" value={
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              depositPayment.chequeStatus === 'cleared' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                              depositPayment.chequeStatus === 'bounced' ? 'bg-red-50 text-red-700' :
                              'bg-amber-50 text-amber-700'
                            }`}>{depositPayment.chequeStatus}</span>
                          } />
                        </>
                      ) : (
                        <p className="text-xs text-[#9b9890]">
                          Amount: <strong className="text-[#1a1916]">{fmtAed(contract.securityDepositAmount ?? 0)}</strong>.
                          Your landlord will record receipt once the cheque is collected.
                        </p>
                      )}
                    </SectionCard>

                    {/* Rental Instalments (read-only) */}
                    <SectionCard
                      title={`Rental Instalments (${rentPayments.length} / ${contract.numberOfInstallments ?? '?'})`}
                      icon={CreditCard}
                    >
                      {rentPayments.length === 0 ? (
                        <p className="text-xs text-[#9b9890] text-center py-4">No instalments recorded yet.</p>
                      ) : (
                        <div className="overflow-x-auto -mx-1">
                          <table className="w-full text-xs min-w-[400px]">
                            <thead>
                              <tr className="text-left text-[10px] text-[#9b9890] uppercase border-b border-[#f4f3ef]">
                                <th className="px-2 py-2 font-medium">#</th>
                                <th className="px-2 py-2 font-medium">Description</th>
                                <th className="px-2 py-2 font-medium">Amount</th>
                                <th className="px-2 py-2 font-medium">Due Date</th>
                                <th className="px-2 py-2 font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rentPayments.map((p, i) => (
                                <tr key={p.id} className={`border-b border-[#f4f3ef] last:border-0 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafaf8]'}`}>
                                  <td className="px-2 py-2 text-[#9b9890]">{i + 1}</td>
                                  <td className="px-2 py-2 text-[#1a1916]">{p.description ?? `Instalment ${i + 1}`}</td>
                                  <td className="px-2 py-2 font-semibold text-[#1a1916]">{fmtAed(p.amount)}</td>
                                  <td className="px-2 py-2 text-[#6b6860]">{p.transactionDate ? fmtDate(p.transactionDate) : '—'}</td>
                                  <td className="px-2 py-2">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      p.chequeStatus === 'cleared'   ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
                                      p.chequeStatus === 'bounced'   ? 'bg-red-50 text-red-700' :
                                      p.chequeStatus === 'cancelled' ? 'bg-[#e5e7eb] text-[#374151]' :
                                      'bg-amber-50 text-amber-700'
                                    }`}>{p.chequeStatus}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t-2 border-[#c5e8df] bg-[#f0faf6]">
                                <td colSpan={2} className="px-2 py-2.5 text-xs font-bold text-[#1a1916]">Total</td>
                                <td className="px-2 py-2.5 text-sm font-bold" style={{ color: '#2e9f82' }}>
                                  {fmtAed(rentPayments.reduce((s, p) => s + p.amount, 0))}
                                </td>
                                <td colSpan={2} />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </SectionCard>
                  </div>

                  {/* Documents */}
                  <div className={activeDrawer !== 'documents' ? 'hidden' : 'p-5 space-y-4'}>
                    <SectionCard title="Contract Documents" icon={FileText}>
                      {docs.length === 0 ? (
                        <p className="text-xs text-[#9b9890]">No documents available for this contract yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {docs.map(d => {
                            const label = d.displayName
                              ?? d.documentKey.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
                            return (
                              <div key={d.id} className="flex items-center gap-3 p-3 rounded-xl border border-[#e8e6e0] bg-white">
                                <div className="w-9 h-9 rounded-lg bg-[#f0faf6] flex items-center justify-center shrink-0">
                                  <FileText size={16} className="text-[#2e9f82]" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-[#1a1916] truncate">{label}</p>
                                  <p className="text-[11px] text-[#9b9890]">
                                    {d.expiryDate ? `Expires ${new Date(d.expiryDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}` : (d.category ?? '').replace(/_/g, ' ')}
                                  </p>
                                </div>
                                {d.fileUrl && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button type="button"
                                      onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: d.displayName ?? d.documentKey })}
                                      className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] px-2.5 py-1.5 rounded-lg hover:bg-[#f0faf6] cursor-pointer">
                                      <Eye size={13} /> View
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </SectionCard>
                  </div>

                  {/* Clauses */}
                  <div className={activeDrawer !== 'clauses' ? 'hidden' : 'p-5 space-y-4'}>
                    <SectionCard title="Contract Clauses" icon={ClipboardList}>
                      {contract.customClauses?.length > 0 ? (
                        <ol className="space-y-2 list-decimal list-inside">
                          {contract.customClauses.map((c, i) => (
                            <li key={i} className="text-xs text-[#1a1916]">{c}</li>
                          ))}
                        </ol>
                      ) : (
                        <p className="text-xs text-[#9b9890] text-center py-4">No custom clauses.</p>
                      )}
                    </SectionCard>
                    {contract.notes && (
                      <SectionCard title="Notes" icon={FileText}>
                        <p className="text-xs text-[#6b6860] whitespace-pre-wrap">{contract.notes}</p>
                      </SectionCard>
                    )}
                  </div>

                </div>
              </div>
            </div>
          </>
        )}

        {/* ── 12-col grid ── */}
        <div className="grid grid-cols-12 gap-4">

          {/* Left sidebar — nav */}
          <div className="col-span-12 lg:col-span-3">
            <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden lg:sticky lg:top-24">
              <div className="px-4 py-3 border-b border-[#f0ede8]">
                <p className="text-xs font-bold text-[#1a1916]">Contract Details</p>
                <p className="text-[10px] text-[#9b9890] mt-0.5">Click any section to view</p>
              </div>
              <div className="divide-y divide-[#f4f3ef]">
                {([
                  { key: 'parties',   icon: User,          label: 'Parties',   desc: 'Landlord & tenant info' },
                  { key: 'property',  icon: Building2,     label: 'Property',  desc: 'Unit & building details' },
                  { key: 'period',    icon: Calendar,      label: 'Period',     desc: 'Dates & duration' },
                  {
                    key: 'payments',
                    icon: CreditCard,
                    label: 'Payments',
                    desc: isPending ? 'Set your preferences' : `${contract.numberOfInstallments ?? '?'} cheques`,
                  },
                  { key: 'documents', icon: FileText,      label: 'Documents', desc: `${docs.length} file${docs.length === 1 ? '' : 's'}` },
                  { key: 'clauses',   icon: ClipboardList, label: 'Clauses',   desc: `${contract.customClauses?.length ?? 0} clauses` },
                ] as const).map(({ key, icon: Icon, label, desc }) => (
                  <button key={key} onClick={() => setActiveDrawer(key)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#f7f6f2] transition-colors group">
                    <div className="flex items-center gap-2.5">
                      <Icon size={14} className="text-[#9b9890] group-hover:text-[#2e9f82] transition-colors shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-[#1a1916]">{label}</p>
                        <p className="text-[10px] text-[#9b9890]">{desc}</p>
                      </div>
                    </div>
                    <ChevronRight size={12} className="text-[#c0bdb8] group-hover:text-[#2e9f82] shrink-0" />
                  </button>
                ))}
              </div>
              <div className="px-4 py-3 border-t border-[#f0ede8] text-[10px] text-[#9b9890]">
                Created {fmtDate(contract.createdAt)}
              </div>
            </div>
          </div>

          {/* Right — Tenancy Activation timeline */}
          <div className="col-span-12 lg:col-span-9 space-y-4">

            {/* Timeline */}
            <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: '#2e9f82' }}>
                <div>
                  <p className="text-sm font-bold text-white uppercase tracking-wider">Tenancy Activation</p>
                  <p className="text-[11px] text-white/70 mt-0.5">
                    {isActive
                      ? `Active · ends ${fmtDate(contract.endDate)}`
                      : 'Track & take action on each step'}
                  </p>
                </div>
                <StatusBadge status={contract.status} />
              </div>

              {/* Steps */}
              <div className="px-5 pt-4 pb-3">

                {/* Step 1: Contract Issued */}
                {(()=>{ const state: TLState = ss(true, st1Done); return (
                <StepRow num={1} label="Contract Issued" state={state} last={false}>
                  {state === 'current' && (
                    <div className="mt-2">
                      <p className="text-[10px] text-[#9b9890] mb-2">Your landlord is reviewing and preparing the contract. You&apos;ll be notified once it&apos;s ready.</p>
                      <button
                        onClick={() => setActiveDrawer('payments')}
                        className="flex items-center gap-1 text-[10px] font-semibold text-[#2e9f82] hover:underline">
                        <CreditCard size={10} /> Set payment preferences →
                      </button>
                    </div>
                  )}
                  {state === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Issued to you ✓</p>}
                </StepRow>
                );})()}

                {/* Step 2: Payment Collection */}
                {(()=>{ const state: TLState = ss(st1Done, st2Done); return (
                <StepRow num={2} label="Payment Collection" state={state} last={false}>
                  <p className="text-[10px] text-[#9b9890] mt-0.5">PDC cheques and security deposit collected and confirmed by landlord</p>
                  {state === 'current' && (
                    <p className="text-[9px] text-[#a85b15] bg-[#fdf3e3] rounded-lg px-2.5 py-1.5 mt-1.5 leading-tight">
                      Your landlord is confirming receipt of all cheques. You will be able to review and sign once confirmed.
                    </p>
                  )}
                  {state === 'done' && (
                    <p className="text-[10px] text-[#2e9f82] mt-0.5 flex items-center gap-1">
                      <CheckCircle size={9} /> Payment confirmed — contract is ready for signatures
                    </p>
                  )}
                </StepRow>
                );})()}

                {/* Step 3: Signatures */}
                {(()=>{ const state: TLState = ss(st2Done, st3Done); return (
                <StepRow num={3} label="Signatures" state={state} last={false}>
                  {state !== 'upcoming' && (
                    <div className="mt-1.5 space-y-1.5">
                      {/* Your signature */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${
                            hasTenantSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'
                          }`}>{hasTenantSigned ? '✓' : '○'}</span>
                          <span className="text-[10px] text-[#6b6860]">Your signature</span>
                        </div>
                        {!hasTenantSigned && canSign && (
                          <button onClick={() => setShowSignModal(true)}
                            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-[#2e9f82] text-white hover:bg-[#27896f]">
                            Sign Now
                          </button>
                        )}
                      </div>
                      {/* Landlord signature */}
                      <div className="flex items-center gap-1.5">
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${
                          hasLandlordSigned ? 'bg-[#2e9f82] text-white' : 'bg-[#e8e6e0] text-[#9b9890]'
                        }`}>{hasLandlordSigned ? '✓' : '○'}</span>
                        <span className="text-[10px] text-[#6b6860]">Landlord signed</span>
                      </div>
                    </div>
                  )}
                </StepRow>
                );})()}

                {/* Step 4: Ejari Registration */}
                {(()=>{ const state: TLState = ss(st3Done, st4Done); return (
                <StepRow num={4} label="Ejari Registration" state={state} last={false}>
                  {state === 'current' && (
                    <p className="text-[10px] text-[#9b9890] mt-1">
                      Your landlord is registering the contract with Dubai Land Department. This typically takes 2–5 business days.
                    </p>
                  )}
                  {state === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Registered with DLD ✓</p>}
                </StepRow>
                );})()}

                {/* Step 5: Move-In & Utility */}
                {(()=>{ const state: TLState = ss(st4Done, st5Done); return (
                <StepRow num={5} label="Move-In &amp; Utility" state={state} last={false}>
                  {state === 'current' && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[10px] text-[#9b9890]">Move-in inspection &amp; key handover in progress.</p>
                      <p className="text-[10px] text-[#9b9890]">Utility account activation being verified by landlord.</p>
                    </div>
                  )}
                  {state === 'done' && <p className="text-[10px] text-[#2e9f82] mt-0.5">Keys handed over · Utility active ✓</p>}
                </StepRow>
                );})()}

                {/* Step 6: Active Tenancy */}
                {(()=>{ const state: TLState = isActive ? 'current' : 'upcoming'; return (
                <StepRow num={6} label="Active Tenancy" state={state} last={true}>
                  {isActive && (
                    <div className="mt-1">
                      <p className="text-[10px] text-[#2e9f82] font-medium">Your tenancy is live</p>
                      <p className="text-[10px] text-[#9b9890] mt-0.5">Ends {fmtDate(contract.endDate)} · {contract.numberOfInstallments ?? '—'} cheques</p>
                    </div>
                  )}
                </StepRow>
                );})()}

              </div>
            </div>

            {/* Signatures card */}
            {(isIssued || isActive) && (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0ede8] flex items-center gap-2">
                  <FileSignature size={15} className="text-[#2e9f82]" />
                  <span className="text-sm font-semibold text-[#1a1916]">Signatures</span>
                </div>
                <div className="px-5 py-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {/* Tenant */}
                    <div className="border border-[#e8e6e0] rounded-xl p-4">
                      <p className="text-[10px] text-[#9b9890] uppercase font-semibold mb-2">Your Signature</p>
                      {tenantSig ? (
                        <div className="space-y-1.5">
                          {tenantSig.signatureImage && (
                            <img src={tenantSig.signatureImage} alt="Your signature"
                              className="h-14 object-contain border border-[#f0ede8] rounded-lg p-1 bg-white" />
                          )}
                          <p className="text-xs font-semibold text-[#1a1916]">{tenantSig.signatoryName}</p>
                          <p className="text-[10px] text-[#9b9890]">{fmtDate(tenantSig.signedAt)}</p>
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#2e9f82] font-semibold bg-[#f0faf6] px-2 py-0.5 rounded-full border border-[#c5e8df]">
                            <BadgeCheck size={10} /> Signed
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="h-14 flex items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-lg">
                            <span className="text-xs text-[#c0bdb8] italic">Not yet signed</span>
                          </div>
                          {canSign && (
                            <button onClick={() => setShowSignModal(true)}
                              className="flex items-center gap-1.5 text-xs font-semibold text-[#2e9f82] hover:underline">
                              <FileSignature size={12} /> Sign now →
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Landlord */}
                    <div className="border border-[#e8e6e0] rounded-xl p-4">
                      <p className="text-[10px] text-[#9b9890] uppercase font-semibold mb-2">Landlord Signature</p>
                      {landlordSig ? (
                        <div className="space-y-1.5">
                          {landlordSig.signatureImage && (
                            <img src={landlordSig.signatureImage} alt="Landlord signature"
                              className="h-14 object-contain border border-[#f0ede8] rounded-lg p-1 bg-white" />
                          )}
                          <p className="text-xs font-semibold text-[#1a1916]">{landlordSig.signatoryName}</p>
                          <p className="text-[10px] text-[#9b9890]">{fmtDate(landlordSig.signedAt)}</p>
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#2e9f82] font-semibold bg-[#f0faf6] px-2 py-0.5 rounded-full border border-[#c5e8df]">
                            <BadgeCheck size={10} /> Signed
                          </span>
                        </div>
                      ) : (
                        <div className="h-14 flex items-center justify-center border-2 border-dashed border-[#e8e6e0] rounded-lg">
                          <span className="text-xs text-[#c0bdb8] italic">Awaiting landlord signature</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Sign Modal ── */}
      {showSignModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f0ede8] flex items-center justify-between" style={{ background: '#2e9f82' }}>
              <div className="flex items-center gap-2">
                <FileSignature size={16} className="text-white" />
                <span className="text-sm font-bold text-white">Sign Contract — {contract.ref}</span>
              </div>
              <button onClick={() => setShowSignModal(false)} className="text-white/70 hover:text-white text-xs">✕</button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3 text-xs text-[#1a7a5a]">
                By signing, you confirm you have read and agree to all terms of tenancy contract{' '}
                <strong>{contract.ref}</strong> for{' '}
                <strong>{contract.unit.number ? `Unit ${contract.unit.number}, ` : ''}{contract.property.buildingName}</strong>.
              </div>
              <div>
                <label className="text-xs font-medium text-[#1a1916] block mb-1.5">Your full legal name</label>
                <input type="text" value={signatoryName} onChange={e => setSignatoryName(e.target.value)}
                  placeholder="As it appears on your Emirates ID"
                  className="w-full text-sm px-3 py-2.5 border border-[#e8e6e0] rounded-xl bg-[#f7f6f2] focus:outline-none focus:border-[#2e9f82] placeholder:text-[#c0bdb8]" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#1a1916] block mb-1.5">Draw your signature</label>
                <SignaturePad onSignatureChange={setSignatureImage} />
              </div>
              {signError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <AlertCircle size={13} /> {signError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowSignModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#e8e6e0] text-sm text-[#6b6860] hover:border-[#c5c2bc] transition-colors">
                  Cancel
                </button>
                <button onClick={submitSignature} disabled={signing || !signatoryName.trim() || !signatureImage}
                  className="flex-1 py-2.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {signing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  {signing ? 'Signing…' : 'Submit Signature'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
