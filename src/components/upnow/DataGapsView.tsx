/**
 * Data Gaps & Exceptions — shared view used by BOTH portals (RP route wrapper
 * + manager inline drill-down with /api/manager/reports/data-gaps?rp=N).
 *
 * Unlike the generic /reports/[slug] table reports, this endpoint returns a
 * multi-section payload (contracts missing docs/payment-plan/deposit, property
 * field gaps, units missing details, customer KYC gaps, and the landlord's own
 * profile/config), so it gets its own page. Each section hides itself once its
 * count hits zero, so records drop off automatically as they are filled. All
 * money here is whole AED (the endpoint casts annual_rent::int — NOT fils).
 *
 * Backend: GET /api/reports/data-gaps  (ReportsService.getDataGapsReport)
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, Loader2, AlertCircle, ShieldCheck, Wallet,
  RefreshCw, FileWarning, Building2, BarChart2, ExternalLink,
  FileText, UserCog, MapPin,
} from 'lucide-react';



interface ContractGap { contractId: number; customer: string | null; property: string | null; unit: string | null; status: string | null; annualRent: number | null; noContractDoc: boolean; noPaymentPlan: boolean; noDeposit: boolean; noEjari: boolean; }
interface PropertyGap { id: number; property: string | null; category: string | null; noPhotos: boolean; noGeo: boolean; noFloors: boolean; noDescription: boolean; noStreet: boolean; noCountry: boolean; noEmirate: boolean; noCity: boolean; noCommunity: boolean; noSubCommunity: boolean; noMakani: boolean; noPlot: boolean; noAddress: boolean; noFeatures: boolean; }
interface Landlord { name: string | null; entityType: string | null; noCompanyName: boolean; noContactAddress: boolean; noBank: boolean; noTradeLicense: boolean; noEid: boolean; noPassport: boolean; noNationality: boolean; noDob: boolean; noGender: boolean; noTitleDeedDoc: boolean; noEidDoc: boolean; noLegalNoticesAddr: boolean; noRenewalPct: boolean; noPreferredStartDays: boolean; noPreferredChequeDays: boolean; noPoa: boolean; }
interface RenewalPending { customer: string | null; property: string | null; unit: string | null; expiredOn: string | null; daysOverdue: number | null; annualRent: number | null; overdue: boolean; }
interface KycIndividual { customer: string | null; units: string | null; noEid: boolean; noNationality: boolean; noDob: boolean; noGender: boolean; noPhone: boolean; noOccupation: boolean; noPhoto: boolean; noIdentityDoc: boolean; }
interface KycCompany { customer: string | null; units: string | null; noTradeLicense: boolean; noEid: boolean; noPhone: boolean; noIdentityDoc: boolean; }
interface DocGap { customer: string | null; unit: string | null; hasBank: boolean; expiredIds: string | null; }
interface UnitMissing { unitId: number; propertyId: number; property: string | null; unit: string | null; type: string | null; noFloorPlan: boolean; noMarketPrice: boolean; noRentalPrice: boolean; noDeposit: boolean; noAdminFee: boolean; noEjariFee: boolean; noCommission: boolean; noBedrooms: boolean; noBathrooms: boolean; noSize: boolean; noFloor: boolean; noKitchen: boolean; noView: boolean; noFurnishing: boolean; noParking: boolean; noPremise: boolean; noDescription: boolean; noImages: boolean; }
interface EmptyProperty { property: string | null; category: string | null; }
interface DataGaps {
  generatedAt: string;
  contractGaps: ContractGap[];
  propertyGaps: PropertyGap[];
  landlord: Landlord | null;
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

/** Count the truthy "noXxx" flags on a row object. */
const countGaps = (o: Record<string, unknown> | null | undefined) =>
  o ? Object.entries(o).filter(([k, v]) => k.startsWith('no') && v === true).length : 0;

/** Small red "missing X" pill. */
function MissingChip({ label, on }: { label: string; on: boolean }) {
  if (!on) return null;
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fee2e2] text-[#b91c1c] mr-1 mb-1">{label}</span>;
}

/** Contract status badge. */
function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? '';
  const cls = s === 'active' ? 'bg-[#dcfce7] text-[#166534]' : s === 'pending' ? 'bg-[#fef3c7] text-[#854d0e]' : 'bg-[#f1f0ec] text-[#6b6860]';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{s || '—'}</span>;
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

export function DataGapsView({
  endpoint = '/api/reports/data-gaps',
  backHref = '/rental-provider/dashboard/reports',
  onBack,
}: {
  endpoint?: string;
  backHref?: string;
  onBack?: () => void;
} = {}) {
  const [data, setData] = useState<DataGaps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    fetch(endpoint, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(`Error ${r.status}`))
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [endpoint]);

  const landlordGaps = countGaps(data?.landlord as Record<string, unknown> | null);
  const nothingToFix = data &&
    !data.contractGaps.length && !data.propertyGaps.length && !landlordGaps &&
    !data.renewals.pending.length && !data.kycIndividuals.length && !data.kycCompanies.length &&
    !data.documentGaps.length && !data.unitsMissing.length && !data.emptyProperties.length;

  return (
    <div className="p-6 print:p-0">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          {onBack ? (
            <button type="button" onClick={onBack} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </button>
          ) : (
            <Link href={backHref} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[#1a1916]">Data Gaps &amp; Exceptions</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">A live worklist of everything that needs filling to keep the portfolio clean and compliant — contracts missing documents, payment plans or a deposit; properties and units missing details; customer KYC; and the landlord&apos;s own profile. Rows drop off automatically as the data is completed. Print to PDF to hand to whoever is filling it.</p>
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
            <StatTile icon={FileText}    label="Contracts w/ gaps"  value={data.contractGaps.length}        tone="red" />
            <StatTile icon={MapPin}      label="Properties w/ gaps" value={data.propertyGaps.length}        tone="amber" />
            <StatTile icon={Building2}   label="Units missing data" value={data.unitsMissing.length}        tone="amber" />
            <StatTile icon={ShieldCheck} label="Customers (KYC)"     value={data.kycIndividuals.length + data.kycCompanies.length} tone="amber" />
            <StatTile icon={UserCog}     label="Landlord profile"   value={landlordGaps}                    tone="amber" />
            <StatTile icon={RefreshCw}   label="Renewal overdue"    value={data.renewals.overduePending}    tone="red" />
            <StatTile icon={Building2}   label="Empty properties"   value={data.emptyProperties.length}     tone="neutral" />
          </div>

          <div className="space-y-4">
            {/* Landlord profile & configuration */}
            {data.landlord && landlordGaps > 0 && (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
                <div className="flex items-center gap-2 px-5 py-3.5 border-b border-[#f0ede8]">
                  <UserCog size={15} className="text-[#2e9f82]" />
                  <h2 className="text-sm font-bold text-[#1a1916]">Landlord profile &amp; configuration{data.landlord.name ? ` — ${data.landlord.name}` : ''}</h2>
                  <span className="text-xs font-semibold text-[#9b9890] bg-[#f4f3ef] rounded-full px-2 py-0.5">{landlordGaps}</span>
                  <Link href="/rental-provider/dashboard/settings" className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline print:hidden">Open settings <ExternalLink size={12} /></Link>
                </div>
                <div className="px-5 py-4">
                  <MissingChip label="Company name" on={data.landlord.noCompanyName} />
                  <MissingChip label="Contact address" on={data.landlord.noContactAddress} />
                  <MissingChip label="Bank details" on={data.landlord.noBank} />
                  <MissingChip label="Trade licence" on={data.landlord.noTradeLicense} />
                  <MissingChip label="Emirates ID no." on={data.landlord.noEid} />
                  <MissingChip label="Passport no." on={data.landlord.noPassport} />
                  <MissingChip label="Nationality" on={data.landlord.noNationality} />
                  <MissingChip label="Date of birth" on={data.landlord.noDob} />
                  <MissingChip label="Gender" on={data.landlord.noGender} />
                  <MissingChip label="Title-deed document" on={data.landlord.noTitleDeedDoc} />
                  <MissingChip label="Emirates ID document" on={data.landlord.noEidDoc} />
                  <MissingChip label="Legal-notices address" on={data.landlord.noLegalNoticesAddr} />
                  <MissingChip label="Renewal increment %" on={data.landlord.noRenewalPct} />
                  <MissingChip label="Preferred start days" on={data.landlord.noPreferredStartDays} />
                  <MissingChip label="Preferred cheque days" on={data.landlord.noPreferredChequeDays} />
                  <MissingChip label="Power of attorney" on={data.landlord.noPoa} />
                </div>
              </div>
            )}

            {/* Contracts missing documents / payment plan / deposit / Ejari */}
            <Section icon={FileText} title="Contracts missing documents, payment plan, deposit or Ejari" count={data.contractGaps.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Property</TH><TH>Unit</TH><TH>Status</TH><TH right>Annual rent</TH><TH>Missing</TH><th className="px-3 print:hidden" /></tr>
                </thead>
                <tbody>
                  {data.contractGaps.map((c, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{c.customer ?? '—'}</TD><TD>{c.property ?? '—'}</TD><TD>{c.unit ?? '—'}</TD>
                      <td className="px-4 py-2.5"><StatusBadge status={c.status} /></td>
                      <TD right>{fmtAed(c.annualRent)}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Contract document" on={c.noContractDoc} />
                        <MissingChip label="Payment plan" on={c.noPaymentPlan} />
                        <MissingChip label="Security deposit" on={c.noDeposit} />
                        <MissingChip label="Ejari number" on={c.noEjari} />
                      </td>
                      <td className="px-3 py-2.5 text-right print:hidden">
                        <Link href={`/rental-provider/dashboard/contracts/${c.contractId}/v2`} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">Open <ExternalLink size={12} /></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Properties missing fields */}
            <Section icon={MapPin} title="Properties missing details" count={data.propertyGaps.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Property</TH><TH>Category</TH><TH>Missing</TH><th className="px-3 print:hidden" /></tr>
                </thead>
                <tbody>
                  {data.propertyGaps.map((p, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{p.property ?? '—'}</TD><TD>{p.category ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Photos" on={p.noPhotos} />
                        <MissingChip label="Full address" on={p.noAddress} />
                        <MissingChip label="Map location" on={p.noGeo} />
                        <MissingChip label="Street" on={p.noStreet} />
                        <MissingChip label="Country" on={p.noCountry} />
                        <MissingChip label="Emirate" on={p.noEmirate} />
                        <MissingChip label="City" on={p.noCity} />
                        <MissingChip label="Community" on={p.noCommunity} />
                        <MissingChip label="Sub-community" on={p.noSubCommunity} />
                        <MissingChip label="Makani" on={p.noMakani} />
                        <MissingChip label="Plot no." on={p.noPlot} />
                        <MissingChip label="No. of floors" on={p.noFloors} />
                        <MissingChip label="Description" on={p.noDescription} />
                        <MissingChip label="Features" on={p.noFeatures} />
                      </td>
                      <td className="px-3 py-2.5 text-right print:hidden">
                        <Link href="/rental-provider/dashboard/portfolio" className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">Open <ExternalLink size={12} /></Link>
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
                  <tr><TH>Property</TH><TH>Unit</TH><TH>Type</TH><TH>Missing</TH><th className="px-3 print:hidden" /></tr>
                </thead>
                <tbody>
                  {data.unitsMissing.map((u, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{u.property ?? '—'}</TD><TD>{u.unit ?? '—'}</TD><TD>{u.type ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Rental price" on={u.noRentalPrice} /><MissingChip label="Market price" on={u.noMarketPrice} />
                        <MissingChip label="Deposit" on={u.noDeposit} /><MissingChip label="Admin fee" on={u.noAdminFee} />
                        <MissingChip label="Ejari fee" on={u.noEjariFee} /><MissingChip label="Commission" on={u.noCommission} />
                        <MissingChip label="Bedrooms" on={u.noBedrooms} /><MissingChip label="Bathrooms" on={u.noBathrooms} />
                        <MissingChip label="Size" on={u.noSize} /><MissingChip label="Floor" on={u.noFloor} />
                        <MissingChip label="Kitchen" on={u.noKitchen} /><MissingChip label="View" on={u.noView} />
                        <MissingChip label="Furnishing" on={u.noFurnishing} /><MissingChip label="Parking" on={u.noParking} />
                        <MissingChip label="Premise no." on={u.noPremise} /><MissingChip label="Description" on={u.noDescription} />
                        <MissingChip label="Floor plan" on={u.noFloorPlan} /><MissingChip label="Images" on={u.noImages} />
                      </td>
                      <td className="px-3 py-2.5 text-right print:hidden">
                        <Link href={`/rental-provider/dashboard/portfolio/${u.propertyId}/units/${u.unitId}`} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">Open <ExternalLink size={12} /></Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* KYC — individuals */}
            <Section icon={ShieldCheck} title="Customer KYC gaps — individuals" count={data.kycIndividuals.length}>
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                  <tr><TH>Customer</TH><TH>Units</TH><TH>Missing</TH></tr>
                </thead>
                <tbody>
                  {data.kycIndividuals.map((k, i) => (
                    <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                      <TD>{k.customer ?? '—'}</TD><TD>{k.units ?? '—'}</TD>
                      <td className="px-4 py-2.5">
                        <MissingChip label="Emirates ID no." on={k.noEid} /><MissingChip label="ID document" on={k.noIdentityDoc} />
                        <MissingChip label="Nationality" on={k.noNationality} /><MissingChip label="Date of birth" on={k.noDob} />
                        <MissingChip label="Gender" on={k.noGender} /><MissingChip label="Phone" on={k.noPhone} />
                        <MissingChip label="Occupation" on={k.noOccupation} /><MissingChip label="Photo" on={k.noPhoto} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* KYC — companies */}
            <Section icon={ShieldCheck} title="Customer KYC gaps — companies" count={data.kycCompanies.length}>
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
                        <MissingChip label="ID document" on={k.noIdentityDoc} /><MissingChip label="Phone" on={k.noPhone} />
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
            {nothingToFix && (
              <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
                <BarChart2 size={32} className="mx-auto text-[#c8c6c0] mb-3" />
                <p className="text-sm font-semibold text-[#1a1916]">No gaps found</p>
                <p className="text-xs text-[#9b9890] mt-1">Every contract, property, unit and customer is complete, and the landlord profile is filled in.</p>
              </div>
            )}
          </div>

          <p className="text-[11px] text-[#9b9890] mt-4">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>
        </>
      ) : null}
    </div>
  );
}
