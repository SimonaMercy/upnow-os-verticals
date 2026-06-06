/**
 * Manager — My Documents (dashboard/manager/documents)
 *
 * Managers don't go through KYC, so these identity documents are OPTIONAL and
 * non-blocking. They back up a manager's POA / on-behalf signing authority and
 * are visible to admin in the KYC › Managers tab.
 *
 *   Emirates ID · Passport · UAE Residency Visa  (all optional)
 *
 * Upload flow (2-step presigned S3), owner = asset_manager / assetManagerId:
 *   1. POST /documents/upload-url  → { uploadUrl, fileUrl, fileKey }
 *   2. PUT <uploadUrl> with file bytes
 *   3. POST /documents (or PATCH /documents/:id for replace)
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  UploadCloud, CheckCircle2, ExternalLink, Loader2, Clock, ShieldCheck,
} from 'lucide-react';

interface MyDoc {
  id: number;
  documentKey: string;
  fileUrl?: string;
  status?: string;
  displayName?: string | null;
}

const DOCS: { key: string; label: string; hint: string }[] = [
  { key: 'emirates_id', label: 'Emirates ID', hint: 'Both sides, clear scan (PDF or image).' },
  { key: 'passport', label: 'Passport', hint: 'Bio-data page of a valid passport.' },
  { key: 'visa', label: 'UAE Residency Visa', hint: 'Residency visa page.' },
];

export default function ManagerDocumentsPage() {
  const [assetManagerId, setAssetManagerId] = useState<number | null>(null);
  const [docs, setDocs] = useState<MyDoc[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetch('/api/manager/my-documents', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: { assetManagerId: number | null; documents: MyDoc[] }) => {
        setAssetManagerId(data.assetManagerId ?? null);
        setDocs(data.documents ?? []);
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleUpload(key: string, label: string, file: File, existingId?: number) {
    if (!assetManagerId) { setError('Your manager profile is still being set up. Please retry shortly.'); return; }
    setUploadingKey(key);
    setError(null);
    try {
      const urlRes = await fetch('/api/documents/upload-url', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerType: 'asset_manager', ownerId: assetManagerId,
          documentKey: key, originalName: file.name, mimeType: file.type,
        }),
      });
      if (!urlRes.ok) { setError('Failed to get upload URL'); return; }
      const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey: string };

      const target = (() => {
        try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
        catch { return uploadUrl; }
      })();

      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) { setError('File upload failed'); return; }

      const docRes = existingId
        ? await fetch(`/api/documents/${existingId}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey }),
          })
        : await fetch('/api/documents', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerType: 'asset_manager', ownerId: assetManagerId,
              documentKey: key, category: 'identity',
              displayName: label, fileUrl, mimeType: file.type, s3Key: fileKey,
            }),
          });
      if (!docRes.ok) {
        const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
        setError(Array.isArray(b.message) ? b.message[0] : (b.message ?? 'Failed to save document'));
        return;
      }
      reload();
    } catch { setError('Unexpected error during upload'); }
    finally { setUploadingKey(null); }
  }

  const byKey = new Map((docs ?? []).map(d => [d.documentKey, d]));
  const uploadedCount = DOCS.filter(d => byKey.has(d.key)).length;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1a1916]">My Documents</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">
          Optional identity documents for your records. These help verify your authority to act on behalf of the landlords you manage.
        </p>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-sm bg-[#fff1f2] border border-[#fecaca] text-[#b91c1c]">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-[#e8e6e0] overflow-hidden">
        <div className="px-5 py-4 flex items-center gap-3 border-b border-[#f4f3ef] bg-[#fafaf8]">
          <div className="w-8 h-8 rounded-xl bg-[#f0faf6] flex items-center justify-center shrink-0">
            <ShieldCheck size={16} className="text-[#2e9f82]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#1a1916]">Identity documents</p>
            <p className="text-xs text-[#9b9890] mt-0.5">All optional — upload what applies to you</p>
          </div>
          {!loading && (
            <span className="text-xs text-[#6b6860]">{uploadedCount}/{DOCS.length} uploaded</span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          {loading ? (
            <p className="text-sm text-[#9b9890] text-center py-4">Loading…</p>
          ) : DOCS.map(({ key, label, hint }) => {
            const doc = byKey.get(key);
            const uploaded = !!doc;
            const isApproved = doc?.status === 'complete' || doc?.status === 'processed';
            const uploading = uploadingKey === key;
            return (
              <div key={key} className={[
                'rounded-xl px-4 py-3 flex items-start gap-3',
                isApproved ? 'bg-[#f0faf6] border border-[#bbf7d0]'
                : uploaded ? 'bg-[#eff6ff] border border-[#bfdbfe]'
                : 'bg-[#f9f8f6] border border-[#e8e6e0]',
              ].join(' ')}>
                <div className="mt-0.5 shrink-0">
                  {isApproved
                    ? <div className="w-6 h-6 rounded-full bg-[#dcfce7] flex items-center justify-center"><CheckCircle2 size={13} className="text-[#16a34a]" /></div>
                    : uploaded
                    ? <div className="w-6 h-6 rounded-full bg-[#dbeafe] flex items-center justify-center"><Clock size={12} className="text-[#2563eb]" /></div>
                    : <div className="w-6 h-6 rounded-full bg-[#f4f3ef] flex items-center justify-center"><UploadCloud size={12} className="text-[#c5c3bc]" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-semibold ${isApproved ? 'text-[#166534]' : 'text-[#1a1916]'}`}>{label}</p>
                    <span className="text-[10px] text-[#9b9890]">Optional</span>
                  </div>
                  {isApproved ? <p className="text-xs text-[#16a34a] font-medium mt-0.5">Approved ✓</p>
                    : uploaded ? <p className="text-xs text-[#6b6860] mt-0.5">Uploaded · awaiting review</p>
                    : <p className="text-xs text-[#9b9890] mt-0.5">{hint}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-0.5">
                  {uploaded && doc?.fileUrl && (
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">
                      <ExternalLink size={12} /> View
                    </a>
                  )}
                  <label className={[
                    'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer text-white transition-opacity bg-[#9b9890] hover:bg-[#6b6860]',
                    uploading ? 'opacity-50 pointer-events-none' : '',
                  ].join(' ')}>
                    {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
                    {uploaded ? 'Replace' : 'Upload'}
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(key, label, f, doc?.id); e.target.value = ''; }} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
