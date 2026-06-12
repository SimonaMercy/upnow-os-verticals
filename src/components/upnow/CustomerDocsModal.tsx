'use client';

/**
 * All-documents popup for a customer — full history grouped in business order
 * (KYC / Financial / Contract / Other). Used by the tenant 360 page (preloaded
 * docs) and the contract page's "Full document history" (fetches on open), so
 * both surfaces share ONE module instead of navigating away.
 */
import { useEffect, useState } from 'react';
import { Files, FileText, ExternalLink, X, Loader2, AlertTriangle } from 'lucide-react';
import { openDocsTogether } from '@/lib/openDocsTogether';

export type CustomerDoc = {
  id: number; documentKey: string; displayName: string | null; category: string | null;
  status: string | null; fileUrl: string | null; expiryDate?: string | null;
  ownerType?: string | null; leaseId?: number | null;
};

const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const docTone = (s: string | null | undefined) =>
  s === 'processed' ? 'bg-[#d8f2e8] text-[#1a7a5a]' : s === 'pending' ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#eef2ff] text-[#3730a3]';
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
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

export function CustomerDocsModal({ tenantId, tenantName, documents, onClose }: {
  /** Needed when `documents` isn't preloaded — the modal fetches the customer detail itself. */
  tenantId?: number | null;
  tenantName?: string | null;
  documents?: CustomerDoc[];
  onClose: () => void;
}) {
  const [docs, setDocs] = useState<CustomerDoc[] | null>(documents ?? null);
  const [name, setName] = useState<string | null>(tenantName ?? null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (docs || !tenantId) return;
    fetch(`/api/contracts/tenants/${tenantId}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'Not available for this account.' : `Error ${r.status}`)))
      .then((d: { documents?: CustomerDoc[]; customer?: { name?: string | null } }) => {
        setDocs(d.documents ?? []);
        setName(n => n ?? d.customer?.name ?? null);
      })
      .catch(e => setErr(e instanceof Error ? e.message : 'Failed to load'));
  }, [docs, tenantId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = (docs ?? [])
    .length ? GROUPS.map(g => ({ ...g, items: (docs ?? []).filter(d => groupOf(d) === g.key) })).filter(g => g.items.length) : [];
  const openable = (docs ?? []).filter(d => d.fileUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-sm font-semibold text-[#1a1916] flex items-center gap-2">
            <Files size={16} className="text-[#2e9f82]" /> All documents{docs ? ` (${docs.length})` : ''}{name ? ` — ${name}` : ''}
          </h3>
          <div className="flex items-center gap-3">
            {openable.length > 0 && (
              <button
                type="button"
                onClick={() => openDocsTogether(openable)}
                className="text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <ExternalLink size={12} /> Open files
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
          {docs && docs.length === 0 && !err && (
            <p className="text-sm text-[#9b9890] py-4 text-center">No documents on file for this customer.</p>
          )}
          {groups.map(g => (
            <div key={g.key} className="mb-4 last:mb-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#9b9890] mb-2">{g.label} ({g.items.length})</div>
              <div className="space-y-1.5">
                {g.items.map(d => (
                  <div key={d.id} className="flex items-center gap-2.5 border border-[#e8e6e0] rounded-lg px-3 py-1.5 min-h-[34px]">
                    <FileText size={14} className="text-[#9b9890] shrink-0" />
                    <span className="text-[12.5px] font-medium text-[#1a1916] truncate">{d.displayName || prettyKey(d.documentKey)}</span>
                    <span className={`inline-flex rounded-full text-[10px] font-medium px-2 py-0.5 shrink-0 ${docTone(d.status)}`}>
                      {d.fileUrl ? (d.status ?? 'attached').replace(/^./, x => x.toUpperCase()) : 'Requested'}
                    </span>
                    {d.expiryDate && <span className="text-[11px] text-[#9b9890] shrink-0">exp {fmtDate(d.expiryDate)}</span>}
                    {d.fileUrl && (
                      <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-[#2e9f82] font-medium hover:underline inline-flex items-center gap-1 shrink-0">View <ExternalLink size={11} /></a>
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
