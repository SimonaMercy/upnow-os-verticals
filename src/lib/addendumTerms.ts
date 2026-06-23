/**
 * In-app, bilingual addendum terms (replaces the download-edit-reupload .docx
 * flow). Authored in the clause-list editor, rendered by the contract PDF's
 * addendumPages() with a hardcoded, non-editable signature block.
 *
 * `en` / `ar` are clause lines; an ALL-CAPS English line renders as a section
 * heading. Mirror of the backend `src/shared/addendum-terms.ts` type.
 */
export interface AddendumTerms {
  /** Addendum title (English), shown in the PDF page bar. */
  name?: string | null;
  /** Addendum title (Arabic). */
  nameAr?: string | null;
  en: string[];
  ar: string[];
}

const clean = (a?: string[]): string[] =>
  Array.isArray(a) ? a.map((s) => (s ?? '').trim()).filter(Boolean) : [];

/** Flatten terms into the renderer's `lines` shape: English block, then Arabic
 *  block. Each line's direction is auto-detected by the PDF renderer. */
export function addendumTermsToLines(t: AddendumTerms | null | undefined): string[] {
  if (!t) return [];
  return [...clean(t.en), ...clean(t.ar)];
}

/** True when the terms hold at least one non-empty clause line. */
export function hasAddendumTerms(t: AddendumTerms | null | undefined): boolean {
  return addendumTermsToLines(t).length > 0;
}

export const emptyAddendumTerms = (): AddendumTerms => ({ name: '', nameAr: '', en: [], ar: [] });
