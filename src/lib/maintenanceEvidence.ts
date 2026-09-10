/**
 * Maintenance request photos — the same presign → PUT → persist cycle as the
 * booking evidence photos (bookingEvidence.ts), against the request:
 *
 *   1. POST /maintenance/my/:id/media/upload-url → presigned PUT + raw fileUrl
 *   2. PUT the binary to uploadUrl (Content-Type = the file's mime)
 *   3. POST /maintenance/my/:id/media             → persists the RAW url row
 *
 * The API mirrors each photo onto the routed job as a "problem" photo, so the
 * provider's job page briefs the crew with the customer's own pictures.
 */

export interface MaintenancePhoto {
  id: number;
  caption: string | null;
  viewUrl: string;
  createdAt: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // matches the KYC / booking ceiling
export const MAX_REQUEST_PHOTOS = 6;

export async function uploadMaintenancePhoto(requestId: number, file: File, caption?: string): Promise<MaintenancePhoto> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: too large — 10 MB max.`);
  const presignRes = await fetch(`/api/maintenance/my/${requestId}/media/upload-url`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: file.type, originalName: file.name }),
  });
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => null);
    throw new Error(body?.message ?? `${file.name}: could not start the upload.`);
  }
  const { uploadUrl, fileUrl } = (await presignRes.json()) as { uploadUrl: string; fileUrl: string };
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error(`${file.name}: upload failed — please try again.`);
  const saveRes = await fetch(`/api/maintenance/my/${requestId}/media`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: fileUrl, caption: caption ?? undefined }),
  });
  if (!saveRes.ok) {
    const body = await saveRes.json().catch(() => null);
    throw new Error(body?.message ?? `${file.name}: could not save the photo.`);
  }
  return (await saveRes.json()) as MaintenancePhoto;
}
