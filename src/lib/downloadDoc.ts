'use client';

/**
 * Clean, watermark-free download of a STORED document by id.
 *
 * The backend returns a short-lived signed URL carrying a
 * `Content-Disposition: attachment` header (see documents/:id/download). The
 * browser then does a top-level navigation to that URL — NOT a cross-origin
 * `fetch` — so the file saves with a proper name and NO bucket CORS rule is
 * required. Used for the generated tenancy artifacts (move-in / move-out
 * inspection reports, deposit settlement), which — unlike uploaded KYC/ID docs
 * — are the counterparty's own documents and are meant to be downloadable.
 *
 * Pass `portalToken` to use the no-login magic-link endpoint (landlord / tenant),
 * which only ever serves the link's own contract documents.
 */
export async function downloadStoredDoc(documentId: number, portalToken?: string | null): Promise<void> {
  const endpoint = portalToken
    ? `/api/portal/${portalToken}/documents/${documentId}/download`
    : `/api/documents/${documentId}/download`;
  const res = await fetch(endpoint, { credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const { url, fileName } = (await res.json()) as { url: string; fileName?: string };
  if (!url) throw new Error('No download URL returned');
  triggerBrowserDownload(url, fileName);
}

/**
 * Save a file from a URL. For a `blob:` URL the `download` attribute renames it;
 * for a cross-origin signed URL the server's Content-Disposition governs the
 * filename (the attribute is ignored cross-origin) — either way the file saves
 * without navigating away from the page.
 */
export function triggerBrowserDownload(url: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
