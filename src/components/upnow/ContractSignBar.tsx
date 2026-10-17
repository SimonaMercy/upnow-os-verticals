'use client';

/**
 * Sticky "sign menu" docked to the bottom of the viewport while a signer reviews
 * a contract's documents. Collapsed, it's a single bar with the signer role + a
 * "Sign" CTA; expanded, it slides up a sheet containing the shared SignatureBlock
 * (identity line → pad → mandatory terms → sign). Used in two places with the
 * same UX:
 *   - the RP's authenticated documents page (signs as landlord via the app API)
 *   - the landlord's no-login magic-link page (signs via the portal API)
 * The caller supplies the actual submit via `onSign`, so this stays transport-
 * agnostic; it only owns the sticky-bar chrome. All the capture (pad, name,
 * consent) lives in SignatureBlock so every signing surface looks identical.
 */
import { useState } from 'react';
import { PenLine, CheckCircle2, X } from 'lucide-react';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';

export function ContractSignBar({
  signerRole = 'Landlord',
  signerName,
  onBehalfOf,
  defaultName = '',
  alreadySigned,
  onSign,
  reviewNote,
  confirmText,
  inline = false,
  submitLabel,
}: {
  /** Party label shown on the bar, e.g. "Landlord". */
  signerRole?: string;
  /** Who is signing (company / person), shown under "Signing as". */
  signerName?: string | null;
  /** When set, the signer acts under POA — shows an "on behalf of {B}" line. */
  onBehalfOf?: string | null;
  /** Pre-fills the typed-name field. */
  defaultName?: string;
  /** When true the bar shows a completed state and offers no action. */
  alreadySigned: boolean;
  /** Persist the signature. Throw to surface an error in the sheet. */
  onSign: (payload: { signatureImage: string; signatoryName: string }) => Promise<void>;
  /** Optional line above the pad (e.g. "You've reviewed every document"). */
  reviewNote?: string;
  /** The confirm sentence shown before the e-sign consent (defaults to the
   *  tenancy-contract wording). Use for other signed docs (e.g. settlement). */
  confirmText?: string;
  /** Render the SignatureBlock INLINE (in normal flow, below the form) instead of
   *  a sticky bottom bar + pop-up sheet. */
  inline?: boolean;
  /** Label for the submit button (defaults to "Sign contract"). */
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  const termsText = confirmText ?? `I have reviewed all the documents above and agree to execute this contract as the ${signerRole.toLowerCase()}.`;

  // SignatureBlock produces the full evidence payload; this bar's callers only
  // need { signatureImage, signatoryName } (they attach their own consent/geo),
  // so narrow it here. On success, flip the bar to its completed state.
  const handleSign = async (p: SignaturePayload) => {
    await onSign({ signatureImage: p.signatureImage, signatoryName: p.signatoryName });
    setDone(true);
    setOpen(false);
  };

  const signed = alreadySigned || done;

  const body = (
    <>
      {reviewNote && <p style={{ fontSize: 12.5, color: '#5f6b63', margin: '0 0 10px' }}>{reviewNote}</p>}
      <SignatureBlock
        signerRole={signerRole}
        signerName={signerName}
        onBehalfOf={onBehalfOf}
        defaultName={defaultName}
        termsText={termsText}
        submitLabel={submitLabel ?? 'Sign contract'}
        alreadySigned={false}
        onSign={handleSign}
      />
    </>
  );

  // Inline mode: SignatureBlock in normal flow (below the form).
  if (inline) {
    if (signed) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecf7f1', border: '1px solid #bfe3d6', borderRadius: 16, padding: '14px 18px' }}>
          <CheckCircle2 size={18} style={{ color: '#16a34a', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#14201a' }}>Signed as {signerRole}</div>
            {signerName && <div style={{ fontSize: 12, color: '#5f6b63' }}>{signerName}{onBehalfOf ? ` — on behalf of ${onBehalfOf}` : ''}</div>}
          </div>
        </div>
      );
    }
    return (
      <div style={{ background: '#fff', border: '1px solid #e3e0d9', borderRadius: 16, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, fontWeight: 800, color: '#14201a', marginBottom: 12 }}>
          <PenLine size={16} style={{ color: '#047246' }} /> Sign as {signerRole}
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
            padding: 16, maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#14201a' }}>Sign as {signerRole}</span>
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: 'none', border: 0, cursor: 'pointer', color: '#8a948d', padding: 4 }}><X size={18} /></button>
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
          <div style={{ fontSize: 13, fontWeight: 700, color: '#14201a', display: 'flex', alignItems: 'center', gap: 7 }}>
            {signed ? <CheckCircle2 size={16} style={{ color: '#16a34a' }} /> : <PenLine size={16} style={{ color: '#047246' }} />}
            {signed ? `Signed as ${signerRole}` : `Sign as ${signerRole}`}
          </div>
          {signerName && (
            <div style={{ fontSize: 11.5, color: '#5f6b63', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{signerName}{onBehalfOf ? ` — on behalf of ${onBehalfOf}` : ''}</div>
          )}
        </div>
        {!signed && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#047246', color: '#fff', border: 0, borderRadius: 10, padding: '10px 20px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            <PenLine size={15} /> {open ? 'Hide' : `Sign as ${signerRole}`}
          </button>
        )}
      </div>
    </>
  );
}
