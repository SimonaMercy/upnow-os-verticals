'use client';

/**
 * Data Exports — download the full customer / property / unit datasets as CSV
 * straight from the Reports hub. Each file covers every field (blank where
 * missing) so it doubles as a data-gap audit.
 *
 * Scope is decided server-side by role: admins/super-admins get every rental
 * provider's data (whole platform); a rental provider gets only their own
 * portfolio. The buttons only appear for those roles.
 */

import { useState } from 'react';
import {
  FileSpreadsheet, Building2, Users, Building, Boxes, FileSignature, RefreshCw,
  Loader2, Download, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { downloadXlsx } from '@/lib/xlsx';

interface ExportResponse {
  filename: string;
  count: number;
  xlsxBase64: string;
}

interface ExportDef {
  key: string;
  title: string;
  description: string;
  url: string;
  Icon: typeof Building2;
}

const EXPORTS: ExportDef[] = [
  {
    key: 'customers-company',
    title: 'Customers — Company',
    description: 'Company customers with trade-license, KYC & contact details.',
    url: '/api/platform-export/customers?type=company',
    Icon: Building2,
  },
  {
    key: 'customers-individual',
    title: 'Customers — Individual',
    description: 'Individual customers with identity, KYC & contact details.',
    url: '/api/platform-export/customers?type=individual',
    Icon: Users,
  },
  {
    key: 'properties',
    title: 'Properties',
    description: 'Every property with location, classification & amenities.',
    url: '/api/platform-export/properties',
    Icon: Building,
  },
  {
    key: 'units',
    title: 'Units',
    description: 'Every unit with pricing, layout, fees & availability.',
    url: '/api/platform-export/units',
    Icon: Boxes,
  },
  {
    key: 'contracts-new-lease',
    title: 'Contracts — New Lease',
    description: 'New leases: market rent, rent, cheque splits, fees, terms & documents.',
    url: '/api/platform-export/contracts?type=new',
    Icon: FileSignature,
  },
  {
    key: 'contracts-renewal',
    title: 'Contracts — Renewal',
    description: 'Renewals: market rent, rent, cheque splits, fees, terms & documents.',
    url: '/api/platform-export/contracts?type=renewal',
    Icon: RefreshCw,
  },
];

export default function DataExports({ manager }: { manager?: { rp: number } } = {}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Data Exports is hidden platform-wide for now — flip HIDDEN to false to
  // bring it back. Covers both render sites (RP + manager) since both mount
  // this component; the underlying export endpoints stay live.
  const HIDDEN = true;
  if (HIDDEN) return null;

  const role = user?.role;
  const canExport =
    !!manager || role === 'admin' || role === 'super_admin' || role === 'rental_provider';
  if (!canExport) return null;

  const isAdmin = role === 'admin' || role === 'super_admin';
  const scopeLabel = isAdmin
    ? 'Whole platform — all rental providers'
    : manager ? "This landlord's portfolio" : 'Your portfolio';

  // Manager acts for a landlord: route through the /manager/platform-export proxy
  // scoped by ?rp= (canViewReports); RP/admin use the direct endpoint.
  function exportUrl(url: string) {
    if (!manager) return url;
    const mapped = url.replace('/api/platform-export', '/api/manager/platform-export');
    return mapped + (mapped.includes('?') ? '&' : '?') + `rp=${manager.rp}`;
  }

  async function run(def: ExportDef) {
    if (busy) return;
    setError(null);
    setBusy(def.key);
    try {
      const res = await fetch(exportUrl(def.url), { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        throw new Error(
          res.status === 403
            ? "You don't have permission to export this data."
            : `Export failed (${res.status}).`,
        );
      }
      const data: ExportResponse = await res.json();
      if (!data.count) {
        setError(`No ${def.title.toLowerCase()} data to export.`);
        return;
      }
      downloadXlsx(data.filename, data.xlsxBase64);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-9">
      <div className="flex items-baseline gap-2.5 mb-1">
        <span className="w-6 h-6 rounded-lg bg-[#f0faf6] flex items-center justify-center self-center">
          <FileSpreadsheet size={13} className="text-[#2e9f82]" />
        </span>
        <h2 className="text-sm font-bold text-[#1a1916]">Data Exports</h2>
        <span className="text-xs text-[#9b9890]">
          Download full datasets as Excel — incomplete rows highlighted · {scopeLabel}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-[#b4462f] bg-[#fdf1ee] border border-[#f3d7cf] rounded-xl px-3 py-2 mt-2 mb-1">
          <AlertCircle size={13} className="shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
        {EXPORTS.map((def) => {
          const loading = busy === def.key;
          return (
            <button
              key={def.key}
              onClick={() => run(def)}
              disabled={!!busy}
              className="group text-left bg-white rounded-2xl border border-[#e8e6e0] p-5 shadow-sm hover:border-[#2e9f82] hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0 group-hover:bg-[#2e9f82] transition-colors">
                  <def.Icon size={18} className="text-[#2e9f82] group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-[#1a1916] leading-tight">{def.title}</h3>
                  <p className="text-xs text-[#6b6860] mt-1 line-clamp-2">{def.description}</p>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2e9f82] mt-2.5">
                    {loading ? (
                      <><Loader2 size={13} className="animate-spin" /> Preparing…</>
                    ) : (
                      <><Download size={13} /> Download Excel</>
                    )}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
