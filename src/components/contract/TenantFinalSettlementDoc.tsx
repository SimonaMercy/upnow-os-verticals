/**
 * Tenant Final Settlement — the document-style statement rendered from LIVE
 * settlement data (GET /contracts/:id/settlement → `statement` block + the
 * worksheet's deposit / deductions / payments). Layout mirrors the reference
 * settlement statement: full-width contract summary, then a two-column body
 * (Rent Summary + Final Balance + Notes on the left; the Security Deposit
 * Summary sub-tables stacked on the right), then signatures.
 *
 * Empty sections/rows are hidden. When `links` is supplied, each line item is a
 * cross-check link to the page that sources it (cheques → contract, cleared
 * total → payments ledger, deposit → deposit register, deductions → worksheet)
 * — opened in a new tab so the statement stays put.
 */
'use client';

import type { ReactNode } from 'react';
import { Wallet, Building2, User, ExternalLink } from 'lucide-react';

export interface TFSContract {
  tenantName: string;
  propertyAddress: string;
  buildingName: string;
  fullAddress: string;
  unit: string;
  contractNo: string | null;
  contractAmount: number;
  startDate: string | null;
  endDate: string | null;
  actualMoveOutDate: string | null;
}
export interface TFSRow {
  description: string;
  date: string | null;
  amount: number;
  mode: string;
  status: string;
  kind: 'deposit' | 'installment';
}
export interface TFSRent {
  totalClearedPayment: number;
  chequeToBeReturned: string | null;
  actualRentalCharge: number | null;
  earlyTerminationCharge: number | null;
  overstayCharge: number | null;
  rentRefundable: number | null;
  occupancyDays: number | null;
  termDays: number | null;
}
export interface TFSLine { label: string; amount: number; type: 'deduction' | 'due' }
export interface TFSPayment { amount: number; method: string; reference: string | null; receivedOn: string | null }

/** Cross-check destinations for line items (each opens in a new tab). */
export interface TFSLinks {
  contract?: string;   // contract page — facts + cheque schedule
  payments?: string;   // payments ledger — cleared totals / returned cheque
  deposits?: string;   // deposit register — held deposit
  worksheet?: string;  // settlement worksheet — deductions + payments received
}

export interface TFSDocData {
  contract: TFSContract;
  contractSummary: TFSRow[];
  rent: TFSRent;
  depositHeld: number;
  lines: TFSLine[];
  chargesTotal: number;
  payments: TFSPayment[];
  paymentsReceivedTotal: number;
  balance: number;
  notes: string | null;
  status: string;
  settlementDate: string | null;
}

const nf = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmtLong = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', online: 'Online',
};

/** Wrap a value in a cross-check link when a target is supplied. */
function Ref({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="group/ref inline-flex items-center gap-1 underline decoration-dotted decoration-[#cfd8d3] underline-offset-2 hover:text-[#2e9f82] hover:decoration-[#2e9f82] cursor-pointer">
      {children}
      <ExternalLink size={10} className="opacity-0 group-hover/ref:opacity-100 text-[#2e9f82] shrink-0" />
    </a>
  );
}

function SecHead({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-6 h-6 rounded-md bg-[#2e9f82] text-white text-xs font-extrabold flex items-center justify-center shrink-0">{n}</span>
      <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-[#1a1916]">{title}</h3>
    </div>
  );
}

// ── Security-deposit sub-table (A / B / C / D) ────────────────────────────────
interface SubRow { label: string; date: string | null; amount: number | null; href?: string }
function SubTable({ tag, title, rows, total, hasDates }: { tag: string; title: string; rows: SubRow[]; total: number | null; hasDates: boolean }) {
  const owed = total != null && total < 0;
  return (
    <table className="w-full text-[12px] mb-4">
      <tbody>
        <tr><td colSpan={hasDates ? 3 : 2} className="py-1.5 px-2.5 bg-[#eef7f3] text-[11px] font-bold uppercase tracking-wide text-[#1a7a5a]">{tag}. {title}</td></tr>
        <tr className="text-[#9b9890] text-[10px] uppercase tracking-wide">
          <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Description</th>
          {hasDates && <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Date</th>}
          <th className="text-right font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Amount (AED)</th>
        </tr>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[#f4f2ee]">
            <td className="py-2 px-2.5"><Ref href={r.href}>{r.label}</Ref></td>
            {hasDates && <td className="py-2 px-2.5 text-[#9b9890]">{fmtDate(r.date)}</td>}
            <td className="py-2 px-2.5 text-right tabular-nums">{nf.format(r.amount ?? 0)}</td>
          </tr>
        ))}
        {total != null && (
          <tr className="border-t-2 border-[#eceae4]">
            <td className={`py-2 px-2.5 font-bold ${owed ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>Total{owed ? ' (owed)' : ''}</td>
            {hasDates && <td />}
            <td className={`py-2 px-2.5 text-right font-bold tabular-nums ${owed ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>{nf.format(Math.abs(total))}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default function TenantFinalSettlementDoc({ data, links }: { data: TFSDocData; links?: TFSLinks }) {
  const c = data.contract;
  const r = data.rent;
  const owe = data.balance < -0.005;
  const settled = Math.abs(data.balance) <= 0.005;
  const resultLabel = owe ? 'Payable by Tenant' : settled ? 'Settled in Full' : 'Refundable to Tenant';
  const depositDate = data.contractSummary.find(row => row.kind === 'deposit')?.date ?? null;
  const hasLinks = !!(links && (links.contract || links.payments || links.deposits || links.worksheet));

  // Split deduction lines: penalties (early termination / overstay / late / bounced)
  // are reported as "Other Penalty Charges" (Section 4), NOT as deposit restoration.
  const PENALTY_RE = /penalt|terminat|overstay|notice|holdover|bounced|late\s*(fee|payment|renewal|move|hand)/i;
  const penaltyLines = data.lines.filter(l => PENALTY_RE.test(l.label));
  const restorationLines = data.lines.filter(l => !PENALTY_RE.test(l.label));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const restorationTotal = r2(restorationLines.reduce((a, l) => a + l.amount, 0));
  const penaltyTotal = r2(penaltyLines.reduce((a, l) => a + l.amount, 0));
  const penaltyLabel = penaltyLines.map(l => l.label).join('; ');
  // Deposit refundable = held − restoration only (penalties are a separate charge in §4).
  const depositRefundable = r2(data.depositHeld - restorationTotal);

  // ── Only surface rows/sub-tables that actually carry a value ────────────────
  const rentRows = [
    // Link to the (last) contract — its Cheques/PDC step is where cleared/bounced
    // status is verified, scoped to this tenancy.
    { label: 'Total Cleared Payment', amount: r.totalClearedPayment, accent: true, href: links?.contract },
    { label: 'Actual Rental Charge', amount: r.actualRentalCharge, accent: false, href: undefined as string | undefined },
    { label: 'Early Termination Charge', amount: r.earlyTerminationCharge, accent: false, href: undefined as string | undefined },
    { label: 'Overstay Charge', amount: r.overstayCharge, accent: false, href: undefined as string | undefined },
    { label: 'Rent Refundable (Payable / Refundable)', amount: r.rentRefundable, accent: false, href: undefined as string | undefined },
  ].filter(x => x.amount != null) as { label: string; amount: number; accent: boolean; href?: string }[];
  const showRentSection = rentRows.length > 0 || !!r.chequeToBeReturned;

  const finalRows: { label: string; amount: number; owed?: boolean; href?: string; note?: string }[] = [];
  if (r.rentRefundable != null) finalRows.push({ label: 'Rent Balance', amount: r.rentRefundable });
  finalRows.push({ label: 'Security Deposit Balance', amount: depositRefundable, owed: depositRefundable < 0, href: links?.worksheet });
  if (penaltyTotal > 0) finalRows.push({ label: 'Other Penalty Charges', amount: penaltyTotal, href: links?.worksheet, note: penaltyLabel });

  // Restoration/deduction lines shown verbatim (real labels), penalties excluded.
  const restorationRows: SubRow[] = restorationLines.map(l => ({
    label: l.type === 'due' ? `${l.label} (due)` : l.label,
    date: null,
    amount: l.amount,
    href: links?.worksheet,
  }));
  const refundableRows: SubRow[] = ([
    { label: 'Security Deposit Held', date: depositDate, amount: data.depositHeld, href: links?.deposits },
    { label: 'Restoration', date: null, amount: restorationTotal || null, href: links?.worksheet },
  ] as SubRow[]).filter(row => row.amount != null);
  const showDepositSection = restorationRows.length > 0 || refundableRows.length > 0;

  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden text-[#1a1916]">
      <div className="px-7 py-6 sm:px-9">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[#2e9f82] pb-4 mb-6">
          <h2 className="text-[22px] font-extrabold">Tenant Final Settlement</h2>
          {hasLinks && <span className="text-[10.5px] text-[#9b9890] italic hidden sm:flex items-center gap-1"><ExternalLink size={11} className="text-[#2e9f82]" /> underlined values link to their source record</span>}
        </div>

        {/* Tenant details + result card */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 mb-8">
          <div className="border border-[#eceae4] rounded-xl p-5">
            <div className="flex items-center justify-between">
              <SecHead n="i" title="Tenant & Contract Details" />
              {links?.contract && (
                <a href={links.contract} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#2e9f82] hover:underline inline-flex items-center gap-1 mb-3">
                  <ExternalLink size={11} /> View contract
                </a>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              {[
                ['Tenant Name', c.tenantName || '—'],
                ['Property Address', c.propertyAddress || '—'],
                ['Unit No.', c.unit || '—'],
                ...(c.contractNo ? [['Tenancy Contract No.', c.contractNo] as [string, string]] : []),
                ['Current Contract Amount', c.contractAmount ? `AED ${nf.format(c.contractAmount)}` : '—'],
                ['Contract Start Date', fmtDate(c.startDate)],
                ['Contract End Date', fmtDate(c.endDate)],
                ...(c.actualMoveOutDate ? [['Actual Move-out Date', fmtDate(c.actualMoveOutDate)] as [string, string]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-[#9b9890]">{k}</span>
                  <span className={`text-[12.5px] font-semibold ${v === '—' ? 'text-[#b9b6ae]' : ''}`}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={`rounded-xl p-5 border ${owe ? 'bg-[#fdf1f1] border-[#eaa6a6]' : 'bg-[#eef7f3] border-[#c5e8df]'}`}>
            <div className="flex items-start justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#6b6860]">Final Settlement Result</div>
              <Wallet size={26} className={owe ? 'text-[#e2b4b4]' : 'text-[#bfe3d5]'} />
            </div>
            <div className="text-[13px] text-[#6b6860] mt-1 font-semibold">{resultLabel}</div>
            <div className={`text-[30px] font-extrabold mt-1 ${owe ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>AED {nf.format(Math.abs(data.balance))}</div>
            <div className="text-[11px] text-[#9b9890] mt-2">
              {owe ? 'Balance collected from the tenant after all charges.' : 'Security deposit refundable after all deductions.'}
            </div>
            {data.settlementDate && <div className="text-[11px] text-[#6b6860] mt-3 pt-2 border-t border-black/5">Settlement Date: <span className="font-semibold">{fmtLong(data.settlementDate)}</span></div>}
          </div>
        </div>

        {/* Section 1 — current contract summary (full width) */}
        {data.contractSummary.length > 0 && (
          <section className="mb-8">
            <SecHead n="1" title="Current Contract Summary" />
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] border-collapse">
                <thead>
                  <tr className="text-[#9b9890] text-[10.5px] uppercase tracking-wide">
                    <th className="text-left font-semibold py-2 px-2.5 bg-[#fafbfc] border-b border-[#eceae4]">Description</th>
                    <th className="text-left font-semibold py-2 px-2.5 bg-[#fafbfc] border-b border-[#eceae4]">Date</th>
                    <th className="text-right font-semibold py-2 px-2.5 bg-[#fafbfc] border-b border-[#eceae4]">Amount (AED)</th>
                    <th className="text-left font-semibold py-2 px-2.5 bg-[#fafbfc] border-b border-[#eceae4]">Mode / Cheque #</th>
                    <th className="text-left font-semibold py-2 px-2.5 bg-[#fafbfc] border-b border-[#eceae4]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.contractSummary.map((row, i) => (
                    <tr key={i} className="border-b border-[#f4f2ee]">
                      <td className="py-2 px-2.5"><Ref href={row.kind === 'deposit' ? links?.deposits : links?.contract}>{row.description}</Ref></td>
                      <td className="py-2 px-2.5">{row.date ? fmtDate(row.date) : '—'}</td>
                      <td className="py-2 px-2.5 text-right tabular-nums">{nf.format(row.amount)}</td>
                      <td className="py-2 px-2.5">{row.mode || '—'}</td>
                      <td className="py-2 px-2.5">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          row.status.startsWith('Cleared') ? 'bg-[#eef7f3] text-[#1a7a5a]'
                          : row.status === 'Cancelled' || row.status === 'Bounced' || row.status === 'Forfeited' ? 'bg-[#fdecea] text-[#b91c1c]'
                          : 'bg-[#fff7ed] text-[#9a3412]'}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Two-column body: Rent + Final Balance + Notes (left) · Deposit Summary (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-8">
          {/* LEFT COLUMN */}
          <div className="space-y-8">
            {showRentSection && (
              <section>
                <SecHead n="2" title="Rent Summary" />
                <table className="w-full text-[12px]">
                  <tbody>
                    {rentRows.map((row, i) => (
                      <tr key={i} className="border-b border-[#f4f2ee]">
                        <td className="py-2 px-2.5"><Ref href={row.href}>{row.label}</Ref></td>
                        <td className={`py-2 px-2.5 text-right tabular-nums ${row.accent ? 'text-[#1a7a5a] font-bold' : ''}`}>{nf.format(row.amount)}</td>
                      </tr>
                    ))}
                    {r.chequeToBeReturned && (
                      <tr><td className="py-2 px-2.5"><Ref href={links?.contract}>Cheque To Be Returned</Ref></td><td className="py-2 px-2.5 text-right">{r.chequeToBeReturned}</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            )}

            <section>
              <SecHead n="4" title="Final Balance Summary" />
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[#9b9890] text-[10px] uppercase tracking-wide">
                    <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Category</th>
                    <th className="text-right font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Amount (AED)</th>
                  </tr>
                </thead>
                <tbody>
                  {finalRows.map((row, i) => (
                    <tr key={i} className="border-b border-[#f4f2ee]">
                      <td className="py-2 px-2.5"><Ref href={row.href}>{row.label}</Ref>{row.note ? <span className="block text-[10.5px] text-[#9b9890] italic">{row.note}</span> : null}</td>
                      <td className={`py-2 px-2.5 text-right tabular-nums ${row.owed ? 'text-[#b91c1c]' : ''}`}>{nf.format(Math.abs(row.amount))}{row.owed ? ' (owed)' : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#eceae4]">
                    <td className={`py-2.5 px-2.5 font-extrabold ${owe ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>FINAL BALANCE ({owe ? 'Payable' : settled ? 'Settled' : 'Refundable'})</td>
                    <td className={`py-2.5 px-2.5 text-right font-extrabold tabular-nums ${owe ? 'text-[#b91c1c]' : 'text-[#1a7a5a]'}`}>{nf.format(Math.abs(data.balance))}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            {data.payments.length > 0 && (
              <section>
                <SecHead n="+" title="Payments Received from Tenant" />
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[#9b9890] text-[10px] uppercase tracking-wide">
                    <th className="text-right font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Amount</th>
                    <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Method</th>
                    <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Reference</th>
                    <th className="text-left font-semibold py-1.5 px-2.5 border-b border-[#eceae4]">Received</th>
                  </tr></thead>
                  <tbody>
                    {data.payments.map((p, i) => (
                      <tr key={i} className="border-b border-[#f4f2ee]">
                        <td className="py-2 px-2.5 text-right tabular-nums">{nf.format(p.amount)}</td>
                        <td className="py-2 px-2.5"><Ref href={links?.worksheet}>{METHOD_LABEL[p.method] ?? p.method}</Ref></td>
                        <td className="py-2 px-2.5">{p.reference || '—'}</td>
                        <td className="py-2 px-2.5">{p.receivedOn ? fmtDate(p.receivedOn) : '—'}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[#eceae4]"><td className="py-2 px-2.5 text-right font-bold text-[#1a7a5a] tabular-nums">{nf.format(data.paymentsReceivedTotal)}</td><td className="py-2 px-2.5 font-bold text-[#1a7a5a]" colSpan={3}>Total received</td></tr>
                  </tbody>
                </table>
              </section>
            )}

            <section>
              <SecHead n="5" title="Notes" />
              {data.notes
                ? <p className="text-[12px] text-[#4b4a45] whitespace-pre-wrap">{data.notes}</p>
                : <ul className="text-[11.5px] text-[#6b6860] list-disc pl-5 space-y-1">
                    <li>All calculations are based on confirmed invoices and rent records.</li>
                    <li>Any additional damages after move-out inspection may be charged separately.</li>
                    <li>Security deposit refund is subject to final inspection clearance.</li>
                    <li>Tenant must settle all dues before any refund is released.</li>
                  </ul>}
            </section>
          </div>

          {/* RIGHT COLUMN — Section 3 Security Deposit Summary */}
          {showDepositSection && (
            <div>
              <SecHead n="3" title="Security Deposit Summary" />
              {restorationRows.length > 0 && (
                <SubTable tag="B" title="Restoration &amp; Deductions" rows={restorationRows} total={restorationTotal} hasDates={false} />
              )}
              {refundableRows.length > 0 && (
                <SubTable tag="D" title="Security Deposit Refundable" rows={refundableRows} total={depositRefundable} hasDates={!!depositDate} />
              )}
            </div>
          )}
        </div>

        {/* Section 6 — signatures */}
        <section className="mt-8 pt-6 border-t border-[#eceae4]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#f2faf6] flex items-center justify-center shrink-0"><Building2 size={18} className="text-[#2e9f82]" /></div>
              <div className="flex-1 text-[12px] text-[#6b6860]">
                <div className="flex items-baseline gap-2">Property Manager: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
                <div className="flex items-baseline gap-2 mt-4">Signature: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
                <div className="flex items-baseline gap-2 mt-4">Date: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#f2faf6] flex items-center justify-center shrink-0"><User size={18} className="text-[#2e9f82]" /></div>
              <div className="flex-1 text-[12px] text-[#6b6860]">
                <div className="flex items-baseline gap-2">Tenant Name: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
                <div className="flex items-baseline gap-2 mt-4">Signature: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
                <div className="flex items-baseline gap-2 mt-4">Date: <span className="flex-1 border-b border-dotted border-[#b9b6ae]" /></div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="px-7 py-3 sm:px-9 border-t border-[#eceae4] bg-[#fafbfc] text-[10.5px] text-[#9b9890]">
        <span className="font-semibold text-[#6b6860]">Note:</span> This statement is for settlement purposes only and does not constitute a waiver of any rights or obligations under the tenancy agreement.
      </div>
    </div>
  );
}
