/**
 * One naming scheme for every lease document a customer downloads, so the files
 * that land in their downloads folder identify themselves without being opened:
 *
 *   Receipt-Unit-317-CID-394.pdf
 *   Tenancy-Contract-Unit-317-CID-394.pdf
 *   Contract-Registration-Unit-317-CID-394.pdf
 *
 * `<kind>-Unit-<unit>-<ref>` — the unit says WHICH home, the contract ref says
 * WHICH lease of it (a renewal is a different CID for the same unit). Both parts
 * are dropped when unknown rather than emitting an empty segment.
 *
 * The backend mirrors this for stored files it serves as an attachment (the
 * Contract Registration certificate) — a cross-origin signed URL ignores the
 * anchor's `download` attribute, so its name has to come from the
 * Content-Disposition header. Keep the two in step.
 */
export type LeaseDocKind = 'Receipt' | 'Tenancy-Contract' | 'Contract-Registration' | 'Payment-Plan';

/** Trim to what is safe in a filename on every OS, and collapse to single dashes. */
const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function leaseDocFileName(
  kind: LeaseDocKind,
  { unitNumber, ref }: { unitNumber?: string | number | null; ref?: string | null },
  ext = 'pdf',
): string {
  const unit = unitNumber == null ? '' : slug(String(unitNumber));
  const parts = [kind, unit ? `Unit-${unit}` : '', slug(ref ?? '')].filter(Boolean);
  return `${parts.join('-')}.${ext}`;
}
