'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';

const PRIMARY = '#2e9f82';
const INK = '#1a1916';
const MUTE = '#6b6860';
const FAINT = '#9b9890';
const BORDER = '1px solid #ececea';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 16, ...extra });

interface AdminReview {
  id: number; rating: number; title: string | null; body: string | null;
  createdAt: string; hidden: boolean; hiddenReason: string | null;
  reviewerName: string; providerName: string | null; serviceProviderId: number | null;
  serviceName: string | null; bookingId: number | null;
}

type Filter = 'all' | 'visible' | 'hidden' | 'low';
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const fmtWhen = (iso: string) => new Date(iso).toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [hideFor, setHideFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReviews(await apiGet<AdminReview[]>('/reviews/admin'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reviews');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const moderate = async (id: number, hidden: boolean, why?: string) => {
    setBusy(true);
    try {
      await apiPatch(`/reviews/${id}/moderate`, { hidden, reason: why });
      setHideFor(null); setReason('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the review');
    } finally { setBusy(false); }
  };

  const counts = useMemo(() => ({
    all: reviews.length,
    visible: reviews.filter((r) => !r.hidden).length,
    hidden: reviews.filter((r) => r.hidden).length,
    low: reviews.filter((r) => r.rating <= 2).length,
  }), [reviews]);
  const filtered = reviews.filter((r) =>
    filter === 'visible' ? !r.hidden : filter === 'hidden' ? r.hidden : filter === 'low' ? r.rating <= 2 : true);

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading reviews…</div>;

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'visible', label: 'Visible' },
    { key: 'hidden', label: 'Hidden' }, { key: 'low', label: 'Low (≤2★)' },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 4px 48px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: PRIMARY }}>Trust &amp; Safety</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>Review moderation</h1>
      <p style={{ color: MUTE, fontSize: 14, marginTop: 4 }}>Hide abusive or fake reviews. Hiding a review drops it from the provider&apos;s rating and their list; it stays here for audit.</p>

      {error && <div style={{ marginTop: 12, background: '#fef2f2', color: '#b42318', borderRadius: 10, padding: '10px 12px', fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            style={{ fontSize: 13, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
              border: filter === t.key ? `1px solid ${PRIMARY}` : BORDER,
              background: filter === t.key ? '#e7f3ec' : '#fff', color: filter === t.key ? PRIMARY : MUTE }}>
            {t.label} <span style={{ color: FAINT }}>({counts[t.key]})</span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.length === 0 ? (
          <div style={card({ padding: '22px 18px', color: FAINT, fontSize: 14 })}>No reviews here.</div>
        ) : filtered.map((r) => (
          <div key={r.id} style={card({ padding: '15px 18px', opacity: r.hidden ? 0.72 : 1, borderColor: r.hidden ? '#f0d9d9' : '#ececea' })}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ color: '#f59e0b', letterSpacing: '1px', fontSize: 15 }}>{stars(r.rating)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{r.reviewerName}</span>
                  <span style={{ fontSize: 12.5, color: FAINT }}>→ {r.providerName ?? `Provider #${r.serviceProviderId ?? '—'}`}</span>
                  {r.hidden && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#991b1b', background: '#fee2e2', borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Hidden</span>}
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>
                  {r.serviceName ?? 'Service'}{r.bookingId ? ` · BK-${r.bookingId}` : ''} · {fmtWhen(r.createdAt)}
                </div>
                {r.title && <div style={{ fontSize: 13.5, fontWeight: 600, color: INK, marginTop: 8 }}>{r.title}</div>}
                {r.body && <p style={{ fontSize: 13.5, color: MUTE, marginTop: 4 }}>{r.body}</p>}
                {r.hidden && r.hiddenReason && <p style={{ fontSize: 12, color: '#b42318', marginTop: 6 }}>Hidden reason: {r.hiddenReason}</p>}
              </div>
              {r.hidden ? (
                <button disabled={busy} onClick={() => moderate(r.id, false)}
                  style={{ background: 'none', border: BORDER, borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, color: PRIMARY, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Unhide
                </button>
              ) : (
                <button disabled={busy} onClick={() => { setReason(''); setHideFor(r.id); }}
                  style={{ background: 'none', border: '1px solid #f3c6c6', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, color: '#b42318', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Hide
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {hideFor != null && (
        <div onClick={() => setHideFor(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,20,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={card({ width: 440, maxWidth: '100%', padding: 22 })}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Hide this review?</div>
            <p style={{ fontSize: 13, color: MUTE, marginTop: 4 }}>It will be removed from the provider&apos;s rating and their reviews list. Note why for the audit trail.</p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Reason (e.g. abusive language, fake / not a real customer)"
              style={{ width: '100%', marginTop: 12, border: BORDER, borderRadius: 10, padding: '9px 11px', fontSize: 13, color: INK, resize: 'vertical', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
              <button onClick={() => setHideFor(null)} style={{ background: 'none', border: BORDER, borderRadius: 9, padding: '9px 15px', fontSize: 13, fontWeight: 600, color: MUTE, cursor: 'pointer' }}>Cancel</button>
              <button disabled={busy} onClick={() => moderate(hideFor, true, reason.trim() || undefined)}
                style={{ background: '#b42318', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 17px', fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1, cursor: 'pointer' }}>
                {busy ? 'Hiding…' : 'Hide review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
