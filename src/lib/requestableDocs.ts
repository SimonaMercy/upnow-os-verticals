/**
 * Requested-document naming, derived from THE document catalogue.
 *
 * This file used to carry its own hand-written list of requestable names and a
 * hand-written name → slot map. Both drifted from the upload picker, so the same
 * document could be offered under two wordings and land on two different rows.
 * Everything here is now a projection of `documentCatalogue.ts` — add a document
 * there and both pickers pick it up.
 *
 * The exported surface is unchanged; only the answers got better.
 *
 * MIRROR OF `upnow-backend/src/documents/requested-doc-keys.ts`.
 */
import {
  DOC_CATALOGUE,
  REQUESTABLE_ENTRIES,
  acceptedNamesFor,
  docKeyForName,
  normDocName,
} from './documentCatalogue';

/**
 * Standard documents an RP can request from a lead or customer. Same wording as
 * the upload picker uses for the same document, so a request and the row it
 * lands on read as one document. The RP can still type a one-off custom name
 * when something genuinely isn't listed.
 */
export const REQUESTABLE_DOCS: string[] = REQUESTABLE_ENTRIES.map(e => e.label);

/**
 * RP-requested additional documents are stored as a JSON array of free-text
 * names on `lead.additionalDocsNote`. Both the customer journey (upload slots)
 * and the RP leads page (status/approve) derive a STABLE, deterministic
 * document_key from each name so an uploaded file links back to the request.
 * e.g. "Bank Statement" → "additional_bank_statement".
 *
 * Only genuinely off-catalogue names reach this — anything the catalogue knows
 * resolves to its real slot key instead.
 */
export function additionalDocKey(name: string): string {
  return 'additional_' + normDocName(name);
}

/**
 * Every requestable NAME (lowercased) that is another wording of a document we
 * already collect → the canonical document_key. Derived from the catalogue, so
 * it covers every label, key and historical alias rather than the 13 entries
 * this map used to list by hand.
 */
export const REQUESTED_NAME_TO_DOC_KEY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const e of DOC_CATALOGUE) {
    for (const a of e.aliases ?? []) if (!(a in out)) out[a] = e.key;
  }
  for (const e of DOC_CATALOGUE) { out[e.key] = e.key; out[normDocName(e.label)] = e.key; }
  return out;
})();

/**
 * Resolve a requested doc name to a standard document_key we already collect, or
 * null when it's a genuinely new (additional) document. Used on BOTH sides so a
 * request for a doc we already have promotes the existing slot instead of
 * creating a duplicate, and the RP's fulfilment check tracks the same upload.
 */
export function resolveRequestedDocKey(name: string): string | null {
  return docKeyForName(name);
}

/** The document_key a requested name is tracked under, standard slot or not. */
export function requestedDocKey(name: string): string {
  return resolveRequestedDocKey(name) ?? additionalDocKey(name);
}

/**
 * EVERY key an answer to this request could have been filed under — the
 * catalogue slot first, then the `additional_*` fallback.
 *
 * Both are live. The RP's lead checklist sends the customer the catalogue key,
 * but the customer journey only renders a catalogue slot when that slot is
 * actually gateable on their page; anything else becomes an `additional_*` slot
 * so the request is never silently dropped. One request, therefore, can be
 * answered under either key depending on which surface the customer used.
 *
 * Read paths ("is this request fulfilled?", "show me the file") MUST accept both
 * — checking only one is how a document plainly on file reads as still missing
 * and the customer gets asked for it a second time.
 */
export function requestedDocKeyCandidates(name: string): string[] {
  const std = resolveRequestedDocKey(name);
  const addl = additionalDocKey(name);
  return std && std !== addl ? [std, addl] : [addl];
}

/**
 * Is this document already on the request list? Compared by KEY, not by wording
 * — "UAE Visa / Residence Visa" and "UAE Visa / Residency" are one document, and
 * listing both would show the RP the same request twice.
 */
export function alreadyRequested(items: string[], name: string): boolean {
  const k = requestedDocKey(name);
  return items.some(i => requestedDocKey(i) === k);
}

/** The request list with same-document entries collapsed to the first wording. */
export function dedupeRequests(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const k = requestedDocKey(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Parse the requested-additional-docs list stored on `additionalDocsNote`. */
export function parseAdditionalDocs(note: string | null | undefined): string[] {
  if (!note) return [];
  try {
    const parsed = JSON.parse(note);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Legacy keys the SAME document has historically been filed under, keyed by the
 * slot we use today. Imported customers carry `visa`, for example, while every
 * current surface asks for `uae_visa`.
 *
 * This matters wherever we ask "does this customer already have this document?".
 * Matching on the canonical key alone answers "no" for a document plainly on
 * file, which then either creates a second row for one document or tells the
 * customer to send something they already sent. Both were live bugs on the
 * renewal paperwork step and the external upload link.
 *
 * Deliberately NOT listed: the combined `emirates_id` scan as an alias of
 * `emirates_id_front` / `emirates_id_back`. One file covering both sides is not
 * a side — treating it as one lets a single upload satisfy both slots. The
 * catalogue keeps `emirates_id` as its own entry with no side aliases, so this
 * stays true by construction.
 */
export const LEGACY_DOC_KEY_ALIASES: Record<string, string[]> = Object.fromEntries(
  DOC_CATALOGUE
    .map(e => [e.key, acceptedNamesFor(e.key).filter(n => n !== e.key)] as const)
    .filter(([, aliases]) => aliases.length > 0),
);

/** Every key that can hold the document belonging in `slotKey` — itself first. */
export function docKeysForSlot(slotKey: string): string[] {
  return acceptedNamesFor(slotKey);
}
