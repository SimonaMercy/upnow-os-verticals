'use client';

/**
 * Public tenant portal — dedicated contract review + sign page.
 * Shows the ACTUAL tenancy contract document (the same vector PDF used on the
 * RP/customer print pages) for the tenant to read, then a separate signing
 * section. No login.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle2, PenLine, ShieldCheck, AlertTriangle, FileText } from 'lucide-react';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

const EjariInline = dynamic(() => import('@/components/contract/EjariInline'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#9b9890]"><Loader2 className="animate-spin" size={16} /> Rendering your contract…</div>,
});

interface Doc { documentKey: string; displayName: string | null; fileUrl: string }
interface Sig { role: string; signatoryName: string | null; signatureImage: string | null; signedAt: string }
interface Detail {
  contract: EjariContractData & { id: number; status: string | null };
  documents: Doc[];
  signatures: Sig[];
  tenantSigned: boolean;
  moveInAvailable: boolean;
}

const API = (token: string, path: string) => `/api/portal/${token}${path}`;
function instalmentLabel(n: number | null): string {
  const map: Record<number, string> = { 1: '1 - (Single Payment)', 2: '2 - (Two Payments)', 3: '3 - (Three Payments)', 4: '4 - (Four Payments)', 6: '6 - (Six Payments)', 12: '12 - (Twelve Payments)' };
  return n ? (map[n] || `${n} Cheques`) : '';
}
/** Backend already returns the EjariContractData-shaped nested object — just fold in signatures + payment label. */
function toEjari(c: Detail['contract'], signatures: Sig[]): EjariContractData {
  return {
    ...c,
    modeOfPayment: c.modeOfPayment || instalmentLabel((c as { numberOfInstallments?: number | null }).numberOfInstallments ?? null),
    signatures: (signatures ?? []).map(s => ({ role: s.role as 'landlord' | 'tenant', signatureImage: s.signatureImage ?? null, signedAt: s.signedAt })),
  };
}

export default function ContractReviewPage() {
  const params = useParams();
  const token = String(params.token);
  const id = Number(params.id);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(API(token, `/contracts/${id}`), { credentials: 'omit' })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.message || 'Contract not available'))))
      .then(setD).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Centered><Loader2 className="animate-spin" /> Loading contract…</Centered>;
  if (error || !d) return (
    <Centered>
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-2 text-[#b45309]" />
        <p className="font-semibold text-[#1a1916]">{error ?? 'Contract not available'}</p>
        <Link href={`/portal/${token}`} className="text-sm text-[#2e9f82] mt-2 inline-block">← Back</Link>
      </div>
    </Centered>
  );

  const ejari = toEjari(d.contract, d.signatures);
  const addendums: EjariAddendum[] = [];

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href={`/portal/${token}`} className="text-xs text-[#6b6860] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back to documents</Link>
        <div className="flex items-center gap-2 mb-1"><ShieldCheck size={18} className="text-[#2e9f82]" /><span className="font-bold text-[#1a1916]">UpNow</span></div>
        <h1 className="text-2xl font-bold text-[#1a1916] mt-3">Your tenancy contract — CID-{d.contract.id}</h1>
        <p className="text-sm text-[#6b6860] mt-1">Please read the full contract below, then sign at the bottom.</p>

        {/* The actual contract document */}
        <div className="mt-5">
          <EjariInline data={ejari} addendums={addendums} height={680} />
        </div>

        {/* Any extra signed/official copies attached */}
        {d.documents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {d.documents.map(x => (
              <a key={x.documentKey} href={x.fileUrl} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-[#e8e6e0] text-[#2e9f82]">
                <FileText size={13} /> {(x.displayName ?? x.documentKey).replace(/_/g, ' ')}
              </a>
            ))}
          </div>
        )}

        {/* Sign */}
        <Card title="Sign the contract" icon={PenLine}>
          {d.tenantSigned ? (
            <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this contract.</p>
          ) : (
            <SignBox token={token} contractId={id} kind="contract" defaultName={d.contract.tenant?.name ?? ''} onSigned={load} />
          )}
        </Card>

        {d.moveInAvailable && (
          <Card title="Move-in inspection" icon={CheckCircle2}>
            <p className="text-xs text-[#6b6860] mb-2">Confirm and sign your move-in inspection.</p>
            <SignBox token={token} contractId={id} kind="move_in" defaultName={d.contract.tenant?.name ?? ''} onSigned={load} />
          </Card>
        )}

        <p className="text-xs text-[#9b9890] text-center mt-6 mb-4">Powered by UpNow.</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center gap-2 text-[#6b6860] text-sm bg-[#f7f6f2] p-6">{children}</div>;
}
function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] mt-4 overflow-hidden">
      <div className="px-5 py-3 border-b border-[#f4f3ef] bg-[#fafaf8] flex items-center gap-2">
        <Icon size={15} className="text-[#2e9f82]" /><span className="text-sm font-bold text-[#1a1916]">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function SignBox({ token, contractId, kind, defaultName, onSigned }: {
  token: string; contractId: number; kind: 'contract' | 'move_in'; defaultName: string; onSigned: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(kind !== 'contract');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pos = (e: React.PointerEvent) => { const c = canvasRef.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.stroke(); dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); dirty.current = false; };

  async function submit() {
    if (kind === 'contract' && !agreed) { setErr('Please confirm you have read the contract above.'); return; }
    if (!dirty.current) { setErr('Please draw your signature.'); return; }
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    setBusy(true); setErr(null);
    try {
      const signatureImage = canvasRef.current!.toDataURL('image/png');
      const url = kind === 'contract' ? `/contracts/${contractId}/sign` : `/contracts/${contractId}/inspection/sign`;
      const body = kind === 'contract' ? { signatureImage, signatoryName: name.trim() } : { type: 'move_in', signatureImage };
      const res = await fetch(API(token, url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.message || 'Could not sign'); }
      onSigned();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {kind === 'contract' && (
        <label className="flex items-start gap-2 text-xs text-[#1a1916] cursor-pointer">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>I have read the contract above and agree to its terms.</span>
        </label>
      )}
      <input className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
      <div>
        <p className="text-xs text-[#6b6860] mb-1">Draw your signature</p>
        <canvas ref={canvasRef} width={520} height={150} className="w-full border border-[#d8d6d0] rounded-lg bg-[#fafaf8] touch-none"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        <button onClick={clear} className="text-[11px] text-[#6b6860] mt-1">Clear</button>
      </div>
      {err && <p className="text-xs text-[#b91c1c]">{err}</p>}
      <button onClick={submit} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-60 bg-[#2e9f82] inline-flex items-center gap-1.5">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} {kind === 'contract' ? 'Sign contract' : 'Sign move-in'}
      </button>
    </div>
  );
}
