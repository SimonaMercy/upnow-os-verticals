'use client';

/**
 * RP move-in / move-out inspection workspace — the editable surface of the shared
 * InspectionReportView (design spec §6). Save draft / Submit to tenant (locks) /
 * Reopen to edit. The category-report layout itself lives in InspectionReportView,
 * shared read-only with the tenant page.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams, usePathname } from 'next/navigation';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, CheckCircle, Send, RotateCcw, Lock, Plus, X } from 'lucide-react';
import {
  InspectionDoc, InspectionItem, InspectionCategory, InspectionPriceBookEntry,
  CategoryKey, CanonicalCategoryKey, PriceBookSeedRow,
  CATALOG, CATALOG_BY_KEY, canonicalKey, resolvePriceBookEntry, slug, computeRowTotal,
} from '@/lib/inspectionCatalog';
import { uploadInspectionItemPhoto } from '@/lib/inspectionPhotos';
import { InspectionReportView, type ReportMeta } from '@/components/contract/InspectionReportView';

type Phase = 'move_in' | 'move_out';
const AED = (n: number) => n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ContractMeta {
  property: string; unitNo: string; propertyType: string; floor: string;
  tenantName: string; tenantPhone: string; tenantEmail: string;
}
interface Dates { inspectionDate?: string | null; moveInDate?: string | null; moveOutDate?: string | null; }

export default function CategoryInspectionPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  // Filling / submitting / reopening an inspection is an inspection-management
  // action → a delegated manager needs canManageInspections on this landlord.
  const pathname = usePathname();
  const isManagerView = (pathname ?? '').startsWith('/dashboard/manager');
  const { canForRp } = useManagerPermissions();
  const [landlordId, setLandlordId] = useState<number | null>(null);
  const phase = (search.get('type') ?? 'move_in') as Phase;
  const contractId = params?.id;

  const [doc, setDoc] = useState<InspectionDoc | null>(null);
  const [meta, setMeta] = useState<ContractMeta | null>(null);
  const [dates, setDates] = useState<Dates>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);
  // The RP's inspection price book, so components added by hand from the restoration
  // list carry the RP's own rates (falls back to the platform seed when unavailable).
  const [priceBook, setPriceBook] = useState<InspectionPriceBookEntry[] | null>(null);
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [compPickerSection, setCompPickerSection] = useState<string | null>(null);
  const docRef = useRef<InspectionDoc | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const locked = !!submittedAt;
  // Manager may fill/submit/reopen only with canManageInspections on this
  // landlord; RP owners always may. Hides the Save/Submit/Reopen controls and
  // makes the report read-only when not allowed.
  const canEditInsp = !isManagerView || (landlordId != null && canForRp('canManageInspections', landlordId));

  useEffect(() => {
    if (!contractId) return;
    (async () => {
      setLoading(true);
      try {
        const [inspRes, cRes] = await Promise.all([
          fetch(`/api/contracts/${contractId}/inspection/v2?type=${phase}`, { credentials: 'include' }),
          fetch(`/api/contracts/${contractId}`, { credentials: 'include' }),
        ]);
        if (inspRes.ok) {
          const json = await inspRes.json();
          setDoc(json);
          setSubmittedAt((json?.rpSubmittedAt as string | undefined) ?? null);
        } else setError('Could not load the inspection.');
        if (cRes.ok) {
          const c = await cRes.json();
          setLandlordId(c.landlord?.id ?? null);
          setMeta({
            property: c.property?.buildingName ?? c.unit?.property?.buildingName ?? '',
            unitNo: c.unit?.number ?? c.unit?.unitNumber ?? '',
            propertyType: c.unit?.unitType ?? '',
            floor: c.unit?.floor != null ? String(c.unit.floor) : '',
            tenantName: c.tenant?.name ?? '',
            tenantPhone: c.tenant?.phone ?? '',
            tenantEmail: c.tenant?.email ?? '',
          });
          setDates({
            moveInDate: c.startDate ?? null,
            moveOutDate: c.termination?.effectiveDate ?? c.terminationEffectiveDate ?? c.endDate ?? null,
          });
        }
      } catch {
        setError('Unexpected error loading the inspection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [contractId, phase]);

  // Load the RP price book once so hand-added components resolve to the RP's own
  // rates (best-effort — resolvePriceBookEntry falls back to the platform seed).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/inspection-price-book', { credentials: 'include' });
        if (res.ok && !cancelled) setPriceBook(await res.json());
      } catch { /* seed fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const patchItem = useCallback((sectionId: string, itemId: string, patch: Partial<InspectionItem>) => {
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        categories: d.categories.map((cat) =>
          cat.sectionId !== sectionId ? cat : {
            ...cat,
            items: cat.items.map((it) => {
              if (it.id !== itemId) return it;
              const next = { ...it, ...patch };
              if (!next.totalCostManual) next.totalCostAed = computeRowTotal(next);
              return next;
            }),
          }),
      };
    });
  }, []);

  const setGeneralNotes = useCallback((v: string) => {
    setDoc((d) => (d ? ({ ...d, generalNotes: v }) : d));
  }, []);

  const persistDoc = useCallback(async (docToSave: InspectionDoc): Promise<boolean> => {
    if (!contractId) return false;
    const res = await fetch(`/api/contracts/${contractId}/inspection`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: phase, data: docToSave, finalize: false }),
    });
    return res.ok;
  }, [contractId, phase]);

  // ── Build the move-out list by hand (restoration list) ────────────────────
  // Add a category (standard from the catalog, or a custom one) to the report.
  const addCategory = useCallback((def: { key: CategoryKey; label: string; unitLabel: string; subCategories?: string[] }) => {
    setDoc((d) => {
      if (!d) return d;
      const cats = d.categories ?? [];
      const used = new Set(cats.map((c) => c.sectionId));
      let ord = 0; let sid = `${def.key}:${ord}`;
      while (used.has(sid)) { ord += 1; sid = `${def.key}:${ord}`; }
      const newCat: InspectionCategory = {
        sectionId: sid, key: def.key, label: def.label, unitLabel: def.unitLabel,
        count: 0, subCategories: def.subCategories, nextCloneSeq: 1, nextCustomSeq: 1, items: [],
      };
      return { ...d, categories: [...cats, newCat] };
    });
  }, []);

  // Add a sub-category/component to a category, pricing it from the RP price book
  // (falling back to the platform seed). `seedRow` present → a standard component;
  // absent → a custom, unpriced row the RP can note.
  const addComponent = useCallback((sectionId: string, name: string, seedRow?: PriceBookSeedRow) => {
    if (!name.trim()) return;
    setDoc((d) => {
      if (!d) return d;
      return {
        ...d,
        categories: d.categories.map((cat) => {
          if (cat.sectionId !== sectionId) return cat;
          const key = cat.key as CategoryKey;
          const resolved = seedRow
            ? resolvePriceBookEntry(priceBook, key, seedRow.subCategory ?? null, seedRow.name, seedRow.variantLabel ?? null)
            : undefined;
          const usedIds = new Set(cat.items.map((i) => i.id));
          let idx = cat.items.length; let id = `${slug(sectionId)}:${slug(name)}:${idx}`;
          while (usedIds.has(id)) { idx += 1; id = `${slug(sectionId)}:${slug(name)}:${idx}`; }
          const item: InspectionItem = {
            id, category: key, sectionId,
            componentName: name.trim(),
            location: cat.items[0]?.location ?? cat.label ?? 'Unit',
            isCustom: !seedRow,
            inCondition: '', outCondition: '',
            quantity: 0, totalCostAed: 0, totalCostManual: false,
            unitOfMeasure: resolved?.unitOfMeasure ?? seedRow?.unitOfMeasure ?? 'item',
            vatMode: resolved?.vatMode ?? 'none',
          };
          if (seedRow?.subCategory) item.subCategory = seedRow.subCategory;
          if (resolved) {
            item.unitCostAed = resolved.unitPriceAed;
            if (resolved.variantLabel != null) item.variantLabel = resolved.variantLabel;
            if (resolved.id != null) item.priceBookEntryId = resolved.id;
          }
          return { ...cat, items: [...cat.items, item] };
        }),
      };
    });
  }, [priceBook]);

  const removeComponent = useCallback((sectionId: string, itemId: string) => {
    setDoc((d) => (d ? { ...d, categories: d.categories.map((c) => (c.sectionId !== sectionId ? c : { ...c, items: c.items.filter((i) => i.id !== itemId) })) } : d));
  }, []);

  const removeCategory = useCallback((sectionId: string) => {
    setDoc((d) => (d ? { ...d, categories: d.categories.filter((c) => c.sectionId !== sectionId) } : d));
  }, []);

  const compPickerCat = useMemo(
    () => (compPickerSection ? (doc?.categories.find((c) => c.sectionId === compPickerSection) ?? null) : null),
    [compPickerSection, doc],
  );

  async function handleSave() {
    if (!contractId || !doc) return;
    setSaving(true); setError(null);
    try {
      if (!(await persistDoc(doc))) { setError('Save failed.'); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch { setError('Save failed.'); }
    finally { setSaving(false); }
  }

  // Per-item photos upload immediately (presigned PUT) and auto-persist the doc,
  // so evidence is never lost by forgetting to Save. Only available while unlocked.
  const handleAddItemPhotos = useCallback(async (sectionId: string, itemId: string, files: File[]) => {
    if (!contractId || !files.length) return;
    setUploadingItemId(itemId); setError(null);
    const added = [];
    for (const f of files) { const r = await uploadInspectionItemPhoto(contractId, itemId, f); if (r) added.push(r); }
    setUploadingItemId(null);
    if (!added.length) { setError('Photo upload failed — please retry.'); return; }
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = {
      ...base,
      categories: base.categories.map((cat) =>
        cat.sectionId !== sectionId ? cat : {
          ...cat,
          items: cat.items.map((it) =>
            it.id !== itemId ? it : { ...it, itemAttachments: [...(it.itemAttachments ?? []), ...added] }),
        }),
    };
    docRef.current = next;
    setDoc(next);
    if (!(await persistDoc(next))) setError('Photo added but the save failed — click Save draft.');
  }, [contractId, persistDoc]);

  const handleRemoveItemPhoto = useCallback(async (sectionId: string, itemId: string, photoId: string) => {
    const base = docRef.current;
    if (!base) return;
    const next: InspectionDoc = {
      ...base,
      categories: base.categories.map((cat) =>
        cat.sectionId !== sectionId ? cat : {
          ...cat,
          items: cat.items.map((it) =>
            it.id !== itemId ? it : { ...it, itemAttachments: (it.itemAttachments ?? []).filter((p) => p.id !== photoId) }),
        }),
    };
    docRef.current = next;
    setDoc(next);
    await persistDoc(next);
  }, [persistDoc]);

  async function handleSubmit() {
    if (!contractId || !doc) return;
    if (!window.confirm('Submit this inspection to the tenant? They will be able to review and sign it, and the report is locked from editing.')) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: phase, data: doc, finalize: true }),
      });
      if (!res.ok) { setError('Submit failed.'); return; }
      setSubmitted(true);
      setSubmittedAt(new Date().toISOString());
    } catch { setError('Submit failed.'); }
    finally { setSubmitting(false); }
  }

  async function handleReopen() {
    if (!contractId) return;
    setReopening(true); setError(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/inspection/reopen?type=${phase}`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError((b as { message?: string }).message ?? 'Reopen failed.');
        return;
      }
      setSubmittedAt(null); setSubmitted(false);
    } catch { setError('Reopen failed.'); }
    finally { setReopening(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading inspection…</div>;
  }

  const reportMeta: ReportMeta = {
    property: meta?.property ?? '', unitNo: meta?.unitNo ?? '', propertyType: meta?.propertyType ?? '', floor: meta?.floor ?? '',
    tenantName: meta?.tenantName ?? '', tenantPhone: meta?.tenantPhone ?? '', tenantEmail: meta?.tenantEmail ?? '',
    inspectorName: doc?.inspectorName ?? '', inspectorCompany: doc?.inspectorCompany ?? '', inspectorRole: doc?.inspectorRole ?? 'Property Representative',
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 pb-24">
      {/* Action bar */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <Link href={`/rental-provider/dashboard/contracts/${contractId}/v2`} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916]">
          <ArrowLeft size={15} /> Back to contract
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {canEditInsp && (locked ? (
            <button type="button" onClick={handleReopen} disabled={reopening}
              className="inline-flex items-center gap-2 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-4 py-2.5 disabled:opacity-60 hover:border-[#c8c6be]">
              {reopening ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {reopening ? 'Reopening…' : 'Reopen to edit'}
            </button>
          ) : (
            <>
              <button type="button" onClick={handleSave} disabled={saving || submitting}
                className="inline-flex items-center gap-2 rounded-xl border border-[#2e9f82] text-[#2e9f82] text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : <Save size={16} />}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save draft'}
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-4 py-2.5 disabled:opacity-60">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {submitting ? 'Submitting…' : 'Submit to tenant'}
              </button>
            </>
          ))}
        </div>
      </div>

      {locked && (
        <div className="mb-4 rounded-lg bg-[#fef9ec] border border-[#f3e2b8] text-[#8a6d1a] text-sm px-3 py-2 flex items-center gap-2">
          <Lock size={14} className="shrink-0" />
          <span>Submitted to the tenant — the report is locked for editing. Choose <strong>Reopen to edit</strong> to make changes (only possible until the tenant signs).</span>
        </div>
      )}
      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      {doc && (
        <InspectionReportView
          doc={doc}
          meta={reportMeta}
          phase={phase}
          audience="rp"
          dates={{ inspectionDate: doc.reportGeneratedDate ?? doc.inspectionDate ?? null, moveInDate: doc.moveInDate ?? dates.moveInDate ?? null, moveOutDate: dates.moveOutDate ?? null }}
          editable={!locked && canEditInsp}
          onPatch={patchItem}
          onAddCategory={() => setCatPickerOpen(true)}
          onAddComponent={(sid) => setCompPickerSection(sid)}
          onRemoveComponent={removeComponent}
          onRemoveCategory={removeCategory}
          onAddItemPhotos={handleAddItemPhotos}
          onRemoveItemPhoto={handleRemoveItemPhoto}
          uploadingItemId={uploadingItemId}
          generalNotes={doc.generalNotes ?? ''}
          onGeneralNotes={setGeneralNotes}
        />
      )}

      {catPickerOpen && (
        <AddCategoryPicker
          existingKeys={new Set((doc?.categories ?? []).map((c) => c.key))}
          onAdd={addCategory}
          onClose={() => setCatPickerOpen(false)}
        />
      )}
      {compPickerCat && (
        <AddComponentPicker
          cat={compPickerCat}
          priceBook={priceBook}
          onAdd={(name, seedRow) => addComponent(compPickerCat.sectionId, name, seedRow)}
          onClose={() => setCompPickerSection(null)}
        />
      )}
    </div>
  );
}

/* ─── Restoration-list pickers ─────────────────────────────────────────────
 * The move-out inspection starts from the move-in report (or blank). These two
 * modals let the RP/manager add categories & sub-category/components one by one
 * from the standard restoration catalog (or a custom one). */

function ModalShell({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-8" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl my-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[#eceae4] sticky top-0 bg-white rounded-t-2xl z-10">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1a1916]">{title}</h2>
            {subtitle && <p className="text-xs text-[#9b9890] mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[#9b9890] hover:bg-[#f4f3ef]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex items-center justify-end px-5 py-3 border-t border-[#eceae4] sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold hover:bg-[#27896f]">Done</button>
        </div>
      </div>
    </div>
  );
}

const CUSTOM_INPUT = 'flex-1 min-w-0 px-3 py-2 rounded-lg border border-[#e8e6e0] text-sm focus:outline-none focus:border-[#2e9f82]';
const CUSTOM_ADD = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-[#cfe8df] text-sm font-medium text-[#2e9f82] hover:bg-[#f0faf6] disabled:opacity-50';

/** Pick a category to add. Standard categories already in the report are hidden;
 *  a custom category is always available. Stays open so several can be added. */
function AddCategoryPicker({ existingKeys, onAdd, onClose }: {
  existingKeys: Set<string>;
  onAdd: (def: { key: CategoryKey; label: string; unitLabel: string; subCategories?: string[] }) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const available = CATALOG.filter((c) => !existingKeys.has(c.key));

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    onAdd({ key: `custom:${slug(name)}` as CategoryKey, label: name, unitLabel: 'Per Item' });
    setCustom('');
  };

  return (
    <ModalShell title="Add category" subtitle="From the restoration list, or a custom one" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {available.map((c) => {
          const done = added.has(c.key);
          return (
            <button key={c.key} disabled={done}
              onClick={() => { onAdd({ key: c.key, label: c.label, unitLabel: c.unitLabel, subCategories: c.subCategories }); setAdded((s) => new Set(s).add(c.key)); }}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm text-left ${done ? 'border-[#cfe8df] bg-[#f0faf6] text-[#2e9f82]' : 'border-[#e8e6e0] text-[#1a1916] hover:border-[#2e9f82] hover:bg-[#fafaf8]'}`}>
              <span className="truncate">{c.label}</span>
              {done ? <CheckCircle size={15} className="shrink-0" /> : <Plus size={15} className="shrink-0 text-[#9b9890]" />}
            </button>
          );
        })}
        {available.length === 0 && <p className="col-span-2 text-xs text-[#9b9890] px-1 py-2">All standard categories are already in the report — add a custom one below.</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-[#f0efe9] pt-3">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Custom category name…" className={CUSTOM_INPUT} />
        <button onClick={addCustom} disabled={!custom.trim()} className={CUSTOM_ADD}><Plus size={14} /> Add</button>
      </div>
    </ModalShell>
  );
}

/** Pick a sub-category/component to add to a category. Standard components already
 *  present are hidden; each shows its resolved restoration price. */
function AddComponentPicker({ cat, priceBook, onAdd, onClose }: {
  cat: InspectionCategory;
  priceBook: InspectionPriceBookEntry[] | null;
  onAdd: (name: string, seedRow?: PriceBookSeedRow) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const canon: CanonicalCategoryKey = canonicalKey(cat.key);
  const seed = CATALOG_BY_KEY[canon]?.seed ?? [];
  const usedNames = new Set(cat.items.map((i) => `${i.componentName}|${i.subCategory ?? ''}`));

  const price = (row: PriceBookSeedRow): number | undefined =>
    resolvePriceBookEntry(priceBook, cat.key as CategoryKey, row.subCategory ?? null, row.name, row.variantLabel ?? null)?.unitPriceAed;

  const addCustom = () => {
    const name = custom.trim();
    if (!name) return;
    onAdd(name);
    setCustom('');
  };

  return (
    <ModalShell title={`Add to ${cat.label || 'category'}`} subtitle="From the restoration list, or a custom component" onClose={onClose}>
      <div className="space-y-1.5 mb-4 max-h-[46vh] overflow-y-auto">
        {seed.map((row) => {
          const rowKey = `${row.name}|${row.subCategory ?? ''}`;
          const done = added.has(rowKey) || usedNames.has(rowKey);
          const p = price(row);
          return (
            <button key={rowKey} disabled={done}
              onClick={() => { onAdd(row.name, row); setAdded((s) => new Set(s).add(rowKey)); }}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-sm text-left ${done ? 'border-[#cfe8df] bg-[#f0faf6]' : 'border-[#e8e6e0] hover:border-[#2e9f82] hover:bg-[#fafaf8]'}`}>
              <span className="min-w-0">
                <span className="text-[#1a1916]">{row.name}</span>
                {row.subCategory && <span className="text-xs text-[#9b9890]"> · {row.subCategory}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {p != null && <span className="text-xs text-[#6b6860] tabular-nums">AED {AED(p)}/{row.unitOfMeasure}</span>}
                {done ? <CheckCircle size={15} className="text-[#2e9f82]" /> : <Plus size={15} className="text-[#9b9890]" />}
              </span>
            </button>
          );
        })}
        {seed.length === 0 && <p className="text-xs text-[#9b9890] px-1 py-2">No standard components for this category — add a custom one below.</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-[#f0efe9] pt-3">
        <input value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); }}
          placeholder="Custom component name…" className={CUSTOM_INPUT} />
        <button onClick={addCustom} disabled={!custom.trim()} className={CUSTOM_ADD}><Plus size={14} /> Add</button>
      </div>
    </ModalShell>
  );
}
