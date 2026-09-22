/**
 * One rule for "which payment does this cheque file belong to", shared by the
 * customer's renewal Payments step and the landlord's Collect-the-cheques step.
 *
 * A cheque photo / transfer receipt is stored on the renewal lease as a
 * Payment-Advice document (`payment_advice_<unique>` — the binder strips the
 * numeric suffix so every file snaps into the single Payment Confirmation slot).
 * The payment it covers is carried in the DISPLAY NAME as `<slot> · <file>`,
 * where `<slot>` is the SegregatedPlanView attach-slot label: `Rent — Instalment N`
 * for a rent line, or the group title (`Management Fee`, `Third Party`) for the
 * groups that attach once at their heading.
 *
 * Both sides read and write this same tag, so a file the customer attached to
 * Instalment 1 is Instalment 1's file for the landlord too — no second mapping.
 * A file with no separator was sent "all together" (untagged) and either side
 * can tag it afterwards.
 */
export const SLOT_SEP = ' · ';

/** The slot a stored file was tagged with, or null for an untagged file. */
export function slotOfDoc(displayName?: string | null): string | null {
  const i = (displayName ?? '').indexOf(SLOT_SEP);
  return i > 0 ? displayName!.slice(0, i) : null;
}

/** The original file name, without the slot tag. */
export function fileNameOfDoc(displayName?: string | null): string {
  const i = (displayName ?? '').indexOf(SLOT_SEP);
  return i > 0 ? displayName!.slice(i + SLOT_SEP.length) : (displayName ?? '');
}

/** The display name to store for `fileName` attached against `slotLabel`. */
export function tagFileName(slotLabel: string, fileName: string): string {
  return `${slotLabel}${SLOT_SEP}${fileName}`;
}

/** Document-key bases that count as the renewal's cheque files (the binder's
 *  Payment Confirmation aliases + the legacy customer key). */
export const PAYMENT_ADVICE_BASES = ['payment_advice', 'pdc', 'post_dated_cheques', 'cheque_copies_pdc', 'cheque_copies', 'cheques', 'cheque', 'rent_cheques', 'renewal_payment_proof'] as const;

/** Whether a document key (with or without its `_<digits>` suffix) is a cheque file. */
export function isPaymentAdviceKey(documentKey?: string | null): boolean {
  const base = (documentKey ?? '').toLowerCase().replace(/_\d{10,}$/, '');
  return (PAYMENT_ADVICE_BASES as readonly string[]).includes(base);
}
