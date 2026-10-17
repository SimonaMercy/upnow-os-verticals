/**
 * Move (inspection) templates tab — lives on /rental-provider/dashboard/templates
 * alongside Addendum templates. Each RP builds a reusable move-in / move-out
 * inspection STRUCTURE once (categories → sub-category/component rows), keyed by
 * property Category (spaceCategory) + Sub-category (unitType). One template
 * serves BOTH phases. Every inspection for a matching unit instantiates from the
 * template instead of the code scaffold (backend: getCategoryInspection).
 *
 * Editor starts BLANK — the RP adds each category (pick from the standard list
 * or type a custom one) and each component (standard or custom) by hand.
 *
 * Endpoints (RP): /inspection-templates  ·  manager proxy: /manager/inspection-templates?rp=
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardCheck, Trash2, Loader2, AlertCircle, Plus, Star, Pencil, X, Boxes, ChevronDown,
  Eye, LayoutGrid, Rows3,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { SPACE_CATEGORIES, categoryDisplayLabel } from '@/components/upnow/PropertyFormModal';
import { unitTypesForCategory, UNIT_TYPE_LABELS } from '@/components/upnow/UnitFormModal';
import { CATALOG, CATALOG_BY_KEY, slug, type InspectionDoc, type InspectionCategory, type InspectionItem } from '@/lib/inspectionCatalog';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';
import { useBackClose } from '@/lib/useSlideOver';

/* ─── Types ──────────────────────────────────────────────────────────── */

interface TplItem {
  componentName: string;
  subCategory?: string;
  unitOfMeasure?: string;
  unitCostAed?: number;
  isCustom?: boolean;
}
interface TplCategory {
  key: string;
  label: string;
  unitLabel: string;
  subCategories?: string[];
  items: TplItem[];
}
interface MoveTemplate {
  id: number;
  name: string;
  description: string | null;
  spaceCategory: string | null;
  unitType: string | null;
  structure: { categories: TplCategory[] };
  itemCount?: number;
  createdAt: string;
  updatedAt?: string;
}

/** RP hits /inspection-templates; a manager acting for a landlord hits the
 *  /manager/inspection-templates proxy scoped by ?rp=. */
function moveUrl(manager: { rp: number } | undefined, suffix = ''): string {
  return manager
    ? `/manager/inspection-templates${suffix}?rp=${manager.rp}`
    : `/inspection-templates${suffix}`;
}

function defaultLabel(spaceCategory: string | null, unitType: string | null): string | null {
  if (!spaceCategory) return null;
  const cat = categoryDisplayLabel(spaceCategory);
  return unitType ? `${cat} › ${UNIT_TYPE_LABELS[unitType] ?? unitType}` : `${cat} (all)`;
}

const GREEN = '#047246';
const LINE = '#e4e9e5';
const VIEW_KEY = 'moveTemplatesView';

function catCount(t: MoveTemplate): number { return (t.structure?.categories ?? []).length; }
function itemCount(t: MoveTemplate): number {
  return t.itemCount ?? (t.structure?.categories ?? []).reduce((n, c) => n + (c.items?.length ?? 0), 0);
}
function AppliesTo({ t }: { t: MoveTemplate }) {
  const label = defaultLabel(t.spaceCategory, t.unitType);
  return label ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fef3c7] text-[#b45309] font-medium text-xs">
      <Star size={11} className="fill-[#b45309]" /> {label}
    </span>
  ) : (
    <span className="text-[#c0bdb8] text-xs">— library only</span>
  );
}

/* ─── List ───────────────────────────────────────────────────────────── */

export default function MoveTemplatesTab({
  manager, createOpen, onCloseCreate,
}: { manager?: { rp: number }; createOpen: boolean; onCloseCreate: () => void }) {
  const [rows, setRows] = useState<MoveTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<MoveTemplate | null>(null);
  const [viewRow, setViewRow] = useState<MoveTemplate | null>(null);
  const [view, setView] = useState<'grid' | 'row'>('row');

  // Persist the chosen view (grid/row): restore on mount, write on user action
  // (write-on-action avoids any mount-order / strict-mode overwrite race).
  useEffect(() => {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(VIEW_KEY) : null;
    if (v === 'grid' || v === 'row') setView(v);
  }, []);
  const selectView = (v: 'grid' | 'row') => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch {} };

  async function fetchAll() {
    setLoading(true); setErr(null);
    try {
      setRows(await apiGet<MoveTemplate[]>(moveUrl(manager)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load move templates');
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void fetchAll(); }, []);

  async function handleDelete(id: number) {
    if (!confirm('Remove this move template? Inspections already saved keep their copy.')) return;
    try {
      await apiDelete(moveUrl(manager, `/${id}`));
      await fetchAll();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div>
      {err && (
        <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200 flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />{err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-[#5f6b63]">
          <Loader2 size={18} className="animate-spin" /> <span className="text-sm">Loading…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 shadow-sm flex flex-col items-center justify-center text-center border border-[#e4e9e5]">
          <div className="w-14 h-14 rounded-full bg-[#d8efe3] flex items-center justify-center mb-4">
            <ClipboardCheck size={24} className="text-[#047246]" />
          </div>
          <h3 className="font-semibold text-[#14201a] mb-1">No move templates yet</h3>
          <p className="text-sm text-[#5f6b63] max-w-sm mb-1">
            Build your move-in / move-out inspection once — group by Category → Sub-category and set it
            as the default for a property type. New inspections of that type use it automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Toolbar: count + grid/row toggle */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#8a948d]">{rows.length} template{rows.length === 1 ? '' : 's'}</span>
            <div className="inline-flex" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 11, padding: 4, gap: 3 }}>
              {([['grid', LayoutGrid, 'Grid'], ['row', Rows3, 'Rows']] as const).map(([v, Icon, label]) => (
                <button key={v} onClick={() => selectView(v)} title={`${label} view`} aria-label={`${label} view`} aria-pressed={view === v}
                  className="flex items-center justify-center"
                  style={{ width: 34, height: 34, borderRadius: 8, ...(view === v ? { background: GREEN, color: '#fff' } : { color: '#8a948d' }) }}>
                  <Icon size={17} />
                </button>
              ))}
            </div>
          </div>

          {view === 'grid' ? (
            /* ── Grid view ── */
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {rows.map(t => (
                <div key={t.id} className="bg-white rounded-2xl shadow-sm border border-[#e4e9e5] p-4 flex flex-col">
                  <div className="flex items-start gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-[#d8efe3] flex items-center justify-center shrink-0">
                      <ClipboardCheck size={16} className="text-[#047246]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#14201a] leading-tight">{t.name}</p>
                      <div className="mt-1.5"><AppliesTo t={t} /></div>
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-end gap-1 pt-2 border-t border-[#eef1ef]">
                    <button onClick={() => setViewRow(t)} title="View" className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#047246] hover:bg-[#eef7f2]"><Eye size={14} /> View</button>
                    <button onClick={() => setEditRow(t)} title="Edit" className="p-1.5 rounded-lg text-[#14201a] hover:bg-[#eef1ef]"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(t.id)} title="Remove" className="p-1.5 rounded-lg text-[#dc2626] hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── Row view ── */
            <div className="bg-white rounded-2xl shadow-sm border border-[#e4e9e5] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#f9f8f6] border-b border-[#e4e9e5]">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-[#5f6b63] text-xs uppercase tracking-wide">Name</th>
                    <th className="text-left px-4 py-3 font-semibold text-[#5f6b63] text-xs uppercase tracking-wide">Applies to</th>
                    <th className="text-left px-4 py-3 font-semibold text-[#5f6b63] text-xs uppercase tracking-wide">Structure</th>
                    <th className="text-left px-4 py-3 font-semibold text-[#5f6b63] text-xs uppercase tracking-wide">Updated</th>
                    <th className="text-right px-4 py-3 font-semibold text-[#5f6b63] text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.id} className="border-b border-[#eef1ef] last:border-b-0 hover:bg-[#f6f8f6]">
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          <ClipboardCheck size={16} className="text-[#047246] mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="font-semibold text-[#14201a]">{t.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><AppliesTo t={t} /></td>
                      <td className="px-4 py-3 text-xs text-[#5f6b63]">
                        <span className="inline-flex items-center gap-1"><Boxes size={13} className="text-[#8a948d]" /> {catCount(t)} categories · {itemCount(t)} items</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#5f6b63]">
                        {new Date(t.updatedAt ?? t.createdAt).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button onClick={() => setViewRow(t)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#047246] hover:bg-[#eef7f2]">
                            <Eye size={13} /> View
                          </button>
                          <button onClick={() => setEditRow(t)}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#14201a] hover:bg-[#eef1ef]">
                            <Pencil size={12} /> Edit
                          </button>
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
        </>
      )}

      {createOpen && (
        <MoveTemplateEditor manager={manager} onClose={onCloseCreate} onSaved={() => { onCloseCreate(); void fetchAll(); }} />
      )}
      {editRow && (
        <MoveTemplateEditor manager={manager} template={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); void fetchAll(); }} />
      )}
      {viewRow && (
        <MoveTemplatePreview template={viewRow} onClose={() => setViewRow(null)} onEdit={() => { setEditRow(viewRow); setViewRow(null); }} />
      )}
    </div>
  );
}

/* ─── Read-only preview modal ────────────────────────────────────────── */

/** Build a blank InspectionDoc from a template's structure so the preview renders
 *  through the SAME InspectionReportView the RP/customer see for a real inspection
 *  (conditions/quantities/amounts are entered later, so they start empty here). */
function templateToDoc(t: MoveTemplate): InspectionDoc {
  const categories: InspectionCategory[] = (t.structure?.categories ?? []).map((c, ci) => {
    const sectionId = `${c.key}:${ci}`;
    const items: InspectionItem[] = (c.items ?? []).map((it, ii) => ({
      id: `${sectionId}:${ii}`,
      category: c.key as InspectionItem['category'],
      sectionId,
      componentName: it.componentName,
      subCategory: it.subCategory,
      location: 'Unit',
      unitOfMeasure: it.unitOfMeasure as InspectionItem['unitOfMeasure'],
      unitCostAed: it.unitCostAed,
      inCondition: '',
      outCondition: '',
      quantity: 0,
      totalCostAed: 0,
    }));
    return {
      sectionId,
      key: c.key as InspectionCategory['key'],
      label: c.label,
      unitLabel: c.unitLabel,
      count: items.length,
      subCategories: c.subCategories,
      items,
    };
  });
  return { categories, schemaVersion: 2 };
}

function MoveTemplatePreview({ template, onClose, onEdit }: { template: MoveTemplate; onClose: () => void; onEdit: () => void }) {
  // Browser Back closes this full-screen preview instead of navigating away. See useBackClose.
  const dismiss = useBackClose(onClose);
  const [phase, setPhase] = useState<'move_in' | 'move_out'>('move_in');
  // Move-out has two audiences: the RP (always sees prices) and the customer
  // (prices shown only if the RP enables it). `customerPrices` is that switch.
  const [audience, setAudience] = useState<'rp' | 'customer'>('rp');
  const [customerPrices, setCustomerPrices] = useState(false);
  const isCustomer = phase === 'move_out' && audience === 'customer';
  const showPricesProp = phase !== 'move_out' ? undefined : (audience === 'rp' ? true : customerPrices);
  const doc = useMemo(() => templateToDoc(template), [template]);
  const meta: ReportMeta = {
    property: '—', unitNo: '—',
    propertyType: defaultLabel(template.spaceCategory, template.unitType) ?? '—',
    floor: '—', tenantName: '—', tenantPhone: '—', tenantEmail: '—',
    inspectorName: '—', inspectorCompany: '—', inspectorRole: 'Property Representative',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl my-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#eceae4] sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#14201a]">{template.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <AppliesTo t={template} />
              <span className="text-xs text-[#8a948d]">· {catCount(template)} categories · {itemCount(template)} components</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Phase toggle — one template serves both */}
            <div className="inline-flex rounded-lg border border-[#e4e9e5] bg-[#eef1ef] p-0.5">
              {(['move_in', 'move_out'] as const).map(p => (
                <button key={p} onClick={() => setPhase(p)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${phase === p ? 'bg-white text-[#14201a] shadow-sm' : 'text-[#5f6b63] hover:text-[#14201a]'}`}>
                  {p === 'move_in' ? 'Move-in' : 'Move-out'}
                </button>
              ))}
            </div>
            {/* Move-out only: which audience's copy are we previewing */}
            {phase === 'move_out' && (
              <div className="inline-flex rounded-lg border border-[#e4e9e5] bg-[#eef1ef] p-0.5">
                {(['rp', 'customer'] as const).map(a => (
                  <button key={a} onClick={() => setAudience(a)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition ${audience === a ? 'bg-white text-[#14201a] shadow-sm' : 'text-[#5f6b63] hover:text-[#14201a]'}`}>
                    {a === 'rp' ? 'Rental' : 'Customer'}
                  </button>
                ))}
              </div>
            )}
            {/* Prices switch — customer copy ONLY (the RP always sees prices) */}
            {isCustomer && (
              <label className="inline-flex items-center gap-2 px-1 select-none cursor-pointer" title="Show prices on the customer's copy">
                <span className="text-xs font-semibold text-[#5f6b63]">Prices to customer</span>
                <button type="button" role="switch" aria-checked={customerPrices} aria-label="Show prices to customer" onClick={() => setCustomerPrices(v => !v)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${customerPrices ? 'bg-[#047246]' : 'bg-[#d6d3cc]'}`}>
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${customerPrices ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </label>
            )}
            <button onClick={onEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#e4e9e5] text-sm font-medium text-[#14201a] hover:bg-[#eef1ef]"><Pencil size={13} /> Edit</button>
            <button onClick={dismiss} className="p-1.5 rounded-lg text-[#8a948d] hover:bg-[#eef1ef]"><X size={18} /></button>
          </div>
        </div>

        {/* Note */}
        <div className="px-6 pt-4">
          <p className="text-[11px] text-[#a16207] bg-[#fef9ec] border border-[#f3e2b8] rounded-lg px-3 py-2">
            {phase === 'move_out'
              ? <>Preview of the <b>{audience === 'rp' ? 'rental provider’s' : 'customer’s'}</b> move-out report. The rental provider always sees prices; the <b>Prices to customer</b> switch controls whether the customer’s copy shows amounts. Conditions, quantities{showPricesProp ? ' and amounts' : ''} are filled in during the actual inspection.</>
              : <>Preview of how this template renders as a live <b>move-in</b> inspection. Property, customer, conditions and quantities are filled in during the actual inspection.</>}
          </p>
        </div>

        {/* The real inspection report */}
        <div className="px-4 sm:px-6 py-5 overflow-x-auto">
          <InspectionReportView doc={doc} meta={meta} phase={phase} audience={phase === 'move_out' ? audience : 'rp'} editable={false} dates={{}} generalNotes="" showPrices={showPricesProp} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#eceae4] sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={dismiss} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5f6b63] hover:bg-[#eef1ef]">Close</button>
          <button onClick={onEdit} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#047246] text-white text-sm font-semibold hover:bg-[#27896f]"><Pencil size={14} /> Edit template</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Editor modal (blank slate) ─────────────────────────────────────── */

function MoveTemplateEditor({
  manager, template, onClose, onSaved,
}: { manager?: { rp: number }; template?: MoveTemplate; onClose: () => void; onSaved: () => void }) {
  // Browser Back closes this full-screen editor instead of navigating away. See useBackClose.
  const dismiss = useBackClose(onClose);
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [spaceCategory, setSpaceCategory] = useState(template?.spaceCategory ?? '');
  const [unitType, setUnitType] = useState(template?.unitType ?? '');
  const [cats, setCats] = useState<TplCategory[]>(
    () => (template?.structure?.categories ?? []).map(c => ({ ...c, items: [...(c.items ?? [])] })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const customSeq = useRef(0);

  const subTypes = spaceCategory ? unitTypesForCategory(spaceCategory) : [];
  const usedKeys = new Set(cats.map(c => c.key));
  const availableCats = CATALOG.filter(c => !usedKeys.has(c.key));

  function addStandardCategory(key: string) {
    const cat = CATALOG_BY_KEY[key as keyof typeof CATALOG_BY_KEY];
    if (!cat) return;
    setCats(prev => [...prev, { key: cat.key, label: cat.label, unitLabel: cat.unitLabel, subCategories: cat.subCategories, items: [] }]);
  }
  function addCustomCategory() {
    const n = ++customSeq.current;
    setCats(prev => [...prev, { key: `custom:c${n}`, label: '', unitLabel: 'Per Item', items: [] }]);
  }
  function removeCategory(i: number) { setCats(prev => prev.filter((_, idx) => idx !== i)); }
  function patchCategory(i: number, patch: Partial<TplCategory>) {
    setCats(prev => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function addStandardComponent(ci: number, name: string) {
    const cat = cats[ci];
    const seed = CATALOG_BY_KEY[cat.key as keyof typeof CATALOG_BY_KEY]?.seed.find(s => s.name === name);
    const item: TplItem = seed
      ? { componentName: seed.name, subCategory: seed.subCategory, unitOfMeasure: seed.unitOfMeasure, unitCostAed: seed.unitPriceAed }
      : { componentName: name, unitOfMeasure: 'item', unitCostAed: 0, isCustom: true };
    patchCategory(ci, { items: [...cat.items, item] });
  }
  function addCustomComponent(ci: number) {
    const cat = cats[ci];
    patchCategory(ci, { items: [...cat.items, { componentName: '', unitOfMeasure: 'item', unitCostAed: 0, isCustom: true }] });
  }
  function removeComponent(ci: number, ii: number) {
    patchCategory(ci, { items: cats[ci].items.filter((_, idx) => idx !== ii) });
  }
  function patchItem(ci: number, ii: number, patch: Partial<TplItem>) {
    patchCategory(ci, { items: cats[ci].items.map((it, idx) => (idx === ii ? { ...it, ...patch } : it)) });
  }

  async function submit() {
    if (!name.trim()) { setErr('Template name is required'); return; }
    const cleanCats = cats
      .map(c => ({ ...c, label: c.label.trim() || 'Untitled category', items: c.items.filter(it => it.componentName.trim()) }))
      .filter(c => c.items.length > 0);
    if (cleanCats.length === 0) { setErr('Add at least one category with one component'); return; }
    setBusy(true); setErr(null);
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      spaceCategory: spaceCategory || null,
      unitType: spaceCategory && unitType ? unitType : null,
      structure: { categories: cleanCats },
    };
    try {
      if (template) await apiPatch(moveUrl(manager, `/${template.id}`), payload);
      else await apiPost(moveUrl(manager), payload);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save template');
      setBusy(false);
    }
  }

  const SELECT = 'w-full px-2.5 py-1.5 rounded-lg border border-[#e4e9e5] bg-white text-sm focus:outline-none focus:border-[#047246]';
  const LBL = 'text-[10px] font-semibold text-[#5f6b63] block mb-1 uppercase tracking-wide';
  const totalItems = cats.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl my-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[#eceae4] sticky top-0 bg-white rounded-t-2xl z-10">
          <div>
            <h2 className="text-lg font-bold text-[#14201a]">{template ? `Edit — ${template.name}` : 'New move template'}</h2>
            <p className="text-xs text-[#8a948d] mt-0.5">Build the move-in / move-out inspection structure. It applies to both phases; move-out adds amounts automatically.</p>
          </div>
          <button onClick={dismiss} className="p-1.5 rounded-lg text-[#8a948d] hover:bg-[#eef1ef]"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Meta */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className={LBL}>Template name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard apartment" className={SELECT} />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className={LBL}>Description (optional)</label>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="For your team's reference" className={SELECT} />
            </div>
            <div className="w-44">
              <label className={LBL}>Property category</label>
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
            <p className="text-[10px] text-[#a16207] -mt-2">Auto-applies to new inspections for {defaultLabel(spaceCategory, unitType || null)} — replaces any current one.</p>
          )}

          {/* Categories builder */}
          <div className="border-t border-[#f0efe9] pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-[#14201a]">Inspection structure</h3>
              <span className="text-[11px] text-[#8a948d]">{cats.length} categories · {totalItems} components</span>
            </div>

            {cats.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#e0ddd5] bg-[#fbfaf8] px-4 py-8 text-center text-sm text-[#8a948d] mb-3">
                Blank slate — add the categories you inspect, then the components under each.
              </div>
            )}

            <div className="space-y-3">
              {cats.map((cat, ci) => {
                const seedNames = CATALOG_BY_KEY[cat.key as keyof typeof CATALOG_BY_KEY]?.seed ?? [];
                const usedNames = new Set(cat.items.map(it => it.componentName));
                const availableComps = seedNames.filter(s => !usedNames.has(s.name));
                return (
                  <div key={cat.key + ci} data-testid="tpl-cat" className="rounded-xl border border-[#e4e9e5] overflow-hidden">
                    {/* Category header */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#f9f8f6] border-b border-[#eceae4]">
                      <span className="text-[10px] font-bold text-[#8a948d] w-5 text-center">{ci + 1}</span>
                      <input value={cat.label} onChange={e => patchCategory(ci, { label: e.target.value })} placeholder="Category name"
                        className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-[#14201a] focus:outline-none" />
                      <input value={cat.unitLabel} onChange={e => patchCategory(ci, { unitLabel: e.target.value })} placeholder="Per Item"
                        className="w-28 px-2 py-1 rounded-md border border-[#e4e9e5] bg-white text-[11px] text-[#5f6b63] focus:outline-none focus:border-[#047246]" />
                      <button onClick={() => removeCategory(ci)} title="Remove category"
                        className="p-1.5 rounded-md text-[#dc2626] hover:bg-red-50"><Trash2 size={14} /></button>
                    </div>

                    {/* Components */}
                    <div className="px-3 py-2 space-y-1.5">
                      {cat.items.length === 0 && (
                        <p className="text-[11px] text-[#c0bdb8] px-1 py-1">No components yet — add from the standard list or a custom one.</p>
                      )}
                      {cat.items.map((it, ii) => (
                        <div key={ii} className="flex items-center gap-2">
                          <span className="text-[10px] text-[#c0bdb8] w-8 text-right tabular-nums">{ci + 1}.{ii + 1}</span>
                          <input value={it.componentName} onChange={e => patchItem(ci, ii, { componentName: e.target.value })} placeholder="Component name"
                            className="flex-1 min-w-0 px-2 py-1 rounded-md border border-[#e4e9e5] text-sm focus:outline-none focus:border-[#047246]" />
                          <input value={it.unitOfMeasure ?? ''} onChange={e => patchItem(ci, ii, { unitOfMeasure: e.target.value })} placeholder="item"
                            className="w-20 px-2 py-1 rounded-md border border-[#e4e9e5] text-[11px] text-[#5f6b63] focus:outline-none focus:border-[#047246]" />
                          <div className="relative w-24">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#c0bdb8]">AED</span>
                            <input type="number" min={0} value={it.unitCostAed ?? ''} onChange={e => patchItem(ci, ii, { unitCostAed: Number(e.target.value) || 0 })} placeholder="0"
                              className="w-full pl-8 pr-2 py-1 rounded-md border border-[#e4e9e5] text-sm text-right tabular-nums focus:outline-none focus:border-[#047246]" />
                          </div>
                          <button onClick={() => removeComponent(ci, ii)} title="Remove component"
                            className="p-1 rounded-md text-[#8a948d] hover:text-[#dc2626] hover:bg-red-50"><X size={14} /></button>
                        </div>
                      ))}

                      {/* Add component */}
                      <div className="flex items-center gap-2 pt-1">
                        {availableComps.length > 0 && (
                          <div className="relative">
                            <select value="" data-testid="tpl-std-comp" onChange={e => { if (e.target.value) addStandardComponent(ci, e.target.value); }}
                              className="appearance-none pl-2.5 pr-7 py-1 rounded-md border border-[#e4e9e5] bg-white text-[11px] text-[#047246] font-medium focus:outline-none focus:border-[#047246]">
                              <option value="">+ Standard component…</option>
                              {availableComps.map(s => <option key={s.name} value={s.name}>{s.name}{s.subCategory ? ` (${s.subCategory})` : ''}</option>)}
                            </select>
                            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8a948d] pointer-events-none" />
                          </div>
                        )}
                        <button onClick={() => addCustomComponent(ci)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-dashed border-[#cfe8df] text-[11px] font-medium text-[#047246] hover:bg-[#eef7f2]">
                          <Plus size={12} /> Custom component
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add category */}
            <div className="flex items-center gap-2 mt-3">
              {availableCats.length > 0 && (
                <div className="relative">
                  <select value="" data-testid="tpl-std-cat" onChange={e => { if (e.target.value) addStandardCategory(e.target.value); }}
                    className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-[#e4e9e5] bg-white text-sm text-[#14201a] font-medium focus:outline-none focus:border-[#047246]">
                    <option value="">+ Add standard category…</option>
                    {availableCats.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a948d] pointer-events-none" />
                </div>
              )}
              <button onClick={addCustomCategory}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#cfe8df] text-sm font-medium text-[#047246] hover:bg-[#eef7f2]">
                <Plus size={14} /> Custom category
              </button>
            </div>
          </div>

          {err && <p className="text-[12px] text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {err}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#eceae4] sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={dismiss} className="px-4 py-2 rounded-xl text-sm font-medium text-[#5f6b63] hover:bg-[#eef1ef]">Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#047246] text-white text-sm font-semibold hover:bg-[#27896f] disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {template ? 'Save changes' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}
