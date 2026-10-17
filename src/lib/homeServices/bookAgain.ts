/**
 * "Book again" hand-off — My Services → /services/book/[code]?again=1.
 *
 * The previous booking's options (package, hours, quantity, add-ons), address
 * and notes ride in sessionStorage (not the URL — an address does not belong
 * in a shareable link). The booking page reads it once, only when the code
 * matches, then clears it. Date & time are always picked fresh.
 *
 * Pinning the SAME professional needs backend support (a preferred-provider
 * field on POST /bookings) — not offered here.
 */

export const BOOK_AGAIN_KEY = 'upnow_book_again';

export interface BookAgainPayload {
  code: string;
  fromBookingId: number;
  variantId?: number | null;
  /** Package NAME — fallback when the row has no variant id. */
  variantName?: string | null;
  hours?: number | null;
  quantity?: number | null;
  addonIds?: number[];
  addressText?: string | null;
  addressLat?: number | null;
  addressLng?: number | null;
  emirate?: string | null;
  notes?: string | null;
}

export function saveBookAgain(p: BookAgainPayload): void {
  try { sessionStorage.setItem(BOOK_AGAIN_KEY, JSON.stringify(p)); } catch { /* private mode — the page still opens */ }
}

/** Read (and consume) the payload for this service code. */
export function takeBookAgain(code: string): BookAgainPayload | null {
  try {
    const raw = sessionStorage.getItem(BOOK_AGAIN_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as BookAgainPayload;
    if (!p || p.code !== code) return null;
    sessionStorage.removeItem(BOOK_AGAIN_KEY);
    return p;
  } catch {
    return null;
  }
}

/** Loose shape of a booking row/detail — every field optional, read defensively. */
export interface RebookSource {
  id: number;
  templateId?: number | null;
  serviceCode?: string | null;
  serviceName?: string | null;
  template?: { id?: number | null; code?: string | null; name?: string | null } | null;
  variantId?: number | null;
  variant?: { id?: number | null; name?: string | null } | null;
  packageName?: string | null;
  hours?: number | null;
  quantity?: number | null;
  addonIds?: number[] | null;
  addons?: Array<{ id?: number | null; addonId?: number | null }> | null;
  addressText?: string | null;
  addressLat?: number | string | null;
  addressLng?: number | string | null;
  emirate?: string | null;
  notes?: string | null;
  specialInstructions?: string | null;
}

interface CatalogLike { categories?: Array<{ services?: Array<{ id: number; code: string; name: string }> }> }

const num = (v: number | string | null | undefined) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Resolve the service code for a booking: explicit code → template id → service name. */
export function resolveServiceCode(b: RebookSource, catalog: CatalogLike | null): string | null {
  const explicit = b.serviceCode ?? b.template?.code ?? null;
  if (explicit) return explicit;
  const services = (catalog?.categories ?? []).flatMap((c) => c.services ?? []);
  const tid = b.templateId ?? b.template?.id ?? null;
  if (tid != null) {
    const byId = services.find((s) => s.id === tid);
    if (byId) return byId.code;
  }
  const name = (b.serviceName ?? b.template?.name ?? '').trim().toLowerCase();
  if (!name) return null;
  return services.find((s) => s.name.trim().toLowerCase() === name)?.code ?? null;
}

export function buildBookAgain(b: RebookSource, code: string): BookAgainPayload {
  const addonIds = b.addonIds ?? (b.addons ?? []).map((a) => a.addonId ?? a.id).filter((x): x is number => typeof x === 'number');
  return {
    code,
    fromBookingId: b.id,
    variantId: b.variantId ?? b.variant?.id ?? null,
    variantName: b.packageName ?? b.variant?.name ?? null,
    hours: b.hours ?? null,
    quantity: b.quantity ?? null,
    addonIds,
    addressText: b.addressText ?? null,
    addressLat: num(b.addressLat),
    addressLng: num(b.addressLng),
    emirate: b.emirate ?? null,
    notes: b.notes ?? b.specialInstructions ?? null,
  };
}
