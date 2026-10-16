'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { useProto } from '../store';
import { SharedTabs } from '../bridgeFrame';

import { VERTICAL } from '../registry';
import { DATASETS, addDays, dayDiff } from '../datasets';
import { packHref } from '../nav';
import { TODAY, WEEK_START } from '../seed';
import { Badge, Button, Chips, Drawer, PageHeader, StatusBadge, VerticalTag, fmtDate, hourLabel } from '../ui';
import type { VerticalId, WorkItem } from '../types';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** MarketSpace `.ev` colours: --c (bar/text) and --b (fill), by status. */
function evColour(stage: string) {
  if (['requested', 'pending', 'held', 'request', 'enquiry', 'new'].includes(stage)) return { c: '#b7791f', b: '#fbf0dc' };
  if (['in_progress', 'checked_in'].includes(stage)) return { c: 'var(--g9)', b: 'var(--g2)' };
  if (['completed', 'checked_out', 'cancelled'].includes(stage)) return { c: '#65716a', b: '#eef0ef' };
  return { c: 'var(--g7)', b: 'var(--g1)' };
}

function timeOf(w: WorkItem) {
  if (w.time) return w.time;
  if (w.meta.hour !== undefined) return hourLabel(Number(w.meta.hour));
  return w.dataset === 'stays' ? '15:00' : 'All day';
}

export function CalendarView() {
  const { work, context, org, approvedVerticals } = useProto();
  const [week, setWeek] = useState(WEEK_START);
  const [vf, setVf] = useState<'all' | VerticalId>('all');
  const [sel, setSel] = useState<WorkItem | null>(null);
  const verticals = approvedVerticals(org);

  const items = work.filter((w) => w.orgId === context && w.date && DATASETS[w.dataset]
    && dayDiff(week, w.date) >= 0 && dayDiff(week, w.date) < 7
    && w.dataset !== 'enrolments' && w.dataset !== 'policies' && w.dataset !== 'members'
    && (vf === 'all' || DATASETS[w.dataset].vertical === vf));

  return (
    <div>
      {approvedVerticals(org).includes('spaces') && <SharedTabs slug="calendar" active="/prototype/os/calendar" />}
      <PageHeader
        eyebrow={<Badge tone="green">Shared module</Badge>}
        title="Calendar"
        subtitle="Everything with a time attached, across verticals. Scheduling rules stay in each pack (slot grids, nightly availability, session capacity); this is the unified agenda."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[150px] text-center text-sm font-semibold">{fmtDate(week)} – {fmtDate(addDays(week, 6)).replace(' 2026', '')}</span>
            <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setWeek(WEEK_START)}>This week</Button>
          </div>
        }
      />
      <div className="mb-4">
        <Chips value={vf} onChange={setVf} items={[{ id: 'all', label: 'All verticals' }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} />
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {DAY_NAMES.map((d, i) => {
          const date = addDays(week, i);
          const dayItems = items.filter((w) => w.date === date).sort((a, b) => timeOf(a).localeCompare(timeOf(b)));
          const isToday = date === TODAY;
          return (
            <div key={d} className={cn('flex min-h-[240px] flex-col overflow-hidden rounded-[var(--r)] border border-[var(--line)]', isToday ? 'bg-[#fbfdfb]' : 'bg-white')}>
              <div className="mb-2 flex flex-col items-center border-b border-[var(--line)] py-2.5">
                <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--ink3)]">{d}</span>
                <span className={cn('mt-0.5 grid h-8 w-8 place-items-center rounded-full text-[18px] font-bold', isToday ? 'bg-[var(--g7)] text-white' : 'text-[var(--ink)]')}>{Number(date.slice(8))}</span>
              </div>
              <div className="flex flex-col gap-1.5 px-2 pb-2">
                {dayItems.length === 0 && <span className="px-1 text-xs text-[var(--line2)]">—</span>}
                {dayItems.map((w) => {
                  const v = VERTICAL[DATASETS[w.dataset].vertical];
                  const c = evColour(w.stage);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setSel(w)}
                      className="rounded-lg border-l-[3px] px-2 py-1.5 text-left transition hover:shadow-[var(--sh)] hover:brightness-[.97]"
                      style={{ borderLeftColor: c.c, background: c.b }}
                    >
                      <div className="text-[11px] font-bold tabular-nums text-[var(--ink3)]">{timeOf(w)} · {v.short}</div>
                      <div className="truncate text-[12.5px] font-bold leading-tight text-[var(--ink)]">{w.title}</div>
                      <div className="truncate text-[11.5px] text-[var(--ink3)]">{w.dataset === 'clinic' ? 'Patient restricted' : w.customer}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2.5 text-[12.5px] font-semibold text-[var(--ink2)]">
        {[['Confirmed / scheduled', 'var(--g7)'], ['Awaiting action', '#b7791f'], ['In progress', 'var(--g9)'], ['Done / cancelled', '#65716a']].map(([l, c]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />{l}</span>
        ))}
      </div>

      {sel && (() => {
        const ds = DATASETS[sel.dataset];
        return (
          <Drawer open onClose={() => setSel(null)} title={sel.title} subtitle={<span className="flex items-center gap-2"><VerticalTag v={ds.vertical} /> {ds.noun} · {sel.id}</span>}
            footer={<Link href={packHref(ds.vertical, ds.module)}><Button>Open in {VERTICAL[ds.vertical].label}</Button></Link>}>
            <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
              <dt className="text-[var(--ink3)]">When</dt><dd>{fmtDate(sel.date)} · {timeOf(sel)}</dd>
              <dt className="text-[var(--ink3)]">Status</dt><dd><StatusBadge status={sel.stage} /></dd>
              <dt className="text-[var(--ink3)]">Customer</dt><dd>{sel.dataset === 'clinic' ? <span className="inline-flex items-center gap-1 text-[var(--ink3)]"><Lock className="h-3.5 w-3.5" aria-hidden />Restricted — open in Health</span> : sel.customer}</dd>
              {sel.assignee && <><dt className="text-[var(--ink3)]">Assigned</dt><dd>{sel.assignee}</dd></>}
            </dl>
          </Drawer>
        );
      })()}
    </div>
  );
}
