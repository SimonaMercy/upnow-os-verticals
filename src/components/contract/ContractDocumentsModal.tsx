/**
 * Contract Documents popup — lists every document on a contract (grouped by
 * category), each viewable inline via the shared doc viewer (openDocViewer).
 * Opened from the Final Settlement statement's "View Documents" button.
 */
'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, FolderOpen, AlertCircle } from 'lucide-react';
import { DocList, DocGroupLabel, type DocLink } from '@/components/upnow/leaseLifecycleSections';

interface BinderDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string; category?: string | null; ownerType?: string }

const humanize = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
const catLabel = (c?: string | null) => (c ? humanize(c) : 'Other Documents');

export default function ContractDocumentsModal({ contractId, onClose }: { contractId: number; onClose: () => void }) {
  const [docs, setDocs] = useState<BinderDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contracts/${contractId}`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const c = await res.json();
        if (!cancelled) setDocs((c.documents ?? []) as BinderDoc[]);
      } catch {
        if (!cancelled) setError('Failed to load documents.');
      }
    })();
    return () => { cancelled = true; };
  }, [contractId]);

  // Group by category, preserving first-seen order.
  const groups: { name: string; docs: DocLink[] }[] = [];
  for (const d of docs ?? []) {
    const name = catLabel(d.category);
    let g = groups.find(x => x.name === name);
    if (!g) { g = { name, docs: [] }; groups.push(g); }
    g.docs.push({ documentKey: d.documentKey, displayName: d.displayName, mimeType: null, fileUrl: d.fileUrl, status: null });
  }
  const labelFor = (d: DocLink) => d.displayName ?? humanize(d.documentKey);

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="w-[min(560px,100%)] max-h-[84vh] flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Green header */}
        <div className="flex items-center justify-between gap-3 bg-[#2e9f82] text-white px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2 font-bold text-sm"><FolderOpen size={16} /> Contract Documents</div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5 overflow-y-auto">
          {error ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center"><AlertCircle size={20} className="text-[#b91c1c]" /><p className="text-sm text-[#6b6860]">{error}</p></div>
          ) : !docs ? (
            <div className="flex items-center justify-center py-10"><Loader2 size={22} className="animate-spin text-[#2e9f82]" /></div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-[#9b9890] text-center py-8">No documents on file for this contract.</p>
          ) : (
            <div className="space-y-4">
              {groups.map(g => (
                <div key={g.name}>
                  <DocGroupLabel>{g.name}</DocGroupLabel>
                  <DocList docs={g.docs} labelFor={labelFor} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
