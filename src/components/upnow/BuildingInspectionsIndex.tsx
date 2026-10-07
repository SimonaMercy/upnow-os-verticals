'use client';

/**
 * Building inspections — the visits worklist (0383). Same layout as the
 * Maintenance section: title + button, 4 tiles, one filter row, compact table.
 * Landlord (no `manager`) or manager (`manager={{ rp }}`, canManageInspections).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Camera, Loader2, Search, Settings } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { biUrl, fmtDate, settingsHref, STATUS_CHIP, STATUS_LABEL, Summary, visitHref, VisitRow } from '@/lib/buildingInspections';

type Bucket = 'open' | 'submitted' | 'approved' | 'returned' | 'all';
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'open', label: 'To do' }, { key: 'submitted', label: 'Awaiting review' }, { key: 'returned', label: 'Returned' }, { key: 'approved', label: 'Approved' }, { key: 'all', label: 'All' },
];

export function BuildingInspectionsIndex({ manager }: { manager?: { rp: number } }) {
  const rp = manager?.rp ?? null;
  const router = useRouter();
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [bucket, setBucket] = useState<Bucket>('open');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Promise chains, not awaits: nothing sets state synchronously inside the effect.
  const load = useCallback(() => Promise.all([
    apiGet<VisitRow[]>(biUrl(`/visits?status=${bucket}${mine ? '&mine=1' : ''}`, rp)),
    apiGet<Summary>(biUrl('/summary', rp)),
  ]).then(([v, s]) => { setRows(v); setSummary(s); setError(null); })
    .catch((e: Error) => setError(e.message || 'Could not load building inspections.'))
    .finally(() => setLoading(false)), [bucket, mine, rp]);
  useEffect(() => { void load(); }, [load]);
  const pickBucket = (b: Bucket) => { setLoading(true); setBucket(b); };
  const pickMine = (on: boolean) => { setLoading(true); setMine(on); };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.propertyName.toLowerCase().includes(s) || r.periodLabel.toLowerCase().includes(s) || (r.inspectorName ?? '').toLowerCase().includes(s)) : rows;
  }, [rows, q]);

  const approvedYear = rows.filter((r) => r.status === 'approved').length;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1916]">Building inspections</h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Each building&rsquo;s monthly or quarterly walk-through — checked, photographed, submitted, reviewed.</p>
        </div>
        <Link href={settingsHref(rp)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e8e6e0] bg-white text-[#4a4842] text-[12.5px] font-semibold px-3 py-2 hover:border-[#c8c6be] shrink-0">
          <Settings size={14} /> Checklists & schedule
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'To do', value: summary?.open ?? '—', tone: '' },
          { label: 'Overdue', value: summary?.overdue ?? '—', tone: (summary?.overdue ?? 0) > 0 ? 'text-[#b91c1c]' : '' },
          { label: 'Awaiting review', value: summary?.awaitingReview ?? '—', tone: (summary?.awaitingReview ?? 0) > 0 ? 'text-[#92400e]' : '' },
          { label: bucket === 'all' || bucket === 'approved' ? 'Approved (shown)' : 'Shown', value: bucket === 'all' || bucket === 'approved' ? approvedYear : shown.length, tone: '' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-[#e8e6e0] bg-white px-4 py-3">
            <div className="text-[10.5px] uppercase tracking-wide text-[#9b9890] font-semibold">{t.label}</div>
            <div className={`text-xl font-bold tabular-nums text-[#1a1916] ${t.tone}`}>{t.value}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-[10px] text-[#9b9890]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Building, period, inspector" className="pl-8 pr-3 py-2 w-[240px] border border-[#e8e6e0] rounded-lg text-[12px] bg-white focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {BUCKETS.map((b) => (
            <button key={b.key} type="button" onClick={() => pickBucket(b.key)} aria-pressed={bucket === b.key}
              className="text-[11.5px] font-semibold px-3 py-1.5 rounded-full border border-[#e8e6e0]"
              style={bucket === b.key ? { background: '#1c1f1d', color: '#fff', borderColor: '#1c1f1d' } : { background: '#fff', color: '#4a4842' }}>
              {b.label}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-[#4a4842] cursor-pointer">
          <input type="checkbox" checked={mine} onChange={(e) => pickMine(e.target.checked)} /> Assigned to me
        </label>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="rounded-2xl border border-[#e8e6e0] bg-white overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1.6fr_1fr_1fr_1.2fr_1fr_0.7fr_1.1fr] gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold bg-[#fafaf8] border-b border-[#f4f3ef]">
          <span>Building</span><span>Period</span><span>Due</span><span>Inspector</span><span>Progress</span><span>Issues</span><span>Status</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[#9b9890]"><Loader2 className="animate-spin mr-2" /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[#1a1916]">Nothing here</p>
            <p className="text-[12.5px] text-[#6b6860] mt-1">
              {bucket === 'open' ? <>No visit is open. Set a frequency per building under <Link href={settingsHref(rp)} className="text-[#1a7a5a] font-semibold hover:underline">Checklists &amp; schedule</Link> and the month&rsquo;s visit opens on its own.</> : 'No visit matches this filter.'}
            </p>
          </div>
        ) : shown.map((r) => {
          const chip = r.overdue ? STATUS_CHIP.overdue : STATUS_CHIP[r.status];
          const pct = r.itemsTotal ? Math.round((r.itemsAnswered / r.itemsTotal) * 100) : 0;
          return (
            <button key={r.id} type="button" onClick={() => router.push(visitHref(r.id, rp))}
              className="w-full text-left grid grid-cols-1 sm:grid-cols-[1.6fr_1fr_1fr_1.2fr_1fr_0.7fr_1.1fr] gap-1 sm:gap-2 px-4 py-3 border-b border-[#f4f3ef] last:border-0 hover:bg-[#fafaf8] cursor-pointer">
              <span className="font-semibold text-[#1a1916] text-[13px]">{r.propertyName}<span className="sm:hidden text-[#9b9890] font-normal"> · {r.periodLabel}</span></span>
              <span className="hidden sm:block text-[12.5px] text-[#4a4842]">{r.periodLabel}<span className="text-[#9b9890]"> · {r.frequency}</span></span>
              <span className="text-[12.5px] text-[#4a4842]"><span className="sm:hidden text-[#9b9890]">Due </span>{fmtDate(r.dueDate)}</span>
              <span className="text-[12.5px] text-[#4a4842] truncate">{r.inspectorName ?? <span className="text-[#9b9890]">Not assigned</span>}{r.isMine && <span className="ml-1 text-[10px] font-semibold text-[#2e6f5e]">you</span>}</span>
              <span className="text-[12px] text-[#4a4842] flex items-center gap-2">
                <span className="h-1.5 w-16 rounded-full bg-[#f0eee8] overflow-hidden"><span className="block h-full bg-[#2e9f82]" style={{ width: `${pct}%` }} /></span>
                <span className="tabular-nums">{r.itemsAnswered}/{r.itemsTotal}</span>
                {r.photoCount > 0 && <span className="inline-flex items-center gap-0.5 text-[#9b9890]"><Camera size={11} />{r.photoCount}</span>}
              </span>
              <span className="text-[12.5px] tabular-nums">{r.issuesCount > 0 ? <span className="inline-flex items-center gap-1 text-[#b91c1c] font-semibold"><AlertTriangle size={12} />{r.issuesCount}</span> : <span className="text-[#9b9890]">0</span>}</span>
              <span><span className="text-[10.5px] font-semibold px-2 py-[2px] rounded-full" style={{ background: chip.bg, color: chip.fg }}>{r.overdue ? `Overdue · ${STATUS_LABEL[r.status]}` : STATUS_LABEL[r.status]}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
