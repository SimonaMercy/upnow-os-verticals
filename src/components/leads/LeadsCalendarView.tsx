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
import { STAGE_LABELS, STAGE_PILL, type LeadStage } from '@/lib/leadJourney';

interface ApiViewing {
  id: number;
  scheduledAt: string;
  status: string;
  desiredMoveIn?: string | null;
  notes?: string | null;
}

interface ApiLead {
  id: number;
  stage: LeadStage;
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
  stage: LeadStage;
  notes: string | null;
  lead: ApiLead;
}

interface Props {
  leads: ApiLead[];
  onOpenLead?: (leadId: number) => void;
}

/** Saturated dot colour per lead stage — hue-matched to the STAGE_PILL used in
 *  Row/Grid, but a solid fill so the tiny day-cell dots stay legible. */
const STAGE_DOT: Record<LeadStage, string> = {
  new:                  'bg-[#1e40af]',
  contacted:            'bg-[#6d28d9]',
  viewing_scheduled:    'bg-[#b45309]',
  offer_made:           'bg-[#1a7a5a]',
  applied:              'bg-[#9d174d]',
  approved:             'bg-[#065f46]',
  documents_collection: 'bg-[#c2410c]',
  payment_plan_shared:  'bg-[#0369a1]',
  interested:           'bg-[#1f5a3f]',
  cheques_submitted:    'bg-[#854d0e]',
  cheques_collected:    'bg-[#1a7a5a]',
  contract_issued:      'bg-[#065f46]',
  rejected:             'bg-[#b91c1c]',
  converted:            'bg-[#0369a1]',
};

export function LeadsCalendarView({ leads, onOpenLead }: Props) {
  const [cursor, setCursor]                 = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay]       = useState<Date>(() => new Date());

  // Flatten viewings out of the (already stage-filtered) leads. Each appointment
  // is coloured/labelled by its LEAD's pipeline stage — same taxonomy as Row/Grid.
  const allViewings: FlatViewing[] = useMemo(() => {
    const flat: FlatViewing[] = [];
    for (const lead of leads) {
      for (const v of lead.viewings ?? []) {
        flat.push({
          viewingId: v.id,
          scheduledAt: new Date(v.scheduledAt),
          stage: lead.stage,
          notes: v.notes ?? null,
          lead,
        });
      }
    }
    return flat.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  }, [leads]);

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 mt-2">

      {/* ─── Month grid ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#ede9e3] p-4 sm:p-5">

        {/* Header — month nav + view toggles */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCursor(c => addMonths(c, -1))}
              className="w-8 h-8 rounded-lg border border-[#e4e9e5] hover:bg-[#eef1ef] flex items-center justify-center text-[#46534c] cursor-pointer"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setCursor(c => addMonths(c, 1))}
              className="w-8 h-8 rounded-lg border border-[#e4e9e5] hover:bg-[#eef1ef] flex items-center justify-center text-[#46534c] cursor-pointer"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
            <h2 className="text-lg font-semibold text-[#14201a] ml-1">
              {format(cursor, 'MMMM yyyy')}
            </h2>
          </div>
          <button
            onClick={() => { const t = new Date(); setCursor(startOfMonth(t)); setSelectedDay(t); }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-[#e4e9e5] text-[#46534c] hover:bg-[#eef1ef] cursor-pointer"
          >
            Today
          </button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1 mb-1">
          {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
            <div key={d} className="text-[10px] font-semibold uppercase tracking-wider text-[#8a948d] text-center py-1">
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
                    ? 'bg-[#14201a] text-white ring-2 ring-offset-1 ring-[#14201a]'
                    : today
                      ? 'bg-[#d8efe3] text-[#1f5a3f] hover:bg-[#c4ebdb]'
                      : inMonth
                        ? 'bg-white text-[#14201a] hover:bg-[#eef1ef]'
                        : 'bg-[#f6f8f6] text-[#c8c6c0] hover:bg-[#eef1ef]'
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
                          className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT[v.stage]}`}
                          title={`${format(v.scheduledAt, 'HH:mm')} — ${v.lead.customerName} · ${STAGE_LABELS[v.stage]}`}
                        />
                      ))}
                      {dayViews.length > 5 && (
                        <span className={`text-[9px] font-bold leading-none ${selected ? 'text-white/80' : 'text-[#8a948d]'}`}>
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
          <h3 className="text-base font-semibold text-[#14201a]">
            {format(selectedDay, 'EEEE, d MMMM')}
          </h3>
          {isToday(selectedDay) && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#047246]">Today</span>
          )}
        </div>
        <p className="text-xs text-[#8a948d] mb-4">
          {selectedViewings.length === 0
            ? 'No viewings'
            : `${selectedViewings.length} viewing${selectedViewings.length === 1 ? '' : 's'}`}
        </p>

        {selectedViewings.length === 0 ? (
          <div className="flex flex-col items-center text-center py-8">
            <div className="w-10 h-10 rounded-full bg-[#eef1ef] flex items-center justify-center mb-2">
              <CalendarDays size={18} className="text-[#c8c6c0]" />
            </div>
            <p className="text-xs text-[#8a948d]">Nothing scheduled this day.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedViewings.map(v => {
              return (
                <div
                  key={v.viewingId}
                  className="border border-[#ede9e3] rounded-xl p-3 hover:border-[#d4d0c8] transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-[#14201a] text-sm font-semibold">
                      <Clock size={13} className="text-[#8a948d]" />
                      {format(v.scheduledAt, 'HH:mm')}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STAGE_PILL[v.stage]}`}>
                      {STAGE_LABELS[v.stage]}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-sm text-[#14201a] mb-1">
                    <User size={12} className="text-[#8a948d]" />
                    <span className="font-medium truncate">{v.lead.customerName}</span>
                  </div>

                  {v.lead.unit && (
                    <div className="flex items-center gap-1.5 text-xs text-[#5f6b63] mb-1">
                      <MapPin size={11} className="text-[#8a948d] shrink-0" />
                      <span className="truncate">
                        {v.lead.unit.property?.buildingName ?? '—'}
                        {v.lead.unit.unitNumber ? ` · ${v.lead.unit.unitNumber}` : ''}
                      </span>
                    </div>
                  )}

                  {v.lead.leadPhone && (
                    <div className="flex items-center gap-1.5 text-xs text-[#5f6b63] mb-2">
                      <Phone size={11} className="text-[#8a948d] shrink-0" />
                      <a href={`tel:${v.lead.leadPhone}`} className="hover:text-[#047246] truncate">
                        {v.lead.leadPhone}
                      </a>
                    </div>
                  )}

                  {v.notes && (
                    <p className="text-[11px] text-[#5f6b63] bg-[#f6f8f6] rounded-md p-2 mb-2 leading-relaxed">
                      {v.notes}
                    </p>
                  )}

                  {onOpenLead && (
                    <button
                      onClick={() => onOpenLead(v.lead.id)}
                      className="w-full text-xs text-[#047246] font-medium border border-[#047246] rounded-lg py-1.5 hover:bg-[#f0fdf4] flex items-center justify-center gap-1.5 cursor-pointer"
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
