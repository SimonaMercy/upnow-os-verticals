'use client';

/**
 * Shared decision-model pieces for the admin portal's three gates (Gate 1 KYC, Gate 2 authorisation,
 * Gate 3 listings): the reason-code picker, the DSA-style statement-of-reasons preview and the queue
 * SLA pill. Catalogue + text composition live in `@/lib/os/reasonCodes`. Nothing here calls an API —
 * each queue sends the composed text through its own existing endpoint and field.
 */
import { useCallback, useMemo, useState } from 'react';
import { Field, KV, Pill } from '@/components/os/kit';
import {
  hoursSince, reasonByCode, reasonError, reasonsFor, slaBand, statementOf, waitLabel,
  type GateId, type ReasonCode, type ReasonDecision,
} from '@/lib/os/reasonCodes';

/** Picker state for one decision modal. `reset()` when the modal opens. */
export function useReasonCodes() {
  const [codes, setCodes] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const selected = useMemo(() => codes.map(reasonByCode).filter(Boolean) as ReasonCode[], [codes]);
  const reset = useCallback(() => { setCodes([]); setText(''); setTouched(false); }, []);
  const toggle = useCallback((code: string) => {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }, []);
  return { codes, selected, text, setText, toggle, reset, touched, setTouched, error: reasonError(selected, text) };
}
export type ReasonState = ReturnType<typeof useReasonCodes>;

/** Reason-code chips (multi-select) + optional free text. */
export function ReasonPicker({ gate, decision, state, idPrefix, textHint }: {
  gate: GateId; decision: ReasonDecision; state: ReasonState; idPrefix: string; textHint?: string;
}) {
  const options = reasonsFor(gate, decision);
  return (
    <>
      <div className="gx-form-row">
        <span className="gx-lb" id={`${idPrefix}-codes`}>Reason codes (pick one or more)</span>
        <div className="gx-chips" role="group" aria-labelledby={`${idPrefix}-codes`}>
          {options.map((r) => (
            <button key={r.code} type="button" className="gx-chip" aria-pressed={state.codes.includes(r.code)}
              title={`${r.explanation} To fix: ${r.fix}`}
              onClick={() => { state.toggle(r.code); state.setTouched(true); }}>
              {r.label}
            </button>
          ))}
        </div>
        {state.selected.length > 0 && (
          <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 11.5, lineHeight: 1.55, color: 'var(--ms-ink-2)' }}>
            {state.selected.map((r) => (
              <li key={r.code}><strong>{r.code}</strong> — {r.explanation} <span style={{ color: 'var(--ms-ink-3)' }}>To fix: {r.fix}</span></li>
            ))}
          </ul>
        )}
      </div>
      <Field label="Note to the provider (optional)" htmlFor={`${idPrefix}-text`}
        error={state.touched && state.error ? state.error : undefined}
        hint={textHint ?? 'Added after the reason codes. Be specific so the fix is right first time.'}>
        <textarea id={`${idPrefix}-text`} className="gx-ta" rows={3} value={state.text}
          onChange={(e) => { state.setText(e.target.value); }} />
      </Field>
    </>
  );
}

/** DSA-style statement of reasons, previewed before the decision is sent. */
export function StatementPreview({ decisionLabel, state, sentAs, prefix = '' }: {
  decisionLabel: string; state: ReasonState; sentAs: string;
  /** Text the queue already prepends before sending (e.g. "Changes requested: "). */
  prefix?: string;
}) {
  const st = statementOf(decisionLabel, state.selected, state.text);
  const s = { ...st, providerText: st.providerText ? `${prefix}${st.providerText}` : '' };
  return (
    <div style={{ marginTop: 10, border: '1px solid var(--ms-border)', borderRadius: 10, padding: '10px 12px', background: 'var(--ms-surface-2)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ms-ink-3)' }}>Statement of reasons</span>
        <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ms-ink-3)' }}>Sent as {sentAs}</span>
      </div>
      <KV items={[
        { k: 'Decision', v: s.decision },
        { k: 'Category', v: s.categories.length ? s.categories.join(', ') : '—' },
        { k: 'Specific reason', v: s.reasons.length ? s.reasons.join('; ') : '—' },
        { k: 'Ground', v: s.grounds.length ? s.grounds.join('; ') : '—' },
        { k: 'Automated detection', v: 'No — found by a human reviewer' },
        { k: 'Automated decision', v: 'No — decided by a human reviewer' },
      ]} />
      <div style={{ marginTop: 8 }}>
        <div className="gx-lb">Provider sees</div>
        <div style={{ fontSize: 11.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', color: s.providerText ? 'var(--ms-ink)' : 'var(--ms-ink-3)' }}>
          {s.providerText || 'Pick a reason code to build the message.'}
        </div>
        {s.providerText && <div style={{ fontSize: 10, color: 'var(--ms-ink-3)', marginTop: 4 }}>{s.providerText.length} characters</div>}
      </div>
    </div>
  );
}

/**
 * Queue waiting-time pill: neutral under 24h, amber from 24h, red after 48h.
 * Pass `iso` (a real timestamp) or `hours` (already computed, e.g. preview data).
 */
export function SlaPill({ iso, hours, what = 'Waiting', title }: { iso?: string | null; hours?: number | null; what?: string; title?: string }) {
  // eslint-disable-next-line react-hooks/purity -- waiting time needs the current time
  const h = hours !== undefined ? hours : hoursSince(iso, Date.now());
  const band = slaBand(h);
  if (band == null) return null;
  const tone = band === 'red' ? 'danger' : band === 'amber' ? 'amber' : 'outline';
  const tip = `${title ?? 'Waiting time'} — amber after 24h, red after 48h`;
  return <Pill tone={tone} dot={band !== 'ok'} title={tip}>{what} {waitLabel(h)}</Pill>;
}
