/**
 * Display label for a tenant / customer.
 *
 * When the tenant is a COMPANY the lease party is the entity itself, so we show
 * the company name rather than the (signatory) person's name. Individuals fall
 * back to their personal name. Used everywhere a tenant is labelled — the
 * Operations board, the Leases (orders) list, and the contract detail page — so
 * the rule stays in one place.
 */
export interface TenantNameParts {
  name?: string | null;
  entityType?: string | null;
  companyName?: string | null;
}

export function tenantDisplayName(t: TenantNameParts | null | undefined): string | null {
  if (!t) return null;
  if (t.entityType === 'company' && t.companyName?.trim()) return t.companyName.trim();
  return t.name ?? null;
}
