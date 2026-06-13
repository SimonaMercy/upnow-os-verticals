/**
 * Human label for a document row.
 *
 * Emirates ID scans are imported/uploaded as two separate files: the first is
 * keyed `emirates_id`, the second `emirates_id_2` (or `emirates_id_back` /
 * `emirates_id_<timestamp>` from the upload de-dupe). The source never tagged
 * which scan is the front vs the back, so we infer it from presence: when a
 * customer has both a base and a secondary EID, show them as Front / Back;
 * with only one on file, just "Emirates ID".
 */
export type LabelDoc = { documentKey: string; displayName?: string | null };

const prettyKey = (k: string) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const isEidFront = (k: string) => k === 'emirates_id' || k === 'emirates_id_front';
const isEidBack = (k: string) => k === 'emirates_id_back' || /^emirates_id_(2|\d{6,})$/.test(k);

export function docLabel(d: LabelDoc, all: { documentKey: string }[]): string {
  const k = d.documentKey;
  if (isEidFront(k) || isEidBack(k)) {
    const hasFront = all.some(x => isEidFront(x.documentKey));
    const hasBack = all.some(x => isEidBack(x.documentKey));
    if (hasFront && hasBack) return isEidFront(k) ? 'Emirates ID — Front' : 'Emirates ID — Back';
    return 'Emirates ID';
  }
  return d.displayName || prettyKey(k);
}
