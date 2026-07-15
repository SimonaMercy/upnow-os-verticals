/**
 * E-signature evidence helpers — shared by every surface that captures a
 * contract signature (portal SignBox, ContractSignBar, RP inline sign,
 * customer sign modals).
 *
 * The backend freezes the signing context on each signature row (migration
 * 0124): IP + user-agent come from the request itself (the /api proxy forwards
 * the browser's values), while the fields below are what only the browser
 * knows — reported in the sign payload as `clientMeta`.
 *
 * ESIGN_CONSENT_TEXT mirrors ESIGN_CONSENT_TEXT_V1 on the backend — the server
 * stamps its own copy of the text onto the signature row when `consent: true`
 * is sent, so this constant is display-only. Keep the two in sync.
 */

export const ESIGN_CONSENT_TEXT =
  'I agree that my electronic signature is the legal equivalent of my handwritten signature, ' +
  'that I intend to be bound by this tenancy contract, and I consent to conduct this transaction ' +
  'electronically in accordance with UAE Federal Decree-Law No. 46 of 2021 on Electronic ' +
  'Transactions and Trust Services.';

export interface SignClientMeta {
  timezone?: string;
  locale?: string;
  platform?: string;
  screen?: string;
  viewport?: string;
  [k: string]: unknown;
}

/** Device context reported alongside a signature. Safe on SSR (returns {}). */
export function collectClientMeta(): SignClientMeta {
  if (typeof window === 'undefined') return {};
  const meta: SignClientMeta = {};
  try { meta.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* optional */ }
  try { meta.locale = navigator.language; } catch { /* optional */ }
  try { meta.platform = navigator.platform || undefined; } catch { /* optional */ }
  try { meta.screen = `${window.screen.width}x${window.screen.height}`; } catch { /* optional */ }
  try { meta.viewport = `${window.innerWidth}x${window.innerHeight}`; } catch { /* optional */ }
  return meta;
}

export interface SignGeo { lat: number; lng: number; accuracy?: number }

/**
 * Best-effort signing geolocation — captured to stamp the signer's location on
 * the signature certificate. Strictly NON-BLOCKING and safe on EVERY browser
 * (Safari iOS/macOS, Chrome, Firefox, embedded webviews):
 *   • feature-detects navigator.geolocation (absent in some old/embedded views)
 *   • only prompts in a secure context (https / localhost) — geolocation is
 *     unavailable otherwise, so we skip straight to null instead of erroring
 *   • hard timeout so a slow or ignored prompt never hangs the Sign action
 *   • resolves null on denial / error / timeout / unsupported (the server then
 *     falls back to an IP-derived city)
 * Call it from the actual Sign click (a user gesture) — Safari/iOS requires one.
 * NEVER gate the Sign button on the result.
 */
export function collectGeo(timeoutMs = 7000): Promise<SignGeo | null> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve(null);
  }
  if (window.isSecureContext === false) return Promise.resolve(null);
  return new Promise<SignGeo | null>((resolve) => {
    let settled = false;
    const done = (v: SignGeo | null) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); done({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
        () => { clearTimeout(timer); done(null); },
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 },
      );
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}
