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
 *
 * ── A cancelled cheque says WHY (migration 0245) ────────────────────────────
 *
 * "Cancelled" was doing three jobs at once, and a manager could not tell them
 * apart on the row:
 *
 *   Replaced                    the customer SWAPPED it — the rent was collected
 *                               on another row, which is linked to this one
 *   Cancelled · Returned        the paper went back and nothing replaced it
 *   Cancelled · Lease cancelled the tenancy was cancelled, voiding the schedule
 *   Cancelled                   cancelled before 0245; nobody recorded a reason
 *
 * A swapped cheque reads "Replaced" and never "Cleared": the bank never saw it,
 * however completely the money that replaced it has since cleared. It keeps the
 * muted cancelled palette rather than the bounce's red, because nothing went
 * wrong — the customer paid, just by another route.
 *
 * None of this moves a figure. Cancelled cheques are excluded from every total
 * either way; this only says what became of one.
 */

export type ChequeTone = 'cleared' | 'pending' | 'bounced' | 'cancelled';

export interface ChequeStatusRow {
  chequeStatus?: string | null;
  /** Server-derived: 'cleared' | 'replaced' on a bounce covered in full, and
   *  'replaced' on a cancelled cheque the customer swapped. */
  effectiveStatus?: string | null;
  /** Why a cancelled cheque was cancelled (`payments.cancellation_reason`):
   *  'replaced' | 'returned_to_customer' | 'lease_cancelled'. */
  cancellationReason?: string | null;
}

export interface ChequeStatusDisplay {
  /** What to print on the chip. */
  label: string;
  /** Which palette to use — maps to `.cstat.<tone>` on the RP contract page. */
  tone: ChequeTone;
  /** True when the row's status is decided by a replacement link — a bounce that
   *  has been made good, or a cheque the customer swapped. The status control is
   *  withheld on those rows: flipping one without first voiding its replacement
   *  would count the rent twice. */
  statusLocked: boolean;
}

const TITLE: Record<string, string> = {
  cleared: 'Cleared',
  pending: 'Pending',
  bounced: 'Bounced',
  cancelled: 'Cancelled',
};

/** How each cancellation reads. A reason we do not recognise falls through to
 *  the plain word rather than being printed raw at the customer. */
const CANCELLED_LABEL: Record<string, string> = {
  replaced: 'Replaced',
  returned_to_customer: 'Cancelled · Returned',
  lease_cancelled: 'Cancelled · Lease cancelled',
};

export function chequeStatusDisplay(p: ChequeStatusRow): ChequeStatusDisplay {
  const stored = String(p.chequeStatus ?? 'pending').toLowerCase();
  const effective = p.effectiveStatus == null ? null : String(p.effectiveStatus).toLowerCase();
  const reason = p.cancellationReason == null ? null : String(p.cancellationReason).toLowerCase();

  if (stored === 'cancelled') {
    // A swapped cheque is locked the moment money points at it, for the same
    // reason a settled bounce is: un-cancelling it while its replacement stands
    // would leave the same rent counted on two rows.
    const swapped = reason === 'replaced';
    return {
      label: (reason && CANCELLED_LABEL[reason]) ?? TITLE.cancelled,
      tone: 'cancelled',
      statusLocked: swapped && effective === 'replaced',
    };
  }

  // `effectiveStatus` otherwise only diverges on a bounce covered in full, and
  // it says whether the replacement is banked ('cleared') or still pending
  // ('replaced'). Either way the row stays red and stays named as a bounce.
  if (effective && effective !== stored) {
    return {
      label: effective === 'cleared' ? 'Bounced · Replaced' : 'Bounced · Replacement pending',
      tone: 'bounced',
      statusLocked: true,
    };
  }

  const tone: ChequeTone =
    stored === 'cleared' || stored === 'bounced' ? stored : 'pending';
  return { label: TITLE[tone] ?? TITLE.pending, tone, statusLocked: false };
}
