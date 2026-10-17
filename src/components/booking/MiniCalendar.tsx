'use client';

/**
 * MiniCalendar + time slots — the date/time controls from the PUBLIC listing
 * booking modals ("Book a Viewing" / "Book Now").
 *
 * Extracted here so the landlord-side "Add lead" form asks for a date exactly
 * the way the customer's own booking page does: one tap on a calendar, one tap
 * on a time — not a stack of typed fields. Any change to how a booking date is
 * picked now lands on both surfaces at once.
 */

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** Nearest upcoming date (today or later) whose day-of-month is allowed.
 *  '' when there is no restriction (so no preselection). */
export function nextAllowedDate(allowedDays?: number[]): string {
  if (!Array.isArray(allowedDays) || allowedDays.length === 0) return '';
  const d = new Date(); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 366; i++) {
    if (allowedDays.includes(d.getDate())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    d.setDate(d.getDate() + 1);
  }
  return '';
}

/** Bookable hours offered on the public listing page. */
export const TIME_SLOTS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];

export function fmtSlot(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:${m === 0 ? '00' : m} ${suffix}`;
}

export function MiniCalendar({ value, onChange, allowedDays, compact }: {
  value: string;
  onChange: (v: string) => void;
  /** Restrict selectable days-of-month (the RP's preferred contract-start days). */
  allowedDays?: number[];
  compact?: boolean;
}) {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const selected = value ? new Date(value + 'T00:00:00') : null;

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();

  function prevMonth() {
    setCursor(c => {
      const m = c.month === 0 ? 11 : c.month - 1;
      const y = c.month === 0 ? c.year - 1 : c.year;
      return { year: y, month: m };
    });
  }
  function nextMonth() {
    setCursor(c => {
      const m = c.month === 11 ? 0 : c.month + 1;
      const y = c.month === 11 ? c.year + 1 : c.year;
      return { year: y, month: m };
    });
  }

  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div data-testid="mini-calendar" className="rounded-2xl border border-[#e4e9e5] overflow-hidden" style={compact ? { maxWidth: 300 } : undefined}>
      {/* Header */}
      <div className={`flex items-center justify-between ${compact ? 'px-3 py-1.5' : 'px-4 py-3'}`} style={{ backgroundColor: '#f9f8f6' }}>
        <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[#e4e9e5] transition-colors cursor-pointer">
          <ChevronLeft size={compact ? 14 : 16} style={{ color: '#5f6b63' }} />
        </button>
        <span className={`${compact ? 'text-[13px]' : 'text-sm'} font-semibold`} style={{ color: '#14201a' }}>
          {MONTHS[cursor.month]} {cursor.year}
        </span>
        <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[#e4e9e5] transition-colors cursor-pointer">
          <ChevronRight size={compact ? 14 : 16} style={{ color: '#5f6b63' }} />
        </button>
      </div>
      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-[#e4e9e5]">
        {DAYS.map(d => (
          <div key={d} className={`text-center font-medium ${compact ? 'text-[10px] py-1' : 'text-xs py-2'}`} style={{ color: '#8a948d' }}>{d}</div>
        ))}
      </div>
      {/* Cells */}
      <div className={`grid grid-cols-7 ${compact ? 'p-1.5 gap-y-0.5' : 'p-2 gap-y-1'}`}>
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cellDate = new Date(cursor.year, cursor.month, day);
          const isPast = cellDate < todayDate;
          // When the RP restricts contract-start days, disable any other day-of-month.
          const dayBlocked = Array.isArray(allowedDays) && allowedDays.length > 0 && !allowedDays.includes(day);
          const isDisabled = isPast || dayBlocked;
          const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const isSelected = selected
            ? selected.getFullYear() === cursor.year && selected.getMonth() === cursor.month && selected.getDate() === day
            : false;
          const isToday = cellDate.getTime() === todayDate.getTime();
          return (
            <button
              key={i}
              type="button"
              disabled={isDisabled}
              onClick={() => !isDisabled && onChange(iso)}
              className={`rounded-lg w-full text-center transition-all cursor-pointer ${compact ? 'text-[11px] py-1' : 'text-xs py-1.5'}`}
              style={{
                backgroundColor: isSelected ? '#047246' : isToday && !isSelected && !isDisabled ? '#edf7f3' : 'transparent',
                color: isSelected ? '#fff' : isDisabled ? '#c8c6c0' : '#14201a',
                fontWeight: isSelected ? 600 : isToday && !isDisabled ? 600 : 400,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
