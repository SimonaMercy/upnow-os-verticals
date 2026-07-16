import { redirect } from 'next/navigation';

/**
 * /jobs used to be a placeholder that always rendered "No jobs yet" — it never
 * fetched anything, while the real board (Requests · Quotes · Active · Closure)
 * lives at /operations. Two nav entries for one thing, one of them permanently
 * empty. The list is retired; /operations is the board, and it now carries the
 * not-job-ready nudge this page used to own.
 *
 * Kept as a redirect rather than deleted: /jobs/[id] is the live job detail page
 * and notification deep-links point at it, so the segment must stay routable.
 */
export default function ServiceProviderJobsPage() {
  redirect('/dashboard/service-provider/operations');
}
