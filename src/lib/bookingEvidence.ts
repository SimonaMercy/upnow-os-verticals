/**
 * Booking evidence photos (SP-258) — the shared upload cycle every surface
 * uses (customer problem photos, provider before/after proof; the technician
 * app reuses this in Sprint 3):
 *
 *   1. POST /bookings/:id/media/upload-url  → presigned PUT + raw fileUrl
 *   2. PUT the binary to uploadUrl (Content-Type = the file's mime)
 *   3. POST /bookings/:id/media             → persists the RAW url row
 *
 * The response carries a short-lived signed viewUrl so the photo previews
 * immediately; on later loads the API returns already-signed viewUrls.
 */

export type EvidenceKind = 'problem' | 'before' | 'after';

export interface EvidencePhoto {
  id: number;
  kind: EvidenceKind;
  caption: string | null;
  viewUrl: string;
  createdAt: string;
}

export interface EvidenceGroups {
  problem: EvidencePhoto[];
  before: EvidencePhoto[];
  after: EvidencePhoto[];
}

export const EMPTY_EVIDENCE: EvidenceGroups = { problem: [], before: [], after: [] };

const MAX_BYTES = 10 * 1024 * 1024; // matches the KYC upload ceiling

export async function uploadBookingPhoto(
  bookingId: number,
  kind: EvidenceKind,
  file: File,
  caption?: string,
): Promise<EvidencePhoto> {
  if (file.size > MAX_BYTES) throw new Error('Photo is too large — 10 MB max.');

  const presignRes = await fetch(`/api/bookings/${bookingId}/media/upload-url`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, mimeType: file.type, originalName: file.name }),
  });
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => null);
    throw new Error(body?.message ?? 'Could not start the upload.');
  }
  const { uploadUrl, fileUrl } = (await presignRes.json()) as { uploadUrl: string; fileUrl: string };

  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
  if (!put.ok) throw new Error('Photo upload failed — please try again.');

  const saveRes = await fetch(`/api/bookings/${bookingId}/media`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, url: fileUrl, caption: caption ?? undefined }),
  });
  if (!saveRes.ok) {
    const body = await saveRes.json().catch(() => null);
    throw new Error(body?.message ?? 'Could not save the photo.');
  }
  return (await saveRes.json()) as EvidencePhoto;
}
