'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

/* Tokens shared with the SP dashboard (design 2a). */
const GREEN = '#0B7A4E';
const INK = '#182420';
const MUTE = '#4A544D';
const FAINT = '#8A968D';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const TINT_GREEN = '#E9F4EE';
const TINT_AMBER = '#FEF6E7';
const AMBER = '#C77D0A';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });
const aed = (n: number | string) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface TimelineStep { key: string; label: string; at: string | null; done: boolean }
interface Booking {
  id: number; status: string; pricingMode: string | null; serviceName: string | null; packageName: string | null;
  totalAmount: number | string | null; scheduledAt: string; hours: number | null; addressText: string | null;
  tenant?: { user?: { name?: string | null } | null } | null; timeline?: TimelineStep[];
}
interface Technician { id: number; name: string; jobStatus: string }
interface TeamMember { id: number; name: string; isLeadCapable: boolean }
interface QuoteItem { itemName: string; quantity: number | string; unitPrice: number | string; lineTotal: number | string }
interface Quote { id: number; status: string; totalAmount: number | string; summary?: string | null; validUntil?: string | null; items: QuoteItem[] }
interface JobDetail { booking: Booking; technician: Technician | null; team: TeamMember[]; quote: Quote | null }

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  booked: { label: 'Awaiting quote approval', bg: TINT_AMBER, fg: AMBER },
  confirmed: { label: 'Confirmed', bg: TINT_GREEN, fg: GREEN },
  assigned: { label: 'Assigned', bg: '#E0F2FE', fg: '#0369A1' },
  en_route: { label: 'On the way', bg: '#E0F2FE', fg: '#0369A1' },
  in_progress: { label: 'In progress', bg: '#E0E7FF', fg: '#4338CA' },
  completed: { label: 'Completed', bg: TINT_GREEN, fg: GREEN },
  cancelled: { label: 'Cancelled', bg: '#FEE2E2', fg: '#991B1B' },
};
const NEXT: Record<string, { label: string; to: string }> = {
  assigned: { label: "I'm on my way", to: 'en_route' },
  en_route: { label: 'Start the job', to: 'in_progress' },
  in_progress: { label: 'Mark complete', to: 'completed' },
};
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
  new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

const emptyRow = () => ({ itemName: '', quantity: '1', unitPrice: '' });

export default function ProviderJobPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([emptyRow()]);
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    try { setData(await apiGet<JobDetail>(`/bookings/${id}/job`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load this job'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const reassign = async (technicianId: number) => {
    setBusy(true);
    try { await apiPatch(`/bookings/${id}/technician`, { technicianId }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not reassign'); }
    finally { setBusy(false); }
  };
  const advance = async (to: string) => {
    setBusy(true);
    try { await apiPatch(`/bookings/${id}/status`, { status: to }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update status'); }
    finally { setBusy(false); }
  };
  const submitQuote = async () => {
    const items = rows
      .filter((r) => r.itemName.trim() && Number(r.unitPrice) > 0)
      .map((r) => ({ itemName: r.itemName.trim(), quantity: Number(r.quantity) || 1, unitPrice: Number(r.unitPrice) }));
    if (!items.length) { setError('Add at least one priced line.'); return; }
    setBusy(true);
    try { await apiPost(`/bookings/${id}/quote`, { items, summary: summary.trim() || undefined }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not submit quote'); }
    finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading job…</div>;
  if (error && !data) return <div style={{ padding: 24, color: '#B42318' }}>{error}</div>;
  if (!data) return null;

  const { booking: b, technician, team, quote } = data;
  const st = STATUS[b.status] ?? STATUS.booked;
  const isQuote = b.pricingMode === 'quote';
  const next = NEXT[b.status];
  const draftTotal = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);
  const label = `${b.serviceName ?? 'Service'}${b.packageName ? ` — ${b.packageName}` : ''}`;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '4px 2px 48px' }}>
      <Link href="/dashboard/service-provider/operations" style={{ fontSize: 13, color: FAINT, textDecoration: 'none' }}>← Operations</Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, letterSpacing: '-.01em' }}>{label}</h1>
        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '4px 10px', background: st.bg, color: st.fg }}>{st.label}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: FAINT }}>BK-{b.id}</span>
      </div>

      {error && <div style={{ marginTop: 12, background: '#FEF2F2', color: '#B42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {/* Job facts */}
      <div style={card({ marginTop: 16, padding: '16px 18px' })}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 14 }}>
          <div><div style={lbl}>Customer</div><div style={val}>{b.tenant?.user?.name ?? 'Customer'}</div></div>
          <div><div style={lbl}>When</div><div style={val}>{fmtWhen(b.scheduledAt)}{b.hours ? ` · ${b.hours}h` : ''}</div></div>
          <div><div style={lbl}>Address</div><div style={val}>{b.addressText ?? '—'}</div></div>
          <div><div style={lbl}>Price</div><div style={val}>{b.totalAmount != null ? aed(b.totalAmount) : (isQuote ? 'To be quoted' : '—')}</div></div>
        </div>
      </div>

      {/* Technician */}
      <div style={card({ marginTop: 14, padding: '16px 18px' })}>
        <div style={lbl}>Assigned technician</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: TINT_GREEN, color: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14 }}>
            {(technician?.name ?? '?').slice(0, 1)}
          </div>
          <span style={{ fontWeight: 600, color: INK, fontSize: 15 }}>{technician?.name ?? 'No one assigned yet'}</span>
          <select
            value={technician?.id ?? ''}
            disabled={busy}
            onChange={(e) => reassign(Number(e.target.value))}
            style={{ marginLeft: 'auto', border: BORDER, borderRadius: 9, padding: '7px 10px', fontSize: 13, color: INK, background: '#fff' }}
          >
            <option value="" disabled>Reassign…</option>
            {team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isLeadCapable ? ' (lead)' : ''}</option>)}
          </select>
        </div>
      </div>

      {/* Quote entry / status (quote services only) */}
      {isQuote && (
        <div style={card({ marginTop: 14, padding: '16px 18px' })}>
          <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>Quote</div>
          {!quote || quote.status === 'draft' ? (
            <>
              <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>After your assessment, price the job. The customer approves and pays before you start.</p>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <input placeholder="Line item (e.g. Labour)" value={r.itemName}
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, itemName: e.target.value } : x))}
                      style={{ flex: 1, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK }} />
                    <input placeholder="Qty" value={r.quantity} inputMode="numeric"
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                      style={{ width: 58, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, textAlign: 'center' }} />
                    <input placeholder="AED" value={r.unitPrice} inputMode="decimal"
                      onChange={(e) => setRows((p) => p.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))}
                      style={{ width: 90, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, textAlign: 'right' }} />
                    {rows.length > 1 && (
                      <button onClick={() => setRows((p) => p.filter((_, j) => j !== i))} style={{ border: BORDER, borderRadius: 9, background: '#fff', color: FAINT, width: 34, cursor: 'pointer' }}>×</button>
                    )}
                  </div>
                ))}
                <button onClick={() => setRows((p) => [...p, emptyRow()])} style={{ alignSelf: 'flex-start', fontSize: 13, color: GREEN, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add line</button>
              </div>
              <input placeholder="Summary for the customer (optional)" value={summary} onChange={(e) => setSummary(e.target.value)}
                style={{ width: '100%', marginTop: 8, border: BORDER, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>Total {aed(draftTotal)}</span>
                <button disabled={busy || draftTotal <= 0} onClick={submitQuote}
                  style={{ background: GREEN, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, opacity: busy || draftTotal <= 0 ? 0.5 : 1, cursor: 'pointer' }}>
                  {busy ? 'Sending…' : 'Send quote to customer'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: quote.status === 'approved' ? TINT_GREEN : TINT_AMBER, color: quote.status === 'approved' ? GREEN : AMBER }}>
                  {quote.status === 'approved' ? 'Approved by customer' : 'Sent — awaiting customer approval'}
                </span>
              </div>
              {quote.summary && <p style={{ fontSize: 13, color: MUTE, marginTop: 8 }}>{quote.summary}</p>}
              <div style={{ marginTop: 10 }}>
                {quote.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: INK, padding: '4px 0' }}>
                    <span>{it.itemName}{Number(it.quantity) > 1 ? ` × ${it.quantity}` : ''}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{aed(it.lineTotal)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: HAIRLINE, fontWeight: 700, color: INK }}>
                <span>Total</span><span>{aed(quote.totalAmount)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status action */}
      <div style={card({ marginTop: 14, padding: '16px 18px' })}>
        <div style={lbl}>Job progress</div>
        {b.status === 'booked' && isQuote ? (
          <p style={{ fontSize: 14, color: MUTE, marginTop: 8 }}>Waiting for the customer to approve your quote. You&apos;ll be able to start once they pay.</p>
        ) : next ? (
          <button disabled={busy} onClick={() => advance(next.to)}
            style={{ marginTop: 10, width: '100%', background: GREEN, color: '#fff', border: 'none', borderRadius: 11, padding: '12px', fontSize: 15, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
            {busy ? 'Updating…' : next.label}
          </button>
        ) : (
          <p style={{ fontSize: 14, color: GREEN, marginTop: 8, fontWeight: 600 }}>✓ Job {b.status}.</p>
        )}
        {b.timeline && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {b.timeline.map((s) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${s.done ? GREEN : '#DDE2DD'}`, background: s.done ? GREEN : 'transparent' }} />
                <span style={{ color: s.done ? INK : FAINT, fontWeight: s.done ? 600 : 400 }}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: FAINT };
const val: React.CSSProperties = { color: INK, marginTop: 3, fontWeight: 500 };
