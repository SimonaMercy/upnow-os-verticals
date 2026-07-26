'use client';

/**
 * DepositDetailModal — the "big popup" opened from a security-deposit row on the
 * RP and manager Deposits pages. Shows, in one place:
 *   • the deposit summary + status
 *   • move-in & move-out — attached photos when present, otherwise a
 *     system-generated condition summary (Good / Fair / Damaged per item)
 *   • the deposit documents: cheque copy, receipt, attachments
 *   • the final settlement (charges, payments, refund/owe) + any attachments
 *
 * Presentational + self-contained: the host page supplies `loadDetail` (RP uses
 * fetch, manager uses apiGet) and, for the RP, the action `links`. Manager
 * passes `links={null}` → read-only (no contract / settle / receipt navigation,
 * matching the manager portal's read-only deposits view).
 *
 * The move-in/out, settlement and document blocks are shared with the
 * Ended-Leases popup — see ./leaseLifecycleSections.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X, FileText, ExternalLink, Loader2, Receipt, Wallet, AlertCircle,
} from 'lucide-react';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';
import { useBackClose } from '@/lib/useSlideOver';
import {
  fmtAed, SectionTitle, DetailCol, InspectionSection, DocsBucket, SettlementLines,
  type ProofDoc, type InspectionView, type SettlementView,
} from './leaseLifecycleSections';

// Re-export the shared lifecycle types so existing importers of this module keep working.
export type { ProofDoc, InspectionView, SettlementView } from './leaseLifecycleSections';

export type DepositStatus = 'held' | 'returned' | 'partial_return' | 'forfeited';

const STATUS_LABELS: Record<DepositStatus, string> = {
  held: 'Held', returned: 'Returned', partial_return: 'Partial Return', forfeited: 'Forfeited',
};
const STATUS_STYLE: Record<DepositStatus, string> = {
  held: 'bg-[#d8f2e8] text-[#1a7a5a]',
  returned: 'bg-[#dbeafe] text-[#1e40af]',
  partial_return: 'bg-[#fef3c7] text-[#92400e]',
  forfeited: 'bg-[#fee2e2] text-[#b91c1c]',
};

export interface DepositRow {
  id: string;
  depositRef: string;
  contractRef: string;
  contractId: number | null;
  currentContractId?: number | null;
  tenant: string;
  building: string;
  unit: string;
  amount: number;
  amountReceipt: number | null;
  recordedDate: string | null;
  status: DepositStatus;
  notes: string | null;
  settledRefundAmount?: number | null;
  settledDeductionAmount?: number | null;
  settledOn?: string | null;
  settledViaSettlementId?: number | null;
}

export interface DepositDetail {
  id: string;
  chequeNumber: string | null;
  nameOnCheck: string | null;
  paymentMethod: string | null;
  chequeStatus: string | null;
  dueDate: string | null;
  documents: { cheque: ProofDoc[]; receipt: ProofDoc[]; bank: ProofDoc[]; attachment: ProofDoc[] };
  moveIn: InspectionView | null;
  moveOut: InspectionView | null;
  settlement: SettlementView | null;
  settlementAttachments: ProofDoc[];
  receiptContractId: number | null;
}

export interface DepositDetailLinks {
  contract?: (id: number) => string;
  settlement?: (id: number) => string;
  receipt?: (id: number) => string;
}

interface Props {
  deposit: DepositRow;
  loadDetail: (id: string) => Promise<DepositDetail>;
  onClose: () => void;
  /** RP action links. Pass null for the read-only (manager) view. */
  links?: DepositDetailLinks | null;
}

function SettlementBlock({ deposit, detail, links }: { deposit: DepositRow; detail: DepositDetail; links?: DepositDetailLinks | null }) {
  const s = detail.settlement;
  const settleHref = (deposit.currentContractId ?? deposit.contractId) ?? null;

  if (s) {
    return (
      <SettlementLines
        s={s}
        attachments={detail.settlementAttachments}
        openHref={links?.settlement && settleHref != null ? links.settlement(s.contractId ?? settleHref) : null}
      />
    );
  }

  // No settlement record yet — mirror the deposit's outcome / settle CTA.
  const outcomeLine = (
    <p className="text-xs text-[#6b6860] mt-0.5">
      Refunded {fmtAed(deposit.settledRefundAmount ?? 0)} · deducted {fmtAed(deposit.settledDeductionAmount ?? 0)}{deposit.settledOn ? ` · ${deposit.settledOn}` : ''}
    </p>
  );
  if (deposit.status !== 'held') {
    return (
      <div className="border border-[#e8e6e0] rounded-xl p-3">
        <p className="text-sm font-semibold text-[#1a1916]">{STATUS_LABELS[deposit.status] ?? deposit.status}</p>
        {outcomeLine}
        {links?.settlement && settleHref != null && deposit.id.startsWith('sd_') && (
          <a href={links.settlement(settleHref)} className="text-xs text-[#2e9f82] font-medium hover:underline mt-1 inline-flex items-center gap-1">
            <ExternalLink size={11} /> Open settlement
          </a>
        )}
      </div>
    );
  }
  if (deposit.id.startsWith('sd_') && settleHref != null) {
    return (
      <div className="border border-[#e8e6e0] rounded-xl p-3">
        <p className="text-xs text-[#6b6860] mb-2.5">Not settled yet. Settle this deposit on the lease&rsquo;s move-out settlement — capture the refund vs. deduction with itemised charges and the customer&rsquo;s agreement, so the deposit and your reports stay in sync.</p>
        {links?.settlement ? (
          <a href={links.settlement(settleHref)} className="inline-flex items-center justify-center gap-1.5 w-full bg-[#2e9f82] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#28886f]">
            Settle deposit <ExternalLink size={13} />
          </a>
        ) : (
          <p className="text-[11px] text-[#9b9890]">Settlement is managed by the landlord.</p>
        )}
      </div>
    );
  }
  return (
    <div className="bg-[#f4f3ef] rounded-xl p-3">
      <p className="text-xs text-[#6b6860]">This deposit is recorded as a payment — its status follows the cheque (cleared / bounced) and isn&rsquo;t settled separately.</p>
    </div>
  );
}

export default function DepositDetailModal({ deposit, loadDetail, onClose, links }: Props) {
  const [detail, setDetail] = useState<DepositDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` keeps the current detail visible while re-fetching (e.g. after an
  // upload) so the popup doesn't flash its loading state.
  const fetchDetail = useCallback((silent = false) => {
    if (!silent) { setLoading(true); setDetail(null); }
    setError(null);
    return loadDetail(deposit.id)
      .then(setDetail)
      .catch(() => setError('Failed to load deposit detail.'))
      .finally(() => setLoading(false));
  }, [deposit.id, loadDetail]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Browser Back closes the modal instead of navigating away; ESC / backdrop / X
  // route through the same path. See useBackClose.
  const dismiss = useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [dismiss]);

  // A real (sd_) deposit can have documents attached; the numeric part is the
  // security_deposits row id we own the uploaded doc against (so it also shows
  // on the contract). Attaching is offered on the RP view (links present).
  const depositRowId = deposit.id.startsWith('sd_') ? Number(deposit.id.slice(3)) : null;
  const canAttach = !!links && depositRowId != null;
  const handleAttach = useCallback(async (prefix: string, file: File) => {
    if (depositRowId == null) return;
    await uploadOwnedDocument({
      ownerType: 'security_deposit',
      ownerId: depositRowId,
      documentKey: `${prefix}_${Date.now()}`,
      category: 'payment',
      displayName: file.name,
      file,
    });
    await fetchDetail(true);
  }, [depositRowId, fetchDetail]);

  const receiptHref = links?.receipt && detail?.receiptContractId != null ? links.receipt(detail.receiptContractId) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={dismiss}>
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-[#fbfbf9] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0] bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-[#1a1916] truncate">Deposit detail</h2>
              <span className={`inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-0.5 ${STATUS_STYLE[deposit.status] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>
                {STATUS_LABELS[deposit.status] ?? deposit.status}
              </span>
            </div>
            <p className="text-xs text-[#9b9890] font-mono mt-0.5">{deposit.depositRef} · {deposit.tenant} · {deposit.unit}</p>
          </div>
          <button onClick={dismiss} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer p-1.5 rounded-lg hover:bg-[#f4f3ef]"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Main details — one compact horizontal row card (listing row-view style) */}
          <div className="flex items-center gap-4 px-4 py-3.5 bg-white rounded-2xl border border-[#f0ede8]" style={{ boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
            <div className="shrink-0 w-11 h-11 rounded-xl bg-[#d8f2e8] grid place-items-center text-[#1a7a5a]">
              <Wallet size={20} />
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 min-w-0 flex-1">
              <DetailCol label="Contract" value={deposit.contractRef} />
              <DetailCol label="Building" value={deposit.building} />
              <DetailCol label="Unit" value={deposit.unit} />
              <DetailCol label="Customer" value={deposit.tenant} />
              {detail?.chequeNumber && <DetailCol label="Cheque no." value={detail.chequeNumber} />}
              {detail?.paymentMethod && <DetailCol label="Method" value={String(detail.paymentMethod).replace(/_/g, ' ')} />}
              {detail?.dueDate && <DetailCol label="Cheque date" value={detail.dueDate} />}
              {deposit.recordedDate && <DetailCol label="Recorded" value={deposit.recordedDate} />}
            </div>
            <div className="flex flex-col items-end justify-center shrink-0 pl-2">
              <span className="font-bold text-lg text-[#2e9f82] whitespace-nowrap">{fmtAed(deposit.amount)}</span>
              <span className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">Cheque amount</span>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-[#2e9f82]" /></div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <AlertCircle size={22} className="text-[#b91c1c]" />
              <p className="text-sm text-[#b91c1c]">{error}</p>
            </div>
          ) : detail ? (
            <>
              {/* Move-in / Move-out */}
              <div className="grid md:grid-cols-2 gap-4">
                <InspectionSection title="Move-in" data={detail.moveIn} mode="in" />
                <InspectionSection title="Move-out" data={detail.moveOut} mode="out" />
              </div>

              {/* Deposit documents */}
              <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                <SectionTitle icon={<Receipt size={15} />}>Deposit documents</SectionTitle>
                {canAttach && (
                  <p className="text-[11px] text-[#9b9890] -mt-1 mb-3">Missing a document? Attach it here — it’s saved to the deposit and shows on the contract too.</p>
                )}
                <div className="grid sm:grid-cols-3 gap-4">
                  <DocsBucket title="Cheque copy" docs={detail.documents.cheque} empty="No cheque copy uploaded."
                    onAttach={canAttach ? f => handleAttach('deposit_cheque', f) : undefined} />
                  <DocsBucket
                    title="Receipt of security deposit"
                    docs={detail.documents.receipt}
                    empty="No receipt uploaded."
                    onAttach={canAttach ? f => handleAttach('deposit_receipt', f) : undefined}
                    action={receiptHref ? (
                      <a href={receiptHref} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
                        <ExternalLink size={11} /> View / print the system receipt
                      </a>
                    ) : undefined}
                  />
                  <DocsBucket title="Security deposit attachment" docs={[...detail.documents.attachment, ...detail.documents.bank]} empty="No additional attachment."
                    onAttach={canAttach ? f => handleAttach('deposit_attachment', f) : undefined} />
                </div>
              </div>

              {/* Final settlement */}
              <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                <SectionTitle icon={<Wallet size={15} />}>Final settlement</SectionTitle>
                <SettlementBlock deposit={deposit} detail={detail} links={links} />
              </div>

              {deposit.notes && (
                <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                  <SectionTitle icon={<FileText size={15} />}>Notes</SectionTitle>
                  <p className="text-sm text-[#3d3b35] whitespace-pre-wrap">{deposit.notes}</p>
                </div>
              )}

              {links?.contract && deposit.contractId != null && (
                <a href={links.contract(deposit.contractId)} className="inline-flex items-center gap-2 text-sm font-semibold text-[#2e9f82] hover:underline">
                  <ExternalLink size={14} /> Open contract
                </a>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
