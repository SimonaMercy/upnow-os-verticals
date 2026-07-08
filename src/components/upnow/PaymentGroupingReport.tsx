'use client';

/**
 * Custom payment-grouping report (RP Reports hub). The RP drags payment-type
 * cards between categories they can rename / add / delete, and the per-category
 * subtotals recompute live for the selected year. Ejari is split into its
 * government (DLD, AED 172.50) and service portions as two independent cards.
 *
 * Session-only — the layout resets on reload (no persistence by design). Print
 * produces the grouped statement.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { GripVertical, X, Pencil, Printer, RotateCcw, Check, Loader2, FolderPlus, ArrowLeft } from 'lucide-react';

const GOVT_EJARI_FEE = 172.5;

interface PaymentRow {
  id: string;
  paymentType: string;
  amount: number;
  description: string | null;
  transactionDate: string | null;
  recordedDate: string | null;
  vatAmount: number | null;
  // for year scoping via the lease term when a payment has no own date
  startDate?: string | null; endDate?: string | null; fromYear?: number | null; toYear?: number | null;
}

// Draggable "items" — payment-type buckets. Ejari is split into two.
const ITEM_LABELS: Record<string, string> = {
  rental_income:   'Rental Income',
  vat:             'VAT (rent + fees)',
  ejari_dld:       'Ejari · DLD registration',
  ejari_service:   'Ejari · service (handling)',
  admin_fee:       'Admin fee',
  commission:      'Commission',
  security_deposit:'Security Deposit',
  maintenance_fee: 'Maintenance',
  service_charge:  'Service Charge',
  refund:          'Refund',
  other:           'Other',
};
// 'other' payments are split into one item PER distinct description (e.g.
// "Fire Fighting", "5% VAT on Rent") so each can be dragged on its own; their
// item key is `other:<description>`.
const OTHER_PREFIX = 'other:';
const itemLabel = (k: string) =>
  k.startsWith(OTHER_PREFIX) ? k.slice(OTHER_PREFIX.length) : (ITEM_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

interface Category { id: string; name: string }
const DEFAULT_CATEGORIES: Category[] = [
  { id: 'rental_income', name: 'Rental Income' },
  { id: 'govt',          name: 'Government Fees' },
  { id: 'management',    name: 'Management Fee' },
  { id: 'deposits',      name: 'Security Deposits' },
  { id: 'others',        name: 'Others' },
];
const DEFAULT_ASSIGN: Record<string, string> = {
  rental_income: 'rental_income',
  vat: 'govt', ejari_dld: 'govt',
  ejari_service: 'management', admin_fee: 'management', commission: 'management',
  security_deposit: 'deposits',
  maintenance_fee: 'others', service_charge: 'others', refund: 'others', other: 'others',
};

const fmtAed = (v: number) => {
  const fractional = Math.round(v) !== v;
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED',
    minimumFractionDigits: fractional ? 2 : 0, maximumFractionDigits: fractional ? 2 : 0,
  }).format(v);
};

const rowYear = (d: PaymentRow): number | null => {
  const s = d.transactionDate ?? d.recordedDate;
  return s ? Number(s.slice(0, 4)) : (d.fromYear ?? null);
};

export function PaymentGroupingReport({ backHref = '/rental-provider/dashboard/reports' }: { backHref?: string }) {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>('all');

  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [assign, setAssign] = useState<Record<string, string>>(DEFAULT_ASSIGN);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dropCat, setDropCat] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  useEffect(() => {
    fetch('/api/contracts/payments', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`Failed to load payments (${r.status})`))))
      .then((d: PaymentRow[]) => { setRows(Array.isArray(d) ? d : []); })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const d of rows) { const y = rowYear(d); if (y) s.add(y); }
    return [...s].sort((a, b) => b - a);
  }, [rows]);
  // Default to the most recent year with data once loaded.
  const didSetYear = useRef(false);
  useEffect(() => {
    if (!didSetYear.current && years.length) { setYear(String(years[0])); didSetYear.current = true; }
  }, [years]);

  // Per-item totals for the selected year (Ejari split into DLD + service).
  const itemTotals = useMemo(() => {
    const t: Record<string, number> = {};
    const add = (k: string, v: number) => { if (v) t[k] = (t[k] ?? 0) + v; };
    for (const d of rows) {
      if (year !== 'all' && rowYear(d) !== Number(year)) continue;
      const amt = Number(d.amount) || 0;
      if (d.paymentType === 'ejari_fee') {
        add('ejari_dld', Math.min(GOVT_EJARI_FEE, amt));
        add('ejari_service', Math.max(0, amt - GOVT_EJARI_FEE));
      } else if (d.paymentType === 'other') {
        // One draggable item per distinct "other" description.
        add(`${OTHER_PREFIX}${(d.description ?? '').trim() || 'Other'}`, amt);
      } else {
        add(d.paymentType, amt);
      }
    }
    return t;
  }, [rows, year]);

  // Items present in the data, each resolved to a category (unknown → 'others'
  // or the first category if 'others' was deleted).
  const items = useMemo(() => Object.keys(itemTotals).sort((a, b) => (itemTotals[b] - itemTotals[a])), [itemTotals]);
  const fallbackCat = () => (categories.find(c => c.id === 'others') ?? categories[0])?.id;
  const catOf = (item: string) => {
    const a = assign[item] ?? DEFAULT_ASSIGN[item] ?? fallbackCat();
    return categories.some(c => c.id === a) ? a : fallbackCat();
  };

  const itemsByCat = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of categories) m[c.id] = [];
    for (const it of items) { const c = catOf(it); if (m[c]) m[c].push(it); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, assign, categories]);

  const catTotal = (catId: string) => (itemsByCat[catId] ?? []).reduce((s, it) => s + (itemTotals[it] ?? 0), 0);
  const grandTotal = items.reduce((s, it) => s + (itemTotals[it] ?? 0), 0);

  // ── Drag & drop (native) ──
  const onDrop = (catId: string) => {
    if (dragItem) setAssign(a => ({ ...a, [dragItem]: catId }));
    setDragItem(null); setDropCat(null);
  };

  // ── Category management ──
  const addCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    setCategories(cs => [...cs, { id: `cat_${Date.now()}`, name }]);
    setNewCatName(''); setNewCatOpen(false);
  };
  const renameCategory = (id: string) => {
    const name = renameVal.trim();
    if (name) setCategories(cs => cs.map(c => (c.id === id ? { ...c, name } : c)));
    setRenaming(null);
  };
  const deleteCategory = (id: string) => {
    if (categories.length <= 1) return;
    const dest = categories.find(c => c.id !== id)!.id;
    // Reassign this category's items to the first remaining one.
    setAssign(a => {
      const next = { ...a };
      for (const it of items) if (catOf(it) === id) next[it] = dest;
      return next;
    });
    setCategories(cs => cs.filter(c => c.id !== id));
  };
  const reset = () => { setCategories(DEFAULT_CATEGORIES); setAssign(DEFAULT_ASSIGN); };

  const header = (
    <div className="mb-5">
      <Link href={backHref} className="text-sm text-[#2e9f82] font-medium flex items-center gap-1 mb-3 print:hidden"><ArrowLeft size={14} /> All Reports</Link>
      <h1 className="text-2xl font-bold text-[#1a1916]">Payment Grouping</h1>
      <p className="text-sm text-[#6b6860] mt-1">Build your own statement — drag payment types between categories you rename, add or remove. Ejari splits into its DLD government portion and service handling. Totals recompute for the selected year. Session-only; use Print to export.</p>
    </div>
  );

  if (loading) return <div className="p-6">{header}<div className="text-sm text-[#9b9890] flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Loading payments…</div></div>;
  if (error) return <div className="p-6">{header}<div className="text-sm text-[#b91c1c]">{error}</div></div>;

  return (
    <div className="p-6 pb-10">
      {header}
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5 print:hidden">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6860]">Year</span>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#2e9f82]">
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[#9b9890]">Drag a card between categories to regroup.</span>
          <button type="button" onClick={reset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] cursor-pointer">
            <RotateCcw size={13} /> Reset
          </button>
          <button type="button" onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] cursor-pointer">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {/* Grand total banner */}
      <div className="mb-5 rounded-2xl bg-white border border-[#eeece6] px-5 py-4 flex items-baseline justify-between shadow-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Total {year === 'all' ? '(all years)' : year}</p>
          <p className="text-2xl font-bold text-[#1a1916] mt-0.5">{fmtAed(grandTotal)}</p>
        </div>
        <p className="text-xs text-[#9b9890]">{items.length} payment type{items.length !== 1 ? 's' : ''} across {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}</p>
      </div>

      {/* Category grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {categories.map(cat => {
          const its = itemsByCat[cat.id] ?? [];
          const active = dropCat === cat.id;
          return (
            <div key={cat.id}
              onDragOver={e => { e.preventDefault(); setDropCat(cat.id); }}
              onDragLeave={() => setDropCat(c => (c === cat.id ? null : c))}
              onDrop={() => onDrop(cat.id)}
              className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-colors ${active ? 'border-[#2e9f82] ring-2 ring-[#2e9f82]/30' : 'border-[#eeece6]'}`}>
              {/* Category header */}
              <div className="px-4 py-3 border-b border-[#f1efe9] bg-[#fafaf8] flex items-center gap-2">
                {renaming === cat.id ? (
                  <>
                    <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') renameCategory(cat.id); if (e.key === 'Escape') setRenaming(null); }}
                      className="flex-1 text-sm font-bold border border-[#e8e6e0] rounded-md px-2 py-1 focus:outline-none focus:border-[#2e9f82]" />
                    <button type="button" onClick={() => renameCategory(cat.id)} className="text-[#2e9f82] cursor-pointer"><Check size={15} /></button>
                    <button type="button" onClick={() => setRenaming(null)} className="text-[#9b9890] cursor-pointer"><X size={15} /></button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-bold text-[#1a1916] flex-1 truncate">{cat.name}</span>
                    <span className="text-sm font-bold text-[#1a7a5a] tabular-nums">{fmtAed(catTotal(cat.id))}</span>
                    <button type="button" title="Rename" onClick={() => { setRenaming(cat.id); setRenameVal(cat.name); }}
                      className="text-[#c5c3bc] hover:text-[#2e9f82] cursor-pointer print:hidden"><Pencil size={13} /></button>
                    {categories.length > 1 && (
                      <button type="button" title="Delete category" onClick={() => deleteCategory(cat.id)}
                        className="text-[#c5c3bc] hover:text-[#b91c1c] cursor-pointer print:hidden"><X size={14} /></button>
                    )}
                  </>
                )}
              </div>
              {/* Items */}
              <div className="p-3 space-y-2 min-h-[72px]">
                {its.length === 0 ? (
                  <p className="text-xs text-[#b8b5ad] text-center py-4">Drop payment types here</p>
                ) : its.map(it => (
                  <div key={it} draggable
                    onDragStart={() => setDragItem(it)}
                    onDragEnd={() => { setDragItem(null); setDropCat(null); }}
                    className={`flex items-center gap-2 rounded-xl border border-[#eeece6] bg-[#fcfbf8] px-3 py-2 cursor-grab active:cursor-grabbing ${dragItem === it ? 'opacity-40' : ''}`}>
                    <GripVertical size={14} className="text-[#c5c3bc] shrink-0 print:hidden" />
                    <span className="text-[13px] font-medium text-[#1a1916] flex-1 truncate">{itemLabel(it)}</span>
                    <span className="text-[13px] font-semibold text-[#3d3b35] tabular-nums">{fmtAed(itemTotals[it] ?? 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Add category */}
        <div className="rounded-2xl border-2 border-dashed border-[#e3e0d9] flex items-center justify-center min-h-[120px] print:hidden">
          {newCatOpen ? (
            <div className="p-4 w-full">
              <input autoFocus value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setNewCatOpen(false); }}
                placeholder="Category name" className="w-full text-sm border border-[#e8e6e0] rounded-lg px-3 py-2 focus:outline-none focus:border-[#2e9f82]" />
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={addCategory} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white cursor-pointer">Add</button>
                <button type="button" onClick={() => { setNewCatOpen(false); setNewCatName(''); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-[#6b6860] cursor-pointer">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setNewCatOpen(true)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#6b6860] hover:text-[#2e9f82] cursor-pointer">
              <FolderPlus size={16} /> Add category
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
