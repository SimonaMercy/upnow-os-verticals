/**
 * Technician · Earnings (SP-182) — what the jobs I did were worth once the
 * customer's money was released from escrow (Gate 6). Per-job rows (gross,
 * platform commission, VAT withheld, net), period totals, and a monthly bar
 * chart. Read-only. "Net" is the job's value net of commission + VAT — for a
 * company crew that is what the COMPANY receives for the job (no per-technician
 * pay split until SP-198); for a solo operator it is literally theirs.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Coins, Loader2, ShieldAlert, Wallet } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { apiGet } from '@/lib/api';
import { DashboardPage } from '@/components/dashboard/DashboardWidgets';

/* ── Types (mirror EscrowService.earningsForTechnician + TechnicianController.myEarnings) ── */
interface Row {
  bookingId: number; serviceName: string | null; status: string; kind: 'job' | 'cancellation_fee'; disputed: boolean;
  gross: number; vat: number; commission: number | null; net: number | null; earnedAt: string | null; refundReason: string | null;
}
interface Earnings {
  technicianId: number; payee: 'self' | 'company'; providerName: string | null; currency: string;
  period: { from: string | null; to: string | null };
  summary: { netEarned: number; grossEarned: number; commissionPaid: number; vatWithheld: number; jobsPaid: number; pendingHeld: number; jobsPending: number; atRiskHeld: number; jobsAtRisk: number; jobsReversed: number };
  series: Array<{ month: string; gross: number; commission: number; vat: number; net: number; jobs: number }>;
  jobs: Row[];
}

/* ── Tokens (SP portal, design 2a) ─────────────────────────────────────── */
const GREEN = '#0B7A4E'; const INK = '#182420'; const MUTE = '#55645B'; const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2'; const HAIRLINE = '1px solid #EEF1EE';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' }) : '—');
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-AE', { month: 'short', year: '2-digit' });
const REFUND_LABEL: Record<string, string> = {
  customer_cancelled: 'Customer cancelled', provider_cancelled: 'Provider cancelled', provider_no_show: 'Provider no-show', customer_no_show: 'Customer no-show',
  dispute_upheld: 'Dispute upheld', goodwill: 'Goodwill refund', admin_cancelled: 'Cancelled by UpNow', duplicate: 'Duplicate booking', service_unavailable: 'Service unavailable',
};

type Period = 'month' | '3m' | '12m' | 'custom';
function periodRange(p: Period, custom: { from: string; to: string }): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now.getTime() + 864e5);
  if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to };
  if (p === '3m') return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to };
  if (p === '12m') return { from: new Date(now.getFullYear(), now.getMonth() - 11, 1), to };
  const f = custom.from ? new Date(custom.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const t = custom.to ? new Date(new Date(custom.to).getTime() + 864e5) : to;
  return { from: f, to: t };
}

function Tile({ label, value, sub, tone = 'ink', icon: Icon }: { label: string; value: string; sub?: string; tone?: 'ink' | 'green' | 'amber' | 'red'; icon?: React.ComponentType<{ size?: number; color?: string }> }) {
  const color = tone === 'green' ? GREEN : tone === 'amber' ? '#B45309' : tone === 'red' ? '#B42318' : INK;
  return (
    <div style={card({ padding: '12px 14px' })}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 11.5, color: FAINT }}>{label}</p>
        {Icon && <Icon size={14} color={FAINT} />}
      </div>
      <p style={{ fontSize: 20, fontWeight: 800, color, marginTop: 2 }}>{value}</p>
      {sub && <p style={{ fontSize: 11.5, color: MUTE, marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

function RowFlag({ r }: { r: Row }) {
  if (r.status === 'refunded') return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#F3F4F6', color: '#6B7280' }}>Reversed{r.refundReason ? ` · ${REFUND_LABEL[r.refundReason] ?? r.refundReason.replace(/_/g, ' ')}` : ''}</span>;
  if (r.status === 'funded') return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FEF6E7', color: '#92400E' }}>Pending release</span>;
  if (r.disputed) return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#FDECEC', color: '#B42318' }}>Disputed · at risk</span>;
  if (r.kind === 'cancellation_fee') return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#EEF2FF', color: '#4338CA' }}>Cancellation fee</span>;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#E9F4EE', color: GREEN }}>Paid</span>;
}

export default function TechnicianEarningsPage() {
  const [period, setPeriod] = useState<Period>('3m');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [data, setData] = useState<Earnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const load = useCallback(async () => {
    setError(null); setLoading(true);
    try {
      setData(await apiGet<Earnings>(`/technician/me/earnings?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}`));
    } catch (e) { setError((e as Error)?.message || 'Could not load your earnings.'); } finally { setLoading(false); }
  }, [range]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

  const s = data?.summary;
  const self = data?.payee === 'self';
  const netLabel = self ? 'Your net' : 'Net to your company';
  const chart = useMemo(() => (data?.series ?? []).map((m) => ({ ...m, label: monthLabel(m.month) })), [data]);

  return (
    <DashboardPage
      title="Earnings"
      subtitle={self ? 'What your completed jobs paid out once the customer’s money was released.' : `What the jobs you did were worth to ${data?.providerName ?? 'your company'} once the customer’s money was released.`}
    >
      {error && <div style={{ ...card({ background: '#FDECEC', border: '1px solid #F3C4C4', padding: '10px 14px', marginBottom: 14, color: '#B42318', fontSize: 13 }) }}>{error}</div>}

      {/* Period picker — one row above the charts */}
      <div style={{ ...card({ padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }) }}>
        {([['month', 'This month'], ['3m', 'Last 3 months'], ['12m', 'Last 12 months'], ['custom', 'Custom']] as Array<[Period, string]>).map(([k, l]) => (
          <button key={k} onClick={() => setPeriod(k)}
            style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: period === k ? `1px solid ${GREEN}` : BORDER, background: period === k ? '#E9F4EE' : '#fff', color: period === k ? GREEN : MUTE }}>
            {l}
          </button>
        ))}
        {period === 'custom' && (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: MUTE }}>
            <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} style={{ border: BORDER, borderRadius: 8, padding: '5px 8px', fontSize: 12.5 }} />
            to
            <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} style={{ border: BORDER, borderRadius: 8, padding: '5px 8px', fontSize: 12.5 }} />
          </span>
        )}
        <span style={{ flex: 1 }} />
        {loading && <Loader2 size={14} className="animate-spin" color={FAINT} />}
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Tile label={netLabel} value={s ? aed(s.netEarned) : '—'} sub={s ? `${s.jobsPaid} job${s.jobsPaid === 1 ? '' : 's'} paid` : undefined} tone="green" icon={Wallet} />
        <Tile label="Gross billed" value={s ? aed(s.grossEarned) : '—'} sub="incl. VAT, before commission" icon={Coins} />
        <Tile label="Platform commission" value={s ? aed(s.commissionPaid) : '—'} sub="deducted on net-of-VAT" />
        <Tile label="VAT withheld" value={s ? aed(s.vatWithheld) : '—'} sub="remitted by UpNow" />
        <Tile label="Pending release" value={s ? aed(s.pendingHeld) : '—'} sub={s ? `${s.jobsPending} funded, not yet released` : undefined} tone="amber" />
        {s && s.jobsAtRisk > 0 && <Tile label="At risk (disputed)" value={aed(s.atRiskHeld)} sub={`${s.jobsAtRisk} job${s.jobsAtRisk === 1 ? '' : 's'} under dispute`} tone="red" icon={ShieldAlert} />}
      </div>

      {/* Chart — one series (net per month); gross/commission/VAT in the tooltip */}
      <div style={{ ...card({ padding: '14px 16px', marginBottom: 14 }) }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: INK }}>{netLabel} by month</p>
          <p style={{ fontSize: 11.5, color: FAINT }}>AED · release month (Asia/Dubai)</p>
        </div>
        {chart.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="#EEF1EE" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: MUTE }} />
              <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11, fill: FAINT }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
              <Tooltip
                cursor={{ fill: '#F5F7F4' }}
                contentStyle={{ border: BORDER, borderRadius: 10, fontSize: 12, color: INK }}
                formatter={(v: unknown, _n: unknown, item: { payload?: { gross: number; commission: number; vat: number; jobs: number } }) => {
                  const p = item?.payload;
                  return [`${aed(Number(v))}${p ? ` · ${p.jobs} job${p.jobs === 1 ? '' : 's'} · gross ${aed(p.gross)} · commission ${aed(p.commission)} · VAT ${aed(p.vat)}` : ''}`, 'Net'] as [string, string];
                }}
              />
              <Bar dataKey="net" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ fontSize: 12.5, color: MUTE, padding: '24px 0', textAlign: 'center' }}>{loading ? 'Loading…' : 'Nothing released in this period yet.'}</p>
        )}
      </div>

      {/* Table */}
      <div style={card({ overflow: 'hidden' })}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ color: FAINT, fontWeight: 600, textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', borderBottom: BORDER }}>Job</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER }}>Released</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER, textAlign: 'right' }}>Gross</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER, textAlign: 'right' }}>Commission</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER, textAlign: 'right' }}>VAT</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER, textAlign: 'right' }}>{netLabel}</th>
                <th style={{ padding: '10px 12px', borderBottom: BORDER }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {!data || !data.jobs.length ? (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', color: MUTE }}>{loading ? 'Loading…' : 'No jobs with released money yet. Earnings appear here after a completed job’s payment is released.'}</td></tr>
              ) : data.jobs.map((r) => {
                const muted = r.status === 'refunded' || r.status === 'funded';
                return (
                  <tr key={r.bookingId} style={{ color: muted ? FAINT : INK }}>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE }}><b>BK-{r.bookingId}</b><div style={{ fontSize: 11.5, color: MUTE }}>{r.serviceName ?? '—'}</div></td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE }}>{fmtDate(r.earnedAt)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE, textAlign: 'right' }}>{aed(r.gross)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE, textAlign: 'right' }}>{r.commission != null ? aed(r.commission) : '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE, textAlign: 'right' }}>{aed(r.vat)}</td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE, textAlign: 'right', fontWeight: 700 }}>{r.net != null && r.status !== 'refunded' ? aed(r.net) : '—'}</td>
                    <td style={{ padding: '10px 12px', borderBottom: HAIRLINE }}><RowFlag r={r} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
        <span>
          Figures come from released escrow only and reconcile to the platform ledger. {self
            ? 'As a solo operator the net is paid to your registered bank account by UpNow.'
            : 'The net is what your company receives for the job — your own pay is agreed with your company, not with UpNow.'}
        </span>
      </p>
    </DashboardPage>
  );
}
