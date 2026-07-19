import { redirect } from 'next/navigation';

/**
 * /dashboard/admin/activity/board → /dashboard/admin/activity.
 * "board" is the API path (/api/admin/activity/board); people type it into the
 * address bar expecting the page, so send them to the real Activity board
 * instead of the generic in-development fallback.
 */
export default function ActivityBoardRedirect() {
  redirect('/dashboard/admin/activity');
}
