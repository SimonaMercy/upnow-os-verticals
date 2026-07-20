'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * Public tenant portal — landing (magic link, no login).
 * Documents only: Identity/KYC + rental docs. Each contract links to its own
 * dedicated review-and-sign page at /portal/<token>/contract/<id>.
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  UploadCloud, CheckCircle2, ExternalLink, Loader2, FileText,
  ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { openDocViewer, setDocViewerWatermark } from '@/lib/docViewer';

interface DocItem { key: string; displayName: string; required: boolean; uploaded: boolean; status: string | null; fileUrl: string | null; category?: string | null; hint?: string | null; notes?: string | null }
interface Portal {
  tenant: { name: string; email: string | null; entityType: string };
  kycDocuments: DocItem[];
  otherDocuments: DocItem[];
  /** Docs the landlord explicitly requested (RP request flow) — shown first. */
  requestedDocuments?: DocItem[];
  purpose?: 'all' | 'documents' | 'contract' | 'move_in' | 'move_out';
  contractId?: number | null;
  expiresAt: string;
}

const API = (token: string, path: string) => `/api/portal/${token}${path}`;
const greetName = (n?: string | null) => (!n || /^\+?\d[\d\s-]{6,}$/.test(n) ? 'there' : n);

export default function TenantPortalPage() {
  const token = String(useParams().token);
  const router = useRouter();
  const [data, setData] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  // Contract-scoped links belong on the dedicated review/sign page. The backend
  // already deep-links them there; this redirect is a safety net if someone
  // opens the bare /portal/<token> for a non-documents link.
  useEffect(() => {
    if (data?.contractId && data.purpose && ['contract', 'move_in', 'move_out'].includes(data.purpose)) {
      router.replace(`/portal/${token}/contract/${data.contractId}`);
    }
  }, [data, token, router]);

  const load = useCallback(() => {
    setLoading(true);
    fetch(API(token, ''), { credentials: 'omit' })
      .then(r => r.ok ? r.json() : r.json().then(b => Promise.reject(new Error(b.message || 'This link is not valid'))))
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // No auth user on the magic link — stamp viewed documents with the tenant name.
  useEffect(() => { setDocViewerWatermark(data?.tenant?.name ?? null); }, [data]);

  // No expiry is sent: identity / licence expiry is recorded by the rental provider when
  // they review the copy, so the tenant just picks the file and it goes.
  async function upload(doc: DocItem, file: File) {
    setUploading(doc.key);
    try {
      const urlRes = await fetch(API(token, '/upload-url'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentKey: doc.key, mimeType: file.type, originalName: file.name }),
      });
      if (!urlRes.ok) throw new Error();
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json();
      const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
      await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await fetch(API(token, '/documents'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentKey: doc.key, category: doc.category ?? 'identity', displayName: doc.displayName, fileUrl, mimeType: file.type, s3Key: fileKey }),
      });
      load();
    } catch { setError('Upload failed — please try again.'); }
    finally { setUploading(null); }
  }

  if (loading) return <Centered><Loader2 className="animate-spin" /> Loading…</Centered>;
  if (error || !data) return (
    <Centered>
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-2 text-[#b45309]" />
        <p className="font-semibold text-[#1a1916]">{error ?? 'Link not available'}</p>
        <p className="text-sm text-[#9b9890] mt-1">Please ask your rental provider to send a new link.</p>
      </div>
    </Centered>
  );

  return (
    <div className="min-h-screen bg-[#f7f6f2]">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-1"><ShieldCheck size={18} className="text-[#2e9f82]" /><span className="font-bold text-[#1a1916]">UpNow</span></div>
        <h1 className="text-2xl font-bold text-[#1a1916] mt-3">Hi {greetName(data.tenant.name)},</h1>
        <p className="text-sm text-[#6b6860] mt-1">Please upload the documents requested below.</p>

        {(data.requestedDocuments?.length ?? 0) > 0 && (
          <DocSection title="Requested by your rental provider" subtitle="Specific documents your landlord asked you to provide" docs={data.requestedDocuments!} uploading={uploading} onUpload={upload} />
        )}
        <DocSection title="Identity documents (KYC)" subtitle="Your Emirates ID, passport and visa" docs={data.kycDocuments} uploading={uploading} onUpload={upload} />
        {/* Always render so the customer sees the full document set (mandatory
            and optional), not only what was explicitly requested. */}
        <DocSection title="Rental documents" subtitle="Supporting documents for your tenancy" docs={data.otherDocuments} uploading={uploading} onUpload={upload} />

        <p className="text-xs text-[#9b9890] text-center mt-6">Link expires {new Date(data.expiresAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE })}. Powered by UpNow.</p>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center gap-2 text-[#6b6860] text-sm bg-[#f7f6f2] p-6">{children}</div>;
}

function DocSection({ title, subtitle, docs, uploading, onUpload }: {
  title: string; subtitle: string; docs: DocItem[]; uploading: string | null; onUpload: (d: DocItem, f: File) => void;
}) {
  const required = docs.filter(d => d.required);
  // A rejected doc is NOT "done" — it must be re-uploaded.
  const done = required.filter(d => d.uploaded && d.status !== 'rejected').length;
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] mt-6 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#f4f3ef] bg-[#fafaf8] flex items-center gap-2">
        <FileText size={16} className="text-[#2e9f82]" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-[#1a1916]">{title}</span>
          <p className="text-xs text-[#9b9890]">{subtitle}</p>
        </div>
        {required.length > 0 && <span className="text-xs text-[#6b6860] shrink-0">{done}/{required.length} required</span>}
      </div>
      <div className="px-5 py-4 space-y-2">
        {docs.length === 0 && <p className="text-xs text-[#9b9890] text-center py-2">Nothing needed here.</p>}
        {docs.map(doc => {
          const isRejected = doc.status === 'rejected';
          const ok = doc.uploaded && !isRejected;
          const busy = uploading === doc.key;
          return (
            <div key={doc.key} className={`rounded-xl px-4 py-3 flex flex-col gap-2 ${isRejected ? 'bg-[#fff1f2] border border-[#fecaca]' : ok ? 'bg-[#f0faf6] border border-[#bbf7d0]' : doc.required ? 'bg-[#fffbeb] border border-[#fde68a]' : 'bg-[#f9f8f6] border border-[#e8e6e0]'}`}>
              <div className="flex items-center gap-3">
              <div className="shrink-0">{isRejected ? <AlertTriangle size={18} className="text-[#ef4444]" /> : ok ? <CheckCircle2 size={18} className="text-[#16a34a]" /> : <UploadCloud size={18} className="text-[#d97706]" />}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#1a1916]">{doc.displayName}</p>
                {isRejected ? (
                  <p className="text-xs text-[#ef4444] font-medium">Rejected — re-upload required{doc.notes ? <span className="font-normal text-[#9b9890]"> · {doc.notes}</span> : ''}</p>
                ) : (
                  <p className="text-xs text-[#9b9890]">{ok ? 'Uploaded' : doc.required ? 'Required' : 'Optional'}{doc.hint ? ` — ${doc.hint}` : ''}</p>
                )}
              </div>
              {doc.uploaded && doc.fileUrl && <button type="button" onClick={() => openDocViewer({ fileUrl: doc.fileUrl, caption: doc.displayName })} className="text-xs text-[#2e9f82] flex items-center gap-1 cursor-pointer"><ExternalLink size={12} /> View</button>}
              <label className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white ${busy ? 'opacity-50 pointer-events-none' : ''} ${isRejected ? 'bg-[#ef4444]' : ok ? 'bg-[#9b9890]' : 'bg-[#2e9f82]'}`}>
                {busy ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                {isRejected ? 'Re-upload' : ok ? 'Replace' : 'Upload'}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(doc, f); e.target.value = ''; }} />
              </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
