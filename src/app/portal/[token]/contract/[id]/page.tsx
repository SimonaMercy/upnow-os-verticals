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
import { openDocViewer } from '@/lib/docViewer';
import type { EjariContractData, EjariAddendum } from '@/components/contract/EjariContractPdf';

const EjariInline = dynamic(() => import('@/components/contract/EjariInline'), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#9b9890]"><Loader2 className="animate-spin" size={16} /> Rendering your contract…</div>,
});

interface Doc { documentKey: string; displayName: string | null; fileUrl: string }
interface Sig { role: string; signatoryName: string | null; signatureImage: string | null; signedAt: string; method?: string }
interface Detail {
  contract: EjariContractData & { id: number; status: string | null };
  documents: Doc[];
  signatures: Sig[];
  /** Addendum(s) attached to the contract — rendered combined into the contract PDF. */
  addendums?: EjariAddendum[];
  tenantSigned: boolean;
  moveInAvailable: boolean;
  purpose?: 'all' | 'documents' | 'contract' | 'move_in' | 'move_out';
  /** 'inspector' = link issued for the on-site inspection manager, who
   *  counter-signs the RP side instead of signing as the customer. */
  signerRole?: 'tenant' | 'inspector';
}

interface InspPhoto { id: string; url: string; caption?: string }
interface InspItem { name: string; inCondition?: string; outCondition?: string }
interface InspArea { name: string; items?: InspItem[]; remarks?: string }
interface Inspection {
  areas?: InspArea[];
  generalNotes?: string;
  photos?: InspPhoto[];
  moveInPhotos?: InspPhoto[];
  inspectorName?: string;
  rpSubmittedAt?: string | null;
  tenantSig?: string | null;
  tenantSignedAt?: string | null;
  rpCounterSig?: string | null;
}

const API = (token: string, path: string) => `/api/portal/${token}${path}`;
/** Backend already returns the EjariContractData-shaped nested object (incl.
 *  numberOfInstallments + unit.bedrooms) — just fold in signatures. The shared
 *  renderer formats Mode of Payment from the installment count. */
function toEjari(c: Detail['contract'], signatures: Sig[]): EjariContractData {
  return {
    ...c,
    signatures: (signatures ?? []).map(s => ({ role: s.role as 'landlord' | 'tenant', signatureImage: s.signatureImage ?? null, signedAt: s.signedAt, method: s.method })),
  };
}

export default function ContractReviewPage() {
  const params = useParams();
  const token = String(params.token);
  const id = Number(params.id);
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [insp, setInsp] = useState<Inspection | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(API(token, `/contracts/${id}`), { credentials: 'omit' })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.message || 'Contract not available'))))
      .then(setD).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  // When the link is scoped to an inspection, the tenant should review the
  // inspection the RP recorded (not the tenancy contract) before signing.
  const inspType: 'move_in' | 'move_out' | null =
    d?.purpose === 'move_out' ? 'move_out' : d?.purpose === 'move_in' ? 'move_in' : null;
  const loadInsp = useCallback(() => {
    if (!inspType) { setInsp(null); return; }
    fetch(API(token, `/contracts/${id}/inspection?type=${inspType}`), { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then((j: Inspection | null) => setInsp(j ?? null))
      .catch(() => setInsp(null));
  }, [inspType, token, id]);
  useEffect(() => { loadInsp(); }, [loadInsp]);

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
  // Combine the addendum into the contract PDF the tenant reads/signs.
  const addendums: EjariAddendum[] = d.addendums ?? [];

  // Each link is scoped to one action; 'all' = legacy link that shows everything.
  const purpose = d.purpose ?? 'all';
  const isInspector = (d.signerRole ?? 'tenant') === 'inspector';
  const showContract = (purpose === 'contract' || purpose === 'all') && !isInspector;
  const showMoveIn = (purpose === 'move_in' || purpose === 'all') && d.moveInAvailable;
  const showMoveOut = purpose === 'move_out';

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link href={`/portal/${token}`} className="text-xs text-[#6b6860] flex items-center gap-1 mb-3"><ArrowLeft size={13} /> Back to documents</Link>
        <div className="flex items-center gap-2 mb-1"><ShieldCheck size={18} className="text-[#2e9f82]" /><span className="font-bold text-[#1a1916]">UpNow</span></div>
        <h1 className="text-2xl font-bold text-[#1a1916] mt-3">
          {inspType === 'move_out' ? 'Move-out inspection' : inspType === 'move_in' ? 'Move-in inspection' : 'Your tenancy contract'} — CID-{d.contract.id}
        </h1>
        <p className="text-sm text-[#6b6860] mt-1">
          {inspType
            ? 'Review the condition your rental provider recorded, then sign at the bottom to confirm.'
            : 'Please read the full contract below, then sign at the bottom.'}
        </p>

        {/* Inspection links show the inspection the RP recorded; contract links show the contract document. */}
        <div className="mt-5">
          {inspType ? (
            insp && insp.rpSubmittedAt ? (
              <InspectionPreview insp={insp} type={inspType} />
            ) : (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] p-8 text-center text-sm text-[#9b9890]">
                {isInspector
                  ? 'No inspection recorded yet — fill the inspection form below to get started.'
                  : 'Your rental provider hasn’t completed this inspection yet. Please check back once they share it.'}
              </div>
            )
          ) : (
            <EjariInline data={ejari} addendums={addendums} height={680} />
          )}
        </div>

        {/* Any extra signed/official copies attached */}
        {d.documents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {d.documents.map(x => (
              <button key={x.documentKey} type="button"
                onClick={() => openDocViewer({ fileUrl: x.fileUrl, caption: (x.displayName ?? x.documentKey).replace(/_/g, ' ') })}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-[#e8e6e0] text-[#2e9f82] cursor-pointer">
                <FileText size={13} /> {(x.displayName ?? x.documentKey).replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}

        {/* Sign the contract */}
        {showContract && (
          <Card title="Sign the contract" icon={PenLine}>
            {d.tenantSigned ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this contract.</p>
            ) : (
              <SignBox token={token} contractId={id} kind="contract" defaultName={d.contract.tenant?.name ?? ''} onSigned={load} />
            )}
          </Card>
        )}

        {/* Inspector: fill / edit the inspection itself from this link — the
             on-site inspection manager records the condition, then the customer
             signs, then the inspector counter-signs below. */}
        {isInspector && (showMoveIn || showMoveOut) && !insp?.rpCounterSig && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] mt-4 px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1a1916]">{insp?.rpSubmittedAt ? 'Inspection recorded' : 'Start with the inspection form'}</p>
              <p className="text-xs text-[#6b6860] mt-0.5">
                {insp?.rpSubmittedAt
                  ? 'The form is submitted. You can still review it before counter-signing.'
                  : 'Walk the unit and record the condition room by room — photos included.'}
              </p>
            </div>
            <Link href={`/portal/${token}/contract/${id}/inspection?type=${showMoveOut ? 'move_out' : 'move_in'}`}
              className="text-xs font-semibold px-4 py-2 rounded-xl text-white bg-[#2e9f82] inline-flex items-center gap-1.5 shrink-0">
              <PenLine size={13} /> {insp?.rpSubmittedAt ? 'Open inspection form' : 'Fill the inspection'}
            </Link>
          </div>
        )}

        {showMoveIn && (
          <Card title={isInspector ? 'Counter-sign the move-in inspection' : 'Sign the move-in inspection'} icon={CheckCircle2}>
            {!insp || !insp.rpSubmittedAt ? (
              <p className="text-sm text-[#9b9890]">{isInspector ? 'Fill and submit the inspection form above first.' : 'Not ready to sign yet — your rental provider is still completing the inspection.'}</p>
            ) : isInspector ? (
              insp.rpCounterSig ? (
                <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> This inspection has been counter-signed.</p>
              ) : !insp.tenantSig ? (
                <p className="text-sm text-[#9b9890]">Waiting for the customer to sign first — you counter-sign after them.</p>
              ) : (
                <>
                  <p className="text-xs text-[#6b6860] mb-2">You are signing as the inspection manager, on behalf of the rental provider. Confirm the condition recorded above, then sign — this completes the move-in.</p>
                  <SignBox token={token} contractId={id} kind="move_in" asInspector defaultName="" onSigned={() => { load(); loadInsp(); }} />
                </>
              )
            ) : insp.tenantSig ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this move-in inspection.</p>
            ) : (
              <>
                <p className="text-xs text-[#6b6860] mb-2">Confirm the condition recorded above, then sign.</p>
                <SignBox token={token} contractId={id} kind="move_in" defaultName={d.contract.tenant?.name ?? ''} onSigned={() => { load(); loadInsp(); }} />
              </>
            )}
          </Card>
        )}

        {showMoveOut && (
          <Card title={isInspector ? 'Counter-sign the move-out inspection' : 'Sign the move-out inspection'} icon={CheckCircle2}>
            {!insp || !insp.rpSubmittedAt ? (
              <p className="text-sm text-[#9b9890]">{isInspector ? 'Fill and submit the inspection form above first.' : 'Not ready to sign yet — your rental provider is still completing the move-out inspection.'}</p>
            ) : isInspector ? (
              insp.rpCounterSig ? (
                <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> This inspection has been counter-signed.</p>
              ) : !insp.tenantSig ? (
                <p className="text-sm text-[#9b9890]">Waiting for the customer to sign first — you counter-sign after them.</p>
              ) : (
                <>
                  <p className="text-xs text-[#6b6860] mb-2">You are signing as the inspection manager, on behalf of the rental provider. Confirm the move-out condition recorded above, then sign.</p>
                  <SignBox token={token} contractId={id} kind="move_out" asInspector defaultName="" onSigned={() => { load(); loadInsp(); }} />
                </>
              )
            ) : insp.tenantSig ? (
              <p className="text-sm text-[#16a34a] flex items-center gap-1.5"><CheckCircle2 size={16} /> You have signed this move-out inspection.</p>
            ) : (
              <>
                <p className="text-xs text-[#6b6860] mb-2">Confirm the move-out condition recorded above, then sign.</p>
                <SignBox token={token} contractId={id} kind="move_out" defaultName={d.contract.tenant?.name ?? ''} onSigned={() => { load(); loadInsp(); }} />
              </>
            )}
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

function SignBox({ token, contractId, kind, defaultName, onSigned, asInspector = false }: {
  token: string; contractId: number; kind: 'contract' | 'move_in' | 'move_out'; defaultName: string; onSigned: () => void; asInspector?: boolean;
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
      const url = kind === 'contract' ? `/contracts/${contractId}/sign`
        : asInspector ? `/contracts/${contractId}/inspection/counter-sign`
        : `/contracts/${contractId}/inspection/sign`;
      const body = kind === 'contract'
        ? { signatureImage, signatoryName: name.trim() }
        : asInspector
          ? { type: kind === 'move_out' ? 'move_out' : 'move_in', signatureImage, signatoryName: name.trim() }
          : { type: kind === 'move_out' ? 'move_out' : 'move_in', signatureImage };
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
      <input className="w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg" placeholder={asInspector ? 'Your full name (inspection manager)' : 'Full name'} value={name} onChange={e => setName(e.target.value)} />
      <div>
        <p className="text-xs text-[#6b6860] mb-1">Draw your signature</p>
        <canvas ref={canvasRef} width={520} height={150} className="w-full border border-[#d8d6d0] rounded-lg bg-[#fafaf8] touch-none"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        <button onClick={clear} className="text-[11px] text-[#6b6860] mt-1">Clear</button>
      </div>
      {err && <p className="text-xs text-[#b91c1c]">{err}</p>}
      <button onClick={submit} disabled={busy} className="text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-60 bg-[#2e9f82] inline-flex items-center gap-1.5">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} {kind === 'contract' ? 'Sign contract' : asInspector ? (kind === 'move_out' ? 'Counter-sign move-out' : 'Counter-sign move-in') : kind === 'move_out' ? 'Sign move-out' : 'Sign move-in'}
      </button>
    </div>
  );
}

function condMeta(v?: string): { label: string; cls: string } {
  if (v === 'G') return { label: 'Good', cls: 'bg-[#2e9f82] text-white' };
  if (v === 'F') return { label: 'Fair', cls: 'bg-[#f59e0b] text-white' };
  if (v === 'D') return { label: 'Damaged', cls: 'bg-[#ef4444] text-white' };
  return { label: '—', cls: 'bg-[#f0efe9] text-[#9b9890]' };
}

function PhotoGrid({ photos }: { photos: InspPhoto[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {photos.map(p => (
        <button key={p.id} type="button" onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption })} className="block w-full rounded-lg overflow-hidden border border-[#e8e6e0] cursor-pointer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.caption || 'photo'} className="w-full h-20 object-cover" />
        </button>
      ))}
    </div>
  );
}

/** Read-only inspection report the tenant reviews before signing on the portal. */
function InspectionPreview({ insp, type }: { insp: Inspection; type: 'move_in' | 'move_out' }) {
  const isOut = type === 'move_out';
  const cols = isOut ? 'grid-cols-[1fr_5rem_5rem]' : 'grid-cols-[1fr_5rem]';
  const Pill = ({ v }: { v?: string }) => {
    const m = condMeta(v);
    return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
  };
  return (
    <div className="space-y-4">
      {/* Condition legend */}
      <div className="flex items-center gap-3 bg-[#f9f8f6] rounded-xl px-4 py-2.5 text-xs">
        <span className="font-semibold text-[#6b6860] uppercase tracking-wide">Condition</span>
        <span className="inline-flex items-center gap-1.5"><Pill v="G" /></span>
        <span className="inline-flex items-center gap-1.5"><Pill v="F" /></span>
        <span className="inline-flex items-center gap-1.5"><Pill v="D" /></span>
      </div>

      {(insp.areas ?? []).map((area, ai) => (
        <div key={ai} className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
          <div className="px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
            <span className="text-sm font-bold text-[#1a1916]">{area.name || `Area ${ai + 1}`}</span>
          </div>
          <div className="px-5 py-3">
            <div className={`grid ${cols} gap-3 pb-1.5 border-b border-[#f4f3ef] text-[10px] font-semibold uppercase tracking-wide text-[#9b9890]`}>
              <span>Item</span>
              {isOut ? <><span className="text-center">Move-in</span><span className="text-center">Move-out</span></> : <span className="text-center">Condition</span>}
            </div>
            {(area.items ?? []).map((it, ii) => (
              <div key={ii} className={`grid ${cols} gap-3 items-center py-1.5 border-b border-[#f9f8f6] last:border-0`}>
                <span className="text-sm text-[#1a1916]">{it.name}</span>
                {isOut ? (
                  <>
                    <span className="text-center"><Pill v={it.inCondition} /></span>
                    <span className="text-center"><Pill v={it.outCondition} /></span>
                  </>
                ) : (
                  <span className="text-center"><Pill v={it.inCondition} /></span>
                )}
              </div>
            ))}
            {area.remarks && <p className="text-xs text-[#6b6860] mt-2"><span className="font-semibold">Remarks:</span> {area.remarks}</p>}
          </div>
        </div>
      ))}

      {insp.generalNotes && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
          <p className="text-xs font-semibold text-[#1a1916] mb-1">General notes</p>
          <p className="text-sm text-[#6b6860] whitespace-pre-wrap">{insp.generalNotes}</p>
        </div>
      )}

      {(isOut && (insp.moveInPhotos ?? []).length > 0) || (insp.photos ?? []).length > 0 ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4 space-y-3">
          {isOut && (insp.moveInPhotos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#9b9890] mb-1.5">Move-in photos (reference)</p>
              <PhotoGrid photos={insp.moveInPhotos!} />
            </div>
          )}
          {(insp.photos ?? []).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[#1a1916] mb-1.5">{isOut ? 'Move-out photos' : 'Move-in photos'}</p>
              <PhotoGrid photos={insp.photos!} />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
