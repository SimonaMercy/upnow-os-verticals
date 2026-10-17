'use client';

/**
 * Admin › Platform › Audit history — PREVIEW (Gate 2 decisions from the preview store only).
 * New page — no previous page to keep parity with. Gate 1 / Gate 3 decisions are recorded by the
 * backend's existing admin actions and are not surfaced here yet.
 */
import { useMemo, useState } from 'react';
import {
  Callout, EmptyRow, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, SearchField, TableWrap, type Tone,
} from '@/components/os/kit';
import { usePreview } from '@/lib/os/preview';

const decisionTone = (d: string): Tone =>
  /^granted|^approved/i.test(d) ? 'primary' : /^refused|^rejected/i.test(d) ? 'danger' : /^changes/i.test(d) ? 'amber' : 'neutral';

export default function AuditHistoryPage() {
  const { audit } = usePreview();
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return audit;
    return audit.filter((r) => [r.actor, r.subject, r.decision, r.ev].some((x) => x.toLowerCase().includes(s)));
  }, [audit, q]);

  return (
    <OsPage>
      <PageHead
        eyebrow="Platform"
        title="Audit history"
        lede="Who authorised this business to operate this vertical, and on what evidence, has to be answerable."
      />
      <PreviewBanner>Gate 2 has no backend yet — these entries are demonstration data and the decisions you make in the authorisation queue in this browser tab.</PreviewBanner>
      <ScopeStrip items={[
        { label: 'Workspace', value: 'Platform' },
        { label: 'Entries', value: audit.length },
        { label: 'Data', value: <PreviewPill /> },
      ]} />
      <div style={{ marginBottom: 14 }}>
        <Callout tone="info" title="Gate 2 only.">
          Gate 1 (business verification) and Gate 3 (listing approval) decisions are recorded by the backend&apos;s existing admin actions and are not yet surfaced here.
        </Callout>
      </div>
      <TableWrap toolbar={<SearchField value={q} onChange={setQ} placeholder="Search actor, subject, decision or evidence" />}>
        <table className="gx-tbl">
          <thead><tr><th>When</th><th>Actor</th><th>Gate</th><th>Subject</th><th>Decision</th><th>Evidence</th></tr></thead>
          {rows.length === 0 ? (
            <EmptyRow cols={6} title={audit.length ? 'No entries match' : 'No decisions yet'}
              text={audit.length ? 'Clear the search to see every entry.' : 'Decisions made in the authorisation queue appear here.'} />
          ) : (
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.when}-${r.subject}-${i}`}>
                  <td className="mono nowrap">{r.when}</td>
                  <td>{r.actor}</td>
                  <td><Pill tone="dark" dot={false}>Gate {r.gate}</Pill></td>
                  <td className="strong">{r.subject}</td>
                  <td><Pill tone={decisionTone(r.decision)}>{r.decision}</Pill></td>
                  <td className="mono">{r.ev}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </TableWrap>
    </OsPage>
  );
}
