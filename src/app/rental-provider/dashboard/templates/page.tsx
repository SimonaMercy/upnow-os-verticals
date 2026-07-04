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

import { useEffect, useState } from 'react';
import { FileText, Trash2, Loader2, AlertCircle, Plus, ExternalLink, Star, PenLine, FileType2, Pencil, Lock } from 'lucide-react';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { unitTypesForCategory, UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumPreviewModal from '@/components/upnow/AddendumPreviewModal';
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
  /** True when this template is already attached to a contract — editing it then
   *  creates a new version rather than mutating the in-use one. */
  inUse?: boolean;
  createdAt: string;
}

/** Human-readable "Commercial › Retail Shop" / "Commercial (all)" for a default key. */
function defaultLabel(spaceCategory: string | null, unitType: string | null): string | null {
  if (!spaceCategory) return null;
  const cat = categoryDisplayLabel(spaceCategory);
  return unitType ? `${cat} › ${UNIT_TYPE_LABELS[unitType] ?? unitType}` : `${cat} (all)`;
}

/** RP hits /addendum-templates; a manager acting for a landlord hits the
 *  /manager/templates proxy scoped by ?rp= (canManageTemplates). */
function tplUrl(manager: { rp: number } | undefined, suffix = ''): string {
  return manager
    ? `/manager/templates${suffix}?rp=${manager.rp}`
    : `/addendum-templates${suffix}`;
}

/** Manager route wraps this with manager={{ rp }}; the RP route uses the default. */
export default function AddendumTemplatesPage() {
  return <TemplatesWorkspace />;
}

export function TemplatesWorkspace({ manager }: { manager?: { rp: number } }) {
  const [templates, setTemplates] = useState<AddendumTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<AddendumTemplate | null>(null);
  const [editTpl, setEditTpl] = useState<AddendumTemplate | null>(null);

  async function fetchAll() {
    setLoading(true); setErr(null);
    try {
      const list = await apiGet<AddendumTemplate[]>(tplUrl(manager));
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
      await apiDelete(tplUrl(manager, `/${id}`));
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <DashboardPage
      title="Addendum Templates"
      subtitle="Write reusable addendum templates. Mark one as the default for a property category or unit type and it pre-fills new layouts of that kind."
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
            Write an addendum once and reuse it — set it as the default for a category and it pre-fills new layouts.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f]"
          >
            <PenLine size={14} /> Write your first addendum
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
                      {t.inUse && (
                        <span title="Used on a contract — editing creates a new version"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#eef2ff] text-[#4f46e5] text-[10px] font-medium">
                          <Lock size={10} /> In use
                        </span>
                      )}
                      {t.terms && (
                        <button onClick={() => setPreviewTpl(t)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#2e9f82] hover:bg-[#f0faf6]">
                          <ExternalLink size={12} /> Preview
                        </button>
                      )}
                      {t.terms && (
                        <button onClick={() => setEditTpl(t)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#1a1916] hover:bg-[#f4f3ef]">
                          <Pencil size={12} /> Edit
                        </button>
                      )}
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
          manager={manager}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); void fetchAll(); }}
        />
      )}

      {previewTpl?.terms && (
        <AddendumPreviewModal terms={previewTpl.terms} title={previewTpl.name} onClose={() => setPreviewTpl(null)} />
      )}

      {editTpl && (
        <EditTemplateModal
          manager={manager}
          template={editTpl}
          onClose={() => setEditTpl(null)}
          onSaved={(versioned) => {
            setEditTpl(null);
            if (versioned) alert('Saved as a new version. Contracts already using the previous version keep it unchanged.');
            void fetchAll();
          }}
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

function NewTemplateModal({ manager, onClose, onCreated }: { manager?: { rp: number }; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState<AddendumTerms>(emptyAddendumTerms());
  // Optional default key: a category (+ optional sub-category). Blank = library only.
  const [spaceCategory, setSpaceCategory] = useState('');
  const [unitType, setUnitType] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const subTypes = spaceCategory ? unitTypesForCategory(spaceCategory) : [];

  async function submit() {
    if (!name.trim()) { setErr('Template name is required'); return; }
    if (!hasAddendumTerms(terms)) { setErr('Write at least one addendum term'); return; }
    setBusy(true); setErr(null);
    try {
      await apiPost(tplUrl(manager), {
        name: name.trim(),
        description: description.trim() || undefined,
        terms,
        spaceCategory: spaceCategory || undefined,
        unitType: spaceCategory && unitType ? unitType : undefined,
      });
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save template');
      setBusy(false);
    }
  }

  const SELECT = 'w-full px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]';
  const LBL = 'text-[10px] font-semibold text-[#6b6860] block mb-1 uppercase tracking-wide';

  // All template options live in the full-screen editor's options bar.
  const options = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className={LBL}>Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard residential addendum" className={SELECT} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className={LBL}>Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="For your team's reference" className={SELECT} />
        </div>
        <div className="w-44">
          <label className={LBL}>Default for category</label>
          <select value={spaceCategory} onChange={e => { setSpaceCategory(e.target.value); setUnitType(''); }} className={SELECT}>
            <option value="">No default (library only)</option>
            {SPACE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className={LBL}>Sub-category</label>
          <select value={unitType} onChange={e => setUnitType(e.target.value)} disabled={!spaceCategory} className={`${SELECT} disabled:opacity-50 disabled:bg-[#faf7ef]`}>
            <option value="">All of this category</option>
            {subTypes.map(u => <option key={u} value={u}>{UNIT_TYPE_LABELS[u] ?? u}</option>)}
          </select>
        </div>
      </div>
      {spaceCategory && (
        <p className="text-[10px] text-[#a16207]">Sets the default addendum for {defaultLabel(spaceCategory, unitType || null)} — replaces any current one.</p>
      )}
      {err && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={12} /> {err}</p>}
    </div>
  );

  return (
    <AddendumEditorModal
      value={terms}
      onChange={setTerms}
      onClose={onClose}
      title="New addendum template"
      subtitle="Write the terms; set the name and (optional) category. The layout previews on the right."
      options={options}
      primaryLabel="Save template"
      onPrimary={submit}
      primaryDisabled={!name.trim() || !hasAddendumTerms(terms)}
      busy={busy}
    />
  );
}

/* ─── Edit template modal ────────────────────────────────────────────
 * Editable in place — UNLESS the template is already attached to a contract
 * (`inUse`), in which case saving creates a NEW version and leaves the in-use
 * one untouched on its contracts. */

function EditTemplateModal({ manager, template, onClose, onSaved }: {
  manager?: { rp: number };
  template: AddendumTemplate;
  onClose: () => void;
  onSaved: (versioned: boolean) => void;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [terms, setTerms] = useState<AddendumTerms>(template.terms ?? emptyAddendumTerms());
  const [spaceCategory, setSpaceCategory] = useState(template.spaceCategory ?? '');
  const [unitType, setUnitType] = useState(template.unitType ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inUse = !!template.inUse;
  const subTypes = spaceCategory ? unitTypesForCategory(spaceCategory) : [];

  async function submit() {
    if (!name.trim()) { setErr('Template name is required'); return; }
    if (!hasAddendumTerms(terms)) { setErr('Write at least one addendum term'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await apiPatch<{ versioned?: boolean }>(tplUrl(manager, `/${template.id}`), {
        name: name.trim(),
        description: description.trim() || null,
        terms,
        spaceCategory: spaceCategory || null,
        unitType: spaceCategory && unitType ? unitType : null,
      });
      onSaved(!!res?.versioned);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save template');
      setBusy(false);
    }
  }

  const SELECT = 'w-full px-2.5 py-1.5 rounded-lg border border-[#e8e6e0] bg-white text-sm focus:outline-none focus:border-[#2e9f82]';
  const LBL = 'text-[10px] font-semibold text-[#6b6860] block mb-1 uppercase tracking-wide';

  const options = (
    <div className="space-y-2">
      {inUse && (
        <p className="text-[11px] text-[#4f46e5] bg-[#eef2ff] border border-[#e0e7ff] rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
          <Lock size={12} className="shrink-0" />
          This template is already on a contract. Saving creates a <b>new version</b> — contracts using the current one keep it unchanged.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className={LBL}>Template name</label>
          <input value={name} onChange={e => setName(e.target.value)} className={SELECT} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className={LBL}>Description (optional)</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="For your team's reference" className={SELECT} />
        </div>
        <div className="w-44">
          <label className={LBL}>Default for category</label>
          <select value={spaceCategory} onChange={e => { setSpaceCategory(e.target.value); setUnitType(''); }} className={SELECT}>
            <option value="">No default (library only)</option>
            {SPACE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className={LBL}>Sub-category</label>
          <select value={unitType} onChange={e => setUnitType(e.target.value)} disabled={!spaceCategory} className={`${SELECT} disabled:opacity-50 disabled:bg-[#faf7ef]`}>
            <option value="">All of this category</option>
            {subTypes.map(u => <option key={u} value={u}>{UNIT_TYPE_LABELS[u] ?? u}</option>)}
          </select>
        </div>
      </div>
      {spaceCategory && (
        <p className="text-[10px] text-[#a16207]">Sets the default addendum for {defaultLabel(spaceCategory, unitType || null)} — replaces any current one.</p>
      )}
      {err && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertCircle size={12} /> {err}</p>}
    </div>
  );

  return (
    <AddendumEditorModal
      value={terms}
      onChange={setTerms}
      onClose={onClose}
      title={`Edit — ${template.name}`}
      subtitle="Update the terms; the layout previews on the right."
      options={options}
      primaryLabel={inUse ? 'Save as new version' : 'Save changes'}
      onPrimary={submit}
      primaryDisabled={!name.trim() || !hasAddendumTerms(terms)}
      busy={busy}
    />
  );
}
