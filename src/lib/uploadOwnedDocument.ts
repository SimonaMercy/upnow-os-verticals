/**
 * Upload a file as an owned document (presigned S3 PUT + record creation) —
 * the same three-step flow the customer KYC uploader uses, generalised for
 * any DocumentOwnerType (property title deeds, unit title deeds, …).
 *
 * `replaceDocId` swaps the file on an EXISTING row (PATCH) instead of creating a
 * second one. Replace used to be spelled delete-then-upload, which was fine
 * while both halves rode on `can_manage_documents` — and became wrong the moment
 * deleting got its own permission (0247): a manager allowed to attach a file
 * would have been refused mid-replace, having already lost the old copy on some
 * paths. Replacing in place also keeps one row per slot, so the history reads as
 * one document that changed rather than a deletion beside a new upload. Mirrors
 * putKycSlot's existingDocId.
 */
export async function uploadOwnedDocument(opts: {
  ownerType: string;          // DocumentOwnerType value, e.g. 'property' | 'unit'
  ownerId: number;
  documentKey: string;        // e.g. 'title_deed'
  category: string;           // DocumentCategory value, e.g. 'legal'
  displayName: string;
  file: File;
  replaceDocId?: number | null;
}): Promise<void> {
  const { ownerType, ownerId, documentKey, category, displayName, file, replaceDocId } = opts;
  if (file.size > 15 * 1024 * 1024) throw new Error('File must be under 15 MB.');

  const { uploadUrl, fileUrl, fileKey } = await fetch('/api/documents/upload-url', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType, ownerId, documentKey, mimeType: file.type, originalName: file.name }),
  }).then(r => r.ok ? r.json() : r.json().then((b: { message?: string }) => Promise.reject(new Error(b?.message ?? 'Upload URL failed')))) as
    { uploadUrl: string; fileUrl: string; fileKey: string };

  // Same-origin proxying of the presigned URL when it points at /api (dev).
  const target = (() => {
    try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
    catch { return uploadUrl; }
  })();
  const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('File upload failed');

  const created = replaceDocId
    ? await fetch(`/api/documents/${replaceDocId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3', displayName }),
      })
    : await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType, ownerId, documentKey, category, displayName, fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3' }),
      });
  if (!created.ok) {
    const b = await created.json().catch(() => ({}));
    throw new Error((b as { message?: string }).message ?? 'Saving the document record failed');
  }
}
