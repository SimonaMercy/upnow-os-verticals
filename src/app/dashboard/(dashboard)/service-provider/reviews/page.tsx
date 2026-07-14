'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';

/* Tokens shared with the SP dashboard (design 2a). */
const GREEN = '#0B7A4E';
const INK = '#182420';
const FAINT = '#8A968D';
const STAR = '#E8A317';
const BORDER = '1px solid #E4E7E2';
const HAIRLINE = '1px solid #EEF1EE';
const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: '#fff', border: BORDER, borderRadius: 14, ...extra });

interface ReviewRow {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  providerResponse: string | null;
  createdAt: string;
  reviewerName: string;
  serviceName: string | null;
  bookingId: number | null;
}
interface ReviewsData {
  summary: { averageRating: number | null; totalReviews: number };
  reviews: ReviewRow[];
}

function Stars({ n, size = 15 }: { n: number; size?: number }) {
  return (
    <span style={{ color: STAR, fontSize: size, letterSpacing: 1 }} aria-label={`${n} out of 5`}>
      {'★★★★★'.slice(0, n)}
      <span style={{ color: '#DDE2DD' }}>{'★★★★★'.slice(n)}</span>
    </span>
  );
}

function ReviewCard({ review, onResponded }: { review: ReviewRow; onResponded: (id: number, text: string) => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await apiPatch(`/reviews/${review.id}/response`, { response: text.trim() });
      onResponded(review.id, text.trim());
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ padding: '16px 18px', borderTop: HAIRLINE }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Stars n={review.rating} />
          <span style={{ fontWeight: 600, color: INK, fontSize: 14 }}>{review.reviewerName}</span>
        </div>
        <span style={{ fontSize: 12, color: FAINT }}>
          {review.serviceName ? `${review.serviceName} · ` : ''}{new Date(review.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      {review.title && <div style={{ fontWeight: 600, color: INK, marginTop: 8 }}>{review.title}</div>}
      {review.body && <p style={{ color: '#4A544D', fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>{review.body}</p>}

      {review.providerResponse ? (
        <div style={{ marginTop: 12, background: '#F5F8F5', border: HAIRLINE, borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '.06em' }}>Your reply</div>
          <p style={{ fontSize: 13.5, color: INK, marginTop: 3 }}>{review.providerResponse}</p>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply to this review…"
            style={{ flex: 1, height: 36, border: BORDER, borderRadius: 9, padding: '0 12px', fontSize: 13.5, color: INK, outline: 'none' }}
          />
          <button
            onClick={submit}
            disabled={saving || !text.trim()}
            style={{ height: 36, padding: '0 15px', borderRadius: 9, background: GREEN, color: '#fff', fontSize: 13, fontWeight: 600, border: 'none', opacity: saving || !text.trim() ? 0.5 : 1, cursor: 'pointer' }}
          >
            {saving ? 'Saving…' : 'Reply'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ServiceProviderReviewsPage() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ReviewsData>('/reviews/mine')
      .then(setData)
      .catch((e) => setError(e?.message ?? 'Could not load reviews'))
      .finally(() => setLoading(false));
  }, []);

  const onResponded = (id: number, text: string) =>
    setData((d) => (d ? { ...d, reviews: d.reviews.map((r) => (r.id === id ? { ...r, providerResponse: text } : r)) } : d));

  if (loading) return <div style={{ padding: 24, color: FAINT }}>Loading reviews…</div>;
  if (error) return <div style={{ padding: 24, color: '#B42318' }}>{error}</div>;
  if (!data) return null;

  const { averageRating, totalReviews } = data.summary;
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '4px 2px 40px' }}>
      <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: GREEN }}>Reviews</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, letterSpacing: '-.02em' }}>What customers say</h1>

      <div style={card({ marginTop: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 18 })}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 700, color: INK, lineHeight: 1 }}>
            {averageRating != null ? averageRating.toFixed(1) : '—'}
          </div>
          <div style={{ marginTop: 6 }}><Stars n={Math.round(averageRating ?? 0)} size={16} /></div>
        </div>
        <div style={{ borderLeft: BORDER, height: 44 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>
            {totalReviews} review{totalReviews === 1 ? '' : 's'}
          </div>
          <div style={{ fontSize: 13, color: FAINT, marginTop: 2 }}>From completed jobs across your team.</div>
        </div>
      </div>

      <div style={card({ marginTop: 16, overflow: 'hidden' })}>
        <div style={{ padding: '14px 18px', fontSize: 13.5, fontWeight: 700, color: INK }}>All reviews</div>
        {data.reviews.length === 0 ? (
          <div style={{ padding: '34px 18px', textAlign: 'center', color: FAINT, fontSize: 14, borderTop: HAIRLINE }}>
            No reviews yet — customers can rate you once a job is completed.
          </div>
        ) : (
          data.reviews.map((r) => <ReviewCard key={r.id} review={r} onResponded={onResponded} />)
        )}
      </div>
    </div>
  );
}
