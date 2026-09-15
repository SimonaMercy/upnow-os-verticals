'use client';

/**
 * Custom payment-grouping report (RP Reports hub). The RP drags payment-type
 * cards between categories they can rename / add / delete, and the per-category
 * subtotals recompute live for the selected year. Defaults mirror the contract
 * page's four groups — Rental Income, Security Deposit, Management Fee (admin,
 * commission + Rules penalties) and Third Party (Contract Registration, VAT,
 * sub-lease / service pass-throughs). Contract Registration is one card (not
 * split); VAT separates into "5% VAT on Rent" and Fees VAT, BOTH of which sit
 * under Third Party — VAT is money the RP collects and owes on, not rent.
 *
 * Session-only — the layout resets on reload (no persistence by design). Print
 * produces the grouped statement.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { GripVertical, X, Pencil, Printer, RotateCcw, Check, Loader2, FolderPlus, ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { DateRangePicker } from '@/components/upnow/DateRangePicker';
import { BasisNote } from '@/components/upnow/reportCatalog';

// A `vat` payment is "Fees VAT" (the combined VAT cheque on admin/commission
// fees) when its description says so. Every other `vat` cheque is rent VAT.
// Both are pass-throughs and both sit under Third Party — the rent-VAT cheque
// is the SAME charge that other contracts record as a free-text 'other' row
// labelled "5% VAT on Rent", and the two must not land in different categories
// purely because of how they were entered.
const isFeesVat = (p: { paymentType?: string | null; description?: string | null }) =>
  (p.paymentType ?? '') === 'vat' && /fees\s*vat/i.test(p.description ?? '');

interface PaymentRow {
  id: string;
  paymentType: string;
  amount: number;
  description: string | null;
  building?: string | null;
  depositRef?: string | null;
  contractRef?: string | null;
  unit?: string | null;
  tenant?: string | null;
  status?: string | null;
  transactionDate: string | null;
  recordedDate: string | null;
  vatAmount: number | null;
  // Server-derived, from `shared/payment-basis.ts` — the same rule Cash
  // Management and Fee & VAT apply. A statement must not total a cheque that was
  // voided, nor a bounce whose replacement is already in the list.
  countsTowardTotals?: boolean;
  excludedReason?: 'cancelled' | 'swapped' | 'bounce-replaced' | null;
  // Rent VAT the contract holds as a RATE with no row of its own, apportioned to
  // this cheque (fils). Reconstructed server-side by `shared/rent-vat-basis.ts`,
  // so this report and Fee & VAT declare the same output VAT.
  impliedRentVatFils?: number | null;
  // for year scoping via the lease term when a payment has no own date
  startDate?: string | null; endDate?: string | null; fromYear?: number | null; toYear?: number | null;
}

// Draggable "items" — one per payment type. Labels mirror the contract page's
// fee labels. Contract Registration (Ejari) is a SINGLE item (no DLD/service
// split); Rental VAT and Fees VAT are separate items, as on the contract page.
const ITEM_LABELS: Record<string, string> = {
  rental_income:   'Rental Income',
  security_deposit:'Security Deposit (held)',
  // Management Fee — RP-charged fees + every Settings → Rules penalty / charge.
  admin_fee:       'Admin fee',
  commission:      'Commission',
  bounced_cheque_fee:       'Bounced cheque',
  cheque_replacement_fee:   'Cheque hold / replacement',
  cheque_deferral_fee:      'Cheque deferral',
  late_renewal_fee:         'Late renewal',
  early_termination_fee:    'Early termination',
  late_moveout_fee:         'Late move-out',
  unauthorized_sharing_fee: 'Sharing without notice / NOC',
  access_card_fee:          'Access card / remote replacement',
  contract_name_change_fee: 'Contract name change',
  unit_transfer_fee:        'Unit transfer',
  legal_fee:                'Legal cost',
  // Third Party — pass-through fees the RP collects on behalf of others. Rent
  // VAT is one of them: the RP collects it, it is a tax liability rather than
  // rent, and the SAME charge is recorded on other contracts as a free-text
  // 'other' row labelled "5% VAT on Rent" — so both spellings of it must read
  // and group identically, whichever mechanism captured it.
  vat_rental:      '5% VAT on Rent',
  ejari_fee:       'Contract Registration fee',
  vat_fees:        'Fees VAT',
  maintenance_fee: 'Maintenance',
  service_charge:  'Service Charge',
  refund:          'Refund',
  other:           'Other',
};
// 'other' payments are split into one item PER distinct description (e.g.
// "Service Charge") so each can be dragged on its own; their item key is
// `other:<description>`.
const OTHER_PREFIX = 'other:';

// Rent VAT is recorded two ways: as its own `vat` cheque, and — on contracts
// that never used one — as a free-text 'other' row carrying this label. Same
// charge, so both fold into the SINGLE `vat_rental` item rather than rendering
// as two identically-named cards the RP would have to drag around in pairs.
const RENT_VAT_LABEL = '5% VAT on Rent';
const isRentVatCharge = (d: { paymentType: string; description?: string | null }) =>
  d.paymentType === 'other'
  && (d.description ?? '').trim().toLowerCase() === RENT_VAT_LABEL.toLowerCase();
const itemLabel = (k: string) =>
  k.startsWith(OTHER_PREFIX) ? k.slice(OTHER_PREFIX.length) : (ITEM_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

// The single draggable item a payment row belongs to. VAT splits into rent VAT
// vs Fees VAT (like the contract page); every distinct 'other' description is
// its own item, EXCEPT a free-text rent-VAT row, which joins the `vat` cheques
// in the one rent-VAT item. Ejari is one item — NOT split into DLD + service.
const itemKeyOf = (d: { paymentType: string; description?: string | null }): string => {
  if (d.paymentType === 'vat') return isFeesVat(d) ? 'vat_fees' : 'vat_rental';
  if (isRentVatCharge(d)) return 'vat_rental';
  if (d.paymentType === 'other') return `${OTHER_PREFIX}${(d.description ?? '').trim() || 'Other'}`;
  return d.paymentType;
};

interface Category { id: string; name: string }
// Category set + order mirror the contract page's payment grouping, so the
// report reconciles one-to-one with what each contract shows.
const DEFAULT_CATEGORIES: Category[] = [
  { id: 'rental_income', name: 'Rental Income' },
  { id: 'deposits',      name: 'Security Deposit' },
  { id: 'management',    name: 'Management Fee' },
  { id: 'third_party',   name: 'Third Party' },
  // Catch-all: any payment type not mapped to the four groups above surfaces
  // here (nothing is ever silently dropped). The RP can drag it where it belongs.
  { id: 'other',         name: 'Other' },
];
const DEFAULT_ASSIGN: Record<string, string> = {
  rental_income: 'rental_income',
  security_deposit: 'deposits',
  admin_fee: 'management', commission: 'management',
  bounced_cheque_fee: 'management', cheque_replacement_fee: 'management', cheque_deferral_fee: 'management',
  late_renewal_fee: 'management', early_termination_fee: 'management', late_moveout_fee: 'management',
  unauthorized_sharing_fee: 'management', access_card_fee: 'management',
  contract_name_change_fee: 'management', unit_transfer_fee: 'management', legal_fee: 'management',
  vat_rental: 'third_party', ejari_fee: 'third_party', vat_fees: 'third_party',
  maintenance_fee: 'third_party', service_charge: 'third_party', refund: 'third_party',
  // Custom 'other' charges are keyed per description (`other:<label>`) so they
  // can't be listed here — they default to Third Party in defaultCatOf below.
  // Any unrecognised payment type still falls through to the 'Other' catch-all.
};
const OWNERSHIP_LABEL: Record<string, string> = { direct: 'Own Property', sub: 'Sub-lease', management: 'Property Management' };

const fmtAed = (v: number) => {
  const fractional = Math.round(v) !== v;
  return new Intl.NumberFormat('en-AE', {
    style: 'currency', currency: 'AED',
    minimumFractionDigits: fractional ? 2 : 0, maximumFractionDigits: fractional ? 2 : 0,
  }).format(v);
};

// ─── Period attribution ──────────────────────────────────────────────────────
// A payment sits in ONE period: the one its own cheque date falls in. That date
// is the tax point for a VAT return and it is the same basis Cash Management
// uses (reports.service.ts filters rent on `p.transaction_date`), so the two
// pages reconcile.
//
// This DELIBERATELY replaces the old lease-TERM-overlap rule. Under that rule a
// row belonged to every year/quarter its lease touched, so a Jan→Dec lease put
// its full year of cheques — and its full year of VAT — into all four quarters
// at face value. On the live data that reported 2.9x the real 2026 rent VAT and
// made each year's rental income exceed the entire multi-year ledger. The
// The Security Deposits register carried the same defect on its collection
// basis. It could not be fixed the same way — the ledger records no date for
// when a deposit was taken — so that report dropped its period filter entirely
// rather than keep a control that silently mis-files rows.
/** The single date a row is attributed to. The cheque date where there is one;
 *  otherwise the recorded date, then the lease start, then the deposit's from
 *  year — each a single point, so a row can never land in two periods. */
const effectiveDate = (d: PaymentRow): string | null => {
  const raw = d.transactionDate ?? d.recordedDate ?? d.startDate
    ?? (d.fromYear != null ? `${d.fromYear}-01-01` : null);
  return raw ? raw.slice(0, 10) : null;
};
/** True when the row carries no date of its own and `effectiveDate` had to fall
 *  back to the lease. Surfaced in the UI so an inferred period is never quietly
 *  filed as fact — on the live data these are rent rows missing a due date. */
const isPeriodInferred = (d: PaymentRow): boolean => !d.transactionDate && !d.recordedDate;

/** Does this row belong in a subtotal? A cancelled cheque was voided and was
 *  never a supply; a bounce already made good is represented by the replacement
 *  cheque sitting in this same list, so counting both states the money twice.
 *  Older API responses carry no flag — default to counting, never to hiding. */
const counts = (d: PaymentRow): boolean => d.countsTowardTotals !== false;

const yearMatch = (d: PaymentRow, y: number): boolean => {
  const s = effectiveDate(d);
  return s ? Number(s.slice(0, 4)) === y : false;
};
const yearsOf = (d: PaymentRow): number[] => {
  const s = effectiveDate(d);
  return s ? [Number(s.slice(0, 4))] : [];
};
/** A row is in the [from, to] window (either bound optional, 'YYYY-MM-DD') when
 *  its effective date falls inside it. Bounds are inclusive. */
const dateInRange = (d: PaymentRow, from: string, to: string): boolean => {
  const s = effectiveDate(d);
  if (!s) return false;
  if (from && s < from) return false;
  if (to && s > to) return false;
  return true;
};

export function PaymentGroupingReport({ backHref = '/rental-provider/dashboard/reports' }: { backHref?: string }) {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>('all');
  // Custom date window (either bound optional). When set it takes precedence over
  // the Year dropdown — so Year and the From/To range never fight each other.
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const dateActive = from !== '' || to !== '';
  // Ownership segregation (properties.leasing_type): all / direct (Owned) /
  // sub (Sub-lease) / management (Managed). Resolved per row via its building.
  const [ownership, setOwnership] = useState<'all' | 'direct' | 'sub' | 'management'>('all');
  const [buildingLeasing, setBuildingLeasing] = useState<Record<string, string>>({});
  // Specific-property filter (by building name) — independent of the lease-type filter.
  const [building, setBuilding] = useState<string>('all');

  // Card → transactions popup: which payment-type item is open (null = none).
  const [detail, setDetail] = useState<string | null>(null);

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
    // Building → leasing model, so payments can be segregated by ownership.
    fetch('/api/properties', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then((ps: Array<{ buildingName?: string | null; leasingType?: string | null }>) => {
        const m: Record<string, string> = {};
        for (const p of ps ?? []) if (p.buildingName) m[p.buildingName] = p.leasingType ?? 'direct';
        setBuildingLeasing(m);
      })
      .catch(() => { /* ownership filter simply stays inert */ });
  }, []);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const d of rows) for (const y of yearsOf(d)) if (Number.isFinite(y) && y > 0) s.add(y);
    return [...s].sort((a, b) => b - a);
  }, [rows]);
  // Default the year scope to the current year (or the most recent year with
  // data if the current one is empty), so the report opens on a bounded period.
  const didSetYear = useRef(false);
  useEffect(() => {
    if (!didSetYear.current && years.length) {
      const cur = new Date().getFullYear();
      setYear(String(years.includes(cur) ? cur : years[0]));
      didSetYear.current = true;
    }
  }, [years]);

  // Building list for the property picker — narrowed to the selected lease type
  // so you never pick a property that the lease-type filter would hide.
  const buildings = useMemo(() => {
    const s = new Set<string>();
    for (const d of rows) {
      const b = (d.building ?? '').trim();
      if (!b || b === '—') continue;
      if (ownership !== 'all' && (buildingLeasing[b] ?? 'direct') !== ownership) continue;
      s.add(b);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [rows, ownership, buildingLeasing]);
  // If the chosen property is no longer in scope (lease type changed), drop it.
  useEffect(() => {
    if (building !== 'all' && !buildings.includes(building)) setBuilding('all');
  }, [buildings, building]);

  // Per-item totals for the selected year (one bucket per payment type).
  const itemTotals = useMemo(() => {
    const t: Record<string, number> = {};
    const add = (k: string, v: number) => { if (v) t[k] = (t[k] ?? 0) + v; };
    for (const d of rows) {
      // Lease-type segregation — keep only the selected leasing model.
      if (ownership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== ownership) continue;
      // Specific-property filter.
      if (building !== 'all' && (d.building ?? '').trim() !== building) continue;
      // Date window takes precedence over the Year dropdown when set.
      if (dateActive) { if (!dateInRange(d, from, to)) continue; }
      else if (year !== 'all' && !yearMatch(d, Number(year))) continue;
      if (!counts(d)) continue;                    // voided / already replaced
      add(itemKeyOf(d), Number(d.amount) || 0);
      // Rent VAT this contract holds as a rate rather than a row. Without it the
      // "5% VAT on Rent" line is short by exactly the legacy contracts, and this
      // report and Fee & VAT declare different output VAT for the same quarter.
      if (d.paymentType === 'rental_income') add('vat_rental', (Number(d.impliedRentVatFils) || 0) / 100);
    }
    return t;
  }, [rows, year, from, to, dateActive, ownership, building, buildingLeasing]);

  // What the status rule kept OUT of the figures above, measured through the same
  // filters. Reported rather than dropped: a total that quietly shrank is a total
  // nobody can reconcile against last quarter's filing.
  const excludedRows = useMemo(() => {
    const out: PaymentRow[] = [];
    for (const d of rows) {
      if (counts(d)) continue;
      if (ownership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== ownership) continue;
      if (building !== 'all' && (d.building ?? '').trim() !== building) continue;
      if (dateActive) { if (!dateInRange(d, from, to)) continue; }
      else if (year !== 'all' && !yearMatch(d, Number(year))) continue;
      if (!(Number(d.amount) || 0)) continue;
      out.push(d);
    }
    return out;
  }, [rows, year, from, to, dateActive, ownership, building, buildingLeasing]);
  const excludedTotal = excludedRows.reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // Rows inside the current period that had NO date of their own and were placed
  // by the lease-start fallback. Reported to the RP rather than silently mixed
  // in: on a filing period an inferred date is a figure someone has to verify.
  const inferredRows = useMemo(() => {
    const out: PaymentRow[] = [];
    for (const d of rows) {
      if (!isPeriodInferred(d)) continue;
      if (!counts(d)) continue;                    // already reported as excluded
      if (ownership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== ownership) continue;
      if (building !== 'all' && (d.building ?? '').trim() !== building) continue;
      if (dateActive) { if (!dateInRange(d, from, to)) continue; }
      else if (year !== 'all' && !yearMatch(d, Number(year))) continue;
      if (!(Number(d.amount) || 0)) continue;  // zero-value placeholders aren't worth flagging
      out.push(d);
    }
    return out;
  }, [rows, year, from, to, dateActive, ownership, building, buildingLeasing]);

  // Items present in the data, each resolved to a category. Unmapped / unknown
  // types fall to the 'Other' catch-all (or the last category if it was deleted).
  const items = useMemo(() => Object.keys(itemTotals).sort((a, b) => (itemTotals[b] - itemTotals[a])), [itemTotals]);
  const fallbackCat = () => (categories.find(c => c.id === 'other') ?? categories[categories.length - 1] ?? categories[0])?.id;
  // Every `other:<description>` item defaults to Third Party — those charges are
  // pass-throughs the RP collects for someone else (a sub-leased building's levy
  // and the tax on it, service charges), which is where the contract page, the
  // receipts, the payment plan and both Payments ledgers file them. Still
  // draggable: an RP who disagrees moves it and the choice sticks in `assign`.
  const defaultCatOf = (item: string) =>
    DEFAULT_ASSIGN[item] ?? (item.startsWith(OTHER_PREFIX) ? 'third_party' : undefined);
  const catOf = (item: string) => {
    const a = assign[item] ?? defaultCatOf(item) ?? fallbackCat();
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

  // The individual transactions behind one payment-type card — same filters and
  // per-type matching (VAT rental/fees, per-description 'other') as the totals.
  const detailRows = useMemo(() => {
    if (!detail) return [];
    const out: Array<{ row: PaymentRow; amount: number; note?: string }> = [];
    for (const d of rows) {
      if (ownership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== ownership) continue;
      if (building !== 'all' && (d.building ?? '').trim() !== building) continue;
      if (dateActive) { if (!dateInRange(d, from, to)) continue; }
      else if (year !== 'all' && !yearMatch(d, Number(year))) continue;
      if (!counts(d)) continue;
      const amt = Number(d.amount) || 0;
      if (amt && itemKeyOf(d) === detail) out.push({ row: d, amount: amt });
      // Rent VAT reconstructed from the contract rate has no row of its own. It
      // is real money in the total above, so it must be auditable here too —
      // listed against the rent cheque it was apportioned to, and labelled as
      // reconstructed so nobody hunts for a cheque that does not exist.
      if (detail === 'vat_rental' && d.paymentType === 'rental_income') {
        const implied = (Number(d.impliedRentVatFils) || 0) / 100;
        if (implied) out.push({ row: d, amount: implied, note: 'on rent (no VAT cheque)' });
      }
    }
    return out.sort((a, b) => b.amount - a.amount);
  }, [detail, rows, year, from, to, dateActive, ownership, building, buildingLeasing]);

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

  // ── Detailed Excel export (one sheet per category + a Summary sheet) ──
  const [exporting, setExporting] = useState(false);
  // Flatten rows into category-tagged transaction lines — same year/ownership
  // filter and per-type bucketing (VAT rental/fees, per-description 'other') as
  // the on-screen view.
  const exportEntries = () => {
    const out: Array<{ cat: string; item: string; row: PaymentRow; amount: number; desc: string }> = [];
    for (const d of rows) {
      if (ownership !== 'all' && (buildingLeasing[d.building ?? ''] ?? 'direct') !== ownership) continue;
      if (building !== 'all' && (d.building ?? '').trim() !== building) continue;
      if (dateActive) { if (!dateInRange(d, from, to)) continue; }
      else if (year !== 'all' && !yearMatch(d, Number(year))) continue;
      if (!counts(d)) continue;                    // same rule as the on-screen totals
      const amt = Number(d.amount) || 0;
      const itemKey = itemKeyOf(d);
      if (amt) {
        const desc = d.paymentType === 'other'
          ? ((d.description ?? '').trim() || 'Other')
          : (d.description ?? itemLabel(itemKey));
        out.push({ cat: catOf(itemKey), item: itemLabel(itemKey), row: d, amount: amt, desc });
      }
      // The exported sheet has to add up to the screen, so reconstructed rent VAT
      // is a line here too — see `detailRows`.
      if (d.paymentType === 'rental_income') {
        const implied = (Number(d.impliedRentVatFils) || 0) / 100;
        if (implied) {
          out.push({
            cat: catOf('vat_rental'), item: itemLabel('vat_rental'), row: d,
            amount: implied, desc: '5% VAT on Rent (on rent, no VAT cheque)',
          });
        }
      }
    }
    return out;
  };
  const exportExcel = async () => {
    setExporting(true);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const entries = exportEntries();
      const money = '#,##0.00';
      const own = ownership === 'all' ? 'All lease types' : OWNERSHIP_LABEL[ownership];
      const prop = building === 'all' ? 'All properties' : building;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'UpNow';

      const sum = wb.addWorksheet('Summary');
      const t = sum.addRow(['Payment Grouping']); t.font = { bold: true, size: 14 };
      sum.addRow([`Period: ${periodLabel}`, `Lease type: ${own}`, `Property: ${prop}`]);
      sum.addRow([]);
      const sh = sum.addRow(['Category', 'Total (AED)']); sh.font = { bold: true };
      for (const c of categories) { const r = sum.addRow([c.name, catTotal(c.id)]); r.getCell(2).numFmt = money; }
      const tr = sum.addRow(['TOTAL', grandTotal]); tr.font = { bold: true }; tr.getCell(2).numFmt = money;
      sum.getColumn(1).width = 30; sum.getColumn(2).width = 18;

      const used = new Set<string>();
      const sheetName = (name: string) => {
        const base = (name.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Category').slice(0, 28);
        let n = base, i = 2; while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} ${i++}`;
        used.add(n.toLowerCase()); return n;
      };
      const HEAD = ['Item', 'Description', 'Amount (AED)', 'Ref', 'Contract', 'Building', 'Unit', 'Customer', 'Date', 'Status'];
      const WIDTHS = [26, 26, 15, 16, 12, 22, 10, 26, 12, 12];
      for (const c of categories) {
        const es = entries.filter(e => e.cat === c.id);
        if (!es.length) continue;
        const ws = wb.addWorksheet(sheetName(c.name));
        const hr = ws.addRow(HEAD); hr.font = { bold: true };
        for (const e of es) {
          const d = e.row;
          const r = ws.addRow([e.item, e.desc, e.amount, d.depositRef ?? '', d.contractRef ?? '', d.building ?? '', d.unit ?? '', d.tenant ?? '', d.transactionDate ?? d.recordedDate ?? '', d.status ?? '']);
          r.getCell(3).numFmt = money;
        }
        const tot = ws.addRow(['', 'Total', es.reduce((s, e) => s + e.amount, 0)]);
        tot.font = { bold: true }; tot.getCell(3).numFmt = money;
        WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `payment-grouping-${periodSlug}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setExporting(false);
    }
  };

  // Human + filename-safe label for the active period (date window or year).
  const periodLabel = dateActive
    ? `${from || 'start'} → ${to || 'today'}`
    : (year === 'all' ? 'All years' : year);
  const periodSlug = dateActive
    ? `${from || 'start'}_to_${to || 'today'}`
    : (year === 'all' ? 'all-years' : year);

  const header = (
    <div className="mb-5">
      <Link href={backHref} className="text-sm text-[#2e9f82] font-medium flex items-center gap-1 mb-3 print:hidden"><ArrowLeft size={14} /> All Reports</Link>
      <h1 className="text-2xl font-bold text-[#1a1916]">Payment Grouping</h1>
      <p className="text-sm text-[#6b6860] mt-1">Build your own statement — drag payment types between categories you rename, add or remove. Grouped like the contract page: Rental Income, Security Deposit, Management Fee and Third Party. Every payment counts once, in the period its cheque falls due — the same basis as Cash Management — so a quarter can be used as a filing period. Session-only; use Print to export.</p>
      <BasisNote slug="payment-grouping" className="mt-1.5 max-w-3xl" />
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
          {/* Choosing a year clears any custom date window (they're exclusive). */}
          <select value={dateActive ? 'all' : year} onChange={e => { setYear(e.target.value); setFrom(''); setTo(''); }}
            className="text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#2e9f82]">
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6860]">Date</span>
          {/* Setting a range overrides the Year filter. */}
          <DateRangePicker from={from} to={to}
            onChange={(f, t) => { setFrom(f); setTo(t); if (f || t) setYear('all'); }} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6860]">Lease Type</span>
          <select value={ownership} onChange={e => setOwnership(e.target.value as typeof ownership)}
            className="text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#2e9f82]">
            <option value="all">All lease types</option>
            <option value="direct">Own Property</option>
            <option value="sub">Sub-lease</option>
            <option value="management">Property Management</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6860]">Property</span>
          <select value={building} onChange={e => setBuilding(e.target.value)}
            className="text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-[#2e9f82] max-w-[220px]">
            <option value="all">All properties</option>
            {buildings.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[#9b9890]">Drag a card between categories to regroup.</span>
          <button type="button" onClick={reset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] cursor-pointer">
            <RotateCcw size={13} /> Reset
          </button>
          <button type="button" onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] cursor-pointer">
            <Printer size={13} /> Print
          </button>
          <button type="button" onClick={exportExcel} disabled={exporting}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-60 cursor-pointer">
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} Excel (detailed)
          </button>
        </div>
      </div>

      {/* Inferred-period warning. These rows have no cheque date, so their period
          is the lease start rather than a real tax point — say so on the page and
          on the print-out, because the figure below is only as good as they are. */}
      {inferredRows.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#e5c07b] bg-[#fdf8ec] px-4 py-3">
          <p className="text-sm font-semibold text-[#8a6d1f]">
            {inferredRows.length} payment{inferredRows.length !== 1 ? 's' : ''} in this period ({fmtAed(inferredRows.reduce((s, d) => s + (Number(d.amount) || 0), 0))}) {inferredRows.length !== 1 ? 'have' : 'has'} no cheque date
          </p>
          <p className="text-xs text-[#8a6d1f] mt-1">
            They have been placed by their lease start date. Add the real due date on the contract before using this period for a filing.
          </p>
          <ul className="mt-2 text-xs text-[#8a6d1f] space-y-0.5">
            {inferredRows.map(d => (
              <li key={d.id}>
                {d.contractRef ?? '—'} · {d.building ?? '—'} {d.unit ?? ''} · {itemLabel(itemKeyOf(d))} · {fmtAed(Number(d.amount) || 0)}
                {d.description ? ` · ${d.description}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Money the status rule kept OUT of every figure below. Stated on the page
          and on the print-out: this report used to total these rows, so anyone
          comparing against an earlier statement needs to see what moved. */}
      {excludedRows.length > 0 && (
        <div className="mb-4 rounded-xl border border-[#e8e6e0] bg-[#f7f6f3] px-4 py-3">
          <p className="text-sm font-semibold text-[#6b6860]">
            {excludedRows.length} payment{excludedRows.length !== 1 ? 's' : ''} in this period ({fmtAed(excludedTotal)}) {excludedRows.length !== 1 ? 'are' : 'is'} not counted below
          </p>
          <p className="text-xs text-[#6b6860] mt-1">
            A cancelled cheque was voided and never collected. A bounced cheque
            that was made good, and a cheque the customer swapped, are already
            represented by their replacement, which IS counted — including both
            would state the same money twice.
          </p>
          <ul className="mt-2 text-xs text-[#6b6860] space-y-0.5">
            {excludedRows.map(d => (
              <li key={d.id}>
                {d.contractRef ?? '—'} · {d.building ?? '—'} {d.unit ?? ''} · {itemLabel(itemKeyOf(d))} · {fmtAed(Number(d.amount) || 0)}
                {' · '}{d.excludedReason === 'cancelled' ? 'cancelled'
                  : d.excludedReason === 'swapped' ? 'swapped by the customer, replaced'
                  : 'bounced, replaced'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Grand total banner */}
      <div className="mb-5 rounded-2xl bg-white border border-[#eeece6] px-5 py-4 flex items-baseline justify-between shadow-sm">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#9b9890] font-semibold">Total · {periodLabel}</p>
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
                    onClick={() => setDetail(it)}
                    title="See the transactions behind this total"
                    className={`flex items-center gap-2 rounded-xl border border-[#eeece6] bg-[#fcfbf8] px-3 py-2 cursor-pointer hover:border-[#2e9f82]/50 hover:bg-[#f7fdfb] ${dragItem === it ? 'opacity-40' : ''}`}>
                    <GripVertical size={14} className="text-[#c5c3bc] shrink-0 cursor-grab active:cursor-grabbing print:hidden" onClick={e => e.stopPropagation()} />
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

      {/* ── card drill-down: the transactions behind one payment-type total ── */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 sm:p-8 print:hidden" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-[#f0ede8] px-5 py-3.5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#1a1916]">{itemLabel(detail)} <span className="text-[#9b9890] font-medium">· {periodLabel}</span></h3>
                <p className="text-xs text-[#6b6860] mt-0.5">
                  {detailRows.length} transaction{detailRows.length === 1 ? '' : 's'} · {fmtAed(detailRows.reduce((s, e) => s + e.amount, 0))}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="w-7 h-7 rounded-lg grid place-items-center text-[#9b9890] hover:bg-[#f4f3ef] hover:text-[#1a1916]">
                <X size={15} />
              </button>
            </div>
            {detailRows.length === 0 ? (
              <p className="px-5 py-10 text-sm text-[#9b9890] text-center">No transactions in this period.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-[#fafaf8] text-[10px] uppercase tracking-wide text-[#9b9890] sticky top-[57px]">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Contract</th>
                    <th className="px-3 py-2 text-left font-semibold">Unit</th>
                    <th className="px-3 py-2 text-left font-semibold">Customer</th>
                    <th className="px-3 py-2 text-left font-semibold">Property</th>
                    <th className="px-3 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-4 py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map(({ row: d, amount, note }, idx) => {
                    const cid = d.contractRef ? /CID-(\d+)/.exec(d.contractRef)?.[1] : null;
                    return (
                      <tr key={idx} className="border-t border-[#f0ede8] hover:bg-[#fafaf8]">
                        <td className="px-4 py-2 text-left">
                          {cid ? (
                            <Link href={`/rental-provider/dashboard/contracts/${cid}/v2`} className="font-medium text-[#2e9f82] hover:underline">
                              {d.contractRef}
                            </Link>
                          ) : (d.contractRef ?? d.depositRef ?? '—')}
                        </td>
                        <td className="px-3 py-2 text-left text-[#1a1916]">{d.unit ?? '—'}</td>
                        <td className="px-3 py-2 text-left text-[#1a1916]">{d.tenant ?? '—'}</td>
                        <td className="px-3 py-2 text-left text-[#6b6860]">{d.building ?? '—'}</td>
                        <td className="px-3 py-2 text-left text-[#6b6860] tabular-nums">{(d.transactionDate ?? d.recordedDate ?? '—').slice(0, 10)}</td>
                        <td className="px-3 py-2 text-left text-[#6b6860] capitalize">
                          {note ?? d.status ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold text-[#1a1916]">{fmtAed(amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
