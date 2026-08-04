/**
 * A bounced cheque and the money handed over to make it good are ONE story, so
 * the payment table has to read as one block.
 *
 * The schedule is sorted by due date, which scatters that story: on contract 181
 * a 17,500 cheque bounced on 15 Jun and was settled by two payments of 10,000
 * and 7,500 — and the 10,000 was DATED 12 Jun, three days before the bounce it
 * pays off (the bank returned the cheque late; the customer had already handed
 * over cash). By date the ledger therefore reads 10,000 · bounce · 7,500, with
 * the first replacement ABOVE the thing it replaces. A property manager reading
 * that sees three unrelated rent lines and no way to tell that two of them are
 * the same 17,500 arriving in pieces.
 *
 * This re-orders the rows so every payment recorded against another one sits
 * immediately beneath it, indented, in the order it was recorded. Nothing is
 * hidden, removed or re-totalled — the same rows, in an order that groups
 * cause with effect.
 *
 * Rules worth keeping:
 *
 *  • CANCELLED replacements stay in the group. Money-wise they count for nothing
 *    (see cheque-replacement.ts on the backend — a voided replacement puts the
 *    bounce back to being owed), but a manager still needs to see that a cheque
 *    was handed over against this bounce and then voided. Dropping it would make
 *    a re-opened bounce look like it was never addressed.
 *
 *  • A replacement that ITSELF bounced and was in turn replaced nests one level
 *    deeper, so a chain of bounces reads as a chain.
 *
 *  • A payment whose parent is not in this list (linked to a row in another
 *    section, or filtered out) stays where it was, at the top level. It keeps
 *    its own "Replaces bounced cheque …" caption, which is then the only signal
 *    of the link.
 */

export interface ReplacementLinkRow {
  id: number;
  replacesPaymentId?: number | null;
}

export interface GroupedPaymentRow<T> {
  row: T;
  /** 0 for an ordinary row, 1 for a payment shown under the row it settles, etc. */
  depth: number;
  /** The row this one is nested under — null when it is at the top level. */
  parent: T | null;
}

/** How deep the nesting is allowed to read before it stops indenting further. */
export const MAX_REPLACEMENT_DEPTH = 3;

/**
 * The same rows, re-ordered so replacements sit under what they replace.
 *
 * Top-level rows keep the order they arrive in (i.e. whatever the caller sorted
 * by), and so do siblings within a group.
 */
export function groupReplacementsUnderBounce<T extends ReplacementLinkRow>(
  rows: readonly T[],
): GroupedPaymentRow<T>[] {
  const byId = new Map<number, T>();
  for (const r of rows) byId.set(r.id, r);

  const childrenOf = new Map<number, T[]>();
  for (const r of rows) {
    const parentId = r.replacesPaymentId;
    // Not a replacement, or it points at a row this table isn't showing — in
    // both cases the row belongs at the top level, where it already is.
    if (parentId == null || !byId.has(parentId) || parentId === r.id) continue;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), r]);
  }

  const out: GroupedPaymentRow<T>[] = [];
  const emitted = new Set<number>();

  const emit = (row: T, depth: number, parent: T | null) => {
    if (emitted.has(row.id)) return; // a data cycle must not spin forever
    emitted.add(row.id);
    out.push({ row, depth, parent });
    for (const child of childrenOf.get(row.id) ?? []) emit(child, depth + 1, row);
  };

  for (const r of rows) {
    const parentId = r.replacesPaymentId;
    if (parentId != null && byId.has(parentId) && parentId !== r.id) continue; // emitted with its parent
    emit(r, 0, null);
  }
  // Anything left is part of a cycle (a → b → a). Show it rather than lose it.
  for (const r of rows) emit(r, 0, null);

  return out;
}
