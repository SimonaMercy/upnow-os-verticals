/**
 * SP-103 · technician shifts — types + helpers shared by the provider Roster
 * page and the technician "My shifts" page. Mirrors TechnicianShiftsService.
 */

export type ShiftStatus = 'assigned' | 'confirmed' | 'conflict_reported' | 'cancelled' | 'completed';
export type ShiftPhase = 'upcoming' | 'live' | 'past';

export interface ShiftZone { id: number; label: string }

export interface Shift {
  id: number;
  technicianId: number;
  technicianName: string;
  serviceProviderId: number;
  status: ShiftStatus;
  shiftStartAt: string;
  shiftEndAt: string;
  breakStartAt: string | null;
  breakEndAt: string | null;
  isEmergencyRoster: boolean;
  conflictReason: string | null;
  notes: string | null;
  zones: ShiftZone[];
  phase: ShiftPhase;
  createdAt: string;
  updatedAt: string;
}

export interface RosterTechnician {
  id: number;
  name: string;
  status: string;
  isLeadCapable: boolean;
  complianceStatus: string;
}

export interface ProviderShiftsResponse {
  window: { from: string; to: string };
  technicians: RosterTechnician[];
  shifts: Shift[];
}

export interface TechnicianShiftsResponse {
  window: { from: string; to: string };
  technicianId: number;
  shifts: Shift[];
}

export const SHIFT_STATUS: Record<ShiftStatus, { label: string; bg: string; fg: string }> = {
  assigned:          { label: 'Assigned',   bg: '#EEF2FF', fg: '#4338CA' },
  confirmed:         { label: 'Confirmed',  bg: '#E9F4EE', fg: '#0B7A4E' },
  conflict_reported: { label: 'Conflict',   bg: '#FDECEC', fg: '#B42318' },
  cancelled:         { label: 'Cancelled',  bg: '#F3F4F6', fg: '#6B7280' },
  completed:         { label: 'Completed',  bg: '#F3F4F6', fg: '#374151' },
};

/** Zone chip suggestions — emirate-level is the launch granularity (ticket). Free text still allowed. */
export const ZONE_SUGGESTIONS = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain'] as const;

const TZ = 'Asia/Dubai';
export const fmtShiftTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-AE', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—';
export const fmtShiftDay = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
export const fmtShiftRange = (s: Pick<Shift, 'shiftStartAt' | 'shiftEndAt'>) => `${fmtShiftTime(s.shiftStartAt)} – ${fmtShiftTime(s.shiftEndAt)}`;

/** Duration in hours net of the break, one decimal. */
export function shiftHours(s: Pick<Shift, 'shiftStartAt' | 'shiftEndAt' | 'breakStartAt' | 'breakEndAt'>): number {
  const total = new Date(s.shiftEndAt).getTime() - new Date(s.shiftStartAt).getTime();
  const brk = s.breakStartAt && s.breakEndAt ? new Date(s.breakEndAt).getTime() - new Date(s.breakStartAt).getTime() : 0;
  return Math.round(((total - brk) / 36e5) * 10) / 10;
}

/** Local `YYYY-MM-DD` key of a moment (browser tz — the technician's own clock). */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Monday of the week containing `d` (local midnight). */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - dow);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** `<input type="datetime-local">` value for a Date, in the browser's tz. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const x = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

/** Inverse: local input value → ISO with offset (what the API stores as timestamptz). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Group shifts by local day key, keeping the API's start-time order. */
export function groupByDay(shifts: Shift[]): Array<{ day: string; shifts: Shift[] }> {
  const map = new Map<string, Shift[]>();
  for (const s of shifts) {
    const k = dayKey(s.shiftStartAt);
    map.set(k, [...(map.get(k) ?? []), s]);
  }
  return [...map.entries()].map(([day, list]) => ({ day, shifts: list }));
}
