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
  /**
   * `documents` table id. When present AND the viewer is allowed to download
   * (landlord / manager / admin — see `canRoleDownloadDocs`), the host shows a
   * "Download" control that pulls the clean file via /documents/:id/download.
   * Omit for property/unit MEDIA (a different table) — those aren't downloadable.
   */
  id?: number | null;
};

export type DocViewerState = { docs: DocViewerDoc[]; title: string; watermark: string; canDownload: boolean };

/**
 * Roles allowed to download uploaded documents. Landlords, their managers, and
 * admins may pull the clean (watermark-free) file; customers, tenants (magic
 * link) and service providers stay strictly view-only, per the anti-exfiltration
 * policy. Single source of truth — used both to set the viewer store flag and to
 * gate the in-context readers (DocumentReaderModal, KycDocumentsPanel).
 */
const DOWNLOAD_ROLES = new Set(['rental_provider', 'manager', 'admin', 'super_admin']);
export function canRoleDownloadDocs(role?: string | null): boolean {
  return !!role && DOWNLOAD_ROLES.has(role.toLowerCase());
}

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
 * Whether the current viewer may download documents. Set once from the authed
 * user's role by <DocViewerIdentityBinder/> (same place the watermark identity is
 * bound), since <DocViewerHost/> is mounted outside the auth context. Captured
 * into each viewer state at open time, like the watermark.
 */
let canDownloadFlag = false;
export function setDocViewerCanDownload(allowed: boolean): void {
  canDownloadFlag = allowed;
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
  current = { docs: list, title, watermark: currentDocWatermark(), canDownload: canDownloadFlag };
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
