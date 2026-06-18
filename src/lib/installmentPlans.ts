// Canonical list of rent-payment installment plans (cheque counts per year).
//
// Historically these were hardcoded — and inconsistently — across every contract
// form, the lead payment-plan editor, the customer booking flow and the public
// listing. This is the single source of truth for the values + labels, plus the
// helpers that apply a rental provider's per-RP restriction (Settings → Rules →
// "Payment installment plans"). An empty / missing allowed-list means no
// restriction: every plan is offered.
//
// NOTE: a 3-cheque plan is NOT offered (it isn't really "quarterly" — that's 4 —
// and offering both confused users). It's intentionally absent from the OFFERED
// list, but legacy contracts that already use 3 still display correctly: any
// `keepValues` count that isn't a standard plan is synthesised on the fly (see
// allowedInstallmentPlans) and `installmentLabel` falls back to "N cheques".

export interface InstallmentPlan {
  value: number;
  /** Frequency name, e.g. "Quarterly". */
  label: string;
  /** "1 — Annual" style label used by the longer dropdowns. */
  longLabel: string;
}

export const INSTALLMENT_PLANS: InstallmentPlan[] = [
  { value: 1,  label: 'Annual',       longLabel: '1 — Annual' },
  { value: 2,  label: 'Semi-annual',  longLabel: '2 — Semi-annual' },
  { value: 4,  label: 'Quarterly',    longLabel: '4 — Quarterly' },
  { value: 6,  label: 'Bi-monthly',   longLabel: '6 — Bi-monthly' },
  { value: 12, label: 'Monthly',      longLabel: '12 — Monthly' },
];

/** Every offered cheque-count, in order. */
export const INSTALLMENT_VALUES: number[] = INSTALLMENT_PLANS.map((p) => p.value);

const LABELS: Record<number, string> = Object.fromEntries(
  INSTALLMENT_PLANS.map((p) => [p.value, p.label]),
);

/** Human label for a cheque count ("Quarterly"), with a sensible fallback. */
export function installmentLabel(value: number): string {
  return LABELS[value] ?? `${value} cheques`;
}

/** A display entry for a non-standard count (e.g. a legacy 3-cheque contract). */
function syntheticPlan(value: number): InstallmentPlan {
  const label = installmentLabel(value);
  return { value, label, longLabel: label };
}

/** True when `value` is offered given the RP's allowed-list (empty = all allowed). */
export function isInstallmentAllowed(value: number, allowed?: number[] | null): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(value);
}

/**
 * The plans to show in a picker, given the RP's allowed-list. `keepValues` are
 * ALWAYS retained — pass a contract's current cheque count so editing an existing
 * contract never hides (or silently changes) its own selected plan, even if that
 * count is restricted out or is a non-standard legacy value (e.g. 3).
 */
export function allowedInstallmentPlans(
  allowed?: number[] | null,
  keepValues: number[] = [],
): InstallmentPlan[] {
  const keep = keepValues.filter((v) => Number.isFinite(v) && v > 0);
  const base = (!allowed || allowed.length === 0)
    ? INSTALLMENT_PLANS
    : INSTALLMENT_PLANS.filter((p) => allowed.includes(p.value) || keep.includes(p.value));
  // Re-introduce any kept count that isn't a standard offered plan (legacy 3, etc.)
  // so the picker can still render the contract's current selection.
  const present = new Set(base.map((p) => p.value));
  const extra = keep.filter((v) => !present.has(v)).map(syntheticPlan);
  return [...base, ...extra].sort((a, b) => a.value - b.value);
}

/** Same as {@link allowedInstallmentPlans} but returns just the values. */
export function allowedInstallmentValues(
  allowed?: number[] | null,
  keepValues: number[] = [],
): number[] {
  return allowedInstallmentPlans(allowed, keepValues).map((p) => p.value);
}
