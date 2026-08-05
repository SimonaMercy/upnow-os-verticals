/**
 * Where a unit actually lives, as a URL.
 *
 * A unit is READ in the Units workspace, with its preview open — there is no
 * per-unit route. There used to be one (`/dashboard/units/{id}`, a standalone
 * full page), and it was a second way to look at a unit that nobody maintained
 * alongside the workspace's own preview: the same unit rendered two different
 * ways depending on which link you happened to click. It has been removed, and
 * this is the one place the destination is decided so the two cannot drift
 * apart again.
 *
 * `?unit=` is read once on mount by UnitsWorkspace (next to the `?q=` seed it
 * already had) and opens that unit's UnitPreviewModal.
 *
 * Both portals support it. The manager portal renders the SAME workspace
 * component under /dashboard/manager/units, so a manager's unit links no longer
 * have to be dead ends the way they were when only the RP had a unit route.
 */

import type { PortalScope } from './contractHref';

export function unitHref(unitId: number, manager?: PortalScope): string {
  return manager
    ? `/dashboard/manager/units?rp=${manager.rp}&unit=${unitId}`
    : `/rental-provider/dashboard/units?unit=${unitId}`;
}
