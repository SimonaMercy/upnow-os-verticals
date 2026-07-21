'use client';

/**
 * Sticky "sign menu" docked to the bottom of the viewport while a signer reviews
 * a contract's documents. Collapsed, it's a single bar with the signer role + a
 * "Sign" CTA; expanded, it slides up a sheet with a name field and a signature
 * pad. Used in two places with the same UX:
 *   - the RP's authenticated documents page (signs as landlord via the app API)
 *   - the landlord's no-login magic-link page (signs via the portal API)
 * The caller supplies the actual submit via `onSign`, so this stays transport-
 * agnostic; it only owns the capture + state.
 */
import { useEffect, useRef, useState } from 'react';
import { PenLine, CheckCircle2, Loader2, X } from 'lucide-react';
import { ESIGN_CONSENT_TEXT } from '@/lib/signEvidence';

export function ContractSignBar({
  signerRole = 'Landlord',
  signerName,
  defaultName = '',
  alreadySigned,
  onSign,
  reviewNote,
  requireConfirm = true,
  confirmText,
  inline = false,
  submitLabel,
}: {
  /** Party label shown on the bar, e.g. "Landlord". */
  signerRole?: string;
  /** Who is signing (company / person), shown under "Signing as". */
  signerName?: string | null;
  /** Pre-fills the typed-name field. */
  defaultName?: string;
  /** When true the bar shows a completed state and offers no action. */
  alreadySigned: boolean;
  /** Persist the signature. Throw to surface an error in the sheet. */
  onSign: (payload: { signatureImage: string; signatoryName: string }) => Promise<void>;
  /** Optional line above the pad (e.g. "You've reviewed every document"). */
  reviewNote?: string;
  /** Require the "I have reviewed…" checkbox before signing. */
  requireConfirm?: boolean;
  /** Overrides the confirm sentence before ESIGN_CONSENT_TEXT (defaults to the
   *  tenancy-contract wording). Use for other signed docs (e.g. settlement). */
  confirmText?: string;
  /** Render the consent + signature pad INLINE (in normal flow, below the form)
   *  instead of a sticky bottom bar + pop-up sheet. */
  inline?: boolean;
  /** Label for the submit button (defaults to "Sign contract"). */
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [agreed, setAgreed] = useState(!requireConfirm);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the pad's backing store to its CSS box × DPR so strokes stay crisp and
  // un-squashed; refit on resize/rotate (which also clears it).
  useEffect(() => {
    if (!open && !inline) return;
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const r = c.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty.current = false;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, inline]);

  const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.strokeStyle = '#1a1916'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = canvasRef.current!; const ctx = c.getContext('2d')!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); dirty.current = false; };

  const submit = async () => {
    if (requireConfirm && !agreed) { setErr('Please confirm you have reviewed the documents above.'); return; }
    if (!dirty.current) { setErr('Please draw your signature.'); return; }
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    setBusy(true); setErr(null);
    try {
      const signatureImage = canvasRef.current!.toDataURL('image/png');
      await onSign({ signatureImage, signatoryName: name.trim() });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign');
    } finally { setBusy(false); }
  };

  const signed = alreadySigned || done;

  // Shared consent + signature-pad body — used both inline and in the pop-up sheet.
  const body = (
    <>
      {reviewNote && <p style={{ fontSize: 12.5, color: '#6b6860', margin: '0 0 10px' }}>{reviewNote}</p>}
      {requireConfirm && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#1a1916', cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
          <span>{confirmText ?? `I have reviewed all the documents above and agree to execute this contract as the ${signerRole.toLowerCase()}.`} {ESIGN_CONSENT_TEXT}</span>
        </label>
      )}
      <input
        value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
        style={{ width: '100%', fontSize: 14, padding: '9px 11px', border: '1px solid #e3e0d9', borderRadius: 10, marginBottom: 10, boxSizing: 'border-box' }}
      />
      <p style={{ fontSize: 11.5, color: '#6b6860', margin: '0 0 4px' }}>Draw your signature</p>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 168, border: '1px solid #d8d6d0', borderRadius: 10, background: '#fafaf8', touchAction: 'none', cursor: 'crosshair', display: 'block' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <button onClick={clear} style={{ background: 'none', border: 0, fontSize: 12, color: '#6b6860', cursor: 'pointer' }}>Clear</button>
        <button
          onClick={submit} disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2e9f82', color: '#fff', border: 0, borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {submitLabel ?? 'Sign contract'}
        </button>
      </div>
      {err && <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 8 }}>{err}</p>}
    </>
  );

  // Inline mode: consent + signature pad in normal flow (below the form).
  if (inline) {
    if (signed) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecf7f1', border: '1px solid #bfe3d6', borderRadius: 16, padding: '14px 18px' }}>
          <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1a1916' }}>Signed as {signerRole}</div>
            {signerName && <div style={{ fontSize: 12, color: '#6b6860' }}>{signerName}</div>}
          </div>
        </div>
      );
    }
    return (
      <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 800, color: '#1a1916', marginBottom: 12 }}>
          <PenLine size={16} style={{ color: '#2e9f82' }} /> Sign as {signerRole}
        </div>
        {body}
      </div>
    );
  }

  return (
    <>
      {/* Expanding sheet (above the bar) */}
      {open && !signed && (
        <div
          role="dialog"
          aria-label={`Sign as ${signerRole}`}
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 64, zIndex: 1001,
            display: 'flex', justifyContent: 'center', padding: '0 12px',
          }}
        >
          <div style={{
            width: '100%', maxWidth: 560, background: '#fff', borderRadius: 16,
            border: '1px solid #e3e0d9', boxShadow: '0 18px 50px rgba(20,18,15,.22)',
            padding: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1916' }}>Sign as {signerRole}</span>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 0, cursor: 'pointer', color: '#9b9890', padding: 4 }}><X size={18} /></button>
            </div>
            {body}
          </div>
        </div>
      )}

      {/* Backdrop while the sheet is open */}
      {open && !signed && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', zIndex: 1000 }} />
      )}

      {/* The sticky bar itself */}
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1001,
        background: signed ? '#ecf7f1' : '#fff',
        borderTop: `1px solid ${signed ? '#bfe3d6' : '#e3e0d9'}`,
        boxShadow: '0 -8px 24px rgba(20,18,15,.10)',
        padding: '10px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1916', display: 'flex', alignItems: 'center', gap: 7 }}>
            {signed ? <CheckCircle2 size={16} style={{ color: '#16a34a' }} /> : <PenLine size={16} style={{ color: '#2e9f82' }} />}
            {signed ? `Signed as ${signerRole}` : `Sign as ${signerRole}`}
          </div>
          {signerName && (
            <div style={{ fontSize: 11.5, color: '#6b6860', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signerName}</div>
          )}
        </div>
        {!signed && (
          <button
            onClick={() => { setOpen(o => !o); setErr(null); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#2e9f82', color: '#fff', border: 0, borderRadius: 10, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <PenLine size={15} /> {open ? 'Hide' : `Sign as ${signerRole}`}
          </button>
        )}
      </div>
    </>
  );
}
