'use client';

/**
 * StageStrip — a flow drawn as numbered stages, each with a live count, a one-line
 * explanation and a link to where that stage is worked. Zero counts still render, so the
 * flow itself is always visible (an empty account still reads as "this is how a job moves").
 *
 * Inline styles on purpose: it is used both inside the Genspark `.gx` scope (whose
 * unlayered resets beat Tailwind utilities) and on legacy Tailwind pages.
 */
import Link from 'next/link';
import type { CSSProperties } from 'react';

export interface StripStage {
  key: string;
  label: string;
  count: number | null;
  /** One line: what this stage means / who moves it on. */
  hint: string;
  href?: string;
  /** Highlight as "needs you". */
  attention?: boolean;
}

const cell: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, padding: '11px 12px 12px', minWidth: 0,
  background: '#fff', border: '1px solid #e3e7e4', borderRadius: 12, textDecoration: 'none', color: '#14201a',
  position: 'relative',
};

export function StageStrip({ stages, loading = false, ariaLabel }: { stages: StripStage[]; loading?: boolean; ariaLabel: string }) {
  return (
    <ol aria-label={ariaLabel}
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))' }}>
      {stages.map((st, i) => {
        const n = st.count ?? 0;
        const live = n > 0;
        const style: CSSProperties = {
          ...cell,
          ...(live ? { borderColor: st.attention ? '#e6b54a' : '#9fd0b8', background: st.attention ? '#fffaf0' : '#f6fbf8' } : null),
        };
        const body = (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span aria-hidden style={{
                width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flex: 'none',
                background: live ? (st.attention ? '#c77d0a' : '#0b7a4e') : '#eef1ef', color: live ? '#fff' : '#5f6b63',
              }}>{i + 1}</span>
              <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: live ? '#14201a' : '#a3aba6' }}>
                {loading ? '…' : n}
              </span>
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{st.label}</span>
            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: '#6b756f' }}>{st.hint}</span>
            {st.href && <span style={{ marginTop: 'auto', paddingTop: 4, fontSize: 11, fontWeight: 700, color: '#0b7a4e' }}>Open →</span>}
          </>
        );
        return (
          <li key={st.key} style={{ display: 'flex', minWidth: 0 }}>
            {st.href
              ? <Link href={st.href} style={{ ...style, flex: 1 }} title={`${st.label}: ${loading ? 'loading' : n} — ${st.hint}`}>{body}</Link>
              : <div style={{ ...style, flex: 1 }}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
