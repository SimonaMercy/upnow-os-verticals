/**
 * Full-screen preview of the Tenant Final Settlement statement, opened from the
 * Ended Leases lifecycle (or anywhere a contract's settlement should be shown as
 * a document). Fetches the live settlement (GET /contracts/:id/settlement) and
 * renders <TenantFinalSettlementDoc> with cross-check links on each line item.
 *
 * Toolbar: Download (PDF) · Documents (separate page) · Open worksheet · close.
 */
'use client';

import { useEffect, useState, createElement } from 'react';
import { X, Loader2, ExternalLink, AlertCircle, Download, FolderOpen } from 'lucide-react';
import { triggerBrowserDownload } from '@/lib/downloadDoc';
import TenantFinalSettlementDoc, { type TFSDocData, type TFSContract, type TFSRow, type TFSRent, type TFSLinks } from './TenantFinalSettlementDoc';
import ContractDocumentsModal from './ContractDocumentsModal';

interface ApiSettlement {
  depositHeld: number;
  notes: string | null;
  lines: { label: string; amount: number; type: 'deduction' | 'due' }[];
  payments: { amount: number; method: string; reference: string | null; receivedOn: string | null }[];
  chargesTotal: number;
  paymentsReceivedTotal: number;
  balance: number;
  refundAmount: number | null;
  rpSignature: string | null;
  tenantSignature: string | null;
  status: string;
  paidAt: string | null;
  statement?: { contract: TFSContract; contractSummary: TFSRow[]; rent: TFSRent };
}

export default function SettlementStatementModal({
  contractId, title, onClose, links,
}: { contractId: number; title?: string; onClose: () => void; links?: TFSLinks }) {
  const [raw, setRaw] = useState<ApiSettlement | null>(null);
  const [data, setData] = useState<TFSDocData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contracts/${contractId}/settlement`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const s = await res.json() as ApiSettlement;
        if (cancelled) return;
        if (!s.statement) { setError('This settlement has no statement data.'); return; }
        setRaw(s);
        setData({
          contract: s.statement.contract,
          contractSummary: s.statement.contractSummary,
          rent: s.statement.rent,
          depositHeld: s.depositHeld,
          lines: s.lines.map(l => ({ label: l.label, amount: l.amount, type: l.type })),
          chargesTotal: s.chargesTotal,
          payments: s.payments.map(p => ({ amount: p.amount, method: p.method, reference: p.reference, receivedOn: p.receivedOn })),
          paymentsReceivedTotal: s.paymentsReceivedTotal,
          balance: s.balance,
          notes: s.notes,
          status: s.status,
          settlementDate: s.paidAt,
        });
      } catch {
        if (!cancelled) setError('Failed to load the settlement statement.');
      }
    })();
    return () => { cancelled = true; };
  }, [contractId]);

  async function download() {
    if (!raw?.statement) return;
    setDownloading(true);
    try {
      const c = raw.statement.contract;
      const [{ pdf }, mod] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./DepositSettlementPdf'),
      ]);
      const pdfData = {
        ref: c.contractNo || `CID-${contractId}`,
        property: c.buildingName || c.propertyAddress, unit: c.unit, tenantName: c.tenantName,
        depositHeld: raw.depositHeld, lines: raw.lines, chargesTotal: raw.chargesTotal,
        refundAmount: raw.refundAmount, payments: raw.payments,
        paymentsReceivedTotal: raw.paymentsReceivedTotal, balance: raw.balance,
        paidAt: raw.paidAt, rpSignature: raw.rpSignature, tenantSignature: raw.tenantSignature, notes: raw.notes,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(createElement(mod.default, { data: pdfData as any }) as any).toBlob();
      const url = URL.createObjectURL(blob);
      triggerBrowserDownload(url, `Final-settlement-${pdfData.ref}.pdf`);
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch { /* best-effort */ }
    finally { setDownloading(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
        <div className="max-w-5xl mx-auto my-6 px-4" onClick={e => e.stopPropagation()}>
          {/* Toolbar — green header */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#2e9f82] text-white rounded-t-2xl px-5 py-3 shadow-lg">
            <div className="min-w-0">
              <div className="text-sm font-bold truncate">{title || 'Final Settlement Statement'}</div>
              <div className="text-[11px] text-white/70">Contract #{contractId}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={download} disabled={!raw || downloading}
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
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Close"><X size={18} /></button>
            </div>
          </div>

          {/* Body */}
          <div className="rounded-b-2xl overflow-hidden">
            {error ? (
              <div className="bg-white p-10 flex flex-col items-center gap-2 text-center">
                <AlertCircle size={22} className="text-[#b91c1c]" />
                <p className="text-sm text-[#6b6860]">{error}</p>
              </div>
            ) : !data ? (
              <div className="bg-white p-16 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-[#2e9f82]" /></div>
            ) : (
              <TenantFinalSettlementDoc data={data} links={links} />
            )}
          </div>
        </div>
      </div>

      {showDocs && <ContractDocumentsModal contractId={contractId} onClose={() => setShowDocs(false)} />}
    </>
  );
}
