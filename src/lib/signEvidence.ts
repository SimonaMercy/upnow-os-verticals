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
