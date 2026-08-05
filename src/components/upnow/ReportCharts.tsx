'use client';

/**
 * Chart blocks for the reports hub — analytics-dashboard style visuals above
 * the tables (recharts, house palette). One exported block per report slug:
 *
 *   • ManagerPerformanceCharts — team output mix (stacked horizontal bars) +
 *     daily activity timeline (last ≤30 days of the period).
 *   • LeaseActivityCharts — renewal workload vs delivered by month + Ejari
 *     status of each month's commencements.
 *
 * Categorical palette (validated: lightness band, chroma, CVD separation,
 * contrast vs white): jade → blue → amber → purple, assigned in FIXED order —
 * the same entity keeps its hue across filters. Signatures/renewals are not
 * stacked with contracts (they're subsets — stacking would double-count).
 */

import { useState } from 'react';
import { Info } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const PALETTE = ['#2e9f82', '#1e5fae', '#b45309', '#8250df'];
const [JADE, BLUE, AMBER, PURPLE] = PALETTE;
const RED = '#dc2626';
const GRID = '#f0ede8';
const TICK = { fontSize: 11, fill: '#9b9890' } as const;

/** Compact AED from fils for chart axes: 7.5M, 689K, 950. */
const fmtAedShort = (fils: number | null | undefined) => {
  const v = Number(fils ?? 0) / 100;
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
};
/** Full AED from fils for tooltips. */
const fmtAed = (fils: number | null | undefined) =>
  new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 }).format(Number(fils ?? 0) / 100);

/** Chart card — the explanation lives behind the ⓘ so the page stays clean. */
function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-sm font-bold text-[#1a1916]">{title}</p>
        {hint && (
          <span className="relative inline-flex print:hidden">
            <button
              type="button"
              aria-label={`About ${title}`}
              onClick={() => setOpen(o => !o)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              className="text-[#9b9890] hover:text-[#2e9f82] transition-colors">
              <Info size={13} />
            </button>
            {open && (
              <span
                className="absolute z-40 top-full mt-2 left-0 w-72 max-w-[75vw] bg-white border border-[#e3e0d9] rounded-xl p-3 text-xs leading-relaxed text-[#4a4742] whitespace-normal"
                style={{ boxShadow: '0 12px 32px rgba(20,18,15,.16)' }}>
                {hint}
              </span>
            )}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Manager Performance ──────────────────────────────────────────────────────

interface PerfRow {
  name: string;
  leadsWorked: number;
  contractsWorked: number;
  documentsWorked: number;
  created: number;
  updated: number;
  deleted: number;
  pagesViewed: number;
  [k: string]: unknown;
}

export function ManagerPerformanceCharts({ rows, daily, dailyPages, granularity }: {
  rows: PerfRow[];
  daily: Array<Record<string, string | number>>;
  dailyPages?: Array<Record<string, string | number>>;
  granularity?: 'hour' | 'day';
}) {
  const hourly = granularity === 'hour';
  const active = rows.filter(r => r.leadsWorked + r.contractsWorked + r.documentsWorked > 0);
  const verbs = rows.filter(r => (r.created ?? 0) + (r.updated ?? 0) + (r.deleted ?? 0) > 0);
  // ONE member→color assignment shared by both timelines, ranked by action volume.
  const memberTotals = new Map<string, number>();
  for (const d of daily) {
    for (const [k, v] of Object.entries(d)) {
      if (k === 'date') continue;
      memberTotals.set(k, (memberTotals.get(k) ?? 0) + (Number(v) || 0));
    }
  }
  for (const d of dailyPages ?? []) {
    for (const [k, v] of Object.entries(d)) {
      if (k === 'date') continue;
      if (!memberTotals.has(k) && Number(v) > 0) memberTotals.set(k, 0);
    }
  }
  const lineMembers = [...memberTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);
  const pagesHaveData = (dailyPages ?? []).some(d => Object.entries(d).some(([k, v]) => k !== 'date' && Number(v) > 0));
  const actionsHaveData = daily.some(d => Object.entries(d).some(([k, v]) => k !== 'date' && Number(v) > 0));

  if (!active.length && !verbs.length && !actionsHaveData && !pagesHaveData) return null;

  const memberLines = (data: Array<Record<string, string | number>>) => (
    <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: -18 }}>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
      <XAxis dataKey="date" tick={TICK} axisLine={false} tickLine={false} minTickGap={24} />
      <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
      <Tooltip />
      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
      {lineMembers.map((name, i) => (
        <Line key={name} type="monotone" dataKey={name} stroke={PALETTE[i]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      ))}
    </LineChart>
  );

  return (
    <div className="grid lg:grid-cols-2 gap-3 mb-6">
      {active.length > 0 && (
        <Card title="Output by team member" hint="How much each person delivered: the leads, leases and documents they worked on in this period. Automatic system entries are not counted.">
          <ResponsiveContainer width="100%" height={Math.max(150, 50 + active.length * 46)}>
            <BarChart data={active} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} tick={TICK} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#fafaf8' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
              <Bar dataKey="contractsWorked" name="Contracts" stackId="w" fill={JADE} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="leadsWorked" name="Leads" stackId="w" fill={BLUE} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="documentsWorked" name="Documents" stackId="w" fill={AMBER} stroke="#fff" strokeWidth={2} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      {verbs.length > 0 && (
        <Card title="Shape of the work" hint="The type of work: how much each person created (green), edited (blue) or removed (orange).">
          <ResponsiveContainer width="100%" height={Math.max(150, 50 + verbs.length * 46)}>
            <BarChart data={verbs} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barSize={18}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={150} tick={TICK} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#fafaf8' }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
              <Bar dataKey="created" name="Created" stackId="v" fill={JADE} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="updated" name="Updated" stackId="v" fill={BLUE} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="deleted" name="Deleted" stackId="v" fill={AMBER} stroke="#fff" strokeWidth={2} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      {actionsHaveData && (
        <Card
          title={hourly ? 'Hourly activity' : 'Daily activity'}
          hint={hourly
            ? 'Work rhythm through the day: how many actions each person took per hour. Hover an hour for the exact split.'
            : 'Work rhythm: how many actions each person took per day over the last 30 days. Hover a day for the exact split.'}
        >
          <ResponsiveContainer width="100%" height={210}>
            {memberLines(daily)}
          </ResponsiveContainer>
        </Card>
      )}
      {pagesHaveData && (
        <Card
          title={hourly ? 'Hourly presence' : 'Daily presence'}
          hint={hourly
            ? 'Time in the system through the day: how many pages each person opened per hour.'
            : 'Time in the system: how many pages each person opened per day. Tracking began 8 July 2026.'}
        >
          <ResponsiveContainer width="100%" height={210}>
            {memberLines(dailyPages!)}
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

// ─── Lease Status Summary ─────────────────────────────────────────────────────

interface LeaseActivityRow {
  label: string;
  due: number;
  newLeases: number;
  renewalContracts: number;
  ejariRegistered: number;
  ejariPending: number;
  [k: string]: unknown;
}

export function LeaseActivityCharts({ rows }: { rows: LeaseActivityRow[] }) {
  const any = rows.some(r => r.due + r.newLeases + r.renewalContracts + r.ejariRegistered + r.ejariPending > 0);
  if (!any) return null;
  return (
    <div className="grid lg:grid-cols-2 gap-3 mb-6">
      <Card title="Renewal workload vs delivered" hint="Workload vs delivery: leases coming due each month (blue) against renewals signed (green) and new contracts (purple).">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barSize={7} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: '#fafaf8' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
            <Bar dataKey="due" name="Due for renewal" fill={BLUE} radius={[3, 3, 0, 0]} />
            <Bar dataKey="renewalContracts" name="Renewals signed" fill={JADE} radius={[3, 3, 0, 0]} />
            <Bar dataKey="newLeases" name="New contracts" fill={PURPLE} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Contract Registration on the month's contracts" hint="Compliance at a glance: of the leases starting each month, how many have completed Contract Registration (green) vs still pending (orange).">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: '#fafaf8' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
            <Bar dataKey="ejariRegistered" name="Contract Registration completed" stackId="e" fill={JADE} stroke="#fff" strokeWidth={2} />
            <Bar dataKey="ejariPending" name="Awaiting Contract Registration" stackId="e" fill={AMBER} stroke="#fff" strokeWidth={2} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─── Executive Cashflow ───────────────────────────────────────────────────────

interface CashflowRow {
  label: string;
  expectedFils: number;
  receivedFils: number;
  pendingFils: number;
  bouncedFils: number;
  bouncedOwedFils: number;
  penaltyFils: number;
  penaltyCollectedFils: number;
  collectionRate: number;
  [k: string]: unknown;
}

export function ExecutiveCashflowCharts({ rows }: { rows: CashflowRow[] }) {
  const any = rows.some(r => r.expectedFils + r.receivedFils + r.penaltyFils > 0);
  if (!any) return null;
  // recharts passes value/name wide — format money series full, the % series as a rate.
  const tip = (value: unknown, name: unknown) =>
    [name === 'Collection %' ? `${Number(value).toFixed(1)}%` : fmtAed(Number(value)), String(name)] as [string, string];
  return (
    <div className="grid lg:grid-cols-2 gap-3 mb-6">
      <Card title="Rent cashflow by month" hint="Where each month's rent stands: collected (green) and still pending (amber) stack to the rent Expected that month. A bounce nobody replaced (red) stands beside the stack, not inside it — it is money still owed, and a bounce that was made good is already counted inside Received.">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -6 }} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmtAedShort} tick={TICK} axisLine={false} tickLine={false} width={44} />
            <Tooltip cursor={{ fill: '#fafaf8' }} formatter={tip} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
            <Bar dataKey="receivedFils" name="Received" stackId="c" fill={JADE} stroke="#fff" strokeWidth={1} />
            <Bar dataKey="pendingFils" name="Pending" stackId="c" fill={AMBER} stroke="#fff" strokeWidth={1} radius={[3, 3, 0, 0]} />
            {/* Its own stack, so the Expected column is never read as including a
                bounce — the whole point of the Cash Management rule. */}
            <Bar dataKey="bouncedOwedFils" name="Bounced · still owed" stackId="b" fill={RED} stroke="#fff" strokeWidth={1} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Rent collected &amp; collection rate" hint="Rent received each month (green bars) with the penalties charged on top of it (amber), against the collection rate — the share of that month's expected rent already received (blue line).">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis yAxisId="money" tickFormatter={fmtAedShort} tick={TICK} axisLine={false} tickLine={false} width={44} />
            <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={TICK} axisLine={false} tickLine={false} width={40} />
            <Tooltip cursor={{ fill: '#fafaf8' }} formatter={tip} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
            <Bar yAxisId="money" dataKey="receivedFils" name="Received" stackId="n" fill={JADE} barSize={18} stroke="#fff" strokeWidth={1} />
            <Bar yAxisId="money" dataKey="penaltyFils" name="Penalty" stackId="n" fill={AMBER} barSize={18} stroke="#fff" strokeWidth={1} radius={[3, 3, 0, 0]} />
            <Line yAxisId="rate" type="monotone" dataKey="collectionRate" name="Collection %" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
