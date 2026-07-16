/**
 * Open every document together in the in-portal document viewer as one
 * scrollable feed (images inline, PDFs in a chrome-less iframe).
 *
 * Previously this opened a new browser tab via `window.open`. Customer documents
 * must stay inside the portal (no external tab, no download), so this now
 * delegates to the global in-app viewer. The signature is unchanged, so existing
 * callers keep working.
 */
import { openDocViewer } from './docViewer';

export interface ViewableDoc {
  fileUrl?: string | null;
  displayName?: string | null;
  documentKey?: string | null;
}

export function openDocsTogether(docs: ViewableDoc[]): void {
  openDocViewer(docs, 'Documents');
}
