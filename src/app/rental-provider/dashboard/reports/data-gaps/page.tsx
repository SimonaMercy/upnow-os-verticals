/**
 * RP data-gaps route — thin wrapper around the shared DataGapsView (the
 * manager portal renders the same view inline with its scoped endpoint).
 *
 * Genspark OS: framed by ReportShell (Insights › Data Gaps & Exceptions).
 *
 * Parity with previous page: same endpoint (GET /api/reports/data-gaps,
 * credentials: include), same DataGapsView (KPI tiles, every section, settings /
 * record links, Print / PDF, "All Reports" back link) — the view is unchanged.
 *
 * Error state (new): the view on its own shows only a bare "Error 500" line with
 * no way to retry, and it is shared with the manager portal so it is not edited.
 * This route therefore fetches the payload itself first. On failure it shows a
 * clear explanation with a "Try again" button; on success it hands the SAME
 * payload to the view through a local blob: URL (the view's `endpoint` prop is
 * a plain fetch() target), so the report is requested once, not twice.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { DataGapsView } from '@/components/upnow/DataGapsView';
import { OsPage, Card, Callout, Btn } from '@/components/os/kit';
import { ReportShell, reportName, REPORTS_HOME } from '../_shell';

const ENDPOINT = '/api/reports/data-gaps';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; status: number | null; message: string }
  | { kind: 'ready'; url: string };

export default function DataGapsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let blobUrl: string | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: 'loading' });
    (async () => {
      try {
        const r = await fetch(ENDPOINT, { credentials: 'include', signal: controller.signal });
        const text = await r.text();
        if (!r.ok) {
          let message = '';
          try { const j = JSON.parse(text) as { message?: unknown }; message = typeof j.message === 'string' ? j.message : ''; } catch { /* not JSON */ }
          setState({ kind: 'error', status: r.status, message });
          return;
        }
        blobUrl = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        setState({ kind: 'ready', url: blobUrl });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', status: null, message: e instanceof Error ? e.message : '' });
      }
    })();
    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [attempt]);

  return (
    <ReportShell name={reportName('data-gaps')}>
      {state.kind === 'ready' ? (
        <DataGapsView key={state.url} endpoint={state.url} backHref={REPORTS_HOME} />
      ) : (
        <OsPage className="pt-0!">
          {state.kind === 'loading' ? (
            <Card pad>
              <div aria-busy="true" style={{ display: 'grid', gap: 10 }}>
                {[70, 55, 62, 48].map((w) => <div key={w} className="gx-skel" style={{ height: 12, width: `${w}%` }} />)}
              </div>
            </Card>
          ) : (
            <Card title="Couldn't load Data Gaps & Exceptions" pad>
              <Callout tone="bad" title={state.status ? `The server returned an error (${state.status}).` : 'The report could not be reached.'}>
                {state.message ? `${state.message} ` : ''}
                The worklist could not be generated right now. Try again in a moment — the other reports
                and the Missing-data worklists are still available.
              </Callout>
              <div className="gx-btn-row" style={{ marginTop: 12 }}>
                <Btn variant="primary" onClick={retry}>Try again</Btn>
                <Btn href={REPORTS_HOME}>Back to all reports</Btn>
              </div>
            </Card>
          )}
        </OsPage>
      )}
    </ReportShell>
  );
}
