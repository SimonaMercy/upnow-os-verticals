'use client';
/* Split verbatim out of ../page.tsx (lease detail v2) — behaviour unchanged. */
import { useState } from 'react';
import { FileSignature, X } from 'lucide-react';
import { SignatureBlock, type SignaturePayload } from '@/components/upnow/SignatureBlock';
import { ContractDetail } from './shared';


// ────────────────────────────────────────────────────────────────────────────
// Modals + signing (shared SignatureBlock)
// ────────────────────────────────────────────────────────────────────────────

/** Collapsible DocuSign-style signing audit trail: per-signature evidence
 *  (channel, IP, device, consent, terms hash) + the envelope event history,
 *  with a one-click "Certificate (PDF)" download. Fetches lazily on expand. */
export function SignatureAuditTrail({ contractId }: { contractId: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<import('@/components/upnow/SignatureCertificatePdf').SignatureCertificateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dl, setDl] = useState(false);

  const load = async () => {
    if (data || loading) return;
    setLoading(true);
    try {
      const { fetchSignatureCertificate } = await import('@/components/upnow/SignatureCertificatePdf');
      setData(await fetchSignatureCertificate(contractId));
    } finally { setLoading(false); }
  };

  const download = async () => {
    if (!data || dl) return;
    setDl(true);
    try {
      const [{ pdf }, mod] = await Promise.all([import('@react-pdf/renderer'), import('@/components/upnow/SignatureCertificatePdf')]);
      const blob = await pdf(<mod.SignatureCertificateDoc data={data} refLabel={`CID-${contractId}`} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `Signature-certificate-CID-${contractId}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally { setDl(false); }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button className="ca" style={{ padding: 0 }} onClick={() => { setOpen(o => !o); if (!open) void load(); }}>
        {open ? '▾ Hide signing audit trail' : '▸ View signing audit trail'}
      </button>
      {open && (
        <div style={{ marginTop: 8, border: '1px solid var(--edge, #e3e0d9)', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>
          {loading && <span className="note">Loading…</span>}
          {!loading && data && (
            <>
              {data.signatures.map(sig => {
                const mod = { // labels kept inline to avoid a client import at render time
                  rp_dashboard: 'UpNow dashboard', customer_dashboard: 'Customer dashboard',
                  tenant_portal: 'Emailed signing link (tenant)', landlord_link: 'Emailed signing link (landlord)',
                  on_file: 'On file (paper / imported)',
                } as Record<string, string>;
                const when = new Date(sig.signedAt).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
                return (
                  <div key={sig.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--mist, #f0ede7)' }}>
                    <strong style={{ textTransform: 'capitalize' }}>{sig.role}</strong> — {sig.signatoryName ?? '—'} · {when} GST
                    <div className="note" style={{ marginTop: 2 }}>
                      {[mod[sig.signedVia ?? ''] ?? (sig.method === 'on_file' ? mod.on_file : 'Legacy signature (pre-audit)'),
                        sig.ipAddress ? `IP ${sig.ipAddress}` : null,
                        sig.signerEmail,
                        sig.consentGiven ? 'e-sign consent ✓' : null,
                        sig.termsHash ? `terms #${sig.termsHash.slice(0, 12)}…` : null,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                );
              })}
              {data.events.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {data.events.map(e => (
                    <div key={e.id} className="note" style={{ padding: '2px 0' }}>
                      {new Date(e.at).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} —{' '}
                      {({ link_sent: 'Signing link emailed', link_opened: 'Link opened', contract_viewed: 'Contract reviewed', signed: 'Signature executed', addendum_signed: 'Addendum signed', on_file_marked: 'Marked signed on file' } as Record<string, string>)[e.event] ?? e.event}
                      {e.role ? ` (${e.role})` : ''}{e.ipAddress ? ` · ${e.ipAddress}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {data.signatures.length > 0 && (
                <button className="ca" style={{ padding: 0, marginTop: 8 }} onClick={download} disabled={dl}>
                  {dl ? 'Preparing…' : '⬇ Download signature certificate (PDF)'}
                </button>
              )}
              {data.signatures.length === 0 && data.events.length === 0 && <span className="note">No signing activity recorded yet.</span>}
            </>
          )}
          {!loading && !data && <span className="note">Audit trail unavailable.</span>}
        </div>
      )}
    </div>
  );
}

/** Maps a SignatureBlock payload to the /contracts/:id/sign landlord API call. */
export async function submitLandlordSignature(contractId: number, fallbackName: string, p: SignaturePayload) {
  const res = await fetch(`/api/contracts/${contractId}/sign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'landlord',
      signatoryName: p.signatoryName || fallbackName || 'Landlord',
      method: 'online',
      signatureImage: p.signatureImage,
      consent: p.consent,
      clientMeta: p.clientMeta,
      geo: p.geo,
    }),
  });
  if (!res.ok) throw new Error(`Sign failed: ${res.status}`);
}

export function InlineLandlordSign({ contract, signerName, onBehalfOf, onSigned }: {
  contract: ContractDetail; signerName: string; onBehalfOf?: string | null; onSigned: () => void;
}) {
  const fallbackName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #14201a)' }}>Sign this contract</div>
          <div className="note">Add your landlord signature below to countersign — no extra steps.</div>
        </div>
      </div>
      <SignatureBlock
        signerRole="Landlord"
        signerName={signerName}
        onBehalfOf={onBehalfOf}
        defaultName={signerName}
        termsText="I have reviewed this contract and agree to execute it as the landlord."
        submitLabel="Sign as Landlord"
        alreadySigned={false}
        onSign={async (p) => { await submitLandlordSignature(contract.id, fallbackName, p); onSigned(); }}
      />
    </div>
  );
}

/** Inline RP counter-signature for the move-in / move-out inspection — shown on
 *  the step card once the customer has signed, so the landlord doesn't have to
 *  open the inspection workspace just to countersign. Move-in auto-activates. */
export function InlineInspectionCounterSign({ contractId, type, signerName, onBehalfOf, onSigned }: {
  contractId: number; type: 'move_in' | 'move_out'; signerName: string; onBehalfOf?: string | null; onSigned: () => void;
}) {
  const moveLabel = type === 'move_out' ? 'move-out' : 'move-in';
  const signInspection = async (p: SignaturePayload) => {
    const res = await fetch(`/api/contracts/${contractId}/inspection/sign?type=${type}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage: p.signatureImage, signatoryName: p.signatoryName, consent: p.consent, clientMeta: p.clientMeta, geo: p.geo }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new Error(d?.message ?? `Sign failed: ${res.status}`);
    }
    onSigned();
  };

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--jade-edge, #bfe3d6)', borderRadius: 'var(--r-lg)', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={16} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink, #14201a)' }}>Sign the inspection</div>
          <div className="note">
            {type === 'move_in'
              ? 'The customer has signed — add your signature to complete move-in and activate the tenancy.'
              : 'The customer has signed — add your signature to complete the move-out inspection.'}
          </div>
        </div>
      </div>
      <SignatureBlock
        signerRole="Landlord"
        signerName={signerName}
        onBehalfOf={onBehalfOf}
        defaultName={signerName}
        termsText={`I confirm the condition recorded in this ${moveLabel} inspection is accurate.`}
        submitLabel="Sign inspection"
        alreadySigned={false}
        onSign={signInspection}
      />
    </div>
  );
}

export function SignModal({
  contract, signerName, onBehalfOf, onClose, onSigned,
}: { contract: ContractDetail; signerName: string; onBehalfOf?: string | null; onClose: () => void; onSigned: () => void }) {
  const fallbackName = contract.landlord.companyName || contract.landlord.name || 'Landlord';
  return (
    <div className="mscrim" onClick={onClose}>
      <div className="modal sm" onClick={e => e.stopPropagation()}>
        <div className="mh">
          <span className="mt">
            <span className="mti" style={{ background: 'var(--jade)' }}><FileSignature size={17} /></span>
            Sign contract
          </span>
          <button className="x" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="mb">
          <SignatureBlock
            signerRole="Landlord"
            signerName={signerName}
            onBehalfOf={onBehalfOf}
            defaultName={signerName}
            termsText="I have reviewed this contract and agree to execute it as the landlord."
            submitLabel="Sign as Landlord"
            alreadySigned={false}
            onSign={async (p) => { await submitLandlordSignature(contract.id, fallbackName, p); onClose(); onSigned(); }}
          />
        </div>
      </div>
    </div>
  );
}
