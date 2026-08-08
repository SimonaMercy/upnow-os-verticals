/**
 * Fee-rule helpers — the single client-side source for turning an RP's configured
 * Fee Rules (Settings → Fee Rules, GET /fee-rules) into a concrete suggested
 * amount at a given rent. Shared by the /units plan-pricing editor (FinancialsModal)
 * and the per-unit Add/Edit form (UnitFormModal) so the two can never compute the
 * same fee differently. Dependency-free to avoid any import cycle.
 *
 * Mirrors the backend `feeRuleAmount` (fee-rules.service.ts): a fixed rule returns
 * its flat AED value, a percentage rule scales off the (annual) rent. Rules are
 * resolved by the unit's EFFECTIVE space category (see effectiveSpaceCategory in
 * lib/unitTaxonomy) so a mixed-use building prices each unit per its type.
 */
export interface FeeRuleLite {
  feeType: string;
  valueType: string;
  value: number;
  isActive: boolean;
  /** Whether this fee is VAT-rated, and at what rate. Optional so older callers
   *  that only price the net keep compiling; feeVatFromRules needs them. */
  vatApplicable?: boolean;
  vatRate?: number;
}

/** Unit-form fee field key → fee-rule `fee_type`. */
export const FEE_RULE_TYPE: Record<string, string> = {
  securityDeposit: 'security_deposit',
  adminFee: 'admin_fee',
  ejariFee: 'ejari_fee',
  commission: 'commission',
};

/** Rule-derived amount (AED) for a fee key at a given rent, or null when there is
 *  no active rule for it (caller decides the fallback). */
export const feeFromRules = (
  rules: FeeRuleLite[] | undefined,
  key: string,
  rent: number,
): number | null => {
  const r = rules?.find((x) => x.feeType === FEE_RULE_TYPE[key]);
  if (!r || !r.isActive) return null;
  return r.valueType === 'fixed_aed' ? Math.round(r.value) : Math.round((rent * r.value) / 100);
};

/**
 * Same computation as feeFromRules, but a rule that EXISTS and is switched OFF
 * resolves to an explicit **0** instead of null — the RP configured "don't charge
 * this" and that has to win over any historic figure. Only a fee type with no rule
 * at all returns null for the caller to fall back on.
 *
 * Use this where the RP's saved rules must OVERRIDE what a record already holds
 * (Propose Renewal prefilling its fee fields from the renewal fee rules); use
 * feeFromRules where an off rule just means "no suggestion".
 */
export const configuredFeeFromRules = (
  rules: FeeRuleLite[] | undefined,
  key: string,
  rent: number,
): number | null => {
  const r = rules?.find((x) => x.feeType === FEE_RULE_TYPE[key]);
  if (!r) return null;
  if (!r.isActive) return 0;
  return r.valueType === 'fixed_aed' ? Math.round(r.value) : Math.round((rent * r.value) / 100);
};

/**
 * The VAT (AED) on a fee the RP is charging at `net`, from its rule.
 *
 * MIRROR of the backend `ruleFeeVat` (contracts.service.ts) — including its
 * rounding order, so a preview can never disagree with the cheque that gets
 * raised: the rule's own VAT is rounded to whole AED first, then scaled by how
 * far the RP's entered net sits from the rule's amount. An inactive or
 * non-VAT-rated fee is 0; so is a fee the RP zeroed.
 *
 * Ejari is exempt in the UAE defaults, so this returns 0 for it unless the RP
 * has explicitly made it VAT-rated.
 */
export const feeVatFromRules = (
  rules: FeeRuleLite[] | undefined,
  key: string,
  net: number,
  rent: number,
): number => {
  const r = rules?.find((x) => x.feeType === FEE_RULE_TYPE[key]);
  if (!r || !r.isActive || !r.vatApplicable || !(net > 0)) return 0;
  const base = r.valueType === 'fixed_aed' ? Math.round(r.value) : Math.round((rent * r.value) / 100);
  const ruleVat = Math.round((base * (r.vatRate ?? 0)) / 100);
  if (base <= 0 || ruleVat <= 0) return 0;
  return Math.round(net * (ruleVat / base) * 100) / 100;
};
