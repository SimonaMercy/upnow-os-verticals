'use client';

/**
 * Lease Journey (v2) — the tenancy told in the DESIGN's own lanes.
 *
 * The sibling `/lifecycle` page reconstructs a story from the audit trail and
 * groups it into six hand-rolled milestones. This reads the recorded STEPS and
 * groups them into the lanes the business actually defined, so the page shows the
 * process rather than an approximation of it.
 *
 * EMPTY LANES ARE SHOWN. A lane the tenancy has not reached is the most useful
 * thing here — it is what has not happened yet. Hiding them would make a stalled
 * tenancy look complete, which is the failure this whole board exists to prevent.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet } from '@/lib/api';

type Change = { field: string; from: unknown; to: unknown };
type Step = {
  seq: number;
  lane: string;
  action: string;
  label: string;
  actor: string;
  occurredAt: string;
  waitHours: number | null;
  evidence: {
    auditId: number | null;
    actionKey: string | null;
    actorName: string | null;
    actorRole: string | null;
    changed: Change[];
  };
};
type Lane = {
  id: string;
  title: string;
  pipeline: string;
  steps: Step[];
  durationHours: number | null;
  empty: boolean;
};
type Subject = {
  unit: string | null; property: string | null; customer: string | null;
  annualRent: number | null; startDate: string | null; endDate: string | null;
};
type Journey = {
  flow: {
    id: number; state: string; leadId: number | null; contractId: number | null; openedAt: string;
    subject?: Subject;
  };
  pipelines: Array<{ key: string; title: string; lanes: Lane[] }>;
  totalSteps: number;
};

/** Actor colours — one hue per role, used for both the dot and the badge. */
const ACTOR: Record<string, { bg: string; text: string; ring: string; dot: string; label: string }> = {
  customer: { bg: 'bg-sky-50',    text: 'text-sky-700',    ring: 'ring-sky-200',    dot: 'bg-sky-400',    label: 'Customer' },
  manager:  { bg: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-200', dot: 'bg-violet-400', label: 'Manager' },
  rp:       { bg: 'bg-emerald-50',text: 'text-emerald-700',ring: 'ring-emerald-200',dot: 'bg-emerald-400',label: 'Landlord' },
  system:   { bg: 'bg-slate-100', text: 'text-slate-600',  ring: 'ring-slate-200',  dot: 'bg-slate-400',  label: 'System' },
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
  });

/** Hours as something a person reads without converting in their head. */
function dur(h: number | null): string | null {
  if (h == null) return null;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * Collapse a run of the SAME action into one card.
 *
 * An inspection autosaves, so one sitting produces eight identical rows minutes
 * apart. Rendering them as eight steps makes a lane look busy when one thing
 * happened, and buries the steps that matter. The audit rows are all still
 * there — this is presentation, and the count says how many.
 *
 * Only CONSECUTIVE repeats collapse: the same action returned to after other
 * work is a second occasion, not a continuation of the first.
 */
/**
 * Actions where each occurrence is a DIFFERENT THING and must stay visible.
 *
 * Collapsing an autosave is right: one sitting, one step. Collapsing two
 * document uploads is not — "Document uploaded ×2" cannot answer *which two*,
 * which is the only thing anyone wants to know from that row.
 */
const NEVER_COLLAPSE = new Set([
  'doc_uploaded', 'doc_replaced', 'pay_edited', 'pay_reference',
  // A STAGE MOVE IS NEVER A REPEAT. Collapsing three of them into "Lead stage
  // changed ×3" showed the FIRST transition and silently swallowed the other
  // two, so the lane claimed the lead went interested → contacted and stopped.
  // Each move is a different fact about where the lead got to.
  'lead_stage', 'cheque_status', 'termination_resp', 'settlement_paid',
]);

function groupRepeats(steps: Step[]): Array<{ step: Step; count: number; lastAt: string }> {
  const out: Array<{ step: Step; count: number; lastAt: string }> = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (!NEVER_COLLAPSE.has(s.action) && prev && prev.step.action === s.action && prev.step.actor === s.actor) {
      prev.count += 1;
      prev.lastAt = s.occurredAt;
      continue;
    }
    out.push({ step: s, count: 1, lastAt: s.occurredAt });
  }
  return out;
}

/** Turn a stored document key into something a person reads. */
function docName(key: unknown): string | null {
  if (typeof key !== 'string' || !key) return null;
  // Uploads append a timestamp to keep keys unique; it is noise on screen.
  return key.replace(/_\d{10,}$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Turn a stored enum into words: `payment_plan_shared` → `Payment plan shared`.
 */
function human(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const t = v.replace(/_/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * THE TRANSITION IS THE HEADLINE, not a footnote.
 *
 * "Lead stage changed" is the same eleven characters on every stage move, so a
 * lane full of them reads as one thing happening repeatedly. The part anyone
 * actually wants — WHICH stage it moved to — was 11px grey text underneath.
 * When a step's only real change is a state field, that change becomes the
 * title and the generic label is dropped.
 */
const STATE_FIELDS = ['stage', 'status', 'cheque_status', 'ejari_status', 'utility_status', 'state'];

function transitionOf(changed: Change[]): { from: string | null; to: string; field: string } | null {
  const c = changed.find((x) => STATE_FIELDS.includes(x.field));
  const to = human(c?.to);
  if (!c || !to) return null;
  return { from: human(c.from), to, field: c.field };
}

/** Fils are stored as integers; the board reads in whole AED. */
const aed = (fils: unknown): string => {
  const n = Number(fils);
  return Number.isFinite(n) ? `AED ${(n / 100).toLocaleString('en-AE', { maximumFractionDigits: 0 })}` : '—';
};
const shortDate = (d: unknown): string | null => {
  if (typeof d !== 'string' || !d) return null;
  const t = new Date(d);
  return Number.isNaN(+t) ? null : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Asia/Dubai' });
};

type PlanItem = { description?: string; type?: string; amountFils?: number; vatFils?: number; dueDate?: string };
type ChequeRow = { cheque_serial?: string; bank_name?: string; amount_fils?: string | number; due_date?: string; status?: string };

/**
 * SHOW THE OFFER, NOT THAT AN OFFER HAPPENED.
 *
 * `val()` rendered any object as "updated" and any array as "3 items", so the
 * two rows that carry the actual commercial substance — the payment plan and
 * the cheques — said nothing at all. Both are captured in full; they were only
 * ever a rendering failure. A plan is what we OFFERED, and a cheque list is
 * what the customer actually handed over, which is the whole point of the lane.
 */
function planLines(v: unknown): PlanItem[] | null {
  const items = (v as { items?: unknown })?.items;
  return Array.isArray(items) && items.length ? (items as PlanItem[]) : null;
}
function chequeRows(v: unknown): ChequeRow[] | null {
  return Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null && 'cheque_serial' in (v[0] as object)
    ? (v as ChequeRow[]) : null;
}

function val(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'updated';
  return String(v).slice(0, 60);
}

export default function JourneyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Journey | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Journey>(`/activity/journey/${id}`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load the journey'));
  }, [id]);

  if (err) {
    return (
      <div className="p-6">
        <button onClick={() => router.back()} className="mb-4 text-sm text-slate-500 hover:text-slate-800">← Back</button>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {err}
          <div className="mt-1 text-xs text-amber-700">
            Nothing has been recorded against this lease yet. Steps appear here as they happen.
          </div>
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-slate-400">Loading the journey…</div>;

  const reached = data.pipelines.filter((p) => p.lanes.some((l) => l.steps.length));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <button onClick={() => router.back()} className="mb-4 text-sm text-slate-500 hover:text-slate-800">← Back</button>

      <h1 className="text-xl font-bold text-slate-900">
        Lease Journey
        {data.flow.subject?.unit ? (
          <span className="ml-2 font-semibold text-slate-500">
            · Unit {data.flow.subject.unit}
            {data.flow.subject.property ? `, ${data.flow.subject.property}` : ''}
          </span>
        ) : null}
      </h1>
      {/* WHAT THE TRAIL IS ABOUT. Without this every card below is a change to
          something the reader cannot name. */}
      {data.flow.subject?.customer || data.flow.subject?.annualRent ? (
        <p className="mt-1 text-sm text-slate-600">
          {data.flow.subject?.customer ? <b className="font-semibold text-slate-800">{data.flow.subject.customer}</b> : null}
          {data.flow.subject?.annualRent ? (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="tabular-nums">AED {data.flow.subject.annualRent.toLocaleString('en-AE', { maximumFractionDigits: 0 })}/yr</span>
            </>
          ) : null}
          {data.flow.subject?.startDate ? (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="tabular-nums">
                {new Date(data.flow.subject.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}
                {data.flow.subject?.endDate
                  ? ` — ${new Date(data.flow.subject.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })}`
                  : ''}
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1 text-sm text-slate-500">
        {data.flow.leadId ? <>Lead <b className="text-slate-700">#{data.flow.leadId}</b> → </> : null}
        Lease <b className="text-slate-700">#{data.flow.contractId}</b>
        <span className="mx-2 text-slate-300">·</span>
        {data.totalSteps} step{data.totalSteps === 1 ? '' : 's'} recorded
        <span className="mx-2 text-slate-300">·</span>
        opened {fmtTime(data.flow.openedAt)}
      </p>

      {reached.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No steps recorded on this tenancy yet.
        </div>
      ) : null}

      {reached.map((p) => (
        <section key={p.key} className="mt-8">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">{p.title}</h2>

          <div className="space-y-1">
            {p.lanes.map((lane) => {
              const d = dur(lane.durationHours);
              return (
                <div key={lane.id} className={lane.empty ? 'opacity-45' : ''}>
                  <div className="flex items-center gap-2 py-1.5">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${lane.empty ? 'bg-slate-200 ring-2 ring-slate-100' : 'bg-slate-800'}`}
                    />
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{lane.id}</span>
                    <span className="text-sm font-medium text-slate-700">{lane.title}</span>
                    {lane.empty ? (
                      <span className="text-[11px] italic text-slate-400">not reached</span>
                    ) : d ? (
                      <span className="text-[11px] tabular-nums text-slate-400">· {d} in lane</span>
                    ) : null}
                  </div>

                  {lane.steps.length ? (
                    <div className="ml-[3px] border-l-2 border-slate-100 pl-5">
                      {groupRepeats(lane.steps).map(({ step: s, count, lastAt }) => {
                        // A NAMED PERSON IS NEVER "System". When the audit row carries a
                        // user but no role — every row written before the actor-role
                        // default shipped — the honest badge is that the role was not
                        // recorded. "System · Sherif Mohamed Atef" contradicts itself.
                        const t = transitionOf(s.evidence.changed);
                        // Don't print the same fact twice — it is the title now.
                        const rest = t ? s.evidence.changed.filter((c) => c.field !== t.field) : s.evidence.changed;
                        const unknownRole = s.actor === 'system' && !!s.evidence.actorName;
                        const a = unknownRole
                          ? { ...ACTOR.system, label: 'Role not recorded' }
                          : (ACTOR[s.actor] ?? ACTOR.system);
                        return (
                          <div key={s.seq} className="relative py-1.5">
                            <span className={`absolute -left-[26px] top-3.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${a.dot}`} />
                            <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-[11px] tabular-nums text-slate-400">{fmtTime(s.occurredAt)}</span>
                                {t ? (
                                  <span className="text-sm font-medium text-slate-800">
                                    {t.from ? (
                                      <>
                                        <span className="text-slate-400">{t.from}</span>
                                        <span className="mx-1.5 text-slate-300">→</span>
                                      </>
                                    ) : null}
                                    {t.to}
                                  </span>
                                ) : (
                                  <span className="text-sm font-medium text-slate-800">{s.label}</span>
                                )}
                                {count > 1 ? (
                                  <span
                                    className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-white"
                                    title={`${count} occurrences, last at ${fmtTime(lastAt)}`}
                                  >
                                    ×{count}
                                  </span>
                                ) : null}
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${a.bg} ${a.text} ${a.ring}`}>
                                  {a.label}
                                </span>
                                {/* Never invented: no name recorded shows nothing at all. */}
                                {s.evidence.actorName ? (
                                  <span className="text-xs text-slate-500">{s.evidence.actorName}</span>
                                ) : null}
                                {/* WHICH document — the only thing anyone wants from an upload row. */}
                                {docName(s.evidence.changed.find((c) => c.field === 'document_key')?.to) ? (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                                    {docName(s.evidence.changed.find((c) => c.field === 'document_key')?.to)}
                                  </span>
                                ) : null}
                                {s.waitHours != null && s.waitHours >= 0.1 ? (
                                  <span className="ml-auto text-[11px] tabular-nums text-slate-400">
                                    +{dur(s.waitHours)} wait
                                  </span>
                                ) : null}
                              </div>

                              {rest.length ? (
                                <div className="mt-1.5 space-y-0.5 border-t border-slate-50 pt-1.5">
                                  {rest.map((c) => {
                                    const plan = planLines(c.to);
                                    if (plan) {
                                      const prev = planLines(c.from);
                                      const total = plan.reduce((n, i) => n + Number(i.amountFils ?? 0), 0);
                                      return (
                                        <div key={c.field} className="text-[11px]">
                                          <div className="mb-1 font-medium text-slate-500">
                                            {prev ? 'Revised plan' : 'Plan offered'}
                                            <span className="ml-1.5 font-normal text-slate-400">
                                              {plan.length} line{plan.length === 1 ? '' : 's'} · {aed(total)} total
                                            </span>
                                          </div>
                                          <div className="space-y-0.5">
                                            {plan.map((i, n) => (
                                              <div key={n} className="flex items-baseline gap-2">
                                                <span className="min-w-[150px] text-slate-600">{i.description ?? i.type ?? 'Line'}</span>
                                                <span className="tabular-nums font-medium text-slate-800">{aed(i.amountFils)}</span>
                                                {shortDate(i.dueDate) ? <span className="text-slate-400">due {shortDate(i.dueDate)}</span> : null}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    }

                                    const rows = chequeRows(c.to) ?? chequeRows(c.from);
                                    if (rows) {
                                      const before = chequeRows(c.from)?.length ?? 0;
                                      const after = chequeRows(c.to)?.length ?? 0;
                                      const verb = after > before ? 'Cheque added' : after < before ? 'Cheque removed' : 'Cheques updated';
                                      return (
                                        <div key={c.field} className="text-[11px]">
                                          <div className="mb-1 font-medium text-slate-500">{verb}</div>
                                          <div className="space-y-0.5">
                                            {rows.map((r, n) => (
                                              <div key={n} className="flex items-baseline gap-2">
                                                <span className="min-w-[150px] font-mono text-slate-700">{r.cheque_serial ?? '—'}</span>
                                                <span className="tabular-nums font-medium text-slate-800">{aed(r.amount_fils)}</span>
                                                <span className="text-slate-500">{r.bank_name ?? '—'}</span>
                                                {shortDate(r.due_date) ? <span className="text-slate-400">due {shortDate(r.due_date)}</span> : null}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={c.field} className="flex items-baseline gap-1.5 text-[11px]">
                                        <span className="font-medium text-slate-500">{c.field}</span>
                                        <span className="text-slate-400">{val(c.from)}</span>
                                        <span className="text-slate-300">→</span>
                                        <span className="font-medium text-slate-700">{val(c.to)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}

                              {s.evidence.actionKey ? (
                                <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-300">
                                  from {s.evidence.actionKey}
                                  {s.evidence.auditId ? ` · audit #${s.evidence.auditId}` : ''}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="mt-8 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-400">
        Every step is recorded from an audit row and shows the record it came from. Actions the design has
        no lane for stay in the audit log and are never guessed onto the board — so a lane shown as
        <span className="italic"> not reached</span> really has not been reached.
      </p>
    </div>
  );
}
