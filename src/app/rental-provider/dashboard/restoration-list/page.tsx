'use client';

/**
 * RP → Restoration List — the per-RP inspection price book (§9.9 / R9/R10).
 * Edit the reference unit price / unit-of-measure per component; the move-in/out
 * scaffold reads these rates (seeded from the platform standard). RP-only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, RotateCcw, Check, Loader2, X } from 'lucide-react';
import { CATALOG, UnitOfMeasure, VatMode, VAT_RATE } from '@/lib/inspectionCatalog';

interface PriceRow {
  id: number;
  categoryKey: string;
  subCategory: string | null;
  componentName: string;
  variantLabel: string | null;
  unitOfMeasure: UnitOfMeasure;
  unitPriceAed: number;
  sortOrder: number;
  isActive: boolean;
  proposedPrice: boolean;
  vatMode: VatMode;
}

const VAT_OPTS: { value: VatMode; label: string }[] = [
  { value: 'none', label: 'No VAT' },
  { value: 'exclusive', label: 'Excl.' },
  { value: 'inclusive', label: 'Incl.' },
];

/** Small helper text under a price showing the net/VAT/gross breakdown for its mode. */
function vatHint(mode: VatMode, price: number): string {
  const p = Number(price) || 0;
  if (mode === 'exclusive') return `+5% VAT → ${(p * (1 + VAT_RATE)).toFixed(2)} incl.`;
  if (mode === 'inclusive') return `incl. 5% VAT · ${(p / (1 + VAT_RATE)).toFixed(2)} net`;
  return 'no VAT';
}

const CAT_ORDER = CATALOG.map((c) => c.key);
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATALOG.map((c) => [c.key, c.label]));
const CAT_UNITLABEL: Record<string, string> = Object.fromEntries(CATALOG.map((c) => [c.key, c.unitLabel]));

/** Display label for a category key — a `custom:<name>` section shows its name. */
function catLabel(key: string): string {
  if (key.startsWith('custom:')) return key.slice('custom:'.length) || 'Custom section';
  return CAT_LABEL[key] ?? key;
}
function catUnitLabel(key: string): string {
  return CAT_UNITLABEL[key] ?? 'Per Item';
}

/**
 * The Restoration List editor. Rendered directly for the landlord (no `manager`
 * prop → their own /inspection-price-book) and re-used by the Manager portal
 * with `manager={{ rp }}`, which swaps every call to the landlord-scoped
 * /manager/inspection-price-book?rp= endpoints (gated by canManageInspections).
 */
export function RestorationListWorkspace({ manager }: { manager?: { rp: number } }) {
  const router = useRouter();
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | 'new' | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [addTo, setAddTo] = useState<{ categoryKey: string; subCategory: string | null; label: string } | null>(null);
  const [addingSection, setAddingSection] = useState(false);

  // Landlord uses their own endpoint; a manager targets the acting landlord
  // (?rp=) via the /manager mirror. List + upsert share one URL; reset appends.
  const { listUrl, resetUrl } = useMemo(() => {
    const base = manager ? '/api/manager/inspection-price-book' : '/api/inspection-price-book';
    const rpQ = manager ? `?rp=${manager.rp}` : '';
    return { listUrl: `${base}${rpQ}`, resetUrl: `${base}/reset${rpQ}` };
  }, [manager]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(listUrl, { credentials: 'include' });
      if (!res.ok) { setError('Could not load the price book.'); return; }
      setRows(await res.json());
    } catch { setError('Unexpected error loading the price book.'); }
    finally { setLoading(false); }
  }, [listUrl]);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(listUrl, { credentials: 'include' });
        if (!res.ok) { setError('Could not load the price book.'); return; }
        setRows(await res.json());
      } catch { setError('Unexpected error loading the price book.'); }
      finally { setLoading(false); }
    })();
  }, [listUrl]);

  const save = useCallback(async (row: PriceRow) => {
    setSavingId(row.id);
    try {
      const res = await fetch(listUrl, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id, categoryKey: row.categoryKey, subCategory: row.subCategory,
          componentName: row.componentName, variantLabel: row.variantLabel,
          unitOfMeasure: row.unitOfMeasure, unitPriceAed: row.unitPriceAed,
          isActive: row.isActive, proposedPrice: row.proposedPrice, vatMode: row.vatMode,
        }),
      });
      if (!res.ok) { setError('Save failed — check the price (max 2 decimals).'); return; }
      setSavedId(row.id); setTimeout(() => setSavedId((s) => (s === row.id ? null : s)), 1500);
    } catch { setError('Save failed.'); }
    finally { setSavingId(null); }
  }, [listUrl]);

  const patch = useCallback((id: number, p: Partial<PriceRow>, persist = true) => {
    setRows((rs) => {
      const next = rs.map((r) => (r.id === id ? { ...r, ...p } : r));
      if (persist) { const row = next.find((r) => r.id === id); if (row) void save(row); }
      return next;
    });
  }, [save]);

  // Submit for the Add-item popup. Guards the natural-key unique index client-side
  // so a duplicate name shows a friendly message instead of a 500. Returns an error
  // string on failure, or null on success (then reloads + closes).
  async function addItem(categoryKey: string, subCategory: string | null, componentName: string, unitPriceAed: number): Promise<string | null> {
    const name = componentName.trim();
    const dup = rows.some(
      (r) => r.categoryKey === categoryKey && (r.subCategory ?? null) === (subCategory ?? null)
        && r.componentName.trim().toLowerCase() === name.toLowerCase(),
    );
    if (dup) return `"${name}" already exists in this section.`;
    try {
      const res = await fetch(listUrl, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey, subCategory, componentName: name, unitOfMeasure: 'item', unitPriceAed }),
      });
      if (!res.ok) return 'Could not add the item — please try again.';
      await load();
      return null;
    } catch { return 'Could not add the item — please try again.'; }
  }

  // Submit for the Add-section popup — creates a custom section seeded with its
  // first item. Returns an error string on failure, or null on success.
  async function addSection(sectionName: string, firstItem: string, unitPriceAed: number): Promise<string | null> {
    const categoryKey = `custom:${sectionName.trim()}`;
    if (rows.some((r) => r.categoryKey === categoryKey)) return `A section named "${sectionName.trim()}" already exists.`;
    try {
      const res = await fetch(listUrl, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey, componentName: firstItem.trim(), unitOfMeasure: 'item', unitPriceAed }),
      });
      if (!res.ok) return 'Could not add the section — please try again.';
      await load();
      return null;
    } catch { return 'Could not add the section — please try again.'; }
  }

  async function resetToStandard() {
    if (!confirm('Reset the whole price book to the platform standard? Your custom prices and rows will be replaced.')) return;
    setResetting(true); setError(null);
    try {
      const res = await fetch(resetUrl, { method: 'POST', credentials: 'include' });
      if (!res.ok) { setError('Reset failed.'); return; }
      setRows(await res.json());
    } catch { setError('Reset failed.'); }
    finally { setResetting(false); }
  }

  const grouped = useMemo(() => {
    // Group by the RAW category key so each custom:<name> section stays separate
    // (canonicalising would collapse them all into "Other"). Standard categories
    // sort in catalog order; custom sections follow, alphabetically.
    const byCat = new Map<string, PriceRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.categoryKey)) byCat.set(r.categoryKey, []);
      byCat.get(r.categoryKey)!.push(r);
    }
    const rank = (k: string) => {
      const i = (CAT_ORDER as readonly string[]).indexOf(k);
      return i === -1 ? CAT_ORDER.length : i;
    };
    return [...byCat.keys()]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((k) => ({ key: k, rows: byCat.get(k)! }));
  }, [rows]);

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading price book…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-[#9b9890] hover:text-[#1a1916] mb-2 cursor-pointer">
            <ArrowLeft size={15} /> Back
          </button>
          <h1 className="text-2xl font-bold text-[#1a1916]">Restoration List</h1>
          <p className="text-sm text-[#6b6860] max-w-xl">Reference unit prices used by the move-in / move-out inspection. Seeded from the platform standard — edit any rate to match your properties; the inspection scaffold uses <span className="font-semibold">your</span> prices.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setAddingSection(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#2e9f82] text-white text-sm font-semibold px-3 py-2 disabled:opacity-60">
            <Plus size={15} /> Add section
          </button>
          <button type="button" onClick={resetToStandard} disabled={resetting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#e8e6e0] text-[#6b6860] text-sm font-semibold px-3 py-2 hover:border-[#c8c6be] disabled:opacity-60">
            {resetting ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Reset to standard
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="mb-4 rounded-2xl border border-[#e8e6e0] bg-white px-4 py-3">
        <div className="text-sm font-semibold text-[#1a1916]">VAT per item</div>
        <p className="text-xs text-[#6b6860] max-w-2xl">
          Set how 5% VAT applies to each row: <span className="font-medium text-[#1a1916]">No VAT</span> (flat amount, default) ·
          <span className="font-medium text-[#1a1916]"> Excl.</span> (price is net — 5% added at settlement) ·
          <span className="font-medium text-[#1a1916]"> Incl.</span> (price already includes 5%). Each move-out damage line carries its item’s setting.
        </p>
      </div>

      <div className="space-y-4">
        {grouped.map(({ key, rows: catRows }) => (
          <div key={key} className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-[#fafaf8] border-b border-[#f4f3ef]">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-[#1a1916]">{catLabel(key)}</span>
                <span className="text-[11px] text-[#9b9890]">· {catUnitLabel(key)} · {catRows.length}</span>
              </div>
              <button type="button" onClick={() => setAddTo({ categoryKey: key, subCategory: null, label: catLabel(key) })}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#2e9f82] hover:opacity-75">
                <Plus size={13} /> Add item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#9b9890] border-b border-[#f4f3ef]">
                    <th className="py-2 px-3 font-semibold">Item</th>
                    <th className="py-2 px-3 font-semibold text-right">Unit Price (AED)</th>
                    <th className="py-2 px-3 font-semibold text-center">VAT</th>
                    <th className="py-2 px-3 font-semibold text-center w-24">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {catRows.map((r) => (
                    <tr key={r.id} className={`border-b border-[#f9f8f6] last:border-0 ${r.isActive ? '' : 'opacity-50'}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input value={r.componentName}
                            onChange={(e) => patch(r.id, { componentName: e.target.value }, false)}
                            onBlur={() => { const row = rows.find((x) => x.id === r.id); if (row) void save(row); }}
                            placeholder="Item (write the size here, e.g. Door Leaf 2.1×0.9m)"
                            className="w-full min-w-[14rem] text-[13px] bg-transparent border-b border-transparent hover:border-[#e8e6e0] focus:border-[#2e9f82] focus:outline-none py-0.5" />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          {savingId === r.id ? <Loader2 size={12} className="animate-spin text-[#9b9890]" /> : savedId === r.id ? <Check size={13} className="text-[#2e9f82]" /> : null}
                          <span className="text-[11px] text-[#9b9890]">AED</span>
                          <input type="number" min={0} step={0.01} value={r.unitPriceAed}
                            onChange={(e) => patch(r.id, { unitPriceAed: e.target.value === '' ? 0 : Number(e.target.value) }, false)}
                            onBlur={() => { const row = rows.find((x) => x.id === r.id); if (row) void save(row); }}
                            className="w-24 text-right tabular-nums text-[13px] border border-[#e8e6e0] rounded-md px-2 py-1 focus:outline-none focus:border-[#2e9f82]" />
                        </div>
                        <div className="text-[10px] text-[#9b9890] mt-0.5 tabular-nums">
                          {vatHint(r.vatMode, r.unitPriceAed)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="inline-flex rounded-lg border border-[#e8e6e0] overflow-hidden align-middle">
                          {VAT_OPTS.map((o) => (
                            <button key={o.value} type="button" onClick={() => patch(r.id, { vatMode: o.value })}
                              aria-pressed={r.vatMode === o.value}
                              className={`px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer ${r.vatMode === o.value ? 'bg-[#2e9f82] text-white' : 'bg-white text-[#6b6860] hover:bg-[#f4f3ef]'}`}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button type="button" onClick={() => patch(r.id, { isActive: !r.isActive })}
                          aria-label={r.isActive ? 'Active' : 'Inactive'}
                          className={`relative inline-flex rounded-full transition-colors align-middle ${r.isActive ? 'bg-[#2e9f82]' : 'bg-[#c9c7c1]'}`}
                          style={{ height: 22, width: 40 }}>
                          <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform absolute top-[3px] ${r.isActive ? 'translate-x-[19px]' : 'translate-x-[3px]'}`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {addTo && (
        <AddItemModal
          label={addTo.label}
          onCancel={() => setAddTo(null)}
          onAdd={async (name, price) => {
            const err = await addItem(addTo.categoryKey, addTo.subCategory, name, price);
            if (!err) setAddTo(null);
            return err;
          }}
        />
      )}

      {addingSection && (
        <AddSectionModal
          onCancel={() => setAddingSection(false)}
          onAdd={async (section, firstItem, price) => {
            const err = await addSection(section, firstItem, price);
            if (!err) setAddingSection(false);
            return err;
          }}
        />
      )}
    </div>
  );
}

/** RP route — the landlord editing their own Restoration List. */
export default function RestorationListPage() {
  return <RestorationListWorkspace />;
}

/** Simple popup to add a new custom section (with its first item). */
function AddSectionModal({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (sectionName: string, firstItem: string, unitPriceAed: number) => Promise<string | null>;
}) {
  const [section, setSection] = useState('');
  const [item, setItem] = useState('');
  const [price, setPrice] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const s = section.trim(), it = item.trim();
    if (!s) { setErr('Enter a section name.'); return; }
    if (!it) { setErr('Enter the first item name.'); return; }
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) { setErr('Enter a valid price (0 or more).'); return; }
    if (Math.round(p * 100) !== p * 100) { setErr('Price supports at most 2 decimals.'); return; }
    setBusy(true); setErr(null);
    const e = await onAdd(s, it, p);
    setBusy(false);
    if (e) setErr(e);
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(440px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#2e9f82] text-white px-5 py-3.5">
          <div className="font-bold text-sm">Add section</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">Section name</label>
            <input autoFocus value={section} onChange={(e) => setSection(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              placeholder="e.g. Storeroom, Terrace, Garden"
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#6b6860] mb-1">First item</label>
              <input value={item} onChange={(e) => setItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                placeholder="e.g. Storage Shelf"
                className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#6b6860] mb-1">Price (AED)</label>
              <input type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
            </div>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add section
          </button>
        </div>
      </div>
    </div>
  );
}

/** Simple popup to add one price-book item (name + AED price). */
function AddItemModal({ label, onCancel, onAdd }: {
  label: string;
  onCancel: () => void;
  onAdd: (name: string, unitPriceAed: number) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const n = name.trim();
    if (!n) { setErr('Enter an item name.'); return; }
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) { setErr('Enter a valid price (0 or more).'); return; }
    if (Math.round(p * 100) !== p * 100) { setErr('Price supports at most 2 decimals.'); return; }
    setBusy(true); setErr(null);
    const e = await onAdd(n, p);
    setBusy(false);
    if (e) setErr(e); // success closes via the parent
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm grid place-items-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="w-[min(420px,100%)] bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-[#2e9f82] text-white px-5 py-3.5">
          <div className="font-bold text-sm">Add item · {label}</div>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-white/20" aria-label="Close"><X size={17} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">Item name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              placeholder="e.g. Door Leaf 2.1×0.9m"
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#6b6860] mb-1">Unit price (AED)</label>
            <input type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
              className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#f0ede8]">
          <button type="button" onClick={onCancel} disabled={busy}
            className="text-sm font-semibold px-3 py-2 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f4f3ef] disabled:opacity-60">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add item
          </button>
        </div>
      </div>
    </div>
  );
}
