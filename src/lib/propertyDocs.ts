/**
 * Property-level document slots (beyond the Title Deed + Building Floor Plans
 * that already had bespoke handling). One place so the form UI, the existing-doc
 * filter, and the three save flows (Edit modal, Add wizard, Manager) stay aligned.
 */
import { uploadOwnedDocument } from './uploadOwnedDocument';

export interface PropertyDocSlot {
  key: string;        // document_key (multiple slots store as `${key}_${ts}_${i}`)
  label: string;
  category: string;   // DocumentCategory value
  multiple: boolean;
}

// Document key for the head-lease (master-lease) agreement — the contract that
// gives a sub-leasing RP the right to sub-let the building. Rendered ONLY when a
// property's leasing model is 'sub' (handled in PropertyFields), but kept in the
// slot list so the existing save flows upload + detect it automatically.
export const HEAD_LEASE_KEY = 'head_lease';

// Document key for the signed Property Management Agreement — the mandate that
// authorises a managing RP to manage the building on the owner's behalf. Rendered
// ONLY when a property's leasing model is 'management' (handled in PropertyFields),
// kept in the slot list so the save flows upload + detect it automatically.
export const MGMT_AGREEMENT_KEY = 'management_agreement';

// The two proof-of-right slots above are leasing-model-specific and rendered next
// to the leasing picker — NOT in the general single-file document grid.
export const LEASE_PROOF_KEYS = [HEAD_LEASE_KEY, MGMT_AGREEMENT_KEY];

export const PROPERTY_DOC_SLOTS: PropertyDocSlot[] = [
  { key: HEAD_LEASE_KEY,           label: 'Head-lease / Master-lease Agreement',  category: 'legal',      multiple: false },
  { key: MGMT_AGREEMENT_KEY,       label: 'Signed Property Management Agreement',  category: 'legal',      multiple: false },
  { key: 'affection_plan',         label: 'Affection Plan',         category: 'property',   multiple: false },
  { key: 'completion_certificate', label: 'Completion Certificate', category: 'compliance', multiple: false },
  { key: 'site_plan',              label: 'Site Plan',              category: 'property',   multiple: false },
  { key: 'utility_account',        label: 'Utility Account Details', category: 'property',  multiple: false },
  { key: 'architectural_drawings', label: 'Architectural Drawings', category: 'property',   multiple: true },
  { key: 'noc_documents',          label: 'NOC Documents',          category: 'legal',      multiple: true },
  { key: 'other_document',         label: 'Other Documents',        category: 'property',   multiple: true },
];

/** Does a stored document belong to this slot? (exact key, or prefixed for multiples) */
export const docBelongsToSlot = (documentKey: string, slot: PropertyDocSlot) =>
  documentKey === slot.key || documentKey.startsWith(`${slot.key}_`);

/** Whether a stored document is one of the new extra-slot docs. */
export const isExtraSlotDoc = (documentKey: string) =>
  PROPERTY_DOC_SLOTS.some(s => docBelongsToSlot(documentKey, s));

/**
 * Upload all queued extra-slot files for a property. Returns a list of
 * human-readable errors (empty = all good) so callers can surface them without
 * failing the whole save.
 */
export async function uploadExtraPropertyDocs(
  propertyId: number,
  extraDocs: Record<string, File[]> | undefined,
): Promise<string[]> {
  const errs: string[] = [];
  if (!extraDocs) return errs;
  for (const slot of PROPERTY_DOC_SLOTS) {
    const files = extraDocs[slot.key] ?? [];
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadOwnedDocument({
          ownerType: 'property',
          ownerId: propertyId,
          documentKey: slot.multiple ? `${slot.key}_${Date.now()}_${i}` : slot.key,
          category: slot.category,
          displayName: files[i].name || slot.label,
          file: files[i],
        });
      } catch (e) {
        errs.push(`${slot.label}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
  }
  return errs;
}
