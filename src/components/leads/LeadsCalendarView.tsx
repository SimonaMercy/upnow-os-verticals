'use client';

/**
 * LeadsCalendarView — month-grid calendar of viewings + selected-day agenda.
 *
 * Flattens viewings out of the leads array, paints status-coloured dots on the
 * month grid, and shows a side panel with the full viewing list for the
 * focused day. Status filter chips toggle visibility per state.
 *
 * Pure presentation: no fetches, no mutations — the parent owns leads state.
 */

import { useMemo, useState } from 'react';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  Phone,
  MapPin,
  User,
  ExternalLink,
} from 'lucide-react';

type ViewingStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';

interface ApiViewing {
  id: number;
  scheduledAt: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
}

interface ApiLead {
  id: number;
  customerName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  viewings?: ApiViewing[];
  unit: {
    id: number;
    unitNumber: string;
    unitName: string | null;
    property?: { id: number; buildingName: string };
  } | null;
}

interface FlatViewing {
  viewingId: number;
  scheduledAt: Date;
  status: ViewingStatus;
  notes: string | null;
  lead: ApiLead;
}

interface Props {
  leads: ApiLead[];
  onOpenLead?: (leadId: number) => void;
}

const STATUS_META: Record<ViewingStatus, { label: string; dot: string; chip: string; ring: string }> = {
  scheduled: {
    label: 'Scheduled',
    dot: 'bg-[#3b82f6]',
    chip: 'bg-[#dbeafe] text-[#1e40af] border-[#bfdbfe]',
    ring: 'ring-[#3b82f6]',
  },
  confirmed: {
    label: 'Confirmed',
    dot: 'bg-[#10b981]',
    chip: 'bg-[#d1fae5] text-[#065f46] border-[#a7f3d0]',
    ring: 'ring-[#10b981]',
  },
  completed: {
    label: 'Completed',
    dot: 'bg-[#64748b]',
    chip: 'bg-[#e2e8f0] text-[#334155] border-[#cbd5e1]',
    ring: 'ring-[#64748b]',
  },
  no_show: {
    label: 'No-show',
    dot: 'bg-[#ef4444]',
    chip: 'bg-[#fee2e2] text-[#991b1b] border-[#fecaca]',
    ring: 'ring-[#ef4444]',
  },
  cancelled: {
    label: 'Cancelled',
    dot: 'bg-[#9ca3af]',
    chip: 'bg-[#f3f4f6] text-[#4b5563] border-[#e5e7eb]',
    ring: 'ring-[#9ca3af]',
  },
};

const ALL_STATUSES: ViewingStatus[] = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'];

function normaliseStatus(raw: string): ViewingStatus {
  const s = raw.toLowerCase();
  if (s === 'scheduled' || s === 'confirmed' || s === 'completed' || s === 'no_show' || s === 'cancelled') return s;
  return 'scheduled';
}

export function LeadsCalendarView({ leads, onOpenLead }: Props) {
  const [cursor, setCursor]                 = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay]       = useState<Date>(() => new Date());
  const [statusFilter, setStatusFilter]     = useState<Set<ViewingStatus>>(() => new Set(ALL_STATUSES));

  // Flatten viewings out of leads + apply status filter
  const allViewings: FlatViewing[] = useMemo(() => {
    const flat: FlatViewing[] = [];
    for (const lead of leads) {
      for (const v of lead.viewings ?? []) {
        const status = normaliseStatus(v.status);
        if (!statusFilter.has(status)) continue;
        flat.push({
          viewingId: v.id,
          scheduledAt: new Date(v.scheduledAt),
          status,
          notes: v.notes ?? null,
          lead,
        });
      }
    }
    return flat.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }, [leads, statusFilter]);

  // Group viewings by day (ISO date key)
  const byDay: Map<string, FlatViewing[]> = useMemo(() => {
    const map = new Map<string, FlatViewing[]>();
    for (const v of allViewings) {
      const key = format(v.scheduledAt, 'yyyy-MM-dd');
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    return map;
  }, [allViewings]);

  // Build the visible 6-week grid
  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end   = endOfWeek(endOfMonth(cursor),   { weekStartsOn: 1 });
    const days: Date[] = [];
    const cur = new Date(start);
    while (cur <= end) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    return days;
  }, [cursor]);

  const selectedDayKey   = format(selectedDay, 'yyyy-MM-dd');
  const selectedViewings = byDay.get(selectedDayKey) ?? [];
  const confirmedCount   = selectedViewings.filter(v => v.status === 'confirmed').length;

  function toggleStatus(s: ViewingStatus) {
    setStatusFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 mt-2">

      {/* ─── Month grid ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#ede9e3] p-4 sm:p-5">

        {/* Header — month nav + view toggles */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCursor(c => addMonths(c, -1))}
              className="w-8 h-8 rounded-lg border border-[#e8e6e0] hover:bg-[#f4f3ef] flex items-center justify-center text-[#3d3b35] cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setCursor(c => addMonths(c, 1))}
              className="w-8 h-8 rounded-lg border border-[#e8e6e0] hover:bg-[#f4f3ef] flex items-center justify-center text-[#3d3b35] cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
            <h2 className="text-lg font-semibold text-[#1a1916] ml-1">
              {format(cursor, 'MMMM yyyy')}
            </h2>
          </div>
          <button
            onClick={() => { const t = new Date(); setCursor(startOfMonth(t)); setSelectedDay(t); }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#3d3b35] hover:bg-[#f4f3ef] cursor-pointer"
          >
            Today
          </button>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {ALL_STATUSES.map(s => {
            const meta = STATUS_META[s];
            const on   = statusFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
                  on ? meta.chip : 'bg-white text-[#9b9890] border-[#e8e6e0] hover:bg-[#f4f3ef]'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${on ? meta.dot : 'bg-[#c8c6c0]'}`} />
                {meta.label}
              </button>
            );
          })}
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
            <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-[#9b9890] text-center py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1">
          {gridDays.map(day => {
            const key       = format(day, 'yyyy-MM-dd');
            const inMonth   = isSameMonth(day, cursor);
            const today     = isToday(day);
            const selected  = isSameDay(day, selectedDay);
            const dayViews  = byDay.get(key) ?? [];

            return (
              <button
                key={key}
                onClick={() => setSelectedDay(day)}
                className={`aspect-square rounded-lg p-1.5 flex flex-col items-stretch text-left transition-all cursor-pointer ${
                  selected
                    ? 'bg-[#1a1916] text-white ring-2 ring-offset-1 ring-[#1a1916]'
                    : today
                      ? 'bg-[#d8f2e8] text-[#1f5a3f] hover:bg-[#c4ebdb]'
                      : inMonth
                        ? 'bg-white text-[#1a1916] hover:bg-[#f4f3ef]'
                        : 'bg-[#fafaf8] text-[#c8c6c0] hover:bg-[#f4f3ef]'
                }`}
              >
                <div className={`text-[11px] font-semibold ${selected ? 'text-white' : ''}`}>
                  {format(day, 'd')}
                </div>
                {dayViews.length > 0 && (
                  <div className="flex-1 flex flex-col justify-end gap-0.5">
                    <div className="flex flex-wrap gap-0.5">
                      {dayViews.slice(0, 5).map(v => (
                        <span
                          key={v.viewingId}
                          className={`w-1.5 h-1.5 rounded-full ${STATUS_META[v.status].dot}`}
                          title={`${format(v.scheduledAt, 'HH:mm')} — ${v.lead.customerName}`}
                        />
                      ))}
                      {dayViews.length > 5 && (
                        <span className={`text-[9px] font-bold leading-none ${selected ? 'text-white/80' : 'text-[#9b9890]'}`}>
                          +{dayViews.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Day agenda panel ─────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#ede9e3] p-4 sm:p-5 self-start">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="text-base font-semibold text-[#1a1916]">
            {format(selectedDay, 'EEEE, d MMMM')}
          </h3>
          {isToday(selectedDay) && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#2e9f82]">Today</span>
          )}
        </div>
        <p className="text-xs text-[#9b9890] mb-4">
          {selectedViewings.length === 0
            ? 'No viewings'
            : `${selectedViewings.length} viewing${selectedViewings.length === 1 ? '' : 's'}${confirmedCount ? ` · ${confirmedCount} confirmed` : ''}`}
        </p>

        {selectedViewings.length === 0 ? (
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-10 h-10 rounded-full bg-[#f4f3ef] flex items-center justify-center mb-2">
              <CalendarDays size={18} className="text-[#c8c6c0]" />
            </div>
            <p className="text-xs text-[#9b9890]">Nothing scheduled this day.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedViewings.map(v => {
              const meta = STATUS_META[v.status];
              return (
                <div
                  key={v.viewingId}
                  className="border border-[#ede9e3] rounded-xl p-3 hover:border-[#d4d0c8] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-[#1a1916] text-sm font-semibold">
                      <Clock size={13} className="text-[#9b9890]" />
                      {format(v.scheduledAt, 'HH:mm')}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${meta.chip}`}>
                      {meta.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-sm text-[#1a1916] mb-1">
                    <User size={12} className="text-[#9b9890]" />
                    <span className="font-medium truncate">{v.lead.customerName}</span>
                  </div>

                  {v.lead.unit && (
                    <div className="flex items-center gap-1.5 text-xs text-[#6b6860] mb-1">
                      <MapPin size={11} className="text-[#9b9890] shrink-0" />
                      <span className="truncate">
                        {v.lead.unit.property?.buildingName ?? '—'}
                        {v.lead.unit.unitNumber ? ` · ${v.lead.unit.unitNumber}` : ''}
                      </span>
                    </div>
                  )}

                  {v.lead.leadPhone && (
                    <div className="flex items-center gap-1.5 text-xs text-[#6b6860] mb-2">
                      <Phone size={11} className="text-[#9b9890] shrink-0" />
                      <a href={`tel:${v.lead.leadPhone}`} className="hover:text-[#2e9f82] truncate">
                        {v.lead.leadPhone}
                      </a>
                    </div>
                  )}

                  {v.notes && (
                    <p className="text-[11px] text-[#6b6860] bg-[#fafaf8] rounded-md p-2 mb-2 leading-relaxed">
                      {v.notes}
                    </p>
                  )}

                  {onOpenLead && (
                    <button
                      onClick={() => onOpenLead(v.lead.id)}
                      className="w-full text-xs text-[#2e9f82] font-medium border border-[#2e9f82] rounded-lg py-1.5 hover:bg-[#f0fdf4] flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      Open lead <ExternalLink size={11} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
