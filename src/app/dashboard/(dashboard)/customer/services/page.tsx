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
import { uploadBookingPhoto } from '@/lib/bookingEvidence';

interface TimelineStep { key: string; label: string; at: string | null; done: boolean }
/** Why money came back (SP-259) — from GET /bookings/:id. */
interface RefundInfo { amount: number | string; reasonCode: string | null; reasonNote: string | null; refundedAt: string | null }
/** Evidence photos (SP-258) — problem (yours), before/after (the crew's proof). */
interface EvidencePhoto { id: number; kind: string; caption: string | null; viewUrl: string; createdAt: string }
interface EvidenceGroups { problem: EvidencePhoto[]; before: EvidencePhoto[]; after: EvidencePhoto[] }
interface QuoteItem { itemName: string; description?: string | null; quantity: number | string; unitPrice: number | string; lineTotal: number | string }
interface Quote { id: number; status: string; totalAmount: number | string; laborAmount?: number | string | null; materialsAmount?: number | string | null; summary?: string | null; validUntil?: string | null; rejectionReason?: string | null; items: QuoteItem[] }
interface BookingRow {
  id: number;
  status: string;
  scheduledAt: string;
  hours: number | null;
  totalAmount: number | string | null;
  cancellationFee: number | string | null;
  pricingMode: string | null;
  addressText: string | null;
  serviceName?: string | null;
  packageName?: string | null;
  customerSignedOff?: boolean;
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

const REFUND_REASON_LABELS: Record<string, string> = {
  customer_cancelled: 'you cancelled the booking',
  provider_cancelled: 'the provider cancelled',
  provider_no_show: 'the provider did not show up',
  work_not_to_standard: 'the work was not to standard',
  duplicate_booking: 'it was a duplicate booking',
  platform_error: 'a platform error',
  dispute_upheld: 'your dispute was upheld',
  goodwill: 'a goodwill gesture',
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
  const [refunds, setRefunds] = useState<Record<number, RefundInfo | null>>({});
  const [mediaMap, setMediaMap] = useState<Record<number, EvidenceGroups>>({});
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<number, Quote | null>>({});
  const [approving, setApproving] = useState<number | null>(null);
  const [declineFor, setDeclineFor] = useState<number | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<number | null>(null);
  const [reportTitle, setReportTitle] = useState('');
  const [reportBody, setReportBody] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reviews, setReviews] = useState<Record<number, { rating: number }>>({});
  const [reviewFor, setReviewFor] = useState<number | null>(null);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHover, setReviewHover] = useState(0);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [signingOff, setSigningOff] = useState<number | null>(null);

  const load = () =>
    fetch('/api/bookings', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BookingRow[] | { data?: BookingRow[] }) =>
        setBookings(Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : [])))
      .catch(() => setBookings([]));

  const loadReviews = () =>
    fetch('/api/reviews/written', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ bookingId: number; rating: number }>) =>
        setReviews(Object.fromEntries((Array.isArray(rows) ? rows : []).map((x) => [x.bookingId, { rating: x.rating }]))))
      .catch(() => {});

  useEffect(() => { load().finally(() => setLoading(false)); loadReviews(); }, []);

  const toggleDetail = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    const row = bookings.find((x) => x.id === id);
    if (!timeline[id]) {
      try {
        const d = await fetch(`/api/bookings/${id}`, { credentials: 'include' }).then((r) => r.json());
        setTimeline((prev) => ({ ...prev, [id]: d.timeline ?? [] }));
        setRefunds((prev) => ({ ...prev, [id]: d.refund ?? null }));
        setMediaMap((prev) => ({ ...prev, [id]: d.media ?? { problem: [], before: [], after: [] } }));
      } catch { /* detail stays collapsed-empty */ }
    }
    if (row?.pricingMode === 'quote' && quotes[id] === undefined) {
      try {
        const q = await fetch(`/api/bookings/${id}/quote`, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null));
        setQuotes((prev) => ({ ...prev, [id]: q }));
      } catch { setQuotes((prev) => ({ ...prev, [id]: null })); }
    }
  };

  const approveQuote = async (id: number) => {
    setApproving(id);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${id}/quote/accept`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not approve the quote');
      setQuotes((prev) => { const n = { ...prev }; delete n[id]; return n; });
      setTimeline((prev) => { const n = { ...prev }; delete n[id]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve the quote');
    } finally {
      setApproving(null);
    }
  };

  const submitDecline = async () => {
    const id = declineFor;
    if (id == null) return;
    setDeclining(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${id}/quote/reject`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: declineReason.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not decline the quote');
      setQuotes((prev) => ({ ...prev, [id]: d })); // updated quote (now rejected)
      setDeclineFor(null); setDeclineReason('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not decline the quote');
    } finally {
      setDeclining(false);
    }
  };

  /** SP-135/138: the exact fee/refund the policy snapshot yields right now. */
  const cancelPreview = async (id: number) => {
    const res = await fetch(`/api/bookings/${id}/cancel-preview`, { credentials: 'include' });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.message ?? 'Could not load the cancellation terms');
    return d as {
      paid: boolean; hoursBefore: number; feePct: number; fee: number; refund: number; total: number;
      policy: { noShowGraceMinutes: number };
      noShow: { windowOpen: boolean; opensAt: string; customerCanReport: boolean };
    };
  };

  const cancel = async (b: BookingRow) => {
    setBusy(b.id);
    setError(null);
    try {
      const p = await cancelPreview(b.id);
      const warn = p.paid
        ? p.fee > 0
          ? `Cancel this booking? Your slot is ${p.hoursBefore > 0 ? `${Math.max(0, Math.round(p.hoursBefore * 10) / 10)}h away` : 'due'}, so a ${p.feePct}% cancellation fee of AED ${fmtAed(p.fee)} applies — AED ${fmtAed(p.refund)} will be refunded.`
          : `Cancel this booking? You're outside the fee window — the full AED ${fmtAed(p.total)} will be refunded.`
        : 'Cancel this booking? Nothing has been charged.';
      if (!window.confirm(warn)) return;
      const res = await fetch(`/api/bookings/${b.id}/cancel`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not cancel');
      if (d.cancellationFee && Number(d.cancellationFee) > 0) {
        window.alert(`Cancelled. A cancellation fee of AED ${fmtAed(d.cancellationFee)} was retained per the policy; the rest is on its way back to you.`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel');
    } finally {
      setBusy(null);
    }
  };

  /** SP-138: the professional never came — allowed once slot + grace has passed and the job hasn't started. */
  const reportNoShow = async (b: BookingRow) => {
    setBusy(b.id);
    setError(null);
    try {
      const p = await cancelPreview(b.id);
      if (!p.noShow.customerCanReport) {
        const at = new Date(p.noShow.opensAt);
        window.alert(`You can report a no-show ${p.policy.noShowGraceMinutes} minutes after your booked time (from ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`);
        return;
      }
      if (!window.confirm(`Report that nobody arrived? The booking will be closed and the full amount refunded to you.`)) return;
      const note = window.prompt('Anything we should know? (optional)') ?? '';
      const res = await fetch(`/api/bookings/${b.id}/no-show/provider`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not report the no-show');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not report the no-show');
    } finally {
      setBusy(null);
    }
  };

  const submitReport = async () => {
    if (reportFor == null || !reportTitle.trim()) return;
    setReporting(true);
    setError(null);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: reportFor, title: reportTitle.trim(), description: reportBody.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not submit');
      setReportFor(null); setReportTitle(''); setReportBody('');
      setTimeline((prev) => { const n = { ...prev }; delete n[reportFor]; return n; });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your report');
    } finally {
      setReporting(false);
    }
  };

  const signOff = async (id: number) => {
    setSigningOff(id);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${id}/sign-off`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not confirm');
      await load(); // customerSignedOff flips on the refreshed row
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the job');
    } finally {
      setSigningOff(null);
    }
  };

  const submitReview = async () => {
    if (reviewFor == null || reviewRating < 1) return;
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: reviewFor, rating: reviewRating, body: reviewBody.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message ?? 'Could not submit');
      setReviews((prev) => ({ ...prev, [reviewFor]: { rating: reviewRating } }));
      setReviewFor(null); setReviewRating(0); setReviewHover(0); setReviewBody('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your review');
    } finally {
      setReviewing(false);
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
            const cancellable = ['booked', 'confirmed', 'assigned'].includes(b.status);
            // The crew is due and hasn't started — the customer may report a no-show once the grace window opens.
            const slotPassed = new Date(b.scheduledAt).getTime() < Date.now();
            const canReportNoShow = ['assigned', 'en_route'].includes(b.status) && slotPassed;
            const quote = quotes[b.id];
            return (
              <div key={b.id} className="rounded-2xl border bg-white" style={{ borderColor: 'var(--color-base-200)' }}>
                <button type="button" onClick={() => toggleDetail(b.id)} className="w-full flex items-center gap-4 px-5 py-4 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--color-neutral-900)' }}>
                      {b.serviceName ?? b.template?.name ?? 'Service'}
                      {(b.packageName ?? b.variant?.name) ? ` — ${b.packageName ?? b.variant?.name}` : ''}
                      {b.hours ? ` · ${b.hours}h` : ''}
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

                    {quote && quote.status === 'submitted' && (
                      <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-primary-50)' }}>
                        <div className="text-sm font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Your quote is ready</div>
                        {quote.summary && <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-600)' }}>{quote.summary}</p>}
                        <div className="mt-3 space-y-1.5">
                          {quote.items.map((it, i) => (
                            <div key={i} className="flex justify-between text-xs" style={{ color: 'var(--color-neutral-700)' }}>
                              <span>{it.itemName}{Number(it.quantity) > 1 ? ` × ${it.quantity}` : ''}</span>
                              <span className="font-mono">AED {fmtAed(it.lineTotal)}</span>
                            </div>
                          ))}
                        </div>
                        {Number(quote.materialsAmount ?? 0) > 0 && (
                          <div className="mt-2.5 pt-2.5 space-y-1" style={{ borderTop: '1px dashed var(--color-base-200)' }}>
                            <div className="flex justify-between text-[11px]" style={{ color: 'var(--color-neutral-500)' }}>
                              <span>Labour</span><span className="font-mono">AED {fmtAed(quote.laborAmount ?? 0)}</span>
                            </div>
                            <div className="flex justify-between text-[11px]" style={{ color: 'var(--color-neutral-500)' }}>
                              <span>Materials</span><span className="font-mono">AED {fmtAed(quote.materialsAmount ?? 0)}</span>
                            </div>
                          </div>
                        )}
                        <div className="flex justify-between items-center mt-3 pt-3" style={{ borderTop: '1px solid var(--color-base-200)' }}>
                          <span className="text-sm font-bold" style={{ color: 'var(--color-neutral-900)' }}>Total</span>
                          <span className="text-sm font-bold" style={{ color: 'var(--color-neutral-900)' }}>AED {fmtAed(quote.totalAmount)}</span>
                        </div>
                        <button
                          type="button"
                          disabled={approving === b.id}
                          onClick={() => approveQuote(b.id)}
                          className="mt-3 w-full py-2.5 rounded-lg text-sm font-semibold text-white"
                          style={{ background: 'var(--color-primary)' }}
                        >
                          {approving === b.id ? 'Processing…' : `Approve & pay · AED ${fmtAed(quote.totalAmount)}`}
                        </button>
                        <div className="flex items-center justify-between mt-2 gap-3">
                          <p className="text-[10px]" style={{ color: 'var(--color-neutral-400)' }}>
                            You only pay after approving.{quote.validUntil ? ` Valid until ${new Date(quote.validUntil).toLocaleDateString('en-AE', { day: 'numeric', month: 'short' })}.` : ''}
                          </p>
                          <button
                            type="button"
                            onClick={() => { setDeclineFor(b.id); setDeclineReason(''); }}
                            className="text-[11px] font-semibold whitespace-nowrap"
                            style={{ color: 'var(--color-neutral-500)' }}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    )}
                    {quote && quote.status === 'rejected' && (
                      <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--color-base-200)', background: '#fafaf9' }}>
                        <div className="text-xs font-semibold" style={{ color: 'var(--color-neutral-700)' }}>You declined this quote</div>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-neutral-500)' }}>
                          The provider can send a revised quote, or you can cancel the request.
                        </p>
                      </div>
                    )}
                    {quote && quote.status === 'expired' && (
                      <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--color-base-200)', background: '#fafaf9' }}>
                        <div className="text-xs font-semibold" style={{ color: 'var(--color-neutral-700)' }}>This quote expired</div>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--color-neutral-500)' }}>
                          Ask the provider for a fresh quote, or cancel the request.
                        </p>
                      </div>
                    )}
                    {b.status === 'cancelled' && b.cancellationFee != null && Number(b.cancellationFee) > 0 && (
                      <p className="text-[11px] mt-3" style={{ color: 'var(--color-neutral-400)' }}>
                        Cancellation fee applied: AED {fmtAed(b.cancellationFee)}
                      </p>
                    )}
                    {refunds[b.id] && (
                      <p className="text-[11px] mt-2" style={{ color: 'var(--color-neutral-500)' }}>
                        Refunded AED {fmtAed(refunds[b.id]!.amount)}
                        {refunds[b.id]!.reasonCode
                          ? ` — ${REFUND_REASON_LABELS[refunds[b.id]!.reasonCode!] ?? refunds[b.id]!.reasonCode}`
                          : ''}
                        {refunds[b.id]!.reasonNote ? ` (${refunds[b.id]!.reasonNote})` : ''}.
                      </p>
                    )}

                    {/* Evidence photos (SP-258): show what's wrong before the crew
                        arrives; see their before/after proof before you sign off. */}
                    {mediaMap[b.id] && (() => {
                      const m = mediaMap[b.id];
                      const canAttach = !['completed', 'cancelled', 'dispute'].includes(b.status);
                      const thumbs = (ps: EvidencePhoto[]) => ps.map((p) => (
                        <a key={p.id} href={p.viewUrl} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.viewUrl} alt={p.caption ?? 'photo'} className="rounded-lg border object-cover" style={{ width: 60, height: 60, borderColor: 'var(--color-base-200)' }} />
                        </a>
                      ));
                      return (
                        <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: 'var(--color-base-200)' }}>
                          <div className="text-xs font-semibold" style={{ color: 'var(--color-neutral-700)' }}>Photos</div>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            {thumbs(m.problem)}
                            {canAttach && (
                              <label className="rounded-lg border border-dashed grid place-items-center cursor-pointer" style={{ width: 60, height: 60, color: 'var(--color-neutral-400)', borderColor: 'var(--color-base-300)', fontSize: 20 }}>
                                {photoBusy === b.id ? '…' : '+'}
                                <input type="file" accept="image/*" className="hidden" disabled={photoBusy === b.id}
                                  onChange={async (e) => {
                                    const f = e.target.files?.[0]; e.currentTarget.value = '';
                                    if (!f) return;
                                    setPhotoBusy(b.id); setPhotoErr(null);
                                    try {
                                      const saved = await uploadBookingPhoto(b.id, 'problem', f);
                                      setMediaMap((prev) => ({ ...prev, [b.id]: { ...prev[b.id], problem: [...prev[b.id].problem, saved as EvidencePhoto] } }));
                                    } catch (err) { setPhotoErr(err instanceof Error ? err.message : 'Upload failed'); }
                                    finally { setPhotoBusy(null); }
                                  }} />
                              </label>
                            )}
                            {m.problem.length === 0 && !canAttach && <span className="text-[11px]" style={{ color: 'var(--color-neutral-400)' }}>No photos were added.</span>}
                          </div>
                          <p className="text-[10.5px] mt-1" style={{ color: 'var(--color-neutral-400)' }}>
                            {canAttach ? 'Add photos of the problem — the professional sees them before arriving.' : ''}
                          </p>
                          {(m.before.length > 0 || m.after.length > 0) && (
                            <div className="mt-2">
                              {m.before.length > 0 && (<><div className="text-[10.5px] font-semibold uppercase tracking-wide mt-2" style={{ color: 'var(--color-neutral-400)' }}>Before work</div><div className="flex flex-wrap gap-2 mt-1">{thumbs(m.before)}</div></>)}
                              {m.after.length > 0 && (<><div className="text-[10.5px] font-semibold uppercase tracking-wide mt-2" style={{ color: 'var(--color-neutral-400)' }}>Finished work</div><div className="flex flex-wrap gap-2 mt-1">{thumbs(m.after)}</div></>)}
                            </div>
                          )}
                          {photoErr && photoBusy === null && <p className="text-[11px] mt-2" style={{ color: '#B42318' }}>{photoErr}</p>}
                        </div>
                      );
                    })()}
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
                    {canReportNoShow && (
                      <button
                        type="button"
                        disabled={busy === b.id}
                        onClick={() => reportNoShow(b)}
                        className="mt-4 ml-2 text-xs font-semibold px-3.5 py-2 rounded-lg border"
                        style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-error)' }}
                      >
                        {busy === b.id ? 'Sending…' : 'Nobody arrived'}
                      </button>
                    )}
                    {b.status === 'completed' && (
                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        {b.customerSignedOff ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#1a7a5a' }}>
                            <CheckCircle2 size={14} /> You confirmed this job
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={signingOff === b.id}
                            onClick={() => signOff(b.id)}
                            className="text-xs font-semibold px-3.5 py-2 rounded-lg text-white"
                            style={{ background: 'var(--color-primary)', opacity: signingOff === b.id ? 0.6 : 1 }}
                          >
                            {signingOff === b.id ? 'Confirming…' : 'Confirm job done'}
                          </button>
                        )}
                        {reviews[b.id] ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#1a7a5a' }}>
                            <span style={{ color: '#f59e0b', letterSpacing: '1px' }}>{'★'.repeat(reviews[b.id].rating)}{'☆'.repeat(5 - reviews[b.id].rating)}</span>
                            <span className="font-normal" style={{ color: 'var(--color-neutral-500)' }}>You rated this</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setReviewFor(b.id); setReviewRating(0); setReviewHover(0); setReviewBody(''); }}
                            className="text-xs font-semibold px-3.5 py-2 rounded-lg border"
                            style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-primary)' }}
                          >
                            Leave a review
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setReportFor(b.id); setReportTitle(''); setReportBody(''); }}
                          className="text-xs font-semibold px-3.5 py-2 rounded-lg border"
                          style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-600)' }}
                        >
                          Report an issue
                        </button>
                      </div>
                    )}
                    {b.status === 'dispute' && (
                      <p className="mt-4 text-xs" style={{ color: '#92400e' }}>
                        Issue reported — our team is reviewing it.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {reportFor != null && (
        <div onClick={() => setReportFor(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,20,18,.45)' }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md" style={{ border: '1px solid var(--color-base-200)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Report an issue</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-500)' }}>Tell us what went wrong with BK-{reportFor}. Our team will review and get back to you.</p>
            <input
              value={reportTitle} onChange={(e) => setReportTitle(e.target.value)}
              placeholder="What's the issue?"
              className="w-full mt-4 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-base-200)' }}
            />
            <textarea
              value={reportBody} onChange={(e) => setReportBody(e.target.value)}
              placeholder="Add any details (optional)" rows={3}
              className="w-full mt-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-base-200)' }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setReportFor(null)} className="text-xs font-semibold px-3.5 py-2 rounded-lg border" style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-500)' }}>Cancel</button>
              <button onClick={submitReport} disabled={reporting || !reportTitle.trim()} className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ backgroundColor: 'var(--color-primary)', opacity: reporting || !reportTitle.trim() ? 0.5 : 1 }}>
                {reporting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {declineFor != null && (
        <div onClick={() => setDeclineFor(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,20,18,.45)' }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md" style={{ border: '1px solid var(--color-base-200)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Decline this quote?</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-500)' }}>
              We&apos;ll let the provider know so they can send a revised quote for BK-{declineFor}. You won&apos;t be charged.
            </p>
            <textarea
              value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Why are you declining? (optional — helps the provider revise)" rows={3}
              className="w-full mt-4 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-base-200)' }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setDeclineFor(null)} className="text-xs font-semibold px-3.5 py-2 rounded-lg border" style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-500)' }}>Keep quote</button>
              <button onClick={submitDecline} disabled={declining} className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ backgroundColor: 'var(--color-error)', opacity: declining ? 0.5 : 1 }}>
                {declining ? 'Declining…' : 'Decline quote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewFor != null && (
        <div onClick={() => setReviewFor(null)} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(20,20,18,.45)' }}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl p-5 w-full max-w-md" style={{ border: '1px solid var(--color-base-200)' }}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-neutral-900)' }}>Rate your service</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--color-neutral-500)' }}>How was your experience with BK-{reviewFor}? Your rating helps other customers.</p>
            <div className="flex items-center gap-1 mt-4" onMouseLeave={() => setReviewHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n} type="button"
                  onMouseEnter={() => setReviewHover(n)}
                  onClick={() => setReviewRating(n)}
                  className="text-3xl leading-none"
                  style={{ color: (reviewHover || reviewRating) >= n ? '#f59e0b' : 'var(--color-base-200)', cursor: 'pointer' }}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
              {reviewRating > 0 && (
                <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--color-neutral-500)' }}>
                  {['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][reviewRating]}
                </span>
              )}
            </div>
            <textarea
              value={reviewBody} onChange={(e) => setReviewBody(e.target.value)}
              placeholder="Tell others about your experience (optional)" rows={3}
              className="w-full mt-4 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--color-base-200)' }}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setReviewFor(null)} className="text-xs font-semibold px-3.5 py-2 rounded-lg border" style={{ borderColor: 'var(--color-base-200)', color: 'var(--color-neutral-500)' }}>Cancel</button>
              <button onClick={submitReview} disabled={reviewing || reviewRating < 1} className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ backgroundColor: 'var(--color-primary)', opacity: reviewing || reviewRating < 1 ? 0.5 : 1 }}>
                {reviewing ? 'Submitting…' : 'Submit review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
