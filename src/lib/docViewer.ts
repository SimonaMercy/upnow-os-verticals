'use client';

/**
 * In-portal document viewer — a single global store driving one <DocViewerHost/>
 * mounted at the app root.
 *
 * Policy: customer documents (KYC, passports/EIDs/visas, payment proofs,
 * financial docs, inspection photos, uploaded contract attachments, …) are
 * viewable ONLY inside the portal. They must never be downloaded or opened in
 * an external browser tab. So every "View"/"Open" affordance routes through
 * `openDocViewer(...)` instead of an `<a href target="_blank">` or a `download`
 * link. The host renders images inline and PDFs in a chrome-less (toolbar-0)
 * iframe, with no download / "open in new tab" controls.
 *
 * Out of scope (these stay downloadable): the GENERATED tenancy contract / Ejari
 * PDF (the customer/RP's own contract via the /print routes) and blank
 * sample/template/CSV downloads — those aren't customer documents.
 */
import { useSyncExternalStore } from 'react';

export type DocViewerDoc = {
  fileUrl?: string | null;
  /** Caption shown above the document. Falls back to displayName / documentKey. */
  caption?: string | null;
  displayName?: string | null;
  documentKey?: string | null;
  mimeType?: string | null;
};

export type DocViewerState = { docs: DocViewerDoc[]; title: string };

let current: DocViewerState | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

/**
 * Open the in-portal viewer for one or more documents. Accepts a single doc or
 * an array; entries without a fileUrl are dropped. No-op (and never opens an
 * empty modal) when nothing is viewable.
 */
export function openDocViewer(docs: DocViewerDoc | DocViewerDoc[], title = 'Document'): void {
  const list = (Array.isArray(docs) ? docs : [docs]).filter(
    (d): d is DocViewerDoc => !!d && !!d.fileUrl,
  );
  if (!list.length) return;
  current = { docs: list, title };
  notify();
}

export function closeDocViewer(): void {
  if (!current) return;
  current = null;
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useDocViewerState(): DocViewerState | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
