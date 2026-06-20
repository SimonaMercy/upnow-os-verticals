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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, FileText, ExternalLink, Loader2, Camera, ClipboardList,
  Receipt, Wallet, CheckCircle2, AlertCircle, Upload,
} from 'lucide-react';
import { openDocViewer } from '@/lib/docViewer';
import { uploadOwnedDocument } from '@/lib/uploadOwnedDocument';

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

export interface ProofDoc {
  documentKey: string;
  displayName: string | null;
  mimeType: string | null;
  fileUrl: string | null;
}
export interface InspectionView {
  contractId: number;
  inspectionDate: string | null;
  inspectorName: string | null;
  generalNotes: string | null;
  tenantSigned: boolean;
  rpSigned: boolean;
  photos: { url: string; caption: string | null }[];
  areas: { name: string; remarks: string | null; items: { name: string; inCondition: string | null; outCondition: string | null; remarks: string | null }[] }[];
}
export interface SettlementView {
  contractId: number;
  status: string;
  depositHeld: number;
  chargesTotal: number;
  paymentsReceivedTotal: number;
  balance: number;
  refundAmount: number | null;
  notes: string | null;
  rpSigned: boolean;
  tenantSigned: boolean;
  lines: { label: string; amount: number; type: string }[];
  payments: { amount: number; method: string; reference: string | null; receivedOn: string | null }[];
  sentAt: string | null;
  agreedAt: string | null;
  paidAt: string | null;
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

function fmtAed(v: number) {
  return new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(v);
}
function condText(c: string | null) {
  if (c === 'G') return { label: 'Good', cls: 'text-[#16a34a]' };
  if (c === 'F') return { label: 'Fair', cls: 'text-[#f59e0b]' };
  if (c === 'D') return { label: 'Damaged', cls: 'text-[#dc2626]' };
  return { label: '—', cls: 'text-[#9b9890]' };
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-[#2e9f82]">{icon}</span>
      <h3 className="text-sm font-bold text-[#1a1916]">{children}</h3>
    </div>
  );
}

/** One inline label/value column for the compact main-details row card. */
function DetailCol({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-[#1a1916] capitalize truncate">{value}</p>
    </div>
  );
}

function PhotoGrid({ photos }: { photos: { url: string; caption: string | null }[] }) {
  if (!photos.length) return null;
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
      {photos.map((p, i) => (
        <button key={i} type="button"
          onClick={() => openDocViewer({ fileUrl: p.url, caption: p.caption ?? undefined, mimeType: 'image/jpeg' })}
          className="block rounded-lg border border-[#e8e6e0] overflow-hidden hover:border-[#2e9f82] transition-colors cursor-pointer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt={p.caption ?? `Photo ${i + 1}`} className="w-full h-20 object-cover bg-[#f4f3ef]" />
        </button>
      ))}
    </div>
  );
}

function ConditionSummary({ data, mode }: { data: InspectionView; mode: 'in' | 'out' }) {
  // Only areas that actually have a recorded condition for this side.
  const areas = data.areas
    .map(a => ({ ...a, items: a.items.filter(it => (mode === 'out' ? (it.outCondition || it.inCondition) : it.inCondition)) }))
    .filter(a => a.items.length || a.remarks);
  if (!areas.length) {
    return <p className="text-xs text-[#9b9890] italic">No item conditions were recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {areas.map((a, ai) => (
        <div key={ai} className="rounded-xl border border-[#f0ede8] overflow-hidden">
          <div className="bg-[#f4f3ef] px-3 py-1.5 text-xs font-semibold text-[#3d3b35]">{a.name || 'Area'}</div>
          <div className="divide-y divide-[#f4f3ef]">
            {a.items.map((it, ii) => {
              const inC = condText(it.inCondition);
              const outC = condText(it.outCondition);
              return (
                <div key={ii} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-[#3d3b35]">{it.name}</span>
                  {mode === 'out' ? (
                    <span className="flex items-center gap-1.5 font-semibold">
                      <span className={inC.cls}>{inC.label}</span>
                      <span className="text-[#9b9890]">→</span>
                      <span className={outC.cls}>{outC.label}</span>
                    </span>
                  ) : (
                    <span className={`font-semibold ${inC.cls}`}>{inC.label}</span>
                  )}
                </div>
              );
            })}
            {a.remarks && <div className="px-3 py-1.5 text-[11px] text-[#6b6860] bg-[#fcfcfa]">{a.remarks}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function InspectionSection({ title, data, mode }: { title: string; data: InspectionView | null; mode: 'in' | 'out' }) {
  return (
    <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
      <SectionTitle icon={<ClipboardList size={15} />}>{title}</SectionTitle>
      {!data ? (
        <div className="bg-[#f4f3ef] rounded-xl p-3">
          <p className="text-xs text-[#6b6860]">No {title.toLowerCase()} inspection was recorded for this lease.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#9b9890]">
            {data.inspectionDate && <span>Inspected {data.inspectionDate}</span>}
            {data.inspectorName && <span>By {data.inspectorName}</span>}
            <span className={data.tenantSigned ? 'text-[#1a7a5a] font-medium' : ''}>
              {data.tenantSigned ? '✓ Customer signed' : 'Customer not signed'}
            </span>
            <span className={data.rpSigned ? 'text-[#1a7a5a] font-medium' : ''}>
              {data.rpSigned ? '✓ Landlord signed' : 'Landlord not signed'}
            </span>
          </div>
          {data.photos.length > 0 && (
            <div>
              <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <Camera size={11} /> Photos ({data.photos.length})
              </p>
              <PhotoGrid photos={data.photos} />
            </div>
          )}
          <div>
            <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1.5">Condition summary</p>
            <ConditionSummary data={data} mode={mode} />
          </div>
          {data.generalNotes && (
            <div className="bg-[#f4f3ef] rounded-xl p-3">
              <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">General notes</p>
              <p className="text-xs text-[#3d3b35] whitespace-pre-wrap">{data.generalNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function proofCaption(p: ProofDoc, fallback: string) {
  return p.displayName || fallback;
}

/** Pick a file and run it through `onPick`, showing an inline spinner. */
function AttachButton({ onPick }: { onPick: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept="image/*,application/pdf"
        onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true);
          try { await onPick(f); } catch (err) { alert((err as Error)?.message || 'Upload failed.'); }
          finally { setBusy(false); if (ref.current) ref.current.value = ''; }
        }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline disabled:opacity-50 cursor-pointer">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Attach
      </button>
    </>
  );
}

function DocsBucket({ title, docs, empty, action, onAttach }: { title: string; docs: ProofDoc[]; empty: string; action?: React.ReactNode; onAttach?: (f: File) => Promise<void> }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">{title}</p>
        {onAttach && <AttachButton onPick={onAttach} />}
      </div>
      {docs.length === 0 ? (
        <div className="bg-[#f4f3ef] rounded-xl p-2.5">
          <p className="text-[11px] text-[#9b9890]">{empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {docs.map((d, i) => {
            const isImg = (d.mimeType ?? '').startsWith('image/');
            const cap = proofCaption(d, title);
            return (
              <button key={i} type="button"
                onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: cap, mimeType: d.mimeType, documentKey: d.documentKey })}
                className="block w-full text-left rounded-xl border border-[#e8e6e0] overflow-hidden hover:border-[#2e9f82] transition-colors cursor-pointer">
                {isImg && d.fileUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.fileUrl} alt={cap} className="w-full h-24 object-cover bg-[#f4f3ef]" />
                ) : (
                  <div className="w-full h-24 flex items-center justify-center bg-[#f4f3ef] text-[#9b9890]"><FileText size={26} /></div>
                )}
                <div className="px-2.5 py-1.5">
                  <p className="text-[11px] font-semibold text-[#1a1916] truncate">{cap}</p>
                  <p className="text-[10px] text-[#2e9f82] flex items-center gap-1"><ExternalLink size={10} /> View</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function SettlementBlock({ deposit, detail, links }: { deposit: DepositRow; detail: DepositDetail; links?: DepositDetailLinks | null }) {
  const s = detail.settlement;
  const settleHref = (deposit.currentContractId ?? deposit.contractId) ?? null;

  if (s) {
    const refund = s.balance > 0;
    const owes = s.balance < 0;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#eef2ff] text-[#3730a3] capitalize">{s.status}</span>
          {s.tenantSigned && <span className="text-[11px] text-[#1a7a5a] font-medium flex items-center gap-1"><CheckCircle2 size={12} /> Customer agreed</span>}
        </div>
        <div className="rounded-xl border border-[#f0ede8] divide-y divide-[#f4f3ef] text-sm">
          <Row label="Deposit held" value={fmtAed(s.depositHeld)} />
          {s.lines.map((l, i) => (
            <Row key={i} label={l.label} value={`− ${fmtAed(l.amount)}`} valueClass="text-[#b91c1c]" />
          ))}
          {s.paymentsReceivedTotal > 0 && <Row label="Payments received from customer" value={`+ ${fmtAed(s.paymentsReceivedTotal)}`} valueClass="text-[#1a7a5a]" />}
          <Row
            label={refund ? 'Refund due to customer' : owes ? 'Customer still owes' : 'Settled — no balance'}
            value={fmtAed(Math.abs(s.balance))}
            bold
            valueClass={refund ? 'text-[#1a7a5a]' : owes ? 'text-[#b91c1c]' : 'text-[#1a1916]'}
          />
        </div>
        {detail.settlementAttachments.length > 0 && (
          <DocsBucket title="Settlement attachments" docs={detail.settlementAttachments} empty="" />
        )}
        {s.notes && (
          <div className="bg-[#f4f3ef] rounded-xl p-3">
            <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide mb-1">Settlement notes</p>
            <p className="text-xs text-[#3d3b35] whitespace-pre-wrap">{s.notes}</p>
          </div>
        )}
        {links?.settlement && settleHref != null && (
          <a href={links.settlement(s.contractId ?? settleHref)} className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">
            <ExternalLink size={11} /> Open settlement
          </a>
        )}
      </div>
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

function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className={`text-[#6b6860] ${bold ? 'font-semibold text-[#1a1916]' : ''}`}>{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${valueClass ?? 'text-[#1a1916]'}`}>{value}</span>
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
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
          <button onClick={onClose} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer p-1.5 rounded-lg hover:bg-[#f4f3ef]"><X size={18} /></button>
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
