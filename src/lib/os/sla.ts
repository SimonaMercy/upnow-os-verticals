/**
 * First-response SLA for rental leads — ONE rule shared by Overview › Today and
 * Demand › Leads, so the countdown a provider sees on the dashboard is the same
 * number the Leads queue shows (research report: "every metric shown in
 * Overview … should be the same number the admin uses").
 *
 * The threshold: a new rental lead should get a first reply within 15 minutes —
 * the MarketSpace provider target (pages/provider-dashboard/pw/demand.js,
 * `SLA = 15`). It was 2 hours (Property Finder's SuperAgent window) until the
 * MarketSpace alignment; long-term enquiries that arrive by call or WhatsApp
 * are won by whoever replies first, so the clock is now the marketplace's.
 *
 * WHAT "AWAITING A FIRST RESPONSE" MEANS ON TODAY'S DATA
 * The leads API (GET /leads, /manager/leads?rp=) carries no first-response
 * timestamp, no message thread and no "contacted at". So the rule is inferred
 * from fields that DO exist, conservatively:
 *   - the lead is open (not converted / rejected), and either
 *   - stage === 'new' — nobody has moved it since it arrived; or
 *   - it came from the marketplace (source === 'portal', which the marketplace
 *     stamps itself) AND nobody has touched it since: the lead row and every
 *     viewing on it are unchanged since creation (updatedAt within a minute of
 *     createdAt) and no viewing has moved past scheduled/confirmed.
 * A lead the provider keyed in themselves (walk-in, phone, agent…) is not on
 * the clock: entering it is the contact.
 *
 * Limits (stated so nobody reads more into the number than it holds):
 *   - the clock starts at lead.createdAt and runs 24/7 (no business hours);
 *   - a reply sent outside UpNow (phone, WhatsApp) does not stop the clock until
 *     the lead is touched in UpNow;
 *   - "% answered within 15 min over 30 days" cannot be computed — once a lead is
 *     answered there is no record of WHEN, so only the open clocks are known.
 */

/** The first-response window for a new rental lead (MarketSpace: 15 min). */
export const FIRST_RESPONSE_SLA_MS = 15 * 60 * 1000;
/** Human label for the window — use this in copy instead of hard-coding it. */
export const FIRST_RESPONSE_SLA_LABEL = '15 min';
/** Under this much time left, a running clock is shown as "nearing". */
export const SLA_NEARING_MS = 5 * 60 * 1000;
/** Writes inside this gap of creation count as part of creating the record. */
const UNTOUCHED_SLACK_MS = 60 * 1000;

/** The lead fields the rule reads — a structural subset of the leads API row. */
export interface SlaLead {
  stage: string;
  source: string | null;
  createdAt: string;
  updatedAt: string;
  viewings?: Array<{ status: string; createdAt?: string; updatedAt?: string }> | null;
}

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN);
const untouched = (created?: string, updated?: string) => {
  const c = ms(created), u = ms(updated);
  // A missing timestamp cannot prove a touch — treat it as untouched.
  return !Number.isFinite(c) || !Number.isFinite(u) || u - c < UNTOUCHED_SLACK_MS;
};

/** True while the lead is still waiting for the provider's first reply. */
export function awaitingFirstResponse(lead: SlaLead): boolean {
  if (lead.stage === 'converted' || lead.stage === 'rejected') return false;
  if (lead.stage === 'new') return true;
  if (lead.source !== 'portal') return false;
  if (!untouched(lead.createdAt, lead.updatedAt)) return false;
  return (lead.viewings ?? []).every(v =>
    (v.status === 'scheduled' || v.status === 'confirmed') && untouched(v.createdAt, v.updatedAt));
}

export interface SlaState {
  /** When the first reply is due (epoch ms). */
  dueAt: number;
  /** Signed: negative once overdue. */
  remainingMs: number;
  overdue: boolean;
  nearing: boolean;
  /** "Reply within 1h 20m" / "Overdue 3h". */
  label: string;
  tone: 'danger' | 'amber' | 'info';
}

/** "1h 20m", "45m", "3h", "2d 4h". Never negative. */
export function fmtSlaDuration(msLeft: number): string {
  const m = Math.max(0, Math.floor(Math.abs(msLeft) / 60_000));
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** The lead's first-response clock, or null when it is not on one. */
export function firstResponseSla(lead: SlaLead, now: number): SlaState | null {
  if (!awaitingFirstResponse(lead)) return null;
  const created = ms(lead.createdAt);
  if (!Number.isFinite(created)) return null;
  const dueAt = created + FIRST_RESPONSE_SLA_MS;
  const remainingMs = dueAt - now;
  const overdue = remainingMs <= 0;
  const nearing = !overdue && remainingMs <= SLA_NEARING_MS;
  return {
    dueAt,
    remainingMs,
    overdue,
    nearing,
    label: overdue ? `Overdue ${fmtSlaDuration(remainingMs)}` : `Reply within ${fmtSlaDuration(remainingMs)}`,
    tone: overdue ? 'danger' : nearing ? 'amber' : 'info',
  };
}

/** Sort key: most overdue first, then least time left. Leads off the clock → Infinity. */
export function slaRank(lead: SlaLead, now: number): number {
  const s = firstResponseSla(lead, now);
  return s ? s.remainingMs : Number.POSITIVE_INFINITY;
}
