/**
 * Photo-or-video helpers shared by every thumbnail strip and the lightbox.
 * A stored object's url carries its extension (`…/photos/<uuid>.mp4?X-Amz-…`),
 * so one check tells a video from a photo without any extra API field.
 */
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v', '3gp'];

export function isVideoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].split('#')[0];
  const ext = clean.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? '';
  return VIDEO_EXT.includes(ext);
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || isVideoUrl(file.name);
}

/** Size ceilings: a photo 10 MB (the KYC ceiling), a phone clip 100 MB (under the local-dev 120mb raw-body cap). */
export const MAX_PHOTO_MB = 10;
export const MAX_VIDEO_MB = 100;

/** Why this file is too big to upload, or null when it fits. */
export function mediaSizeError(file: File): string | null {
  const video = isVideoFile(file);
  const mb = video ? MAX_VIDEO_MB : MAX_PHOTO_MB;
  return file.size > mb * 1024 * 1024 ? `${file.name}: too large — ${mb} MB max for a ${video ? 'video' : 'photo'}.` : null;
}
