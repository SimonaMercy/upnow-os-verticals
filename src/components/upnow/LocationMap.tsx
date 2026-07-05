'use client';

/**
 * LocationMap — a read-only Google map with a marker at the given point.
 *
 * Uses Google's keyless embed (`maps.google.com/maps?...&output=embed`) rather
 * than the Maps JS API, because `GOOGLE_MAPS_KEY` is not configured in every
 * environment (the app's /api/maps/key returns '' locally). The embed needs no
 * key and renders an interactive map + pin from just the coordinates, so the
 * location always shows. Display-only sibling of the draggable MapPicker.
 */
export function LocationMap({
  latitude,
  longitude,
  label,
  height = 260,
}: {
  latitude: number;
  longitude: number;
  label?: string;
  height?: number | string;
}) {
  const src = `https://maps.google.com/maps?q=${latitude},${longitude}&z=15&hl=en&output=embed`;
  return (
    <div style={{ width: '100%', height, borderRadius: 14, overflow: 'hidden', border: '1px solid #e7ebe6', background: '#eef1ec' }}>
      <iframe
        src={src}
        title={label ? `Map — ${label}` : 'Location map'}
        width="100%"
        height="100%"
        style={{ border: 0, display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  );
}
