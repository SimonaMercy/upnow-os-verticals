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
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useCallback, useEffect, useRef, useState, createElement } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, RotateCcw, FileSignature, Printer, Download } from 'lucide-react';
import { triggerBrowserDownload } from '@/lib/downloadDoc';

/**
 * Back link that works whether the page was opened in a new tab (no history)
 * or via in-app navigation. Always navigates to the parent contract detail.
 */
function BackLink({ contractId }: { contractId: string | undefined }) {
  const sp = useSearchParams();
  // Return to the tenant's space. Prefer the exact space they came from (?from),
  // else the contract's own space (v2 resolves a `c-<id>` key directly). Only
  // honour same-origin relative paths.
  const from = sp.get('from');
  const safeFrom = from && from.startsWith('/') && !from.startsWith('//') ? from : null;
  const href = safeFrom
    ?? (contractId ? `/dashboard/customer/spaces/v2/c-${contractId}` : '/dashboard/customer/spaces');
  return (
    <Link href={href} className="flex items-center gap-1.5 text-sm text-[#6b6860] hover:text-[#1a1916] w-fit">
      <ArrowLeft size={15} /> Back to my space
    </Link>
  );
}

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
  reportGeneratedDate?: string;
  inspectorName: string;
  inspectionDate?: string;
  moveInDate: string;
  areas: InspectionArea[];
  generalNotes: string;
  photos: InspectionPhoto[];
  tenantSig: string | null;
  landlordSig: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
  rpCounterSignedAt?: string | null;
}

interface InspMeta {
  tenantName: string;
  tenantPhone: string;
  unitNumber: string;
  buildingName: string;
  handoverDate: string | null;     // move-in / handover
  contractEndDate: string | null;  // effective end (termination date if terminating, else lease end)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-[#1a1916]">{value || '—'}</p>
    </div>
  );
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
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const contractId = Number(params.id);
  const inspType = (searchParams.get('type') === 'move_out' ? 'move_out' : 'move_in') as InspType;
  const isMoveIn = inspType === 'move_in';
  const title = isMoveIn ? 'Move-In Inspection' : 'Move-Out Inspection';

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
      // Inspection (the report) + the contract (unit/building/dates) + own profile
      // (tenant name/mobile) — the latter two power the printable header.
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
        // Some accounts have `name` polluted with the phone number (legacy OTP
        // signup) — prefer firstName + lastName, and ignore a phone-like name.
        const composedName = [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim();
        const rawName = (me?.name ?? '').trim();
        const tenantName = composedName || (/^\+?[\d\s()-]{6,}$/.test(rawName) ? '' : rawName);
        setMeta({
          tenantName,
          tenantPhone: me?.phone ?? '',
          unitNumber: c?.unit?.unitNumber ?? c?.unit?.number ?? '',
          buildingName: c?.property?.buildingName ?? '',
          handoverDate: body.moveInDate || c?.startDate || null,
          contractEndDate: c?.termination?.effectiveDate ?? c?.endDate ?? null,
        });
      } catch { /* header is best-effort; report still renders */ }
    } catch {
      setLoadError('Unexpected error loading inspection');
    } finally { setLoading(false); }
  }, [contractId, inspType]);
  useEffect(() => { void load(); }, [load]);

  // Clean, watermark-free download of the inspection report (the tenant's own
  // document). Builds the same react-pdf report the RP snapshot uses, from the
  // live data, on demand.
  async function downloadInspectionPdf() {
    if (!data || !meta) return;
    try {
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/contract/InspectionReportPdf'),
      ]);
      const pdfData = {
        type: inspType, ref: `CID-${contractId}`,
        property: meta.buildingName ?? '', unit: meta.unitNumber ?? '', tenantName: meta.tenantName ?? '',
        inspectorName: data.inspectorName,
        inspectionDate: data.inspectionDate ?? null,
        moveInDate: data.moveInDate || meta.handoverDate || null,
        areas: data.areas.map(a => ({ name: a.name, items: a.items.map(it => ({ name: it.name, inCondition: it.inCondition, outCondition: it.outCondition, photoCount: 0 })), remarks: a.remarks })),
        generalNotes: data.generalNotes,
        photoCaptions: data.photos.map(p => p.caption?.trim() || 'Photo'),
        utilities: [] as { provider: string; cleared: boolean; outstanding: string; reference: string }[],
        tenantSig: data.tenantSig, tenantSignedAt: data.tenantSignedAt ?? null,
        rpCounterSig: data.rpCounterSig ?? null, rpCounterSignedAt: data.rpCounterSignedAt ?? null,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data: pdfData as any }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, `${inspType === 'move_out' ? 'Move-out' : 'Move-in'}-report-CID-${contractId}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort download */ }
  }

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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6 print:py-0 print:max-w-none" id="inspection-report">
      <div className="no-print"><BackLink contractId={params?.id} /></div>

      <div className="flex items-start justify-between gap-3 no-print">
        <div>
          <h1 className="text-xl font-bold text-[#1a1916]">{title}</h1>
          <p className="text-xs text-[#9b9890] mt-1">Review the recorded condition, then sign to confirm.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">
            <Printer size={13} /> Print
          </button>
          {data && meta && (
            <button type="button" onClick={downloadInspectionPdf}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-full border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef]">
              <Download size={13} /> Download PDF
            </button>
          )}
        </div>
      </div>

      {/* Printable header — tenant, property + key dates */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#f4f3ef]">
          <h2 className="text-base font-bold text-[#1a1916]">{title} Report</h2>
          <span className="text-xs text-[#9b9890]">Contract #{contractId}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          <InfoCell label="Tenant name" value={meta?.tenantName ?? ''} />
          <InfoCell label="Tenant mobile" value={meta?.tenantPhone ?? ''} />
          <InfoCell label={`${title} date`} value={fmtDate(data.inspectionDate ?? data.reportGeneratedDate)} />
          <InfoCell label="Building" value={meta?.buildingName ?? ''} />
          <InfoCell label="Unit no." value={meta?.unitNumber ?? ''} />
          <InfoCell label="Inspector" value={data.inspectorName ?? ''} />
          <InfoCell label="Handover date" value={fmtDate(meta?.handoverDate)} />
          <InfoCell label="Contract end date" value={fmtDate(meta?.contractEndDate)} />
        </div>
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


      {data.generalNotes && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5">
          <h2 className="text-sm font-bold text-[#1a1916] mb-2">General Notes</h2>
          <p className="text-xs text-[#6b6860] whitespace-pre-wrap">{data.generalNotes}</p>
        </div>
      )}

      {/* Acknowledgement + signature */}
      <div className="bg-white rounded-2xl border border-[#e8e6e0] p-5 space-y-4">
        <h2 className="text-sm font-bold text-[#1a1916] flex items-center gap-1.5">
          <FileSignature size={14} className="text-[#2e9f82]" /> Acknowledgement &amp; Signature
        </h2>
        <p className="text-xs text-[#4b4b46] leading-relaxed bg-[#fafaf8] border border-[#f0efe9] rounded-xl p-3">
          {isMoveIn
            ? `I, ${meta?.tenantName || 'the tenant'}, confirm that I have inspected the above unit and that the recorded condition accurately reflects its state at the time of handover / move-in.`
            : `I, ${meta?.tenantName || 'the tenant'}, confirm that I have inspected the above unit and that the recorded condition accurately reflects its state at move-out. I understand that any damages or outstanding dues noted above may be deducted from my security deposit as part of the final settlement.`}
        </p>

        {signed ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-1">Tenant</p>
                <div className="border border-[#e8e6e0] rounded-lg bg-white h-24 flex items-center justify-center overflow-hidden">
                  {data.tenantSig
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.tenantSig} alt="Tenant signature" className="max-h-20 object-contain" />
                    : <span className="text-xs text-[#16a34a]">Signed ✓</span>}
                </div>
                <p className="text-[10px] text-[#6b6860] mt-1">{meta?.tenantName || ''}{data.tenantSignedAt ? ` · ${fmtDate(data.tenantSignedAt)}` : ''}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-1">Rental provider</p>
                <div className="border border-[#e8e6e0] rounded-lg bg-white h-24 flex items-center justify-center overflow-hidden">
                  {data.rpCounterSig
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.rpCounterSig} alt="Rental provider signature" className="max-h-20 object-contain" />
                    : <span className="text-xs text-[#9b9890]">Awaiting counter-signature</span>}
                </div>
                <p className="text-[10px] text-[#6b6860] mt-1">{data.rpCounterSignedAt ? fmtDate(data.rpCounterSignedAt) : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-[#f0faf6] border border-[#c5e8df] rounded-xl px-4 py-2.5 no-print">
              <CheckCircle2 size={15} className="text-[#2e9f82]" />
              <p className="text-sm font-medium text-[#1a7a5a]">{data.rpCounterSig ? 'Both parties have signed.' : 'You have signed — awaiting the rental provider counter-signature.'}</p>
            </div>
          </div>
        ) : (
          <div className="no-print space-y-3">
            <p className="text-xs text-[#9b9890]">Tick the unit against the report above, then draw your signature. Once signed, this can&apos;t be changed.</p>
            <SigPad value={sigImg} onChange={setSigImg} />
            {signError && <p className="text-xs text-red-600">{signError}</p>}
            <button
              type="button"
              onClick={handleSign}
              disabled={!sigImg || signing}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 cursor-pointer"
              style={{ background: '#2e9f82' }}
            >
              {signing ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : <><FileSignature size={14} /> Agree &amp; Sign Inspection</>}
            </button>
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          nav, aside, .no-print { display: none !important; }
          body { background: #fff !important; }
          #inspection-report { margin: 0 !important; }
        }
      `}</style>
    </div>
  );
}
