'use client';

/**
 * EndedLeaseDetailModal — the "big popup" opened from a row on the Ended-Leases
 * page (RP + manager). Shows one departed customer's COMPLETE lifecycle:
 *   • who they are (profile / KYC) + headline figures
 *   • every ended tenancy as a card: the renewal-chain history, move-in &
 *     move-out inspection, the deposit + its documents, and the final settlement
 *   • the customer's KYC documents
 *
 * Move-in/out, settlement and document blocks are shared with the deposit popup
 * (./leaseLifecycleSections) so a lease reads identically in both places.
 *
 * Presentational + self-contained: the host page supplies `loadDetail` (RP uses
 * fetch, manager uses apiGet) and, for the RP, the action `links`. Manager
 * passes `links={null}` → read-only.
 */

import { useCallback, useEffect, useState, type ElementType } from 'react';
import {
  X, FileText, ExternalLink, Loader2, Wallet, AlertCircle,
  UserCircle, CalendarX, Home,
} from 'lucide-react';
import { docLabel } from '@/lib/docLabel';
import { tenantDisplayName } from '@/lib/tenantName';
import { useBackClose } from '@/lib/useSlideOver';
import {
  fmtAed, SectionTitle, InspectionSection, SettlementLines, DocGroupLabel, DocList, ViewAllDocs,
  type ProofDoc, type InspectionView, type SettlementView, type DocLink,
} from './leaseLifecycleSections';

// ─── Types (mirror the backend ended-lease bundle) ──────────────────────────

export interface EndedCustomerRow {
  customerId: number;
  /** The ended tenancy's lease and unit — the list has one row per tenancy. */
  leaseId?: number;
  unitId?: number | null;
  /** The customer still rents another unit; only this tenancy has ended. */
  customerStillActive?: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  emiratesId: string | null;
  entityType?: string | null;
  companyName?: string | null;
  endedLeaseCount: number;
  latestEndDate: string | null;
  lastContractRef: string;
  lastUnit: string;
  lastProperty: string;
  outcome: 'expired' | 'terminated';
  startDate: string | null;
  endDate: string | null;
  depositStatus: string;
  /** Coded move-out reason for the most recent ended tenancy (migration 0198).
   *  null = not recorded — every tenancy that ended before it existed. */
  moveOutReasonCode?: string | null;
}

interface LeaseHist {
  id: number; ref: string; status: string | null; contractActive: boolean;
  startDate: string | null; endDate: string | null; annualRent: number;
  ejariStatus: string | null;
  unit: { id: number | null; number: string | null; name: string | null };
}

interface DepositInfo {
  depositRef: string; amount: number; status: string;
  chequeNumber: string | null; paymentMethod: string | null;
  settledRefundAmount: number | null; settledDeductionAmount: number | null; settledOn: string | null;
  documents: { cheque: ProofDoc[]; receipt: ProofDoc[]; bank: ProofDoc[]; attachment: ProofDoc[] };
}

interface Lifecycle {
  leaseId: number; ref: string;
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
  startDate: string | null; endDate: string | null;
  status: string | null; contractActive: boolean; annualRent: number;
  outcome: 'expired' | 'terminated';
  history: LeaseHist[];
  moveIn: InspectionView | null;
  moveOut: InspectionView | null;
  settlement: SettlementView | null;
  settlementAttachments: ProofDoc[];
  deposit: DepositInfo | null;
}

interface CustomerDoc {
  id: number; ownerType: string | null; ownerId: number | null; leaseId: number | null;
  documentKey: string; displayName: string | null; category: string | null; status: string | null;
  fileUrl: string | null; mimeType: string | null; issueDate: string | null; expiryDate: string | null; createdAt: string | null;
}

export interface EndedCustomerDetail {
  customer: {
    id: number; name: string | null; firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null; emiratesId: string | null; nationality: string | null;
    gender: string | null; dateOfBirth: string | null; entityType: string | null;
    companyName: string | null; tradeLicenseNumber: string | null;
  };
  summary: { totalLeases: number; activeLeases: number; totalActiveRent: number; documentCount: number };
  financials: { totalActiveRent: number; securityDepositHeld: number; totalBilled: number; totalCollected: number; totalOutstanding: number; vatCollected: number };
  documents: CustomerDoc[];
  lifecycles: Lifecycle[];
}

export interface EndedLeaseLinks {
  contract?: (id: number) => string;
  settlement?: (id: number) => string;
  customer?: (id: number) => string;
}

interface Props {
  row: EndedCustomerRow;
  loadDetail: (id: number) => Promise<EndedCustomerDetail>;
  onClose: () => void;
  /** RP action links. Pass null for the read-only (manager) view. */
  links?: EndedLeaseLinks | null;
  /** Open the full-screen Tenant Final Settlement statement for a lease. */
  onOpenStatement?: (leaseId: number) => void;
}

const OUTCOME_STYLE: Record<string, string> = {
  expired: 'bg-[#fef3c7] text-[#92400e]',
  terminated: 'bg-[#fee2e2] text-[#b91c1c]',
};
const DEPOSIT_LABELS: Record<string, string> = {
  held: 'Deposit held', returned: 'Deposit returned', partial_return: 'Deposit part-returned',
  forfeited: 'Deposit forfeited', none: 'No deposit on file',
};

function HeadStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="shrink-0">
      <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide whitespace-nowrap">{label}</p>
      <p className={`text-base font-bold whitespace-nowrap ${accent ?? 'text-[#1a1916]'}`}>{value}</p>
    </div>
  );
}

function fmtPeriod(start: string | null, end: string | null) {
  const s = start ? start.slice(0, 10) : '—';
  const e = end ? end.slice(0, 10) : '—';
  return `${s} → ${e}`;
}

// ── Customer-document categorisation (reuses the CustomerDocsModal model) ──
const KYC_KEY_RE = /emirates|passport|visa|trade_license|business_license|moa|poa|labour|establishment|broker/i;
const FIN_KEY_RE = /bank|iban|statement|employment|salary|tax_registration|payment/i;
type CustDocBucket = 'identity' | 'financial' | 'other';
function customerDocGroupOf(d: CustomerDoc): CustDocBucket {
  const cat = (d.category ?? '').toLowerCase();
  if (cat === 'identity' || cat === 'license' || cat === 'compliance' || cat === 'legal' || KYC_KEY_RE.test(d.documentKey)) return 'identity';
  if (cat === 'banking' || cat === 'payment' || FIN_KEY_RE.test(d.documentKey)) return 'financial';
  return 'other';
}
const CUST_DOC_BUCKETS: { key: CustDocBucket; label: string; Icon: ElementType }[] = [
  { key: 'identity', label: 'Identity & KYC', Icon: UserCircle },
  { key: 'financial', label: 'Financial', Icon: Wallet },
  { key: 'other', label: 'Other documents', Icon: FileText },
];

const toLink = (d: { documentKey: string; displayName: string | null; mimeType: string | null; fileUrl: string | null; status?: string | null }): DocLink =>
  ({ documentKey: d.documentKey, displayName: d.displayName, mimeType: d.mimeType, fileUrl: d.fileUrl, status: d.status ?? null });

/** Logical order for a lease's documents: the agreement first, then registration,
 *  addendums, billing, then receipts — so each contract reads top-to-bottom. */
function docRank(key: string): number {
  const k = key.toLowerCase();
  if (/contract|agreement|tenancy/.test(k)) return 0;
  if (/ejari|registration/.test(k)) return 1;
  if (/addendum/.test(k)) return 2;
  if (/invoice/.test(k)) return 3;
  if (/payment|pdc|cheque/.test(k)) return 4;
  if (/install?ment/.test(k)) return 5;
  if (/receipt/.test(k)) return 6;
  return 50;
}
const sortDocs = (docs: CustomerDoc[]): CustomerDoc[] =>
  [...docs].sort((a, b) => docRank(a.documentKey) - docRank(b.documentKey) || a.documentKey.localeCompare(b.documentKey));

/** A labelled profile field for the Customer-details row card. */
function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-[#9b9890] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-[#1a1916] break-words">{value || '—'}</p>
    </div>
  );
}

/** A compact identifier row for one tenancy — shown only when a customer has
 *  more than one, so the per-tenancy settlement / contract docs stay labelled. */
function TenancyHeader({ lc }: { lc: Lifecycle }) {
  const unitLabel = lc.unit.number || lc.unit.name || '—';
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="w-8 h-8 rounded-lg bg-[#f4f3ef] grid place-items-center text-[#6b6860] shrink-0"><Home size={15} /></span>
      <span className="text-[13px] font-bold text-[#1a1916]">{lc.property.buildingName || '—'} · Unit {unitLabel}</span>
      <span className="text-[11px] text-[#9b9890] font-mono">{lc.ref} · {fmtPeriod(lc.startDate, lc.endDate)}</span>
      <span className={`inline-flex items-center rounded-full text-[10px] font-semibold px-2 py-0.5 capitalize ${OUTCOME_STYLE[lc.outcome] ?? 'bg-[#f4f3ef] text-[#6b6860]'}`}>{lc.outcome}</span>
    </div>
  );
}

/** One tenancy's settlement block: move-in/out inspections, the final settlement
 *  breakdown, and the deposit + settlement documents (kept together). */
function TenancySettlement({ lc, links, showHeader, onOpenStatement }: { lc: Lifecycle; links?: EndedLeaseLinks | null; showHeader: boolean; onOpenStatement?: (leaseId: number) => void }) {
  const dep = lc.deposit;
  const settleHref = links?.settlement ? links.settlement(lc.leaseId) : null;
  const depDocs = dep ? [...dep.documents.cheque, ...dep.documents.receipt, ...dep.documents.attachment, ...dep.documents.bank] : [];
  const labelAll = (d: DocLink) => docLabel({ documentKey: d.documentKey, displayName: d.displayName }, [...depDocs.map(toLink), ...lc.settlementAttachments.map(toLink)]);
  return (
    <div className="bg-white rounded-2xl border border-[#f0ede8] p-4 space-y-3.5">
      {showHeader && <TenancyHeader lc={lc} />}

      {/* Move-in / Move-out */}
      <div className="grid md:grid-cols-2 gap-4">
        <InspectionSection title="Move-in" data={lc.moveIn} mode="in" />
        <InspectionSection title="Move-out" data={lc.moveOut} mode="out" />
      </div>

      {/* Final settlement breakdown */}
      <div>
        <DocGroupLabel right={(onOpenStatement || settleHref) ? (
          <div className="flex items-center gap-3 shrink-0">
            {onOpenStatement && (
              <button type="button" onClick={() => onOpenStatement(lc.leaseId)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2e9f82] hover:underline cursor-pointer">
                <FileText size={11} /> View full statement
              </button>
            )}
            {settleHref && (
              <a href={settleHref} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6b6860] hover:underline">
                <ExternalLink size={11} /> Contract page
              </a>
            )}
          </div>
        ) : undefined}>Final settlement</DocGroupLabel>
        {lc.settlement ? (
          <button type="button" onClick={onOpenStatement ? () => onOpenStatement(lc.leaseId) : undefined}
            className={`block w-full text-left rounded-lg ${onOpenStatement ? 'hover:bg-[#f7faf9] transition-colors cursor-pointer' : ''}`}>
            <SettlementLines s={lc.settlement} openHref={null} />
          </button>
        ) : (
          <p className="text-[11px] text-[#9b9890]">No move-out settlement was recorded.{dep && dep.status === 'held' ? ' The deposit is still marked as held.' : ''}</p>
        )}
      </div>

      {/* Security deposit documents */}
      {dep && (
        <div>
          <DocGroupLabel>Security deposit · {fmtAed(dep.amount)} · {DEPOSIT_LABELS[dep.status] ?? dep.status}{dep.settledOn ? ` · settled ${dep.settledOn}` : ''}</DocGroupLabel>
          {depDocs.length > 0
            ? <DocList docs={depDocs.map(toLink)} labelFor={labelAll} />
            : <p className="text-[11px] text-[#9b9890]">No deposit documents on file.</p>}
        </div>
      )}

      {/* Settlement documents */}
      {lc.settlementAttachments.length > 0 && (
        <div>
          <DocGroupLabel>Settlement documents</DocGroupLabel>
          <DocList docs={lc.settlementAttachments.map(toLink)} labelFor={labelAll} />
        </div>
      )}
    </div>
  );
}

/** One tenancy's contract documents, grouped per individual lease (CID). */
function TenancyContractDocs({ lc, leaseDocs, showHeader }: { lc: Lifecycle; leaseDocs: CustomerDoc[]; showHeader: boolean }) {
  const chainLeases = (() => {
    const map = new Map<number, { id: number; ref: string; start: string | null; end: string | null }>();
    map.set(lc.leaseId, { id: lc.leaseId, ref: lc.ref, start: lc.startDate, end: lc.endDate });
    for (const h of lc.history) if (!map.has(h.id)) map.set(h.id, { id: h.id, ref: h.ref, start: h.startDate, end: h.endDate });
    return [...map.values()].sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')));
  })();
  const docsByLease = chainLeases.map(l => ({ lease: l, docs: leaseDocs.filter(d => d.leaseId === l.id) })).filter(g => g.docs.length > 0);
  const chainIds = new Set(chainLeases.map(l => l.id));
  const orphanDocs = leaseDocs.filter(d => d.leaseId == null || !chainIds.has(d.leaseId));
  if (docsByLease.length === 0 && orphanDocs.length === 0) return null;
  const labelAll = (d: DocLink) => docLabel({ documentKey: d.documentKey, displayName: d.displayName }, leaseDocs.map(toLink));
  // Each lease (CID) is its own bordered card: a header bar + its ordered docs,
  // so a chain of contracts reads as cleanly-separated, arranged blocks.
  const Card = ({ title, period, docs }: { title: string; period?: string; docs: CustomerDoc[] }) => (
    <div className="rounded-xl border border-[#f0ede8] overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-[#f4f3ef] px-3 py-2">
        <span className="font-mono text-[11px] font-bold text-[#3d3b35] truncate">{title}</span>
        {period && <span className="text-[11px] text-[#9b9890] shrink-0">{period}</span>}
      </div>
      <div className="p-2.5">
        <DocList docs={sortDocs(docs).map(toLink)} labelFor={labelAll} />
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      {showHeader && <TenancyHeader lc={lc} />}
      {docsByLease.map(({ lease, docs }) => (
        <Card key={lease.id} title={lease.ref} period={fmtPeriod(lease.start, lease.end)} docs={docs} />
      ))}
      {orphanDocs.length > 0 && <Card title="Other lease documents" docs={orphanDocs} />}
    </div>
  );
}

export default function EndedLeaseDetailModal({ row, loadDetail, onClose, links, onOpenStatement }: Props) {
  const [detail, setDetail] = useState<EndedCustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(() => {
    setLoading(true); setDetail(null); setError(null);
    return loadDetail(row.customerId)
      .then(setDetail)
      .catch(() => setError('Failed to load customer lifecycle.'))
      .finally(() => setLoading(false));
  }, [row.customerId, loadDetail]);

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

  const c = detail?.customer;
  // Customer documents = genuinely customer-owned (KYC etc.) ONLY. Everything
  // with a lease (contract / deposit / settlement docs) lives under that lease.
  const kycDocs = (detail?.documents ?? []).filter(d => d.ownerType === 'customer');
  // Per-lease contract documents (signed contract / Ejari / attachments) — RAW
  // docs (keep leaseId so the card can segregate per individual lease). Excludes
  // settlement* keys (settlement block) and deposit docs (deposit block, owned
  // by security_deposit, which carry a leaseId).
  const leaseDocsFor = (lc: Lifecycle): CustomerDoc[] => {
    const ids = new Set<number>([lc.leaseId, ...lc.history.map(h => h.id)]);
    return (detail?.documents ?? [])
      .filter(d => d.ownerType === 'tenancy_contract' && d.leaseId != null && ids.has(d.leaseId) && !/^settlement/i.test(d.documentKey));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={dismiss}>
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-[#fbfbf9] shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e0] bg-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-[#1a1916] truncate">{tenantDisplayName(row) || tenantDisplayName(c) || 'Customer'}</h2>
              <span className="inline-flex items-center gap-1 rounded-full text-[11px] font-semibold px-2.5 py-0.5 bg-[#f4f3ef] text-[#6b6860]">
                <CalendarX size={12} /> Ended customer
              </span>
            </div>
            <p className="text-xs text-[#9b9890] mt-0.5">
              {row.lastProperty}{row.lastUnit && row.lastUnit !== '—' ? ` · Unit ${row.lastUnit}` : ''}{row.latestEndDate ? ` · ended ${row.latestEndDate}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {links?.customer && (
              <a href={links.customer(row.customerId)} className="text-[11px] text-[#2e9f82] font-semibold hover:underline inline-flex items-center gap-1">
                <UserCircle size={13} /> Full profile
              </a>
            )}
            <button onClick={dismiss} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer p-1.5 rounded-lg hover:bg-[#f4f3ef]"><X size={18} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 size={22} className="animate-spin text-[#2e9f82]" /></div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <AlertCircle size={22} className="text-[#b91c1c]" />
              <p className="text-sm text-[#b91c1c]">{error}</p>
              <button onClick={fetchDetail} className="text-xs text-[#2e9f82] font-medium hover:underline cursor-pointer">Retry</button>
            </div>
          ) : detail ? (
            <>
              {/* 1 · Summary of tenant — one row */}
              {(() => {
                const totalLeaseRows = detail.lifecycles.reduce((s, lc) => s + Math.max(1, lc.history?.length || 1), 0);
                const renewals = detail.lifecycles.reduce((s, lc) => s + Math.max(0, (lc.history?.length || 1) - 1), 0);
                return (
                  <div className="bg-white rounded-2xl border border-[#f0ede8] p-4" style={{ boxShadow: '0 2px 12px -2px rgba(0,0,0,0.06)' }}>
                    <p className="text-[10px] text-[#9b9890] font-semibold uppercase tracking-wide mb-2.5">Summary of tenant</p>
                    <div className="flex items-center gap-x-8 overflow-x-auto">
                      <HeadStat label="Total leases" value={String(totalLeaseRows)} />
                      <HeadStat label="Total collection" value={fmtAed(detail.financials.totalCollected)} accent={detail.financials.totalCollected > 0 ? 'text-[#1a7a5a]' : undefined} />
                      <HeadStat label="Renewals" value={String(renewals)} />
                      <HeadStat label="Outstanding" value={fmtAed(detail.financials.totalOutstanding)} accent={detail.financials.totalOutstanding > 0 ? 'text-[#b91c1c]' : undefined} />
                      <HeadStat label="Security deposit" value={fmtAed(detail.financials.securityDepositHeld)} accent={detail.financials.securityDepositHeld > 0 ? 'text-[#1a7a5a]' : undefined} />
                    </div>
                  </div>
                );
              })()}

              {/* 2 · Customer details — one row card */}
              <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                <p className="text-[10px] text-[#9b9890] font-semibold uppercase tracking-wide mb-2.5">Customer details</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
                  <DetailField label="Name" value={c?.name ?? row.name} />
                  <DetailField label="Email" value={c?.email ?? row.email} />
                  <DetailField label="Phone" value={c?.phone ?? row.phone} />
                  <DetailField label="Nationality" value={c?.nationality ?? null} />
                  <DetailField label="Emirates ID" value={c?.emiratesId ?? row.emiratesId} />
                </div>
                {(c?.companyName || c?.tradeLicenseNumber) && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-[#f0ede8]">
                    <DetailField label="Company" value={c?.companyName ?? null} />
                    <DetailField label="Trade licence" value={c?.tradeLicenseNumber ?? null} />
                  </div>
                )}
              </div>

              {/* 3 · Settlement & settlement documents (per tenancy) */}
              {detail.lifecycles.length > 0 && (() => {
                const settleDocs = detail.lifecycles.flatMap(lc => [
                  ...(lc.deposit ? [...lc.deposit.documents.cheque, ...lc.deposit.documents.receipt, ...lc.deposit.documents.attachment, ...lc.deposit.documents.bank] : []),
                  ...lc.settlementAttachments,
                ]).map(toLink);
                const labelOf = (d: DocLink) => docLabel({ documentKey: d.documentKey, displayName: d.displayName }, settleDocs);
                return (
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <SectionTitle icon={<Wallet size={15} />}>Settlement</SectionTitle>
                      <ViewAllDocs docs={settleDocs} labelFor={labelOf} title="Settlement documents" />
                    </div>
                    <div className="space-y-4">
                      {detail.lifecycles.map(lc => (
                        <TenancySettlement key={lc.leaseId} lc={lc} links={links} showHeader={detail.lifecycles.length > 1} onOpenStatement={onOpenStatement} />
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 4 · KYC documents (customer-owned) */}
              {kycDocs.length > 0 && (() => {
                const labelOf = (d: DocLink) => docLabel({ documentKey: d.documentKey, displayName: d.displayName }, kycDocs);
                return (
                  <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <SectionTitle icon={<UserCircle size={15} />}>KYC documents</SectionTitle>
                      <ViewAllDocs docs={kycDocs.map(toLink)} labelFor={labelOf} title="KYC documents" />
                    </div>
                    <div className="space-y-3">
                      {CUST_DOC_BUCKETS.map(({ key, label, Icon }) => {
                        const inBucket = kycDocs.filter(d => customerDocGroupOf(d) === key);
                        if (inBucket.length === 0) return null;
                        return (
                          <div key={key}>
                            <DocGroupLabel><Icon size={12} className="text-[#2e9f82]" /> {label} ({inBucket.length})</DocGroupLabel>
                            <DocList docs={inBucket.map(toLink)} labelFor={labelOf} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* 5 · Contract-wise documents (per tenancy, per CID) */}
              {(() => {
                const sections = detail.lifecycles.map(lc => ({ lc, leaseDocs: leaseDocsFor(lc) })).filter(x => x.leaseDocs.length > 0);
                if (sections.length === 0) return null;
                const allContractDocs = sections.flatMap(s => s.leaseDocs).map(toLink);
                const labelOf = (d: DocLink) => docLabel({ documentKey: d.documentKey, displayName: d.displayName }, allContractDocs);
                return (
                  <div className="bg-white rounded-2xl border border-[#f0ede8] p-4">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <SectionTitle icon={<FileText size={15} />}>Contract documents</SectionTitle>
                      <ViewAllDocs docs={allContractDocs} labelFor={labelOf} title="Contract documents" />
                    </div>
                    <div className="space-y-4">
                      {sections.map(({ lc, leaseDocs }) => (
                        <TenancyContractDocs key={lc.leaseId} lc={lc} leaseDocs={leaseDocs} showHeader={sections.length > 1} />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
