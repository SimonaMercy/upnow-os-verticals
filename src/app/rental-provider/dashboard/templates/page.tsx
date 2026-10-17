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
 *
 * Genspark OS rebuild — "Settings › Templates". Parity with previous page:
 *  - TemplatesWorkspace stays a named export with the same `manager?: { rp }` prop —
 *    /dashboard/manager/templates renders it (scoped endpoints /manager/templates?rp=,
 *    canManageTemplates gate in that route; canManageLegal gates Breach/Legal here).
 *  - GET  tplUrl()            — list (loading skeleton, error callout + "Try again", empty
 *                               state with "Write your first addendum").
 *  - POST tplUrl()            — NewTemplateModal (name, description, terms, default
 *                               category + sub-category) — reused unchanged.
 *  - PATCH tplUrl('/:id')     — EditTemplateModal (in-use → "Save as new version" + alert)
 *                               — reused unchanged; terms templates only.
 *  - DELETE tplUrl('/:id')    — "Remove" with the same confirm() + alert on failure.
 *  - Preview: terms → AddendumPreviewModal; file → opens fileUrl in a new tab.
 *  - Download: downloadAddendumPdf (terms) / downloadAddendumFile (file), one at a time.
 *  - Tabs (now a kit Seg): Addendum · Move-in / Move-out · Breach · Legal (the last two
 *    only when showLegalTabs; permission notice otherwise). ?tab= deep-link and the
 *    remembered tab (localStorage templatesTab) kept.
 *  - Rows / Grid view toggle (now labelled Seg), remembered in addendumTemplatesView.
 *  - Columns: Name (+ description, original filename), Type (Terms / PDF / DOCX),
 *    Default for (category › sub-category), Uploaded, In-use pill.
 *  - Head action per tab: "New addendum" / "New move template" / none (legal tabs).
 *  - MoveTemplatesTab and TemplateStudio reused unchanged (rendered outside the .gx
 *    scope so gx.css resets don't restyle them).
 *  - Category selects in both modals remain SPACE_CATEGORIES (mixed-use included).
 *  - There is no duplicate action in the API/UI, so none is shown.
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Plus, Lock } from 'lucide-react';
import {
  OsPage, PageHead, Seg, TableWrap, Pill, Btn, Callout, SkeletonRows, ErrorRow,
} from '@/components/os/kit';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { unitTypesForCategory, UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import AddendumEditorModal from '@/components/upnow/AddendumEditorModal';
import AddendumPreviewModal from '@/components/upnow/AddendumPreviewModal';
import MoveTemplatesTab from '@/components/upnow/MoveTemplatesTab';
import TemplateStudio from '@/components/legal/TemplateStudio';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { type AddendumTerms, emptyAddendumTerms, hasAddendumTerms } from '@/lib/addendumTerms';
import { downloadAddendumPdf, downloadAddendumFile } from '@/lib/openAddendumPdf';

type TemplatesTab = 'addendum' | 'move' | 'breach' | 'legal';

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
  // A manager sees the Breach / Legal letter tabs only when the landlord delegated legal.
  const { canForRp: mgrCanForRp } = useManagerPermissions();
  const showLegalTabs = !manager || mgrCanForRp('canManageLegal', manager.rp);
  const [templates, setTemplates] = useState<AddendumTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<AddendumTemplate | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [editTpl, setEditTpl] = useState<AddendumTemplate | null>(null);
  const [tab, setTab] = useState<TemplatesTab>('addendum');
  const [showMoveEditor, setShowMoveEditor] = useState(false);
  const [addView, setAddView] = useState<'grid' | 'row'>('row');

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

  // Remember the last tab (Addendum / Move) + the Addendum-tab view (grid/row) across
  // navigation + reloads: restore on mount, write on user action (write-on-action
  // avoids any mount-order / strict-mode overwrite race).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // `?tab=legal` (links from the Legal surfaces) wins over the remembered tab.
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    const t = fromUrl ?? window.localStorage.getItem('templatesTab');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (t === 'addendum' || t === 'move' || t === 'breach' || t === 'legal') setTab(t);
    const v = window.localStorage.getItem('addendumTemplatesView');
    if (v === 'grid' || v === 'row') setAddView(v);
  }, []);
  const selectTab = (t: TemplatesTab) => { setTab(t); try { window.localStorage.setItem('templatesTab', t); } catch {} };
  const selectAddView = (v: 'grid' | 'row') => { setAddView(v); try { window.localStorage.setItem('addendumTemplatesView', v); } catch {} };

  async function handleDownload(t: AddendumTemplate) {
    if (downloadingId != null) return;
    setDownloadingId(t.id);
    try {
      if (t.terms) await downloadAddendumPdf(t.terms, t.name);
      else if (t.fileUrl) await downloadAddendumFile(t.fileUrl, t.name, t.mimeType);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Remove this template? Past contracts that use it will keep their copy.')) return;
    try {
      await apiDelete(tplUrl(manager, `/${id}`));
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  const fmtUploaded = (d: string) =>
    new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' });

  const tabOptions: { v: TemplatesTab; l: string; n?: number }[] = [
    { v: 'addendum', l: 'Addendum', n: loading ? undefined : templates.length },
    { v: 'move', l: 'Move-in / Move-out' },
    ...(showLegalTabs ? [{ v: 'breach' as const, l: 'Breach' }, { v: 'legal' as const, l: 'Legal' }] : []),
  ];

  /** Labelled row / card actions — only the ones the template supports. */
  const actionsFor = (t: AddendumTemplate) => (
    <>
      {t.terms && <Btn size="xs" onClick={() => setPreviewTpl(t)}>Preview</Btn>}
      {t.fileUrl && <Btn size="xs" href={t.fileUrl} target="_blank">Preview</Btn>}
      {t.terms && <Btn size="xs" onClick={() => setEditTpl(t)}>Edit</Btn>}
      <Btn size="xs" onClick={() => handleDownload(t)} disabled={downloadingId != null}>
        {downloadingId === t.id ? <><Loader2 size={11} className="animate-spin" aria-hidden /> Downloading…</> : 'Download'}
      </Btn>
      <Btn size="xs" variant="danger" onClick={() => handleDelete(t.id)}>Remove</Btn>
    </>
  );
  const typeLabel = (t: AddendumTemplate) => (t.terms ? 'Terms' : mimeLabel(t.mimeType ?? ''));
  const inUsePill = <Pill tone="info" title="Used on a contract — editing creates a new version">In use</Pill>;

  const emptyState = (
    <div className="gx-empty">
      <b>No templates yet</b>
      Write an addendum once and reuse it — set it as the default for a category and it pre-fills new layouts.
      <div style={{ marginTop: 10 }}><Btn variant="primary" onClick={() => setShowForm(true)}>Write your first addendum</Btn></div>
    </div>
  );

  return (
    <>
      <OsPage className={tab === 'addendum' ? undefined : 'pb-0!'}>
        <PageHead
          eyebrow="Settings › Templates"
          title="Templates"
          lede="Reusable templates for your contracts. Addendum terms attach to a contract; move templates drive move-in / move-out inspections."
          actions={
            tab === 'legal' || tab === 'breach' ? null : tab === 'addendum'
              ? <Btn variant="primary" onClick={() => setShowForm(true)}><Plus size={13} aria-hidden /> New addendum</Btn>
              : <Btn variant="primary" onClick={() => setShowMoveEditor(true)}><Plus size={13} aria-hidden /> New move template</Btn>
          }
        />
        <div style={{ marginBottom: 14 }}>
          <Seg<TemplatesTab> label="Template type" value={tab} options={tabOptions} onChange={selectTab} />
        </div>

        {(tab === 'legal' || tab === 'breach') && !showLegalTabs && (
          <Callout tone="info">This landlord hasn’t granted you the <strong>legal</strong> permission, so their letter templates aren’t available.</Callout>
        )}

        {tab === 'addendum' && (
          <>
            {err && (
              <div style={{ marginBottom: 12 }}>
                <Callout tone="bad" title="Couldn't load templates.">
                  {err} <Btn size="xs" onClick={() => void fetchAll()}>Try again</Btn>
                </Callout>
              </div>
            )}
            <TableWrap
              toolbar={<>
                <span style={{ fontSize: 11.5, color: 'var(--ms-ink-3)' }}>
                  {loading ? 'Loading…' : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
                </span>
                <span className="sp" />
                <Seg<'grid' | 'row'> label="Layout" value={addView} onChange={selectAddView}
                  options={[{ v: 'row', l: 'Rows' }, { v: 'grid', l: 'Grid' }]} />
              </>}
            >
              {addView === 'row' || loading || templates.length === 0 ? (
                <table className="gx-tbl" style={{ minWidth: 880 }}>
                  <thead>
                    <tr><th>Name</th><th>Type</th><th>Default for</th><th>Uploaded</th><th className="act">Actions</th></tr>
                  </thead>
                  {loading ? <SkeletonRows rows={4} cols={5} />
                    : templates.length === 0 ? (err ? <ErrorRow cols={5} onRetry={() => void fetchAll()} /> : <tbody><tr><td colSpan={5}>{emptyState}</td></tr></tbody>)
                    : (
                      <tbody>
                        {templates.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <div className="strong">{t.name}</div>
                              {t.description && <div className="sub">{t.description}</div>}
                              {t.originalFilename && <div className="sub mono">{t.originalFilename}</div>}
                            </td>
                            <td><Pill tone="neutral" dot={false}>{typeLabel(t)}</Pill></td>
                            <td>{defaultLabel(t.spaceCategory, t.unitType) ? <Pill tone="amber">Default · {defaultLabel(t.spaceCategory, t.unitType)}</Pill> : '—'}</td>
                            <td className="nowrap">{fmtUploaded(t.createdAt)}</td>
                            <td className="act">
                              <div className="gx-btn-row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                {t.inUse && inUsePill}
                                {actionsFor(t)}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    )}
                </table>
              ) : (
                <div style={{ display: 'grid', gap: 12, padding: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {templates.map((t) => (
                    <div key={t.id} className="gx-card" style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div>
                        <h4 style={{ fontSize: 13 }}>{t.name}</h4>
                        {t.description && <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 2 }}>{t.description}</p>}
                      </div>
                      <div className="gx-chips">
                        <Pill tone="neutral" dot={false}>{typeLabel(t)}</Pill>
                        {defaultLabel(t.spaceCategory, t.unitType) && <Pill tone="amber">Default · {defaultLabel(t.spaceCategory, t.unitType)}</Pill>}
                        {t.inUse && inUsePill}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ms-ink-3)' }}>Uploaded {fmtUploaded(t.createdAt)}</div>
                      <div className="gx-btn-row" style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--ms-surface-3)' }}>
                        {actionsFor(t)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TableWrap>
          </>
        )}
      </OsPage>

      {/* Legacy Tailwind editors / tabs render OUTSIDE the .gx scope — gx.css's
          unlayered button/link resets would otherwise override their utilities. */}
      {showLegalTabs && (tab === 'legal' || tab === 'breach') && (
        <div style={{ maxWidth: 1420, padding: '0 22px 60px' }}>
          <TemplateStudio key={tab} manager={manager} group={tab} />
        </div>
      )}
      {tab === 'move' && (
        <div style={{ maxWidth: 1420, padding: '0 22px 60px' }}>
          <MoveTemplatesTab manager={manager} createOpen={showMoveEditor} onCloseCreate={() => setShowMoveEditor(false)} />
        </div>
      )}

      {tab === 'addendum' && showForm && (
        <NewTemplateModal
          manager={manager}
          onClose={() => setShowForm(false)}
          onCreated={() => { setShowForm(false); void fetchAll(); }}
        />
      )}

      {tab === 'addendum' && previewTpl?.terms && (
        <AddendumPreviewModal terms={previewTpl.terms} title={previewTpl.name} onClose={() => setPreviewTpl(null)} />
      )}

      {tab === 'addendum' && editTpl && (
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
    </>
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

  const SELECT = 'w-full px-2.5 py-1.5 rounded-lg border border-[#e4e9e5] bg-white text-sm focus:outline-none focus:border-[#047246]';
  const LBL = 'text-[10px] font-semibold text-[#5f6b63] block mb-1 uppercase tracking-wide';

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

  const SELECT = 'w-full px-2.5 py-1.5 rounded-lg border border-[#e4e9e5] bg-white text-sm focus:outline-none focus:border-[#047246]';
  const LBL = 'text-[10px] font-semibold text-[#5f6b63] block mb-1 uppercase tracking-wide';

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
