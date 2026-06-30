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
