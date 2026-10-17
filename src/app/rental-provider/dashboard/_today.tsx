'use client';
/**
 * Overview › Today — the consequence-ranked work queue (research report,
 * "Blueprint for UpNow's eight provider workspaces", Overview row, and
 * '"Today" screens … are built around reactive, time-boxed work').
 *
 * Presentational only: the page builds the items from real API data and hands
 * them in already ranked. Each row = icon · title · consequence · due/countdown
 * · ONE labelled primary action that opens the real page. Built locally (the
 * kit has no list-row primitive) from kit Card / Pill / Btn and kit CSS tokens.
 *
 * Booking items for short stays / venues / courts / charters (PREVIEW booking engine, own
 * listings) are appended here from useBookingTodayItems(); they carry a Preview pill and only
 * appear when there are any. The page's own items are untouched.
 */
import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Btn, Card, Pill, type Tone } from '@/components/os/kit';
import { useBookingTodayItems } from '@/components/os/bookings/todayItems';

export type TodayTone = 'bad' | 'warn' | 'info';

export interface TodayItem {
  key: string;
  /** Consequence band — lower is worse: 1 gate · 2 reply clock · 3 legal/money clocks · 4 listings · 5 follow-ups · 6 today's diary. */
  band: number;
  tone: TodayTone;
  /** Tie-break inside a band and tone: the earlier deadline first (epoch ms). */
  dueAt?: number;
  icon: LucideIcon;
  title: ReactNode;
  consequence: ReactNode;
  /** Countdown / due text, e.g. "Overdue 3h", "12 days left · by 1 Nov". */
  due: ReactNode;
  /** Same-tab navigation, as the attention cards it replaces did. */
  action: { label: string; href: string };
}

const TONE_RANK: Record<TodayTone, number> = { bad: 0, warn: 1, info: 2 };
const PILL: Record<TodayTone, Tone> = { bad: 'danger', warn: 'amber', info: 'info' };
const ICON_BG: Record<TodayTone, { bg: string; fg: string }> = {
  bad: { bg: 'var(--ms-danger-bg)', fg: 'var(--ms-danger)' },
  warn: { bg: 'var(--ms-amber-bg)', fg: 'var(--ms-amber-text)' },
  info: { bg: 'var(--ms-info-bg)', fg: 'var(--ms-info)' },
};

/** Band → tone → earliest deadline → stable. */
export function rankToday(items: TodayItem[]): TodayItem[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.band - b.it.band)
      || (TONE_RANK[a.it.tone] - TONE_RANK[b.it.tone])
      || ((a.it.dueAt ?? Number.POSITIVE_INFINITY) - (b.it.dueAt ?? Number.POSITIVE_INFINITY))
      || (a.i - b.i))
    .map(x => x.it);
}

export function TodayQueue({ items, loading, failed, onRetry, limit = 8, right }: {
  items: TodayItem[];
  /** True while the first load of the sources is still in flight. */
  loading: boolean;
  /** Sources that could not be checked — named, so an empty queue is never mistaken for "all clear". */
  failed: string[];
  onRetry: () => void;
  limit?: number;
  right?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const bookingItems = useBookingTodayItems();
  const ranked = rankToday(bookingItems.length ? [...items, ...bookingItems] : items);
  const shown = all ? ranked : ranked.slice(0, limit);
  const bad = ranked.filter(i => i.tone === 'bad').length;

  return (
    <div style={{ marginBottom: 14 }}>
      <Card
        title="Today"
        sub={ranked.length
          ? `${ranked.length} thing${ranked.length === 1 ? '' : 's'} need${ranked.length === 1 ? 's' : ''} you${bad ? ` · ${bad} urgent` : ''} — most consequential first: verification, reply clocks, legal and money deadlines, listings, then today's diary`
          : 'Most consequential first: verification, reply clocks, legal and money deadlines, listings, then today’s diary'}
        right={right}
      >
        {failed.length > 0 && (
          <div style={{ padding: '8px 18px', fontSize: 11.5, color: 'var(--ms-amber-text)', background: 'var(--ms-amber-bg)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>Couldn&apos;t check {failed.join(', ')} — this list may be incomplete.</span>
            <Btn size="xs" onClick={onRetry}>Retry</Btn>
          </div>
        )}
        {loading && ranked.length === 0 ? (
          <div style={{ display: 'grid', gap: 10, padding: '14px 18px' }} aria-busy="true">
            {[0, 1, 2].map(i => <div key={i} className="gx-skel" style={{ height: 30 }} />)}
          </div>
        ) : ranked.length === 0 ? (
          <div className="gx-empty"><b>Nothing needs you right now</b>No verification issues, reply clocks, legal deadlines, cheques, rejected listings or diary items today.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((it, idx) => {
              const Icon = it.icon;
              const c = ICON_BG[it.tone];
              return (
                <li key={it.key} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 18px',
                  borderTop: idx === 0 ? undefined : '1px solid var(--ms-surface-3)',
                }}>
                  <span aria-hidden style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', background: c.bg, color: c.fg, flexShrink: 0 }}>
                    <Icon size={15} />
                  </span>
                  <span style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--ms-ink)' }}>{it.title}</span>
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 1 }}>{it.consequence}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                    <Pill tone={PILL[it.tone]}>{it.due}</Pill>
                    <Btn size="sm" variant={it.tone === 'bad' ? 'primary' : undefined} href={it.action.href}>
                      {it.action.label}
                    </Btn>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {ranked.length > limit && (
          <div style={{ padding: '8px 18px 12px', borderTop: '1px solid var(--ms-surface-3)' }}>
            <Btn size="sm" variant="ghost" onClick={() => setAll(v => !v)}>
              {all ? `Show top ${limit}` : `Show all ${ranked.length}`}
            </Btn>
          </div>
        )}
      </Card>
    </div>
  );
}
