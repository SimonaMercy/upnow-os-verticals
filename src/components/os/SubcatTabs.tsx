'use client';

/**
 * Subcategory tabs shared by the three cross-subcategory pages of the provider OS — Demand
 * (All demand), Communications (Inbox) and Calendar: All · Long-term leases · Holiday homes ·
 * Venues · Courts · Yachts (+ Services where that pack is active). The active tab lives in the
 * URL as `?type=<slug>` so it can be bookmarked and survives a refresh.
 */
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { BookingModel } from '@/lib/os/bookings/types';

export type Subcat = 'all' | 'leases' | BookingModel | 'services';

export const SUBCATS: { v: Subcat; slug: string; l: string }[] = [
  { v: 'all', slug: 'all', l: 'All' },
  { v: 'leases', slug: 'leases', l: 'Long-term leases' },
  { v: 'shortstay', slug: 'holiday-homes', l: 'Holiday homes' },
  { v: 'venue', slug: 'venues', l: 'Venues' },
  { v: 'court', slug: 'courts', l: 'Courts' },
  { v: 'charter', slug: 'yachts', l: 'Yachts' },
  { v: 'services', slug: 'services', l: 'Services' },
];

export const SUBCAT_LABEL: Record<Subcat, string> = Object.fromEntries(SUBCATS.map((x) => [x.v, x.l])) as Record<Subcat, string>;

/** Pill colours per subcategory (text / background) — the same in every page. */
export const SUBCAT_TONE: Record<Exclude<Subcat, 'all'>, { fg: string; bg: string; dot: string }> = {
  leases: { fg: '#0f4f36', bg: '#d8efe3', dot: '#047246' },
  shortstay: { fg: '#1d4f8a', bg: '#e8eff9', dot: '#2f6fc4' },
  venue: { fg: '#6b3d9a', bg: '#f1eafb', dot: '#8b5cc7' },
  court: { fg: '#8a5a12', bg: '#f8eedb', dot: '#c98a1c' },
  charter: { fg: '#0b6170', bg: '#e1f3f5', dot: '#1597a8' },
  services: { fg: '#4a4842', bg: '#eef1ef', dot: '#6b7069' },
};

/** `?type=` ⇄ Subcat. Unknown or missing → 'all'. */
export function useSubcatParam(allowed: Subcat[] = SUBCATS.map((x) => x.v)): [Subcat, (v: Subcat) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const slug = params.get('type');
  const hit = SUBCATS.find((x) => x.slug === slug && allowed.includes(x.v));
  const value: Subcat = hit?.v ?? 'all';
  const set = useCallback((v: Subcat) => {
    const q = new URLSearchParams(params.toString());
    const s = SUBCATS.find((x) => x.v === v)?.slug ?? 'all';
    if (s === 'all') q.delete('type'); else q.set('type', s);
    router.replace(`${pathname}${q.toString() ? `?${q}` : ''}`, { scroll: false });
  }, [params, router, pathname]);
  return [value, set];
}

/** The tab row itself (underlined tabs with counts). */
export function SubcatTabs({ value, onChange, counts, options, label = 'Subcategory' }: {
  value: Subcat;
  onChange: (v: Subcat) => void;
  counts?: Partial<Record<Subcat, number>>;
  options?: Subcat[];
  label?: string;
}) {
  const list = SUBCATS.filter((x) => (options ?? SUBCATS.filter((y) => y.v !== 'services').map((y) => y.v)).includes(x.v));
  return (
    <div role="tablist" aria-label={label}
      style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--ms-border)', marginBottom: 12, overflowX: 'auto', scrollbarWidth: 'none' }}>
      {list.map((x) => {
        const on = x.v === value;
        const n = counts?.[x.v];
        return (
          <button key={x.v} type="button" role="tab" aria-selected={on} onClick={() => onChange(x.v)}
            style={{
              flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 12px', marginBottom: -1,
              border: 0, borderBottom: `2px solid ${on ? 'var(--ms-primary)' : 'transparent'}`, background: 'none', cursor: 'pointer',
              font: 'inherit', fontSize: 12.5, fontWeight: on ? 700 : 600, color: on ? 'var(--ms-primary-dark)' : 'var(--ms-ink-2)', whiteSpace: 'nowrap',
            }}>
            {x.v !== 'all' && <i aria-hidden style={{ width: 7, height: 7, borderRadius: 99, background: SUBCAT_TONE[x.v].dot, display: 'inline-block' }} />}
            {x.l}
            {n != null && (
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '0 6px', borderRadius: 999, background: on ? 'var(--ms-tint)' : 'var(--ms-surface-3)', color: on ? 'var(--ms-primary-dark)' : 'var(--ms-ink-3)' }}>{n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A small pill naming an item's subcategory. */
export function SubcatPill({ v }: { v: Exclude<Subcat, 'all'> }) {
  const t = SUBCAT_TONE[v];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: t.fg, background: t.bg, whiteSpace: 'nowrap' }}>
      <i aria-hidden style={{ width: 5, height: 5, borderRadius: 99, background: t.dot, display: 'inline-block' }} />{SUBCAT_LABEL[v]}
    </span>
  );
}

/** "Preview" tag for an item that runs on preview data (no banners — item-level only). */
export function PreviewTag() {
  return (
    <span title="Demonstration data — no backend yet"
      style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 999, background: '#fdf3d9', color: '#7a5410', border: '1px dashed #d9b46a', whiteSpace: 'nowrap' }}>
      Preview
    </span>
  );
}
