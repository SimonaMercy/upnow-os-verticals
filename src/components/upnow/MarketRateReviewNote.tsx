'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';

/**
 * One line on the Units page: where this period's market rate review stands.
 *
 * Owner, 7 Oct 2026: "Each quarter manager will review the market rates and
 * update the rates in the unit mix before sending the renewal … we will display
 * to manager." The schedule is the landlord's (Settings → Rules → Renewal); the
 * position is read off the system — reviewed once a layout's asking rent was set
 * in the period's window, due until the due day, overdue after it.
 */
interface Review {
  state: 'reviewed' | 'due' | 'overdue';
  window: { label: string; due: string };
  next: { label: string; due: string };
  lastUpdate: { on: string; by: string | null } | null;
  updated: { layouts: number; units: number };
  layouts: number;
  renewals: { sent: number; beforeReview: number };
  summary: string;
}

const TONE = {
  reviewed: { dot: '#1a7a5a', bg: '#eef7f2', fg: '#14532d', label: 'Reviewed' },
  due:      { dot: '#b45309', bg: '#fff4e5', fg: '#7c3e0a', label: 'Due' },
  overdue:  { dot: '#b91c1c', bg: '#fee2e2', fg: '#7f1d1d', label: 'Overdue' },
} as const;

const dmy = (d: string) => {
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]} ${y}`;
};

export function MarketRateReviewNote({ rpQ }: { rpQ?: string }) {
  const [r, setR] = useState<Review | null>(null);
  useEffect(() => {
    let on = true;
    apiGet<Review>(`/operation-plan/market-review${rpQ ? `?${rpQ}` : ''}`).then((d) => { if (on) setR(d); }).catch(() => { /* no line when it cannot be read */ });
    return () => { on = false; };
  }, [rpQ]);
  if (!r) return null;
  const t = TONE[r.state];
  const n = r.renewals.sent;
  const offers = n
    ? `${n} renewal offer${n === 1 ? '' : 's'} sent this period${r.state === 'reviewed' ? (r.renewals.beforeReview ? `, ${r.renewals.beforeReview} before the review` : ', after the review') : ', before the review'}`
    : null;
  return (
    <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: t.bg, color: t.fg, fontSize: 12.5 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: t.dot, flexShrink: 0 }} />
      <b>Market rate review · {r.window.label}</b>
      <span>— {r.summary}</span>
      {offers && <span style={{ opacity: .85 }}>· {offers}</span>}
      {r.state === 'reviewed' && <span style={{ opacity: .85 }}>· next by {dmy(r.next.due)}</span>}
      {!rpQ && <Link href="/rental-provider/dashboard/settings?tab=fee_rules" style={{ marginLeft: 'auto', fontWeight: 600, textDecoration: 'underline' }}>Schedule</Link>}
    </div>
  );
}
