/**
 * Sub-lease pass-through charges — client mirror of the backend's
 * `shared/sublease-charges.ts` (keep the two in step).
 *
 * A sub-leased building bills the head lessor's percentage of the lease plus VAT
 * charged ON that percentage — a COMPOUND levy (5% of the 20% line, not 5% of
 * rent). Both are stored as free-text charge rows, so only their LABELS record
 * that they are derived: "20% on sub lease", "Sub-lease charge (20%)",
 * "5% VAT on sub-lease". The unit editor already auto-calculates exactly these
 * two off the unit's Market Price ([[UnitFormModal]]); this is the same rule for
 * a contract, where the base is the contracted NET annual rent instead.
 *
 * Matching is loose because RPs hand-type these labels and live data holds
 * several spellings. A line without a percentage is an ordinary fixed charge and
 * is never rewritten.
 */

export type SubleaseChargeKind = 'net' | 'vat';

export interface SubleaseCharge {
  kind: SubleaseChargeKind;
  /** Percentage declared by the label — 20 for "20% on sub lease". */
  pct: number;
}

const SUBLEASE_RE = /sub[-\s]?leas(?:e|ing)/i;
const VAT_RE = /\bvat\b/i;
const PCT_RE = /(\d+(?:\.\d+)?)\s*%/;

/** Read a label as a derived sub-lease line, or null when it isn't one. */
export function classifySubleaseCharge(label: string | null | undefined): SubleaseCharge | null {
  const desc = String(label ?? '');
  if (!SUBLEASE_RE.test(desc)) return null;
  const m = PCT_RE.exec(desc);
  if (!m) return null;
  const pct = Number(m[1]);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  return { kind: VAT_RE.test(desc) ? 'vat' : 'net', pct };
}

/**
 * Return `charges` with every derived sub-lease line re-derived from
 * `netAnnualRent` (whole AED, as the unit editor rounds). The VAT line compounds
 * off the recomputed net line, never off rent; a VAT line with no net line to
 * compound from is left untouched. Returns the SAME array reference when nothing
 * moved, so callers can skip a re-render.
 */
export function recomputeSubleaseCharges<T extends { description: string; amount: string }>(
  charges: T[],
  netAnnualRent: number,
): T[] {
  const rent = Number(netAnnualRent) || 0;
  if (rent <= 0) return charges;

  const kinds = charges.map(c => classifySubleaseCharge(c.description));
  if (!kinds.some(Boolean)) return charges;

  const next = charges.map((c, i) => {
    const k = kinds[i];
    return k?.kind === 'net' ? { ...c, amount: String(Math.round(rent * (k.pct / 100))) } : c;
  });
  const netBase = next.reduce(
    (s, c, i) => kinds[i]?.kind === 'net' ? s + (parseFloat(c.amount) || 0) : s,
    0,
  );
  if (netBase > 0) {
    for (let i = 0; i < next.length; i++) {
      const k = kinds[i];
      if (k?.kind === 'vat') next[i] = { ...next[i], amount: String(Math.round(netBase * (k.pct / 100))) };
    }
  }
  return next.some((c, i) => c.amount !== charges[i].amount) ? next : charges;
}
