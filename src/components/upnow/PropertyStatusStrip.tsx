'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Two lines under a property's stat strip — where its building inspection and
 * its market rate update stand, simplified (owner, 7 Oct 2026: "It should show
 * the status under property details page for inspection and rates update also
 * in a simplified way").
 *
 *   Inspection — the property's latest building-inspection visit (Building
 *                inspections module): Due / Overdue / Awaiting review / Approved /
 *                Returned, with the period and the inspector; "Not scheduled"
 *                when the building has no schedule. A manager without the
 *                Inspections permission sees no line (the API refuses).
 *   Rates      — this property's own market rate review position: reviewed when
 *                a layout's asking rent was set in the current window, else due
 *                by / overdue since the landlord's deadline (Settings → Rules).
 */
interface Visit {
  id: number; propertyId: number; periodLabel: string; dueDate: string; status: 'due' | 'submitted' | 'approved' | 'returned';
  overdue: boolean; inspectorName: string | null; submittedAt?: string | null; reviewedAt?: string | null;
}
interface Schedule { propertyId: number; frequency: 'monthly' | 'quarterly' | 'off' }
interface Review {
  window: { label: string; due: string };
  property: { state: 'reviewed' | 'due' | 'overdue'; summary: string; lastUpdate: { on: string; by: string | null } | null } | null;
}

type Tone = 'green' | 'orange' | 'red' | 'grey';
const TONE: Record<Tone, { dot: string; fg: string }> = {
  green: { dot: '#1a7a5a', fg: '#14532d' }, orange: { dot: '#b45309', fg: '#7c3e0a' }, red: { dot: '#b91c1c', fg: '#7f1d1d' }, grey: { dot: '#9aa39c', fg: '#5a635c' },
};
const dmy = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${Number(dd)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]} ${y}`;
};

export function PropertyStatusStrip({ propertyId, rp }: { propertyId: number; rp?: number | null }) {
  const q = rp != null ? `rp=${rp}` : '';
  const base = rp != null ? '/dashboard/manager' : '/rental-provider/dashboard';
  const [visit, setVisit] = useState<Visit | null | undefined>(undefined);   // undefined = not loaded / not allowed
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined);
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    let on = true;
    const get = async <T,>(path: string): Promise<T | undefined> => {
      try {
        const r = await fetch(`/api${path}`, { credentials: 'include' });
        return r.ok ? ((await r.json()) as T) : undefined;
      } catch { return undefined; }
    };
    void (async () => {
      const [visits, schedules, rev] = await Promise.all([
        get<Visit[]>(`/building-inspections/visits?status=all${q ? `&${q}` : ''}`),
        get<Schedule[]>(`/building-inspections/schedules${q ? `?${q}` : ''}`),
        get<Review>(`/operation-plan/market-review?propertyId=${propertyId}${q ? `&${q}` : ''}`),
      ]);
      if (!on) return;
      // The latest visit for this building: an open one first, else the most recent by due date.
      const mine = (visits ?? []).filter((v) => v.propertyId === propertyId);
      const open = mine.filter((v) => v.status === 'due' || v.status === 'returned').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const latest = open[0] ?? mine.sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0] ?? null;
      setVisit(visits ? latest : undefined);
      setSchedule(schedules ? schedules.find((s) => s.propertyId === propertyId) ?? null : undefined);
      setReview(rev ?? null);
    })();
    return () => { on = false; };
  }, [propertyId, q]);

  type Line = { label: string; tone: Tone; state: string; detail: string; href?: string };
  const lines: Line[] = [];

  if (visit !== undefined) {
    if (visit) {
      const tone: Tone = visit.status === 'approved' ? 'green' : visit.overdue ? 'red' : visit.status === 'submitted' ? 'orange' : visit.status === 'returned' ? 'red' : 'orange';
      const state = visit.status === 'approved' ? 'Approved' : visit.overdue ? 'Overdue' : visit.status === 'submitted' ? 'Awaiting review' : visit.status === 'returned' ? 'Returned' : 'Due';
      const when = visit.status === 'approved' ? (visit.reviewedAt ? `on ${dmy(visit.reviewedAt)}` : '') : visit.status === 'submitted' ? (visit.submittedAt ? `submitted ${dmy(visit.submittedAt)}` : '') : `by ${dmy(visit.dueDate)}`;
      lines.push({ label: 'Inspection', tone, state, detail: [visit.periodLabel, when, visit.inspectorName ? `· ${visit.inspectorName}` : ''].filter(Boolean).join(' · ').replace(' · · ', ' · '), href: `${base}/building-inspections/${visit.id}${q ? `?${q}` : ''}` });
    } else if (schedule === null || schedule?.frequency === 'off') {
      lines.push({ label: 'Inspection', tone: 'grey', state: 'Not scheduled', detail: rp == null ? 'Set a frequency under Settings → Building inspections' : '', href: rp == null ? '/rental-provider/dashboard/settings?tab=building_inspections' : undefined });
    }
  }
  if (review?.property) {
    const p = review.property;
    lines.push({ label: 'Rates', tone: p.state === 'reviewed' ? 'green' : p.state === 'due' ? 'orange' : 'red', state: p.state === 'reviewed' ? 'Reviewed' : p.state === 'due' ? 'Due' : 'Overdue', detail: `${review.window.label.replace(/\s*\(.*\)$/, '')} · ${p.state === 'reviewed' ? `${dmy(p.lastUpdate?.on)} · ${review.property.summary.replace(/^.*· /, '')}` : `${p.state === 'due' ? 'by' : 'since'} ${dmy(review.window.due)} · last ${p.lastUpdate ? dmy(p.lastUpdate.on) : 'never'}`}` });
  }
  if (!lines.length) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: lines.length > 1 ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr', gap: 8, marginTop: -14, marginBottom: 24 }}>
      {lines.map((l) => {
        const t = TONE[l.tone];
        const body = (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: '1px solid #e7ebe6', borderRadius: 12, background: '#fbfcfb', fontSize: 12.5, color: '#5a635c' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: t.dot, flexShrink: 0, marginTop: 5 }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: '#a0a8a1', textTransform: 'uppercase', minWidth: 72, marginTop: 3 }}>{l.label}</span>
            <b style={{ color: t.fg, whiteSpace: 'nowrap' }}>{l.state}</b>
            <span style={{ minWidth: 0, lineHeight: 1.35 }}>{l.detail}</span>
          </div>
        );
        return l.href ? <Link key={l.label} href={l.href} style={{ textDecoration: 'none', minWidth: 0 }}>{body}</Link> : <div key={l.label} style={{ minWidth: 0 }}>{body}</div>;
      })}
    </div>
  );
}
