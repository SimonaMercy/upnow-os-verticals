/**
 * Activity by Side — the counter sheet on its own, in the Operations month-sheet
 * layout: months down, steps across, one sheet per side.
 *
 * Three sheets, and the split is the whole point: a step is counted once, under
 * whoever performed it. A manager verifying a document and a customer submitting
 * one are two different acts by two different people, so they are never added
 * into the same figure.
 *
 * Every cell is a DISTINCT record count — a lease registered twice is one lease,
 * with the repeat shown against the year total rather than inflating it. And
 * every cell clicks through to exactly the records behind THAT step in THAT
 * month: clicking "KYC completed" lists the documents, clicking "Settlement
 * closed" lists the leases. Never a generic pipeline feed.
 *
 * ⚠️ Months do not always add up to the year. A lease worked in January and
 * again in March is in both months and counted ONCE in the year — which is the
 * truthful reading of "records touched". Making the row add up would mean
 * counting the same lease twice.
 *
 * Backend: GET /api/reports/manager-activity-counters. Landlord-only.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle, Download, X, ExternalLink } from 'lucide-react';
import { APP_TIME_ZONE } from '@/lib/datetime';
import {
  DEEP, RED, INK, MID, DIM, FAINT, LINE, PANEL, PAGE, RAIL, MONO, SANS,
  micro, navBtn, hcell,
} from '@/components/upnow/activityLogKit';

interface PersonRow { months: Array<number | null>; total: number; repeats: number | null }
interface Row {
  key: string; label: string; side: string; source: 'table' | 'audit';
  note: string | null; live: boolean;
  /** The names on this row are a guess at WHOSE QUEUE the work sits in — nobody
   *  performed it. Outstanding work, never output. */
  inferred: boolean;
  months: Array<number | null>;
  total: number; repeats: number | null;
  /** A full twelve-month row per person. null = the source records no actor,
   *  so this step cannot go on anybody's sheet. */
  people: Record<string, PersonRow> | null;
}
interface Side { side: string; title: string; rows: Row[] }
interface Rec {
  id: number; kind: string; ref: string;
  /** Opens the uploaded file itself, when the record is a document. */
  viewHref: string | null;
  /** Where the record is WORKED — decided server-side from its state, because
   *  a lease in setup lives on the Operations board, not the lease page. */
  href: string | null;
  title: string | null; person: string | null;
  /** WHAT was actioned — the document, cheque, inspection, settlement. */
  item: string | null;
  /** The same list unjoined, each openable where it can be. A customer's KYC row
   *  groups every document verified for them. */
  items: Array<{ label: string; href: string | null }>;
  /** Actioned more than once inside this cell (three cheques on one lease). */
  times: number | null;
  /** WHEN the action happened — its own timestamp, not the record's. */
  at: string | null; firstAt: string | null;
  /** WHO acted, in the source's own words — a signature names its signatory,
   *  which on a POA is not the account holder. */
  by: string | null;
  /** Whose login it was captured on, when that is somebody else on the team. */
  byNote: string | null;
}
interface Payload {
  year: number;
  /** Cutoff in force, or null when the whole year is counted. */
  countingFrom: string | null;
  /** 1–12; months before it are outside the count and shown greyed. */
  cutMonth: number | null;
  people: Array<{ userId: number; name: string; kind: string }>;
  sides: Side[];
  drill: { counter: string; label: string; month: number; side: string; person: number | null } | null;
  records: Rec[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIDE_ACCENT: Record<string, string> = {
  manager: '#047246', customer: '#1f6f9c', landlord: '#8a6a1e',
};
// No `landlord` entry: the landlord is not a sheet of their own any more. Their
// acts as a party to the lease sit on their personal sheet, because the account
// and the party are one person and two sheets read as two people.
const SIDE_BLURB: Record<string, string> = {
  manager: 'Work done by your managers, and by you on your own account.',
  customer: 'The tenant’s own acts. Never counted as the team’s output.',
};

/**
 * The landlord's sheet, in PROCESS order.
 *
 * Their acts as a party are not a separate block appended at the end — that is
 * how they came to look like a second person in the first place. They belong at
 * the point in the journey where they happen: the lease is signed once the
 * cheques are in and before it is registered, and the landlord answers a
 * termination request before the move-out begins.
 */
const PARTY_AFTER: Record<string, string> = { cheques_collected: 'contract_signed_landlord' };
const PARTY_BEFORE: Record<string, string> = { moveout_initiated: 'termination_responded' };
/** A manager never signs the lease — that is the landlord or their POA. The
 *  column is inspection counter-signatures, so on the landlord's own sheet it
 *  reads as if they had done a manager's job. */
const NOT_ON_LANDLORD_SHEET = new Set(['manager_sign']);

/**
 * The steps no person can be credited with — but only when at least one of them
 * actually happened in the period on screen.
 *
 * An empty sheet headed "Not attributed to a person" is an accusation with no
 * evidence: it reads as work going uncredited when the truthful answer is that
 * none of those steps occurred. Returning [] hides the whole section, and the
 * moment any of them does occur the full section comes back — every row, not
 * just the ones with a figure, so the list of what CAN go uncredited stays
 * readable.
 */
function unattributedRows(team: Row[]): Row[] {
  const rows = team.filter((r) => r.people == null);
  return rows.some((r) => r.total > 0) ? rows : [];
}

function landlordSheetRows(team: Row[], asParty: Row[]): Row[] {
  const party = new Map(asParty.map((r) => [r.key, r]));
  const placed = new Set<string>();
  const out: Row[] = [];
  const take = (key: string | undefined) => {
    const r = key ? party.get(key) : undefined;
    if (r && !placed.has(r.key)) { out.push(r); placed.add(r.key); }
  };
  for (const r of team) {
    if (NOT_ON_LANDLORD_SHEET.has(r.key)) continue;
    take(PARTY_BEFORE[r.key]);
    out.push(r);
    take(PARTY_AFTER[r.key]);
  }
  // A party act this map has never heard of still goes on the sheet: a new
  // landlord counter must never disappear because nobody updated the ordering.
  for (const r of asParty) if (!placed.has(r.key)) out.push(r);
  return out;
}
export function ManagerActivityCounters({ endpoint, backHref }: { endpoint: string; backHref: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  /**
   * Count from this month onwards. Defaults to AUGUST 2026 — everything before
   * it is import history and bulk stamps, which read as months of work that
   * nobody actually did. Earlier months stay on the sheet at zero rather than
   * being hidden, so the cut is visible.
   */
  const [fromMonth, setFromMonth] = useState(8);
  /** The clicked cell: which counter, which month (0 = the year column). */
  /** The clicked cell also remembers WHOSE sheet it was on. */
  const [cell, setCell] = useState<{ counter: string; month: number; person: number | null } | null>(null);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ year: String(year) });
    if (fromMonth > 1) qs.set('from', `${year}-${String(fromMonth).padStart(2, '0')}-01`);
    if (cell) {
      qs.set('counter', cell.counter);
      qs.set('month', String(cell.month));
      if (cell.person) qs.set('person', String(cell.person));
    }
    Promise.resolve()
      .then(() => { if (alive) setLoading(true); })
      .then(() => fetch(`${endpoint}?${qs}`, { credentials: 'include' }))
      .then(async (r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((j) => { if (alive) { setData(j); setErr(null); } })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint, year, fromMonth, cell]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now + 1, now, now - 1, now - 2];
  }, []);

  const csv = () => {
    if (!data) return;
    const q = (v: unknown) => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines: string[] = [`Activity by side,${data.year}`];
    // The caveat has to survive the export: a spreadsheet column headed with a
    // manager's name and a bare number is exactly where outstanding work gets
    // read as output.
    const rowLabel = (r: Row) => (r.inferred ? `${r.label} (outstanding — not done)` : r.label);
    const team = data.sides.find((x) => x.side === 'manager');
    // One block per person, exactly as the page reads — a shared block would be
    // the "together" view this report exists to replace.
    // The landlord's acts as a party ride on their own block, exactly as the page
    // reads them — one person, one block. They are ROLE rows, so they export
    // whole rather than narrowed to the landlord's user id.
    const asParty = data.sides.find((x) => x.side === 'landlord')?.rows ?? [];
    for (const person of data.people) {
      // Same list the page draws, in the same process order — an export that
      // re-sorts is a second version of the report.
      const rows = (person.kind === 'landlord'
        ? landlordSheetRows(team?.rows ?? [], asParty)
        : (team?.rows ?? []))
        .filter((r) => r.side !== 'manager' || r.people != null);
      if (!rows.length) continue;
      lines.push('');
      lines.push([person.name, ...MONTHS, 'Year', 'Times recorded'].map(q).join(','));
      for (const r of rows) {
        // A party act counts whoever held the pen, so it exports whole — never
        // narrowed to this person, or a signature taken on a manager's login
        // would vanish from the file.
        const role = r.side !== 'manager';
        const fig = role ? r : (r.people![person.userId] ?? { months: Array(12).fill(0), total: 0, repeats: null });
        lines.push([role ? `${r.label} (as a party to the lease)` : rowLabel(r),
          ...fig.months.map((m) => m ?? 0), fig.total, fig.repeats ?? fig.total].map(q).join(','));
      }
    }
    for (const [title, rows] of [
      ['Not attributed to a person', unattributedRows(team?.rows ?? [])],
      ...data.sides.filter((x) => x.side !== 'manager' && x.side !== 'landlord')
        .map((x) => [x.title, x.rows] as const),
    ] as Array<readonly [string, Row[]]>) {
      if (!rows.length) continue;
      lines.push('');
      lines.push([title, ...MONTHS, 'Year', 'Times recorded'].map(q).join(','));
      for (const r of rows) {
        lines.push([rowLabel(r), ...r.months.map((m) => m ?? 0), r.total, r.repeats ?? r.total].map(q).join(','));
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-by-side_${data.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '120px 0', color: DIM, fontFamily: SANS }}>
      <Loader2 size={17} className="animate-spin" style={{ marginRight: 8 }} /> Loading…
    </div>;
  }
  if (err) {
    return <div style={{ maxWidth: 640, margin: '64px auto', border: '1px solid #f3d0d0', background: '#fdeeee', padding: 18, display: 'flex', gap: 10, fontFamily: SANS }}>
      <AlertCircle size={17} color={RED} />
      <div><p style={{ margin: 0, fontWeight: 700, color: INK }}>Could not load the sheet</p>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: DIM }}>{err}</p></div>
    </div>;
  }
  if (!data) return null;

  const open = cell && data.drill;

  return (
    <div style={{ background: PAGE, minHeight: '100%', fontFamily: SANS, color: INK, padding: '18px 22px 60px' }}>
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <Link href={backHref}
            style={{ display: 'inline-flex', gap: 6, alignItems: 'center', textDecoration: 'none',
              font: `600 10px ${MONO}`, letterSpacing: '.1em', textTransform: 'uppercase', color: DIM, marginBottom: 8 }}>
            <ArrowLeft size={13} /> Reports
          </Link>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, letterSpacing: '-.02em' }}>Activity by Side</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: MID, maxWidth: 780 }}>
            Each step of the journey, month by month, filed under the side that performs it. Every figure counts
            records once. Click any number for the records behind that step in that month.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <button onClick={csv} style={{ ...navBtn(true), display: 'flex', gap: 6, alignItems: 'center', padding: '7px 12px' }}>
            <Download size={13} /> CSV
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={micro}>Year</p>
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setCell(null); }}
              style={{ border: `1px solid ${LINE}`, background: PANEL, color: INK, borderRadius: 0,
                font: `600 12px ${MONO}`, padding: '7px 10px' }}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={micro}>Counting from</p>
            <select value={fromMonth} onChange={(e) => { setFromMonth(Number(e.target.value)); setCell(null); }}
              style={{ border: `1px solid ${LINE}`, background: PANEL, color: INK, borderRadius: 0,
                font: `600 12px ${MONO}`, padding: '7px 10px' }}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{i === 0 ? 'Whole year' : m}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* One sheet PER PERSON, not a shared table with columns: the point of
          the report is to read a manager on their own. Steps whose source
          records no actor cannot go on anybody's sheet, so they are gathered
          below rather than silently spread across everyone. */}
      {(() => {
        const team = data.sides.find((x) => x.side === 'manager');
        // EVERY step stays on EVERY manager's sheet. Showing only the ones that
        // happen to carry an actor made the pipeline look cut down — the steps
        // are all still there; the ones with no actor recorded simply show a
        // dot in a person's column, and their real figure on the sheet below.
        const all = team?.rows ?? [];
        const unattributed = unattributedRows(all);
        /**
         * The landlord's acts AS A PARTY to the lease — signing it, answering a
         * termination request. They used to be a sheet of their own headed "The
         * landlord", sitting below a sheet headed with the landlord's name, which
         * read as two different people. It is one person wearing two hats, so it
         * is one sheet: the operational steps first, these last.
         *
         * They stay ROLE rows, never person-filtered — see `personFor` in Sheet.
         * The landlord's slot on a lease can be filled by a manager holding the
         * pen (one of the eight signatures was), and filtering to the landlord's
         * user id would drop it from the report altogether.
         */
        const asParty = data.sides.find((x) => x.side === 'landlord')?.rows ?? [];
        return (
          <>
            {data.people.map((p) => (
              <Sheet
                key={p.userId}
                title={p.name}
                blurb={p.kind === 'landlord'
                  ? 'Their own account, read along the journey: the operational work they did themselves, and the acts they perform as a party to the lease, each at the step where it happens.'
                  : 'This manager’s own work. Nothing here is anybody else’s.'}
                accent={p.kind === 'landlord' ? SIDE_ACCENT.landlord : SIDE_ACCENT.manager}
                rows={p.kind === 'landlord' ? landlordSheetRows(all, asParty) : all}
                person={p.userId}
                year={data.year}
                cutMonth={data.cutMonth}
                cell={cell}
                onPick={setCell}
              />
            ))}
            {unattributed.length > 0 && (
              <Sheet
                title="Not attributed to a person"
                blurb="The steps above that carry a date but no actor anywhere. They show as a dot on each person’s sheet — the work is counted here; the credit simply was never recorded."
                accent={FAINT}
                rows={unattributed}
                person={null}
                year={data.year}
                cutMonth={data.cutMonth}
                cell={cell}
                onPick={setCell}
              />
            )}
            {/* The landlord side is folded into the landlord's own sheet above —
                it was never a second person. Only the customer remains. */}
            {data.sides.filter((x) => x.side !== 'manager' && x.side !== 'landlord').map((sd) => (
              <Sheet
                key={sd.side}
                title={sd.title}
                blurb={SIDE_BLURB[sd.side]}
                accent={SIDE_ACCENT[sd.side] ?? DEEP}
                rows={sd.rows}
                person={null}
                year={data.year}
                cutMonth={data.cutMonth}
                cell={cell}
                onPick={setCell}
              />
            ))}
          </>
        );
      })()}

      {data.cutMonth != null && (
        <p style={{ margin: '0 2px 14px', fontSize: 12, color: '#8a6a1e', background: '#fdf3dd',
          border: '1px solid #f0e2bd', padding: '9px 12px', maxWidth: 900 }}>
          Counting from <strong>{MONTHS[data.cutMonth - 1]} {data.year}</strong>. Earlier months are shown at zero,
          not hidden — they hold import history and bulk stamps (nineteen utility acceptances landed in one minute
          on 3 Aug), which read as months of work nobody did. Switch to “Whole year” above to include them.
        </p>
      )}
      <p style={{ margin: '4px 2px 0', fontSize: 12, color: DIM, maxWidth: 900 }}>
        Every cell is a count of distinct records, so a lease worked twice in a month counts once. For the same
        reason the twelve months do not always add up to the year: a lease worked in two different months is in
        both, and is still one lease for the year.
      </p>

      {open && (
        <Drill
          label={data.drill!.label}
          who={data.people.find((p) => p.userId === data.drill!.person)?.name ?? null}
          month={data.drill!.month}
          year={data.year}
          records={data.records}
          loading={loading}
          onClose={() => setCell(null)}
        />
      )}
    </div>
  );
}

/* ── one sheet: months down, steps across, for ONE person or one side ────── */
function Sheet({ title, blurb, accent, rows, person, year, cutMonth, cell, onPick }: {
  title: string; blurb: string; accent: string;
  rows: Row[];
  /** Whose sheet this is — null for the customer's. A person's sheet may still
   *  carry ROLE rows (the landlord's acts as a party), which read whole. */
  person: number | null;
  year: number;
  /** Months before this are outside the count — greyed, not removed. */
  cutMonth: number | null;
  cell: { counter: string; month: number; person: number | null } | null;
  onPick: (c: { counter: string; month: number; person: number | null } | null) => void;
}) {
  if (!rows.length) return null;
  const yy = String(year).slice(2);
  /**
   * A step with no actor recorded anywhere cannot be put on a person's sheet.
   * Falling back to the row itself printed the TEAM's figure under one manager's
   * name — 45 leases pending registration read as Sherif's 45, and clicking it
   * returned nothing, because not one of those records is his.
   */
  /**
   * Whether this row is read as THIS PERSON's, or whole.
   *
   * Operational steps are the person's — that is the whole point of a sheet per
   * manager. A ROLE row is not: "signed as landlord" counts the acts done in the
   * landlord's slot on the lease, and one of those eight was signed by a manager
   * holding the pen. Narrowing it to the landlord's user id would silently drop
   * that signature from the report.
   */
  const personFor = (r: Row) => (r.side === 'manager' ? person : null);
  /**
   * Shows as `·` — "this happened, but on nobody's sheet; its figure is below".
   * `total > 0` is what makes that sentence true. A step that never happened is
   * simply empty and reads `–` like any other empty cell, and pointing at a
   * section that is now correctly hidden would be a dangling reference.
   */
  const unattributable = (r: Row) => personFor(r) != null && !r.people && r.total > 0;
  const ZERO = { months: Array(12).fill(null), total: 0, repeats: null };
  /** This sheet's own figures — the person's row when the row is theirs to own. */
  const mine = (r: Row): { months: Array<number | null>; total: number; repeats: number | null } => {
    const who = personFor(r);
    if (who == null) return r;
    if (!r.people) return ZERO;
    return r.people[who] ?? ZERO;
  };
  // A live counter (registration pending) is a snapshot of TODAY, and the server
  // buckets it into the month today falls in — so it reads like every other cell
  // instead of leaving a dash in all twelve and the figure floating in the year
  // column, which read as a broken row.
  const cellOf = (r: Row, m: number) => mine(r).months[m] ?? 0;
  const isOn = (r: Row, m: number) =>
    cell?.counter === r.key && cell?.month === m && cell?.person === personFor(r);
  /**
   * A role row sitting on somebody's personal sheet — the landlord's acts as a
   * party, threaded into their operational work at the step where each happens.
   *
   * No rule down the table any more: these columns are interleaved, not a block
   * on the end, and a divider would have to be drawn on both sides of each one.
   * The badge on the column head carries the distinction instead.
   */
  const isRole = (r: Row) => person != null && r.side !== 'manager';

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', margin: '0 2px 7px' }}>
        <p style={{ ...micro, color: accent }}>{title}</p>
        <p style={{ margin: 0, fontSize: 11.5, color: DIM }}>{blurb}</p>
      </div>
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderTop: `2px solid ${accent}`, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 220 + rows.length * 104 }}>
          <thead>
            <tr>
              <th style={{ ...hcell, minWidth: 96, position: 'sticky', left: 0, zIndex: 3 }}>Month</th>
              {rows.map((r) => (
                <th key={r.key} title={r.note ?? undefined}
                  style={{ ...hcell, textAlign: 'right', minWidth: 104, verticalAlign: 'bottom',
                    
                    color: /NOT CAPTURED/.test(r.note ?? '') ? '#8a6a1e' : FAINT }}>
                  {r.label}
                  {/* The sheet holds two different kinds of work. Without this the
                      landlord's signature column reads as another operational
                      step they performed for the business. */}
                  {isRole(r) && (
                    <span title="Done as a party to the lease, not as an operator — and counted whoever held the pen, including a manager signing in the landlord's slot."
                      style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: SIDE_ACCENT.landlord }}>
                      as a party
                    </span>
                  )}
                  {r.source === 'audit' && (
                    <span title="From the activity log, which only begins 7 Jul 2026"
                      style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: '#8a6a1e' }}>audit</span>
                  )}
                  {r.live && (
                    <span title="A snapshot of today, not a month's work — the figure sits in the month we are in and repeats as the year total."
                      style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: DIM }}>live · today</span>
                  )}
                  {/* Outstanding work carrying a guessed name. Marked on the
                      column itself, so it is impossible to read the number under
                      a manager as something they did. */}
                  {r.inferred && (
                    <span title="Work OUTSTANDING, not work done. Nobody is recorded as having performed this step — the figure is filed under the manager whose queue it sits in, the same way the Operations board names a handler."
                      style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: '#8a6a1e' }}>
                      inferred · not done
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((mn, i) => {
              const outside = cutMonth != null && i + 1 < cutMonth;
              return (
              <tr key={mn} style={{ borderTop: '1px solid #f4f2ee', background: outside ? '#fbfaf8' : undefined }}>
                <td style={{ padding: '7px 12px', position: 'sticky', left: 0,
                  background: outside ? '#fbfaf8' : PANEL, zIndex: 1,
                  font: `600 11.5px ${MONO}`, color: outside ? '#c9c5bd' : MID, whiteSpace: 'nowrap' }}>
                  {mn}-{yy}
                  {outside && <span style={{ marginLeft: 6, font: `500 8.5px ${MONO}` }}>not counted</span>}
                </td>
                {rows.map((r) => {
                  const v = unattributable(r) ? null : cellOf(r, i);
                  return (
                    <td key={r.key} style={{ padding: 0, textAlign: 'right' }}>
                      <button
                        onClick={() => v && onPick({ counter: r.key, month: i + 1, person: personFor(r) })}
                        disabled={!v}
                        title={unattributable(r)
                          ? 'No actor is recorded for this step — its figure is on the “not attributed” sheet below.'
                          : r.inferred
                            ? 'Outstanding work, not work done — this manager is who it falls to, not who did it.'
                            : undefined}
                        style={{ width: '100%', border: 0, borderRadius: 0,
                          background: isOn(r, i + 1) ? '#eef7f2' : 'transparent',
                          cursor: v ? 'pointer' : 'default', padding: '7px 12px', textAlign: 'right',
                          font: `${v ? 600 : 500} 12px ${MONO}`,
                          // Amber, never the ink the performed steps use: a
                          // guessed-owner figure must not read like output.
                          color: v ? (r.inferred ? '#8a6a1e' : INK) : '#d5d1c9',
                          textDecoration: v ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}>
                        {v || (unattributable(r) ? '·' : '–')}
                      </button>
                    </td>
                  );
                })}
              </tr>
              );
            })}
            <tr style={{ borderTop: `1.5px solid ${accent}`, background: RAIL }}>
              <td style={{ padding: '9px 12px', position: 'sticky', left: 0, background: RAIL, zIndex: 1,
                font: `700 10px ${MONO}`, letterSpacing: '.1em', textTransform: 'uppercase', color: accent }}>
                Year total
              </td>
              {rows.map((r) => {
                const m = mine(r);
                const na = unattributable(r);
                const uncaptured = /NOT CAPTURED/.test(r.note ?? '');
                return (
                  <td key={r.key} style={{ padding: 0, textAlign: 'right' }}>
                    <button
                      onClick={() => m.total && !na && onPick({ counter: r.key, month: 0, person: personFor(r) })}
                      disabled={!m.total || na}
                      title={na
                        ? 'No actor is recorded for this step — its figure is on the “not attributed” sheet below.'
                        : (r.note ?? undefined)}
                      style={{ width: '100%', border: 0, borderRadius: 0,
                        background: isOn(r, 0) ? '#e6f5ef' : 'transparent',
                        cursor: m.total ? 'pointer' : 'default', padding: '9px 12px', textAlign: 'right',
                        font: `700 13px ${MONO}`,
                        color: m.total ? (uncaptured || r.inferred ? '#8a6a1e' : INK) : '#c9c5bd',
                        textDecoration: m.total ? 'underline dotted' : 'none', textUnderlineOffset: 3 }}>
                      {na ? '·' : (m.total || (uncaptured ? 'n/c' : '–'))}
                      {/* Distinct records is the figure; the repeat is a footnote,
                          never added into it. */}
                      {m.repeats != null && (
                        <span style={{ display: 'block', marginTop: 2, font: `500 9px ${MONO}`, color: FAINT }}>
                          {m.repeats}× recorded
                        </span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── what was actioned on one record: one line, or a list behind a count ──── */
/** What the grouped items ARE, so the collapsed line names them instead of
 *  saying "5 items" and making the reader open it to find out. */
const ITEM_NOUN: Record<string, [string, string]> = {
  tenant: ['document', 'documents'],
  document: ['document', 'documents'],
  payment: ['payment', 'payments'],
  viewing: ['viewing', 'viewings'],
};
function ItemCell({ rec, open, onToggle }: { rec: Rec; open: boolean; onToggle: () => void }) {
  const items = rec.items ?? [];
  const badge = rec.times != null && (
    <span style={{ marginLeft: 7, font: `600 9.5px ${MONO}`, color: '#8a6a1e',
      background: '#fdf3dd', padding: '2px 5px' }}>×{rec.times}</span>
  );
  // Nothing to collapse: a single item reads better as itself than as "1 document".
  if (items.length <= 1) {
    const only = items[0];
    if (!only) return <span style={{ color: FAINT }}>—</span>;
    return (
      <>
        {only.href
          ? <a href={only.href} target="_blank" rel="noreferrer"
              style={{ color: DEEP, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{only.label}</a>
          : only.label}
        {badge}
      </>
    );
  }
  const [one, many] = ITEM_NOUN[rec.kind] ?? ['item', 'items'];
  return (
    <>
      <button onClick={onToggle}
        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
          font: `600 12.5px ${SANS}`, color: DEEP, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
        {items.length} {items.length === 1 ? one : many} {open ? '▾' : '▸'}
      </button>
      {badge}
      {open && (
        <ul style={{ margin: '7px 0 0', padding: 0, listStyle: 'none',
          borderLeft: `2px solid ${LINE}`, paddingLeft: 10 }}>
          {items.map((it, i) => (
            <li key={`${it.href ?? ''}-${it.label}-${i}`} style={{ margin: '0 0 3px', fontSize: 12 }}>
              {/* The file opens same-origin and inline, so it renders in a tab. */}
              {it.href
                ? <a href={it.href} target="_blank" rel="noreferrer"
                    style={{ color: DEEP, textDecoration: 'none',
                      display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {it.label} <ExternalLink size={10} />
                  </a>
                : <span style={{ color: MID }}>{it.label}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ── the records behind one cell — that step only ─────────────────────────── */
function Drill({ label, who, month, year, records, loading, onClose }: {
  label: string; who: string | null; month: number; year: number;
  records: Rec[]; loading: boolean; onClose: () => void;
}) {
  const when = month === 0 ? String(year) : `${MONTHS[month - 1]} ${year}`;
  /** Which rows have their item list expanded. Collapsed is the default: the
   *  table has to stay scannable at ten rows. */
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => {
    const n = new Set(s);
    if (!n.delete(id)) n.add(id);
    return n;
  });
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,25,22,.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: PANEL, border: `1px solid ${LINE}`, width: 'min(880px, 100%)',
          maxHeight: '84vh', display: 'flex', flexDirection: 'column', fontFamily: SANS }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>
          <div>
            <p style={{ ...micro, color: DEEP }}>{when}{who ? `  ·  ${who}` : ''}</p>
            <p style={{ margin: '3px 0 0', fontSize: 15, fontWeight: 800 }}>{label}</p>
          </div>
          <p style={{ margin: '0 0 0 auto', font: `500 11.5px ${MONO}`, color: DIM }}>
            {loading ? 'loading…' : `${records.length} record${records.length === 1 ? '' : 's'}`}
          </p>
          <button onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: DIM, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>{['Record', 'Actioned', 'When', 'Where', 'By', ''].map((c) => (
                <th key={c} style={{ ...hcell, padding: '10px 14px' }}>{c}</th>
              ))}</tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const href = r.href;
                return (
                  <tr key={`${r.kind}-${r.id}`} style={{ borderTop: '1px solid #f4f2ee' }}>
                    <td style={{ padding: '9px 14px', font: `600 11.5px ${MONO}`, whiteSpace: 'nowrap' }}>{r.ref}</td>
                    {/* The actioned item — without it the row names a lease and
                        leaves the reader to guess what happened to it. One item
                        reads inline; a whole KYC pack collapses behind its count,
                        because eight file names run together turned every row
                        into a column-height paragraph. */}
                    <td style={{ padding: '9px 14px', fontSize: 12.5, minWidth: 190 }}>
                      <ItemCell rec={r} open={open.has(r.id)} onToggle={() => toggle(r.id)} />
                    </td>
                    <td style={{ padding: '9px 14px', font: `500 11px ${MONO}`, color: DIM, whiteSpace: 'nowrap' }}>
                      {r.at ? new Date(r.at).toLocaleString('en-GB', {
                        timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short',
                        hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
                      {r.firstAt && (
                        <span style={{ display: 'block', marginTop: 2, font: `500 9.5px ${MONO}`, color: FAINT }}>
                          first {new Date(r.firstAt).toLocaleDateString('en-GB', {
                            timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '9px 14px', fontSize: 12.5, color: MID }}>
                      {[r.title, r.person].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td style={{ padding: '9px 14px', font: `500 11px ${MONO}`, color: r.by ? DEEP : FAINT,
                      minWidth: 180, maxWidth: 280 }}>
                      {/* Blank where the source carries the date but not the
                          person — never guessed. */}
                      {r.by ?? 'not recorded'}
                      {/* The signatory is the answer; the login it was taken on
                          is evidence about it, so it sits under, not instead. */}
                      {r.byNote && (
                        <span style={{ display: 'block', marginTop: 2, font: `500 9.5px ${MONO}`, color: FAINT }}>
                          {r.byNote}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {/* A document opens the FILE; a lease or lead opens its page. */}
                      {r.viewHref && (
                        <a href={r.viewHref} target="_blank" rel="noreferrer"
                          style={{ display: 'inline-flex', gap: 4, alignItems: 'center',
                            font: `600 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase',
                            color: DEEP, textDecoration: 'none' }}>
                          View <ExternalLink size={11} />
                        </a>
                      )}
                      {href && (
                        <Link href={href} style={{ display: 'inline-flex', gap: 4, alignItems: 'center',
                          marginLeft: r.viewHref ? 12 : 0,
                          font: `600 10px ${MONO}`, letterSpacing: '.06em', textTransform: 'uppercase',
                          color: DEEP, textDecoration: 'none' }}>
                          Open <ExternalLink size={11} />
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && !records.length && (
                <tr><td colSpan={6} style={{ padding: '22px 14px', fontSize: 13, color: DIM }}>
                  No records behind this figure.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
