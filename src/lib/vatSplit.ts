/**
 * VAT on money the landlord PAYS OUT — the mirror of the API's
 * `shared/vat-split.ts`, for live previews only (the API derives what is stored).
 *
 * The user types the amount on the paper and says how it treats VAT — the
 * Restoration List's three words: none · exclusive (+5% on top) · inclusive (5% inside).
 */
export type VatMode = 'none' | 'exclusive' | 'inclusive';
export const VAT_RATE = 5;
export const VAT_CHOICES: { mode: VatMode; label: string }[] = [
  { mode: 'none', label: 'No VAT' },
  { mode: 'exclusive', label: '+5% VAT on top' },
  { mode: 'inclusive', label: '5% VAT included' },
];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitVat(typedAmount: number, mode: VatMode, vatOverride?: number | null): { net: number; vat: number; total: number } {
  const typed = r2(Number(typedAmount) || 0);
  if (mode === 'none') return { net: typed, vat: 0, total: typed };
  const vat = vatOverride != null && !Number.isNaN(Number(vatOverride))
    ? r2(Number(vatOverride))
    : mode === 'exclusive' ? r2((typed * VAT_RATE) / 100) : r2((typed * VAT_RATE) / (100 + VAT_RATE));
  const total = mode === 'exclusive' ? r2(typed + vat) : typed;
  return { net: r2(total - vat), vat, total };
}

/** What to show in the amount box when EDITING a stored row: the figure the user would have typed. */
export function typedFromStored(total: number | null | undefined, vat: number | null | undefined, mode: VatMode): string {
  if (total == null) return '';
  return String(mode === 'exclusive' ? r2(Number(total) - Number(vat ?? 0)) : Number(total));
}

export const aed2 = (n: number) => `AED ${Number(n).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A stored row (gross total + its VAT) as the three things the VAT field edits:
 * what to put in the amount box, the choice, and an exact-VAT override when the
 * stored figure is not the plain 5% (a supplier's rounding, a hand-typed VAT).
 * Stored rows are shown as "+5% on top" — the net is what was agreed.
 */
export function vatFormFromStored(total: number | null | undefined, vat: number | null | undefined): { amount: string; vatMode: VatMode; vatOverride: string } {
  if (total == null) return { amount: '', vatMode: 'none', vatOverride: '' };
  const v = r2(Number(vat) || 0);
  if (v <= 0) return { amount: String(r2(Number(total))), vatMode: 'none', vatOverride: '' };
  const net = r2(Number(total) - v);
  const plain = r2((net * VAT_RATE) / 100);
  return { amount: String(net), vatMode: 'exclusive', vatOverride: Math.abs(plain - v) < 0.005 ? '' : String(v) };
}
