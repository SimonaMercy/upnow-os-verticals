/**
 * Building inspections (0383) — shared types + URL helper.
 * The landlord calls /building-inspections/...; a manager calls the same routes
 * with ?rp=<landlord> (server checks canManageInspections).
 */
export type BuildingFrequency = 'monthly' | 'quarterly' | 'off';
export type VisitStatus = 'due' | 'submitted' | 'approved' | 'returned';
export type ItemResult = 'ok' | 'issue' | 'na';

export interface ChecklistItem { id: number; area: string; label: string; description: string | null; sortOrder: number; isActive: boolean }
export interface Checklist {
  id: number; name: string; propertyId: number | null; propertyName: string | null; isActive: boolean;
  scope: 'general' | 'property'; itemCount: number; items: ChecklistItem[];
}
export interface ScheduleRow {
  propertyId: number; propertyName: string; spaceCategory: string; frequency: BuildingFrequency;
  checklistId: number | null; resolvedChecklistId: number | null; resolvedChecklistName: string | null; resolvedScope: 'general' | 'property' | null;
  inspectorUserId: number | null; inspectorName: string | null; startDate: string | null; openVisits: number; overdueVisits: number;
}
export interface Inspector { userId: number; name: string; role: 'landlord' | 'manager' }
export interface VisitRow {
  id: number; propertyId: number; propertyName: string; frequency: string; periodLabel: string; periodStart: string; periodEnd: string; dueDate: string;
  status: VisitStatus; overdue: boolean; inspectorUserId: number | null; inspectorName: string | null; isMine: boolean;
  issuesCount: number; itemsTotal: number; itemsAnswered: number; photoCount: number;
  submittedByName: string | null; submittedAt: string | null; reviewedAt: string | null;
}
export interface VisitPhoto { id: number; itemId: number | null; caption: string | null; createdAt: string; uploadedByUserId: number | null; viewUrl: string }
export interface VisitItem {
  id: number; area: string; label: string; description: string | null; sortOrder: number; result: ItemResult | null; comment: string | null;
  maintenanceRequestId: number | null; photos: VisitPhoto[];
}
export interface Visit {
  id: number; propertyId: number; propertyName: string; address: string | null; frequency: string; periodLabel: string; periodStart: string; periodEnd: string; dueDate: string;
  status: VisitStatus; overdue: boolean; issuesCount: number; overallNote: string | null;
  inspectorUserId: number | null; inspectorName: string | null; isMine: boolean; canAssign: boolean;
  submittedByName: string | null; submittedAt: string | null; reviewedAt: string | null; reviewNote: string | null;
  canEdit: boolean; canReview: boolean; items: VisitItem[]; photos: VisitPhoto[];
}
export interface Summary { open: number; overdue: number; awaitingReview: number }

/** `/building-inspections<path>` with `?rp=` appended for a manager. */
export function biUrl(path: string, rp?: number | null): string {
  const base = `/building-inspections${path}`;
  if (rp == null) return base;
  return `${base}${base.includes('?') ? '&' : '?'}rp=${rp}`;
}

export const STATUS_LABEL: Record<VisitStatus, string> = { due: 'Due', submitted: 'Awaiting review', approved: 'Approved', returned: 'Returned' };
export const STATUS_CHIP: Record<VisitStatus | 'overdue', { bg: string; fg: string }> = {
  due: { bg: '#eef3f1', fg: '#2e6f5e' }, overdue: { bg: '#fee2e2', fg: '#b91c1c' },
  submitted: { bg: '#fef3c7', fg: '#92400e' }, approved: { bg: '#dcfce7', fg: '#166534' }, returned: { bg: '#ffedd5', fg: '#9a3412' },
};
export const FREQ_LABEL: Record<BuildingFrequency, string> = { monthly: 'Every month', quarterly: 'Every quarter', off: 'Off' };

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+04:00` : iso);
  return d.toLocaleDateString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Landlord or manager href for a visit. */
export function visitHref(id: number, rp?: number | null, report = false): string {
  const tail = report ? '/report' : '';
  return rp == null ? `/rental-provider/dashboard/building-inspections/${id}${tail}` : `/dashboard/manager/building-inspections/${id}${tail}?rp=${rp}`;
}
export function listHref(rp?: number | null): string {
  return rp == null ? '/rental-provider/dashboard/building-inspections' : `/dashboard/manager/building-inspections?rp=${rp}`;
}
export function settingsHref(rp?: number | null): string {
  return rp == null ? '/rental-provider/dashboard/settings?tab=building_inspections' : `/dashboard/manager/settings?tab=building_inspections&rp=${rp}`;
}
