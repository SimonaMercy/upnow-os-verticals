/**
 * File one document on a lease — the three-step flow every uploader uses
 * (signed upload URL → PUT the bytes → POST the record) — and return the new
 * document id, so a payment or a cheque return can be linked to it.
 */
export async function uploadLeaseDocument(
  contractId: number,
  file: File,
  meta: { key: string; label: string; category?: string; section?: 'kyc' | 'tenancy' },
): Promise<number | undefined> {
  const documentKey = `${meta.key}_${Date.now()}`;
  const mimeType = file.type || 'application/octet-stream';
  const urlRes = await fetch('/api/documents/upload-url', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerType: 'tenancy_contract', ownerId: contractId, documentKey, mimeType, originalName: file.name }),
  });
  if (!urlRes.ok) {
    const b = await urlRes.json().catch(() => ({})) as { message?: string | string[] };
    throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${urlRes.status}`));
  }
  const { uploadUrl, fileUrl, fileKey } = await urlRes.json() as { uploadUrl: string; fileUrl: string; fileKey?: string };
  const target = (() => { try { const u = new URL(uploadUrl); return u.pathname.startsWith('/api/') ? u.pathname + u.search : uploadUrl; } catch { return uploadUrl; } })();
  const putRes = await fetch(target, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file });
  if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
  const docRes = await fetch('/api/documents', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerType: 'tenancy_contract', ownerId: contractId, category: meta.category ?? 'contract', section: meta.section ?? 'tenancy',
      documentKey, displayName: meta.label, fileUrl, s3Key: fileKey, mimeType, isVisibleToTenant: false,
    }),
  });
  if (!docRes.ok) {
    const b = await docRes.json().catch(() => ({})) as { message?: string | string[] };
    throw new Error(Array.isArray(b.message) ? b.message.join(', ') : (b.message ?? `Error ${docRes.status}`));
  }
  const created = await docRes.json().catch(() => null) as { id?: number } | null;
  return created?.id;
}
