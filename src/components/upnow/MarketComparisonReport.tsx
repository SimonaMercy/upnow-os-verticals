/**
 * Market Comparison — every unit mix (property + layout) against the market.
 *
 *   OURS            Our Market Rent (the rent set up on the unit) · Our Annual Rent
 *   MARKET SOURCES  Bayut · Property Finder · Dubizzle · Government — one column each
 *   RESULT          Market Average · Difference · Position
 *
 * Owner, 29 Sep 2026: "proper segregation like Bayut this, Dubizzle this, Property
 * Finder, try to put govt as well … then overall average so we know are we good as
 * per market or not" — then, on the first cut: "not readable … you should include
 * the reference also from where you get this" and "where is our setup market rent?".
 *
 * Then: "we need the location factor also because only area will not work —
 * Avenue Residence is far away from Avenue Building." So each layout is compared
 * with the listings NEAREST ITS OWN PROPERTY (within 1, 2 or 3 km), and the
 * "Compared within" column says which; "Whole area" only when no circle holds
 * enough listings.
 *
 * Then: "Reference link should be with each listing, not separate below, so I
 * know which are true cases and which you are doing by yourself." So every
 * listing is a row with the link to ITS OWN advert, only adverts that carry a
 * link are used, and the two things worked out here (distance, the rent at our
 * size) are headed "calculated".
 *
 * So: the portal's own words (Market Rent, Annual Rent), ONE figure per cell,
 * and every figure traceable — the listings behind it open under the
 * row, and every page that was read is listed with its link at the foot.
 *
 * The browser only draws. Every figure is worked out by the backend
 * (upnow-backend/src/reports/market-comparison.ts). A source that could not be
 * read shows a dash and says "can't fetch" in its column heading; nothing on this
 * page is estimated. All money is AED per year.
 *
 * Data: GET {endpointBase}/market-comparison (+ extraQuery like rp=N).
 */
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Loader2, AlertCircle, FileText, ExternalLink, ChevronRight } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';

type SourceKey = 'bayut' | 'property_finder' | 'dubizzle' | 'government';
type Verdict = 'below' | 'at' | 'above' | 'unknown';
interface Used { rent: number; sqft: number | null; building: string | null; compared: number; area: string | null; distanceKm: number | null; url: string; monthly: boolean }
interface SourceResult {
  status: 'fetched' | 'no_comparable' | 'cant_fetch' | 'not_checked'; counts: boolean;
  low: number | null; high: number | null; average: number | null;
  listings: number | null; listedTotal: number | null; used: Used[];
  reason: string | null; note: string | null; url: string | null; fetchedOn: string | null;
}
interface Row {
  propertyId: number; buildingName: string | null; community: string | null;
  planLabel: string; unitType: string | null; bedrooms: number | null;
  units: number; avgSqft: number | null;
  askingAvg: number | null; leasedCount: number; rentAvg: number | null;
  sources: Record<SourceKey, SourceResult>;
  marketAverage: number | null; marketSources: number;
  /** The circle the layout was compared within, in km. Null = the whole area. */
  withinKm: number | null; wholeArea: boolean; wholeAreaReason: string | null;
  askingVsMarketPct: number | null; verdict: Verdict;
}
interface SourceSummary {
  key: SourceKey; label: string; status: 'fetched' | 'cant_fetch' | 'not_checked';
  pagesRead: number; listingsRead: number; pagesFailed: number; lastRead: string | null; reason: string | null;
}
interface PropertySummary {
  propertyId: number; name: string; community: string | null; units: number; layouts: number; compared: number;
  ourMarketRent: number; marketValue: number; differencePct: number | null;
}
interface Payload {
  asOf: string | null;
  sources: SourceSummary[];
  totals: {
    layouts: number; units: number; compared: number; below: number; at: number; above: number; notCompared: number;
    ourMarketRent: number; marketValue: number; differencePct: number | null;
  };
  properties: PropertySummary[];
  rows: Row[];
}

/* One colour per source (house palette, fixed order), used for its dot. */
const SOURCE_COLOR: Record<SourceKey, string> = { bayut: '#1e5fae', property_finder: '#b45309', dubizzle: '#5f6b63', government: '#8250df' };

const num = (n: number | null | undefined) =>
  n == null ? '—' : new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(Math.round(n));
const aed = (n: number | null | undefined) => (n == null ? '—' : `AED ${num(n)}`);
const signed = (p: number | null | undefined) => (p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`);
const day = (s: string | null) =>
  s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "1 km" / "Whole area" — where the listings a layout was compared with stand. */
const within = (r: { withinKm: number | null; marketAverage: number | null }) =>
  r.marketAverage == null ? '' : r.withinKm == null ? 'Whole area' : `${r.withinKm} km`;

const POSITION: Record<Verdict, { label: string; chip: string; text: string }> = {
  below:   { label: 'Below Market', chip: 'bg-red-50 text-red-700',         text: 'text-red-600' },
  at:      { label: 'At Market',    chip: 'bg-[#e6f4ef] text-[#1a7a5a]',    text: 'text-[#1a7a5a]' },
  above:   { label: 'Above Market', chip: 'bg-[#e8f0fb] text-[#1e5fae]',    text: 'text-[#1e5fae]' },
  unknown: { label: 'Not compared', chip: 'bg-[#eef1ef] text-[#5f6b63]',    text: 'text-[#8a948d]' },
};

const th = 'px-2.5 py-2 font-semibold';
const label10 = 'text-[10px] uppercase tracking-wide text-[#8a948d] font-semibold';

export function MarketComparisonReport({
  endpointBase = '/api/reports',
  extraQuery,
  backHref,
  onBack,
}: {
  endpointBase?: string;
  extraQuery?: string;
  backHref?: string;
  onBack?: () => void;
}) {
  // One answer per request. `loading` is derived — the answer on screen either
  // belongs to the request in hand or it does not — so the effect never has to
  // reset state before it fetches.
  const requestKey = `${endpointBase}?${extraQuery ?? ''}`;
  const [answer, setAnswer] = useState<{ key: string; data: Payload | null; error: string | null } | null>(null);
  const [property, setProperty] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const current = answer && answer.key === requestKey ? answer : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  const loading = !current;

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams(extraQuery).toString();
    fetch(`${endpointBase}/market-comparison${q ? `?${q}` : ''}`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `HTTP ${res.status}`);
        return res.json() as Promise<Payload>;
      })
      .then(d => { if (alive) setAnswer({ key: requestKey, data: d, error: null }); })
      .catch(e => { if (alive) setAnswer({ key: requestKey, data: null, error: String(e.message ?? e) }); });
    return () => { alive = false; };
  }, [endpointBase, extraQuery, requestKey]);

  const sources = data?.sources ?? [];
  const cards = useMemo(
    () => (data?.properties ?? []).filter(p => property === 'all' || String(p.propertyId) === property),
    [data, property],
  );

  const exportCsv = () => {
    if (!data) return;
    const n = (v: number | null | undefined) => (v == null ? '' : String(Math.round(v)));
    const headers = ['Property', 'Area', 'Layout', 'Units', 'Size (sqft)', 'Our Market Rent', 'Our Annual Rent',
      ...sources.map(s => s.label), 'Compared within', 'Market Average', 'Difference %', 'Position'];
    const lines = data.rows
      .filter(r => property === 'all' || String(r.propertyId) === property)
      .map(r => [
        r.buildingName ?? '', r.community ?? '', r.planLabel, String(r.units), n(r.avgSqft), n(r.askingAvg), n(r.rentAvg),
        ...sources.map(s => {
          const x = r.sources[s.key];
          return x.status === 'fetched' && x.counts ? n(x.average) : x.status === 'cant_fetch' ? "Can't fetch" : '';
        }),
        within(r), n(r.marketAverage), r.askingVsMarketPct == null ? '' : String(r.askingVsMarketPct), POSITION[r.verdict].label,
      ]);
    lines.push([], ['Adverts behind each layout'],
      ['Property', 'Layout', 'Source', 'Building or sub-area', 'Size (sqft)', 'Listed rent', 'Advert link', 'Distance km (calculated)', 'Rent at our size (calculated)']);
    for (const r of data.rows.filter(x => property === 'all' || String(x.propertyId) === property)) {
      for (const s of sources) {
        for (const u of r.sources[s.key].used) {
          lines.push([r.buildingName ?? '', r.planLabel, s.label, u.building ?? u.area ?? '', n(u.sqft), n(u.rent), u.url,
            u.distanceKm == null ? '' : String(u.distanceKm), n(u.compared)]);
        }
      }
    }
    for (const s of sources.filter(x => x.status !== 'fetched')) lines.push(['', '', s.label, '', '', `Can't fetch — ${s.reason ?? 'not checked'}`]);
    downloadCsv('market-comparison.csv', headers, lines);
  };

  const back = backHref ?? '/rental-provider/dashboard/reports';

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 print:py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 print:mb-3">
        <div>
          {onBack ? (
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-[#5f6b63] hover:text-[#047246] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </button>
          ) : (
            <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-[#5f6b63] hover:text-[#047246] mb-2 print:hidden">
              <ArrowLeft size={14} /> All Reports
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[#14201a]">Market Comparison</h1>
          <p className="text-sm text-[#5f6b63] mt-1">
            Our Market Rent for each layout against the listings near its property.
            {data?.asOf ? ` Market read on ${day(data.asOf)}.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button onClick={exportCsv} disabled={!data} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#e4e9e5] bg-white text-sm font-medium text-[#46534c] hover:border-[#047246] disabled:opacity-50">
            <FileText size={15} /> CSV
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#047246] text-white text-sm font-semibold hover:bg-[#1a7a5a]">
            <Printer size={15} /> Print / PDF
          </button>
        </div>
      </div>

      {loading && <div className="flex items-center gap-2 text-[#5f6b63] py-20 justify-center"><Loader2 size={18} className="animate-spin" /> Loading…</div>}
      {error && !loading && <div className="flex items-center gap-2 text-red-700 py-16 justify-center"><AlertCircle size={16} /> {error}</div>}

      {data && !loading && (
        <>
          <div className="rounded-2xl border border-[#e4e9e5] bg-white flex flex-wrap items-end gap-x-4 gap-y-3 px-4 py-3 mb-6 print:hidden">
            <label className="flex flex-col gap-1">
              <span className={`${label10} px-0.5`}>Property</span>
              <select
                id="market-comparison-property"
                value={property}
                onChange={e => setProperty(e.target.value)}
                className="h-9 rounded-lg border border-[#e4e9e5] bg-white px-3 text-sm font-medium text-[#14201a]"
              >
                <option value="all">All properties</option>
                {data.properties.map(p => <option key={p.propertyId} value={String(p.propertyId)}>{p.name}</option>)}
              </select>
            </label>
          </div>

          <SourcesCard sources={sources} />

          <div className="space-y-5">
            {cards.map(p => (
              <PropertyCard
                key={p.propertyId}
                summary={p}
                rows={data.rows.filter(r => r.propertyId === p.propertyId)}
                sources={sources}
                open={open}
                onToggle={k => setOpen(o => (o === k ? null : k))}
              />
            ))}
          </div>

          <p className="text-xs text-[#8a8780] mt-4 max-w-4xl print:mt-2">
            All amounts are AED per year. Only adverts that carry the link to their own page are used; open a layout to see them.
            Our Market Rent and Our Annual Rent are from your records, the source columns are averages of those adverts, and Market Average,
            Difference and Position are calculated. Each advert is placed on the map by the building or sub-area its advert names, and a layout is
            compared with the adverts nearest its property: within 1 km, then 2, then 3. The whole area is used when too few are near,
            or when fewer than half of the adverts can be placed.
            Homes are matched on bedrooms and a similar size; commercial space is compared per square foot. Your own buildings are left out.
            A building is placed only when Google Maps returns a place of the same name. Market Average is the mean of the sources that
            could be read, and At Market means within 5% of it.
          </p>
        </>
      )}
    </div>
  );
}

/* ── where the figures come from: one line per source ───────────────────────── */
function SourcesCard({ sources }: { sources: SourceSummary[] }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e4e9e5] mb-6 print:break-inside-avoid">
      <p className="text-sm font-bold text-[#14201a] px-5 pt-4">Where the figures come from</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 divide-y sm:divide-y-0 xl:divide-x divide-[#f0ede8] mt-2">
        {sources.map(s => {
          const ok = s.status === 'fetched';
          const partly = ok && s.pagesFailed > 0;
          return (
            <div key={s.key} className="px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SOURCE_COLOR[s.key] }} />
                <span className="text-sm font-semibold text-[#14201a]">{s.label}</span>
                <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${partly ? 'bg-amber-50 text-amber-800' : ok ? 'bg-[#e6f4ef] text-[#1a7a5a]' : 'bg-[#eef1ef] text-[#5f6b63]'}`}>
                  {partly ? 'Partly read' : ok ? 'Read' : s.status === 'cant_fetch' ? "Can't fetch" : 'Not checked'}
                </span>
              </div>
              <p className="text-xs text-[#46534c] mt-1.5">
                {ok
                  ? `${s.pagesRead} ${s.pagesRead === 1 ? 'page' : 'pages'}${s.listingsRead ? ` · ${num(s.listingsRead)} adverts, each with its link` : ''} · ${day(s.lastRead)}`
                  : s.reason ?? 'Not checked yet.'}
              </p>
              {ok && s.pagesFailed > 0 && (
                <p className="text-xs text-[#8a8780] mt-0.5">Can&rsquo;t fetch {s.pagesFailed} {s.pagesFailed === 1 ? 'page' : 'pages'}. {s.reason ?? ''}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── one property: summary line + its layouts ───────────────────────────────── */
function PropertyCard({ summary, rows, sources, open, onToggle }: {
  summary: PropertySummary; rows: Row[]; sources: SourceSummary[]; open: string | null; onToggle: (k: string) => void;
}) {
  const cols = 9 + sources.length;
  const sourceWidth = `${33 / Math.max(1, sources.length)}%`;
  return (
    <div className="bg-white rounded-2xl border border-[#e4e9e5] overflow-hidden print:break-inside-avoid">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <div className="min-w-0 mr-auto">
          <span className="text-sm font-bold text-[#14201a]">{summary.name}</span>
          {summary.community && <span className="text-xs text-[#8a8780] ml-2">{summary.community}</span>}
          <span className="block text-[11px] text-[#8a948d] print:hidden">Click a layout to see each advert behind it, with its link.</span>
        </div>
        <Stat label="Units" value={String(summary.units)} />
        <Stat label="Layouts compared" value={`${summary.compared} of ${summary.layouts}`} />
        <Stat label="Our Market Rent" value={summary.compared ? aed(summary.ourMarketRent) : '—'} />
        <Stat label="Market Average" value={summary.compared ? aed(summary.marketValue) : '—'} />
        <Stat label="Difference" value={signed(summary.differencePct)}
          tone={summary.differencePct == null ? undefined : summary.differencePct < -5 ? 'text-red-600' : summary.differencePct > 5 ? 'text-[#1e5fae]' : 'text-[#1a7a5a]'} />
      </div>
      <div className="overflow-x-auto border-t border-[#f0ede8]">
        <table className="w-full text-[13px] min-w-[1100px] table-fixed">
          <colgroup>
            <col style={{ width: '12%' }} /><col style={{ width: '4.5%' }} /><col style={{ width: '5.5%' }} />
            <col style={{ width: '8.5%' }} /><col style={{ width: '8.5%' }} />
            {sources.map(s => <col key={s.key} style={{ width: sourceWidth }} />)}
            <col style={{ width: '8%' }} /><col style={{ width: '9%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead className="bg-[#f6f8f6] text-[10px] uppercase tracking-wide text-[#8a948d]">
            <tr>
              <th className={`${th} text-left`} rowSpan={2}>Layout</th>
              <th className={`${th} text-right`} rowSpan={2}>Units</th>
              <th className={`${th} text-right`} rowSpan={2}>Sqft</th>
              <th className={`${th} text-center border-l border-[#eceae4] !pb-0 text-[#1a7a5a]`} colSpan={2}>Ours</th>
              <th className={`${th} text-center border-l border-[#eceae4] !pb-0`} colSpan={sources.length}>Market sources</th>
              <th className={`${th} text-center border-l border-[#eceae4] !pb-0`} colSpan={4}>Result</th>
            </tr>
            <tr>
              <th className={`${th} text-right border-l border-[#eceae4]`}>Market Rent</th>
              <th className={`${th} text-right`}>Annual Rent</th>
              {sources.map((s, i) => (
                <th key={s.key} className={`${th} text-right ${i === 0 ? 'border-l border-[#eceae4]' : ''}`}>
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: SOURCE_COLOR[s.key] }} />{s.label === 'Government' ? 'Govt' : s.label}
                  </span>
                  {s.status !== 'fetched' && <span className="block normal-case tracking-normal font-medium text-[#b0ada5]">can&rsquo;t fetch</span>}
                </th>
              ))}
              <th className={`${th} text-right border-l border-[#eceae4]`}>Compared within</th>
              <th className={`${th} text-right`}>Market Average</th>
              <th className={`${th} text-right`}>Difference</th>
              <th className={`${th} text-left`}>Position</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const key = `${r.propertyId}|${r.planLabel}|${r.unitType}|${r.bedrooms}`;
              const isOpen = open === key;
              const pos = POSITION[r.verdict];
              const traceable = sources.some(s => r.sources[s.key].used.length > 0);
              const why = r.verdict === 'unknown'
                ? (r.askingAvg == null ? 'No Market Rent' : 'Not compared')
                : null;
              return (
                <Fragment key={key}>
                  <tr
                    className={`border-t border-[#f0ede8] ${traceable ? 'cursor-pointer hover:bg-[#f6f8f6]' : ''} ${isOpen ? 'bg-[#f6f8f6]' : ''}`}
                    onClick={traceable ? () => onToggle(key) : undefined}
                  >
                    <td className="px-2.5 py-3 font-semibold text-[#14201a]">
                      <span className="inline-flex items-center gap-1">
                        <ChevronRight size={13} className={`shrink-0 text-[#8a948d] transition-transform print:hidden ${traceable ? '' : 'invisible'} ${isOpen ? 'rotate-90' : ''}`} />
                        {r.planLabel}
                      </span>
                    </td>
                    <td className="px-2.5 py-3 text-right tabular-nums text-[#46534c]">{r.units}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums text-[#46534c]">{num(r.avgSqft)}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums font-bold text-[#14201a] bg-[#f3faf7] border-l border-[#eceae4]">{num(r.askingAvg)}</td>
                    <td className="px-2.5 py-3 text-right tabular-nums text-[#14201a] bg-[#f3faf7]">{r.leasedCount ? num(r.rentAvg) : <span className="text-[#b0ada5]">Vacant</span>}</td>
                    {sources.map((s, i) => {
                      const x = r.sources[s.key];
                      // Only a figure worked out from adverts that can be opened is shown.
                      const shown = x.status === 'fetched' && x.counts && x.average != null;
                      return (
                        <td key={s.key} title={x.reason ?? undefined}
                          className={`px-2.5 py-3 text-right tabular-nums ${i === 0 ? 'border-l border-[#eceae4]' : ''} ${shown ? 'text-[#14201a]' : 'text-[#b0ada5]'}`}>
                          {shown ? num(x.average) : '—'}
                        </td>
                      );
                    })}
                    <td className={`px-2.5 py-3 text-right tabular-nums border-l border-[#eceae4] ${r.wholeArea ? 'text-amber-700' : 'text-[#46534c]'}`}
                      title={r.wholeAreaReason ?? undefined}>
                      {within(r) || <span className="text-[#b0ada5]">—</span>}
                    </td>
                    <td className="px-2.5 py-3 text-right tabular-nums font-bold text-[#14201a]">{num(r.marketAverage)}</td>
                    <td className={`px-2.5 py-3 text-right tabular-nums font-semibold ${pos.text}`}>{signed(r.askingVsMarketPct)}</td>
                    <td className="px-2.5 py-3 whitespace-nowrap">
                      <span title={why ? 'No listing of a similar size was found.' : undefined} className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${pos.chip}`}>{why ?? pos.label}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-[#f0ede8] bg-[#f6f8f6] print:hidden">
                      <td colSpan={cols} className="px-5 py-4"><Listings row={r} sources={sources} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="text-right">
      <span className="block text-[10px] uppercase tracking-wide text-[#8a948d]">{label}</span>
      <span className={`block text-xs font-semibold tabular-nums ${tone ?? 'text-[#14201a]'}`}>{value}</span>
    </span>
  );
}

/* ── the listings behind one row, source by source ──────────────────────────── */
function Listings({ row, sources }: { row: Row; sources: SourceSummary[] }) {
  const shown = sources.filter(s => row.sources[s.key].used.length > 0);
  const adjusted = shown.some(s => row.sources[s.key].used.some(u => u.compared !== u.rent));
  return (
    <div>
      <p className="text-xs text-[#5f6b63] mb-3">
        Each row is one advert. <span className="font-semibold text-[#14201a]">Open advert</span> takes you to it.
        Building, size and listed rent are as the advert shows them; the columns headed <span className="font-semibold text-[#14201a]">calculated</span> are worked out here.
      </p>
      <div className="grid grid-cols-1 gap-4">
        {shown.map(s => {
          const x = row.sources[s.key];
          return (
            <div key={s.key} className="bg-white rounded-xl border border-[#e4e9e5] overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 border-b border-[#f0ede8]">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SOURCE_COLOR[s.key] }} />
                <span className="text-sm font-semibold text-[#14201a]">{s.label}</span>
                <span className="text-xs text-[#8a8780]">
                  {x.used.length} adverts{row.withinKm != null ? ` within ${row.withinKm} km` : ' in the whole area'} · read {day(x.fetchedOn)}
                </span>
                {x.url && (
                  <a href={x.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-[#047246] hover:underline">
                    Open the search page <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-[#f6f8f6] text-[10px] uppercase tracking-wide text-[#8a948d] sticky top-0">
                    <tr>
                      <th className="px-4 py-1.5 text-left font-semibold">Building or sub-area</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Sqft</th>
                      <th className="px-3 py-1.5 text-right font-semibold">Listed rent</th>
                      <th className="px-3 py-1.5 text-left font-semibold">Advert</th>
                      <th className="px-3 py-1.5 text-right font-semibold border-l border-[#eceae4]">Distance <span className="normal-case tracking-normal text-[#b0ada5]">calculated</span></th>
                      {adjusted && <th className="px-4 py-1.5 text-right font-semibold">At our size <span className="normal-case tracking-normal text-[#b0ada5]">calculated</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {x.used.map(u => (
                      <tr key={u.url} className="border-t border-[#eef1ef]">
                        <td className="px-4 py-1.5 text-[#46534c]">{u.building ?? u.area ?? <span className="text-[#b0ada5]">Not named in the advert</span>}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#46534c]">{num(u.sqft)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-[#14201a]">
                          {num(u.rent)}{u.monthly && <span className="font-normal text-[#8a8780]" title="The advert prices per month; this is twelve months."> · {num(u.rent / 12)}/month</span>}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <a href={u.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 font-medium text-[#047246] hover:underline">
                            Open advert <ExternalLink size={11} />
                          </a>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[#5f6b63] border-l border-[#eceae4]">
                          {u.distanceKm == null ? <span className="text-[#b0ada5]">not placed</span> : `${u.distanceKm.toFixed(1)} km`}
                        </td>
                        {adjusted && <td className="px-4 py-1.5 text-right tabular-nums text-[#5f6b63]">{num(u.compared)}</td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[#e4e9e5] bg-[#f6f8f6] text-[#14201a]">
                      <td className="px-4 py-2 font-semibold" colSpan={2}>Average of these {x.used.length} <span className="font-normal text-[#8a8780]">calculated</span></td>
                      <td className="px-3 py-2 text-right tabular-nums font-bold">{num(x.average)}</td>
                      <td className="px-3 py-2 text-[#8a8780]" colSpan={adjusted ? 3 : 2}>lowest {num(x.low)} · highest {num(x.high)}{adjusted ? ' · at our size' : ''}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
