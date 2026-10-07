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

/** What the reader found on a cheque file (backend ocr_readings, kind 'cheque').
 *  Offered beside the file — nothing is recorded until a person records it. */
export interface ChequeReading {
  chequeNumber: string | null;
  bankName: string | null;
  amountFils: number | null;
  /** The date written on the cheque, YYYY-MM-DD. */
  date: string | null;
  payeeName: string | null;
  accountNumber: string | null;
}

/** A paper's reading as the API sends it with the document. */
export interface DocReading {
  kind: string;
  status: 'pending' | 'done' | 'failed';
  fields: Record<string, unknown> | null;
}

/** The cheque fields of a reading, or null when the file was not read as a cheque. */
export function chequeReadingOf(reading?: DocReading | null): ChequeReading | null {
  if (!reading || reading.kind !== 'cheque' || reading.status !== 'done' || !reading.fields) return null;
  return reading.fields as unknown as ChequeReading;
}

/** Serials compare by their digits — "000173" on the row is "173" on the cheque. */
export function sameChequeNumber(a?: string | null, b?: string | null): boolean {
  const norm = (v?: string | null) => (v ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return norm(a) !== '' && norm(a) === norm(b);
}

/** One cheque found in a file, and where the matcher put it (backend
 *  contracts.service readAndPlaceCheques). */
export interface IntakeCheque {
  index: number;
  page: number | null;
  position: string | null;
  chequeNumber: string | null;
  bankName: string | null;
  amount: number | null;
  date: string | null;
  payeeName: string | null;
  accountHolder: string | null;
  outcome: 'matched' | 'unreadable' | 'no_match' | 'duplicate' | 'expired';
  /** Placed by its order in the cheque book because it carries no date. */
  byOrder: boolean;
  reason: string | null;
  paymentIds: number[];
  /** The payments it pays, in plan words ("Instalment 1", "Admin Fee"). */
  paysFor: string[];
}

export interface IntakeFile {
  documentId: number;
  name: string;
  status: 'done' | 'failed' | 'pending' | 'not_read';
  documentType: 'cheque' | 'transfer' | 'other' | null;
  cheques: IntakeCheque[];
}

/** What reading + placing a lease's cheque files came back with. */
export interface ChequeIntake {
  files: IntakeFile[];
  /** Files taken off the lease by this read (refused or unreadable), with the reason to show. */
  removed?: { name: string; reason: string }[];
  open: { id: number; description: string; amount: number; dueDate: string | null }[];
  /** Every file read and every cheque on its payment. */
  ready: boolean;
}
