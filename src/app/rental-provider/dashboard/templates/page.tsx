/**
 * Rental Provider — Addendum Templates page
 * Route: /rental-provider/dashboard/templates
 *
 * RP-managed library of reusable addendum files (PDF / DOCX). Each template
 * can later be picked from a dropdown on the New Contract page to attach to
 * a draft contract as a `contract_addendums` row.
 *
 * Upload flow (3-step, matches /documents pattern):
 *   1. POST /api/addendum-templates/upload-url  → presigned S3 URL
 *   2. PUT  <uploadUrl> with binary body
 *   3. POST /api/addendum-templates             → register the template
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState, useRef } from 'react';
import { FileText, UploadCloud, Trash2, Loader2, AlertCircle, Plus, X, ExternalLink, Star, PenLine, FileType2 } from 'lucide-react';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { unitTypesForCategory, UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import AddendumTermsEditor from '@/components/upnow/AddendumTermsEditor';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';

interface AddendumTemplate {
  id: number;
  name: string;
  description: string | null;
  // File path — null for in-app TEXT templates.
  fileUrl: string | null;
  fileKey: string | null;
  mimeType: string | null;
  originalFilename: string | null;
  // In-app bilingual terms — null for file templates.
  terms: AddendumTerms | null;
  /** When set, this template is the RP's default addendum for this property category. */
  spaceCategory: string | null;
  /** Sub-category (unit type) the default applies to; null = category-wide default. */
  unitType: string | null;
  createdAt: string;
}

/** Human-readable "Commercial › Retail Shop" / "Commercial (all)" for a default key. */
function defaultLabel(spaceCategory: string | null, unitType: string | null): string | null {
  if (!spaceCategory) return null;
  const cat = categoryDisplayLabel(spaceCategory);
  return unitType ? `${cat} › ${UNIT_TYPE_LABELS[unitType] ?? unitType}` : `${cat} (all)`;
}

const ALLOWED_MIME = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export default function AddendumTemplatesPage() {
  const [templates, setTemplates] = useState<AddendumTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function fetchAll() {
    setLoading(true); setErr(null);
    try {
      const list = await apiGet<AddendumTemplate[]>('/addendum-templates');
      setTemplates(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void fetchAll(); }, []);

  async function handleDelete(id: number) {
    if (!confirm('Remove this template? Past contracts that use it will keep their copy.')) return;
    try {
      await apiDelete(`/addendum-templates/${id}`);
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <DashboardPage
      title="Addendum Templates"
      subtitle="Upload reusable addendum files (PDF or DOCX). Mark one as the default for a property category or unit type and it pre-fills new layouts of that kind."
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
                <th className="text-left px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Default for</th>
                <th className="text-left px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Uploaded</th>
                <th className="text-right px-4 py-3 font-semibold text-[#6b6860] text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} className="border-b border-[#f4f3ef] last:border-b-0 hover:bg-[#fafaf8]">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-2">
                      {t.terms ? <FileType2 size={16} className="text-[#2e9f82] mt-0.5 shrink-0" /> : <FileText size={16} className="text-[#2e9f82] mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-[#1a1916]">{t.name}</p>
                        {t.description && <p className="text-xs text-[#9b9890] mt-0.5">{t.description}</p>}
                        {t.originalFilename && <p className="text-[10px] text-[#c0bdb8] mt-0.5 font-mono">{t.originalFilename}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[#6b6860]">{t.terms ? 'Terms' : mimeLabel(t.mimeType ?? '')}</td>
                  <td className="px-4 py-3 text-xs">
                    {defaultLabel(t.spaceCategory, t.unitType) ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#b45309] font-medium">
                        <Star size={11} className="fill-[#b45309]" /> {defaultLabel(t.spaceCategory, t.unitType)}
                      </span>
                    ) : (
                      <span className="text-[#c0bdb8]">—</span>
                    )}
                  </td>
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

      {showForm && (
        <NewTemplateModal
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

function NewTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Authoring mode: in-app bilingual terms (default, friendly) vs upload a file.
  const [mode, setMode] = useState<'terms' | 'file'>('terms');
  const [terms, setTerms] = useState<AddendumTerms>(emptyAddendumTerms());
  const [file, setFile] = useState<File | null>(null);
  // Optional default key: a category (and optional sub-category/unit type). Blank
  // category = an ordinary library template (no auto pre-fill).
  const [spaceCategory, setSpaceCategory] = useState('');
  const [unitType, setUnitType] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subTypes = spaceCategory ? unitTypesForCategory(spaceCategory) : [];
  const keyFields = {
    spaceCategory: spaceCategory || undefined,
    unitType: spaceCategory && unitType ? unitType : undefined,
  };

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    setBusy(true); setErr(null);
    try {
      if (mode === 'terms') {
        if (!hasAddendumTerms(terms)) { setErr('Add at least one addendum term'); setBusy(false); return; }
        await apiPost('/addendum-templates', {
          name: name.trim(),
          description: description.trim() || undefined,
          terms,
          ...keyFields,
        });
        onCreated();
        return;
      }
      // File mode — 3-step upload.
      if (!file) { setErr('Please choose a file'); setBusy(false); return; }
      if (!ALLOWED_MIME.includes(file.type)) { setErr('Only PDF and Word documents are supported'); setBusy(false); return; }
      // 1. Get presigned URL
      const presigned = await apiPost<{ uploadUrl: string; fileUrl: string; fileKey: string }>(
        '/addendum-templates/upload-url',
        { mimeType: file.type, originalName: file.name },
      );
      // 2. PUT binary to S3 (or local proxy)
      // The local-dev URL points at /api/documents/_upload/... which is same-origin so no CORS hop.
      const target = (() => {
        try { const p = new URL(presigned.uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : presigned.uploadUrl; }
        catch { return presigned.uploadUrl; }
      })();
      const putRes = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error(`Upload failed (status ${putRes.status})`);
      // 3. Register the template
      await apiPost('/addendum-templates', {
        name: name.trim(),
        description: description.trim() || undefined,
        fileUrl: presigned.fileUrl,
        fileKey: presigned.fileKey,
        mimeType: file.type,
        originalFilename: file.name,
        ...keyFields,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save template');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl w-full shadow-xl max-h-[94vh] flex flex-col ${mode === 'terms' ? 'max-w-5xl' : 'max-w-lg'}`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e6e0]">
          <h3 className="text-base font-bold text-[#1a1916]">New addendum template</h3>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916] p-1">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-auto flex-1 min-h-0">
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
          {/* Authoring mode toggle — write terms in-app (default) or upload a file. */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('terms')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border ${mode === 'terms' ? 'border-[#2e9f82] bg-[#f0faf6] text-[#2e9f82]' : 'border-[#e8e6e0] text-[#6b6860] hover:bg-[#fafaf8]'}`}>
              <PenLine size={14} /> Write terms in-app
            </button>
            <button type="button" onClick={() => setMode('file')}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border ${mode === 'file' ? 'border-[#2e9f82] bg-[#f0faf6] text-[#2e9f82]' : 'border-[#e8e6e0] text-[#6b6860] hover:bg-[#fafaf8]'}`}>
              <UploadCloud size={14} /> Upload a file
            </button>
          </div>

          {mode === 'terms' ? (
            <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3">
              <AddendumTermsEditor value={terms} onChange={setTerms} height={480} />
            </div>
          ) : (
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
          )}

          {/* Optional: make this the default addendum for a category / unit type.
              When set, new layouts of that kind pre-fill this template. */}
          <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <Star size={13} className="text-[#b45309]" />
              <p className="text-xs font-semibold text-[#b45309]">Set as default for… <span className="font-normal text-[#a16207]">(optional)</span></p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold text-[#a16207] block mb-1 uppercase tracking-wide">Category</label>
                <select value={spaceCategory}
                  onChange={e => { setSpaceCategory(e.target.value); setUnitType(''); }}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#fde68a] bg-white text-sm focus:outline-none focus:border-[#b45309]">
                  <option value="">No default (library only)</option>
                  {SPACE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-[#a16207] block mb-1 uppercase tracking-wide">Sub-category</label>
                <select value={unitType} onChange={e => setUnitType(e.target.value)} disabled={!spaceCategory}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#fde68a] bg-white text-sm focus:outline-none focus:border-[#b45309] disabled:opacity-50 disabled:bg-[#faf7ef]">
                  <option value="">All of this category</option>
                  {subTypes.map(u => <option key={u} value={u}>{UNIT_TYPE_LABELS[u] ?? u}</option>)}
                </select>
              </div>
            </div>
            {spaceCategory && (
              <p className="text-[10px] text-[#a16207]">
                Replaces any current default for {defaultLabel(spaceCategory, unitType || null)}.
              </p>
            )}
          </div>

          {err && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg flex items-center gap-2"><AlertCircle size={12} /> {err}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e8e6e0] bg-[#fafaf8]">
          <button onClick={onClose} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[#6b6860] hover:bg-white">
            Cancel
          </button>
          <button onClick={submit}
            disabled={busy || !name.trim() || (mode === 'terms' ? !hasAddendumTerms(terms) : !file)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f] disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
            {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}
