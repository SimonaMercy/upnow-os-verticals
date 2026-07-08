/**
 * Upload a file into a KYC "slot" (e.g. Emirates ID front / back) for an owned
 * document. Replaces the file in place when the slot already holds a document
 * (PATCH — keeps one row, swaps the file + s3 key), otherwise creates a new
 * document under the slot's canonical key.
 */
export async function putKycSlot(opts: {
  ownerType: string;
  ownerId: number;
  canonicalKey: string;       // key to use when creating a fresh document, e.g. 'emirates_id_back'
  category: string;
  displayName: string;
  file: File;
  existingDocId?: number | null;   // when set, replace this document's file
  existingKey?: string | null;     // the existing doc's key (keeps the same s3 folder on replace)
  expiryDate?: string | null;      // ISO date (yyyy-mm-dd) for docs that expire — EID, passport, visa, licences. Omit to leave untouched.
}): Promise<{ id: number; documentKey: string; fileUrl: string; mimeType: string }> {
  const { ownerType, ownerId, canonicalKey, category, displayName, file, existingDocId, existingKey, expiryDate } = opts;
  if (file.size > 15 * 1024 * 1024) throw new Error('File must be under 15 MB.');
  const documentKey = existingDocId ? (existingKey ?? canonicalKey) : canonicalKey;
  // Only touch expiry when the caller explicitly passes it (undefined = leave as-is).
  const expiryPatch = expiryDate !== undefined ? { expiryDate: expiryDate || null } : {};

  const { uploadUrl, fileUrl, fileKey } = await fetch('/api/documents/upload-url', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType, ownerId, documentKey, mimeType: file.type, originalName: file.name }),
  }).then(r => r.ok ? r.json() : r.json().then((b: { message?: string }) => Promise.reject(new Error(b?.message ?? 'Upload URL failed')))) as
    { uploadUrl: string; fileUrl: string; fileKey: string };

  const target = (() => {
    try { const p = new URL(uploadUrl); return p.pathname.startsWith('/api/') ? p.pathname + p.search : uploadUrl; }
    catch { return uploadUrl; }
  })();
  const put = await fetch(target, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('File upload failed');

  const res = existingDocId
    ? await fetch(`/api/documents/${existingDocId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3', ...expiryPatch }),
      })
    : await fetch('/api/documents', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerType, ownerId, documentKey, category, displayName, fileUrl, mimeType: file.type, s3Key: fileKey, storageProvider: 's3', ...expiryPatch }),
      });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { message?: string }).message ?? 'Saving the document failed');
  }
  const saved = await res.json().catch(() => ({})) as { id?: number; documentKey?: string };
  return { id: saved.id ?? existingDocId ?? 0, documentKey: saved.documentKey ?? documentKey, fileUrl, mimeType: file.type };
}
