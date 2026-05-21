/**
 * Tenant-facing inspection viewer + signer.
 *
 * Route: /dashboard/customer/contracts/[id]/inspection?type=move_in
 *
 * Shows the inspection the RP submitted (areas + items + remarks + photos)
 * and lets the tenant counter-sign it. The signature posts to
 * POST /contracts/tenant/:id/inspection/sign?type=...
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, RotateCcw, FileSignature, Camera } from 'lucide-react';

type InspType = 'move_in' | 'move_out';

interface InspectionItem {
  id: string; name: string; isCustom: boolean;
  inCondition: 'G' | 'F' | 'D' | ''; outCondition: 'G' | 'F' | 'D' | '';
}
interface InspectionArea {
  id: string; name: string; items: InspectionItem[]; remarks: string;
}
interface InspectionPhoto { id: string; url: string; caption: string }
interface InspectionData {
  inspectorName: string;
  inspectionDate: string;
  moveInDate: string;
  areas: InspectionArea[];
  generalNotes: string;
  photos: InspectionPhoto[];
  tenantSig: string | null;
  landlordSig: string | null;
  tenantSignedAt?: string | null;
}

function condLabel(c: InspectionItem['inCondition']) {
  if (c === 'G') return 'Good';
  if (c === 'F') return 'Fair';
  if (c === 'D') return 'Damaged';
  return '—';
}
function condColor(c: InspectionItem['inCondition']) {
  if (c === 'G') return 'text-[#16a34a]';
  if (c === 'F') return 'text-[#f59e0b]';
  if (c === 'D') return 'text-[#dc2626]';
  return 'text-[#9b9890]';
}

// Inline signature canvas — kept self-contained so this page has no other deps.
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

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
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
    const png = canvasRef.current?.toDataURL('image/png') ?? null;
    onChange(png);
  }
  function clear() {
    const cvs = canvasRef.current; const ctx = cvs?.getContext('2d');
    if (!cvs || !ctx) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="w-full h-40 rounded-xl border-2 border-dashed border-[#d8d6d0] bg-[#fafaf8] touch-none cursor-crosshair"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
      />
      <div className="flex justify-end">
        <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-[#6b6860] hover:text-[#1a1916]">
          <RotateCcw size={11} /> Clear
        </button>
      </div>
      {value && <p className="text-[10px] text-[#16a34a]">✓ Signature captured</p>}
    </div>
  );
}

export default function TenantInspectionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const contractId = Number(params.id);
  const inspType = (searchParams.get('type') === 'move_out' ? 'move_out' : 'move_in') as InspType;
  const isMoveIn = inspType === 'move_in';
  const title = isMoveIn ? 'Move-In Inspection' : 'Move-Out Inspection';

  const [data, setData] = useState<InspectionData | null>(null);
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
      const res = await fetch(`/api/contracts/tenant/${contractId}/inspection?type=${inspType}`, { credentials: 'include' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setLoadError((b as { message?: string }).message ?? 'Failed to load inspection');
        return;
      }
      const body = await res.json() as InspectionData | null;
      if (!body) { setLoadError('The rental provider has not submitted this inspection yet.'); return; }
      setData(body);
      if (body.tenantSig) setSigned(true);
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
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-[#2e9f82]" size={28} />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] mb-4">
          <ArrowLeft size={15} /> Back
        </button>
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916]">
        <ArrowLeft size={15} /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-[#1a1916]">{title}</h1>
        <p className="text-xs text-[#9b9890] mt-1">
          Inspector: <strong className="text-[#1a1916]">{data.inspectorName || '—'}</strong>
          {data.inspectionDate && <> · {new Date(data.inspectionDate).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
        </p>
      </div>

      {/* Inspection content — read-only summary of the RP's submission */}
      {data.areas.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#1a1916]">Areas Inspected</h2>
          {data.areas.map(area => (
            <div key={area.id} className="border-b border-[#f4f3ef] pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-semibold text-[#1a1916] mb-1.5">{area.name}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {area.items.map(it => (
                  <p key={it.id} className="text-xs text-[#6b6860]">
                    {it.name}: <span className={`font-semibold ${condColor(isMoveIn ? it.inCondition : it.outCondition)}`}>{condLabel(isMoveIn ? it.inCondition : it.outCondition)}</span>
                  </p>
                ))}
              </div>
              {area.remarks && <p className="text-[11px] text-[#6b6860] mt-2 italic">{area.remarks}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Photos */}
      {data.photos && data.photos.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5 mb-3">
            <Camera size={14} className="text-[#2e9f82]" /> Photos
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {data.photos.map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block rounded-xl overflow-hidden border border-[#e8e6e0] hover:border-[#2e9f82] transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || 'Inspection photo'} className="w-full h-32 object-cover" />
                {p.caption && <p className="text-[10px] text-[#6b6860] px-2 py-1 truncate">{p.caption}</p>}
              </a>
            ))}
          </div>
        </div>
      )}

      {data.generalNotes && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <h2 className="text-sm font-bold text-[#1a1916] mb-2">General Notes</h2>
          <p className="text-xs text-[#6b6860] whitespace-pre-wrap">{data.generalNotes}</p>
        </div>
      )}

      {/* Tenant signature */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
            <FileSignature size={14} className="text-[#2e9f82]" /> Your Signature
          </h2>
          <p className="text-xs text-[#9b9890] mt-0.5">
            Confirm the condition above by signing below. Once signed, this can&apos;t be changed.
          </p>
        </div>
        {signed ? (
          <div className="flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-3">
            <CheckCircle2 size={15} className="text-[#2e9f82]" />
            <p className="text-sm font-medium text-[#1a7a5a]">You have signed this inspection ✓</p>
          </div>
        ) : (
          <>
            <SigPad value={sigImg} onChange={setSigImg} />
            {signError && <p className="text-xs text-red-600">{signError}</p>}
            <button
              type="button"
              onClick={handleSign}
              disabled={!sigImg || signing}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
              style={{ background: '#2e9f82' }}
            >
              {signing ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <><FileSignature size={14} /> Sign Inspection</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
