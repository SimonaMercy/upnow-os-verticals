'use client';

import { useEffect, useState } from 'react';

/**
 * Where each building's inspection stands — for the chip on top of every
 * property card (owner, 7 Oct 2026: "Inspection on top of properties") and the
 * Property View. Read from the Building inspections module: the building's open
 * visit (due / returned), else its latest one; no visit and no schedule = not set.
 * A manager without the Inspections permission for a landlord gets nothing for
 * that landlord's buildings (the API refuses) — the chip is simply absent.
 */
export interface InspectionVisit {
  id: number; propertyId: number; periodLabel: string; dueDate: string;
  status: 'due' | 'submitted' | 'approved' | 'returned'; overdue: boolean;
  inspectorName: string | null; submittedAt?: string | null; reviewedAt?: string | null;
}
export interface InspectionSchedule { propertyId: number; frequency: 'monthly' | 'quarterly' | 'off' }

export type InspectionTone = 'green' | 'orange' | 'red' | 'grey';
export interface InspectionStatus {
  state: 'due' | 'overdue' | 'submitted' | 'approved' | 'returned' | 'unscheduled';
  /** Short, for a chip: "Due 31 Oct", "Overdue", "Awaiting review", "Approved", "Returned", "Not set". */
  label: string;
  /** Fuller, for a line: "Oct 2026 · by 31 Oct 2026 · Maria". */
  detail: string;
  tone: InspectionTone;
  visit: InspectionVisit | null;
}

export const INSPECTION_TONE: Record<InspectionTone, { dot: string; fg: string; bg: string }> = {
  green:  { dot: '#1a7a5a', fg: '#14532d', bg: '#eef7f2' },
  orange: { dot: '#b45309', fg: '#7c3e0a', bg: '#fff4e5' },
  red:    { dot: '#b91c1c', fg: '#7f1d1d', bg: '#fee2e2' },
  grey:   { dot: '#9aa39c', fg: '#5a635c', bg: '#f1f3f0' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const dmyShort = (d: string | null | undefined) => {
  if (!d) return '';
  const [, m, dd] = String(d).slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1]}`;
};
export const dmyFull = (d: string | null | undefined) => {
  if (!d) return '';
  const [y, m, dd] = String(d).slice(0, 10).split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/** One building's position from the visits and schedules lists. Null = no schedule row at all AND no visit → "not set". */
export function inspectionOf(visits: InspectionVisit[], schedules: InspectionSchedule[], propertyId: number): InspectionStatus {
  const mine = visits.filter((v) => v.propertyId === propertyId);
  const open = mine.filter((v) => v.status === 'due' || v.status === 'returned').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const v = open[0] ?? [...mine].sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0] ?? null;
  if (!v) {
    return { state: 'unscheduled', label: 'Not set', detail: 'No inspection schedule for this building', tone: 'grey', visit: null };
  }
  const who = v.inspectorName ? ` · ${v.inspectorName}` : '';
  if (v.status === 'approved') return { state: 'approved', label: 'Approved', detail: `${v.periodLabel}${v.reviewedAt ? ` · on ${dmyFull(v.reviewedAt)}` : ''}${who}`, tone: 'green', visit: v };
  if (v.status === 'submitted') return { state: 'submitted', label: 'Awaiting review', detail: `${v.periodLabel}${v.submittedAt ? ` · submitted ${dmyFull(v.submittedAt)}` : ''}${who}`, tone: 'orange', visit: v };
  if (v.overdue) return { state: 'overdue', label: `Overdue ${dmyShort(v.dueDate)}`, detail: `${v.periodLabel} · was due ${dmyFull(v.dueDate)}${who}`, tone: 'red', visit: v };
  if (v.status === 'returned') return { state: 'returned', label: 'Returned', detail: `${v.periodLabel} · redo by ${dmyFull(v.dueDate)}${who}`, tone: 'red', visit: v };
  return { state: 'due', label: `Due ${dmyShort(v.dueDate)}`, detail: `${v.periodLabel} · by ${dmyFull(v.dueDate)}${who}`, tone: 'orange', visit: v };
}

export function inspectionHref(visitId: number, rp?: number | null): string {
  return rp != null ? `/dashboard/manager/building-inspections/${visitId}?rp=${rp}` : `/rental-provider/dashboard/building-inspections/${visitId}`;
}

/**
 * Inspection status for every building of the given landlords (null = the
 * landlord's own). Returns propertyId → status; a landlord the caller may not
 * read is left out (no chip), so the map is empty until something loads.
 */
export function useInspectionStatus(rpIds: Array<number> | null): Map<number, InspectionStatus & { rp: number | null }> {
  const key = rpIds ? [...new Set(rpIds)].sort((a, b) => a - b).join(',') : 'own';
  const [map, setMap] = useState<Map<number, InspectionStatus & { rp: number | null }>>(new Map());
  useEffect(() => {
    let on = true;
    const get = async <T,>(path: string): Promise<T | null> => {
      try { const r = await fetch(`/api${path}`, { credentials: 'include' }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
    };
    const scopes: Array<number | null> = key === 'own' ? [null] : key ? key.split(',').map(Number) : [];
    void (async () => {
      const next = new Map<number, InspectionStatus & { rp: number | null }>();
      await Promise.all(scopes.map(async (rp) => {
        const q = rp != null ? `rp=${rp}` : '';
        const [visits, schedules] = await Promise.all([
          get<InspectionVisit[]>(`/building-inspections/visits?status=all${q ? `&${q}` : ''}`),
          get<InspectionSchedule[]>(`/building-inspections/schedules${q ? `?${q}` : ''}`),
        ]);
        if (!visits || !schedules) return; // not allowed for this landlord → no chips
        const ids = new Set<number>([...visits.map((v) => v.propertyId), ...schedules.map((s) => s.propertyId)]);
        for (const id of ids) next.set(id, { ...inspectionOf(visits, schedules, id), rp });
        // Buildings with neither a visit nor a schedule are "not set" — the caller asks per property via `unscheduled`.
        next.set(-(rp ?? 0) - 1, { state: 'unscheduled', label: 'Not set', detail: '', tone: 'grey', visit: null, rp }); // marker: this landlord loaded
      }));
      if (on) setMap(next);
    })();
    return () => { on = false; };
  }, [key]);
  return map;
}

/** The chip for one property: its status, or "Not set" once its landlord's lists have loaded, or null (not loaded / not allowed). */
export function inspectionFor(map: Map<number, InspectionStatus & { rp: number | null }>, propertyId: number, rp: number | null): (InspectionStatus & { rp: number | null }) | null {
  const hit = map.get(propertyId);
  if (hit) return hit;
  const loaded = map.get(-(rp ?? 0) - 1);
  return loaded ? { state: 'unscheduled', label: 'Not set', detail: 'No inspection schedule for this building', tone: 'grey', visit: null, rp } : null;
}
