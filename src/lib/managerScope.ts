/**
 * managerScope — the manager's chosen landlord ("Acting for …") made sticky.
 *
 * A manager works for several landlords. The LandlordSwitcher scopes the whole
 * dashboard to one of them via `?rp=<id>` in the URL, which every manager page
 * reads. On its own the URL param is lost the moment the manager clicks a
 * sidebar link (those hrefs carry no query), so the scope would silently reset
 * to "All landlords" on every navigation.
 *
 * We persist the selection here so it survives navigation, reloads and deep
 * links. `ManagerScopeSync` restores it into the URL whenever a page loads
 * without `?rp=`, so the chosen landlord stays in effect on every page until
 * the manager picks another one (or explicitly "All landlords").
 */

export const MGR_SCOPE_KEY = 'upnow.mgr.rp';

/** Sentinel stored when the manager explicitly chooses "All landlords", so we
 *  can tell "chose All" apart from "never chose" (only the latter is empty). */
const ALL = 'all';

/**
 * The persisted scope:
 *   - a positive number → that landlord's rentalProviderId
 *   - 'all'             → manager explicitly picked "All landlords" (don't restore)
 *   - null              → nothing chosen yet
 */
export function readMgrScope(): number | 'all' | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(MGR_SCOPE_KEY);
  if (!raw) return null;
  if (raw === ALL) return ALL;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Persist the current selection. Pass `null` for "All landlords". */
export function writeMgrScope(rpId: number | null): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MGR_SCOPE_KEY, rpId == null ? ALL : String(rpId));
}
