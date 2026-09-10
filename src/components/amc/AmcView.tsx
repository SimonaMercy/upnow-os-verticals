'use client';
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
import { apiGet, apiPost } from '@/lib/api';
import { useDocumentScanner } from '@/components/upnow/DocumentScanModal';


type Status = 'active' | 'expiring' | 'expired' | 'unknown';
interface AmcDoc { id: number; documentKey: string; displayName: string | null; fileUrl: string; status: string }
export interface AmcContract {
  id: number; vendorId: number; vendorName: string; serviceCategory: string | null;
  isGovernment: boolean; contractType: string | null; frequency: string | null;
  modeOfPayment: string | null; numberOfPayments: number | null;
  startDate: string | null; endDate: string | null; status: Status;
  propertyId: number | null; propertyName: string | null; notes: string | null;
  renewalOfId: number | null; renewedById: number | null; annualValueAed?: number | null;
  documents: AmcDoc[]; tasks: { total: number; done: number; pending: number; overdue?: number };
}
interface PropertyOpt { id: number; buildingName?: string | null; name?: string | null; rentalProviderId?: number }
interface VendorOpt { id: number; name: string; serviceCategory: string | null }
interface PlanRow { title: string; dueDate: string; notes: string }

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  active:   { bg: '#e7f4ee', fg: '#1a7a52', label: 'Active' },
  expiring: { bg: '#fdf3e3', fg: '#c47a00', label: 'Expiring soon' },
  expired:  { bg: '#fdecea', fg: '#b42318', label: 'Expired' },
  unknown:  { bg: '#f1f3f1', fg: '#5b615e', label: 'No expiry' },
};
const cap = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annually: 12 };
const addMonths = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const addYears = (iso: string, n: number) => addMonths(iso, n * 12);
export interface PayRow { id?: number | null; dueDate: string; amountAed: string; status?: string; reference?: string | null }
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
export function PaymentPlanEditor({ start, end, frequency, annualValue, rows, onChange, dirty, setDirty, onCount }: {
  start: string; end: string; frequency: string; annualValue: string;
  rows: PayRow[]; onChange: (rows: PayRow[]) => void; dirty: boolean; setDirty: (d: boolean) => void;
  /** The split the user CHOSE (null = follow the frequency). The owner keeps it so
   *  re-splitting on a value/date change honours it instead of snapping back. */
  onCount?: (n: number | null) => void;
}) {
  const def = defaultPayCount(frequency, start, end);
  const count = rows.length || def;
  const presets = Array.from(new Set([def, ...PAY_PRESETS])).sort((a, b) => a - b);
  const total = rows.reduce((n, r) => n + (Number(r.amountAed) || 0), 0);
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
              <div key={r.id ?? `n${i}`} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="text-[11px] text-[#9b9890] w-6 shrink-0">#{i + 1}</span>
                <input type="date" className={field + ' w-[150px]'} value={r.dueDate} disabled={locked} onChange={e => setRow(i, { dueDate: e.target.value })} />
                <input type="number" min="0" step="0.01" placeholder="AED" className={field + ' w-[110px]'} value={r.amountAed} disabled={locked} onChange={e => setRow(i, { amountAed: e.target.value })} />
                {locked
                  ? <span className="text-[10.5px] font-bold text-[#1a7a52] ml-auto">paid{r.reference ? ` · ${r.reference}` : ''}</span>
                  : <button type="button" onClick={() => { setDirty(true); onChange(rows.filter((_, j) => j !== i)); }} className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer ml-auto" aria-label="Remove installment"><X size={13} /></button>}
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <p className={`text-[11px] mt-1 ${expected != null && Math.abs(total - expected) > 0.5 ? 'text-[#b45309]' : 'text-[#9b9890]'}`}>
          {rows.length} installment{rows.length === 1 ? '' : 's'} · total AED {total.toLocaleString('en-AE')}{expected != null ? ` · contract value for the term AED ${expected.toLocaleString('en-AE')}${Math.abs(total - expected) > 0.5 ? ' — does not match' : ''}` : ''}
        </p>
      )}
    </div>
  );
}

const amcUrl = (base: string, rp: number | null | undefined, path: string) =>
  rp != null ? `${base}${path}${path.includes('?') ? '&' : '?'}rp=${rp}` : `${base}${path}`;

function buildPlan(start: string, end: string, frequency: string, category: string): PlanRow[] {
  if (!start || !end) return [];
  const cat = (category || 'maintenance').replace(/_/g, ' ');
  const months = FREQ_MONTHS[frequency];
  if (!months) return [{ title: `${cat} service`, dueDate: start, notes: '' }];
  const rows: PlanRow[] = []; let due = start, i = 0;
  while (due <= end && i < 60) { rows.push({ title: `${cat} maintenance`, dueDate: due, notes: '' }); due = addMonths(due, months); i++; }
  return rows;
}

export function AmcView({ base, rp, propertiesUrl, vendorsHref }: { base: string; rp?: number | null; propertiesUrl: string; vendorsHref?: string }) {
  const [tab, setTab] = useState<'active' | 'expired'>('active');
  const [view, setView] = useState<'rows' | 'grid'>('rows');
  const [contracts, setContracts] = useState<AmcContract[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [renewFrom, setRenewFrom] = useState<AmcContract | null>(null);
  const [q, setQ] = useState('');
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
    unknown: contracts?.filter(c => c.status === 'unknown').length ?? 0,
    overdue: contracts?.filter(c => c.status !== 'expired').reduce((n, c) => n + (c.tasks.overdue ?? 0), 0) ?? 0,
  };
  // Like the Leases register: running contracts up front (expiring soon stays
  // here — it is still in force), the expired history on its own tab.
  const needle = q.trim().toLowerCase();
  const shown = (contracts ?? [])
    .filter(c => tab === 'expired' ? c.status === 'expired' : c.status !== 'expired')
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
  const subline = (c: AmcContract) => `AMC-${c.id} · ${c.propertyName ?? 'All properties'}${c.frequency ? ` · ${cap(c.frequency)}` : ''}`;
  const chip = (c: AmcContract) => { const ss = STATUS_STYLE[c.status]; return <span className={pillCls} style={{ background: ss.bg, color: ss.fg }}>{ss.label}</span>; };
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
            {vendorsHref
              ? <>Vendor records live on the <a href={vendorsHref} className="text-[#1a7a52] hover:text-[#125a3c] underline">Vendors page</a>.</>
              : 'Vendor records live on the Vendors page.'}
          </p>
        </div>
        <button onClick={() => { setRenewFrom(null); setShowAdd(true); }}
          className="text-[12px] font-semibold px-3.5 py-[9px] rounded-lg border border-[#1a7a52] bg-[#1a7a52] text-white hover:bg-[#156643] whitespace-nowrap cursor-pointer">+ Add AMC</button>
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
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendor or property…"
            className="pl-8 pr-3 py-2 border border-[#e6e8e6] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#1a7a52] w-full" />
        </label>
        <div className="flex gap-1.5 ml-auto">
          {([['active', `Active · ${kpi.active + kpi.expiring + kpi.unknown}`], ['expired', `Expired · ${kpi.expired}`]] as const).map(([key, label]) => (
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
        <div className="mt-3.5"><Empty icon={Wrench} msg={tab === 'expired' ? 'No expired contracts — history lands here when a contract runs out.' : 'No running AMC contracts yet.'} /></div>
      ) : view === 'rows' ? (
        <div className="bg-white border border-[#e6e8e6] rounded-[14px] mt-3.5 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,1fr)_150px] gap-3 items-center px-[18px] py-2.5 text-[10px] font-bold tracking-[.08em] text-[#8a8f8c] border-b border-[#eef0ee]">
                <span>VENDOR</span><span>PERIOD</span><span>VALUE / YR</span><span>VISITS</span><span />
              </div>
              {shown.map(c => {
                const flag = visitsFlag(c); const href = detailHrefOf(c);
                return (
                  <div key={c.id} onClick={() => router.push(href)}
                    className="grid grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)_minmax(0,.6fr)_minmax(0,1fr)_150px] gap-3 items-center px-[18px] py-3.5 text-[12.5px] border-b border-[#f1f3f1] last:border-0 cursor-pointer hover:bg-[#fafbfa]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{c.vendorName}</span>
                        {chip(c)}
                        {c.renewalOfId != null && <span className={pillCls + ' font-semibold'} style={{ background: '#e9effc', color: '#2a5bd7' }}>Renewal</span>}
                      </div>
                      <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">{subline(c)}</div>
                    </div>
                    <div className="whitespace-nowrap">{fmt(c.startDate)} → {fmt(c.endDate)}</div>
                    <div className="font-semibold whitespace-nowrap">{money(c.annualValueAed)}</div>
                    <div className="flex justify-between gap-2 text-[12px]">
                      <span>{c.tasks.done} / {c.tasks.total} completed</span>
                      <span className="font-bold whitespace-nowrap" style={{ color: flag.color }}>{flag.text}</span>
                    </div>
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {renewable(c) && (
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
            const flag = visitsFlag(c); const href = detailHrefOf(c);
            return (
              <Link key={c.id} href={href} className="no-underline text-inherit bg-white border border-[#e6e8e6] rounded-[14px] px-[18px] py-4 flex flex-col gap-3 hover:border-[#c9cfcb]">
                <div className="flex items-start justify-between gap-2.5">
                  <div className="min-w-0">
                    <div className="font-bold text-[13px] truncate">{c.vendorName}</div>
                    <div className="text-[11px] text-[#8a8f8c] mt-0.5 truncate">{subline(c)}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">{chip(c)}{c.renewalOfId != null && <span className={pillCls + ' font-semibold'} style={{ background: '#e9effc', color: '#2a5bd7' }}>Renewal</span>}</div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 text-[12px]">
                  <div><div className="text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]">PERIOD</div><div className="mt-0.5">{fmt(c.startDate)} → {fmt(c.endDate)}</div></div>
                  <div><div className="text-[10px] font-bold tracking-[.08em] text-[#8a8f8c]">VALUE / YR</div><div className="mt-0.5 font-semibold">{money(c.annualValueAed)}</div></div>
                </div>
                <div className="flex justify-between items-center text-[12px]">
                  <span>{c.tasks.done} / {c.tasks.total} completed</span>
                  <span className="flex items-center gap-2">
                    {renewable(c) && <button type="button" onClick={e => { e.preventDefault(); setRenewFrom(c); setShowAdd(true); }} className="text-[11px] font-bold px-2.5 py-0.5 rounded-md border border-[#1a7a52] bg-white text-[#1a7a52] hover:bg-[#e7f4ee] cursor-pointer">Renew</button>}
                    <span className="font-bold" style={{ color: flag.color }}>{flag.text}</span>
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
  const [startDate, setStartDate] = useState(nextStart);
  const [endDate, setEndDate] = useState(nextStart ? addYears(nextStart, 1) : '');
  const [frequency, setFrequency] = useState(from?.frequency ?? 'annually');
  const [modeOfPayment, setModeOfPayment] = useState(from?.modeOfPayment ?? '');
  const [payRows, setPayRows] = useState<PayRow[]>([]);
  const [payDirty, setPayDirty] = useState(false);
  // The split the landlord picked in the dropdown; null = one per frequency period.
  const [payCount, setPayCount] = useState<number | null>(from?.numberOfPayments ?? null);
  const [annualValue, setAnnualValue] = useState(from?.annualValueAed != null ? String(from.annualValueAed) : '');
  const [notes, setNotes] = useState(from?.notes ?? '');
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [category, setCategory] = useState(from?.serviceCategory ?? 'maintenance');
  const [file, setFile] = useState<File | null>(null);
  // Payment proofs at creation — one or many, each with its own reference.
  const [payProofs, setPayProofs] = useState<{ file: File; ref: string }[]>([]);
  // Camera captures pass through the scan modal (auto-crop + clean-up) first.
  const { scan, scannerModal } = useDocumentScanner();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renewalOfId: number | null = from ? from.id : null;


  useEffect(() => {
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
  }

  useEffect(() => { if (!planDirty) setPlan(buildPlan(startDate, endDate, frequency, category)); }, [startDate, endDate, frequency, category, planDirty]);
  // The payment plan follows the terms until the user edits a row (then it is theirs).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!payDirty) setPayRows(buildPayRows(startDate, endDate, payCount ?? defaultPayCount(frequency, startDate, endDate), annualValue)); }, [startDate, endDate, frequency, annualValue, payDirty, payCount]);

  const editRow = (i: number, patch: Partial<PlanRow>) => { setPlanDirty(true); setPlan(p => p.map((r, j) => j === i ? { ...r, ...patch } : r)); };
  const removeRow = (i: number) => { setPlanDirty(true); setPlan(p => p.filter((_, j) => j !== i)); };
  const addRow = () => { setPlanDirty(true); setPlan(p => [...p, { title: `${category.replace(/_/g, ' ')} visit`, dueDate: endDate || startDate || '', notes: '' }]); };
  const regenerate = () => { setPlanDirty(false); setPlan(buildPlan(startDate, endDate, frequency, category)); };

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
        contractType, startDate, endDate: endDate || null, frequency,
        renewalOfId: contractType === 'renewal' ? renewalOfId : null,
        annualValueAed: annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Number(annualValue) : null,
        modeOfPayment: modeOfPayment || null,
        numberOfPayments: payRows.length || null,
        installments: payRows.filter(r => r.dueDate).map(r => ({ dueDate: r.dueDate, amountAed: Number(r.amountAed) || 0 })),
        notes: notes.trim() || null,
        tasks: plan.filter(r => r.title.trim()).map(r => ({ title: r.title.trim(), dueDate: r.dueDate || null, notes: r.notes.trim() || null })),
      });
      if (file) await uploadContractPdf(contract.id, file);
      for (let i = 0; i < payProofs.length; i++) {
        const pp = payProofs[i];
        await uploadContractDoc(contract.id, pp.file,
          i === 0 ? 'sp_payment_proof' : `sp_payment_proof_${i + 1}`,
          'payment', pp.ref.trim() ? `Proof of Payment · ${pp.ref.trim()}` : 'Proof of Payment');
      }
      onSaved();
    } catch (e) { setError((e as Error)?.message || 'Could not create the AMC.'); }
    finally { setSaving(false); }
  }

  async function uploadContractPdf(contractId: number, f: File) {
    await uploadContractDoc(contractId, f, 'sp_contract', 'contract', 'Contract Attachment');
  }

  async function uploadContractDoc(contractId: number, f: File, documentKey: string, category: string, displayName: string) {
    const urlRes = await fetch('/api/documents/upload-url', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey, originalName: f.name, mimeType: f.type }),
    });
    if (!urlRes.ok) return;
    const { uploadUrl, fileUrl, fileKey } = await urlRes.json();
    const target = (() => { try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; } catch { return uploadUrl; } })();
    await fetch(target, { method: 'PUT', body: f, headers: { 'Content-Type': f.type } });
    await fetch('/api/documents', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType: 'service_provider_contract', ownerId: contractId, documentKey, category, displayName, fileUrl, mimeType: f.type, s3Key: fileKey }),
    });
  }

  const field = 'w-full text-sm px-3 py-2 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]';
  const lbl = 'text-xs font-medium text-[#6b6860] mb-1 block';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f4f3ef] sticky top-0 bg-white">
          <h2 className="text-sm font-bold text-[#1a1916]">{from ? `Renew AMC-${from.id} — ${from.vendorName}` : 'Add AMC contract'}</h2>
          <button onClick={onClose} className="text-[#9b9890] hover:text-[#1a1916]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <span className={lbl}>Vendor</span>
            <select className={field} value={vendorId} onChange={e => onPickVendor(e.target.value)} disabled={!!from}>
              <option value="">Select a vendor…</option>
              {from && !allVendors.some(v => v.id === from.vendorId) && <option value={from.vendorId}>{from.vendorName}</option>}
              {allVendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.serviceCategory ? ` · ${v.serviceCategory.replace(/_/g,' ')}` : ''}</option>)}
            </select>
            {from
              ? <p className="text-[11px] text-[#2e9f82] mt-1">Everything from AMC-{from.id} ({fmt(from.startDate)} – {fmt(from.endDate)}) is prefilled for the next term — change the dates, price, payment terms or the visits below, then save. The old contract stays on record.</p>
              : vendorId && contractType === 'renewal' && <p className="text-[11px] text-[#2e9f82] mt-1">Prefilled as a renewal for next year — adjust as needed.</p>}
            {!from && <p className="text-[11px] text-[#9b9890] mt-1">Missing a vendor? Record it on the <a href="/rental-provider/dashboard/vendors" className="text-[#1a7a5a] font-semibold underline">Vendors page</a> first — contracts attach to vendors, never the other way.</p>}
          </div>

          <div><span className={lbl}>Property (optional)</span>
            <select className={field} value={propertyId} onChange={e => setPropertyId(e.target.value)}>
              <option value="">— none —</option>
              {props.map(p => <option key={p.id} value={p.id}>{p.buildingName ?? p.name ?? `Property #${p.id}`}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Start date</span><input type="date" className={field} value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
            <div><span className={lbl}>End date (expiry)</span><input type="date" className={field} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            <div><span className={lbl}>Frequency</span>
              <select className={field} value={frequency} onChange={e => setFrequency(e.target.value)}>
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option><option value="one_time">One-time</option>
              </select>
            </div>
            <div><span className={lbl}>Contract type</span>
              <select className={field} value={contractType} onChange={e => setContractType(e.target.value)}>
                <option value="new">New</option><option value="renewal">Renewal</option>
              </select>
            </div>
            <div><span className={lbl}>Mode of payment</span>
              <select className={field} value={modeOfPayment} onChange={e => setModeOfPayment(e.target.value)}>
                <option value="">—</option><option value="cheque">Cheque</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option>
              </select>
            </div>
            <div><span className={lbl}>Annual value (AED)</span><input type="number" min="0" step="0.01" className={field} placeholder="e.g. 25200" value={annualValue} onChange={e => setAnnualValue(e.target.value)} /></div>
          </div>

          <PaymentPlanEditor start={startDate} end={endDate} frequency={frequency} annualValue={annualValue} rows={payRows} onChange={setPayRows} dirty={payDirty} setDirty={setPayDirty} onCount={setPayCount} />

          <div><span className={lbl}>Contract PDF (optional)</span>
            <label className="flex items-center gap-2 text-xs text-[#6b6860] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
              <UploadCloud size={14} className="text-[#2e9f82]" />
              {file ? file.name : 'Attach contract PDF'}
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => {
                const picked = e.target.files?.[0] ?? null;
                if (!picked) { setFile(null); return; }
                // Photos go through the scan modal; a cancelled scan clears
                // the selection instead of staging the raw shot.
                void scan(picked).then(f => setFile(f));
              }} />
            </label>
            {scannerModal}
          </div>

          <div><span className={lbl}>Payment proofs (optional — one or many)</span>
            {payProofs.map((pp, i) => (
              <div key={i} className="flex items-center gap-2 mb-1.5">
                <span className="text-xs text-[#1a1916] truncate max-w-[180px]">{pp.file.name}</span>
                <input value={pp.ref} placeholder="Reference — cheque / transfer no."
                  onChange={e => setPayProofs(prev => prev.map((x, j) => j === i ? { ...x, ref: e.target.value } : x))}
                  className="flex-1 text-xs px-2.5 py-1.5 border border-[#e8e6e0] rounded-lg bg-white focus:outline-none focus:border-[#2e9f82]" />
                <button type="button" onClick={() => setPayProofs(prev => prev.filter((_, j) => j !== i))}
                  className="text-[#9b9890] hover:text-[#b91c1c] cursor-pointer"><X size={14} /></button>
              </div>
            ))}
            <label className="flex items-center gap-2 text-xs text-[#6b6860] border border-dashed border-[#d8d6d0] rounded-lg px-3 py-2.5 cursor-pointer hover:bg-[#f9f8f6]">
              <UploadCloud size={14} className="text-[#2e9f82]" />
              {payProofs.length ? 'Add another payment proof' : 'Attach payment proof(s) — cheque copy, transfer receipt'}
              <input type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) setPayProofs(prev => [...prev, ...fs.map(f => ({ file: f, ref: '' }))]); e.target.value = ''; }} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className={lbl}>Maintenance plan ({plan.length})</span>
              <button type="button" onClick={regenerate} className="text-[11px] text-[#2e9f82] font-medium">Regenerate from frequency</button>
            </div>
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
            <button type="button" onClick={addRow} className="text-[11px] text-[#2e9f82] font-medium mt-1 flex items-center gap-1"><Plus size={11} /> Add task</button>
          </div>

          <div><span className={lbl}>Notes (optional)</span>
            <textarea className={field} rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this AMC…" />
          </div>

          {error && <p className="text-xs text-[#b91c1c] bg-[#fef2f2] rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[#f4f3ef] flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="text-xs font-medium px-4 py-2 rounded-xl border border-[#e8e6e0] text-[#6b6860]">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-60" style={{ background: '#2e9f82' }}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} {from ? 'Renew contract' : 'Create AMC'}
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
  const [annualValue, setAnnualValue] = useState(from.annualValueAed != null ? String(from.annualValueAed) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oldVal = from.annualValueAed ?? null;
  const newVal = annualValue.trim() !== '' && !Number.isNaN(Number(annualValue)) ? Number(annualValue) : null;
  const delta = oldVal != null && newVal != null ? newVal - oldVal : null;

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
        annualValueAed: newVal,
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
            <input type="number" min="0" step="0.01" className={field} placeholder={oldVal != null ? String(oldVal) : 'e.g. 25200'} value={annualValue} onChange={e => setAnnualValue(e.target.value)} />
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
