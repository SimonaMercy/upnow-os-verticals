'use client';

/**
 * All-documents popup for a customer — full history grouped in business order
 * (KYC / Financial / Contract / Other). Used by the tenant 360 page (preloaded
 * docs) and the contract page's "Full document history" (fetches on open), so
 * both surfaces share ONE module instead of navigating away.
 */
import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Files, FileText, Eye, X, Loader2, AlertTriangle } from 'lucide-react';
import { openDocsTogether } from '@/lib/openDocsTogether';
import { openDocViewer } from '@/lib/docViewer';
import { docLabel } from '@/lib/docLabel';

export type CustomerDoc = {
  id: number; documentKey: string; displayName: string | null; category: string | null;
  status: string | null; fileUrl: string | null; expiryDate?: string | null;
  ownerType?: string | null; leaseId?: number | null; notes?: string | null;
};

export type LeaseMeta = { id: number; ref: string; startDate: string | null; endDate: string | null };

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const monthYear = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const leaseLabel = (l: LeaseMeta) => `${l.ref} · ${monthYear(l.startDate)} – ${monthYear(l.endDate)}`;
const catLabel = (c: string | null) => (c ? c.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase()) : 'Document');
const KYC_KEY_RE = /emirates|passport|visa|trade_license|moa|poa|labour|establishment/;
const isKycDoc = (d: CustomerDoc) =>
  (d.ownerType ?? 'customer') === 'customer' &&
  (d.category === 'identity' || d.category === 'license' || KYC_KEY_RE.test(d.documentKey));
const groupOf = (d: CustomerDoc): 'kyc' | 'financial' | 'contract' | 'other' => {
  if (isKycDoc(d)) return 'kyc';
  if (d.ownerType === 'security_deposit' || d.category === 'payment' || d.category === 'banking') return 'financial';
  if (d.ownerType === 'tenancy_contract') return 'contract';
  return 'other';
};
const GROUPS: { key: 'kyc' | 'financial' | 'contract' | 'other'; label: string }[] = [
  { key: 'kyc',       label: 'Customer KYC' },
  { key: 'financial', label: 'Financial documents' },
  { key: 'contract',  label: 'Contract documents' },
  { key: 'other',     label: 'Other documents' },
];

export function CustomerDocsModal({ tenantId, tenantName, documents, leases, excludeKyc, onClose }: {
  /** Needed when `documents` isn't preloaded — the modal fetches the customer detail itself. */
  tenantId?: number | null;
  tenantName?: string | null;
  documents?: CustomerDoc[];
  /** When provided, documents are grouped per lease (ref + period) instead of by category. */
  leases?: LeaseMeta[];
  /** Hide KYC docs (e.g. the tenant page already shows them in its own section). */
  excludeKyc?: boolean;
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<CustomerDoc[] | null>(documents ?? null);
  const [name, setName] = useState<string | null>(tenantName ?? null);
  // Leases enable the per-lease grouping. Callers can pass them (tenant 360
  // preloads them); the fetch path pulls them from the same endpoint so the
  // contract page's cross-lease history groups per lease too.
  const [leaseList, setLeaseList] = useState<LeaseMeta[] | null>(leases ?? null);
  const [err, setErr] = useState<string | null>(null);
  // This modal is rendered on both the RP and manager copies of the contract /
  // customer pages. A manager has no RP profile, so the RP-only /contracts
  // endpoint 404s ("Rental Provider profile not found"); scope to the mirror
  // /manager endpoint (same service, resolves the landlord from ?rp=).
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isManager = (pathname ?? '').startsWith('/dashboard/manager');
  const rpParam = searchParams.get('rp');

  useEffect(() => {
    if (docs || !tenantId) return;
    const url = isManager
      ? `/api/manager/tenants/${tenantId}?rp=${rpParam ?? ''}`
      : `/api/contracts/tenants/${tenantId}`;
    fetch(url, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Not available for this account.' : `Error ${r.status}`)))
      .then((d: { documents?: CustomerDoc[]; leases?: LeaseMeta[]; customer?: { name?: string | null } }) => {
        setDocs(d.documents ?? []);
        setName(n => n ?? d.customer?.name ?? null);
        if (d.leases?.length) setLeaseList(prev => prev ?? d.leases!.map(l => ({ id: l.id, ref: l.ref, startDate: l.startDate, endDate: l.endDate })));
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, [docs, tenantId, isManager, rpParam]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = (excludeKyc ? (docs ?? []).filter(d => !isKycDoc(d)) : (docs ?? []));
  // Prefer explicitly-passed leases; otherwise the ones fetched alongside docs.
  const effLeases = (leases && leases.length) ? leases : leaseList;
  const groups: { key: string; label: string; items: CustomerDoc[] }[] = (() => {
    if (!shown.length) return [];
    // Lease-aware grouping: one section per lease (ref + period), newest first,
    // so the same paperwork (Ejari, Invoice, …) repeated across renewals reads
    // as "this year vs last year" rather than as duplicates.
    if (effLeases && effLeases.length) {
      const byId = new Map(effLeases.map(l => [l.id, l]));
      const byStart = [...effLeases].sort((a, b) => String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')));
      const earliest = byStart[0];                 // first contract — move-in happens here
      const latest = byStart[byStart.length - 1];  // last contract — move-out happens here
      const ordered = [...effLeases].sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
      // Customer-owned tenancy-lifecycle docs carry no lease link, so anchor them
      // to the lease they logically belong to (move-in → first lease, move-out → last).
      const resolveLeaseId = (d: CustomerDoc): number | null => {
        if (d.leaseId && byId.has(d.leaseId)) return d.leaseId;
        if (/move[_-]?out/i.test(d.documentKey)) return latest?.id ?? null;
        if (/move[_-]?in/i.test(d.documentKey)) return earliest?.id ?? null;
        return null;
      };
      const out: { key: string; label: string; items: CustomerDoc[] }[] = [];
      for (const l of ordered) {
        const items = shown.filter(d => resolveLeaseId(d) === l.id);
        if (items.length) out.push({ key: `lease-${l.id}`, label: leaseLabel(l), items });
      }
      const general = shown.filter(d => resolveLeaseId(d) === null);
      if (general.length) out.push({ key: 'general', label: 'Customer & general', items: general });
      return out;
    }
    return GROUPS.map(g => ({ key: g.key, label: g.label, items: shown.filter(d => groupOf(d) === g.key) })).filter(g => g.items.length);
  })();
  const openable = shown.filter(d => d.fileUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2">
            <Files size={16} className="text-[#2e9f82]" /> All documents{docs ? ` (${shown.length})` : ''}{name ? ` — ${name}` : ''}
          </h3>
          <div className="flex items-center gap-3">
            {openable.length > 0 && (
              <button
                type="button"
                onClick={() => openDocsTogether(openable)}
                className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Eye size={12} /> View All
              </button>
            )}
            <button type="button" onClick={onClose} className="text-[#6b6860] hover:text-[#1a1916] cursor-pointer"><X size={18} /></button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {!docs && !err && (
            <p className="text-sm text-[#6b6860] flex items-center gap-2 py-4 justify-center"><Loader2 size={14} className="animate-spin" /> Loading documents…</p>
          )}
          {err && (
            <p className="text-sm text-[#b91c1c] flex items-center gap-2 py-4 justify-center"><AlertTriangle size={14} /> {err}</p>
          )}
          {docs && shown.length === 0 && !err && (
            <p className="text-sm text-[#9b9890] py-4 text-center">No documents on file for this customer.</p>
          )}
          {groups.map(g => (
            <div key={g.key} className="mb-4 last:mb-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#9b9890] mb-2">{g.label} ({g.items.length})</div>
              <div className="space-y-1.5">
                {g.items.map(d => (
                  <div key={d.id} className="flex items-center gap-2.5 border border-[#e8e6e0] rounded-lg px-3 py-1.5 min-h-[34px]">
                    <FileText size={14} className="text-[#9b9890] shrink-0" />
                    <span className="text-[12.5px] font-medium text-[#1a1916] truncate">{docLabel(d, docs ?? [])}</span>
                    <span className="text-[10px] text-[#9b9890] shrink-0 hidden sm:inline">{catLabel(d.category)}</span>
                    {/* Only surface states that need action — a "Processed/Attached" badge on
                        every file is noise. Show "Requested" (no file yet) or "Pending review". */}
                    {!d.fileUrl ? (
                      <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 shrink-0 bg-[#fef3c7] text-[#92400e]">Requested</span>
                    ) : d.status === 'rejected' ? (
                      <span title={d.notes ?? undefined} className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 shrink-0 bg-[#fee2e2] text-[#b91c1c]">Rejected — re-upload</span>
                    ) : (d.status === 'attached' || d.status === 'pending') ? (
                      <span className="inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 shrink-0 bg-[#dbeafe] text-[#1d4ed8]">Pending review</span>
                    ) : null}
                    {d.expiryDate && <span className="text-[11px] text-[#9b9890] shrink-0">exp {fmtDate(d.expiryDate)}</span>}
                    {d.fileUrl && (
                      <button type="button" onClick={() => openDocViewer({ fileUrl: d.fileUrl, caption: docLabel(d, docs ?? []) })} className="ml-auto text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 shrink-0 cursor-pointer">View <Eye size={12} /></button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
