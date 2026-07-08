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

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const PALETTE = ['#2e9f82', '#1e5fae', '#b45309', '#8250df'];
const [JADE, BLUE, AMBER, PURPLE] = PALETTE;
const GRID = '#f0ede8';
const TICK = { fontSize: 11, fill: '#9b9890' } as const;

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8e6e0] p-4">
      <p className="text-sm font-bold text-[#1a1916]">{title}</p>
      {hint && <p className="text-[11px] text-[#9b9890] mt-0.5 mb-2">{hint}</p>}
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

export function ManagerPerformanceCharts({ rows, daily, dailyPages }: {
  rows: PerfRow[];
  daily: Array<Record<string, string | number>>;
  dailyPages?: Array<Record<string, string | number>>;
}) {
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
        <Card title="Output by team member" hint="Distinct leads, contracts and documents worked in the period — system entries excluded.">
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
        <Card title="Shape of the work" hint="Create / update / delete actions per person in the period.">
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
        <Card title="Daily activity" hint="Actions per person per day (last 30 days of the period).">
          <ResponsiveContainer width="100%" height={210}>
            {memberLines(daily)}
          </ResponsiveContainer>
        </Card>
      )}
      {pagesHaveData && (
        <Card title="Daily presence" hint="Dashboard pages opened per person per day (tracked from 8 Jul 2026).">
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
      <Card title="Renewal workload vs delivered" hint="Leases coming due each month vs renewal and new contracts commencing.">
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
      <Card title="Ejari on the month's contracts" hint="Of the leases commencing each month — Ejari registered vs still pending.">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: -18 }} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} />
            <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: '#fafaf8' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#6b6860' }} />
            <Bar dataKey="ejariRegistered" name="Ejari registered" stackId="e" fill={JADE} stroke="#fff" strokeWidth={2} />
            <Bar dataKey="ejariPending" name="Ejari pending" stackId="e" fill={AMBER} stroke="#fff" strokeWidth={2} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
