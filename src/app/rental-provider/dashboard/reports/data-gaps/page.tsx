/**
 * Data Gaps & Exceptions — the "what needs fixing" report for the RP/CEO.
 *
 * Unlike the generic /reports/[slug] table reports, this endpoint returns a
 * multi-section payload (deposits missing, renewal backlog, KYC gaps, units
 * missing details, empty properties), so it gets its own page. All money here
 * is whole AED (the endpoint casts annual_rent::int — NOT fils).
 *
 * Backend: GET /api/reports/data-gaps  (ReportsService.getDataGapsReport)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, Loader2, AlertCircle, ShieldCheck, Wallet,
  RefreshCw, FileWarning, Building2, BarChart2, ExternalLink,
} from 'lucide-react';

const ENDPOINT = '/api/reports/data-gaps';

interface DepositGap { contractId: number; customer: string | null; property: string | null; unit: string | null; annualRent: number | null; }
interface RenewalPending { customer: string | null; property: string | null; unit: string | null; expiredOn: string | null; daysOverdue: number | null; annualRent: number | null; overdue: boolean; }
interface KycIndividual { customer: string | null; units: string | null; noEid: boolean; noNationality: boolean; noDob: boolean; noGender: boolean; noPhone: boolean; }
interface KycCompany { customer: string | null; units: string | null; noTradeLicense: boolean; noEid: boolean; noPhone: boolean; }
interface DocGap { customer: string | null; unit: string | null; hasBank: boolean; expiredIds: string | null; }
interface UnitMissing { property: string | null; unit: string | null; type: string | null; noFloorPlan: boolean; noMarketPrice: boolean; noRentalPrice: boolean; noBedrooms: boolean; noSize: boolean; noImages: boolean; }
interface EmptyProperty { property: string | null; category: string | null; }
interface DataGaps {
  generatedAt: string;
  deposits: DepositGap[];
  documentGaps: DocGap[];
  renewals: { total: number; completed: number; overduePending: number; upcomingPending: number; pending: RenewalPending[] };
  emptyProperties: EmptyProperty[];
  unitsSummary: { total: number; noImages: number; noFloorPlan: number; noMarketPrice: number; noRentalPrice: number };
  unitsMissing: UnitMissing[];
  kycSummary: Record<string, number>;
  kycIndividuals: KycIndividual[];
  kycCompanies: KycCompany[];
}

const fmtAed = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(n ?? 0));
const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** Small red "missing X" pill. */
function MissingChip({ label, on }: { label: string; on: boolean }) {
  if (!on) return null;
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fee2e2] text-[#b91c1c] mr-1 mb-1">{label}</span>;
}

/** Exception KPI tile — severity tints the number. */
function StatTile({ icon: Icon, label, value, tone }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: number; tone: 'red' | 'amber' | 'neutral' }) {
  const toneCls = tone === 'red' ? 'text-[#b91c1c]' : tone === 'amber' ? 'text-[#b45309]' : 'text-[#1a1916]';
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">
        <Icon size={12} /> {label}
      </div>
      <p className={`text-2xl font-bold mt-1 ${value > 0 ? toneCls : 'text-[#c8c6c0]'}`}>{value}</p>
    </div>
  );
}

/** A collapsible-free section card with a title, count and a table. Hidden when empty. */
function Section({ icon: Icon, title, count, children }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#f0ede8]">
        <Icon size={15} className="text-[#2e9f82]" />
        <h2 className="text-sm font-bold text-[#1a1916]">{title}</h2>
        <span className="text-xs font-semibold text-[#9b9890] bg-[#f4f3ef] rounded-full px-2 py-0.5">{count}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <th className={`px-4 py-2.5 font-semibold ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
const TD = ({ children, right }: { children: React.ReactNode; right?: boolean }) =>
  <td className={`px-4 py-2.5 ${right ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>{children}</td>;

export default function DataGapsPage() {
  const [data, setData] = useState<DataGaps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(ENDPOINT, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6 print:p-0">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          <Link href="/rental-provider/dashboard/reports" className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
            <ArrowLeft size={12} /> All Reports
          </Link>
          <h1 className="text-2xl font-bold text-[#1a1916]">Data Gaps &amp; Exceptions</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">Everything that needs attention to keep the portfolio clean and compliant — active leases missing a deposit, the renewal backlog, KYC gaps, and units missing key details.</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={!data || loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
          style={{ background: '#2e9f82' }}>
          <Printer size={14} /> Print / PDF
        </button>
      </div>

      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Data Gaps &amp; Exceptions</h1>
        {data && <p className="text-xs text-gray-500 mt-1">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm text-red-700">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 flex items-center justify-center">
          <Loader2 size={20} className="animate-spin text-[#2e9f82]" />
        </div>
      ) : data ? (
        <>
          {/* Exception KPI tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
            <StatTile icon={Wallet}     label="No deposit"        value={data.deposits.length}            tone="red" />
            <StatTile icon={RefreshCw}  label="Renewal overdue"   value={data.renewals.overduePending}    tone="red" />
            <StatTile icon={RefreshCw}  label="Renewal upcoming"  value={data.renewals.upcomingPending}   tone="amber" />
            <StatTile icon={ShieldCheck} label="KYC (individuals)" value={data.kycIndividuals.length}     tone="amber" />
            <StatTile icon={ShieldCheck} label="KYC (companies)"   value={data.kycCompanies.length}       tone="amber" />
            <StatTile icon={Building2}  label="Units missing data" value={data.unitsMissing.length}       tone="amber" />
            <StatTile icon={Building2}  label="Empty properties"  value={data.emptyProperties.length}     tone="neutral" />
          </div>

          <div className="space-y-4">
            {/* Active leases missing a deposit */}
            <Section icon={Wallet} title="Active leases missing a deposit" count={data.deposits.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Property</TH><TH>Unit</TH><TH right>Annual rent</TH><th className="px-3 print:hidden" /></tr>
                </thead>
                <tbody>
                  {data.deposits.map((d, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{d.customer ?? '—'}</TD><TD>{d.property ?? '—'}</TD><TD>{d.unit ?? '—'}</TD>
                      <TD right>{fmtAed(d.annualRent)}</TD>
                      <td className="px-3 py-2.5 text-right print:hidden">
                        <Link href={`/rental-provider/dashboard/contracts/${d.contractId}/v2`} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">Open <ExternalLink size={12} /></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Renewal backlog */}
            <Section icon={RefreshCw} title="Renewal backlog (lapsed or ending this year, not yet renewed)" count={data.renewals.pending.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Property</TH><TH>Unit</TH><TH>Lease ended</TH><TH right>Days overdue</TH><TH right>Annual rent</TH><TH>Status</TH></tr>
                </thead>
                <tbody>
                  {data.renewals.pending.map((r, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{r.customer ?? '—'}</TD><TD>{r.property ?? '—'}</TD><TD>{r.unit ?? '—'}</TD>
                      <TD>{fmtDate(r.expiredOn)}</TD>
                      <TD right>{r.overdue ? (r.daysOverdue ?? 0) : '—'}</TD>
                      <TD right>{fmtAed(r.annualRent)}</TD>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${r.overdue ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#fef3c7] text-[#854d0e]'}`}>{r.overdue ? 'Overdue' : 'Upcoming'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* KYC — individuals */}
            <Section icon={ShieldCheck} title="KYC gaps — individual customers" count={data.kycIndividuals.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Units</TH><TH>Missing</TH></tr>
                </thead>
                <tbody>
                  {data.kycIndividuals.map((k, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{k.customer ?? '—'}</TD><TD>{k.units ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Emirates ID" on={k.noEid} /><MissingChip label="Nationality" on={k.noNationality} />
                        <MissingChip label="Date of birth" on={k.noDob} /><MissingChip label="Gender" on={k.noGender} />
                        <MissingChip label="Phone" on={k.noPhone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* KYC — companies */}
            <Section icon={ShieldCheck} title="KYC gaps — company customers" count={data.kycCompanies.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Units</TH><TH>Missing</TH></tr>
                </thead>
                <tbody>
                  {data.kycCompanies.map((k, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{k.customer ?? '—'}</TD><TD>{k.units ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Trade licence" on={k.noTradeLicense} /><MissingChip label="Signatory EID" on={k.noEid} />
                        <MissingChip label="Phone" on={k.noPhone} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Document gaps */}
            <Section icon={FileWarning} title="Document gaps (missing bank statement / expired IDs)" count={data.documentGaps.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Unit</TH><TH>Issues</TH></tr>
                </thead>
                <tbody>
                  {data.documentGaps.map((d, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{d.customer ?? '—'}</TD><TD>{d.unit ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Bank statement" on={!d.hasBank} />
                        {d.expiredIds ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fed7aa] text-[#9a3412]">Expired: {d.expiredIds}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Units missing details */}
            <Section icon={Building2} title="Units missing details" count={data.unitsMissing.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Property</TH><TH>Unit</TH><TH>Type</TH><TH>Missing</TH></tr>
                </thead>
                <tbody>
                  {data.unitsMissing.map((u, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{u.property ?? '—'}</TD><TD>{u.unit ?? '—'}</TD><TD>{u.type ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Floor plan" on={u.noFloorPlan} /><MissingChip label="Market price" on={u.noMarketPrice} />
                        <MissingChip label="Rental price" on={u.noRentalPrice} /><MissingChip label="Bedrooms" on={u.noBedrooms} />
                        <MissingChip label="Size" on={u.noSize} /><MissingChip label="Images" on={u.noImages} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Empty properties */}
            <Section icon={Building2} title="Properties with no units" count={data.emptyProperties.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Property</TH><TH>Category</TH></tr>
                </thead>
                <tbody>
                  {data.emptyProperties.map((p, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{p.property ?? '—'}</TD><TD>{p.category ?? '—'}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Nothing to fix */}
            {!data.deposits.length && !data.renewals.pending.length && !data.kycIndividuals.length &&
             !data.kycCompanies.length && !data.documentGaps.length && !data.unitsMissing.length && !data.emptyProperties.length && (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
                <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
                <p className="text-sm font-semibold text-[#1a1916]">No gaps found</p>
                <p className="text-xs text-[#9b9890] mt-1">Every active lease has a deposit, KYC is complete, and units have their details.</p>
              </div>
            )}
          </div>

          <p className="text-[11px] text-[#9b9890] mt-4">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>
        </>
      ) : null}
    </div>
  );
}
