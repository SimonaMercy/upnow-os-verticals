/**
 * Admin dashboard (/dashboard/admin) — Platform Pulse.
 *
 * Pulse IS the admin landing page now, so this route renders it directly rather
 * than redirecting: the URL stays /dashboard/admin, which is what the nav, every
 * existing bookmark and dashboardPath() already point at.
 *
 * The page lives at ./pulse/page.tsx and is re-exported here, so the two routes
 * cannot drift apart — there is one component, not a copy.
 *
 * The previous overview dashboard was NOT deleted; it moved to
 * ./overview/page.tsx and is still reachable at /dashboard/admin/overview.
 */
export { default } from './pulse/page';
