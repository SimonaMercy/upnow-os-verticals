'use client';

/**
 * RP → Customers → customer summary.
 * GET /api/contracts/tenants/:id → profile/KYC + financials + every lease the
 * customer holds with the RP + their KYC documents.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, User, FileText, CreditCard, ExternalLink, Mail, Phone, IdCard,
  Globe, Calendar, Building2, AlertTriangle, TrendingUp, ShieldCheck, Files,
} from 'lucide-react';
import { openDocsTogether } from '@/lib/openDocsTogether';

type Lease = {
  id: number; ref: string; contractType: string | null; status: string | null;
  contractActive: boolean; ejariStatus: string | null;
  startDate: string | null; endDate: string | null; annualRent: number;
  securityDeposit: number; collected: number; outstanding: number;
  isCurrent: boolean;
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
};
type Doc = {
  id: number; documentKey: string; displayName: string | null; category: string | null;
  status: string | null; fileUrl: string | null; issueDate: string | null;
  expiryDate: string | null; createdAt: string | null;
};
type Financials = {
  totalActiveRent: number; securityDepositHeld: number;
  totalBilled: number; totalCollected: number; totalOutstanding: number; vatCollected: number;
};
type CustomerDetail = {
  customer: {
    id: number; name: string | null; firstName: string | null; lastName: string | null;
    email: string | null; phone: string | null; emiratesId: string | null;
    nationality: string | null; gender: string | null; dateOfBirth: string | null;
    entityType: string | null; companyName: string | null; tradeLicenseNumber: string | null;
  };
  summary: { totalLeases: number; activeLeases: number; totalActiveRent: number; documentCount: number };
  financials: Financials;
  leases: Lease[];
  documents: Doc[];
};

const fmtAed = (n: number | null | undefined) => `AED ${Number(n ?? 0).toLocaleString('en-AE')}`;
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function renewalDays(endDate: string | null): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date();
  return Math.round((end - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
}
function leaseBadge(l: Lease): { label: string; cls: string } {
  if (!l.isCurrent) return { label: 'Renewed', cls: 'bg-[#f4f3ef] text-[#6b6860]' };
  if ((l.status ?? '').toLowerCase() === 'terminated') return { label: 'Terminated', cls: 'bg-[#fee2e2] text-[#b91c1c]' };
  if (l.contractActive) return { label: 'Active', cls: 'bg-[#d8f2e8] text-[#1a7a5a]' };
  return { label: (l.status ?? 'Inactive').replace(/^./, c => c.toUpperCase()), cls: 'bg-[#f4f3ef] text-[#6b6860]' };
}
const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const docTone = (s: string | null) =>
  s === 'processed' ? 'bg-[#d8f2e8] text-[#1a7a5a]' : s === 'pending' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#eef2ff] text-[#3730a3]';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    setLoading(true);
    fetch(`/api/contracts/tenants/${params.id}`, { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(r.status === 403 ? 'This customer has no contracts with you.' : `Error ${r.status}`); return r.json() as Promise<CustomerDetail>; })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [params?.id]);

  if (loading) return <div className="p-6 text-sm text-[#9b9890]">Loading customer…</div>;
  if (error || !data) {
    return (
      <div className="p-6">
        <button onClick={() => router.push('/rental-provider/dashboard/tenants')} className="text-sm text-[#2e9f82] font-medium flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Back to Customers</button>
        <p className="text-sm text-[#b91c1c]">{error ?? 'Customer not found'}</p>
      </div>
    );
  }

  const c = data.customer;
  const fin = data.financials;
  const isCompany = c.entityType === 'company';

  // ── Action items (things needing the RP's attention) — rendered in RED ──
  const actions: string[] = [];
  const missing: string[] = [];
  if (!c.phone) missing.push('phone');
  if (!c.emiratesId) missing.push('Emirates ID');
  if (!c.nationality) missing.push('nationality');
  if (!c.gender) missing.push('gender');
  if (!c.dateOfBirth) missing.push('date of birth');
  if (missing.length) actions.push(`Missing customer details: ${missing.join(', ')}`);
  if (data.documents.length === 0) actions.push('No KYC documents on file');
  const pendingDocs = data.documents.filter(d => d.status === 'pending').length;
  if (pendingDocs) actions.push(`${pendingDocs} document${pendingDocs > 1 ? 's' : ''} pending review`);
  for (const l of data.leases) {
    if (!l.isCurrent) continue; // skip already-renewed (superseded) history
    const d = renewalDays(l.endDate);
    if (d !== null && d < 0) actions.push(`Lease ${l.ref} expired ${Math.abs(d)}d ago — needs renewal`);
    else if (d !== null && d <= 90) actions.push(`Lease ${l.ref} renews in ${d}d`);
  }
  if (fin.totalOutstanding > 0) actions.push(`${fmtAed(fin.totalOutstanding)} outstanding (uncleared cheques)`);

  const SUMMARY = [
    { label: 'Total Leases', value: String(data.summary.totalLeases) },
    { label: 'Active Leases', value: String(data.summary.activeLeases) },
    { label: 'Active Rent / yr', value: fmtAed(data.summary.totalActiveRent) },
    { label: 'Documents', value: String(data.summary.documentCount) },
  ];
  // Financial amounts — Outstanding is an action item, so it renders red.
  const FIN = [
    { label: 'Active Rent / yr', value: fmtAed(fin.totalActiveRent), icon: CreditCard, danger: false },
    { label: 'Security Deposits Held', value: fmtAed(fin.securityDepositHeld), icon: ShieldCheck, danger: false },
    { label: 'Collected', value: fmtAed(fin.totalCollected), icon: TrendingUp, danger: false },
    { label: 'Outstanding', value: fmtAed(fin.totalOutstanding), icon: AlertTriangle, danger: fin.totalOutstanding > 0 },
  ];
  const profile: { icon: typeof Mail; label: string; value: string | null }[] = [
    { icon: Mail, label: 'Email', value: c.email },
    { icon: Phone, label: 'Phone', value: c.phone },
    { icon: IdCard, label: 'Emirates ID', value: c.emiratesId },
    { icon: Globe, label: 'Nationality', value: c.nationality },
    { icon: User, label: 'Gender', value: c.gender ? c.gender.replace(/^./, x => x.toUpperCase()) : null },
    { icon: Calendar, label: 'Date of birth', value: c.dateOfBirth ? fmtDate(c.dateOfBirth) : null },
    ...(isCompany ? [
      { icon: Building2, label: 'Company', value: c.companyName },
      { icon: IdCard, label: 'Trade license', value: c.tradeLicenseNumber },
    ] : []),
  ];
  // Rent progression (incremental) across leases, oldest → newest.
  const progression = [...data.leases]
    .filter(l => l.startDate)
    .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

  return (
    <div className="p-6">
      <button onClick={() => router.push('/rental-provider/dashboard/tenants')} className="text-sm text-[#2e9f82] font-medium flex items-center gap-1 mb-4 cursor-pointer hover:underline"><ArrowLeft size={14} /> Back to Customers</button>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-14 h-14 rounded-2xl bg-[#d8f2e8] flex items-center justify-center text-[#2e9f82] shrink-0">
          {isCompany ? <Building2 size={26} /> : <User size={26} />}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">{c.name ?? '—'}</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">{isCompany ? 'Company' : 'Individual'} · Customer #{c.id}</p>
        </div>
      </div>

      {/* Action items — RED */}
      {actions.length > 0 && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-2xl p-5 mb-6">
          <h2 className="text-sm font-semibold text-[#b91c1c] mb-2.5 flex items-center gap-2"><AlertTriangle size={16} /> Action items ({actions.length})</h2>
          <ul className="space-y-1.5">
            {actions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#b91c1c]">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#b91c1c] shrink-0" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {SUMMARY.map((s, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="text-xs text-[#6b6860] font-medium">{s.label}</div>
            <div className="font-bold text-xl text-[#1a1916] mt-1">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Financial amounts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {FIN.map((s, i) => (
          <div key={i} className={`rounded-2xl p-5 shadow-sm ${s.danger ? 'bg-[#fef2f2] border border-[#fecaca]' : 'bg-white'}`}>
            <div className={`text-xs font-medium flex items-center gap-1.5 ${s.danger ? 'text-[#b91c1c]' : 'text-[#6b6860]'}`}><s.icon size={13} /> {s.label}</div>
            <div className={`font-bold text-xl mt-1 ${s.danger ? 'text-[#b91c1c]' : 'text-[#1a1916]'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Profile / KYC */}
      <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-[#1a1916] mb-4 flex items-center gap-2"><User size={16} className="text-[#2e9f82]" /> Profile &amp; KYC</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {profile.map((f, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <f.icon size={15} className={`mt-0.5 shrink-0 ${f.value ? 'text-[#9b9890]' : 'text-[#dc8a8a]'}`} />
              <div className="min-w-0">
                <div className="text-xs text-[#9b9890]">{f.label}</div>
                <div className={`text-sm break-words ${f.value ? 'text-[#1a1916]' : 'text-[#b91c1c] font-medium'}`}>{f.value ?? 'Missing'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rent progression (incremental) — only when there's history */}
      {progression.length > 1 && (
        <div className="bg-white rounded-2xl p-5 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-[#1a1916] mb-4 flex items-center gap-2"><TrendingUp size={16} className="text-[#2e9f82]" /> Rent progression</h2>
          <div className="flex flex-wrap items-stretch gap-2">
            {progression.map((l, i) => {
              const prev = i > 0 ? progression[i - 1].annualRent : null;
              const delta = prev != null ? l.annualRent - prev : 0;
              return (
                <div key={l.id} className="flex items-center gap-2">
                  <div className="rounded-xl border border-[#e8e6e0] px-3 py-2 min-w-[120px]">
                    <div className="text-[11px] text-[#9b9890]">{fmtDate(l.startDate)}</div>
                    <div className="text-sm font-semibold text-[#1a1916]">{fmtAed(l.annualRent)}</div>
                    {prev != null && delta !== 0 && (
                      <div className={`text-[11px] font-medium ${delta > 0 ? 'text-[#1a7a5a]' : 'text-[#b91c1c]'}`}>
                        {delta > 0 ? '▲' : '▼'} {fmtAed(Math.abs(delta))} ({Math.round((delta / (prev || 1)) * 100)}%)
                      </div>
                    )}
                    {prev != null && delta === 0 && <div className="text-[11px] text-[#9b9890]">no change</div>}
                  </div>
                  {i < progression.length - 1 && <span className="text-[#c4c1b8]">→</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Leases */}
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-[#1a1916] px-5 pt-5 pb-3 flex items-center gap-2"><FileText size={16} className="text-[#2e9f82]" /> Leases ({data.leases.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[920px] text-sm">
            <thead><tr className="bg-[#f4f3ef]">
              {['Ref', 'Unit', 'Property', 'Period', 'Annual Rent', 'Deposit', 'Outstanding', 'Renewal', 'Status', ''].map(h => (
                <th key={h} className="px-4 py-3 text-xs font-medium uppercase text-[#6b6860]">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.leases.map(l => {
                const d = l.isCurrent ? renewalDays(l.endDate) : null;
                const renewalRed = d !== null && d <= 30;
                const badge = leaseBadge(l);
                return (
                  <tr key={l.id} className={`border-b border-[#e8e6e0] hover:bg-[#f4f3ef] ${l.isCurrent ? 'text-[#1a1916]' : 'text-[#9b9890]'}`}>
                    <td className="px-4 py-3.5 font-medium">{l.ref}</td>
                    <td className="px-4 py-3.5">{l.unit.number ? `Unit ${l.unit.number}` : (l.unit.name ?? '—')}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{l.property.buildingName ?? '—'}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                    <td className="px-4 py-3.5 font-medium">{fmtAed(l.annualRent)}</td>
                    <td className="px-4 py-3.5 text-[#6b6860]">{l.securityDeposit ? fmtAed(l.securityDeposit) : '—'}</td>
                    <td className={`px-4 py-3.5 font-medium ${l.outstanding > 0 && l.isCurrent ? 'text-[#b91c1c]' : 'text-[#6b6860]'}`}>{l.outstanding > 0 ? fmtAed(l.outstanding) : '—'}</td>
                    <td className="px-4 py-3.5">
                      {!l.isCurrent ? <span className="text-[#9b9890]">—</span>
                        : d === null ? <span className="text-[#9b9890]">—</span>
                        : <span className={`text-xs font-medium ${renewalRed ? 'text-[#b91c1c]' : d <= 90 ? 'text-amber-600' : 'text-[#6b6860]'}`}>{d > 0 ? `${d}d` : `expired ${Math.abs(d)}d`}</span>}
                    </td>
                    <td className="px-4 py-3.5"><span className={`inline-flex rounded-full text-xs font-medium px-2.5 py-0.5 ${badge.cls}`}>{badge.label}</span></td>
                    <td className="px-4 py-3.5">
                      <Link href={`/rental-provider/dashboard/contracts/${l.id}/v2`} className="text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1">View <ExternalLink size={12} /></Link>
                    </td>
                  </tr>
                );
              })}
              {data.leases.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-[#9b9890]">No leases.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Documents */}
      <div className="bg-white rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2"><FileText size={16} className="text-[#2e9f82]" /> Documents ({data.documents.length})</h2>
          {data.documents.some(d => d.fileUrl) && (
            <button
              type="button"
              onClick={() => openDocsTogether(data.documents)}
              className="text-sm text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Files size={14} /> View all
            </button>
          )}
        </div>
        {data.documents.length === 0 ? (
          <p className="text-sm text-[#b91c1c] font-medium flex items-center gap-2"><AlertTriangle size={14} /> No documents on file for this customer.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.documents.map(d => (
              <div key={d.id} className="border border-[#e8e6e0] rounded-xl p-3.5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#f4f3ef] flex items-center justify-center text-[#6b6860] shrink-0"><FileText size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#1a1916] truncate">{d.displayName || prettyKey(d.documentKey)}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 ${docTone(d.status)}`}>{(d.status ?? 'attached').replace(/^./, c => c.toUpperCase())}</span>
                    {d.expiryDate && <span className="text-[11px] text-[#9b9890]">exp {fmtDate(d.expiryDate)}</span>}
                  </div>
                  {d.fileUrl && (
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 mt-1.5">View file <ExternalLink size={11} /></a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
