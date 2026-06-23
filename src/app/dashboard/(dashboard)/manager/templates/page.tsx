/**
 * Manager — Addendum Templates page
 * Route: /dashboard/manager/templates
 *
 * Mirrors the RP templates page (rental-provider/dashboard/templates) but scoped
 * to the landlord chosen in the LandlordSwitcher (?rp=). Every call goes through
 * the /manager/templates*?rp= proxy, which acts as the landlord (gated by
 * canManageAgreements) so the manager reads/writes the LANDLORD's template
 * library — not their own.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileText, UploadCloud, Trash2, Loader2, AlertCircle, Plus, X, ExternalLink, Lock } from 'lucide-react';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

interface AddendumTemplate {
  id: number;
  name: string;
  description: string | null;
  fileUrl: string | null;
  fileKey: string | null;
  mimeType: string | null;
  // In-app text template (authored on the RP Templates page) — no file.
  terms: unknown | null;
  originalFilename: string | null;
  createdAt: string;
}

const ALLOWED_MIME = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export default function ManagerAddendumTemplatesPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  // Effective landlord = the one chosen in the LandlordSwitcher, else the first
  // managed landlord that delegated agreements access.
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageAgreements)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageAgreements', effectiveRp);

  const [templates, setTemplates] = useState<AddendumTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function fetchAll() {
    if (effectiveRp == null || !allowed) { setTemplates([]); setLoading(false); return; }
    setLoading(true); setErr(null);
    try {
      const list = await apiGet<AddendumTemplate[]>(`/manager/templates?rp=${effectiveRp}`);
      setTemplates(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void fetchAll(); }, [effectiveRp, allowed]);

  async function handleDelete(id: number) {
    if (effectiveRp == null) return;
    if (!confirm('Remove this template? Past contracts that use it will keep their copy.')) return;
    try {
      await apiDelete(`/manager/templates/${id}?rp=${effectiveRp}`);
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  // Per-landlord permission gate — mirrors the lock the nav enforces.
  if (!permsLoading && !allowed) {
    return (
      <DashboardPage
        title="Addendum Templates"
        subtitle="Upload reusable addendum files (PDF or DOCX) you can attach to new contracts."
      >
        <div className="bg-white rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center text-center border border-[#e8e6e0]">
          <div className="w-14 h-14 rounded-full bg-[#f4f3ef] flex items-center justify-center mb-4">
            <Lock size={24} className="text-[#9b9890]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No access</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">
            This landlord hasn&apos;t granted you permission to manage agreements, so templates are unavailable.
          </p>
        </div>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage
      title="Addendum Templates"
      subtitle="Upload reusable addendum files (PDF or DOCX) you can attach to new contracts."
      actions={
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f]"
        >
          <Plus size={16} /> New template
        </button>
      }
    >
      {err && (
        <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />{err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-[#6b6860]">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Loading…</span>
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center text-center border border-[#e8e6e0]">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <FileText size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No templates yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs mb-4">
            Upload an addendum file once and attach it to any contract going forward.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f]"
          >
            <UploadCloud size={14} /> Upload your first template
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-[#e8e6e0] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#f9f8f6] border-b border-[#e8e6e0]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Uploaded</th>
                <th className="text-right px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} className="border-b border-[#f4f3ef] last:border-b-0 hover:bg-[#fafaf8]">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      <FileText size={16} className="text-[#2e9f82] mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-[#1a1916]">{t.name}</p>
                        {t.description && <p className="text-xs text-[#9b9890] mt-0.5">{t.description}</p>}
                        {t.originalFilename && <p className="text-[10px] text-[#c0bdb8] mt-0.5 font-mono">{t.originalFilename}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6b6860]">{t.terms ? 'Terms' : mimeLabel(t.mimeType ?? '')}</td>
                  <td className="px-4 py-3 text-xs text-[#6b6860]">
                    {new Date(t.createdAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {t.fileUrl && (
                        <a href={t.fileUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#2e9f82] hover:bg-[#f0faf6]">
                          <ExternalLink size={12} /> Preview
                        </a>
                      )}
                      <button onClick={() => handleDelete(t.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#dc2626] hover:bg-red-50">
                        <Trash2 size={12} /> Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && effectiveRp != null && (
        <NewTemplateModal
          rp={effectiveRp}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); void fetchAll(); }}
        />
      )}
    </DashboardPage>
  );
}

function mimeLabel(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('word')) return 'DOCX';
  return mime;
}

/* ─── New template modal ─────────────────────────────────────────── */

function NewTemplateModal({ rp, onClose, onCreated }: { rp: number; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    if (!file) { setErr('Please choose a file'); return; }
    if (!ALLOWED_MIME.includes(file.type)) {
      setErr('Only PDF and Word documents are supported');
      return;
    }
    setBusy(true); setErr(null);
    try {
      // 1. Get presigned URL (scoped to the landlord).
      const presigned = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
        `/manager/templates/upload-url?rp=${rp}`,
        { mimeType: file.type, originalName: file.name },
      );
      // 2. PUT binary to S3 (or local proxy).
      // The local-dev URL points at /api/documents/_upload/... which is same-origin so no CORS hop.
      const target = (() => {
        try { const p = new URL(presigned.uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : presigned.uploadUrl; }
        catch { return presigned.uploadUrl; }
      })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error(`Upload failed (status ${putRes.status})`);
      // 3. Register the template (scoped to the landlord).
      await apiPost(`/manager/templates?rp=${rp}`, {
        name: name.trim(),
        description: description.trim() || undefined,
        fileUrl: presigned.fileUrl,
        fileKey: presigned.fileKey,
        mimeType: file.type,
        originalFilename: file.name,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-base font-bold text-[#1a1916]">New addendum template</h3>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-[#6b6860] block mb-1.5">Template name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Pet policy addendum"
              className="w-full px-3 py-2 rounded-xl border border-[#e8e6e0] text-sm focus:outline-none focus:border-[#2e9f82]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b6860] block mb-1.5">Description (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="What this addendum covers — for your team's reference."
              className="w-full px-3 py-2 rounded-xl border border-[#e8e6e0] text-sm focus:outline-none focus:border-[#2e9f82] resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b6860] block mb-1.5">File (PDF or DOCX)</label>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2 border-dashed border-[#e8e6e0] text-sm text-[#6b6860] hover:border-[#2e9f82] hover:bg-[#f0faf6]">
              <UploadCloud size={16} />
              {file ? file.name : 'Click to choose file'}
            </button>
          </div>
          {err && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2"><AlertCircle size={12} /> {err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e8e6e0] bg-[#fafaf8]">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[#6b6860] hover:bg-white">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !file || !name.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
            {busy ? 'Uploading…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}
