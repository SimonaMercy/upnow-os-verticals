/**
 * MissingDataView — one generic, config-driven view that powers the five
 * focused "Missing X Data" reports (properties, units, customers, contracts,
 * landlord profile). Each report is a live worklist: a row disappears the
 * moment its data is filled, and the Print / PDF button hands a snapshot to
 * whoever is doing the data entry.
 *
 * Shared by BOTH portals — the RP route pages render it with /api/reports/<slug>
 * and the manager portal renders it inline with /api/manager/reports/<slug>?rp=N.
 *
 * The backend returns { generatedAt, rows: [...] } where each row carries the
 * display columns plus a set of boolean "noXxx" flags; this view renders only
 * the flags that are true as red "missing X" chips.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Printer, Loader2, AlertCircle, ExternalLink, CheckCircle2,
} from 'lucide-react';

export interface MissingColumn { key: string; label: string; type?: 'text' | 'status' | 'currency'; right?: boolean; }
export interface MissingChipDef { key: string; label: string; }
export interface MissingReportConfig {
  title: string;
  description: string;
  /** Plural noun for the KPI tile, e.g. "properties", "units". */
  unitLabel: string;
  columns: MissingColumn[];
  chips: MissingChipDef[];
  /** Deep link to fix the record, or null for no link. */
  openHref?: (row: Record<string, unknown>) => string | null;
  /** Shown in the empty state when nothing is missing. */
  emptyHint?: string;
}

interface Payload { generatedAt: string; rows: Record<string, unknown>[]; }

const fmtAed = (n: unknown) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(n ?? 0));

function MissingChip({ label }: { label: string }) {
  return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fee2e2] text-[#b91c1c] mr-1 mb-1">{label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-[#dcfce7] text-[#166534]' : status === 'pending' ? 'bg-[#fef3c7] text-[#854d0e]' : 'bg-[#f1f0ec] text-[#6b6860]';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>{status || '—'}</span>;
}

export function MissingDataView({
  config,
  endpoint,
  backHref,
  onBack,
}: {
  config: MissingReportConfig;
  endpoint: string;
  backHref?: string;
  onBack?: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
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

  const rows = data?.rows ?? [];

  const renderCell = (col: MissingColumn, row: Record<string, unknown>) => {
    const v = row[col.key];
    if (col.type === 'status') return <StatusBadge status={String(v ?? '')} />;
    if (col.type === 'currency') return fmtAed(v);
    return (v ?? '—') as React.ReactNode;
  };

  return (
    <div className="p-6 print:p-0">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4 print:hidden">
        <div>
          {onBack ? (
            <button type="button" onClick={onBack} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </button>
          ) : backHref ? (
            <Link href={backHref} className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
              <ArrowLeft size={12} /> All Reports
            </Link>
          ) : null}
          <h1 className="text-2xl font-bold text-[#1a1916]">{config.title}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5 max-w-2xl">{config.description}</p>
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
        <h1 className="text-2xl font-bold">{config.title}</h1>
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
        rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
            <CheckCircle2 size={32} className="mx-auto text-[#2e9f82] mb-3" />
            <p className="text-sm font-semibold text-[#1a1916]">Nothing missing</p>
            <p className="text-xs text-[#9b9890] mt-1">{config.emptyHint ?? `Every record has its ${config.unitLabel} data filled in.`}</p>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <div className="inline-flex bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold">{config.unitLabel} needing attention</div>
                  <p className="text-2xl font-bold mt-1 text-[#b91c1c]">{rows.length}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden print:break-inside-avoid">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890]">
                    <tr>
                      {config.columns.map(c => (
                        <th key={c.key} className={`px-4 py-2.5 font-semibold ${c.right ? 'text-right' : 'text-left'}`}>{c.label}</th>
                      ))}
                      <th className="px-4 py-2.5 font-semibold text-left">Missing</th>
                      {config.openHref && <th className="px-3 print:hidden" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => {
                      const href = config.openHref?.(row) ?? null;
                      return (
                        <tr key={i} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                          {config.columns.map(c => (
                            <td key={c.key} className={`px-4 py-2.5 ${c.right ? 'text-right tabular-nums' : 'text-left'} text-[#1a1916]`}>
                              {renderCell(c, row)}
                            </td>
                          ))}
                          <td className="px-4 py-2.5">
                            {config.chips.filter(ch => row[ch.key] === true).map(ch => <MissingChip key={ch.key} label={ch.label} />)}
                          </td>
                          {config.openHref && (
                            <td className="px-3 py-2.5 text-right print:hidden">
                              {href && (
                                <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">Open <ExternalLink size={12} /></Link>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-[11px] text-[#9b9890] mt-4">Generated {new Date(data.generatedAt).toLocaleString('en-AE')}</p>
          </>
        )
      ) : null}
    </div>
  );
}

const RP = '/rental-provider/dashboard';

/** Config for each focused missing-data report, keyed by slug. Shared by the RP
 *  route pages and the manager portal so the two can't drift. */
export const MISSING_REPORTS: Record<string, MissingReportConfig> = {
  'missing-properties': {
    title: 'Missing Properties Data',
    description: 'Properties still missing location or descriptive details. Fill them in and the row clears automatically.',
    unitLabel: 'Properties',
    columns: [{ key: 'property', label: 'Property' }, { key: 'category', label: 'Category' }],
    chips: [
      { key: 'noAddress', label: 'Full address' }, { key: 'noGeo', label: 'Map location' },
      { key: 'noStreet', label: 'Street' }, { key: 'noEmirate', label: 'Emirate' },
      { key: 'noCity', label: 'City' }, { key: 'noCommunity', label: 'Community' },
      { key: 'noSubCommunity', label: 'Sub-community' },
      { key: 'noMakani', label: 'Makani' }, { key: 'noPlot', label: 'Plot no.' },
      { key: 'noFloors', label: 'No. of floors' }, { key: 'noDescription', label: 'Description' },
    ],
    openHref: () => `${RP}/portfolio`,
  },
  'missing-units': {
    title: 'Missing Units Data',
    description: 'Units still missing pricing, fees, specs or media. Fill them in and the row clears automatically.',
    unitLabel: 'Units',
    columns: [{ key: 'property', label: 'Property' }, { key: 'unit', label: 'Unit' }, { key: 'type', label: 'Type' }],
    chips: [
      { key: 'noRentalPrice', label: 'Rental price' }, { key: 'noMarketPrice', label: 'Market price' },
      { key: 'noDeposit', label: 'Deposit' }, { key: 'noAdminFee', label: 'Admin fee' },
      { key: 'noEjariFee', label: 'Ejari fee' }, { key: 'noCommission', label: 'Commission' },
      { key: 'noBedrooms', label: 'Bedrooms' }, { key: 'noBathrooms', label: 'Bathrooms' },
      { key: 'noSize', label: 'Size' }, { key: 'noFloor', label: 'Floor' },
      { key: 'noKitchen', label: 'Kitchen' }, { key: 'noView', label: 'View' },
      { key: 'noFurnishing', label: 'Furnishing' }, { key: 'noParking', label: 'Parking' },
      { key: 'noPremise', label: 'Premise no.' }, { key: 'noDescription', label: 'Description' },
      { key: 'noFloorPlan', label: 'Floor plan' }, { key: 'noImages', label: 'Images' },
    ],
    openHref: (row) => `${RP}/portfolio/${row.propertyId}/units/${row.unitId}`,
  },
  'missing-customers': {
    title: 'Missing Customers Data',
    description: 'Customers still missing KYC profile fields or an identity document. Fill them in and the row clears automatically.',
    unitLabel: 'Customers',
    columns: [{ key: 'customer', label: 'Customer' }, { key: 'kind', label: 'Type' }, { key: 'units', label: 'Units' }],
    chips: [
      { key: 'noName', label: 'Name (first/last)' },
      { key: 'noEid', label: 'Emirates ID no.' }, { key: 'noIdentityDoc', label: 'ID document' },
      { key: 'noNationality', label: 'Nationality' }, { key: 'noDob', label: 'Date of birth' },
      { key: 'noGender', label: 'Gender' }, { key: 'noPhone', label: 'Phone' },
      { key: 'noOccupation', label: 'Occupation' }, { key: 'noPhoto', label: 'Photo' },
      { key: 'noTradeLicense', label: 'Trade licence' },
    ],
  },
  'missing-contracts': {
    title: 'Missing Contract Data',
    description: 'Contracts (all statuses) still missing a document, payment plan, security deposit or Ejari number. Active and pending sort to the top.',
    unitLabel: 'Contracts',
    columns: [
      { key: 'customer', label: 'Customer' }, { key: 'property', label: 'Property' }, { key: 'unit', label: 'Unit' },
      { key: 'status', label: 'Status', type: 'status' }, { key: 'annualRent', label: 'Annual rent', type: 'currency', right: true },
    ],
    chips: [
      { key: 'noContractDoc', label: 'Contract document' }, { key: 'noPaymentPlan', label: 'Payment plan' },
      { key: 'noDeposit', label: 'Security deposit' }, { key: 'noEjari', label: 'Ejari number' },
    ],
    openHref: (row) => `${RP}/contracts/${row.contractId}/v2`,
  },
  'missing-landlord': {
    title: 'Missing Landlord Profile Data',
    description: 'Landlord profile and configuration fields still unset — bank details, documents, and the operational settings that drive renewals and cheque scheduling.',
    unitLabel: 'Landlord profiles',
    columns: [{ key: 'name', label: 'Landlord' }, { key: 'entityType', label: 'Type' }],
    chips: [
      { key: 'noCompanyName', label: 'Company name' },
      { key: 'noContactAddress', label: 'Contact address' }, { key: 'noBank', label: 'Bank details' },
      { key: 'noTradeLicense', label: 'Trade licence' }, { key: 'noEid', label: 'Emirates ID no.' },
      { key: 'noPassport', label: 'Passport no.' }, { key: 'noNationality', label: 'Nationality' },
      { key: 'noDob', label: 'Date of birth' }, { key: 'noGender', label: 'Gender' },
      { key: 'noTitleDeedDoc', label: 'Title-deed document' }, { key: 'noEidDoc', label: 'Emirates ID document' },
      { key: 'noLegalNoticesAddr', label: 'Legal-notices address' }, { key: 'noRenewalPct', label: 'Renewal increment %' },
      { key: 'noPreferredStartDays', label: 'Preferred start days' }, { key: 'noPreferredChequeDays', label: 'Preferred cheque days' },
      { key: 'noPoa', label: 'Power of attorney' },
    ],
    openHref: () => `${RP}/settings`,
    emptyHint: 'The landlord profile and configuration are fully filled in.',
  },
};
