/**
 * Per-browser-session id, sent with every tracking beacon (page visits, page
 * views, sign-up funnel). It lets anonymous `page_visits` and authenticated
 * `page_views` from the same session be stitched into one journey — including
 * the anonymous → sign-in handoff, since sessionStorage survives the login
 * navigation within the tab.
 *
 * Deliberately per-session (sessionStorage, cleared when the tab closes) — NOT a
 * persistent cross-session/-device identifier — to stay privacy-light, matching
 * the cookieless posture of the rest of the tracking layer.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let s = sessionStorage.getItem('upnow_sid');
    if (!s) {
      s =
        (typeof crypto !== 'undefined' && crypto.randomUUID?.()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('upnow_sid', s);
    }
    return s;
  } catch {
    return ''; // storage blocked (private mode / disabled) — degrade gracefully
  }
}
