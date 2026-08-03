/**
 * How a cheque row READS — one rule, because three surfaces show it (the RP
 * contract page, the RP order page and the customer's own contract page) and a
 * bounce that reads differently on each is worse than one that reads badly on
 * all three.
 *
 * ── A settled bounce still reads as a bounce ────────────────────────────────
 *
 * When a bounced cheque is made good, the money is genuinely in. The obvious
 * move is to show the row as Cleared and be done with it — which is what these
 * surfaces used to do, off `effectiveStatus`.
 *
 * That is wrong for the people reading it. A bounce is an event that HAPPENED:
 * it carries a penalty, it feeds the customer's payment history, and an RP
 * scanning the schedule needs to see that this cheque failed even though the
 * rent was recovered. A green "Cleared" chip erases it, and the row then looks
 * identical to a cheque that was paid correctly first time. The stored status
 * has always stayed `bounced` underneath; only the display disagreed.
 *
 * So a settled bounce keeps the bounce tone (red) and says what happened to it:
 *
 *   Bounced · Replaced              the replacement money is banked
 *   Bounced · Replacement pending   a replacement is recorded but not yet cleared
 *   Bounced                         nothing recorded against it — still owed
 *
 * The row is not "open work" in either of the first two cases — the dashboards
 * and the outstanding totals drop it via cheque-replacement's coverage rule, and
 * that is the right place for that decision. This is only about what a human
 * sees. Never infer "still owed" from the tone here; ask the coverage rule.
 *
 * Part-payment is deliberately NOT a state here. A part-covered bounce is still
 * a plain `bounced` row with money outstanding, and the payment table spells the
 * shortfall out next to the description ("Part-replaced — X of Y · Z still
 * owed"), which is more use than a chip could be.
 */

export type ChequeTone = 'cleared' | 'pending' | 'bounced' | 'cancelled';

export interface ChequeStatusRow {
  chequeStatus?: string | null;
  /** Server-derived: 'cleared' | 'replaced' on a bounce covered in full. */
  effectiveStatus?: string | null;
}

export interface ChequeStatusDisplay {
  /** What to print on the chip. */
  label: string;
  /** Which palette to use — maps to `.cstat.<tone>` on the RP contract page. */
  tone: ChequeTone;
  /** True when this is a bounce that has been made good; the status control is
   *  withheld on those rows, since flipping one without first voiding its
   *  replacement would count the rent twice. */
  settledBounce: boolean;
}

const TITLE: Record<string, string> = {
  cleared: 'Cleared',
  pending: 'Pending',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
};

export function chequeStatusDisplay(p: ChequeStatusRow): ChequeStatusDisplay {
  const stored = String(p.chequeStatus ?? 'pending').toLowerCase();
  const effective = p.effectiveStatus == null ? null : String(p.effectiveStatus).toLowerCase();

  // `effectiveStatus` only ever diverges on a bounce covered in full, and it
  // says whether the replacement is banked ('cleared') or still pending
  // ('replaced'). Either way the row stays red and stays named as a bounce.
  if (effective && effective !== stored) {
    return {
      label: effective === 'cleared' ? 'Bounced · Replaced' : 'Bounced · Replacement pending',
      tone: 'bounced',
      settledBounce: true,
    };
  }

  const tone: ChequeTone =
    stored === 'cleared' || stored === 'bounced' || stored === 'cancelled' ? stored : 'pending';
  return { label: TITLE[tone] ?? TITLE.pending, tone, settledBounce: false };
}
