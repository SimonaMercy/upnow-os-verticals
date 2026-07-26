'use client';

/**
 * No-login CUSTOMER settlement-signing page (magic link, purpose='settlement').
 *
 * Mirrors the tenancy-contract portal flow: the customer reviews the FINAL
 * SETTLEMENT statement (the same document the RP sees), then consents + signs
 * via <ContractSignBar> (form → consent → signature). Token-scoped: it only ever
 * loads/signs the settlement the link was issued for, and only once the RP has
 * sent it (the backend returns null while it's still a draft).
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ContractSignBar } from '@/components/upnow/ContractSignBar';
import { collectClientMeta } from '@/lib/signEvidence';
import RentalFinalSettlementDoc, { type RFSData, type RFSPayRow, type RFSBand } from '@/components/contract/RentalFinalSettlementDoc';

interface PortalSettlement {
  status: 'draft' | 'sent' | 'agreed' | 'paid';
  depositHeld: number;
  detailedLines?: { label: string; amount: number; type: 'deduction' | 'due'; category?: string; net?: number; inspectionContractId?: number }[];
  payments?: { amount: number; method: string; reference: string | null; receivedOn: string | null }[];
  rpSignature: string | null;
  tenantSignature: string | null;
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
  statement?: { contract: RFSData['contract']; contractSummary?: RFSPayRow[]; paymentHistory?: RFSBand[] };
}

function toRfsData(s: PortalSettlement): RFSData | null {
  if (!s.statement) return null;
  return {
    contract: s.statement.contract,
    depositRow: (s.statement.contractSummary ?? []).find(r => r.kind === 'deposit') ?? null,
    paymentHistory: s.statement.paymentHistory ?? [],
    lines: (s.detailedLines ?? []).map(l => ({
      label: l.label, amount: l.amount, net: l.net ?? l.amount,
      category: l.category ?? 'other', type: l.type, inspectionContractId: l.inspectionContractId,
    })),
    depositHeld: s.depositHeld,
    paymentsReceived: (s.payments ?? []).map(p => ({ amount: p.amount, method: p.method, reference: p.reference, receivedOn: p.receivedOn })),
    otherAdjustments: 0,
    settlementDate: s.paidAt,
    rpSignature: s.rpSignature,
    tenantSignature: s.tenantSignature,
    rpSignedAt: s.sentAt ?? s.paidAt,
    tenantSignedAt: s.tenantSignature ? (s.agreedAt ?? s.paidAt) : null,
  };
}

export default function PortalSettlementPage() {
  const params = useParams<{ token: string; id: string }>();
  const token = params?.token;
  const id = params?.id;
  const [raw, setRaw] = useState<PortalSettlement | null>(null);
  const [data, setData] = useState<RFSData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const res = await fetch(`/api/portal/${token}/contracts/${id}/settlement`);
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? `Error ${res.status}`); }
      const s = await res.json() as PortalSettlement | null;
      if (!s) { setError("This settlement isn't ready to sign yet — your rental provider will send it once it's finalised."); return; }
      setRaw(s);
      const rfs = toRfsData(s);
      if (!rfs) { setError('This settlement has no statement to display.'); return; }
      setData(rfs);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the settlement.'); }
    finally { setLoading(false); }
  }, [token, id]);

  useEffect(() => { void load(); }, [load]);

  const agree = async ({ signatureImage }: { signatureImage: string; signatoryName: string }) => {
    const res = await fetch(`/api/portal/${token}/contracts/${id}/settlement/agree`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureImage, consent: true, clientMeta: collectClientMeta() }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.message ?? 'Could not submit your signature'); }
    await load();
  };

  const signed = !!raw && (raw.status === 'agreed' || raw.status === 'paid' || !!raw.tenantSignature);

  return (
    <div style={{ minHeight: '100vh', background: '#f4f3ef' }}>
      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e8e6e0', padding: '14px 20px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: '#2e9f82', color: '#fff', fontWeight: 800, fontSize: 15 }}>U</span>
          <span style={{ fontWeight: 800, fontSize: 17, color: '#0e1a16' }}>UpNow</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9b9890' }}>Final Settlement</span>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 48px' }}>
        {loading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: '80px 0', color: '#6b6860' }}>
            <Loader2 className="animate-spin" size={26} /> <span style={{ marginTop: 10, fontSize: 13 }}>Loading your settlement…</span>
          </div>
        ) : error ? (
          <div style={{ background: '#fff', border: '1px solid #e8e6e0', borderRadius: 16, padding: 32, textAlign: 'center' }}>
            <AlertTriangle size={24} style={{ color: '#c2410c' }} />
            <p style={{ marginTop: 10, fontSize: 14, color: '#4a4842' }}>{error}</p>
          </div>
        ) : data ? (
          <>
            {signed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f0faf6', border: '1px solid #c5e8df', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
                <CheckCircle2 size={18} style={{ color: '#1a7a5a' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a7a5a' }}>You&apos;ve signed this settlement. Thank you — no further action is needed.</span>
              </div>
            )}
            {!signed && (
              <p style={{ fontSize: 13, color: '#6b6860', margin: '0 0 14px' }}>
                Please review your final settlement statement below, then confirm and sign at the bottom.
              </p>
            )}

            <RentalFinalSettlementDoc data={data} />

            <div style={{ marginTop: 20 }}>
              <ContractSignBar
                inline
                signerRole="Customer"
                signerName={data.contract.tenantName ?? null}
                defaultName={data.contract.tenantName ?? ''}
                alreadySigned={signed}
                confirmText="I have reviewed the final settlement statement above and agree to it as the customer."
                submitLabel="Agree & sign"
                onSign={agree}
              />
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
