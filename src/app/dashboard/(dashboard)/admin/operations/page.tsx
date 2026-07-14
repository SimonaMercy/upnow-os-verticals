'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });
const aed = (n: number | string | null) => (n == null ? '—' : `AED ${Number(n).toLocaleString('en-AE')}`);

interface Booking {
  id: number; status: string; pricingMode: string | null; serviceName: string | null;
  scheduledAt: string; totalAmount: number | string | null; serviceProviderId: number | null;
  tenant?: { user?: { name?: string | null } | null } | null;
}
interface Provider { id: number; businessName: string; compliant: boolean; jobReady: boolean; technicians: { id: number; name: string }[] }

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  booked: { label: 'Booked', bg: '#fef3c7', fg: '#92400e' },
  confirmed: { label: 'Paid · unassigned', bg: '#fee2e2', fg: '#991b1b' },
  assigned: { label: 'Assigned', bg: '#e0f2fe', fg: '#0369a1' },
  en_route: { label: 'On the way', bg: '#e0f2fe', fg: '#0369a1' },
  in_progress: { label: 'In progress', bg: '#e0e7ff', fg: '#4338ca' },
  completed: { label: 'Completed', bg: '#d8f2e8', fg: '#1a7a5a' },
  cancelled: { label: 'Cancelled', bg: '#f3f4f6', fg: '#6b7280' },
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' }) + ' · ' + new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

export default function AdminOperationsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignId, setAssignId] = useState<number | null>(null);
  const [spId, setSpId] = useState<number | ''>('');
  const [techId, setTechId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([
        apiGet<Booking[] | { data?: Booking[] }>('/bookings'),
        apiGet<Provider[]>('/bookings/providers'),
      ]);
      setBookings(Array.isArray(b) ? b : (b?.data ?? []));
      setProviders(p ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load operations');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const providerName = useMemo(() => {
    const m = new Map(providers.map((p) => [p.id, p.businessName]));
    return (id: number | null) => (id ? m.get(id) ?? `Provider #${id}` : null);
  }, [providers]);

  const needsAssignment = bookings.filter((b) => b.status === 'confirmed' && !b.serviceProviderId);
  const chosenProvider = providers.find((p) => p.id === spId);

  const openAssign = (id: number) => { setAssignId(id); setSpId(''); setTechId(''); };
  const submitAssign = async () => {
    if (!assignId || !spId || !techId) return;
    setBusy(true);
    try {
      await apiPatch(`/bookings/${assignId}/assign`, { serviceProviderId: spId, technicianId: techId });
      setAssignId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign');
    } finally { setBusy(false); }
  };

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading operations…</div>;

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Operations</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Booking dispatch</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>Watch every booking, and place the ones the auto-matcher couldn&apos;t.</p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      {/* Needs-assignment queue */}
      <div style={card({ marginTop: 18, overflow: 'hidden', borderColor: needsAssignment.length ? '#f3c6c6' : '#ececea' })}>
        <div style={{ padding: '13px 18px', borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Needs assignment</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: needsAssignment.length ? '#991b1b' : PRIMARY, background: needsAssignment.length ? '#fee2e2' : '#e7f3ec', borderRadius: 999, padding: '2px 9px' }}>{needsAssignment.length}</span>
          <span style={{ fontSize: 12.5, color: FAINT, marginLeft: 'auto' }}>Paid bookings the matcher couldn&apos;t place</span>
        </div>
        {needsAssignment.length === 0 ? (
          <div style={{ padding: '22px 18px', color: FAINT, fontSize: 14 }}>All paid bookings are placed. 🎉</div>
        ) : needsAssignment.map((b) => (
          <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid #f6f6f4' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: INK, fontSize: 14 }}>{b.serviceName ?? 'Service'} <span style={{ color: FAINT, fontWeight: 400, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>BK-{b.id}</span></div>
              <div style={{ fontSize: 12.5, color: MUTE, marginTop: 2 }}>{b.tenant?.user?.name ?? 'Customer'} · {fmtWhen(b.scheduledAt)} · {aed(b.totalAmount)}</div>
            </div>
            <button onClick={() => openAssign(b.id)} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Assign</button>
          </div>
        ))}
      </div>

      {/* All bookings */}
      <div style={card({ marginTop: 18, overflow: 'hidden' })}>
        <div style={{ padding: '13px 18px', borderBottom: BORDER, fontSize: 14, fontWeight: 700, color: INK }}>All bookings <span style={{ color: FAINT, fontWeight: 400 }}>({bookings.length})</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead>
              <tr style={{ color: FAINT, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {['Booking', 'Customer', 'When', 'Status', 'Provider', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 18px', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b, i) => {
                const st = STATUS[b.status] ?? STATUS.booked;
                const pName = providerName(b.serviceProviderId);
                const canAssign = ['confirmed', 'assigned'].includes(b.status);
                return (
                  <tr key={b.id} style={{ borderTop: i === 0 ? BORDER : '1px solid #f6f6f4', color: INK }}>
                    <td style={{ padding: '11px 18px' }}><span style={{ fontWeight: 600 }}>{b.serviceName ?? 'Service'}</span> <span style={{ color: FAINT, fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>BK-{b.id}</span></td>
                    <td style={{ padding: '11px 18px', color: MUTE }}>{b.tenant?.user?.name ?? '—'}</td>
                    <td style={{ padding: '11px 18px', color: MUTE, whiteSpace: 'nowrap' }}>{fmtWhen(b.scheduledAt)}</td>
                    <td style={{ padding: '11px 18px' }}><span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span></td>
                    <td style={{ padding: '11px 18px', color: pName ? INK : FAINT }}>{pName ?? 'Unassigned'}</td>
                    <td style={{ padding: '11px 18px', textAlign: 'right' }}>
                      {canAssign && <button onClick={() => openAssign(b.id)} style={{ background: 'none', border: BORDER, borderRadius: 8, padding: '5px 11px', fontSize: 12.5, fontWeight: 600, color: PRIMARY, cursor: 'pointer' }}>{b.serviceProviderId ? 'Reassign' : 'Assign'}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign modal */}
      {assignId != null && (
        <div onClick={() => setAssignId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={card({ width: 440, maxWidth: '100%', padding: 22 })}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Assign a provider</div>
            <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>BK-{assignId} — pick a provider and one of their technicians.</p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: MUTE, marginTop: 16 }}>Provider</label>
            <select value={spId} onChange={(e) => { setSpId(Number(e.target.value)); setTechId(''); }} style={{ width: '100%', marginTop: 6, border: BORDER, borderRadius: 9, padding: '9px 11px', fontSize: 14, color: INK, background: '#fff' }}>
              <option value="" disabled>Select a provider…</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.businessName}{p.jobReady ? '' : ' · not job-ready'}{p.compliant ? '' : ' · non-compliant'}</option>
              ))}
            </select>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: MUTE, marginTop: 14 }}>Technician</label>
            <select value={techId} onChange={(e) => setTechId(Number(e.target.value))} disabled={!chosenProvider} style={{ width: '100%', marginTop: 6, border: BORDER, borderRadius: 9, padding: '9px 11px', fontSize: 14, color: INK, background: '#fff', opacity: chosenProvider ? 1 : 0.5 }}>
              <option value="" disabled>{chosenProvider ? 'Select a technician…' : 'Pick a provider first'}</option>
              {chosenProvider?.technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>

            {chosenProvider && (!chosenProvider.jobReady || !chosenProvider.compliant) && (
              <p style={{ fontSize: 12, color: '#92400e', background: '#fef6e7', borderRadius: 8, padding: '8px 10px', marginTop: 12 }}>
                Heads up: this provider is {[!chosenProvider.compliant && 'not compliant', !chosenProvider.jobReady && 'not job-ready'].filter(Boolean).join(' and ')}. Assign only as an ops override.
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button onClick={() => setAssignId(null)} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Cancel</button>
              <button onClick={submitAssign} disabled={busy || !spId || !techId} style={{ background: PRIMARY, color: '#fff', border: 'none', borderRadius: 9, padding: '9px 17px', fontSize: 13, fontWeight: 600, opacity: busy || !spId || !techId ? 0.5 : 1, cursor: 'pointer' }}>{busy ? 'Assigning…' : 'Assign'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
