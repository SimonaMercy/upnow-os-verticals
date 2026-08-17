'use client';

/**
 * RENTAL FINAL SETTLEMENT — the CEO 9-section "Statement of Account & Deposit
 * Reconciliation" document, rendered from live settlement data. Mirrors the
 * printed form's structure (§1 details · §2 payment history · §3–§5 charge
 * columns · §6 deposit reconciliation · §7 summary · §8 documents · §9
 * signatures) with a cleaner, tighter design.
 *
 * Every slot is populated from the data it relates to; empty numeric cells show
 * 0.00, unknown text cells show "—".
 */

import { Fragment } from 'react';
import { Building2, User } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface RFSContract {
  landlordName?: string;
  rpSignatoryName?: string;
  tenantName?: string;
  propertyAddress?: string;
  unit?: string;
  contractNo?: string;
  propertyType?: string | null;
  contractAmount?: number;
  startDate?: string | null;
  endDate?: string | null;
  actualMoveOutDate?: string | null;
}
export interface RFSPayRow {
  description: string; date?: string | null; amount?: number;
  method?: string | null; chequeNumber?: string | null; mode?: string;
  status?: string; penalty?: number | null; kind?: string;
}
export interface RFSBand { label: string; band?: string; contractId?: number; contractNo?: string; startDate?: string | null; endDate?: string | null; rows: RFSPayRow[] }
export interface RFSLine { label: string; amount: number; net: number; category: string; type: string; inspectionContractId?: number }
export interface RFSReceipt { amount: number; method?: string; reference?: string | null; receivedOn?: string | null }

export interface RFSData {
  contract: RFSContract;
  depositRow?: RFSPayRow | null;
  paymentHistory: RFSBand[];
  lines: RFSLine[];
  depositHeld: number;
  paymentsReceived: RFSReceipt[];
  otherAdjustments?: number;
  settlementDate?: string | null;
  supportingDocs?: { inspectionReport?: boolean; utilityBills?: boolean; invoices?: boolean; otherDocuments?: boolean };
  // Captured e-signatures (data-URL image or typed name) + when each side signed.
  rpSignature?: string | null;
  tenantSignature?: string | null;
  rpSignedAt?: string | null;
  tenantSignedAt?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) =>
  (n == null ? 0 : n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const sumNet = (lines: RFSLine[], cats: string[]) =>
  Math.round(lines.filter(l => cats.includes(l.category)).reduce((a, l) => a + (l.net ?? l.amount ?? 0), 0) * 100) / 100;

/**
 * §4 Property Charges rows. Customer-signed statement → the single rolled-up
 * "Restoration" figure it was signed on. Not yet signed → one row per
 * restoration line (repairs / cleaning / keys / any manual line) so the
 * breakdown is visible; the "(move-out inspection)" suffix is dropped because
 * the column footer already names the source. Empty → the placeholder row.
 */
export function restorationBreakdownRows(
  restoration: RFSLine[],
  customerSigned: boolean,
  total: number,
): { label: string; amount: number }[] {
  if (customerSigned || restoration.length === 0) return [{ label: 'Restoration', amount: total }];
  return restoration.map(l => ({
    label: (l.label || 'Restoration').replace(/\s*\(move-out inspection\)\s*$/i, '').trim() || 'Restoration',
    amount: Math.round((l.net ?? l.amount ?? 0) * 100) / 100,
  }));
}

const STATUS_TONE: Record<string, string> = {
  Cleared: 'text-[#1a7a5a]', Held: 'text-[#6b6860]', Bounced: 'text-[#b91c1c]',
  Cancelled: 'text-[#9b9890] line-through', 'Not Received': 'text-[#c2410c]', Pending: 'text-[#c2410c]',
};

// Small building blocks --------------------------------------------------------
function SectionHead({ n, title, right }: { n: number | string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-[#1f6b4f] text-white rounded-t-lg px-3 py-2">
      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/20 text-[11px] font-bold">{n}</span>
      <h3 className="text-[12px] font-bold uppercase tracking-wide flex-1">{title}</h3>
      {right}
    </div>
  );
}
function Field({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-[#9b9890] uppercase tracking-wide">{label}</div>
      <div className={`text-[13px] mt-0.5 px-2 py-1.5 rounded border ${accent ? 'border-[#c5e8df] bg-[#f0faf6] font-semibold text-[#1a1916]' : 'border-[#e8e6e0] bg-white text-[#1a1916]'}`}>{value ?? '—'}</div>
    </div>
  );
}
function ChargeCol({ n, title, rows, total, accent, footer }: { n: number; title: string; rows: { label: string; amount: number }[]; total: number; accent?: string; footer?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e8e6e0] overflow-hidden flex flex-col">
      <SectionHead n={n} title={title} />
      <div className="p-2.5 space-y-1 flex-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
            <span className="text-[#4a4842] truncate" title={r.label}>{r.label}</span>
            <span className="tabular-nums text-[#1a1916] shrink-0">{money(r.amount)}</span>
          </div>
        ))}
        {footer && <div className="pt-1">{footer}</div>}
      </div>
      <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-[#e8e6e0] bg-[#faf9f6]">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#1f6b4f]">Total</span>
        <span className={`text-[13px] font-bold tabular-nums ${accent ?? 'text-[#1a1916]'}`}>{money(total)}</span>
      </div>
    </div>
  );
}
function SummaryRow({ label, value, tone, strong, border }: { label: string; value: string; tone?: string; strong?: boolean; border?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 ${border ? 'border-t border-[#e8e6e0]' : ''}`}>
      <span className={`text-[12px] ${strong ? 'font-bold text-[#1f6b4f]' : 'text-[#4a4842]'}`}>{label}</span>
      <span className={`text-[13px] tabular-nums ${strong ? 'font-bold' : 'font-semibold'} ${tone ?? 'text-[#1a1916]'}`}>{value}</span>
    </div>
  );
}
const isSigImg = (s?: string | null): boolean => !!s && s.startsWith('data:image');
// One signing party — mirrors the tenancy contract's signature box: the captured
// signature (drawn image or typed name) sits over a line, with "Not yet signed"
// as the placeholder (electronic signing, not a blank hand-sign line), and the
// party label + name + signed date beneath.
function SignatureSide({ icon, role, name, signature, signedAt }: { icon: React.ReactNode; role: string; name: string; signature?: string | null; signedAt?: string | null }) {
  const img = isSigImg(signature);
  const typed = !img && !!(signature && signature.trim());
  const signed = img || typed;
  return (
    <div>
      <div className="h-12 flex items-end">
        {img
          ? <img src={signature!} alt="Signature" className="max-h-11 object-contain object-left" />
          : typed
            ? <span className="text-[22px] leading-none text-[#1a1916]" style={{ fontFamily: 'Segoe Script, "Snell Roundhand", cursive' }}>{signature}</span>
            : <span className="text-[12px] italic text-[#b8b5ad] pb-1">Not yet signed</span>}
      </div>
      <div className="border-t border-[#c8c6be] pt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1f6b4f] uppercase tracking-wide">{icon} {role}</div>
          <div className="text-[12px] text-[#1a1916] truncate">{name || '—'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-[#9b9890] uppercase tracking-wide">Date</div>
          <div className={`text-[12px] ${signed && signedAt ? 'text-[#1a7a5a] font-medium' : 'text-[#9b9890]'}`}>
            {signed && signedAt ? fmtDate(signedAt) : '____________'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────
export default function RentalFinalSettlementDoc({ data, contractHref, moveOutReportHref }: { data: RFSData; contractHref?: (id: number) => string; moveOutReportHref?: (id: number) => string }) {
  const c = data.contract;
  const utilities = data.lines.filter(l => l.category === 'utility');
  const restoration = data.lines.filter(l => l.category === 'restoration');
  const rentLines = data.lines.filter(l => l.category === 'rent_due');
  const otherLines = data.lines.filter(l => l.category === 'other');

  // §3 — the five standard utility rows, filled from any utility lines by keyword.
  const utilBuckets = [
    { label: 'Electricity / Water', kw: ['dewa', 'sewa', 'fewa', 'electric', 'water'] },
    { label: 'Cooling / District Cooling', kw: ['cool', 'chiller', 'empower', 'emicool', 'tabreed'] },
    { label: 'Gas', kw: ['gas'] },
    { label: 'Community Fees', kw: ['community', 'service charge', 'service'] },
    { label: 'Telecommunications', kw: ['telecom', 'du', 'etisalat', 'internet'] },
  ];
  const utilRows = utilBuckets.map(b => ({
    label: b.label,
    amount: Math.round(utilities.filter(l => b.kw.some(k => (l.label || '').toLowerCase().includes(k))).reduce((a, l) => a + (l.net ?? l.amount), 0) * 100) / 100,
  }));
  const matchedUtil = utilRows.reduce((a, r) => a + r.amount, 0);
  const utilOther = Math.round((sumNet(utilities, ['utility']) - matchedUtil) * 100) / 100;
  if (utilOther > 0.005) utilRows.push({ label: 'Other utilities', amount: utilOther });
  const utilitiesTotal = sumNet(utilities, ['utility']);
  // Show every standard utility row — including the zero ones — so the statement
  // always accounts for each service category explicitly.
  const utilRowsShown = utilRows;

  // §4 — itemised while the statement is still open (each repair / cleaning /
  // keys line as its own row, so the customer sees what the figure is made of);
  // once the customer has signed, the statement is an issued document and keeps
  // the single rolled-up "Restoration" figure it was signed on.
  const restorationTotal = sumNet(restoration, ['restoration']);
  const restorationRows = restorationBreakdownRows(restoration, !!data.tenantSignature, restorationTotal);
  const restorationInspId = restoration.find(l => l.inspectionContractId != null)?.inspectionContractId;

  // §5 — the standard additional-charge rows, each summed from its category.
  const additionalRows = [
    { label: 'Breach', amount: sumNet(data.lines, ['penalty_breach']) },
    { label: 'Overstay', amount: sumNet(data.lines, ['overstay']) },
    { label: 'Early Termination', amount: sumNet(data.lines, ['early_termination']) },
    { label: 'Dispute', amount: sumNet(data.lines, ['dispute']) },
    { label: 'Admin', amount: sumNet(data.lines, ['admin']) },
  ];
  const additionalTotal = additionalRows.reduce((a, r) => a + r.amount, 0);

  const otherAdjustments = data.otherAdjustments ?? sumNet(otherLines, ['other']);
  const outstandingRent = sumNet(rentLines, ['rent_due']);
  const totalDeductions = Math.round((utilitiesTotal + restorationTotal + additionalTotal + sumNet(otherLines, ['other'])) * 100) / 100;
  const netDepositBalance = Math.round((data.depositHeld - totalDeductions) * 100) / 100;
  const paymentsReceivedTotal = data.paymentsReceived.reduce((a, p) => a + (p.amount || 0), 0);
  const finalBalance = Math.round((netDepositBalance - outstandingRent + paymentsReceivedTotal - (data.otherAdjustments ?? 0)) * 100) / 100;
  const netRefund = finalBalance > 0 ? finalBalance : 0;
  const amountPayable = finalBalance < 0 ? -finalBalance : 0;
  const isRefund = finalBalance >= 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b-2 border-[#1f6b4f]">
        <div className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wider">Landlord / Rental Provider</div>
        <div className="text-[17px] font-bold text-[#1f6b4f] uppercase tracking-wide leading-tight">{c.landlordName || '—'}</div>
        <div className="mt-2 text-center">
          <h1 className="text-[26px] font-extrabold text-[#1a1916] leading-none">FINAL SETTLEMENT</h1>
          <p className="text-[12px] italic text-[#9b9890] mt-1">Statement of Account &amp; Deposit Reconciliation</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* §1 Customer & Contract Details */}
        <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
          <SectionHead n={1} title="Customer & Contract Details" />
          <div className="p-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <Field label="Customer Name" value={c.tenantName || '—'} />
            <Field label="Contract Start Date" value={fmtDate(c.startDate)} />
            <Field label="Contract End Date" value={fmtDate(c.endDate)} />
            <Field label="Move-out Date" value={fmtDate(c.actualMoveOutDate)} accent />
            <Field label="Property Address" value={c.propertyAddress || '—'} />
            <Field label="Unit No." value={c.unit || '—'} />
            <Field label="Contract / Tenancy No." value={c.contractNo || '—'} />
            <Field label="Property Type" value={c.propertyType || '—'} />
          </div>
        </div>

        {/* §2 Payment History */}
        <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
          <SectionHead n={2} title="Payment History" />
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[640px]">
              <thead>
                <tr className="bg-[#faf9f6] text-[#6b6860] text-[10px] uppercase tracking-wide">
                  <th className="text-left font-semibold px-3 py-1.5">Description</th>
                  <th className="text-left font-semibold px-2 py-1.5">Date</th>
                  <th className="text-right font-semibold px-2 py-1.5">Amount (AED)</th>
                  <th className="text-left font-semibold px-2 py-1.5">Method</th>
                  <th className="text-left font-semibold px-2 py-1.5">Reference / Cheque #</th>
                  <th className="text-left font-semibold px-2 py-1.5">Status</th>
                  <th className="text-right font-semibold px-3 py-1.5">Penalty (AED)</th>
                </tr>
              </thead>
              <tbody>
                {data.depositRow && (
                  <tr className="border-t border-[#f0ede8]">
                    <td className="px-3 py-1.5 font-medium text-[#1a1916]">{data.depositRow.description}</td>
                    <td className="px-2 py-1.5 text-[#6b6860]">{fmtDate(data.depositRow.date)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(data.depositRow.amount)}</td>
                    <td className="px-2 py-1.5 text-[#6b6860]">{data.depositRow.method || (data.depositRow.mode ?? '')}</td>
                    <td className="px-2 py-1.5 text-[#6b6860]">{data.depositRow.chequeNumber || (data.depositRow.mode ?? '') || '—'}</td>
                    <td className={`px-2 py-1.5 ${STATUS_TONE[data.depositRow.status ?? ''] ?? 'text-[#6b6860]'}`}>{data.depositRow.status}</td>
                    <td className="px-3 py-1.5 text-right" />
                  </tr>
                )}
                {data.paymentHistory.map((band, bi) => (
                  <Fragment key={bi}>
                    <tr className="bg-[#f4f2ee]">
                      <td colSpan={7} className="px-3 py-1 text-[11px] font-bold text-[#4a4842] uppercase tracking-wide">
                        {band.contractNo && band.contractId != null
                          ? <>{contractHref
                                ? <a href={contractHref(band.contractId)} target="_blank" rel="noreferrer" className="text-[#1f6b4f] hover:underline normal-case">{band.contractNo}</a>
                                : <span className="text-[#1f6b4f]">{band.contractNo}</span>}
                              {band.startDate ? `  ·  ${fmtDate(band.startDate)} → ${fmtDate(band.endDate)}` : ''}</>
                          : band.label}
                      </td>
                    </tr>
                    {band.rows.map((r, ri) => (
                      <tr key={`b${bi}r${ri}`} className="border-t border-[#f0ede8]">
                        <td className="px-3 py-1.5 text-[#1a1916]">{r.description}</td>
                        <td className="px-2 py-1.5 text-[#6b6860]">{fmtDate(r.date)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(r.amount)}</td>
                        <td className="px-2 py-1.5 text-[#6b6860] capitalize">{(r.method || '').replace('_', ' ') || '—'}</td>
                        <td className="px-2 py-1.5 text-[#6b6860]">{r.chequeNumber || '—'}</td>
                        <td className={`px-2 py-1.5 ${STATUS_TONE[r.status ?? ''] ?? 'text-[#6b6860]'}`}>{r.status}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#b91c1c]">{r.penalty ? money(r.penalty) : ''}</td>
                      </tr>
                    ))}
                    {/* Per-contract subtotal — sum of the amounts listed under this lease. */}
                    <tr className="border-t border-[#e8e6e0] bg-[#faf9f6]">
                      <td className="px-3 py-1 text-[11px] font-semibold text-[#4a4842]">Subtotal{band.contractNo ? ` · ${band.contractNo}` : ''}</td>
                      <td className="px-2 py-1" />
                      <td className="px-2 py-1 text-right tabular-nums font-bold text-[#1a1916]">
                        {money(band.rows.reduce((a, r) => a + (r.amount || 0), 0))}
                      </td>
                      <td className="px-2 py-1" colSpan={4} />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* §3 §4 §5 charge columns */}
        <div className="grid md:grid-cols-3 gap-4">
          <ChargeCol n={3} title="Outstanding Utility & Service Charges" rows={utilRowsShown} total={utilitiesTotal} />
          <ChargeCol n={4} title="Property Charges" rows={restorationRows} total={restorationTotal}
            footer={restorationInspId != null && moveOutReportHref
              ? <a href={moveOutReportHref(restorationInspId)} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-[#1f6b4f] hover:underline">↗ From move-out inspection report</a>
              : (restorationTotal > 0 ? <span className="text-[11px] text-[#9b9890]">From move-out inspection</span> : undefined)} />
          <ChargeCol n={5} title="Additional Recoverable Charges" rows={additionalRows} total={additionalTotal} />
        </div>

        {/* §6 §7 */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
            <SectionHead n={6} title="Security Deposit Reconciliation" />
            <div>
              <SummaryRow label="Security Deposit (Held)" value={money(data.depositHeld)} />
              <div className="px-3 pt-1 text-[10px] font-bold text-[#9b9890] uppercase tracking-wide">Less: Deductions</div>
              <SummaryRow label="Outstanding Utility & Service Charges" value={money(utilitiesTotal)} />
              <SummaryRow label="Property Charges" value={money(restorationTotal)} />
              <SummaryRow label="Additional Recoverable Charges" value={money(additionalTotal)} />
              <SummaryRow label="Total Deductions" value={money(totalDeductions)} tone="text-[#b91c1c]" strong border />
              <SummaryRow label="Net Deposit Balance" value={money(netDepositBalance)} tone={netDepositBalance < 0 ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'} strong border />
            </div>
          </div>
          <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
            <SectionHead n={7} title="Final Settlement Summary" />
            <div>
              <SummaryRow label="Outstanding Rent (if any)" value={money(outstandingRent)} />
              <SummaryRow label="Security Deposit Balance (from Section 6)" value={money(netDepositBalance)} tone={netDepositBalance < 0 ? 'text-[#b91c1c]' : undefined} />
              {paymentsReceivedTotal > 0 && <SummaryRow label="Payments received from customer" value={money(paymentsReceivedTotal)} tone="text-[#1a7a5a]" />}
              <SummaryRow label="Other Adjustments (if any)" value={money(data.otherAdjustments ?? 0)} />
              <SummaryRow label={isRefund ? 'NET REFUND TO CUSTOMER' : 'AMOUNT PAYABLE BY CUSTOMER'} value={money(isRefund ? netRefund : amountPayable)} tone={isRefund ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'} strong border />
            </div>
          </div>
        </div>

        {/* §9 Signatures — the actual captured e-signatures when signed, blank
            signing lines when a side hasn't signed yet. */}
        <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
          <SectionHead n={9} title="Signatures" />
          <div className="p-4 grid sm:grid-cols-2 gap-6">
            <SignatureSide icon={<Building2 size={12} />} role="Rental Provider / Property Manager"
              name={c.rpSignatoryName || c.landlordName || '—'}
              signature={data.rpSignature || (c.rpSignatoryName ? c.rpSignatoryName.split(' (')[0] : undefined)} signedAt={data.rpSignedAt} />
            <SignatureSide icon={<User size={12} />} role="Customer"
              name={c.tenantName || '—'} signature={data.tenantSignature} signedAt={data.tenantSignedAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
