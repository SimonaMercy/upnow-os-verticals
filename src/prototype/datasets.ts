/**
 * PROTOTYPE ONLY — which vertical / pack module owns each mock work dataset.
 * Used by the shared Calendar, Overview and Customer views to route an item
 * back to the workspace that operates it.
 */
import type { VerticalId } from './types';

export const DATASETS: Record<string, { vertical: VerticalId; module: string; noun: string }> = {
  stays: { vertical: 'spaces', module: 'stays', noun: 'Stay' },
  venue_events: { vertical: 'spaces', module: 'venues', noun: 'Event' },
  courts: { vertical: 'spaces', module: 'courts', noun: 'Court booking' },
  charters: { vertical: 'spaces', module: 'charters', noun: 'Charter' },
  jobs: { vertical: 'services', module: 'jobs', noun: 'Job' },
  appointments: { vertical: 'services', module: 'appointments', noun: 'Appointment' },
  projects: { vertical: 'services', module: 'quotes', noun: 'Project' },
  sessions: { vertical: 'experiences', module: 'sessions', noun: 'Session' },
  reservations: { vertical: 'experiences', module: 'reservations', noun: 'Reservation' },
  members: { vertical: 'memberships', module: 'members', noun: 'Membership' },
  applications: { vertical: 'programs', module: 'applications', noun: 'Application' },
  enrolments: { vertical: 'programs', module: 'enrolments', noun: 'Enrolment' },
  clinic: { vertical: 'health', module: 'appointments', noun: 'Clinic appointment' },
  quote_requests: { vertical: 'insurance', module: 'quotes', noun: 'Quote request' },
  policies: { vertical: 'insurance', module: 'policies', noun: 'Policy' },
};

/** Days between two ISO dates (YYYY-MM-DD), timezone-free. */
export function dayDiff(from: string, to: string) {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** ISO date plus n days, timezone-free. */
export function addDays(iso: string, n: number) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
