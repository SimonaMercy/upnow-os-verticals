'use client';

/**
 * The crew's job board (owner, 29 Sep 2026).
 *
 * A job the landlord runs from their page carries no booking, and the vendor
 * board at /operations lists bookings — so a landlord's own crew signed in and
 * saw nothing while their jobs stood against them. This is that crew's board.
 *
 * Laid out as the Operations kanban on purpose (owner: "The Operations kanban
 * board") — the same shared style (OpsPipelineStyle) and the same card markup,
 * so the crew reads it exactly as the rest of the portal reads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ClipboardList, RefreshCw } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { OpsPipelineStyle } from '@/components/upnow/OperationsPipelines';

interface CrewJob {
  id: number; ref: string; title: string; description: string | null;
  stage: string; closedAt: string | null;
  where: string | null; address: string | null;
  tasksTotal: number; tasksDone: number; assignedAt: string | null;
}

type LaneKey = 'todo' | 'doing' | 'done';
const LANES: { key: LaneKey; title: string }[] = [
  { key: 'todo',  title: 'To do' },
  { key: 'doing', title: 'In progress' },
  { key: 'done',  title: 'Done' },
];

/** Where a job sits, read off its own tasks: nothing ticked → To do; some →
 *  In progress; every task ticked, or closed by the landlord → Done. */
function laneOf(j: CrewJob): LaneKey {
  if (j.closedAt) return 'done';
  if (j.tasksTotal > 0 && j.tasksDone === j.tasksTotal) return 'done';
  if (j.tasksDone > 0) return 'doing';
  return 'todo';
}

function ageDays(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}
function ageTone(d: number | null): 'fresh' | 'warn' | 'stale' | '' {
  if (d == null) return '';
  if (d >= 7) return 'stale';
  if (d >= 3) return 'warn';
  return 'fresh';
}
function fmtDay(d: string | null) {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short' });
}
function initials(s: string) {
  return s.split(/\s+/).map(p => p[0]).filter(c => c && /[A-Za-z0-9]/.test(c)).slice(0, 2).join('').toUpperCase() || '—';
}

export default function CrewJobsPage() {
  const [jobs, setJobs] = useState<CrewJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    return apiGet<CrewJob[]>('/maintenance/crew/jobs')
      .then(setJobs)
      .catch(e => setErr(e instanceof Error ? e.message : 'Could not load your jobs.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byLane = useMemo(() => {
    const m = new Map<LaneKey, CrewJob[]>(LANES.map(l => [l.key, []]));
    // Oldest first within a lane — the work is a queue, not a race.
    for (const j of [...(jobs ?? [])].sort((a, b) => (a.assignedAt ?? '').localeCompare(b.assignedAt ?? ''))) m.get(laneOf(j))!.push(j);
    return m;
  }, [jobs]);

  const card = (j: CrewJob) => {
    const age = j.closedAt ? null : ageDays(j.assignedAt);
    return (
      <article key={j.id} className="card" title={j.description ?? j.title}>
        <div className="c-top">
          <span className="av">{initials(j.title)}</span>
          <div className="c-id">
            <div className="c-name">{j.title}</div>
            <div className="c-ref">{j.ref}</div>
          </div>
          {age != null && (
            <span className={'age ' + ageTone(age)} title={`${age} day${age === 1 ? '' : 's'} since last activity`}>{age}d</span>
          )}
        </div>
        <div className="c-unit">{j.where ?? '—'}</div>
        <div className="c-foot">
          <span className="rent">{j.tasksTotal > 0 ? `${j.tasksDone} of ${j.tasksTotal} done` : j.closedAt ? 'Closed' : 'No task list'}</span>
          {fmtDay(j.closedAt ?? j.assignedAt) && <span className="term">{fmtDay(j.closedAt ?? j.assignedAt)}</span>}
        </div>
        <Link href={`/dashboard/service-provider/my-jobs/${j.id}`} className="open">Open <ArrowRight size={12} /></Link>
      </article>
    );
  };

  return (
    <div className="opsp-page">
      <main className="main">
        <div className="hero">
          <div className="left">
            <div className="eyebrow"><ClipboardList size={12} /> Jobs</div>
            <h1>Your <span className="accent">jobs</span></h1>
            <p>Work your landlord gave you. <b>Open</b> a job to tick off what you finish, add before and after photos, and record what it cost.</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        {err && <div className="empty"><p>{err}</p></div>}
        {!jobs && !err && <div className="empty"><p>Loading your jobs…</p></div>}

        {jobs && (
          <div className="board">
            {LANES.map(l => {
              const cards = byLane.get(l.key) ?? [];
              return (
                <section key={l.key} className="lane">
                  <header className="lane-head">
                    <span className="lane-title">{l.title}</span>
                    <span className="lane-count">{cards.length}</span>
                  </header>
                  <div className="lane-body">
                    {cards.map(card)}
                    {cards.length === 0 && <div className="lane-empty">No jobs</div>}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
      <OpsPipelineStyle />
    </div>
  );
}
