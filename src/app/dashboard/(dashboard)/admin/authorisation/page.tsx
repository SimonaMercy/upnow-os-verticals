'use client';

/**
 * Admin › Vertical authorisation queue (Gate 2) — PREVIEW (Gate 2 has no backend yet; requests and
 * decisions live in the preview store in this browser tab). New page — no previous page to keep parity with.
 * Requests marked own=true come from the provider workspace in the same tab ("Your business").
 *
 * Decision model (blueprint "three gates, one decision model") — added, nothing removed:
 *  - Ask for changes / Reject take Gate 2 reason codes from src/lib/os/reasonCodes.ts + an optional note,
 *    with a statement-of-reasons preview; the composed "[CODE] Explanation To fix: … — note" is what
 *    decide(id, state, reason) stores (preview store — same call as before).
 *  - Queue SLA: waiting pill from the preview request's `wait` (preview data has no timestamp — parsed
 *    from "8h" / "2d" / "just now"), amber after 24h, red after 48h. Order defaults to Oldest first;
 *    "Queue order" keeps the previous order. Search unchanged.
 */
import { useMemo, useState } from 'react';
import { ReasonPicker, SlaPill, StatementPreview, useReasonCodes } from '@/components/upnow/GateDecision';
import { composeReasonText } from '@/lib/os/reasonCodes';
import {
  Btn, Callout, Card, Checklist, Evid, KV, Modal, OsPage, PageHead, Pill, PreviewBanner, PreviewPill, ScopeStrip, SearchField, Seg, type Tone,
} from '@/components/os/kit';
import { verticalOf, type MsVerticalId } from '@/lib/catalog';
import { licenceNeeded, usePreview, type AuthRequest } from '@/lib/os/preview';

const STATE: Record<AuthRequest['state'], { l: string; tone: Tone }> = {
  waiting: { l: 'Waiting', tone: 'amber' },
  granted: { l: 'Granted', tone: 'primary' },
  changes: { l: 'Changes requested', tone: 'amber' },
  refused: { l: 'Refused', tone: 'danger' },
};

/** Licensing authorities whose licences can cover each vertical. */
const AUTHORITIES: Record<MsVerticalId, string[]> = {
  spaces: ['DED', 'DET', 'DLD', 'DTCM', 'RERA'],
  services: ['DED', 'DET'],
  experiences: ['DTCM', 'DET'],
  memberships: ['Municipality'],
  programs: ['KHDA', 'MOE', 'ADEK'],
  health: ['DHA', 'DOH', 'MOHAP'],
  insurance: ['CBUAE'],
};

const vLabel = (v: MsVerticalId) => verticalOf(v)?.label ?? v;

/** Preview requests carry a relative `wait` ("8h", "2d", "just now") instead of a timestamp. */
function waitHours(wait: string): number | null {
  const w = wait.trim().toLowerCase();
  if (w === 'just now') return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d|w|mo)$/.exec(w);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'm' ? n / 60 : m[2] === 'h' ? n : m[2] === 'd' ? n * 24 : m[2] === 'w' ? n * 168 : n * 720;
}

function parseExp(exp: string): Date | null {
  const d = new Date(exp);
  return Number.isNaN(d.getTime()) ? null : d;
}

function licenceChecks(r: AuthRequest) {
  const note = r.note.toLowerCase();
  const exp = parseExp(r.exp);
  const authorityOk = AUTHORITIES[r.vertical].some((a) => r.licence.includes(a));
  const scopeFail = r.state === 'refused' || note.includes('excludes') || note.includes('not supplied');
  return [
    { l: 'Licence current', sub: note.includes('expired') ? 'A supporting document has expired' : r.licence, state: note.includes('expired') ? 'fail' as const : 'pass' as const },
    { l: 'Scope covers the activity', sub: scopeFail ? r.note : `Covers ${vLabel(r.vertical)}`, state: scopeFail ? 'fail' as const : 'pass' as const },
    { l: 'Issuing authority matches', sub: `Expected: ${AUTHORITIES[r.vertical].join(' / ')}`, state: authorityOk ? 'pass' as const : 'fail' as const },
    { l: 'Expiry in the future', sub: exp ? `Expires ${r.exp}` : 'No expiry date on the request', state: !exp ? 'wait' as const : exp.getTime() > Date.now() ? 'pass' as const : 'fail' as const },
  ];
}

export default function AuthorisationQueuePage() {
  const { requests, decide } = usePreview();
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [asking, setAsking] = useState<'changes' | 'refused' | null>(null);
  const reasons = useReasonCodes();
  const [order, setOrder] = useState<'oldest' | 'queue'>('oldest');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const found = !s ? requests : requests.filter((r) => [r.business, vLabel(r.vertical), r.licence, r.id].some((x) => x.toLowerCase().includes(s)));
    if (order === 'queue') return found;
    // Oldest first: waiting requests by longest wait, decided requests after them in queue order.
    const key = (r: AuthRequest) => (r.state === 'waiting' ? waitHours(r.wait) ?? 0 : -1);
    return [...found].sort((a, b) => key(b) - key(a));
  }, [requests, q, order]);
  const sel = requests.find((r) => r.id === selId) ?? list[0] ?? null;
  const waiting = requests.filter((r) => r.state === 'waiting').length;

  const openAsk = (k: 'changes' | 'refused') => { reasons.reset(); setAsking(k); };
  const closeAsk = () => { setAsking(null); reasons.reset(); };
  const confirmAsk = () => {
    if (!sel || !asking) return;
    reasons.setTouched(true);
    if (reasons.error) return;
    decide(sel.id, asking, composeReasonText(reasons.selected, reasons.text));
    closeAsk();
  };

  return (
    <OsPage>
      <PageHead
        eyebrow="Vertical authorisation"
        title="Authorisation queue"
        lede="Businesses asking to operate a vertical. Check the licence they rely on covers that vertical, then approve, ask for changes or reject."
      />
      <PreviewBanner>Vertical authorisation has no backend yet. These requests and your decisions are demonstration data held in this browser tab.</PreviewBanner>
      <ScopeStrip items={[
        { label: 'Gate', value: 'Gate 2 · Vertical authorisation' },
        { label: 'Waiting', value: waiting },
        { label: 'Total', value: requests.length },
        { label: 'Data', value: <PreviewPill /> },
      ]} />

      <div className="gx-split">
        <div className="gx-split-l">
          <div style={{ padding: 10, borderBottom: '1px solid var(--ms-surface-3)' }}>
            <SearchField value={q} onChange={setQ} placeholder="Search business, vertical or licence" />
            <div style={{ marginTop: 8 }}>
              <Seg<'oldest' | 'queue'> label="Order" value={order} onChange={setOrder} options={[{ v: 'oldest', l: 'Oldest first' }, { v: 'queue', l: 'Queue order' }]} />
            </div>
          </div>
          <div role="listbox" aria-label="Authorisation requests">
            {list.length === 0 && <div className="gx-empty"><b>No requests match</b>Clear the search to see the whole queue.</div>}
            {list.map((r) => (
              <button key={r.id} type="button" role="option" className="gx-qitem" aria-selected={sel?.id === r.id} onClick={() => setSelId(r.id)}>
                <span className="t">{r.business}</span>
                <span className="s">{vLabel(r.vertical)} · {r.id}</span>
                <span className="f">
                  {r.state === 'waiting'
                    ? (waitHours(r.wait) != null ? <SlaPill hours={waitHours(r.wait)} title="Preview wait time" /> : <Pill tone="amber">Waiting {r.wait}</Pill>)
                    : <Pill tone={STATE[r.state].tone}>{STATE[r.state].l}</Pill>}
                  {r.own && <Pill tone="info" dot={false}>Your business</Pill>}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="gx-split-r">
          {!sel ? (
            <div className="gx-empty"><b>Nothing selected</b>Pick a request on the left.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800 }}>{sel.business}</h2>
                <Pill tone={STATE[sel.state].tone}>{STATE[sel.state].l}</Pill>
                {sel.own && <Pill tone="info" dot={false}>Your business</Pill>}
              </div>
              <Card title="Request" pad>
                <KV items={[
                  { k: 'Business', v: sel.business },
                  { k: 'Vertical', v: vLabel(sel.vertical) },
                  { k: 'Licence relied on', v: sel.licence },
                  { k: 'Expiry', v: sel.exp },
                  { k: 'Licence the vertical needs', v: licenceNeeded(sel.vertical) },
                  { k: 'Note', v: sel.note },
                ]} />
              </Card>
              <div style={{ marginTop: 12 }}>
                <Card title="Gate 2 licence review" pad>
                  <Checklist items={licenceChecks(sel)} />
                </Card>
              </div>
              <div style={{ marginTop: 12 }}>
                <Evid>Per-vertical decision. Approving unlocks only this vertical — {vLabel(sel.vertical)} — for {sel.business}; other verticals are unaffected.</Evid>
              </div>
              {sel.state !== 'waiting' && (
                <div style={{ marginTop: 10 }}>
                  <Evid tone={sel.state === 'granted' ? 'ok' : sel.state === 'refused' ? 'bad' : 'warn'}>
                    Decision recorded: {STATE[sel.state].l} — {vLabel(sel.vertical)}. {sel.state !== 'granted' && `Reason: ${sel.note}`}
                  </Evid>
                </div>
              )}
              {(sel.state === 'waiting' || sel.state === 'changes') && (
                <div className="gx-btn-row" style={{ marginTop: 14 }}>
                  <Btn variant="primary" onClick={() => decide(sel.id, 'granted', '')}>Approve</Btn>
                  <Btn variant="amber" onClick={() => openAsk('changes')}>Ask for changes</Btn>
                  <Btn variant="danger" onClick={() => openAsk('refused')}>Reject</Btn>
                </div>
              )}
              {sel.own && (
                <div style={{ marginTop: 12 }}>
                  <Callout tone="info">This request came from the provider workspace in this tab — your decision updates that business&apos;s Vertical authorisations page.</Callout>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={!!asking} onClose={closeAsk} width={580} title={asking === 'refused' ? 'Reject authorisation' : 'Ask for changes'}
        footer={<>
          <Btn onClick={closeAsk}>Cancel</Btn>
          <Btn variant={asking === 'refused' ? 'danger' : 'amber'} onClick={confirmAsk}>{asking === 'refused' ? 'Reject' : 'Send request'}</Btn>
        </>}>
        <div style={{ marginBottom: 10 }}><PreviewBanner>Preview — this decision is held in this browser tab only.</PreviewBanner></div>
        <ReasonPicker gate={2} decision={asking === 'refused' ? 'reject' : 'changes'} state={reasons} idPrefix="az"
          textHint={asking === 'refused' ? 'Explain why the licence does not cover this vertical.' : 'Say exactly which evidence is missing or needs correcting.'} />
        <StatementPreview decisionLabel={asking === 'refused' ? `Reject — ${sel ? vLabel(sel.vertical) : ''} authorisation (Gate 2)` : 'Request changes (Gate 2)'}
          state={reasons} sentAs="the decision reason (preview)" />
      </Modal>
    </OsPage>
  );
}
