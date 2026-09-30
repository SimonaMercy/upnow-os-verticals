'use client';
import { splitVat, typedFromStored, aed2, type VatMode } from '@/lib/vatSplit';
import { AmountWithVat } from '@/components/upnow/VatChoice';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * AMC & Vendor Management — shared view used by both the rental-provider portal
 * (base="/amc") and the manager portal (base="/manager/amc" with ?rp=<landlord>).
 *
 * AMC contracts with vendor, expiry status, PDF attachments, and an editable
 * maintenance plan (done/pending). Add-AMC supports picking an existing vendor
 * (auto-prefills a renewal for next year) or creating a new vendor, with notes.
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wrench, Loader2, Plus, Search, X, UploadCloud } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';


type Status = 'active' | 'expiring' | 'expired' | 'cancelled' | 'unknown';
/**
 * 0279/0282 — what a contract IS; decides visits / schedule / bills. The six
 * built-ins below are the fallback; the landlord's own list (renamed, reordered,
 * hidden, extended) comes from GET /kinds via `useKinds` (owner, 12 Sep: "these
 * should be dynamic so any landlord can configure them").
 */
export type ContractKind = string;
export interface KindMeta { key: string; label: string; short: string; bg: string; fg: string; visits: boolean; schedule: 'fixed' | 'bills' | 'none'; hint: string; isActive?: boolean; isBuiltin?: boolean; id?: number; contracts?: number }
export const KIND_META: Record<string, KindMeta> = {
  service:    { key: 'service', label: 'Service contract', short: 'Service',   bg: '#e7f4ee', fg: '#1a7a52', visits: true,  schedule: 'fixed', hint: 'Scheduled visits and a fixed payment plan — elevator, fire, pest, water tank, DCD, PPM.' },
  policy:     { key: 'policy', label: 'Policy',           short: 'Policy',    bg: '#fef3c7', fg: '#92400e', visits: false, schedule: 'fixed', hint: 'A premium and a renewal date, no visits — building insurance.' },
  head_lease: { key: 'head_lease', label: 'Head lease',       short: 'Lease',     bg: '#ede9fe', fg: '#6d28d9', visits: false, schedule: 'fixed', hint: 'Rent or tax the landlord pays — land renewal, main lease, sub-lease tax.' },
  utility:    { key: 'utility', label: 'Utility account',  short: 'Utility',   bg: '#e0f2fe', fg: '#0369a1', visits: false, schedule: 'bills', hint: 'Monthly bills; the amount is entered when the bill arrives — DEWA, Etisalat, monthly waste.' },
  recurring:  { key: 'recurring', label: 'Recurring cost',   short: 'Recurring', bg: '#f1f3f1', fg: '#5b615e', visits: false, schedule: 'bills', hint: 'Monthly or as set, amount on arrival — salaries, cleaning material, Noqodi, VAT, fees.' },
  adhoc:      { key: 'adhoc', label: 'Ad-hoc spend',     short: 'Ad-hoc',    bg: '#fdf3e3', fg: '#c47a00', visits: false, schedule: 'none',  hint: 'No schedule — each spend is recorded when it happens: general maintenance, supplies, restoration.' },
};
export const kindMeta = (k?: string | null) => KIND_META[k ?? 'service'] ?? KIND_META.service;
const amcUrl = (base: string, rp: number | null | undefined, path: string) =>
  rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

/** A server kind row → display meta; colour falls back to the built-in's, then a neutral. */
export interface KindRow { id: number; key: string; label: string; hint: string | null; color: string | null; hasVisits: boolean; schedule: string; sortOrder: number; isActive: boolean; isBuiltin: boolean; contracts?: number }
export function kindMetaFromRow(r: KindRow): KindMeta {
  const base = KIND_META[r.key];
  const fg = r.color || base?.fg || '#5b615e';
  return { key: r.key, label: r.label, short: r.label.split(' ')[0], bg: base && base.fg === fg ? base.bg : `${fg}1f`, fg,
    visits: r.hasVisits, schedule: (['fixed', 'bills', 'none'].includes(r.schedule) ? r.schedule : 'fixed') as KindMeta['schedule'],
    hint: r.hint ?? base?.hint ?? '', isActive: r.isActive, isBuiltin: r.isBuiltin, id: r.id, contracts: r.contracts };
}
/** The landlord's kinds — fetched once per page; falls back to the built-ins until they arrive. */
export function useKinds(base: string, rp?: number | null) {
  const [rows, setRows] = useState<KindRow[] | null>(null);
  useEffect(() => { let on = true; apiGet<KindRow[]>(amcUrl(base, rp, '/kinds')).then(r => { if (on) setRows(Array.isArray(r) ? r : []); }).catch(() => { if (on) setRows([]); }); return () => { on = false; }; }, [base, rp]);
  const all: KindMeta[] = rows && rows.length ? rows.map(kindMetaFromRow) : Object.values(KIND_META);
  const byKey = new Map(all.map(k => [k.key, k] as const));
  const meta = (k?: string | null): KindMeta => byKey.get(k ?? 'service') ?? kindMeta(k);
  return { kinds: all, active: all.filter(k => k.isActive !== false), meta, loaded: rows != null, reload: () => apiGet<KindRow[]>(amcUrl(base, rp, '/kinds')).then(r => setRows(Array.isArray(r) ? r : [])).catch(() => {}) };
}
/** The expense categories the month-end sheet groups by — offered as suggestions, free text allowed. */
/** @deprecated 0280 — categories live in the expense_categories table; kept for the seed list only. */
export const CATEGORY_SUGGESTIONS = ['Elevator Maintenance', 'Fire Fighting', 'DCD 24/7 Monitoring', 'Pest Control', 'Water Tank Cleaning', 'Air Condition', 'Water Heater', 'Building Insurance', 'Land Renewal', 'Sub Lease Tax Payments', 'Utility – Electricity/Water', 'Utility – Waste Collection', 'Telecommunication', 'Employee Salary', 'Cleaning Material', 'Noqodi', 'VAT Filling', 'Ad-hoc'];
interface AmcDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string; status: string }
export interface AmcContract {
  id: number; vendorId: number; vendorName: string; serviceCategory: string | null;
  isGovernment: boolean; contractType: string | null; frequency: string | null;
  modeOfPayment: string | null; numberOfPayments: number | null;
  startDate: string | null; endDate: string | null; status: Status;
  propertyId: number | null; propertyName: string | null; notes: string | null;
  renewalOfId: number | null; renewedById: number | null; annualValueAed?: number | null;
  /** 0299 — annualValueAed is the VAT-INCLUSIVE total; annualVatAed the VAT inside it. */
  vatMode?: VatMode; annualVatAed?: number | null;
  cancelledAt?: string | null; cancelReason?: string | null;
  kind?: ContractKind | string; categoryLabel?: string | null; expenseCategoryId?: number | null;
  payments?: { count: number; paid: number; overdue: number; unbilled?: number; nextDue: string | null; receivedAed: number; totalAed: number } | null;
  documents: AmcDoc[]; tasks: { total: number; done: number; pending: number; overdue?: number; quotationsPending?: number };
}
interface PropertyOpt { id: number; buildingName?: string | null; name?: string | null; rentalProviderId?: number }
export interface CategoryOpt { id: number; name: string; defaultKind: string; isActive: boolean }
interface VendorOpt { id: number; name: string; serviceCategory: string | null; expenseCategoryId?: number | null; expenseCategoryName?: string | null; expenseCategoryKind?: string | null; paymentFrequency?: string | null }
interface PlanRow { title: string; dueDate: string; notes: string }

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  active:   { bg: '#e7f4ee', fg: '#1a7a52', label: 'Active' },
  expiring: { bg: '#fdf3e3', fg: '#c47a00', label: 'Expiring soon' },
  expired:  { bg: '#fdecea', fg: '#b42318', label: 'Expired' },
  cancelled:{ bg: '#f1f3f1', fg: '#5b615e', label: 'Cancelled' },
  unknown:  { bg: '#f1f3f1', fg: '#5b615e', label: 'No expiry' },
};
const cap = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };
const addMonths = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const addYears = (iso: string, n: number) => addMonths(iso, n * 12);
export interface PayRow {
  id?: number | null; dueDate: string; amountAed: string; status?: string; reference?: string | null;
  /** 0299 — the row as it is stored (total + the VAT inside it): shown as-is until the amount is edited. */
  storedAmountAed?: number | null; storedVatAed?: number | null;
  /** Add form only (owner, 10 Sep: "while adding AMC there is payment proof with cheque details, then in the
   *  detail page again I have to attach?"): a row already paid carries its cheque / transfer details and proof
   *  here, and is marked paid the moment the contract is created. */
  paid?: boolean; paidAt?: string; method?: string; proofFile?: File | null;
}
export const PAY_METHODS = ['cheque', 'bank_transfer', 'cash', 'card', 'online'] as const;
const DAY_MS = 86_400_000;
const termMonthsOf = (start: string, end: string) => Math.max(1, Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / (30.4375 * DAY_MS)));
/** The count follows the frequency: monthly = one per month of the term, quarterly = one per quarter, else one. */
export function defaultPayCount(frequency: string, start: string, end: string): number {
  if (!start) return 1;
  const months = end ? termMonthsOf(start, end) : 12;
  if (frequency === 'monthly') return months;
  if (frequency === 'quarterly') return Math.max(1, Math.ceil(months / 3));
  return 1;
}
/** Dates cadenced across the term, the value split evenly (last row absorbs rounding). */
export function buildPayRows(start: string, end: string, count: number, annualValue: string): PayRow[] {
  if (!start) return [];
  const n = Math.max(1, Math.floor(count || 1));
  const termEnd = end || addYears(start, 1);
  const months = termMonthsOf(start, termEnd);
  const total = annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Math.round(Number(annualValue) * (months / 12) * 100) / 100 : 0;
  const each = Math.round((total / n) * 100) / 100;
  const cadence = n === 1 ? 0 : months / n;
  const termDays = Math.max(1, Math.round((Date.parse(termEnd + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY_MS));
  return Array.from({ length: n }, (_, i) => {
    const m = cadence * i;
    const dueDate = n === 1 ? start
      : Math.abs(m - Math.round(m)) < 0.01 ? addMonths(start, Math.round(m))
      : new Date(Date.parse(start + 'T00:00:00Z') + Math.round((i * termDays) / n) * DAY_MS).toISOString().slice(0, 10);
    const amt = i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each;
    return { dueDate, amountAed: total ? String(amt) : '' };
  });
}
export const PAY_PRESETS = [1, 2, 3, 4, 6, 12];

/** The flexible payment plan editor — shared by the Add/Renew form and the detail page. */
export function PaymentPlanEditor({ start, end, frequency, annualValue, rows, onChange, dirty, setDirty, onCount, proofs, modeOfPayment, vatInside }: {
  start: string; end: string; frequency: string; annualValue: string;
  /** 0299 — the contract carries VAT: every amount here is what is PAID (VAT included) and each row shows its split. */
  vatInside?: boolean;
  rows: PayRow[]; onChange: (rows: PayRow[]) => void; dirty: boolean; setDirty: (d: boolean) => void;
  /** The split the user CHOSE (null = follow the frequency). The owner keeps it so
   *  re-splitting on a value/date change honours it instead of snapping back. */
  onCount?: (n: number | null) => void;
  /** Add form: let a row be marked "already paid" with its cheque details and proof. */
  proofs?: boolean; modeOfPayment?: string;
}) {
  const def = defaultPayCount(frequency, start, end);
  const count = rows.length || def;
  const presets = Array.from(new Set([def, ...PAY_PRESETS])).sort((a, b) => a - b);
  const total = rows.reduce((n, r) => n + (Number(r.amountAed) || 0), 0);
  // The VAT inside one row: the stored figure while the amount is untouched (it may be the supplier's own), else 5/105.
  const rowVat = (r: PayRow): number => {
    const amt = Number(r.amountAed) || 0;
    if (r.storedAmountAed != null && r.storedVatAed != null && Number(r.storedAmountAed) === amt) return Number(r.storedVatAed);
    return vatInside ? splitVat(amt, 'inclusive').vat : 0;
  };
  const totalVat = Math.round(rows.reduce((n, r) => n + rowVat(r), 0) * 100) / 100;
  const showVat = !!vatInside || totalVat > 0;
  const months = start && end ? termMonthsOf(start, end) : 12;
  const expected = annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Math.round(Number(annualValue) * (months / 12) * 100) / 100 : null;
  const regen = (n: number) => { setDirty(false); onCount?.(n === def ? null : n); onChange(buildPayRows(start, end, n, annualValue)); };
  const setRow = (i: number, patch: Partial<PayRow>) => { setDirty(true); onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r)); };
  const field = 'text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]';
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-[#6b6860]">Payment plan</span>
        <select className={field} value={presets.includes(count) ? String(count) : 'custom'} onChange={e => { if (e.target.value !== 'custom') regen(Number(e.target.value)); }} disabled={!start}>
          {presets.map(n => <option key={n} value={n}>{n === def ? `${n} · from ${frequency ? frequency.replace(/_/g, ' ') : 'frequency'}` : n === 1 ? '1 · single payment' : `${n} payments`}</option>)}
          {!presets.includes(count) && <option value="custom">{count} · custom</option>}
        </select>
        <button type="button" onClick={() => { setDirty(true); onChange([...rows, { dueDate: rows[rows.length - 1]?.dueDate ?? start, amountAed: '' }]); }} className="text-[11px] font-semibold text-[#1a7a5a] cursor-pointer" disabled={!start}>+ Add installment</button>
        {dirty && <button type="button" onClick={() => regen(def)} className="text-[11px] font-semibold text-[#6b6860] hover:text-[#1a1916] cursor-pointer ml-auto">Regenerate from frequency</button>}
      </div>
      {!start && <p className="text-[11px] text-[#9b9890] mt-1">Set the start date first.</p>}
      {rows.length > 0 && (
        <div className="mt-2 border border-[#f0eee8] rounded-lg divide-y divide-[#f4f2ec] max-h-56 overflow-y-auto">
          {rows.map((r, i) => {
            const locked = r.status === 'paid';
            return (
              <div key={r.id ?? `n${i}`} className="px-2.5 py-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[#9b9890] w-6 shrink-0">#{i + 1}</span>
                  <input type="date" className={field + ' w-[138px]'} value={r.dueDate} disabled={locked} onChange={e => setRow(i, { dueDate: e.target.value })} />
                  <input type="number" min="0" step="0.01" placeholder={showVat ? 'AED incl. VAT' : 'AED'} title={showVat ? 'What is paid — VAT included' : undefined} className={field + ' w-[110px]'} value={r.amountAed} disabled={locked} onChange={e => setRow(i, { amountAed: e.target.value })} />
                  {showVat && Number(r.amountAed) > 0 && (
                    <span className="text-[10.5px] text-[#6b6860] whitespace-nowrap">{aed2(Math.round((Number(r.amountAed) - rowVat(r)) * 100) / 100)} + VAT {aed2(rowVat(r))}</span>
                  )}
                  {proofs && !locked && (
                    <label className="text-[11px] text-[#6b6860] flex items-center gap-1 whitespace-nowrap cursor-pointer" title="Already paid — record the cheque / transfer details now">
                      <input type="checkbox" checked={!!r.paid} onChange={e => setRow(i, { paid: e.target.checked, paidAt: r.paidAt || r.dueDate || new Date().toISOString().slice(0, 10) })} /> paid
                    </label>
                  )}
                  {locked
                    ? <span className="text-[10.5px] font-bold text-[#1a7a52] ml-auto">paid{r.reference ? ` · ${r.reference}` : ''}</span>
                    : <button type="button" onClick={() => { setDirty(true); onChange(rows.filter((_, j) => j !== i)); }} className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer ml-auto" aria-label="Remove installment"><X size={13} /></button>}
                </div>
                {proofs && r.paid && !locked && (
                  <div className="flex items-center gap-2 flex-wrap mt-1.5 ml-8">
                    <input placeholder={(r.method || modeOfPayment) === 'cheque' ? 'Cheque no. · bank' : 'Reference'} className={field + ' flex-1 min-w-[140px]'} value={r.reference ?? ''} onChange={e => setRow(i, { reference: e.target.value })} />
                    <input type="date" className={field} value={r.paidAt ?? ''} onChange={e => setRow(i, { paidAt: e.target.value })} title="Paid on" />
                    <select className={field} value={r.method ?? ''} onChange={e => setRow(i, { method: e.target.value })} title="Paid by which method">
                      <option value="">{modeOfPayment ? `${modeOfPayment.replace(/_/g, ' ')} (contract)` : 'Method…'}</option>
                      {PAY_METHODS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                    </select>
                    <label className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer ${r.proofFile ? 'border-[#1a7a5a] text-[#1a7a5a] bg-[#e6f4ef]' : 'border-dashed border-[#d8d6d0] text-[#6b6860] hover:bg-[#f9f8f6]'}`}>
                      {r.proofFile ? r.proofFile.name.slice(0, 22) : 'Attach proof'}
                      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => { setRow(i, { proofFile: e.target.files?.[0] ?? null }); e.target.value = ''; }} />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <p className={`text-[11px] mt-1 ${expected != null && Math.abs(total - expected) > 0.5 ? 'text-[#b45309]' : 'text-[#9b9890]'}`}>
          {rows.length} installment{rows.length === 1 ? '' : 's'} · total AED {total.toLocaleString('en-AE')}{showVat ? ` (before VAT ${aed2(Math.round((total - totalVat) * 100) / 100)} + VAT ${aed2(totalVat)})` : ''}{expected != null ? ` · contract value for the term AED ${expected.toLocaleString('en-AE')}${Math.abs(total - expected) > 0.5 ? ' — does not match' : ''}` : ''}{proofs && rows.some(r => r.paid) ? ` · ${rows.filter(r => r.paid).length} already paid — recorded on creation` : ''}
        </p>
      )}
    </div>
  );
}


/**
 * A visit's title: "<what> visit" — the expense category when set ("Elevator
 * Maintenance visit"), else the vendor's category ("Pest control visit"), else
 * plain "Maintenance visit". Never "maintenance maintenance" (owner, 10 Sep).
 */
export function visitTitle(category: string | null | undefined, fallback?: string | null): string {
  const raw = (category?.trim() || fallback?.trim() || 'maintenance').replace(/_/g, ' ');
  const label = raw.toLowerCase() === 'maintenance' ? 'Maintenance' : raw.charAt(0).toUpperCase() + raw.slice(1);
  return `${label} visit`;
}
function buildPlan(start: string, end: string, frequency: string, category: string, categoryLabel?: string): PlanRow[] {
  if (!start || !end) return [];
  const title = visitTitle(categoryLabel, category);
  const months = FREQ_MONTHS[frequency];
  if (!months) return [{ title, dueDate: start, notes: '' }];
  const rows: PlanRow[] = []; let due = start, i = 0;
  while (due <= end && i < 60) { rows.push({ title, dueDate: due, notes: '' }); due = addMonths(due, months); i++; }
  return rows;
}

export function AmcView({ base, rp, propertiesUrl, vendorsHref, reportHref, categoriesHref, canEdit = true }: {
  base: string; rp?: number | null; propertiesUrl: string; vendorsHref?: string; reportHref?: string; categoriesHref?: string;
  /** False for a manager who may only record vendor payments (0319): the list
   *  is read and the contracts open, but Add / Renew are not offered. */
  canEdit?: boolean;
}) {
  const { meta: kindOf } = useKinds(base, rp);
  const [tab, setTab] = useState<'active' | 'expired' | 'cancelled'>('active');
  const [view, setView] = useState<'rows' | 'grid'>('rows');
  const [contracts, setContracts] = useState<AmcContract[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [renewFrom, setRenewFrom] = useState<AmcContract | null>(null);
  const [q, setQ] = useState('');
  // Property filter (owner, 12 Sep): '' = every property; 'none' = contracts with no property.
  const [propFilter, setPropFilter] = useState('');
  const router = useRouter();

  // Per-viewer convenience only: remember Rows/Grid in this browser (read once after mount to avoid a hydration mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const v = localStorage.getItem('amc.view'); if (v === 'grid' || v === 'rows') setView(v); } catch { /* ignore */ } }, []);
  const pickView = (v: 'rows' | 'grid') => { setView(v); try { localStorage.setItem('amc.view', v); } catch { /* ignore */ } };

  const load = useCallback(() => {
    setLoading(true);
    apiGet<AmcContract[]>(amcUrl(base, rp, '/contracts')).catch(() => [] as AmcContract[])
      .then(c => setContracts(c)).finally(() => setLoading(false));
  }, [base, rp]);
  useEffect(() => { load(); }, [load]);

  const kpi = {
    active: contracts?.filter(c => c.status === 'active').length ?? 0,
    expiring: contracts?.filter(c => c.status === 'expiring').length ?? 0,
    expired: contracts?.filter(c => c.status === 'expired').length ?? 0,
    cancelled: contracts?.filter(c => c.status === 'cancelled').length ?? 0,
    unknown: contracts?.filter(c => c.status === 'unknown').length ?? 0,
    overdue: contracts?.filter(c => c.status !== 'expired' && c.status !== 'cancelled').reduce((n, c) => n + (c.tasks.overdue ?? 0), 0) ?? 0,
  };
  // Like the Leases register: running contracts up front (expiring soon stays
  // here — it is still in force), the expired history on its own tab.
  const needle = q.trim().toLowerCase();
  // Every property that has a contract, for the filter — from the data, so it never lists an empty building.
  const propOptions = [...new Map((contracts ?? []).filter(c => c.propertyId != null).map(c => [c.propertyId!, c.propertyName ?? `Property #${c.propertyId}`] as const)).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const hasUnassigned = (contracts ?? []).some(c => c.propertyId == null);
  const shown = (contracts ?? [])
    .filter(c => tab === 'expired' ? c.status === 'expired' : tab === 'cancelled' ? c.status === 'cancelled' : c.status !== 'expired' && c.status !== 'cancelled')
    .filter(c => !propFilter || (propFilter === 'none' ? c.propertyId == null : String(c.propertyId) === propFilter))
    .filter(c => !needle || [c.vendorName, c.propertyName, c.serviceCategory, `amc-${c.id}`].some(v => (v ?? '').toLowerCase().includes(needle)))
    .sort((a, b) => (a.endDate ?? '').localeCompare(b.endDate ?? ''));

  const closeModal = () => { setShowAdd(false); setRenewFrom(null); };
  const detailHrefOf = (c: AmcContract) => base === '/amc'
    ? `/rental-provider/dashboard/amc/${c.id}`
    : `/dashboard/manager/amc/${c.id}${rp != null ? `?rp=${rp}` : ''}`;
  const money = (n?: number | null) => n != null ? `AED ${Number(n).toLocaleString('en-AE')}` : '—';
  /** The visits cell: progress, then the one flag that matters. */
  const visitsFlag = (c: AmcContract): { text: string; color: string } => {
    const overdue = c.tasks.overdue ?? 0;
    if (overdue > 0) return { text: `${overdue} overdue`, color: '#b42318' };
    if (c.tasks.total > 0 && c.tasks.done === c.tasks.total) return { text: 'Done', color: '#1a7a52' };
    if (c.tasks.total === 0) return { text: 'No plan', color: '#8a8f8c' };
    return { text: `${c.tasks.pending} pending`, color: '#5b615e' };
  };
  const pillCls = 'text-[10px] font-bold px-[7px] py-[2px] rounded-full';
  const subline = (c: AmcContract) => `AMC-${c.id} · ${c.propertyName ?? 'All properties'}${c.categoryLabel ? ` · ${c.categoryLabel}` : ''}${c.frequency ? ` · ${cap(c.frequency)}` : ''}`;
  const chip = (c: AmcContract) => { const ss = STATUS_STYLE[c.status]; return <span className={pillCls} style={{ background: ss.bg, color: ss.fg }}>{ss.label}</span>; };
  const kindChip = (c: AmcContract) => { const km = kindOf(c.kind); return km.visits ? null : <span className={pillCls + ' font-semibold'} style={{ background: km.bg, color: km.fg }} title={km.hint}>{km.short}</span>; };
  /** The fourth column: visits for service contracts, the payment state for everything else. */
  const workCell = (c: AmcContract): { left: string; text: string; color: string } => {
    if (kindOf(c.kind).visits) { const f = visitsFlag(c); return { left: `${c.tasks.done} / ${c.tasks.total} completed`, ...f }; }
    const p = c.payments;
    if (!p || !p.count) return { left: kindOf(c.kind).schedule === 'none' ? 'Spend recorded as it happens' : 'No schedule', text: '', color: '#8a8f8c' };
    if (p.overdue > 0) return { left: `${p.paid} / ${p.count} paid`, text: `${p.overdue} overdue`, color: '#b42318' };
    if (p.unbilled) return { left: `${p.paid} / ${p.count} paid`, text: `${p.unbilled} bill${p.unbilled === 1 ? '' : 's'} awaited`, color: '#c47a00' };
    if (p.paid === p.count) return { left: `${p.paid} / ${p.count} paid`, text: 'Settled', color: '#1a7a52' };
    return { left: `${p.paid} / ${p.count} paid`, text: p.nextDue ? `next ${fmt(p.nextDue)}` : '', color: '#5b615e' };
  };
  const renewable = (c: AmcContract) => (c.status === 'expired' || c.status === 'expiring') && c.renewedById == null;
  const toggleBtn = (v: 'rows' | 'grid', label: string, extra = '') => (
    <button type="button" onClick={() => pickView(v)} className={`text-[11px] font-semibold px-[11px] py-[7px] cursor-pointer ${extra}`}
      style={view === v ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e' }}>{label}</button>
  );

  return (
    <div className="text-[#1c1f1d]">
      <div className="flex items-start justify-between gap-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-[-.01em]">AMC Contracts</h1>
          <p className="text-[12.5px] text-[#5b615e] mt-1">
            Annual maintenance contracts and their maintenance plans.{' '}
            {reportHref && <><Link href={reportHref} className="text-[#1a7a52] hover:text-[#125a3c] underline font-semibold">Month-end report</Link>{categoriesHref ? <> · <Link href={categoriesHref} className="text-[#1a7a52] hover:text-[#125a3c] underline">Categories</Link></> : null}.{' '}</>}
            {vendorsHref
              ? <>Vendor records live on the <a href={vendorsHref} className="text-[#1a7a52] hover:text-[#125a3c] underline">Vendors page</a>.</>
              : 'Vendor records live on the Vendors page.'}
          </p>
        </div>
        {canEdit && <button onClick={() => { setRenewFrom(null); setShowAdd(true); }}
          className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] whitespace-nowrap cursor-pointer">+ Add AMC</button>}
      </div>

      {showAdd && !renewFrom && <AddAmcModal base={base} rp={rp} propertiesUrl={propertiesUrl} existingContracts={contracts ?? []} onClose={closeModal} onSaved={() => { closeModal(); load(); }} />}
      {showAdd && renewFrom && <AddAmcModal base={base} rp={rp} propertiesUrl={propertiesUrl} existingContracts={contracts ?? []} renewFrom={renewFrom} onClose={closeModal} onSaved={() => { closeModal(); load(); }} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-[22px]">
        {[
          { label: 'Active AMCs', value: kpi.active, color: '#1a7a52' },
          { label: 'Visits overdue', value: kpi.overdue, color: '#b42318' },
          { label: 'Expiring ≤60d', value: kpi.expiring, color: '#c47a00' },
          { label: 'Expired', value: kpi.expired, color: '#1c1f1d' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e6e8e6] rounded-xl px-4 py-3.5">
            <p className="text-[11px] text-[#5b615e]">{k.label}</p>
            <p className="text-[22px] font-extrabold mt-1 leading-none" style={{ color: k.color }}>{loading ? '…' : k.value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 mt-5 flex-wrap">
        <label className="relative w-full sm:w-[260px]">
          <Search size={13} className="absolute left-3 top-[10px] text-[#8a8f8c]" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor or category…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <select value={propFilter} onChange={e => setPropFilter(e.target.value)} title="Filter by property"
          className="py-2 pl-3 pr-8 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full sm:w-auto max-w-[260px]"
          style={propFilter ? { borderColor: '#1a7a52', color: '#1a7a52', fontWeight: 600 } : undefined}>
          <option value="">All properties</option>
          {propOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          {hasUnassigned && <option value="none">No property on the contract</option>}
        </select>
        <div className="flex gap-1.5 ml-auto">
          {([['active', `Active · ${kpi.active + kpi.expiring + kpi.unknown}`], ['expired', `Expired · ${kpi.expired}`], ...(kpi.cancelled ? [['cancelled', `Cancelled · ${kpi.cancelled}`] as const] : [])] as ReadonlyArray<readonly ['active' | 'expired' | 'cancelled', string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className="text-[11px] px-3 py-1.5 rounded-full font-semibold transition-colors cursor-pointer"
              style={tab === key ? { background: '#1c1f1d', color: '#fff' } : { background: '#fff', color: '#5b615e', border: '1px solid #e6e8e6' }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex border border-[#e6e8e6] rounded-lg overflow-hidden bg-white">
          {toggleBtn('rows', 'Rows')}
          {toggleBtn('grid', 'Grid', 'border-l border-[#e6e8e6]')}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8f8c]"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : !shown.length ? (
        <div className="mt-3.5"><Empty icon={Wrench} msg={tab === 'expired' ? 'No expired contracts — history lands here when a contract runs out.' : tab === 'cancelled' ? 'No cancelled contracts.' : 'No running AMC contracts yet.'} /></div>
      ) : view === 'rows' ? (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,1fr)_150px] gap-3 items-center px-[18px] py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]">
                <span>VENDOR</span><span>PERIOD</span><span>VALUE / YR</span><span>VISITS · PAYMENTS</span><span />
              </div>
              {shown.map(c => {
                const cell = workCell(c); const href = detailHrefOf(c);
                return (
                  <div key={c.id} onClick={() => router.push(href)}
                    className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,1fr)_150px] gap-3 items-center px-[18px] py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 cursor-pointer hover:bg-[#fafbfa]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{c.vendorName}</span>
                        {chip(c)}{kindChip(c)}
                        {c.renewalOfId != null && <span className={pillCls + ' font-semibold'} style={{ background: '#e9effc', color: '#2a5bd7' }}>Renewal</span>}
                      </div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">{subline(c)}</div>
                    </div>
                    <div className="whitespace-nowrap">{fmt(c.startDate)} → {fmt(c.endDate)}</div>
                    {/* ONE grid cell: the value with its VAT beneath — a second sibling would become a column of its own and shift the row. */}
                    <div className="whitespace-nowrap">
                      <div className="font-semibold">{money(c.annualValueAed)}</div>
                      {!!c.annualVatAed && <div className="text-[10.5px] text-[#8a8f8c]">incl. VAT {aed2(c.annualVatAed)}</div>}
                    </div>
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span>{cell.left}</span>
                      <span className="font-bold whitespace-nowrap" style={{ color: cell.color }}>{cell.text}</span>
                    </div>
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {canEdit && renewable(c) && (
                        <button type="button" onClick={() => { setRenewFrom(c); setShowAdd(true); }}
                          className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer">Renew</button>
                      )}
                      <Link href={href} className="text-[12px] font-semibold text-[#1a7a52] hover:text-[#125a3c] no-underline">View →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3.5 mt-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {shown.map(c => {
            const cell = workCell(c); const href = detailHrefOf(c);
            return (
              <Link key={c.id} href={href} className="no-underline text-inherit bg-white border border-[#e6e8e6] rounded-[14px] px-[18px] py-4 flex flex-col gap-3 hover:border-[#c9cfcb]">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="font-bold text-[13px] truncate">{c.vendorName}</div>
                    <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">{subline(c)}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">{chip(c)}{kindChip(c)}{c.renewalOfId != null && <span className={pillCls + ' font-semibold'} style={{ background: '#e9effc', color: '#2a5bd7' }}>Renewal</span>}</div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  <div><div className="text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]">PERIOD</div><div className="mt-0.5">{fmt(c.startDate)} → {fmt(c.endDate)}</div></div>
                  <div><div className="text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]">VALUE / YR</div><div className="mt-0.5 font-semibold">{money(c.annualValueAed)}</div>{!!c.annualVatAed && <div className="text-[10.5px] text-[#8a8f8c]">incl. VAT {aed2(c.annualVatAed)}</div>}</div>
                </div>
                <div className="flex justify-between items-center text-[12px]">
                  <span>{cell.left}</span>
                  <span className="flex items-center gap-2">
                    {canEdit && renewable(c) && <button type="button" onClick={e => { e.preventDefault(); setRenewFrom(c); setShowAdd(true); }} className="text-[11px] font-bold px-2.5 py-0.5 rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer">Renew</button>}
                    <span className="font-bold" style={{ color: cell.color }}>{cell.text}</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Empty({ icon: Icon, msg }: { icon: React.ComponentType<{ size?: number; className?: string }>; msg: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center">
      <Icon size={28} className="mx-auto mb-2 text-[#c5c3bc]" />
      <p className="text-sm text-[#9b9890]">{msg}</p>
    </div>
  );
}

/** A numbered block of the Add form — title, one-line hint, optional action on the right. */
function Section({ n, title, hint, action, children }: { n: number; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-[#eef0ee] rounded-xl px-3.5 py-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-[#1a1916] flex items-center gap-2"><span className="w-5 h-5 rounded-full bg-[#1a1916] text-white text-[10px] font-extrabold grid place-items-center shrink-0">{n}</span>{title}</div>
          {hint && <p className="text-[11px] text-[#9b9890] mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Add AMC — the full form. With `renewFrom` it is the RENEW form (owner, 9 Sep):
 * every field prefilled from the contract being renewed for the next term, the
 * vendor locked, the visit plan regenerated for the new dates and editable.
 */
export function AddAmcModal({ base, rp, propertiesUrl, renewFrom, onClose, onSaved }: {
  base: string; rp?: number | null; propertiesUrl: string; existingContracts: AmcContract[]; renewFrom?: AmcContract | null; onClose: () => void; onSaved: () => void;
}) {
  const from = renewFrom ?? null;
  // A renewal starts where the old term ends; a new contract starts today (editable) —
  // an empty start left the payment split disabled and looked broken.
  const nextStart = from?.endDate ? from.endDate.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const [allVendors, setAllVendors] = useState<VendorOpt[]>([]);
  const [props, setProps] = useState<PropertyOpt[]>([]);
  const [vendorId, setVendorId] = useState(from ? String(from.vendorId) : '');
  const [propertyId, setPropertyId] = useState(from?.propertyId != null ? String(from.propertyId) : '');
  const [contractType, setContractType] = useState(from ? 'renewal' : 'new');
  // 0279 — what this contract IS (owner, 10 Sep). Decides which sections show below.
  const { active: kindList, meta: kindOf } = useKinds(base, rp);
  const [kind, setKind] = useState<ContractKind>(from?.kind ?? 'service');
  const [categoryLabel, setCategoryLabel] = useState(from?.categoryLabel ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(from?.expenseCategoryId ?? null);
  const [cats, setCats] = useState<CategoryOpt[]>([]);
  const [newCat, setNewCat] = useState(false);
  const km = kindOf(kind);
  const [startDate, setStartDate] = useState(nextStart);
  const [endDate, setEndDate] = useState(nextStart ? addYears(nextStart, 1) : '');
  const [frequency, setFrequency] = useState(from?.frequency ?? 'annually');
  const [modeOfPayment, setModeOfPayment] = useState(from?.modeOfPayment ?? '');
  const [payRows, setPayRows] = useState<PayRow[]>([]);
  const [payDirty, setPayDirty] = useState(false);
  // The split the landlord picked in the dropdown; null = one per frequency period.
  const [payCount, setPayCount] = useState<number | null>(from?.numberOfPayments ?? null);
  // The box holds the amount AS TYPED; VAT choice beside it (stored total → what was typed).
  const [vatMode, setVatMode] = useState<VatMode>(from?.vatMode ?? 'none');
  const [annualValue, setAnnualValue] = useState(typedFromStored(from?.annualValueAed, from?.annualVatAed, from?.vatMode ?? 'none'));
  const [annualVat, setAnnualVat] = useState('');
  // The payment plan is what gets PAID — built from the VAT-inclusive total.
  const annualTotal = annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? String(splitVat(Number(annualValue), vatMode, annualVat.trim() !== '' ? Number(annualVat) : null).total) : '';
  const [notes, setNotes] = useState(from?.notes ?? '');
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [category, setCategory] = useState(from?.serviceCategory ?? 'maintenance');
  const [file, setFile] = useState<File | null>(null);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renewalOfId: number | null = from ? from.id : null;


  useEffect(() => {
    apiGet<CategoryOpt[]>(amcUrl(base, rp, '/categories')).then(setCats).catch(() => setCats([]));
    apiGet<VendorOpt[]>(amcUrl(base, rp, '/vendors/all')).then(setAllVendors).catch(() => setAllVendors([]));
    apiGet<PropertyOpt[]>(propertiesUrl)
      // Manager mode: /manager/properties returns every managed landlord's
      // properties — scope the picker to the landlord this AMC contract is for.
      .then(list => setProps(rp ? list.filter(p => p.rentalProviderId == null || p.rentalProviderId === rp) : list))
      .catch(() => setProps([]));
  }, [base, rp, propertiesUrl]);

  // Add AMC records a NEW contract. Renewals have their own path — "Renew
  // contract" on the list/detail opens this form prefilled (owner, 9 Sep) — so
  // picking a vendor here no longer silently links the contract to their last one.
  function onPickVendor(id: string) {
    setVendorId(id);
    const v = allVendors.find(x => String(x.id) === id);
    setCategory(v?.serviceCategory ?? 'maintenance');
    // 0284 — the vendor is primary: its sub-category (and that sub-category's category) fill in, still editable below.
    if (v?.expenseCategoryId != null) {
      setNewCat(false); setCategoryId(v.expenseCategoryId); setCategoryLabel(v.expenseCategoryName ?? '');
      if (v.expenseCategoryKind && kindList.some(k => k.key === v.expenseCategoryKind)) pickKind(v.expenseCategoryKind);
    }
    // 0345 — and how often they're paid.
    if (v?.paymentFrequency) setFrequency(v.paymentFrequency);
  }

  useEffect(() => { if (!planDirty) setPlan(buildPlan(startDate, endDate, frequency, category, categoryLabel)); }, [startDate, endDate, frequency, category, categoryLabel, planDirty]);
  // The payment plan follows the terms until the user edits a row (then it is theirs).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (payDirty) return;
    const rows = buildPayRows(startDate, endDate, payCount ?? defaultPayCount(frequency, startDate, endDate), annualTotal);
    // Bill-type kinds: one row per period with NO amount — the bill fills it in when it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayRows(km.schedule === 'bills' && annualValue.trim() === '' ? rows.map(r => ({ ...r, amountAed: '' })) : rows);
  }, [startDate, endDate, frequency, annualValue, annualTotal, payDirty, payCount, kind, km.schedule]);
  // Picking a bill-type kind defaults the cadence to monthly; ad-hoc has no schedule.
  const pickKind = (k: ContractKind) => { setKind(k); setPayDirty(false); if (kindOf(k).schedule === 'bills') setFrequency('monthly'); };

  const editRow = (i: number, patch: Partial<PlanRow>) => { setPlanDirty(true); setPlan(p => p.map((r, j) => j === i ? { ...r, ...patch } : r)); };
  const removeRow = (i: number) => { setPlanDirty(true); setPlan(p => p.filter((_, j) => j !== i)); };
  const addRow = () => { setPlanDirty(true); setPlan(p => [...p, { title: visitTitle(categoryLabel, category), dueDate: endDate || startDate || '', notes: '' }]); };
  const regenerate = () => { setPlanDirty(false); setPlan(buildPlan(startDate, endDate, frequency, category, categoryLabel)); };

  async function submit() {
    setError(null);
    if (!vendorId) { setError('Pick a vendor — record new ones on the Vendors page.'); return; }
    if (!startDate) { setError('Start date is required.'); return; }
    setSaving(true);
    try {
      const spId = Number(vendorId);
      const contract = await apiPost<{ id: number }>(amcUrl(base, rp, '/contracts'), {
        serviceProviderId: spId,
        propertyId: propertyId ? Number(propertyId) : null,
        kind, categoryLabel: categoryLabel.trim() || null, expenseCategoryId: newCat ? null : categoryId,
        contractType, startDate, endDate: endDate || null, frequency,
        renewalOfId: contractType === 'renewal' ? renewalOfId : null,
        annualValueAed: annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Number(annualValue) : null,
        vatMode, annualVatAed: annualVat.trim() !== '' ? Number(annualVat) : null,
        modeOfPayment: modeOfPayment || null,
        numberOfPayments: km.schedule === 'none' ? null : payRows.length || null,
        installments: km.schedule === 'none' ? [] : payRows.filter(r => r.dueDate).map(r => ({ dueDate: r.dueDate, amountAed: r.amountAed.trim() === '' ? null : Number(r.amountAed) || 0 })),
        notes: notes.trim() || null,
        tasks: km.visits ? plan.filter(r => r.title.trim()).map(r => ({ title: r.title.trim(), dueDate: r.dueDate || null, notes: r.notes.trim() || null })) : [],
      });
      if (file) await uploadContractPdf(contract.id, file);
      // Installments ticked "already paid": file each proof against the contract and
      // mark the matching schedule row paid — the cheque details entered here ARE the record.
      const paidRows = km.schedule === 'none' ? [] : payRows.map((r, i) => ({ r, seq: i + 1 })).filter(x => x.r.paid && x.r.dueDate);
      if (paidRows.length) {
        const sched = await apiGet<{ installments: Array<{ id: number | null; seq: number }> }>(amcUrl(base, rp, `/contracts/${contract.id}/installments`)).catch(() => ({ installments: [] }));
        for (const { r, seq } of paidRows) {
          const inst = sched.installments.find(x => x.seq === seq);
          if (!inst?.id) continue;
          let proofDocId: number | null = null;
          if (r.proofFile) proofDocId = await uploadContractDoc(contract.id, r.proofFile, `sp_payment_proof_inst_${inst.id}`, 'payment', r.reference?.trim() ? `Proof of Payment · ${r.reference.trim()}` : `Proof of Payment · #${seq}`);
          await apiPatch(amcUrl(base, rp, `/installments/${inst.id}/paid`), { reference: r.reference?.trim() || null, paidAt: r.paidAt || null, paymentMethod: r.method || null, proofDocId, amountAed: r.amountAed.trim() === '' ? null : Number(r.amountAed) });
        }
      }
      onSaved();
    } catch (e) { setError((e as Error)?.message || 'Could not create the AMC.'); }
    finally { setSaving(false); }
  }

  async function uploadContractPdf(contractId: number, f: File) {
    await uploadContractDoc(contractId, f, 'sp_contract', 'contract', 'Contract Attachment');
  }

  async function uploadContractDoc(contractId: number, f: File, documentKey: string, category: string, displayName: string): Promise<number | null> {
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey, originalName: f.name, mimeType: f.type }),
    });
    if (!urlRes.ok) return null;
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json();
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    await fetch(target, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
    const saveRes = await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey, category, displayName, fileUrl, mimeType: f.type, s3Key: fileKey }),
    });
    const doc = await saveRes.json().catch(() => null);
    return doc?.id ?? null;
  }

  const field = 'w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]';
  const lbl = 'text-xs font-medium text-[#6b6860] mb-1 block';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f4f3ef] sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-sm font-bold text-[#1a1916]">{from ? `Renew AMC-${from.id} — ${from.vendorName}` : 'Add a contract or expense'}</h2>
            <p className="text-[11px] text-[#9b9890] mt-0.5">{km.label}{categoryLabel ? ` · ${categoryLabel}` : ''}{vendorId ? ` · ${allVendors.find(v => String(v.id) === vendorId)?.name ?? from?.vendorName ?? ''}` : ''}{annualTotal ? ` · AED ${Number(annualTotal).toLocaleString('en-AE')}/yr${vatMode !== 'none' ? ' incl. VAT' : ''}` : ''}{km.schedule !== 'none' && payRows.length ? ` · ${payRows.length} ${km.schedule === 'bills' ? (payRows.length === 1 ? 'bill' : 'bills') : (payRows.length === 1 ? 'payment' : 'payments')}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-x-6 gap-y-4">
          {/* ── left: what it is, who it is with, the term ── */}
          <div className="space-y-4 min-w-0">
            <Section n={1} title={kind === 'head_lease' ? 'Payee & property' : 'Vendor & property'}>
              <span className={lbl}>{kind === 'head_lease' ? 'Head landlord / authority' : kind === 'recurring' ? 'Payee' : 'Vendor'}</span>
              <select className={field} value={vendorId} onChange={e => onPickVendor(e.target.value)} disabled={!!from}>
                <option value="">Select…</option>
                {from && !allVendors.some(v => v.id === from.vendorId) && <option value={from.vendorId}>{from.vendorName}</option>}
                {allVendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.serviceCategory ? ` · ${v.serviceCategory.replace(/_/g,' ')}` : ''}</option>)}
              </select>
              {from
                ? <p className="text-[11px] text-[#2e9f82] mt-1">Everything from AMC-{from.id} ({fmt(from.startDate)} – {fmt(from.endDate)}) is prefilled for the next term — change what differs, then save. The old contract stays on record.</p>
                : <p className="text-[11px] text-[#9b9890] mt-1">Not listed? Record it on the <a href="/rental-provider/dashboard/vendors" className="text-[#1a7a5a] font-semibold underline">Vendors page</a> first.</p>}
              <div className="mt-3"><span className={lbl}>Property <span className="font-normal text-[#9b9890]">— which building this cost belongs to</span></span>
                <select className={field} value={propertyId} onChange={e => setPropertyId(e.target.value)}>
                  <option value="">— all / none —</option>
                  {props.map(p => <option key={p.id} value={p.id}>{p.buildingName ?? p.name ?? `Property #${p.id}`}</option>)}
                </select>
              </div>
            </Section>

            <Section n={2} title="Category" hint={vendorId && categoryId != null ? `Taken from the vendor — change it here if this contract is different. ${km.hint}` : km.hint}>
              <div className="flex flex-wrap gap-1.5">
                {kindList.filter(k => k.isActive !== false || k.key === kind).map(k => (
                  <button key={k.key} type="button" onClick={() => pickKind(k.key)} title={k.hint}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full border cursor-pointer"
                    style={kind === k.key ? { background: k.fg, color: '#fff', borderColor: k.fg } : { background: '#fff', color: '#5b615e', borderColor: '#e6e8e6' }}>{k.label}</button>
                ))}
              </div>
              <div className="mt-3">
                <span className={lbl}>Sub-category <span className="font-normal text-[#9b9890]">— report grouping</span></span>
                {newCat ? (
                  <div className="flex items-center gap-2">
                    <input autoFocus className={field} placeholder="New sub-category name" value={categoryLabel} onChange={e => setCategoryLabel(e.target.value)} />
                    <button type="button" onClick={() => { setNewCat(false); setCategoryLabel(''); }} className="text-[11px] text-[#9b9890] hover:text-[#1a1916] cursor-pointer whitespace-nowrap">Pick existing</button>
                  </div>
                ) : (
                  <select className={field} value={categoryId ?? ''} onChange={e => {
                    if (e.target.value === '__new') { setNewCat(true); setCategoryId(null); setCategoryLabel(''); return; }
                    const id = e.target.value ? Number(e.target.value) : null; setCategoryId(id);
                    const c = cats.find(x => x.id === id); setCategoryLabel(c?.name ?? '');
                    if (c && kindList.some(k => k.key === c.defaultKind)) pickKind(c.defaultKind);
                  }}>
                    <option value="">— none —</option>
                    {/* The kind picked above narrows the list: its own categories first, the rest under "Other". */}
                    {/* Only this kind's categories (owner, 12 Sep: the full list caused confusion); the one already on the contract stays selectable. */}
                    {cats.filter(c => (c.isActive || c.id === categoryId) && (c.defaultKind === kind || c.id === categoryId)).map(c => <option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (retired)'}</option>)}
                    <option value="__new">+ New sub-category…</option>
                  </select>
                )}
              </div>
            </Section>

            <Section n={3} title="Term & value">
              <div className="grid grid-cols-2 gap-3">
                <div><span className={lbl}>Start date</span><input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                <div><span className={lbl}>End date</span><input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
                <div><span className={lbl}>{km.schedule === 'bills' ? 'Billing cycle' : km.visits ? 'Visit & payment cadence' : 'Payment cadence'}</span>
                  <select className={field} value={frequency} onChange={e => setFrequency(e.target.value)}>
                    <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option><option value="one_time">One-time</option>
                  </select>
                </div>
                <div><span className={lbl}>{kind === 'policy' ? 'Annual premium (AED)' : km.schedule === 'bills' ? 'Annual value (AED, optional)' : 'Annual value (AED)'}</span>
                  <AmountWithVat accent="#2e9f82" placeholder={km.schedule === 'bills' ? 'leave empty for variable bills' : 'e.g. 25200'} amount={annualValue} onAmount={setAnnualValue} mode={vatMode} onMode={setVatMode} vatOverride={annualVat} onVatOverride={setAnnualVat} /></div>
                <div><span className={lbl}>Mode of payment</span>
                  <select className={field} value={modeOfPayment} onChange={e => setModeOfPayment(e.target.value)}>
                    <option value="">—</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="online">Online</option>
                  </select>
                </div>
                {!from && <div><span className={lbl}>Contract type</span>
                  <select className={field} value={contractType} onChange={e => setContractType(e.target.value)}>
                    <option value="new">New</option><option value="renewal">Renewal</option>
                  </select>
                </div>}
              </div>
              {annualValue.trim() !== '' && vatMode !== 'none' && km.schedule !== 'none' && <p className="text-[11px] text-[#9b9890] mt-2">The payment plan shows what you pay — VAT included.</p>}
            </Section>
          </div>

          {/* ── right: the money, the visits, the paperwork ── */}
          <div className="space-y-4 min-w-0">
            <Section n={4} title={km.schedule === 'bills' ? 'Bills' : km.schedule === 'none' ? 'Spend' : 'Payments'}
              hint={km.schedule === 'none' ? 'No schedule — each spend is recorded on the contract page as it happens.' : km.schedule === 'bills' ? `One row per ${frequency === 'monthly' ? 'month' : 'period'}, amount left empty — enter each bill when it arrives.` : 'Tick “already paid” to record the cheque / transfer details and proof now — nothing to re-enter later.'}>
              {km.schedule !== 'none' && <PaymentPlanEditor start={startDate} end={endDate} frequency={frequency} annualValue={annualTotal} rows={payRows} onChange={setPayRows} dirty={payDirty} setDirty={setPayDirty} onCount={setPayCount} proofs modeOfPayment={modeOfPayment} vatInside={vatMode !== 'none'} />}
            </Section>

            {km.visits && (
              <Section n={5} title={`Visits (${plan.length})`} hint="Generated from the cadence — rename, re-date, add or remove."
                action={<button type="button" onClick={regenerate} className="text-[11px] text-[#2e9f82] font-medium cursor-pointer">Regenerate</button>}>
                <div className="border border-[#e8e6e0] rounded-lg divide-y divide-[#f4f3ef] max-h-52 overflow-y-auto">
                  {plan.length === 0 && <p className="text-[11px] text-[#9b9890] px-3 py-3 text-center">Set start &amp; end dates to generate the plan.</p>}
                  {plan.map((r, i) => (
                    <div key={i} className="p-2 flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <div className="flex gap-2">
                          <input className="flex-1 text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.title} onChange={e => editRow(i, { title: e.target.value })} placeholder="Task" />
                          <input type="date" className="text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.dueDate} onChange={e => editRow(i, { dueDate: e.target.value })} />
                        </div>
                        <input className="w-full text-xs px-2 py-1 border border-[#e8e6e0] rounded" value={r.notes} onChange={e => editRow(i, { notes: e.target.value })} placeholder="Note (optional)" />
                      </div>
                      <button type="button" onClick={() => removeRow(i)} className="text-[#c5c3bc] hover:text-[#b91c1c] mt-1"><X size={14} /></button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addRow} className="text-[11px] text-[#2e9f82] font-medium mt-1 flex items-center gap-1"><Plus size={11} /> Add visit</button>
              </Section>
            )}

            <Section n={km.visits ? 6 : 5} title="Paperwork & notes">
              <label className="flex items-center gap-2 text-xs text-[#6b6860] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
                <UploadCloud size={14} className="text-[#2e9f82]" />
                {file ? file.name : kind === 'policy' ? 'Attach the policy document' : kind === 'head_lease' ? 'Attach the lease / tax notice' : 'Attach the contract PDF'}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => {
                  const picked = e.target.files?.[0] ?? null;
                  if (!picked) { setFile(null); return; }
                  // Photos go through the scan modal; a cancelled scan clears
                  // the selection instead of staging the raw shot.
                  void scan(picked).then(f => setFile(f));
                }} />
              </label>
              {scannerModal}
              <textarea className={field + ' mt-2'} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" />
            </Section>
          </div>

          {error && <p className="lg:col-span-2 text-xs text-[#b91c1c] bg-[#fef2f2] rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[#f4f3ef] flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-xs font-medium px-4 py-2 rounded-xl border border-[#e8e6e0] text-[#6b6860]">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-60" style={{ background: '#2e9f82' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {from ? 'Renew contract' : kind === 'service' ? 'Create AMC' : `Create ${km.label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Renew — the focused dialog: everything carries over from the contract being
 * renewed (vendor, property, frequency, payment terms, plan cadence); the
 * landlord confirms only the NEW TERM and the PRICE REVISION.
 */
export function RenewAmcModal({ base, rp, from, onClose, onSaved }: {
  base: string; rp?: number | null; from: AmcContract; onClose: () => void; onSaved: () => void;
}) {
  const oldEnd = from.endDate ?? '';
  const [startDate, setStartDate] = useState(oldEnd);
  const [endDate, setEndDate] = useState(oldEnd ? addYears(oldEnd, 1) : '');
  const [vatMode, setVatMode] = useState<VatMode>(from.vatMode ?? 'none');
  const [annualValue, setAnnualValue] = useState(typedFromStored(from.annualValueAed, from.annualVatAed, from.vatMode ?? 'none'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oldVal = from.annualValueAed ?? null;
  const newVal = annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Number(annualValue) : null;
  // Like for like: both sides VAT-inclusive (oldVal is the stored total).
  const newTotal = newVal != null ? splitVat(newVal, vatMode).total : null;
  const delta = oldVal != null && newTotal != null ? Math.round((newTotal - oldVal) * 100) / 100 : null;

  async function submit() {
    setError(null);
    if (!startDate || !endDate) { setError('Set the new term.'); return; }
    setSaving(true);
    try {
      await apiPost(amcUrl(base, rp, '/contracts'), {
        serviceProviderId: from.vendorId,
        propertyId: from.propertyId,
        contractType: 'renewal',
        renewalOfId: from.id,
        startDate, endDate: endDate || null,
        frequency: from.frequency,
        modeOfPayment: from.modeOfPayment,
        numberOfPayments: from.numberOfPayments,
        annualValueAed: newVal, vatMode,
      });
      onSaved();
    } catch (e) { setError((e as Error)?.message || 'Could not renew the contract.'); }
    finally { setSaving(false); }
  }

  const field = 'w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]';
  const lbl = 'text-xs font-medium text-[#6b6860] mb-1 block';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f4f3ef]">
          <h2 className="text-sm font-bold text-[#1a1916]">Renew — {from.vendorName}</h2>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="rounded-xl border border-[#f0eee8] bg-[#fafaf8] px-3.5 py-2.5 text-[12px] text-[#6b6860]">
            Carries over unchanged: <b className="text-[#1a1916]">{from.propertyName ?? 'All properties'}</b>
            {from.frequency ? <> · {from.frequency}</> : null}
            {from.modeOfPayment ? <> · {from.modeOfPayment.replace(/_/g, ' ')}</> : null}
            {from.numberOfPayments ? <> · {from.numberOfPayments} payments</> : null}
            <span className="block mt-0.5">Old term {fmt(from.startDate)} – {fmt(from.endDate)} · the maintenance plan regenerates for the new term.</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><span className={lbl}>New start</span><input type="date" className={field} value={startDate} onChange={e => { setStartDate(e.target.value); if (e.target.value) setEndDate(addYears(e.target.value, 1)); }} /></div>
            <div><span className={lbl}>New end</span><input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
          </div>
          <div>
            <span className={lbl}>Annual value (AED) — pricing revision</span>
            <AmountWithVat accent="#2e9f82" placeholder={oldVal != null ? String(oldVal) : 'e.g. 25200'} amount={annualValue} onAmount={setAnnualValue} mode={vatMode} onMode={setVatMode} />
            {delta != null && delta !== 0 && (
              <p className={`text-[11.5px] font-semibold mt-1 ${delta > 0 ? 'text-[#b45309]' : 'text-[#15803d]'}`}>
                {delta > 0 ? '▲' : '▼'} AED {Math.abs(delta).toLocaleString('en-AE')} ({Math.round(Math.abs(delta) / (oldVal || 1) * 100)}%) vs last term
              </p>
            )}
            {delta === 0 && oldVal != null && <p className="text-[11.5px] text-[#6b6860] mt-1">Same price as last term.</p>}
          </div>
          {error && <p className="text-xs text-[#b91c1c]">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#f4f3ef]">
          <button onClick={onClose} className="text-xs font-semibold px-3.5 py-2 rounded-xl border border-[#e8e6e0] text-[#6b6860]">Cancel</button>
          <button onClick={() => void submit()} disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50" style={{ background: '#2e9f82' }}>
            {saving ? 'Renewing…' : 'Renew contract'}
          </button>
        </div>
      </div>
    </div>
  );
}
