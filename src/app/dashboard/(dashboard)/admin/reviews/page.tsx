'use client';

/**
 * Admin › Trust & safety › Review moderation — Genspark OS rebuild.
 *
 * Parity with previous page (every item kept, same endpoints and payloads):
 *  - GET /reviews/admin — every review, visible and hidden.
 *  - PATCH /reviews/:id/moderate { hidden: true, reason?: string } — "Hide" behind a
 *    confirm modal with an optional audit reason (trimmed; empty → undefined).
 *  - PATCH /reviews/:id/moderate { hidden: false, reason: undefined } — "Unhide" (direct).
 *    Both reload the list; failures show an inline error.
 *  - Filter tabs with counts: All · Visible · Hidden · Low (≤2★).
 *  - Each review shows stars, reviewer, provider (or "Provider #id"), service, BK-<booking>,
 *    date, title, body, Hidden badge + hidden reason.
 *  - Loading / error / empty ("No reviews here") states.
 *  New: search (reviewer, provider, service, text), KPIs from the same list, and an "Open"
 *  drawer with the full review and the Hide / Unhide action. No manager route re-exports it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch } from '@/lib/api';
import {
  Btn, Callout, Drawer, EmptyRow, ErrorRow, Field, KV, Kpi, Kpis, Modal, OsPage, PageHead, Pill, ScopeStrip,
  SearchField, Seg, SkeletonRows, TableWrap, fmtDate,
} from '@/components/os/kit';

interface AdminReview {
  id: number; rating: number; title: string | null; body: string | null;
  createdAt: string; hidden: boolean; hiddenReason: string | null;
  reviewerName: string; providerName: string | null; serviceProviderId: number | null;
  serviceName: string | null; bookingId: number | null;
}

type Filter = 'all' | 'visible' | 'hidden' | 'low';
const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
const Stars = ({ n }: { n: number }) => <span aria-label={`${n} of 5 stars`} style={{ color: 'var(--ms-amber)', letterSpacing: 1 }}>{stars(n)}</span>;
const providerOf = (r: AdminReview) => r.providerName ?? `Provider #${r.serviceProviderId ?? '—'}`;

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [hideFor, setHideFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReviews(await apiGet<AdminReview[]>('/reviews/admin'));
      setError(null); setLoadFailed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reviews');
      setLoadFailed(true);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 0); return () => clearTimeout(t); }, [load]);

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
  const avgVisible = useMemo(() => {
    const v = reviews.filter((r) => !r.hidden);
    return v.length ? (v.reduce((s, r) => s + r.rating, 0) / v.length).toFixed(1) : '—';
  }, [reviews]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return reviews.filter((r) =>
      (filter === 'visible' ? !r.hidden : filter === 'hidden' ? r.hidden : filter === 'low' ? r.rating <= 2 : true)
      && (!s || [r.reviewerName, r.providerName, r.serviceName, r.title, r.body].some((x) => x?.toLowerCase().includes(s))));
  }, [reviews, filter, q]);
  const open = reviews.find((r) => r.id === openId) ?? null;
  const askHide = (id: number) => { setReason(''); setHideFor(id); };

  return (
    <OsPage>
      <PageHead
        eyebrow="Admin › Trust & safety"
        title="Review moderation"
        lede="Hide abusive or fake reviews. Hiding a review drops it from the provider's rating and their list; it stays here for audit."
        actions={<Btn size="sm" onClick={() => { setLoading(true); void load(); }}>Refresh</Btn>}
      />
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Trust & safety' },
        { label: 'Reviews', value: loading ? '…' : counts.all },
        { label: 'Hidden', value: loading ? '…' : counts.hidden },
      ]} />

      {error && !loadFailed && <div style={{ marginBottom: 14 }}><Callout tone="bad" title="Something went wrong.">{error}</Callout></div>}

      <Kpis>
        <Kpi k="Reviews" v={loading ? '…' : counts.all} d={`${counts.visible} visible`} />
        <Kpi k="Average rating" v={loading ? '…' : avgVisible} d="visible reviews only" />
        <Kpi k="Low (≤2★)" v={loading ? '…' : counts.low} d="worth a look" />
        <Kpi k="Hidden" v={loading ? '…' : counts.hidden} d="excluded from ratings" />
      </Kpis>

      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Hide, never delete.">
          A hidden review leaves the provider&apos;s rating and public list but remains on this page with its reason for the audit trail. Unhide restores it.
        </Callout>
      </div>

      <TableWrap toolbar={<>
        <SearchField value={q} onChange={setQ} placeholder="Search reviewer, provider, service or text" />
        <Seg label="Review filter" value={filter} onChange={setFilter} options={[
          { v: 'all', l: 'All', n: counts.all }, { v: 'visible', l: 'Visible', n: counts.visible },
          { v: 'hidden', l: 'Hidden', n: counts.hidden }, { v: 'low', l: 'Low (≤2★)', n: counts.low },
        ]} />
      </>}>
        <table className="gx-tbl">
          <thead><tr>
            <th>Rating</th><th>Review</th><th>Customer</th><th>Provider</th><th>Service</th><th>Date</th><th>Status</th><th className="act">Actions</th>
          </tr></thead>
          {loading ? <SkeletonRows cols={8} /> : loadFailed ? <ErrorRow cols={8} onRetry={() => { setLoading(true); void load(); }} /> : filtered.length === 0 ? (
            <EmptyRow cols={8} title="No reviews here." text={reviews.length ? 'Clear the search or pick another filter.' : 'Reviews appear after customers rate completed bookings.'} />
          ) : (
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="click" onClick={() => setOpenId(r.id)} style={r.hidden ? { opacity: 0.75 } : undefined}>
                  <td className="nowrap"><Stars n={r.rating} /></td>
                  <td style={{ maxWidth: 320 }}>
                    {r.title && <span className="strong">{r.title}</span>}
                    {r.body && <span className="sub" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{r.body}</span>}
                    {!r.title && !r.body && <span className="sub">No text</span>}
                  </td>
                  <td>{r.reviewerName}</td>
                  <td>{providerOf(r)}</td>
                  <td>{r.serviceName ?? 'Service'}{r.bookingId && <span className="sub mono">BK-{r.bookingId}</span>}</td>
                  <td className="nowrap">{fmtDate(r.createdAt)}</td>
                  <td>{r.hidden ? <Pill tone="danger" title={r.hiddenReason ?? undefined}>Hidden</Pill> : <Pill tone="primary">Visible</Pill>}</td>
                  <td className="act" onClick={(e) => e.stopPropagation()}>
                    <div className="gx-btn-row" style={{ justifyContent: 'flex-end' }}>
                      <Btn size="xs" onClick={() => setOpenId(r.id)}>Open</Btn>
                      {r.hidden
                        ? <Btn size="xs" disabled={busy} onClick={() => moderate(r.id, false)}>Unhide</Btn>
                        : <Btn size="xs" variant="danger" disabled={busy} onClick={() => askHide(r.id)}>Hide</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>

      <Drawer
        open={!!open && hideFor == null}
        onClose={() => setOpenId(null)}
        title={open ? <Stars n={open.rating} /> : ''}
        sub={open ? `${open.reviewerName} → ${providerOf(open)}` : null}
        footer={open && (
          <>
            <Btn onClick={() => setOpenId(null)}>Close</Btn>
            {open.hidden
              ? <Btn variant="primary" disabled={busy} onClick={() => moderate(open.id, false)}>{busy ? 'Saving…' : 'Unhide review'}</Btn>
              : <Btn variant="danger" disabled={busy} onClick={() => askHide(open.id)}>Hide review</Btn>}
          </>
        )}
      >
        {open && (
          <div style={{ display: 'grid', gap: 16 }}>
            {open.hidden && (
              <Callout tone="bad" title="Hidden.">{open.hiddenReason ? `Reason: ${open.hiddenReason}` : 'No reason recorded.'}</Callout>
            )}
            <KV items={[
              { k: 'Rating', v: `${open.rating} / 5` },
              { k: 'Customer', v: open.reviewerName },
              { k: 'Provider', v: providerOf(open) },
              { k: 'Service', v: open.serviceName ?? 'Service' },
              { k: 'Booking', v: open.bookingId ? <span className="mono">BK-{open.bookingId}</span> : '—' },
              { k: 'Posted', v: fmtDate(open.createdAt) },
            ]} />
            <div>
              <div className="gx-lb" style={{ marginBottom: 4 }}>Review</div>
              {open.title && <div style={{ fontWeight: 600, fontSize: 13 }}>{open.title}</div>}
              <p style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 4, whiteSpace: 'pre-wrap' }}>{open.body || 'No written review.'}</p>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={hideFor != null}
        onClose={() => setHideFor(null)}
        title="Hide this review?"
        width={460}
        footer={hideFor != null && (
          <>
            <Btn onClick={() => setHideFor(null)}>Cancel</Btn>
            <Btn variant="danger" disabled={busy} onClick={() => moderate(hideFor, true, reason.trim() || undefined)}>{busy ? 'Hiding…' : 'Hide review'}</Btn>
          </>
        )}
      >
        <p style={{ fontSize: 12.5, marginBottom: 10 }}>It will be removed from the provider&apos;s rating and their reviews list. Note why for the audit trail.</p>
        <Field label="Reason" htmlFor="hide-reason">
          <textarea id="hide-reason" className="gx-ta" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (e.g. abusive language, fake / not a real customer)" />
        </Field>
      </Modal>
    </OsPage>
  );
}
