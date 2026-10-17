/**
 * SlaBreachStrip (SP-253) — the ops "needs attention" strip: open SLA breaches
 * as recorded by the minute cron (a fact, not a render-time guess). Counts per
 * clock + the worst offenders, deep-linking to the booking drill-down.
 * Observational at pilot — no penalty is implied.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { apiGet } from '@/lib/api';

type Kind = 'assign' | 'acknowledge' | 'arrival' | 'complete';
interface Summary { open: number; byKind: Record<Kind, number>; detectedToday: number }
interface Breach { id: number; bookingId: number; kind: Kind; dueAt: string; detectedAt: string; lateNowMin: number; resolvedAt: string | null; status: string; serviceName: string | null; providerName: string | null; urgency: string | null }

const KIND_LABEL: Record<Kind, string> = { assign: 'Not assigned', acknowledge: 'Not acknowledged', arrival: 'No arrival', complete: 'Not completed' };
const INK = '#14201a'; const MUTE = '#5f6b63'; const FAINT = '#8a948d'; const BORDER = '1px solid #ececea';
const late = (m: number) => (m >= 60 * 24 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`);

export function SlaBreachStrip({ limit = 8 }: { limit?: number }) {
  const [sum, setSum] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Breach[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([apiGet<Summary>('/admin/sla/summary'), apiGet<Breach[]>(`/admin/sla/breaches?open=1&limit=${expanded ? 100 : limit}`)]);
      setSum(s); setRows(b);
    } catch { setSum(null); }
  }, [expanded, limit]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const sweep = async () => { setBusy(true); try { await apiGet('/admin/sla/sweep'); await load(); } finally { setBusy(false); } };

  if (!sum) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>SLA breaches — open</div>
        <span style={{ fontSize: 11.5, color: FAINT }}>{sum.detectedToday} detected today</span>
        <span style={{ flex: 1 }} />
        <button onClick={sweep} disabled={busy} title="Run the SLA sweep now (the cron runs it every minute)" style={{ border: BORDER, borderRadius: 8, background: '#fff', padding: '3px 8px', fontSize: 11.5, color: MUTE, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <RefreshCw size={11} className={busy ? 'animate-spin' : undefined} /> Sweep
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <div key={k} style={{ border: BORDER, borderRadius: 12, padding: '8px 13px', background: '#fff', borderColor: sum.byKind[k] ? '#f3c6c6' : '#ececea', minWidth: 130 }}>
            <div style={{ fontSize: 11.5, color: MUTE }}>{KIND_LABEL[k]}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: sum.byKind[k] ? '#b42318' : INK }}>{sum.byKind[k]}</div>
          </div>
        ))}
      </div>
      {rows.length > 0 && (
        <div style={{ marginTop: 8, border: BORDER, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
          {rows.map((b) => (
            <Link key={b.id} href={`/dashboard/admin/bookings/${b.bookingId}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: BORDER, fontSize: 12.5, color: INK, textDecoration: 'none' }}>
              <AlertTriangle size={13} color="#b42318" />
              <b>BK-{b.bookingId}</b>
              <span style={{ color: MUTE }}>{b.serviceName ?? '—'}{b.providerName ? ` · ${b.providerName}` : ''}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: '#FDECEC', color: '#b42318' }}>{KIND_LABEL[b.kind]}</span>
              <span style={{ fontSize: 11.5, color: FAINT }}>{b.urgency?.replace('_', ' ')} · {b.status.replace(/_/g, ' ')}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#b42318' }}>{late(b.lateNowMin)} late</span>
            </Link>
          ))}
          {sum.open > rows.length && !expanded && (
            <button onClick={() => setExpanded(true)} style={{ width: '100%', background: '#f6f8f6', border: 0, padding: '7px', fontSize: 12, color: MUTE, cursor: 'pointer' }}>Show all {sum.open}</button>
          )}
        </div>
      )}
      {sum.open === 0 && <p style={{ fontSize: 12, color: MUTE, marginTop: 6 }}>No open breaches — every live job is inside its assign / acknowledge / arrival / completion targets.</p>}
    </div>
  );
}
