'use client';
/**
 * Listing-quality UI shared by Catalogue › Units & listings and the Add-units wizard.
 * Both render the result of the ONE scorer in src/lib/os/listingQuality.ts.
 */
import type { ReactNode } from 'react';
import { Btn, Checklist, Pill } from '@/components/os/kit';
import type { ListingQuality, QualityCheck } from '@/lib/os/listingQuality';

const barTone = (q: ListingQuality) => (q.tone === 'primary' ? '' : ` ${q.tone}`);

/** Score + coloured bar — the table cell / card line. */
export function QualityMeter({ q, compact = false }: { q: ListingQuality | null; compact?: boolean }) {
  if (!q) return <span className="sub">Checking…</span>;
  const title = `${q.bandLabel} · ${q.score}/100${q.missing.length ? ` — missing: ${q.missing.map(m => m.label).join(', ')}` : ''}${q.pending ? ' (photo count unavailable)' : ''}`;
  return (
    <span title={title} style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, minWidth: compact ? 70 : 86 }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span className="strong" style={{ fontVariantNumeric: 'tabular-nums' }}>{q.score}{q.pending ? '*' : ''}</span>
        <span className="sub" style={{ marginTop: 0 }}>{q.bandLabel}</span>
      </span>
      <span className={`gx-bar${barTone(q)}`} style={{ display: 'block' }} aria-hidden><i style={{ width: `${q.score}%` }} /></span>
    </span>
  );
}

/**
 * Score header + checklist. Missing items first (heaviest first), then the passing ones.
 * `onFixItem` renders a labelled "Fix" button per missing item (wizard: jumps to the step);
 * `action` renders one button under the list (Units page: opens the edit unit modal).
 */
export function QualityPanel({ q, onFixItem, action, title = 'Listing quality', showPassing = true }: {
  q: ListingQuality; onFixItem?: (c: QualityCheck) => void; action?: ReactNode; title?: string; showPassing?: boolean;
}) {
  const passing = q.checks.filter(c => c.pass === true);
  const unknown = q.checks.filter(c => c.pass == null);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span className="gx-lb" style={{ marginBottom: 0 }}>{title}</span>
        <span style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{q.score}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ms-ink-3)' }}>/100</span></span>
        <Pill tone={q.tone}>{q.bandLabel}</Pill>
        <span className={`gx-bar${barTone(q)}`} style={{ display: 'block', flex: '1 1 80px', minWidth: 80 }} aria-hidden><i style={{ width: `${q.score}%` }} /></span>
      </div>
      {q.missing.length === 0 && !q.pending && (
        <div style={{ fontSize: 11.5, color: 'var(--ms-ink-3)', marginBottom: 6 }}>Every quality check passes.</div>
      )}
      <Checklist items={[
        ...q.missing.map(c => ({
          state: 'fail' as const,
          l: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {c.label} <span style={{ color: 'var(--ms-ink-3)', fontWeight: 600 }}>· {c.weight} pts</span>
              {onFixItem && <Btn size="xs" onClick={() => onFixItem(c)}>Fix</Btn>}
            </span>
          ),
          sub: `${c.detail} — ${c.fix}`,
        })),
        ...unknown.map(c => ({ state: 'wait' as const, l: c.label, sub: 'Not known yet — left out of the score.' })),
        ...(showPassing ? passing.map(c => ({ state: 'pass' as const, l: c.label, sub: c.detail })) : []),
      ]} />
      {!showPassing && passing.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ms-ink-3)', marginTop: 7 }}>
          {passing.length} of {q.checks.length} checks pass: {passing.map(c => c.label).join(' · ')}
        </div>
      )}
      {action && <div className="gx-btn-row" style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}
