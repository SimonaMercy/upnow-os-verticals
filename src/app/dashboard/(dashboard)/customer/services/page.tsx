/**
 * Customer "My Services" — live booking list + status timeline + cancel
 * (SP Sprint 2, SCRUM-410/416). Replaces the ComingSoon stub.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2,
  MapPin, Plus, Wrench, XCircle,
} from 'lucide-react';

interface TimelineStep { key: string; label: string; at: string | null; done: boolean }
interface BookingRow {
  id: number;
  status: string;
  scheduledAt: string;
  hours: number | null;
  totalAmount: number | string | null;
  cancellationFee: number | string | null;
  pricingMode: string | null;
  addressText: string | null;
  template?: { name?: string | null } | null;
  variant?: { name?: string | null } | null;
}

const STATUS_TONES: Record<string, { bg: string; fg: string; label: string }> = {
  booked:      { bg: '#fef3c7', fg: '#92400e', label: 'Awaiting payment' },
  confirmed:   { bg: '#d8f2e8', fg: '#1a7a5a', label: 'Confirmed' },
  assigned:    { bg: '#e0f2fe', fg: '#0369a1', label: 'Professional assigned' },
  en_route:    { bg: '#e0f2fe', fg: '#0369a1', label: 'On the way' },
  in_progress: { bg: '#e0e7ff', fg: '#4338ca', label: 'In progress' },
  completed:   { bg: '#d8f2e8', fg: '#1a7a5a', label: 'Completed' },
  cancelled:   { bg: '#fee2e2', fg: '#991b1b', label: 'Cancelled' },
};

const fmtAed = (n: number | string) => Number(n).toLocaleString('en-AE');
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short' }) +
  ' · ' + new Date(iso).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' });

export default function CustomerServicesPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [timeline, setTimeline] = useState<Record<number, TimelineStep[]>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch('/api/bookings', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BookingRow[] | { data?: BookingRow[] }) =>
        setBookings(Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : [])))
      .catch(() => setBookings([]));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const toggleDetail = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!timeline[id]) {
      try {
        const d = await fetch(`/api/bookings/${id}`, { credentials: 'include' }).then((r) => r.json());
        setTimeline((prev) => ({ ...prev, [id]: d.timeline ?? [] }));
      } catch { /* detail stays collapsed-empty */ }
    }
  };

  const cancel = async (b: BookingRow) => {
    const warn = b.status === 'confirmed'
      ? 'Cancel this booking? A cancellation fee may apply if your slot is less than 6 hours away.'
      : 'Cancel this booking?';
    if (!window.confirm(warn)) return;
    setBusy(b.id);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${b.id}/cancel`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not cancel');
      if (d.cancellationFee && Number(d.cancellationFee) > 0) {
        window.alert(`Cancelled. A cancellation fee of AED ${fmtAed(d.cancellationFee)} applies per the policy.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-6 py-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-neutral-900)' }}>My Services</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-neutral-500)' }}>
            Your home-service bookings — track progress, or cancel while it&apos;s free.
          </p>
        </div>
        <Link
          href="/services"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          <Plus size={15} /> Book a service
        </Link>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: '#fef2f2', color: 'var(--color-error)' }}>{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-primary)' }} />
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-50)' }}>
            <Wrench size={24} style={{ color: 'var(--color-primary)' }} />
          </div>
          <h2 className="text-base font-semibold mb-1.5" style={{ color: 'var(--color-neutral-900)' }}>No bookings yet</h2>
          <p className="text-sm max-w-sm mx-auto mb-5" style={{ color: 'var(--color-neutral-500)' }}>
            From a one-hour clean to a full AC service — transparent prices, licensed professionals.
          </p>
          <Link href="/services" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            Browse services
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const tone = STATUS_TONES[b.status] ?? STATUS_TONES.booked;
            const open = openId === b.id;
            const cancellable = ['booked', 'confirmed'].includes(b.status);
            return (
              <div key={b.id} className="rounded-2xl border bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
                <button type="button" onClick={() => toggleDetail(b.id)} className="w-full flex items-center gap-4 px-5 py-4 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>
                      {b.template?.name ?? 'Service'}{b.variant?.name ? ` — ${b.variant.name}` : ''}{b.hours ? ` · ${b.hours}h` : ''}
                    </div>
                    <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--color-neutral-500)' }}>
                      <span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {fmtWhen(b.scheduledAt)}</span>
                      <span className="font-mono">BK-{b.id}</span>
                    </div>
                  </div>
                  <span className="text-sm font-bold whitespace-nowrap" style={{ color: 'var(--color-neutral-900)' }}>
                    {b.totalAmount != null ? `AED ${fmtAed(b.totalAmount)}` : 'Quote'}
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>
                    {tone.label}
                  </span>
                  {open ? <ChevronUp size={16} style={{ color: 'var(--color-neutral-400)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-neutral-400)' }} />}
                </button>

                {open && (
                  <div className="px-5 pb-5" style={{ borderTop: '1px solid var(--color-base-100)' }}>
                    {b.addressText && (
                      <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: 'var(--color-neutral-500)' }}>
                        <MapPin size={12} /> {b.addressText}
                      </p>
                    )}
                    <div className="mt-4 space-y-2.5">
                      {(timeline[b.id] ?? []).map((s) => (
                        <div key={s.key} className="flex items-center gap-3">
                          {s.done
                            ? (s.key === 'cancelled'
                              ? <XCircle size={16} style={{ color: '#b91c1c' }} />
                              : <CheckCircle2 size={16} style={{ color: 'var(--color-primary)' }} />)
                            : <Clock size={16} style={{ color: 'var(--color-base-200)' }} />}
                          <span className="text-xs font-medium" style={{ color: s.done ? 'var(--color-neutral-800)' : 'var(--color-neutral-400)' }}>
                            {s.label}
                          </span>
                          {s.at && s.done && (
                            <span className="text-[10px] ml-auto" style={{ color: 'var(--color-neutral-400)' }}>{fmtWhen(s.at)}</span>
                          )}
                        </div>
                      ))}
                      {!timeline[b.id] && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-neutral-400)' }} />}
                    </div>
                    {b.status === 'cancelled' && b.cancellationFee != null && Number(b.cancellationFee) > 0 && (
                      <p className="text-[11px] mt-3" style={{ color: 'var(--color-neutral-400)' }}>
                        Cancellation fee applied: AED {fmtAed(b.cancellationFee)}
                      </p>
                    )}
                    {cancellable && (
                      <button
                        type="button"
                        disabled={busy === b.id}
                        onClick={() => cancel(b)}
                        className="mt-4 text-xs font-semibold px-3.5 py-2 rounded-lg border"
                        style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-error)' }}
                      >
                        {busy === b.id ? 'Cancelling…' : 'Cancel booking'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
