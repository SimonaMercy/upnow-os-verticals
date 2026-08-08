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
 *
 * Anti-exfiltration: the host renders every document onto a <canvas> (images via
 * a tainted canvas the browser refuses to "Save image as"; PDFs via pdf.js) with
 * a per-viewer watermark baked into the pixels, and disables the right-click /
 * drag / select gestures. This makes the underlying file URL absent from the DOM
 * and casual "Save as" impossible; it cannot stop OS screenshots (no web API
 * can), so the watermark makes any screen-grab traceable to who took it.
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

export type DocViewerState = { docs: DocViewerDoc[]; title: string; watermark: string };

let current: DocViewerState | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

/**
 * The identity stamped (tiled, translucent) over every viewed document, e.g.
 * "Ayesha Almulla · #395". Set once where the viewer's identity is known — the
 * authenticated user in the app shell, or the tenant on a magic-link portal —
 * since <DocViewerHost/> is mounted outside the auth context and can't read it.
 */
let watermarkLabel = '';
export function setDocViewerWatermark(label: string | null | undefined): void {
  watermarkLabel = (label ?? '').trim();
}

/**
 * Builds the full watermark line (identity + the moment it was opened). Exported
 * so the other in-portal document readers (DocumentReaderModal, KycDocumentsPanel)
 * stamp the same identity through <SecureDocCanvas/> as this viewer does.
 */
export function currentDocWatermark(): string {
  const stamp = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const who = watermarkLabel || 'UpNow — Confidential';
  return `${who} · ${stamp}`;
}

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
  current = { docs: list, title, watermark: currentDocWatermark() };
  notify();
}

/**
 * Open stored documents by their document id, streaming the bytes through the
 * API instead of pointing the viewer at the storage bucket.
 *
 * `documents.file_url` holds a bare `storage.googleapis.com/...` URL, and that
 * bucket denies anonymous reads — a browser fetch of it comes back 403 and gets
 * dropped as ERR_BLOCKED_BY_ORB, so the viewer opened on a document that could
 * never load. GET /documents/:id/file streams the same bytes same-origin with
 * the session cookie, which is what that endpoint was added for.
 *
 * The response is turned into a `blob:` URL so everything downstream — the
 * image path (`img.src`), the pdf.js path (`fetch`, which omits credentials) —
 * keeps working unchanged and stays same-origin.
 *
 * Blob URLs are revoked when the viewer closes; holding them for the life of the
 * modal is what lets the canvas re-read the bytes on rotate.
 */
export async function openDocViewerByIds(
  docs: ReadonlyArray<{ id: number; caption?: string | null; mimeType?: string | null }>,
  title = 'Document',
): Promise<void> {
  const loaded = await Promise.all(
    docs.map(async (d) => {
      try {
        const res = await fetch(`/api/documents/${d.id}/file`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        return {
          fileUrl: URL.createObjectURL(blob),
          caption: d.caption ?? null,
          // The canvas picks its image/PDF branch off the URL extension, which a
          // blob: URL does not have — carry the real type across instead.
          mimeType: d.mimeType ?? blob.type ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  const list = loaded.filter((d): d is NonNullable<typeof d> => d != null);
  if (!list.length) return;
  current = { docs: list, title, watermark: currentDocWatermark() };
  notify();
}

export function closeDocViewer(): void {
  if (!current) return;
  // Release any blob: URLs this viewer minted (openDocViewerByIds), so the bytes
  // are not pinned in memory for the rest of the session.
  for (const d of current.docs) {
    if (d.fileUrl?.startsWith('blob:')) URL.revokeObjectURL(d.fileUrl);
  }
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
