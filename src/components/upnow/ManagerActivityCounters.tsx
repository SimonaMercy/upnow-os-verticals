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
  /** Actioned more than once inside this cell (three cheques on one lease). */
  times: number | null;
  /** WHEN the action happened — its own timestamp, not the record's. */
  at: string | null; firstAt: string | null;
  by: string | null;
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
  manager: '#2e9f82', customer: '#1f6f9c', landlord: '#8a6a1e',
};
const SIDE_BLURB: Record<string, string> = {
  manager: 'Work done by your managers, and by you on your own account.',
  customer: 'The tenant’s own acts. Never counted as the team’s output.',
  landlord: 'Only what the landlord does as a party to the lease — their operational work is on the team sheet.',
};
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
    const team = data.sides.find((x) => x.side === 'manager');
    // One block per person, exactly as the page reads — a shared block would be
    // the "together" view this report exists to replace.
    for (const person of data.people) {
      const rows = (team?.rows ?? []).filter((r) => r.people != null);
      if (!rows.length) continue;
      lines.push('');
      lines.push([person.name, ...MONTHS, 'Year', 'Times recorded'].map(q).join(','));
      for (const r of rows) {
        const pr = r.people![person.userId] ?? { months: Array(12).fill(0), total: 0, repeats: null };
        lines.push([r.label, ...pr.months.map((m) => (r.live ? '' : (m ?? 0))), pr.total, pr.repeats ?? pr.total].map(q).join(','));
      }
    }
    for (const [title, rows] of [
      ['Not attributed to a person', (team?.rows ?? []).filter((r) => r.people == null)],
      ...data.sides.filter((x) => x.side !== 'manager').map((x) => [x.title, x.rows] as const),
    ] as Array<readonly [string, Row[]]>) {
      if (!rows.length) continue;
      lines.push('');
      lines.push([title, ...MONTHS, 'Year', 'Times recorded'].map(q).join(','));
      for (const r of rows) {
        lines.push([r.label, ...r.months.map((m) => (r.live ? '' : (m ?? 0))), r.total, r.repeats ?? r.total].map(q).join(','));
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
        const unattributed = all.filter((r) => r.people == null);
        return (
          <>
            {data.people.map((p) => (
              <Sheet
                key={p.userId}
                title={p.name}
                blurb={p.kind === 'landlord'
                  ? 'The landlord’s own account — their operational work, kept separate from the managers’.'
                  : 'This manager’s own work. Nothing here is anybody else’s.'}
                accent={p.kind === 'landlord' ? SIDE_ACCENT.landlord : SIDE_ACCENT.manager}
                rows={all}
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
            {data.sides.filter((x) => x.side !== 'manager').map((sd) => (
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
  /** Whose sheet this is — null for the customer, the landlord-as-party, and
   *  the unattributed steps. */
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
  const unattributable = (r: Row) => person != null && !r.people;
  const ZERO = { months: Array(12).fill(null), total: 0, repeats: null };
  /** This sheet's own figures — the person's row when it is a person's sheet. */
  const mine = (r: Row): { months: Array<number | null>; total: number; repeats: number | null } => {
    if (person == null) return r;
    if (!r.people) return ZERO;
    return r.people[person] ?? ZERO;
  };
  // A live counter (registration pending) is a snapshot of today, so it has no
  // month column to sit in — it shows only against the year row.
  const cellOf = (r: Row, m: number) => (r.live ? null : (mine(r).months[m] ?? 0));
  const isOn = (r: Row, m: number) =>
    cell?.counter === r.key && cell?.month === m && cell?.person === person;

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
                  {r.source === 'audit' && (
                    <span title="From the activity log, which only begins 7 Jul 2026"
                      style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: '#8a6a1e' }}>audit</span>
                  )}
                  {r.live && (
                    <span style={{ display: 'block', marginTop: 3, font: `600 8px ${MONO}`, color: DIM }}>live</span>
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
                        onClick={() => v && onPick({ counter: r.key, month: i + 1, person })}
                        disabled={!v}
                        title={unattributable(r)
                          ? 'No actor is recorded for this step — its figure is on the “not attributed” sheet below.'
                          : undefined}
                        style={{ width: '100%', border: 0, borderRadius: 0,
                          background: isOn(r, i + 1) ? '#f0faf6' : 'transparent',
                          cursor: v ? 'pointer' : 'default', padding: '7px 12px', textAlign: 'right',
                          font: `${v ? 600 : 500} 12px ${MONO}`, color: v ? INK : '#d5d1c9',
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
                      onClick={() => m.total && !na && onPick({ counter: r.key, month: 0, person })}
                      disabled={!m.total || na}
                      title={na
                        ? 'No actor is recorded for this step — its figure is on the “not attributed” sheet below.'
                        : (r.note ?? undefined)}
                      style={{ width: '100%', border: 0, borderRadius: 0,
                        background: isOn(r, 0) ? '#e6f5ef' : 'transparent',
                        cursor: m.total ? 'pointer' : 'default', padding: '9px 12px', textAlign: 'right',
                        font: `700 13px ${MONO}`, color: m.total ? (uncaptured ? '#8a6a1e' : INK) : '#c9c5bd',
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

/* ── the records behind one cell — that step only ─────────────────────────── */
function Drill({ label, who, month, year, records, loading, onClose }: {
  label: string; who: string | null; month: number; year: number;
  records: Rec[]; loading: boolean; onClose: () => void;
}) {
  const when = month === 0 ? String(year) : `${MONTHS[month - 1]} ${year}`;
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
                        leaves the reader to guess what happened to it. */}
                    <td style={{ padding: '9px 14px', fontSize: 12.5 }}>
                      {r.item ?? <span style={{ color: FAINT }}>—</span>}
                      {r.times != null && (
                        <span style={{ marginLeft: 7, font: `600 9.5px ${MONO}`, color: '#8a6a1e',
                          background: '#fdf3dd', padding: '2px 5px' }}>×{r.times}</span>
                      )}
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
                    <td style={{ padding: '9px 14px', font: `500 11px ${MONO}`, color: r.by ? DEEP : FAINT }}>
                      {/* Blank where the source carries the date but not the
                          person — never guessed. */}
                      {r.by ?? 'not recorded'}
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
