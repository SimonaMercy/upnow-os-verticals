'use client';

import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface PreferredDayPickerProps {
  value: string;
  onChange: (v: string) => void;
  /** Days of the month (1–28) that are selectable. Empty = all days. */
  preferredDays: number[];
  min?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
}

export function PreferredDayPicker({
  value,
  onChange,
  preferredDays,
  min,
  placeholder = 'Select date',
  className = '',
  inputClassName = '',
}: PreferredDayPickerProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minDate = min ?? today.toISOString().slice(0, 10);
  const minMidnight = new Date(minDate + 'T00:00:00');

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const initYear  = value ? parseInt(value.slice(0, 4)) : today.getFullYear();
  const initMonth = value ? parseInt(value.slice(5, 7)) - 1 : today.getMonth();
  const [year,  setYear]  = useState(initYear);
  const [month, setMonth] = useState(initMonth);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  // No preferred days = plain native date input
  if (!preferredDays.length) {
    return (
      <input
        type="date"
        value={value}
        min={min}
        onChange={e => onChange(e.target.value)}
        className={`w-full text-xs border border-[#bae6fd] rounded-lg px-3 py-2 focus:outline-none focus:border-[#0ea5e9] bg-white text-[#1a1916] ${inputClassName} ${className}`}
      />
    );
  }

  const monthLabel   = new Date(year, month).toLocaleDateString('en-AE', { month: 'long', year: 'numeric' });
  const firstDow     = new Date(year, month, 1).getDay();
  const daysInMonth  = new Date(year, month + 1, 0).getDate();
  const displayValue = value
    ? new Date(value + 'T00:00:00').toLocaleDateString('en-AE', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  function prev() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function next() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }
  function select(day: number) {
    const d = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onChange(d);
    setOpen(false);
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors
          ${value
            ? 'bg-white border-[#2e9f82] text-[#1a1916]'
            : 'bg-white border-[#bae6fd] text-[#9b9890] hover:border-[#0ea5e9]'}
          ${inputClassName}`}
      >
        <span className="flex items-center gap-1.5">
          <Calendar size={12} className={value ? 'text-[#2e9f82]' : 'text-[#9b9890]'} />
          {displayValue || placeholder}
        </span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''} text-[#9b9890] shrink-0`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl border border-[#e8e6e0] shadow-lg z-30 p-3 min-w-[220px]">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prev} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[#f4f3ef] text-[#3d3b35] cursor-pointer">
              <ChevronLeft size={12} />
            </button>
            <span className="text-[11px] font-semibold text-[#1a1916]">{monthLabel}</span>
            <button type="button" onClick={next} className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-[#f4f3ef] text-[#3d3b35] cursor-pointer">
              <ChevronRight size={12} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-center text-[8px] font-semibold text-[#9b9890] py-0.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const isPreferred = preferredDays.includes(day);
              const isPast      = new Date(year, month, day) < minMidnight;
              const dateStr     = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected  = dateStr === value;

              if (!isPreferred) {
                return <div key={day} className="flex items-center justify-center h-7 text-[9px] text-[#e0deda]">{day}</div>;
              }
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isPast}
                  onClick={() => !isPast && select(day)}
                  className={`flex items-center justify-center h-7 rounded-lg text-[10px] font-bold transition-colors
                    ${isSelected
                      ? 'bg-[#2e9f82] text-white cursor-pointer'
                      : isPast
                        ? 'text-[#c8c6c0] cursor-not-allowed'
                        : 'bg-[#e8f5f1] text-[#2e9f82] hover:bg-[#2e9f82] hover:text-white cursor-pointer'}`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <p className="text-[8px] text-[#9b9890] text-center mt-2 leading-tight">
            Only preferred start dates available
          </p>
        </div>
      )}
    </div>
  );
}
