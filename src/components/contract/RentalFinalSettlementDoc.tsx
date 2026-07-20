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

import { Building2, User, Wallet } from 'lucide-react';

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
export interface RFSBand { label: string; rows: RFSPayRow[] }
export interface RFSLine { label: string; amount: number; net: number; category: string; type: string }
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
function ChargeCol({ n, title, rows, total, accent }: { n: number; title: string; rows: { label: string; amount: number }[]; total: number; accent?: string }) {
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

// ─── Document ─────────────────────────────────────────────────────────────────
export default function RentalFinalSettlementDoc({ data }: { data: RFSData }) {
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
  // Only show utility rows that carry a value (zero rows are hidden in the preview).
  const utilRowsShown = utilRows.filter(r => Math.abs(r.amount) > 0.005);

  // §4 — restoration lines verbatim (repairs / cleaning / keys …).
  const restorationRows = restoration.length
    ? restoration.map(l => ({ label: l.label.replace(/\s*\(move-out inspection\)\s*/i, ''), amount: l.net ?? l.amount }))
    : [{ label: 'Repairs & Maintenance', amount: 0 }, { label: 'Cleaning', amount: 0 }, { label: 'Missing Keys / Remotes', amount: 0 }];
  const restorationTotal = sumNet(restoration, ['restoration']);

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

  const docs = data.supportingDocs ?? {};

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b-2 border-[#1f6b4f]">
        <div className="text-[10px] font-semibold text-[#6b6860] uppercase tracking-wider">Landlord / Rental Provider</div>
        <div className="text-[17px] font-bold text-[#1f6b4f] uppercase tracking-wide leading-tight">{c.landlordName || '—'}</div>
        <div className="mt-2 text-center">
          <h1 className="text-[26px] font-extrabold text-[#1a1916] leading-none">RENTAL FINAL SETTLEMENT</h1>
          <p className="text-[12px] italic text-[#9b9890] mt-1">Statement of Account &amp; Deposit Reconciliation</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* §1 + Result */}
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
          <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
            <SectionHead n={1} title="Customer & Contract Details" />
            <div className="p-3 grid sm:grid-cols-2 gap-2.5">
              <Field label="Customer Name" value={c.tenantName || '—'} />
              <Field label="Contract Start Date" value={fmtDate(c.startDate)} />
              <Field label="Property Address" value={c.propertyAddress || '—'} />
              <Field label="Contract End Date" value={fmtDate(c.endDate)} />
              <Field label="Unit No." value={c.unit || '—'} />
              <Field label="Move-out Date" value={fmtDate(c.actualMoveOutDate)} accent />
              <Field label="Contract / Tenancy No." value={c.contractNo || '—'} />
              <Field label="Property Type" value={c.propertyType || '—'} />
            </div>
          </div>
          <div className="rounded-lg border border-[#e8e6e0] overflow-hidden flex flex-col">
            <SectionHead n="" title="Final Settlement Result" />
            <div className="p-4 flex-1 flex flex-col justify-center">
              <div className="text-[11px] font-semibold text-[#6b6860] uppercase tracking-wide">
                {isRefund ? 'Net Refund to Customer (AED)' : 'Amount Payable by Customer (AED)'}
              </div>
              <div className={`mt-1 rounded-lg border px-3 py-3 text-[30px] font-extrabold tabular-nums ${isRefund ? 'border-[#c5e8df] bg-[#f0faf6] text-[#1a7a5a]' : 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'}`}>
                {money(isRefund ? netRefund : amountPayable)}
              </div>
              <p className="text-[11px] text-[#9b9890] mt-2 leading-snug">
                {isRefund
                  ? 'Security deposit refundable after all deductions (see Section 7).'
                  : 'Deductions and outstanding rent exceed the deposit held (see Section 7).'}
              </p>
              {data.settlementDate && <p className="text-[11px] text-[#6b6860] mt-1 flex items-center gap-1"><Wallet size={11} /> Settled {fmtDate(data.settlementDate)}</p>}
            </div>
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
                  <>
                    <tr key={`b${bi}`} className="bg-[#f4f2ee]">
                      <td colSpan={7} className="px-3 py-1 text-[11px] font-bold text-[#4a4842] uppercase tracking-wide">{band.label}</td>
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* §3 §4 §5 charge columns */}
        <div className="grid md:grid-cols-3 gap-4">
          <ChargeCol n={3} title="Outstanding Utility & Service Charges" rows={utilRowsShown} total={utilitiesTotal} />
          <ChargeCol n={4} title="Property Restoration Charges" rows={restorationRows} total={restorationTotal} />
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
              <SummaryRow label="Property Restoration Charges" value={money(restorationTotal)} />
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

        {/* §8 Supporting docs */}
        <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
          <SectionHead n={8} title="Supporting Documents" />
          <div className="p-3 flex flex-wrap gap-4 text-[12px]">
            {[['Inspection Report', docs.inspectionReport], ['Utility Bills', docs.utilityBills], ['Invoices', docs.invoices], ['Other Documents', docs.otherDocuments]].map(([label, on]) => (
              <span key={label as string} className="flex items-center gap-1.5 text-[#4a4842]">
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded border text-[10px] font-bold ${on ? 'bg-[#1f6b4f] border-[#1f6b4f] text-white' : 'border-[#c8c6be] text-transparent'}`}>✓</span>
                {label as string}
              </span>
            ))}
          </div>
        </div>

        {/* §9 Signatures */}
        <div className="rounded-lg border border-[#e8e6e0] overflow-hidden">
          <SectionHead n={9} title="Signatures" />
          <div className="p-4 grid sm:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1f6b4f] uppercase tracking-wide"><Building2 size={12} /> Rental Provider / Property Manager</div>
              <div className="mt-3 space-y-3">
                <div><div className="text-[10px] text-[#9b9890]">Name</div><div className="text-[13px] text-[#1a1916] border-b border-[#c8c6be] pb-1">{c.rpSignatoryName || c.landlordName || '—'}</div></div>
                <div><div className="text-[10px] text-[#9b9890]">Signature</div><div className="h-6 border-b border-[#c8c6be]" /></div>
                <div><div className="text-[10px] text-[#9b9890]">Date</div><div className="h-5 border-b border-[#c8c6be]" /></div>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#1f6b4f] uppercase tracking-wide"><User size={12} /> Customer</div>
              <div className="mt-3 space-y-3">
                <div><div className="text-[10px] text-[#9b9890]">Name</div><div className="text-[13px] text-[#1a1916] border-b border-[#c8c6be] pb-1">{c.tenantName || '—'}</div></div>
                <div><div className="text-[10px] text-[#9b9890]">Signature</div><div className="h-6 border-b border-[#c8c6be]" /></div>
                <div><div className="text-[10px] text-[#9b9890]">Date</div><div className="h-5 border-b border-[#c8c6be]" /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
