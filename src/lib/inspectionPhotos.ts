/**
 * Inspection photo upload (per-item attachments, v2 report surface).
 *
 * Mirrors the legacy area-based inspector flow: a presigned-PUT to the private
 * bucket, embedding the RAW object URL into the inspection jsonb (so the backend's
 * read-time re-signing keeps working). The upload response also returns a
 * short-lived signed `viewUrl` — stashed here keyed by the raw URL so a
 * just-uploaded photo previews immediately in the same session (the raw URL 403s
 * until the next reload, after which the API returns already-signed URLs and this
 * cache is empty, falling through to `url`). Never persisted.
 */

export interface InspectionPhotoRef { id: string; url: string }

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const freshViewUrls = new Map<string, string>();
function rememberViewUrl(rawUrl: string, viewUrl?: string | null) {
  if (rawUrl && viewUrl) freshViewUrls.set(rawUrl, viewUrl);
}
/** Resolve a viewable URL for a stored inspection-photo url (fresh signed view if we have it). */
export function displayInspectionPhotoUrl(u: string | null | undefined): string {
  return (u && freshViewUrls.get(u)) || u || '';
}

/**
 * Upload one image for a checklist item; returns the attachment ref to append to
 * `item.itemAttachments`, or null on failure. Works both for the logged-in
 * RP/manager (`/api/documents/upload-url`) and the on-site inspector magic-link
 * (`opts.portalToken` → the token-scoped presigned-upload endpoint, which needs
 * the inspection `type`). The caller persists the inspection afterwards.
 */
export async function uploadInspectionItemPhoto(
  contractId: number | string,
  itemId: string,
  file: File,
  opts?: { portalToken?: string | null; type?: 'move_in' | 'move_out' },
): Promise<InspectionPhotoRef | null> {
  try {
    const portalToken = opts?.portalToken ?? null;
    const documentKey = `insp_item_${itemId}_${Date.now()}_${uid()}`;
    const body = portalToken
      ? { type: opts?.type ?? 'move_in', documentKey, mimeType: file.type, originalName: file.name }
      : {
          ownerType: 'tenancy_contract',
          ownerId: Number(contractId),
          documentKey,
          mimeType: file.type,
          originalName: file.name,
        };
    const urlRes = await fetch(portalToken
      ? `/api/portal/${portalToken}/contracts/${Number(contractId)}/inspection/upload-url`
      : '/api/documents/upload-url', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!urlRes.ok) return null;
    const { uploadUrl, fileUrl, viewUrl } = (await urlRes.json()) as {
      uploadUrl: string; fileUrl: string; viewUrl?: string;
    };
    // Same-origin proxied PUTs come back as absolute /api URLs; keep them relative.
    const target = (() => {
      try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
      catch { return uploadUrl; }
    })();
    const put = await fetch(target, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!put.ok) return null;
    rememberViewUrl(fileUrl, viewUrl);
    return { id: uid(), url: fileUrl };
  } catch {
    return null;
  }
}
