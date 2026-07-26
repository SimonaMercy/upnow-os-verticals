'use client';

/**
 * SignatureBlock — the ONE signing block used by every surface in the product:
 * contract, addendum, inspection and settlement, on both the authenticated
 * dashboards and the no-login magic-link portal.
 *
 * The layout is fixed and identical everywhere, in this order:
 *   1. Identity line   — "Signing as {role}: {name}", plus an "on behalf of {B}"
 *                        line when the signer acts under Power of Attorney.
 *   2. Signature pad   — one shared canvas (pointer events, DPR-fit, PNG export).
 *   3. Terms checkbox  — mandatory; context sentence + the shared e-sign consent.
 *   4. Sign button     — declaratively disabled until the pad is drawn AND the
 *                        terms box is checked (no imperative alert-on-submit).
 *
 * The caller owns the transport: it passes `onSign`, which receives the drawn
 * signature image, the typed name and `consent: true`. Device/geo evidence is
 * collected here via the shared helpers so every surface reports it uniformly;
 * callers merge it into their own API payload.
 */
import { useEffect, useRef, useState } from 'react';
import { PenLine, CheckCircle2, Loader2, BadgeCheck } from 'lucide-react';
import {
  ESIGN_CONSENT_TEXT,
  collectClientMeta,
  collectGeo,
  type SignClientMeta,
  type SignGeo,
} from '@/lib/signEvidence';

export interface SignaturePayload {
  signatureImage: string;
  signatoryName: string;
  consent: true;
  clientMeta: SignClientMeta;
  geo: SignGeo | null;
}

export function SignatureBlock({
  signerRole = 'Landlord',
  signerName,
  onBehalfOf,
  defaultName = '',
  termsText,
  submitLabel,
  alreadySigned,
  disabledReason,
  onSign,
}: {
  /** Party label, e.g. "Landlord" | "Customer" | "Inspector". */
  signerRole?: string;
  /** Who is actually signing (person or company), shown on the identity line. */
  signerName?: string | null;
  /** When set, the signer acts under POA — renders "on behalf of {onBehalfOf}". */
  onBehalfOf?: string | null;
  /** Pre-fills the typed-name field. */
  defaultName?: string;
  /** Context sentence shown before ESIGN_CONSENT_TEXT in the terms checkbox. */
  termsText: string;
  /** Submit-button label, e.g. "Sign contract" | "Counter-sign move-out". */
  submitLabel?: string;
  /** When true, renders the completed state and offers no action. */
  alreadySigned: boolean;
  /** Optional external gate; when set the button is disabled and this is shown. */
  disabledReason?: string | null;
  /** Persist the signature. Throw to surface an error under the button. */
  onSign: (payload: SignaturePayload) => Promise<void>;
}) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(false);
  const [drawn, setDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the pad's backing store to its CSS box × DPR so strokes stay crisp and
  // un-squashed; refit on resize/rotate (which also clears it).
  useEffect(() => {
    if (alreadySigned || done) return;
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
      setDrawn(false);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [alreadySigned, done]);

  const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); if (!drawn) setDrawn(true); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); setDrawn(false); };

  const canSubmit = drawn && agreed && !!name.trim() && !busy && !disabledReason;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true); setErr(null);
    try {
      const signatureImage = canvasRef.current!.toDataURL('image/png');
      const clientMeta = collectClientMeta();
      const geo = await collectGeo();
      await onSign({ signatureImage, signatoryName: name.trim(), consent: true, clientMeta, geo });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign');
    } finally { setBusy(false); }
  };

  const signed = alreadySigned || done;

  if (signed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecf7f1', border: '1px solid #bfe3d6', borderRadius: 16, padding: '14px 18px' }}>
        <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1916' }}>Signed as {signerRole}</div>
          {signerName && <div style={{ fontSize: 12, color: '#6b6860' }}>{signerName}{onBehalfOf ? ` — on behalf of ${onBehalfOf}` : ''}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1 — identity line */}
      <div style={{ display: 'flex', gap: 11, alignItems: 'center', padding: '11px 12px', borderRadius: 12, background: '#eef8f3', border: '1px solid #bfe6d4' }}>
        <span style={{ width: 34, height: 34, flex: 'none', borderRadius: 9, display: 'grid', placeItems: 'center', background: '#fff', border: '1px solid #bfe6d4', color: '#0b7a54' }}>
          <BadgeCheck size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.09em', color: '#6b6860', fontWeight: 700 }}>Signing as {signerRole}</div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', color: '#1a1916', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signerName || '—'}</div>
          {onBehalfOf && <div style={{ fontSize: 11.5, color: '#0b7a54', fontWeight: 600, marginTop: 2 }}>on behalf of {onBehalfOf}</div>}
        </div>
      </div>

      {/* 2 — signature pad */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6b6860', fontWeight: 700 }}>Signature</span>
          <button type="button" onClick={clear} style={{ background: 'none', border: 0, fontSize: 12, color: '#6b6860', cursor: 'pointer' }}>Clear</button>
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 168, border: '1px solid #d8d6d0', borderRadius: 10, background: '#fafaf8', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        />
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
          style={{ width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid #e3e0d9', borderRadius: 10, marginTop: 10, boxSizing: 'border-box' }}
        />
      </div>

      {/* 3 — mandatory terms */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#1a1916', cursor: 'pointer', padding: 12, borderRadius: 11, border: '1px solid #e3e0d9', background: '#f6fbf8' }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
        <span>{termsText} {ESIGN_CONSENT_TEXT}</span>
      </label>

      {/* 4 — sign button */}
      <button
        type="button" onClick={submit} disabled={!canSubmit}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: canSubmit ? '#2e9f82' : '#e3e0d9', color: canSubmit ? '#fff' : '#9b9890', border: 0, borderRadius: 11, padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />} {submitLabel ?? `Sign as ${signerRole}`}
      </button>
      {disabledReason && !err && <p style={{ fontSize: 11.5, color: '#6b6860', margin: '-4px 0 0', textAlign: 'center' }}>{disabledReason}</p>}
      {!disabledReason && !canSubmit && !err && <p style={{ fontSize: 11.5, color: '#6b6860', margin: '-4px 0 0', textAlign: 'center' }}>Draw your signature and tick the box to enable</p>}
      {err && <p style={{ fontSize: 12, color: '#b91c1c', margin: '-4px 0 0' }}>{err}</p>}
    </div>
  );
}
