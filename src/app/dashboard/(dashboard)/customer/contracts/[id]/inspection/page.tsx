/**
 * Tenant-facing inspection viewer + signer. Renders the shared InspectionReportView
 * read-only (audience='customer' — no amounts) and lets the tenant counter-sign.
 * Signature posts to POST /contracts/tenant/:id/inspection/sign?type=...
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, RotateCcw, FileSignature, Printer } from 'lucide-react';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';
import type { InspectionDoc, InspectionCategory } from '@/lib/inspectionCatalog';

function BackLink({ contractId }: { contractId: string | undefined }) {
  const sp = useSearchParams();
  const from = sp.get('from');
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
  const href = safeFrom ?? (contractId ? `/dashboard/customer/spaces/v2/c-${contractId}` : '/dashboard/customer/spaces');
  return (
    <Link href={href} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] w-fit">
      <ArrowLeft size={15} /> Back to my space
    </Link>
  );
}

type InspType = 'move_in' | 'move_out';

interface InspectionData {
  reportGeneratedDate?: string;
  inspectorName?: string;
  inspectorCompany?: string;
  inspectorRole?: string;
  inspectionDate?: string;
  moveInDate?: string;
  categories?: InspectionCategory[];
  generalNotes?: string;
  tenantSig: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}
interface InspMeta {
  tenantName: string; tenantPhone: string; unitNumber: string; buildingName: string;
  handoverDate: string | null; contractEndDate: string | null;
}

/** Inline signature canvas. */
function SigPad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = cvs.getBoundingClientRect();
    cvs.width = rect.width * ratio; cvs.height = rect.height * ratio;
    const ctx = cvs.getContext('2d'); if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1916';
  }, []);
  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault(); drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
    const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
    const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current?.toDataURL('image/png') ?? null);
  }
  function clear() {
    const cvs = canvasRef.current; const ctx = cvs?.getContext('2d');
    if (!cvs || !ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height); onChange(null);
  }
  return (
    <div className="w-full space-y-2">
      <canvas ref={canvasRef}
        className="w-full h-32 rounded-xl border-2 border-dashed border-[#d8d6d0] bg-[#fafaf8] touch-none cursor-crosshair"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <div className="flex items-center justify-between">
        {value ? <span className="text-[10px] text-[#16a34a]">✓ Signature captured</span> : <span className="text-[10px] text-[#9b9890]">Draw your signature above</span>}
        <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-[#6b6860] hover:text-[#1a1916]"><RotateCcw size={11} /> Clear</button>
      </div>
    </div>
  );
}

export default function TenantInspectionPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const contractId = Number(params.id);
  const inspType = (searchParams.get('type') === 'move_out' ? 'move_out' : 'move_in') as InspType;

  const [data, setData] = useState<InspectionData | null>(null);
  const [meta, setMeta] = useState<InspMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sigImg, setSigImg] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true); setLoadError(null);
    try {
      const [res, listRes, meRes] = await Promise.all([
        fetch(`/api/contracts/tenant/${contractId}/inspection?type=${inspType}`, { credentials: 'include' }),
        fetch(`/api/contracts/tenant`, { credentials: 'include' }),
        fetch(`/api/auth/me`, { credentials: 'include' }),
      ]);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setLoadError((b as { message?: string }).message ?? 'Failed to load inspection');
        return;
      }
      const body = await res.json() as InspectionData | null;
      if (!body) { setLoadError('The rental provider has not submitted this inspection yet.'); return; }
      setData(body);
      if (body.tenantSig) setSigned(true);
      try {
        const list = listRes.ok ? (await listRes.json()) : [];
        const c = Array.isArray(list) ? list.find((x: { id: number }) => x.id === contractId) : null;
        const me = meRes.ok ? await meRes.json() : null;
        const composedName = [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim();
        const rawName = (me?.name ?? '').trim();
        const personName = composedName || (/^\+?[\d\s()-]{6,}$/.test(rawName) ? '' : rawName);
        // Company tenants: the party name is the company, not the signatory.
        const tenantName = (c?.tenantCompanyName as string | undefined)?.trim() || personName;
        setMeta({
          tenantName, tenantPhone: me?.phone ?? '',
          unitNumber: c?.unit?.unitNumber ?? c?.unit?.number ?? '',
          buildingName: c?.property?.buildingName ?? '',
          handoverDate: body.moveInDate || c?.startDate || null,
          contractEndDate: c?.termination?.effectiveDate ?? c?.endDate ?? null,
        });
      } catch { /* header best-effort */ }
    } catch {
      setLoadError('Unexpected error loading inspection');
    } finally { setLoading(false); }
  }, [contractId, inspType]);
  useEffect(() => { void load(); }, [load]);

  async function handleSign() {
    if (!sigImg) { setSignError('Please draw your signature first.'); return; }
    setSigning(true); setSignError(null);
    try {
      const res = await fetch(`/api/contracts/tenant/${contractId}/inspection/sign?type=${inspType}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureImage: sigImg }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setSignError((b as { message?: string }).message ?? 'Failed to submit signature');
        return;
      }
      setSigned(true);
    } catch {
      setSignError('Unexpected error submitting signature');
    } finally { setSigning(false); }
  }

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center"><Loader2 className="animate-spin text-[#2e9f82]" size={28} /></div>;
  }
  if (loadError || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <BackLink contractId={params?.id} />
        <div style={{ height: 16 }} />
        <div className="bg-[#fff7ed] border border-[#fed7aa] rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-[#c2410c] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#9a3412]">Inspection not available</p>
            <p className="text-xs text-[#c2410c] mt-0.5">{loadError ?? 'No inspection has been submitted yet.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const reportMeta: ReportMeta = {
    property: meta?.buildingName ?? '', unitNo: meta?.unitNumber ?? '', propertyType: '', floor: '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: '',
    inspectorName: data.inspectorName ?? '', inspectorCompany: data.inspectorCompany ?? '', inspectorRole: data.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8" id="inspection-report">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <BackLink contractId={params?.id} />
        <button type="button" onClick={() => window.print()}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">
          <Printer size={13} /> Print
        </button>
      </div>

      <InspectionReportView
        doc={{ ...data, categories: data.categories ?? [] } as unknown as InspectionDoc}
        meta={reportMeta}
        phase={inspType}
        audience="customer"
        dates={{ inspectionDate: data.inspectionDate ?? data.reportGeneratedDate ?? null, moveInDate: meta?.handoverDate ?? null, moveOutDate: meta?.contractEndDate ?? null }}
        editable={false}
        generalNotes={data.generalNotes}
        signatures={{ tenantSig: data.tenantSig, tenantSignedAt: data.tenantSignedAt, rpSig: data.rpCounterSig, rpSignedAt: data.rpCounterSignedAt }}
        signSlot={!signed ? <SigPad value={sigImg} onChange={setSigImg} /> : undefined}
      />

      {signed ? (
        <div className="no-print mt-5 flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3">
          <CheckCircle2 size={16} className="text-[#2e9f82]" />
          <p className="text-sm font-medium text-[#1a7a5a]">{data.rpCounterSig ? 'Both parties have signed.' : 'You have signed — awaiting the rental provider counter-signature.'}</p>
        </div>
      ) : (
        <div className="no-print mt-5 max-w-md ml-auto">
          {signError && <p className="text-xs text-red-600 mb-2">{signError}</p>}
          <button type="button" onClick={handleSign} disabled={!sigImg || signing}
            className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
            style={{ background: '#2e9f82' }}>
            {signing ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <><FileSignature size={14} /> Agree &amp; Sign Inspection</>}
          </button>
        </div>
      )}

      <style jsx global>{`
        @media print { nav, aside, .no-print { display: none !important; } body { background: #fff !important; } #inspection-report { margin: 0 !important; } }
      `}</style>
    </div>
  );
}
