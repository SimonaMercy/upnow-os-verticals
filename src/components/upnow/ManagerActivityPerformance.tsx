/**
 * Manager Activity Performance — the Operations page, read per person.
 *
 * The Operations board (/rental-provider/dashboard/operations) shows WHERE every
 * record is standing. This shows WHO moved them, over the same four pipelines and
 * the same lanes, in the same order — the lane vocabulary comes from the action
 * catalogue on the backend, so this report and the board can never describe two
 * different pipelines.
 *
 * Read top to bottom it answers five questions, in the order an owner asks them:
 *
 *   1. DAY BY DAY  — every day of the month, per person, INCLUDING the days
 *                    nobody worked. A quiet day is a finding, and a table built
 *                    from the rows that exist would simply not show it.
 *   2. BY SIDE     — the named steps of the journey (KYC completed, registration
 *                    issued, notices sent, settlement closed …), each counted
 *                    from the source that records it and filed under the side
 *                    that performs it: your team · the customer · the landlord.
 *   3. BY STATE    — the month's summary: the four pipelines' stages, with what
 *                    was worked, how many records CLEARED the stage, and what is
 *                    sitting in it right now. Open a row for its sub-actions —
 *                    the Operations board says a lease is "in KYC"; this says
 *                    the KYC was 47 uploads, 33 verifications and 4 rejections.
 *   4. BEYOND      — everything with no pipeline stage at all, by area. On a
 *                    real month this is the larger half of the work, and the
 *                    Operations page cannot show any of it.
 *   5. THE TEAM    — output, records touched, rework, days worked, days idle,
 *                    and how long a record had been sitting when they picked
 *                    it up.
 *
 * Below that sit the sub-details, which appear once you click a cell: the lane's
 * WHOLE action catalogue (including the actions nobody performed, dimmed, so a
 * missing step reads as "not done" rather than as not existing), and then the
 * log itself in the canvas's six-line record shape.
 *
 * Three rules this page will not bend:
 *   - A step is counted on the side that PERFORMED it, once. The same move-out
 *     request must not appear under both the team and the landlord.
 *   - Waiting time is split by whose side it was on. A lease that sat eleven days
 *     because the customer had not signed is customer wait, and it is never
 *     summed into a manager's column.
 *   - Nobody is credited with work that does not carry their user id. A staff
 *     actor who has left the roster keeps their own column, marked `former`,
 *     rather than having their history moved onto somebody still employed.
 *
 * Backend: GET /api/reports/manager-activity-performance. Landlord-only.
 */
'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle, Download } from 'lucide-react';
import { APP_TIME_ZONE } from '@/lib/datetime';
import {
  A, DEEP, RED, INK, MID, DIM, FAINT, LINE, PANEL, PAGE, RAIL, MONO, SANS,
  ACTOR_WORD, presetRange, micro, navBtn, hcell, Label,
  PeriodPicker, LogTable, FilterBar, fmtWait,
  type Entry,
} from '@/components/upnow/activityLogKit';

/* ── payload (mirrors ActivityLogService.getManagerPerformance) ───────────── */
interface Person {
  userId: number; name: string; kind: 'manager' | 'landlord' | 'former';
  steps: number; boardSteps: number; records: number | null; rework: number;
  activeDays: number; idleDays: number; avgPickupHours: number; lastAt: string | null;
}
/** `records: null` means not one of the rows carried a record id — document
 *  actions store only the document id. Rendered as "n/c", never as a zero. */
interface Cell { steps: number; records: number | null; rework: number }
/** A sub-action inside a lane or an off-board category — the level the
 *  Operations board has no room for. */
interface SubAction {
  key: string; label: string; actor: string;
  count: number; records: number | null; rework: number; byPerson: Record<string, number>;
}
interface Lane {
  id: string; title: string; team: Cell & { avgWaitHours: number }; byPerson: Record<string, Cell>;
  /** Records that CLEARED the lane. null = no single action decides it. */
  completed: number | null;
  actions: SubAction[];
}
interface Band { key: string; title: string; team: Cell; byPerson: Record<string, Cell>; lanes: Lane[] }
interface Day {
  day: string; dow: number; off: boolean; future: boolean;
  team: number; board: number; records: number | null; byPerson: Record<string, number>;
}
interface OffBoard {
  category: string; count: number; records: number | null;
  byPerson: Record<string, number>; actions: SubAction[];
}
/** Live pending counts, merged from the shipped operations-pipeline report —
 *  the same source the Operations page itself reads. */
interface PipelineRow { stageLabel: string; records: number }
interface Outcome { key: string; label: string; team: number; byPerson: Record<string, number> }
interface Wait { actor: string; events: number; avgHours: number; totalHours: number; share: number }
interface ActionRow {
  key: string; label: string; actor: string;
  count: number; records: number | null; avgWaitHours: number; rework: number;
}
interface Payload {
  window: { from: string | null; to: string | null; timezone: string; label: string; workingDays: number };
  people: Person[];
  days: Day[];
  outcomes: Outcome[];
  bands: Band[];
  offBoard: OffBoard[];
  waits: Wait[];
  totals: { rows: number; staff: number; onBoard: number; offBoard: number; unattributed: number };
  focus: { person: number | null; lane: string | null; action: string | null; day: string | null };
  actions: ActionRow[];
  entries: Entry[];
  total: number; page: number; size: number; pages: number;
}

/** Band accents — the house palette, one per operations pipeline. */
const BAND_COLOR: Record<string, string> = {
  lead: '#1e5fae', newlease: '#2e9f82', renewal: '#8250df', terminated: '#b45309',
};
const KIND_LABEL: Record<Person['kind'], string> = {
  manager: 'Manager', landlord: 'Landlord (own account)', former: 'No longer on the roster',
};
const DOW_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Live pipeline stage → activity lane.
 *
 * The operations-pipeline report labels a stage `"<Pipeline> · <Stage>"`. Most
 * map one-to-one; the ones that do not are the reason this table is explicit
 * rather than a name match:
 *   - the pipeline report SPLITS signatures into customer and landlord, which
 *     the activity board keeps as one lane;
 *   - the Lead board's "Payment plan" and "Payment Confirmation Ready" are the
 *     single merged L3 Payments lane, by the design's own instruction;
 *   - a new lease can still be parked in KYC or Payment plan, which the Lead
 *     pipeline owns on the activity board.
 * Anything unmapped is counted and reported rather than silently dropped.
 */
const PENDING_LANE: Record<string, string> = {
  'Lead · Interested': 'L1',
  'Lead · KYC / Documents': 'L2',
  'Lead · Payment plan': 'L3',
  'Lead · Payment Confirmation Ready': 'L3',
  'New Lease · KYC': 'L2',
  'New Lease · Payment plan': 'L3',
  'New Lease · Signature by Customer': 'N2',
  'New Lease · Signature by Landlord': 'N2',
  // N3 Registration → N4 Utility → N5 Move-in — the lane ids are the server's
  // (audit/action-catalog LANE_TITLES); change them there and here together.
  'New Lease · Contract Registration': 'N3',
  'New Lease · Utility': 'N4',
  'New Lease · Move-in': 'N5',
  'New Lease · Ready to activate': 'N6',
  'Renewal · Draft': 'R1',
  'Renewal · Notice Sent': 'R2',
  'Renewal · KYC': 'R3',
  'Renewal · Payment plan': 'R4',
  'Renewal · Cheques / PDC': 'R5',
  'Renewal · Signature by Customer': 'R6',
  'Renewal · Signature by Landlord': 'R6',
  'Renewal · Contract Registration': 'R7',
  'Terminated · Requested': 'T1',
  'Terminated · Move-out inspection': 'T2',
  'Terminated · Bills cleared': 'T3',
  'Terminated · Deposit settlement': 'T4',
};

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00+04:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const int = (n: number) => n.toLocaleString('en-US');
const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', {
    timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '—';

/* ── view ─────────────────────────────────────────────────────────────────── */
export function ManagerActivityPerformance({ endpoint, backHref }: { endpoint: string; backHref: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [preset, setPreset] = useState('This month');
  const [range, setRange] = useState<[string, string]>(() => presetRange('This month')!);
  const [person, setPerson] = useState<number | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  /** Which state rows are expanded to their sub-actions. */
  const [openLane, setOpenLane] = useState<Record<string, boolean>>({});
  const [pipeline, setPipeline] = useState<PipelineRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ from: range[0], to: range[1], page: String(page), size: '50' });
    if (person) qs.set('person', String(person));
    if (lane) qs.set('lane', lane);
    if (day) qs.set('day', day);
    if (action) qs.set('action', action);
    Promise.resolve()
      .then(() => { if (alive) setLoading(true); })
      .then(() => fetch(`${endpoint}?${qs}`, { credentials: 'include' }))
      .then(async (r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((j) => { if (alive) { setData(j); setErr(null); } })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint, range, person, lane, day, action, page]);

  /* What is sitting in each stage RIGHT NOW. Deliberately a second call to the
   * shipped operations-pipeline report rather than a new query: that endpoint
   * reuses ContractsService.listOperationsForRp, which is the Operations page's
   * own source, so "pending" here is the number the page shows and cannot drift
   * from it. Period-independent — pending is a fact about today. */
  useEffect(() => {
    let alive = true;
    fetch('/api/reports/operations-pipeline', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j) setPipeline(j.rows ?? []); })
      .catch(() => { /* pending is additive — the report stands without it */ });
    return () => { alive = false; };
  }, []);

  /** A coarser selection invalidates the finer ones beneath it. */
  const pickCell = (uid: number | null, laneId: string) => {
    setPerson(uid); setLane(laneId); setDay(null); setAction(null); setPage(0);
  };
  const pickDay = (d: string, uid: number | null) => {
    setDay(d); setPerson(uid); setLane(null); setAction(null); setPage(0);
  };
  const clearDrill = () => {
    setPerson(null); setLane(null); setDay(null); setAction(null); setPage(0);
  };

  const people = data?.people ?? [];
  /** Heat is scaled across the whole matrix, not per column — otherwise a quiet
   *  person's busiest lane shades the same as the busiest person's. */
  const max = useMemo(() => Math.max(1, ...(data?.bands ?? [])
    .flatMap((b) => b.lanes.flatMap((l) => people.map((p) => l.byPerson[p.userId]?.steps ?? 0)))), [data, people]);

  /** Live pending, folded onto the lanes. Several stages can share a lane. */
  const pendingByLane = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of pipeline ?? []) {
      const l = PENDING_LANE[r.stageLabel];
      if (l) m[l] = (m[l] ?? 0) + r.records;
    }
    return pipeline ? m : null;
  }, [pipeline]);
  const pendingUnmapped = useMemo(
    () => (pipeline ?? []).filter((r) => !PENDING_LANE[r.stageLabel]).reduce((s, r) => s + r.records, 0),
    [pipeline]);

  const csv = () => {
    if (!data) return;
    const q = (v: string | number | null) => {
      const t = v == null ? 'n/c' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const names = data.people.map((p) => p.name);
    const lines: string[] = [];

    lines.push(`Manager Activity Performance,${q(data.window.label)}`);
    lines.push('');
    lines.push(['Day', ...names, 'On the board', 'All actions'].map(q).join(','));
    for (const d of data.days.filter((x) => !x.future)) {
      lines.push([d.day + (d.off ? ' (weekend)' : ''),
        ...data.people.map((p) => d.byPerson[p.userId] ?? 0), d.board, d.team].map(q).join(','));
    }

    lines.push('');
    lines.push(['Pipeline', 'State', 'Action', 'By', ...names, 'Actions', 'Records', 'Completed', 'Pending now'].map(q).join(','));
    for (const b of data.bands) {
      for (const l of b.lanes) {
        lines.push([b.title, l.title, '', '',
          ...data.people.map((p) => l.byPerson[p.userId]?.steps ?? 0),
          l.team.steps, l.team.records, l.completed, pendingByLane?.[l.id] ?? ''].map(q).join(','));
        // Sub-actions are exported whether or not the row is expanded on screen:
        // the export is the record, not a snapshot of what happened to be open.
        for (const a of l.actions) {
          lines.push([b.title, l.title, a.label, a.actor,
            ...data.people.map((p) => a.byPerson[p.userId] ?? 0),
            a.count, a.records, '', ''].map(q).join(','));
        }
      }
      lines.push([b.title, 'Pipeline total', '', '',
        ...data.people.map((p) => b.byPerson[p.userId]?.steps ?? 0), b.team.steps, b.team.records, '', ''].map(q).join(','));
    }

    lines.push('');
    lines.push(['Beyond the pipelines', 'Action', 'By', ...names, 'Actions', 'Records'].map(q).join(','));
    for (const o of data.offBoard) {
      lines.push([o.category, '', '', ...data.people.map((p) => o.byPerson[p.userId] ?? 0), o.count, o.records].map(q).join(','));
      for (const a of o.actions) {
        lines.push([o.category, a.label, a.actor,
          ...data.people.map((p) => a.byPerson[p.userId] ?? 0), a.count, a.records].map(q).join(','));
      }
    }

    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `manager-activity-performance_${range[0]}_${range[1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0', color: DIM, fontFamily: SANS }}>
      <Loader2 size={17} className="animate-spin" style={{ marginRight: 8 }} /> Loading manager performance…
    </div>;
  }
  if (err) {
    return <div style={{ maxWidth: 640, margin: '64px auto', border: '1px solid #f3d0d0', background: '#fdeeee', padding: 18, display: 'flex', gap: 10, fontFamily: SANS }}>
      <AlertCircle size={17} color={RED} />
      <div><p style={{ margin: 0, fontWeight: 700, color: INK }}>Could not load the report</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: DIM }}>{err}</p></div>
    </div>;
  }
  if (!data) return null;

  const focusPerson = person ? people.find((p) => p.userId === person) ?? null : null;
  const focusLane = lane
    ? data.bands.flatMap((b) => b.lanes).find((l) => l.id === lane) ?? null
    : null;
  const pageLabel = data.total
    ? `${data.page * data.size + 1}–${Math.min(data.total, (data.page + 1) * data.size)} of ${int(data.total)}`
    : '0';

  return (
    <div style={{ background: PAGE, minHeight: '100%', fontFamily: SANS, color: INK, padding: '18px 22px 60px' }}>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link href={backHref}
            style={{ display: 'inline-flex', gap: 6, alignItems: 'center', textDecoration: 'none',
              font: `600 10px ${MONO}`, letterSpacing: '.1em', textTransform: 'uppercase', color: DIM, marginBottom: 8 }}>
            <ArrowLeft size={13} /> Reports
          </Link>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-.02em' }}>
            Manager Activity Performance
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: MID, maxWidth: 720 }}>
            The operations pipelines read per person, from the activity log — day by day first, then the
            month by state with what cleared and what is still pending, then the work no pipeline covers.
            Click any figure for the actions behind it.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <button onClick={csv} style={{ ...navBtn(true), display: 'flex', gap: 6, alignItems: 'center', padding: '7px 12px' }}>
            <Download size={13} /> CSV
          </button>
          <PeriodPicker preset={preset} from={range[0]} to={range[1]} label={data.window.label}
            onApply={(p, f, t) => { setPreset(p); setRange([f, t]); setPage(0); }} />
        </div>
      </div>

      {/* ── 1. day by day ── */}
      <Section title="Day by day"
        note="Every day of the period, newest first — including the days nobody worked, because a quiet day is a finding. Friday is marked as the weekend rather than counted against anyone. Click a figure for that day’s actions.">
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 + people.length * 110 }}>
            <thead>
              <tr>
                <th style={{ ...hcell, minWidth: 150, position: 'sticky', left: 0, zIndex: 3 }}>Day</th>
                {people.map((p) => (
                  <th key={p.userId} style={{ ...hcell, textAlign: 'right', minWidth: 110 }}>{p.name}</th>
                ))}
                <th style={{ ...hcell, textAlign: 'right', minWidth: 90 }}>On the board</th>
                <th style={{ ...hcell, textAlign: 'right', minWidth: 80, color: INK }}>All actions</th>
              </tr>
            </thead>
            <tbody>
              {[...data.days].reverse().filter((d) => !d.future).map((d) => (
                <tr key={d.day} style={{ borderTop: '1px solid #f0ede8', background: d.off ? RAIL : undefined }}>
                  <td style={{ padding: '8px 12px', position: 'sticky', left: 0, zIndex: 1,
                    background: d.off ? RAIL : PANEL, whiteSpace: 'nowrap' }}>
                    <span style={{ font: `600 12px ${MONO}`, color: d.off ? DIM : INK }}>{fmtDay(d.day)}</span>
                    <span style={{ marginLeft: 8, font: `500 9.5px ${MONO}`, letterSpacing: '.08em',
                      textTransform: 'uppercase', color: FAINT }}>
                      {d.off ? 'weekend' : DOW_NAME[d.dow]}
                    </span>
                  </td>
                  {people.map((p) => {
                    const n = d.byPerson[p.userId] ?? 0;
                    const on = day === d.day && person === p.userId;
                    return (
                      <td key={p.userId} style={{ padding: 0, textAlign: 'right' }}>
                        <button onClick={() => n && pickDay(d.day, p.userId)}
                          title={n ? `${p.name} — ${n} actions on ${fmtDay(d.day)}` : `${p.name} recorded nothing on ${fmtDay(d.day)}`}
                          style={{ width: '100%', border: 0, borderRadius: 0, background: on ? '#f0faf6' : 'transparent',
                            outline: on ? `2px solid ${INK}` : undefined, outlineOffset: -2,
                            cursor: n ? 'pointer' : 'default', padding: '8px 12px', textAlign: 'right',
                            font: `${n ? 600 : 500} 12.5px ${MONO}`,
                            // A zero is the point of this table — it stays visible.
                            color: n ? INK : (d.off ? '#d5d1c9' : '#c9c5bd') }}>
                          {n || (d.off ? '·' : '0')}
                        </button>
                      </td>
                    );
                  })}
                  <td style={{ padding: '8px 12px', textAlign: 'right', font: `500 12px ${MONO}`, color: DIM }}>
                    {d.board || '—'}
                  </td>
                  <td style={{ padding: 0, textAlign: 'right' }}>
                    <button onClick={() => d.team && pickDay(d.day, null)}
                      style={{ width: '100%', border: 0, borderLeft: `1px solid ${LINE}`, borderRadius: 0,
                        background: day === d.day && person === null ? '#f0faf6' : RAIL,
                        cursor: d.team ? 'pointer' : 'default', padding: '8px 12px', textAlign: 'right',
                        font: `700 12.5px ${MONO}`, color: d.team ? INK : '#c9c5bd' }}>
                      {d.team || '—'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* The counter sheet lives on its own page now, in the month-sheet layout.
          A copy here would be the same numbers computed a second way — and two
          answers that disagree are worse than one. */}
      <Section title="What was done — by whose side"
        note="Each step of the journey counted from the source that records it, filed under the side that performs it, month by month.">
        <Link href="/rental-provider/dashboard/reports/manager-activity-counters"
          style={{ display: 'inline-flex', gap: 8, alignItems: 'center', textDecoration: 'none',
            border: `1px solid ${LINE}`, background: PANEL, padding: '11px 15px',
            font: `600 11px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase', color: DEEP }}>
          Open the Activity by Side sheet →
        </Link>
      </Section>

      {/* ── 3. by state ── */}
      <Section title="By state"
        note="Every stage of the four pipelines: what was worked in the period, how many records cleared the stage, and what is sitting in it right now. Open a row for its sub-actions — the level the Operations board has no room for.">
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 + people.length * 92 }}>
            <thead>
              <tr>
                <th style={{ ...hcell, minWidth: 250, position: 'sticky', left: 0, zIndex: 3 }}>State</th>
                {people.map((p) => (
                  <th key={p.userId} style={{ ...hcell, textAlign: 'right', minWidth: 92 }}>{p.name}</th>
                ))}
                <th style={{ ...hcell, textAlign: 'right', minWidth: 78, color: INK }}>Actions</th>
                <th style={{ ...hcell, textAlign: 'right', minWidth: 78 }}>Records</th>
                <th style={{ ...hcell, textAlign: 'right', minWidth: 84 }}>Completed</th>
                <th style={{ ...hcell, textAlign: 'right', minWidth: 84 }}>Pending now</th>
              </tr>
            </thead>
            <tbody>
              {data.bands.map((b) => (
                <BandRows key={b.key} band={b} people={people} max={max}
                  focusPerson={person} focusLane={lane}
                  pending={pendingByLane} open={openLane}
                  onToggle={(id) => setOpenLane((o) => ({ ...o, [id]: !o[id] }))}
                  onPick={pickCell} />
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: '9px 2px 0', fontSize: 12, color: DIM }}>
          <strong>Actions</strong> is everything recorded in the stage; <strong>Records</strong> the distinct leases,
          leads or documents behind them; <strong>Completed</strong> the records that actually cleared the stage in the
          period; <strong>Pending now</strong> what is sitting there today, read live from the same source the
          Operations page uses. A stage whose close is not a single decisive action reports “n/c” rather than a guess.
          {pendingUnmapped > 0 && ` ${pendingUnmapped} pending record${pendingUnmapped === 1 ? '' : 's'} sit in a stage the activity board has no lane for and are not shown above.`}
        </p>
      </Section>

      {/* ── 4. beyond the pipelines ── */}
      <Section title="Beyond the pipelines"
        note="The work the Operations page cannot show, because it is not one of its stages. This is most of a month: units re-priced, properties and listings maintained, payments on running leases, templates, team and settings, sign-ins.">
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 + people.length * 92 }}>
            <thead>
              <tr>
                <th style={{ ...hcell, minWidth: 250, position: 'sticky', left: 0, zIndex: 3 }}>Area</th>
                {people.map((p) => (
                  <th key={p.userId} style={{ ...hcell, textAlign: 'right', minWidth: 92 }}>{p.name}</th>
                ))}
                <th style={{ ...hcell, textAlign: 'right', minWidth: 78, color: INK }}>Actions</th>
                <th style={{ ...hcell, textAlign: 'right', minWidth: 78 }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {data.offBoard.map((o) => (
                <Fragment key={o.category}>
                  <tr style={{ borderTop: '1px solid #f0ede8' }}>
                    <td style={{ padding: 0, position: 'sticky', left: 0, background: PANEL, zIndex: 1 }}>
                      <button onClick={() => setOpenLane((s) => ({ ...s, [`off:${o.category}`]: !s[`off:${o.category}`] }))}
                        style={{ width: '100%', border: 0, background: 'transparent', borderRadius: 0,
                          cursor: 'pointer', padding: '9px 12px', textAlign: 'left', fontSize: 13, fontWeight: 600 }}>
                        <span style={{ color: FAINT, marginRight: 7, font: `600 10px ${MONO}` }}>
                          {openLane[`off:${o.category}`] ? '▾' : '▸'}
                        </span>
                        {o.category}
                      </button>
                    </td>
                    {people.map((p) => <Num key={p.userId} v={o.byPerson[p.userId] ?? 0} />)}
                    <Num v={o.count} strong />
                    <Num v={o.records} />
                  </tr>
                  {openLane[`off:${o.category}`] && o.actions.map((a) => (
                    <SubRow key={`${o.category}-${a.key}-${a.actor}`} a={a} people={people} cols={2} />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: '9px 2px 0', fontSize: 12, color: DIM }}>
          {int(data.totals.onBoard)} of the team&apos;s {int(data.totals.staff)} recorded actions sit on a pipeline stage;
          the {int(data.totals.offBoard)} above do not. A further {int(data.totals.unattributed)} carried no user id at
          all — cron, imports, system — and are credited to nobody.
        </p>
      </Section>

      {/* ── 5. the team ── */}
      <Section title="The team"
        note={`${data.window.workingDays} working days in the period. Friday is the weekend, so it is never an idle day — but work done on one still counts as a day worked, which is why days worked plus idle days can come to more than ${data.window.workingDays}.`}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880 }}>
            <thead>
              <tr>
                {['Person', 'Actions', 'On the board', 'Records', 'Rework', 'Days worked', 'Idle days', 'Avg pickup', 'Last seen']
                  .map((c, i) => (
                    <th key={c} style={{ ...hcell, textAlign: i === 0 ? 'left' : 'right', padding: '11px 12px 9px' }}>{c}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.userId} style={{ borderTop: `1px solid #f0ede8`, background: p.kind === 'landlord' ? RAIL : undefined }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{p.name}</span>
                    <span style={{ display: 'block', marginTop: 2, font: `500 9.5px ${MONO}`, letterSpacing: '.08em',
                      textTransform: 'uppercase', color: p.kind === 'former' ? '#8a6a1e' : FAINT }}>
                      {KIND_LABEL[p.kind]}
                    </span>
                  </td>
                  <Num v={p.steps} strong />
                  <Num v={p.boardSteps} />
                  <Num v={p.records} />
                  {/* Rework is busy-without-productive: a rejected document, a
                      reopened inspection, a discarded renewal. */}
                  <Num v={p.rework} tone={p.rework > 0 ? '#8a6a1e' : undefined} />
                  <Num v={p.activeDays} />
                  <Num v={p.idleDays} tone={p.idleDays > 0 ? DIM : undefined} />
                  <td style={{ padding: '10px 12px', textAlign: 'right', font: `600 12px ${MONO}`,
                    color: p.avgPickupHours > 48 ? RED : DIM, whiteSpace: 'nowrap' }}>
                    {p.avgPickupHours ? fmtWait(p.avgPickupHours) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', font: `500 11px ${MONO}`, color: DIM, whiteSpace: 'nowrap' }}>
                    {fmtWhen(p.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* where the waiting went */}
        <div style={{ marginTop: 14, background: PANEL, border: `1px solid ${LINE}`, padding: '13px 15px 15px' }}>
          <p style={micro}>Where the waiting time went</p>
          <p style={{ margin: '5px 0 12px', fontSize: 12.5, color: MID }}>
            Every action carries the gap the record sat through before it, credited to whoever ended it.
            A lease that waited because the customer had not signed is customer time — it is never added to a manager&apos;s column.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.waits.filter((w) => w.events > 0).map((w) => (
              <div key={w.actor} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ width: 92, font: `600 10px ${MONO}`, letterSpacing: '.08em', textTransform: 'uppercase',
                  color: w.actor === 'manager' ? DEEP : MID }}>{ACTOR_WORD[w.actor] ?? w.actor}</span>
                <div style={{ flex: 1, height: 9, background: '#f0ede8' }}>
                  <div style={{ width: `${w.share}%`, height: '100%',
                    background: w.actor === 'manager' ? A : w.actor === 'customer' ? '#1f6f9c' : w.actor === 'rp' ? '#b8912a' : '#c9c5bd' }} />
                </div>
                <span style={{ width: 44, textAlign: 'right', font: `700 12px ${MONO}` }}>{w.share}%</span>
                <span style={{ width: 152, textAlign: 'right', font: `500 11px ${MONO}`, color: DIM }}>
                  {fmtWait(w.avgHours)} avg · {int(w.events)} handoffs
                </span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── sub-details: the lane's catalogue, then the log ───────────────────
           Opens on a state cell OR a day cell. A day has no catalogue — there is
           no such thing as "every action a Tuesday can hold" — so that selection
           goes straight to the log. */}
      {(focusLane || day) && (
        <Section
          title={focusLane
            ? `${focusLane.title}${focusPerson ? ` · ${focusPerson.name}` : ' · whole team'}`
            : `${fmtDay(day!)}${focusPerson ? ` · ${focusPerson.name}` : ' · whole team'}`}
          note={focusLane
            ? 'Every action this lane can hold, in workflow order. The dimmed ones are steps nobody performed in this period — shown so a missing step reads as “not done”, not as “doesn’t exist”.'
            : 'Everything recorded on this day, newest first.'}>
          {focusLane && (
          <div style={{ background: PANEL, border: `1px solid ${LINE}` }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Action', 'By', 'Times', 'Records', 'Rework', 'Avg wait before'].map((c, i) => (
                    <th key={c} style={{ ...hcell, textAlign: i < 2 ? 'left' : 'right', padding: '11px 12px 9px' }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.actions.map((a) => {
                  const id = `${a.key}|${a.actor}`;
                  const zero = a.count === 0;
                  return (
                    <tr key={id}
                      onClick={() => { if (!zero) { setAction(action === id ? null : id); setPage(0); } }}
                      style={{ borderTop: '1px solid #f0ede8', opacity: zero ? 0.55 : 1,
                        cursor: zero ? 'default' : 'pointer',
                        background: action === id ? '#f0faf6' : undefined }}>
                      <td style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 600,
                        color: a.rework ? '#8a6a1e' : INK }}>{a.label}</td>
                      <td style={{ padding: '9px 12px', font: `500 10px ${MONO}`, letterSpacing: '.06em',
                        textTransform: 'uppercase', color: DIM }}>{ACTOR_WORD[a.actor] ?? a.actor}</td>
                      <Num v={a.count} strong />
                      <Num v={a.records} />
                      <Num v={a.rework} tone={a.rework > 0 ? '#8a6a1e' : undefined} />
                      <td style={{ padding: '9px 12px', textAlign: 'right', font: `500 11.5px ${MONO}`,
                        color: a.avgWaitHours > 48 ? RED : DIM }}>
                        {a.avgWaitHours ? fmtWait(a.avgWaitHours) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}

          <div style={{ marginTop: focusLane ? 14 : 0, background: PANEL, border: `1px solid ${LINE}` }}>
            <FilterBar
              pad="10px 14px"
              label={[focusLane ? focusLane.title : fmtDay(day!), focusPerson?.name,
                action && data.actions.find((a) => `${a.key}|${a.actor}` === action)?.label]
                .filter(Boolean).join('  ›  ')}
              hasFilter
              onClear={clearDrill}
              pageLabel={pageLabel}
              page={data.page}
              pages={data.pages}
              onPage={setPage}
            />
            <div style={{ overflowX: 'auto', padding: '0 14px 12px' }}>
              {data.entries.length
                ? <LogTable entries={data.entries} />
                : <p style={{ margin: '18px 0', fontSize: 13, color: DIM }}>No actions in this selection.</p>}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────────── */
function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 9 }}>
        <h2 style={{ margin: 0, fontSize: 14.5, fontWeight: 800, letterSpacing: '-.01em' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 12, color: DIM, flex: '1 1 320px' }}>{note}</p>
      </div>
      {children}
    </section>
  );
}

const Num = ({ v, strong, tone }: { v: number | null; strong?: boolean; tone?: string }) => (
  <td style={{ padding: '10px 12px', textAlign: 'right',
    font: `${strong ? 700 : 500} 12.5px ${MONO}`, color: tone ?? (v ? INK : '#c9c5bd') }}>
    {/* null is a capture gap, not a zero — say so rather than printing a
        figure the audit trail never recorded. */}
    {v == null
      ? <span title="No lease, lead or unit id is recorded on these rows — document actions store only the document id." style={{ font: `500 10px ${MONO}`, letterSpacing: '.06em' }}>n/c</span>
      : v ? v.toLocaleString('en-US') : '—'}
  </td>
);

/** One sub-action row — the detail under a state or an off-board area. */
function SubRow({ a, people, cols }: { a: SubAction; people: Person[]; cols: number }) {
  return (
    <tr style={{ borderTop: '1px solid #f7f5f1', background: '#fcfbf9' }}>
      <td style={{ padding: '6px 12px 6px 34px', position: 'sticky', left: 0, background: '#fcfbf9', zIndex: 1 }}>
        {/* One row per action. Who performed it is the per-person columns to
            the right — splitting the row by actor as well printed the same
            action twice and read as a duplicate. */}
        <span style={{ fontSize: 12, color: a.rework ? '#8a6a1e' : MID }}>{a.label}</span>
      </td>
      {people.map((p) => (
        <td key={p.userId} style={{ padding: '6px 12px', textAlign: 'right', font: `500 11.5px ${MONO}`,
          color: (a.byPerson[p.userId] ?? 0) ? MID : '#d5d1c9' }}>
          {(a.byPerson[p.userId] ?? 0) || '·'}
        </td>
      ))}
      <td style={{ padding: '6px 12px', textAlign: 'right', font: `600 11.5px ${MONO}`, color: MID }}>{a.count}</td>
      <td style={{ padding: '6px 12px', textAlign: 'right', font: `500 11.5px ${MONO}`, color: DIM }}>
        {a.records == null ? 'n/c' : a.records}
      </td>
      {/* Completed / Pending belong to the STATE, not to one of its actions. */}
      {Array.from({ length: Math.max(0, cols - 2) }, (_, i) => <td key={i} />)}
    </tr>
  );
}

/** One pipeline band: header, its states (each expandable to sub-actions),
 *  then the pipeline's own total. */
function BandRows({ band, people, max, focusPerson, focusLane, pending, open, onToggle, onPick }: {
  band: Band; people: Person[]; max: number;
  focusPerson: number | null; focusLane: string | null;
  /** null while the live pipeline call is still in flight. */
  pending: Record<string, number> | null;
  open: Record<string, boolean>;
  onToggle: (laneId: string) => void;
  onPick: (uid: number | null, laneId: string) => void;
}) {
  const accent = BAND_COLOR[band.key] ?? DEEP;
  const COLS = people.length + 5;
  return (
    <>
      <tr>
        <td colSpan={COLS}
          style={{ background: `${accent}0f`, borderTop: `2px solid ${accent}`, padding: '7px 12px' }}>
          <span style={{ font: `700 10px ${MONO}`, letterSpacing: '.14em', textTransform: 'uppercase', color: accent }}>
            {band.title}
          </span>
        </td>
      </tr>
      {band.lanes.map((l) => {
        const isOpen = !!open[l.id];
        const pend = pending?.[l.id] ?? 0;
        return (
          <Fragment key={l.id}>
            <tr style={{ borderTop: '1px solid #f0ede8' }}>
              <td style={{ padding: 0, position: 'sticky', left: 0, background: PANEL, zIndex: 1 }}>
                <button onClick={() => onToggle(l.id)} disabled={!l.actions.length}
                  style={{ width: '100%', border: 0, background: 'transparent', borderRadius: 0,
                    cursor: l.actions.length ? 'pointer' : 'default', padding: '9px 12px', textAlign: 'left' }}>
                  <span style={{ color: l.actions.length ? FAINT : 'transparent', marginRight: 7, font: `600 10px ${MONO}` }}>
                    {isOpen ? '▾' : '▸'}
                  </span>
                  <span style={{ font: `700 9px ${MONO}`, color: accent, background: `${accent}14`, padding: '3px 5px', marginRight: 8 }}>
                    {l.id}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{l.title}</span>
                  {l.team.avgWaitHours > 0 && (
                    <span style={{ marginLeft: 8, font: `500 10px ${MONO}`, color: FAINT }}>
                      {fmtWait(l.team.avgWaitHours)} avg wait
                    </span>
                  )}
                </button>
              </td>
              {people.map((p) => {
                const c = l.byPerson[p.userId] ?? { steps: 0, records: 0, rework: 0 };
                const on = focusLane === l.id && focusPerson === p.userId;
                // Canvas heat rule: t = 0.12 + n/max * 0.88, amber when the cell
                // holds rework, white ink once the tint is dark enough to need it.
                const t = c.steps ? 0.12 + (c.steps / max) * 0.88 : 0;
                const rgb = c.rework ? '232,160,32' : '46,159,130';
                return (
                  <td key={p.userId} style={{ padding: 0, textAlign: 'right' }}>
                    <button
                      onClick={() => c.steps && onPick(p.userId, l.id)}
                      title={c.steps
                        ? `${p.name} · ${l.title} — ${c.steps} action${c.steps === 1 ? '' : 's'}${c.records == null ? ' (no record id captured)' : ` across ${c.records} record${c.records === 1 ? '' : 's'}`}${c.rework ? `, ${c.rework} rework` : ''}`
                        : `${p.name} did nothing in ${l.title} this period`}
                      style={{ width: '100%', border: 0, borderRadius: 0, cursor: c.steps ? 'pointer' : 'default',
                        padding: '10px 12px', textAlign: 'right',
                        background: c.steps ? `rgba(${rgb},${t.toFixed(2)})` : 'transparent',
                        outline: on ? `2px solid ${INK}` : undefined, outlineOffset: -2,
                        font: `${c.steps ? 700 : 500} 12.5px ${MONO}`,
                        color: c.steps ? (t > 0.5 ? '#fff' : INK) : '#d5d1c9' }}>
                      {c.steps ? c.steps.toLocaleString('en-US') : '·'}
                    </button>
                  </td>
                );
              })}
              <td style={{ padding: 0, textAlign: 'right' }}>
                <button
                  onClick={() => l.team.steps && onPick(null, l.id)}
                  title={`${l.title} — whole team`}
                  style={{ width: '100%', border: 0, borderLeft: `1px solid ${LINE}`, borderRadius: 0,
                    background: focusLane === l.id && focusPerson === null ? '#f0faf6' : RAIL,
                    cursor: l.team.steps ? 'pointer' : 'default', padding: '10px 12px', textAlign: 'right',
                    font: `700 12.5px ${MONO}`, color: l.team.steps ? INK : '#c9c5bd' }}>
                  {l.team.steps ? l.team.steps.toLocaleString('en-US') : '—'}
                </button>
              </td>
              <Num v={l.team.records} />
              {/* Completed is an OUTCOME — green when it happened, so the eye can
                  tell a busy stage from a stage that actually cleared records. */}
              <Num v={l.completed} tone={l.completed ? DEEP : undefined} strong={!!l.completed} />
              <td style={{ padding: '10px 12px', textAlign: 'right', font: `600 12.5px ${MONO}`,
                color: pend ? INK : '#c9c5bd' }}>
                {pending == null ? <span style={{ color: '#d5d1c9' }}>…</span> : (pend || '—')}
              </td>
            </tr>
            {isOpen && l.actions.map((a) => (
              <SubRow key={`${l.id}-${a.key}-${a.actor}`} a={a} people={people} cols={4} />
            ))}
          </Fragment>
        );
      })}
      <tr style={{ borderTop: `1px solid ${LINE}` }}>
        <td style={{ padding: '8px 12px', position: 'sticky', left: 0, background: PANEL, zIndex: 1,
          font: `600 10px ${MONO}`, letterSpacing: '.1em', textTransform: 'uppercase', color: DIM }}>
          {band.title} total
        </td>
        {people.map((p) => (
          <td key={p.userId} style={{ padding: '8px 12px', textAlign: 'right', font: `600 12px ${MONO}`,
            color: (band.byPerson[p.userId]?.steps ?? 0) ? MID : '#c9c5bd' }}>
            {(band.byPerson[p.userId]?.steps ?? 0) || '—'}
          </td>
        ))}
        <td style={{ padding: '8px 12px', textAlign: 'right', borderLeft: `1px solid ${LINE}`, background: RAIL,
          font: `700 12px ${MONO}` }}>{band.team.steps || '—'}</td>
        <Num v={band.team.records} />
        <td /><td />
      </tr>
    </>
  );
}
