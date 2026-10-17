/**
 * Insights › Reports — Genspark OS rebuild of the RP reports hub. Lists every
 * report card and routes to its detail page. The at-a-glance KPIs / exceptions /
 * charts (ExecutiveOverview) live on the separate Analytics page — this hub is
 * the drillable + exportable report list.
 *
 * Parity with previous page (every item kept):
 *  - Report catalog from the SHARED @/components/upnow/reportCatalog (GROUPS +
 *    REPORT_TILES, also used by the manager hub) — `hidden` tiles stay hidden.
 *  - Grouped sections in GROUPS order with title + blurb; a section disappears when
 *    the search leaves it empty. Within a group: available tiles link to
 *    /rental-provider/dashboard/reports/<slug> (the [slug] dispatcher, or the static
 *    activity-log route for that slug); unavailable tiles render as "Coming soon"
 *    and are not clickable. Each available tile now has a labelled "Open report" button.
 *  - Search across title + description, with a Clear control; "No reports match"
 *    empty state.
 *  - Hub-wide Year picker (useReportsYear / setReportsYear / REPORT_YEARS + "All
 *    years") — shared with Analytics and the default period every time-based report
 *    opens with.
 *  - DataExports (full-dataset XLSX downloads — customers / properties / units / …),
 *    reused unchanged (also imported by the manager hub).
 *  - New: a "Data quality worklists" card linking the existing routes that the
 *    index did not link before — /reports/data-gaps and the five /reports/missing-*
 *    pages (titles from MISSING_REPORTS). No endpoint is called here.
 *  - KPI row derived only from the catalog the page already shows (counts) and the
 *    chosen year — no invented figures.
 *  - The manager hub (/dashboard/manager/reports) is its own page and imports only
 *    DataExports + the catalog from here, both unchanged.
 *  - Legacy Tailwind components (DataExports) are rendered OUTSIDE the kit's `.gx`
 *    scope so gx.css's unlayered element resets don't restyle them.
 */
'use client';

import { useState } from 'react';
import DataExports from './DataExports';
import { GROUPS, REPORT_TILES, type ReportTile } from '@/components/upnow/reportCatalog';
import { MISSING_REPORTS } from '@/components/upnow/MissingDataView';
import { useReportsYear, setReportsYear, REPORT_YEARS, yearLabel } from '@/components/upnow/reportsYear';
import { OsPage, PageHead, Kpis, Kpi, Card, Pill, Btn, SearchField } from '@/components/os/kit';

const BASE = '/rental-provider/dashboard/reports';

const WORKLISTS: { href: string; title: string; description: string }[] = [
  {
    href: `${BASE}/data-gaps`,
    title: 'Data Gaps & Exceptions',
    description: 'One worklist of everything still to fill — contracts, properties, units, customer KYC and your own profile.',
  },
  ...(['missing-contracts', 'missing-customers', 'missing-properties', 'missing-units', 'missing-landlord'] as const)
    .filter((k) => MISSING_REPORTS[k])
    .map((k) => ({ href: `${BASE}/${k}`, title: MISSING_REPORTS[k].title, description: MISSING_REPORTS[k].description })),
];

function Tile({ r }: { r: ReportTile }) {
  return (
    <div
      className="gx-card"
      style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10, opacity: r.available ? 1 : 0.7, borderStyle: r.available ? undefined : 'dashed' }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span
          aria-hidden
          style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: r.available ? 'var(--ms-tint)' : 'var(--ms-surface-3)', color: r.available ? 'var(--ms-primary)' : 'var(--ms-ink-3)' }}
        >
          <r.Icon size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ fontSize: 13 }}>{r.title}</h4>
          <p
            title={r.description}
            style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {r.description}
          </p>
        </div>
      </div>
      <div style={{ marginTop: 'auto' }}>
        {r.available
          ? <Btn size="sm" variant="primary" href={`${BASE}/${r.slug}`}>Open report</Btn>
          : <Pill tone="neutral">Coming soon</Pill>}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [search, setSearch] = useState('');
  const year = useReportsYear();
  const q = search.toLowerCase();
  const visible = REPORT_TILES.filter((r) => !r.hidden);
  const filtered = visible.filter((r) => r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  // Grouped sections; a section disappears entirely when the search leaves it empty.
  const sections = GROUPS
    .map((g) => ({ ...g, tiles: filtered.filter((r) => r.group === g.key) }))
    .filter((g) => g.tiles.length > 0);
  const worklists = WORKLISTS.filter((w) => w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q));

  const availableN = visible.filter((r) => r.available).length;
  const soonN = visible.length - availableN;
  const groupsN = GROUPS.filter((g) => visible.some((r) => r.group === g.key)).length;

  return (
    <>
      <OsPage className="pb-0!">
        <PageHead
          eyebrow="Insights"
          title="Reports"
          lede="Open any report to view, filter and export it. The year you pick here is the period every time-based report opens with."
          actions={
            // Hub-wide year (shared with Analytics); snapshots ignore it.
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="gx-lb" style={{ margin: 0 }}>Reports year</span>
              <select
                className="gx-sel"
                value={year === 'all' ? 'all' : String(year)}
                onChange={(e) => setReportsYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                aria-label="Reports year"
              >
                {REPORT_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                <option value="all">All years</option>
              </select>
            </label>
          }
        />
        <Kpis>
          <Kpi dark k="Reports available" v={availableN} d="Open, filter and export" />
          <Kpi k="Coming soon" v={soonN} d={soonN ? 'Need additional data tracking' : 'Every listed report is live'} />
          <Kpi k="Report groups" v={groupsN} />
          <Kpi k="Data worklists" v={WORKLISTS.length} d="Live gaps to fill" />
          <Kpi k="Reports year" v={yearLabel(year)} d="Default period for time-based reports" />
        </Kpis>
      </OsPage>

      {/* Full-dataset downloads — legacy component, kept outside the .gx scope. */}
      <div style={{ maxWidth: 1420, padding: '0 22px' }}>
        <DataExports />
      </div>

      <OsPage className="pt-0!">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 340, maxWidth: '100%' }}>
            <SearchField value={search} onChange={setSearch} placeholder="Search reports…" />
          </div>
          {search && <Btn size="sm" variant="ghost" onClick={() => setSearch('')}>Clear search</Btn>}
        </div>

        {sections.length === 0 && worklists.length === 0 ? (
          <Card>
            <div className="gx-empty"><b>No reports match your search.</b>Try a shorter word, or clear the search to see every report.</div>
          </Card>
        ) : (
          <>
            {sections.map((g) => (
              <div key={g.key} style={{ marginBottom: 14 }}>
                <Card
                  title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><g.Icon size={14} aria-hidden /> {g.title}</span>}
                  sub={g.blurb}
                  right={<Pill tone="outline" dot={false}>{g.tiles.length} report{g.tiles.length === 1 ? '' : 's'}</Pill>}
                  pad
                >
                  <div className="gx-cols gx-cols-3">
                    {g.tiles.map((r) => <Tile key={r.slug} r={r} />)}
                  </div>
                </Card>
              </div>
            ))}

            {worklists.length > 0 && (
              <Card
                title="Data quality worklists"
                sub="Live lists of records missing details — rows clear themselves as the data is completed."
                right={<Pill tone="outline" dot={false}>{worklists.length}</Pill>}
                pad
              >
                <div className="gx-cols gx-cols-3">
                  {worklists.map((w) => (
                    <div key={w.href} className="gx-card" style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <h4 style={{ fontSize: 13 }}>{w.title}</h4>
                        <p style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginTop: 3 }}>{w.description}</p>
                      </div>
                      <div style={{ marginTop: 'auto' }}><Btn size="sm" href={w.href}>Open worklist</Btn></div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </OsPage>
    </>
  );
}
