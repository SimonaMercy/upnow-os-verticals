/**
 * SpReliabilityCard (SP-229) — the provider's own reliability ledger, shown
 * plainly (Careem lesson: the provider must see the same numbers ops sees).
 * Observational: standing is a label for a conversation, never a block.
 */
'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Star } from 'lucide-react';
import { apiGet } from '@/lib/api';

export interface ReliabilityLedger {
  serviceProviderId: number; standing: 'good' | 'watch' | 'at_risk' | 'insufficient_data'; flags: string[];
  window: { days: number; from: string; to: string };
  offers: { received: number; accepted: number; declined: number; acceptancePct: number | null; medianAcceptMin: number | null };
  arrivals: { measured: number; onTime: number; late: number; onTimePct: number | null };
  jobs: { completed: number; cancelledByProvider: number; providerNoShows: number };
  passes: { used: number; allowance: number; remaining: number; monthLabel: string };
  sla: { assign: number; acknowledge: number; arrival: number; complete: number; total: number };
  rating: { average: number | null; count: number };
}

export const STANDING_UI: Record<ReliabilityLedger['standing'], { label: string; bg: string; fg: string }> = {
  good:              { label: 'Good standing', bg: '#E9F4EE', fg: '#0B7A4E' },
  watch:             { label: 'Watch',         bg: '#FEF6E7', fg: '#92400E' },
  at_risk:           { label: 'At risk',       bg: '#FDECEC', fg: '#B42318' },
  insufficient_data: { label: 'Not enough jobs yet', bg: '#F3F4F6', fg: '#6B7280' },
};

const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D'; const BORDER = '1px solid #E4E7E2';
const p = (v: number | null) => (v == null ? '—' : `${v}%`);

export function SpReliabilityCard({ endpoint = '/service-provider/reliability', days = 90, compact }: { endpoint?: string; days?: number; compact?: boolean }) {
  const [l, setL] = useState<ReliabilityLedger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      apiGet<ReliabilityLedger | ReliabilityLedger[]>(`${endpoint}${endpoint.includes('?') ? '&' : '?'}days=${days}`)
        .then((r) => setL(Array.isArray(r) ? r[0] ?? null : r))
        .catch((e) => setErr((e as Error)?.message || 'Could not load reliability.'));
    }, 0);
    return () => clearTimeout(t);
  }, [endpoint, days]);
  if (err) return null;
  if (!l) return <div style={{ border: BORDER, borderRadius: 14, padding: 14, fontSize: 12.5, color: FAINT, background: '#fff' }}>Loading reliability…</div>;
  const st = STANDING_UI[l.standing];
  const Icon = l.standing === 'good' ? ShieldCheck : l.standing === 'insufficient_data' ? ShieldQuestion : ShieldAlert;
  const tile = (label: string, value: string, sub?: string, tone: 'ink' | 'red' | 'amber' = 'ink') => (
    <div style={{ minWidth: compact ? 110 : 130 }}>
      <p style={{ fontSize: 11, color: FAINT }}>{label}</p>
      <p style={{ fontSize: compact ? 16 : 18, fontWeight: 800, color: tone === 'red' ? '#B42318' : tone === 'amber' ? '#B45309' : INK }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: MUTE }}>{sub}</p>}
    </div>
  );
  return (
    <div style={{ border: BORDER, borderRadius: 14, padding: compact ? '12px 14px' : '14px 16px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon size={16} color={st.fg} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Reliability</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.fg }}>{st.label}</span>
        <span style={{ fontSize: 11.5, color: FAINT }}>last {l.window.days} days</span>
        {l.rating.count > 0 && <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, color: INK, fontWeight: 600 }}><Star size={13} color="#D97706" /> {l.rating.average} <span style={{ color: FAINT, fontWeight: 400 }}>({l.rating.count})</span></span>}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
        {tile('Acceptance', p(l.offers.acceptancePct), `${l.offers.accepted} of ${l.offers.received + l.offers.declined} jobs${l.offers.medianAcceptMin != null ? ` · median ${l.offers.medianAcceptMin} min` : ''}`, l.offers.acceptancePct != null && l.offers.acceptancePct < 90 ? (l.offers.acceptancePct < 70 ? 'red' : 'amber') : 'ink')}
        {tile('On-time arrival', p(l.arrivals.onTimePct), `${l.arrivals.onTime} on time · ${l.arrivals.late} late`, l.arrivals.onTimePct != null && l.arrivals.onTimePct < 85 ? (l.arrivals.onTimePct < 60 ? 'red' : 'amber') : 'ink')}
        {tile('Completed', String(l.jobs.completed))}
        {tile('Emergency passes', `${l.passes.used} / ${l.passes.allowance}`, `${l.passes.remaining} left this month`, l.passes.used > l.passes.allowance ? 'red' : l.passes.used === l.passes.allowance ? 'amber' : 'ink')}
        {tile('SLA breaches', String(l.sla.total), l.sla.total ? `assign ${l.sla.assign} · ack ${l.sla.acknowledge} · arrival ${l.sla.arrival} · complete ${l.sla.complete}` : 'none', l.sla.total ? 'amber' : 'ink')}
        {tile('Cancelled / no-show', `${l.jobs.cancelledByProvider} / ${l.jobs.providerNoShows}`, 'by you')}
      </div>
      {l.flags.length > 0 && (
        <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 12.5, color: st.fg }}>
          {l.flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}
      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 8 }}>These numbers are shared with UpNow ops. Nothing here blocks dispatch or charges a fee — a slipping standing starts a conversation with your account manager.</p>
    </div>
  );
}
