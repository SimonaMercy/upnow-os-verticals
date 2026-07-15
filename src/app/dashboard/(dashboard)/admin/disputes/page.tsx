'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });
const aed = (n: number | string | null) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-AE')}`);

interface Dispute {
  id: number; status: string; title: string; description: string | null; resolutionSummary: string | null;
  openedAt: string; resolvedAt: string | null; bookingId: number | null; serviceName: string | null;
  amount: number | string | null; customerName: string; providerName: string | null;
  providerResponse: string | null;
}
const OPEN = new Set(['open', 'under_review', 'awaiting_evidence']);
const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  open: { label: 'Open', bg: '#fee2e2', fg: '#991b1b' },
  under_review: { label: 'Under review', bg: '#fef3c7', fg: '#92400e' },
  resolved: { label: 'Refunded', bg: '#d8f2e8', fg: '#1a7a5a' },
  rejected: { label: 'For provider', bg: '#eef1ee', fg: '#4b5563' },
  closed: { label: 'Closed', bg: '#eef1ee', fg: '#4b5563' },
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try { setDisputes(await apiGet<Dispute[]>('/disputes')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load disputes'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const resolve = async (id: number, outcome: 'refund_customer' | 'favor_provider') => {
    setBusy(id);
    try { await apiPatch(`/disputes/${id}/resolve`, { outcome }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not resolve'); }
    finally { setBusy(null); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading disputes…</div>;
  const openCount = disputes.filter((d) => OPEN.has(d.status)).length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Support</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Disputes</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>{openCount} open · resolve in the customer&apos;s favour (full refund) or for the provider.</p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {disputes.length === 0 ? (
        <div style={card({ marginTop: 18, padding: '34px 18px', textAlign: 'center', color: FAINT, fontSize: 14 })}>No disputes. 🎉</div>
      ) : (
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {disputes.map((d) => {
            const st = STATUS[d.status] ?? STATUS.open;
            const isOpen = OPEN.has(d.status);
            return (
              <div key={d.id} style={card({ padding: '16px 18px', borderColor: isOpen ? '#f3d6d6' : '#ececea' })}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{d.title}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: st.bg, color: st.fg }}>{st.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: FAINT }}>{fmt(d.openedAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: MUTE, marginTop: 6 }}>
                  {d.customerName} vs {d.providerName ?? 'provider'} · {d.serviceName ?? 'service'} <span style={{ fontFamily: 'ui-monospace, monospace' }}>BK-{d.bookingId}</span> · {aed(d.amount)}
                </div>
                {d.description && <p style={{ fontSize: 13.5, color: '#4A544D', marginTop: 8, lineHeight: 1.5 }}>{d.description}</p>}

                {d.providerResponse && (
                  <div style={{ marginTop: 10, padding: '9px 12px', background: '#F5F7F4', borderRadius: 9, borderLeft: '3px solid #0B7A4E' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#0B7A4E' }}>Provider&apos;s response</div>
                    <p style={{ fontSize: 13, color: '#182420', marginTop: 4, lineHeight: 1.5 }}>{d.providerResponse}</p>
                  </div>
                )}

                {isOpen ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <button disabled={busy === d.id} onClick={() => resolve(d.id, 'refund_customer')}
                      style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy === d.id ? 0.5 : 1 }}>
                      {busy === d.id ? '…' : 'Refund customer (full)'}
                    </button>
                    <button disabled={busy === d.id} onClick={() => resolve(d.id, 'favor_provider')}
                      style={{ background: '#fff', border: BORDER, borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer', opacity: busy === d.id ? 0.5 : 1 }}>
                      Find for provider
                    </button>
                  </div>
                ) : d.resolutionSummary ? (
                  <p style={{ fontSize: 12.5, color: FAINT, marginTop: 10, fontStyle: 'italic' }}>Resolution: {d.resolutionSummary}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
