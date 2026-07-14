'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';

/* Tokens shared with SpLiveOverview (design 2a). */
const GREEN = '#0B7A4E';
const INK = '#182420';
const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const AMBER = '#C77D0A';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface EarningsJob {
  bookingId: number;
  serviceName: string | null;
  status: string;
  gross: number;
  commission: number | null;
  net: number | null;
  earnedAt: string | null;
}
interface Earnings {
  currency: string;
  summary: {
    netEarned: number; commissionPaid: number; grossEarned: number;
    pendingHeld: number; jobsCompleted: number; jobsPending: number;
  };
  jobs: EarningsJob[];
}

function Tile({ label, value, sub, tint }: { label: string; value: string; sub?: string; tint?: string }) {
  return (
    <div style={card({ padding: '16px 18px' })}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, color: tint ?? INK, marginTop: 6, letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function statusPill(status: string) {
  const released = status === 'released';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px',
      color: released ? GREEN : AMBER,
      background: released ? TINT_GREEN : TINT_AMBER,
    }}>
      {released ? 'Paid out' : 'Held'}
    </span>
  );
}

export default function ServiceProviderEarningsPage() {
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Earnings>('/bookings/earnings')
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Could not load earnings'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading earnings…</div>;
  if (error) return <div style={{ padding: 24, color: '#B42318' }}>{error}</div>;
  if (!data) return null;

  const s = data.summary;
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '4px 2px 40px' }}>
      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: GREEN }}>Earnings</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Your payouts</h1>
      <p style={{ color: FAINT, fontSize: 14, marginTop: 4 }}>
        Funds are held when a job is confirmed and released to you, net of platform commission, once you complete it.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5" style={{ marginTop: 18 }}>
        <Tile label="Net earned" value={aed(s.netEarned)} sub={`${s.jobsCompleted} job${s.jobsCompleted === 1 ? '' : 's'} completed`} tint={GREEN} />
        <Tile label="Commission paid" value={aed(s.commissionPaid)} sub="Platform fee" />
        <Tile label="Pending (held)" value={aed(s.pendingHeld)} sub={`${s.jobsPending} in progress`} tint={s.pendingHeld > 0 ? AMBER : undefined} />
        <Tile label="Gross billed" value={aed(s.grossEarned)} sub="Before commission" />
      </div>

      <div style={card({ marginTop: 18, overflow: 'hidden' })}>
        <div style={{ padding: '14px 18px', borderBottom: HAIRLINE, fontSize: 13.5, fontWeight: 700, color: INK }}>
          Per-job breakdown
        </div>
        {data.jobs.length === 0 ? (
          <div style={{ padding: '34px 18px', textAlign: 'center', color: FAINT, fontSize: 14 }}>
            No earnings yet — completed jobs will appear here.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: FAINT, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  <th style={{ textAlign: 'left', padding: '10px 18px', fontWeight: 600 }}>Service</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Booking</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 600 }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Gross</th>
                  <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Commission</th>
                  <th style={{ textAlign: 'right', padding: '10px 18px', fontWeight: 600 }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j, i) => (
                  <tr key={j.bookingId} style={{ borderTop: i === 0 ? HAIRLINE : '1px solid #F4F6F3', color: INK }}>
                    <td style={{ padding: '12px 18px', fontWeight: 600 }}>{j.serviceName ?? '—'}</td>
                    <td style={{ padding: '12px 12px', color: FAINT }}>BK-{j.bookingId}</td>
                    <td style={{ padding: '12px 12px' }}>{statusPill(j.status)}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right' }}>{aed(j.gross)}</td>
                    <td style={{ padding: '12px 12px', textAlign: 'right', color: FAINT }}>{j.commission != null ? `− ${aed(j.commission)}` : '—'}</td>
                    <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: j.net != null ? GREEN : FAINT }}>{j.net != null ? aed(j.net) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p style={{ marginTop: 14, fontSize: 12, color: FAINT }}>
        Pilot: payouts are settled manually. Automated bank disbursement arrives with the payment gateway.
      </p>
    </div>
  );
}
