/**
 * Full-screen preview of the RENTAL FINAL SETTLEMENT, opened from the Ended
 * Leases lifecycle (or anywhere a contract's settlement should be shown as a
 * document). Fetches the live settlement (GET /contracts/:id/settlement) and
 * renders the SAME on-screen document the settlement page shows
 * (<RentalFinalSettlementDoc>) — so every screen that shows a final settlement
 * looks identical. Download saves the matching vector PDF (<RentalFinalSettlementPdf>).
 *
 * Toolbar: Download (PDF) · Documents (separate page) · Open worksheet · close.
 */
'use client';

import { useEffect, useState, createElement } from 'react';
import { X, Loader2, ExternalLink, AlertCircle, Download, FolderOpen } from 'lucide-react';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import { useBackClose } from '@/lib/useSlideOver';
import RentalFinalSettlementDoc, { type RFSData, type RFSPayRow, type RFSBand } from './RentalFinalSettlementDoc';
import type { TFSLinks } from './TenantFinalSettlementDoc';
import ContractDocumentsModal from './ContractDocumentsModal';

interface ApiSettlement {
  depositHeld: number;
  notes: string | null;
  lines: { label: string; amount: number; type: 'deduction' | 'due'; category?: string; net?: number; inspectionContractId?: number }[];
  payments: { amount: number; method: string; reference: string | null; receivedOn: string | null }[];
  status: string;
  rpSignature: string | null;
  tenantSignature: string | null;
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
  statement?: { contract: RFSData['contract']; contractSummary?: RFSPayRow[]; paymentHistory?: RFSBand[] };
}

// Build the shared RFSData the doc consumes — identical mapping to the settlement
// page's buildRfsData (categorized lines, deposit row, payment bands).
function toRfsData(s: ApiSettlement): RFSData | null {
  if (!s.statement) return null;
  return {
    contract: s.statement.contract,
    depositRow: (s.statement.contractSummary ?? []).find(r => r.kind === 'deposit') ?? null,
    paymentHistory: s.statement.paymentHistory ?? [],
    lines: s.lines.map(l => ({
      label: l.label, amount: l.amount, net: l.net ?? l.amount,
      category: l.category ?? 'other', type: l.type, inspectionContractId: l.inspectionContractId,
    })),
    depositHeld: s.depositHeld,
    paymentsReceived: s.payments.map(p => ({ amount: p.amount, method: p.method, reference: p.reference, receivedOn: p.receivedOn })),
    otherAdjustments: 0,
    settlementDate: s.paidAt,
    rpSignature: s.rpSignature,
    tenantSignature: s.tenantSignature,
    rpSignedAt: s.sentAt ?? s.paidAt,
    tenantSignedAt: s.tenantSignature ? (s.agreedAt ?? s.paidAt) : null,
  };
}

export default function SettlementStatementModal({
  contractId, title, onClose, links,
}: { contractId: number; title?: string; onClose: () => void; links?: TFSLinks }) {
  const [data, setData] = useState<RFSData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  // Browser Back closes this full-screen statement instead of navigating away;
  // ESC / backdrop / X route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismiss]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contracts/${contractId}/settlement`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const s = await res.json() as ApiSettlement;
        if (cancelled) return;
        const rfs = toRfsData(s);
        if (!rfs) { setError('This settlement has no statement data.'); return; }
        setData(rfs);
      } catch {
        if (!cancelled) setError('Failed to load the settlement statement.');
      }
    })();
    return () => { cancelled = true; };
  }, [contractId]);

  async function download() {
    if (!data) return;
    setDownloading(true);
    try {
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./RentalFinalSettlementPdf'),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, `Final-settlement-${data.contract.contractNo || `CID-${contractId}`}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort */ }
    finally { setDownloading(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm overflow-y-auto" onClick={dismiss}>
        <div className="max-w-5xl mx-auto my-6 px-4" onClick={e => e.stopPropagation()}>
          {/* Toolbar — green header */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#047246] text-white rounded-t-2xl px-5 py-3 shadow-lg">
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">{title || 'Final Settlement Statement'}</div>
              <div className="text-[11px] text-white/70">Contract #{contractId}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={download} disabled={!data || downloading}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white text-[#1a7a5a] hover:bg-white/90 disabled:opacity-60 transition-colors">
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download
              </button>
              <button onClick={() => setShowDocs(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors">
                <FolderOpen size={13} /> View Documents
              </button>
              {links?.worksheet && (
                <a href={links.worksheet} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors">
                  <ExternalLink size={13} /> Open worksheet
                </a>
              )}
              <button onClick={dismiss} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Close"><X size={18} /></button>
            </div>
          </div>

          {/* Body — the same on-screen final-settlement document as the page. */}
          <div className="rounded-b-2xl overflow-hidden">
            {error ? (
              <div className="bg-white p-10 flex flex-col items-center gap-2 text-center">
                <AlertCircle size={22} className="text-[#b91c1c]" />
                <p className="text-sm text-[#5f6b63]">{error}</p>
              </div>
            ) : !data ? (
              <div className="bg-white p-16 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-[#047246]" /></div>
            ) : (
              <RentalFinalSettlementDoc data={data} />
            )}
          </div>
        </div>
      </div>

      {showDocs && <ContractDocumentsModal contractId={contractId} onClose={() => setShowDocs(false)} />}
    </>
  );
}
