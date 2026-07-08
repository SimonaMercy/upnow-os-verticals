'use client';

/**
 * Full-page activity profile for one team member — opened from a Manager
 * Performance row (replaces the page, not a modal). Executive-clean:
 * tiles → personal timeline → the play-by-play, filterable by kind and
 * searchable, grouped by day. Explanations live behind ⓘ.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Search, ExternalLink, Info } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const JADE = '#2e9f82';
const BLUE = '#1e5fae';
const GRID = '#f0ede8';
const TICK = { fontSize: 11, fill: '#9b9890' } as const;

export interface MemberActivityItem {
  at: string;
  kind: string;
  action: string;
  detail: string;
  ip: string | null;
  contractId?: number;
}

export interface MemberRow {
  userId: number;
  name: string;
  role: string;
  leadsWorked: number;
  leadsConverted: number;
  contractsWorked: number;
  renewalsWorked: number;
  documentsWorked: number;
  created: number;
  updated: number;
  deleted: number;
  pagesViewed: number;
  reportsViewed: number;
  activeDays: number;
  lastActiveAt: string | null;
}

interface PageVisit { page: string; label: string; count: number; lastAt: string }
interface FeedPage {
  items: MemberActivityItem[];
  counts: { all: number; created: number; updated: number; deleted: number; other: number };
  nextOffset: number | null;
  pages?: PageVisit[];
}

const KIND_STYLE: Record<string, string> = {
  created: 'bg-[#e6f5ee] text-[#1f6f54]',
  updated: 'bg-[#eaf2fb] text-[#1e5fae]',
  deleted: 'bg-[#fdeee4] text-[#b45309]',
  other: 'bg-[#f4f3ef] text-[#6b6860]',
};

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-[#9b9890] font-semibold flex items-center gap-1">
        {label}
        {hint && (
          <span className="relative inline-flex print:hidden normal-case tracking-normal">
            <button type="button" aria-label={`About ${label}`} onClick={() => setOpen(o => !o)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              className="text-[#c8c6c0] hover:text-[#2e9f82]"><Info size={11} /></button>
            {open && (
              <span className="absolute z-40 top-full mt-1.5 left-0 w-60 bg-white border border-[#e3e0d9] rounded-xl p-2.5 text-[11px] font-normal leading-relaxed text-[#4a4742] whitespace-normal"
                style={{ boxShadow: '0 12px 32px rgba(20,18,15,.16)' }}>{hint}</span>
            )}
          </span>
        )}
      </p>
      <p className="text-base font-bold text-[#1a1916] mt-1">{value}</p>
    </div>
  );
}

export function MemberActivityView({ member, daily, dailyPages, contractsBase, feedEndpoint, from, to, onBack }: {
  member: MemberRow;
  daily: Array<Record<string, string | number>>;
  dailyPages: Array<Record<string, string | number>>;
  contractsBase: string;
  /** Base of the paginated feed endpoint (portal-specific). */
  feedEndpoint: string;
  from: string | null;
  to: string | null;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Paginated feed — the report carries counts only; pages load on demand so
  // the payload stays small however large the activity trail grows.
  const [items, setItems] = useState<MemberActivityItem[]>([]);
  const [counts, setCounts] = useState<FeedPage['counts'] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [pages, setPages] = useState<PageVisit[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  const fetchPage = async (offset: number, selectedKind: string | null, replace: boolean) => {
    setFeedLoading(true);
    try {
      const qs = new URLSearchParams({ userId: String(member.userId), offset: String(offset), limit: '50' });
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (selectedKind) qs.set('kind', selectedKind);
      const res = await fetch(`${feedEndpoint}?${qs}`, { credentials: 'include' });
      if (!res.ok) return;
      const page = await res.json() as FeedPage;
      setItems(prev => replace ? page.items : [...prev, ...page.items]);
      setCounts(page.counts);
      setNextOffset(page.nextOffset);
      if (page.pages) setPages(page.pages);
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    void fetchPage(0, kind, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.userId, kind, from, to]);

  // Personal timeline: this member's actions + pages per day on one axis
  // (both are events/day). Colors: work = jade, presence = blue.
  const series = useMemo(() => daily.map((d, i) => ({
    date: d.date,
    Actions: Number(d[member.name]) || 0,
    Pages: Number(dailyPages[i]?.[member.name]) || 0,
  })), [daily, dailyPages, member.name]);
  const hasSeries = series.some(s => s.Actions > 0 || s.Pages > 0);

  const kinds = useMemo(() => {
    if (!counts) return [] as Array<[string, number]>;
    return (['updated', 'created', 'deleted', 'other'] as const)
      .map(k => [k, counts[k]] as [string, number])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [counts]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(it => !needle || `${it.action} ${it.detail}`.toLowerCase().includes(needle));
  }, [items, search]);

  // Group by day — "7 Jul 2026, 14:32" → "7 Jul 2026"
  const byDay = useMemo(() => {
    const groups: Array<{ day: string; items: MemberActivityItem[] }> = [];
    for (const it of filtered) {
      const day = it.at.split(',')[0];
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(it);
      else groups.push({ day, items: [it] });
    }
    return groups;
  }, [filtered]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5 print:hidden">
        <div>
          <button type="button" onClick={onBack}
            className="text-[#6b6860] hover:text-[#1a1916] inline-flex items-center gap-1.5 text-xs mb-2">
            <ArrowLeft size={12} /> Manager Performance
          </button>
          <h1 className="text-2xl font-bold text-[#1a1916] flex items-center gap-2.5">
            {member.name}
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#f4f3ef] text-[#6b6860] capitalize">{member.role}</span>
          </h1>
          <p className="text-sm text-[#6b6860] mt-0.5">Everything they did in the selected period, day by day.</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-white"
          style={{ background: JADE }}>
          <Printer size={14} /> Print / PDF
        </button>
      </div>
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold">{member.name} — activity</h1>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <Tile label="Leads attended" value={member.leadsWorked} hint="Leads this person worked on in the period." />
        <Tile label="Converted" value={member.leadsConverted} hint="Leads they moved all the way to a signed-up customer." />
        <Tile label="Contracts worked" value={member.contractsWorked} hint="Leases they progressed — edits, renewals, Ejari, payments, terminations." />
        <Tile label="Renewals" value={member.renewalsWorked} hint="Leases where they ran renewal steps." />
        <Tile label="Documents" value={member.documentsWorked} hint="Documents they processed — uploads, verifications, rejections." />
        <Tile label="Days active" value={member.activeDays} hint="Days with at least one action or page visit." />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mb-5">
        {/* Personal timeline */}
        {hasSeries && (
          <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
            <p className="text-sm font-bold text-[#1a1916] mb-2">Their rhythm</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={series} margin={{ top: 4, right: 16, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
                <Line type="monotone" dataKey="Actions" stroke={JADE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="Pages" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* Work mix summary */}
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4 flex flex-col justify-center">
          <p className="text-sm font-bold text-[#1a1916] mb-3">Type of work</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-[#e6f5ee] px-4 py-3 text-center">
              <p className="text-xl font-bold text-[#1f6f54]">{member.created}</p>
              <p className="text-[11px] font-semibold text-[#1f6f54] mt-0.5">Created</p>
            </div>
            <div className="rounded-xl bg-[#eaf2fb] px-4 py-3 text-center">
              <p className="text-xl font-bold text-[#1e5fae]">{member.updated}</p>
              <p className="text-[11px] font-semibold text-[#1e5fae] mt-0.5">Updated</p>
            </div>
            <div className="rounded-xl bg-[#fdeee4] px-4 py-3 text-center">
              <p className="text-xl font-bold text-[#b45309]">{member.deleted}</p>
              <p className="text-[11px] font-semibold text-[#b45309] mt-0.5">Deleted</p>
            </div>
          </div>
          <p className="text-[11px] text-[#9b9890] mt-3">
            {member.pagesViewed} pages · {member.reportsViewed} reports opened in the period.
          </p>
        </div>
      </div>

      {/* Pages viewed — the presence detail behind the "Pages viewed" count */}
      {pages.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] mb-3 overflow-hidden print:break-inside-avoid">
          <div className="px-5 py-2.5 bg-[#fafaf8] border-b border-[#f0ede8] flex items-center justify-between">
            <p className="text-xs font-bold text-[#1a1916]">Pages viewed</p>
            <p className="text-[11px] text-[#9b9890]">{pages.length} distinct page{pages.length === 1 ? '' : 's'} · {member.pagesViewed} visits</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {pages.map((p, i) => (
                <tr key={i} className="border-t border-[#f7f5f1] first:border-t-0 hover:bg-[#fafaf8]">
                  <td className="pl-5 pr-3 py-2.5 text-[#1a1916] font-medium">{p.label}</td>
                  <td className="px-3 py-2.5 text-[#6b6860] whitespace-nowrap text-right w-24">{p.count} visit{p.count === 1 ? '' : 's'}</td>
                  <td className="pl-3 pr-5 py-2.5 text-[#9b9890] whitespace-nowrap text-right">last {p.lastAt.split(',')[1]?.trim() ?? p.lastAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9b9890]" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search loaded actions…"
            className="pl-9 pr-3 py-2 rounded-xl border border-[#e8e6e0] bg-white text-sm w-64 focus:outline-none focus:border-[#2e9f82]" />
        </div>
        <button onClick={() => setKind(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${!kind ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e3e0d9] hover:border-[#c5c2bc]'}`}>
          All · {counts?.all ?? '…'}
        </button>
        {kinds.map(([k, n]) => (
          <button key={k} onClick={() => setKind(kind === k ? null : k)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border capitalize transition-colors ${kind === k ? 'bg-[#2e9f82] text-white border-[#2e9f82]' : 'bg-white text-[#6b6860] border-[#e3e0d9] hover:border-[#c5c2bc]'}`}>
            {k} · {n}
          </button>
        ))}
      </div>

      {/* Day-grouped feed */}
      {byDay.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e8e6e0] p-12 text-center text-sm text-[#9b9890]">
          {feedLoading ? 'Loading…' : 'Nothing matches.'}
        </div>
      ) : byDay.map(g => (
        <div key={g.day} className="bg-white rounded-2xl border border-[#e8e6e0] mb-3 overflow-hidden print:break-inside-avoid">
          <div className="px-5 py-2.5 bg-[#fafaf8] border-b border-[#f0ede8] flex items-center justify-between">
            <p className="text-xs font-bold text-[#1a1916]">{g.day}</p>
            <p className="text-[11px] text-[#9b9890]">{g.items.length} action{g.items.length === 1 ? '' : 's'}</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {g.items.map((it, i) => (
                <tr key={i} className="border-t border-[#f7f5f1] first:border-t-0 hover:bg-[#fafaf8]">
                  <td className="pl-5 pr-3 py-2.5 text-[#6b6860] whitespace-nowrap w-20">{it.at.split(',')[1]?.trim()}</td>
                  <td className="px-3 py-2.5 w-24">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${KIND_STYLE[it.kind] ?? KIND_STYLE.other}`}>{it.kind}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#1a1916] font-medium">{it.action}</td>
                  <td className="px-3 py-2.5 text-[#4a4742]">{it.detail}</td>
                  <td className="px-3 py-2.5 text-right pr-5 w-20">
                    {it.contractId != null && (
                      <Link href={`${contractsBase}/${it.contractId}/v2`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#2e9f82] hover:underline">
                        Open <ExternalLink size={12} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {nextOffset != null && (
        <div className="text-center mb-6 print:hidden">
          <button
            onClick={() => void fetchPage(nextOffset, kind, false)}
            disabled={feedLoading}
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[#e8e6e0] bg-white text-[#6b6860] hover:text-[#1a1916] hover:border-[#c5c2bc] disabled:opacity-50">
            {feedLoading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
