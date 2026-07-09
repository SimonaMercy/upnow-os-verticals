'use client';

/**
 * Single-input date range picker — a trigger showing the selected range that
 * opens a popover with preset shortcuts (Today, Last 7 Days, This Month, …) and
 * a two-month calendar with Apply / Cancel. Styled after daterangepicker.com but
 * built on react-day-picker v9 (already themed brand-green in globals.css), so no
 * jQuery / extra deps. Values are exchanged as 'YYYY-MM-DD' strings ('' = unset).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css';
import {
  format, parseISO, isValid,
  startOfMonth, endOfMonth, startOfYear, endOfYear,
  subDays, subMonths, subYears,
} from 'date-fns';
import { Calendar, X } from 'lucide-react';

const toStr = (d: Date) => format(d, 'yyyy-MM-dd');
const parse = (s: string): Date | undefined => {
  if (!s) return undefined;
  const d = parseISO(s);
  return isValid(d) ? d : undefined;
};
const fmtLabel = (d?: Date) => (d ? format(d, 'MMM d, yyyy') : '');

interface Preset { label: string; range: () => DateRange; }

export interface DateRangePickerProps {
  from: string;                 // 'YYYY-MM-DD' or ''
  to: string;                   // 'YYYY-MM-DD' or ''
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
}

export function DateRangePicker({
  from, to, onChange, placeholder = 'Select date range', className = '',
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo<DateRange | undefined>(() => {
    const f = parse(from); const t = parse(to);
    return f || t ? { from: f, to: t } : undefined;
  }, [from, to]);

  // Seed the draft from the committed value each time the popover opens.
  useEffect(() => { if (open) setDraft(selected); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const presets = useMemo<Preset[]>(() => {
    const today = new Date();
    return [
      { label: 'Today',        range: () => ({ from: today, to: today }) },
      { label: 'Yesterday',    range: () => { const y = subDays(today, 1); return { from: y, to: y }; } },
      { label: 'Last 7 Days',  range: () => ({ from: subDays(today, 6), to: today }) },
      { label: 'Last 30 Days', range: () => ({ from: subDays(today, 29), to: today }) },
      { label: 'This Month',   range: () => ({ from: startOfMonth(today), to: endOfMonth(today) }) },
      { label: 'Last Month',   range: () => { const m = subMonths(today, 1); return { from: startOfMonth(m), to: endOfMonth(m) }; } },
      { label: 'This Year',    range: () => ({ from: startOfYear(today), to: endOfYear(today) }) },
      { label: 'Last Year',    range: () => { const y = subYears(today, 1); return { from: startOfYear(y), to: endOfYear(y) }; } },
    ];
  }, []);

  const sameDay = (a?: Date, b?: Date) => (!a && !b) || (!!a && !!b && toStr(a) === toStr(b));
  const isActivePreset = (p: Preset) => {
    if (!draft?.from) return false;
    const r = p.range();
    return sameDay(r.from, draft.from) && sameDay(r.to, draft.to ?? draft.from);
  };

  const triggerLabel = selected?.from
    ? `${fmtLabel(selected.from)}${selected.to && !sameDay(selected.to, selected.from) ? ` – ${fmtLabel(selected.to)}` : ''}`
    : '';

  const apply = () => {
    const f = draft?.from ? toStr(draft.from) : '';
    const t = draft?.to ? toStr(draft.to) : (draft?.from ? toStr(draft.from) : '');
    onChange(f, t);
    setOpen(false);
  };
  const clear = (e: React.MouseEvent) => { e.stopPropagation(); onChange('', ''); setOpen(false); };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm border border-[#e8e6e0] rounded-lg px-2.5 py-1.5 bg-white hover:border-[#2e9f82] focus:outline-none focus:border-[#2e9f82] cursor-pointer min-w-[220px]">
        <Calendar size={14} className="text-[#6b6860] shrink-0" />
        <span className={triggerLabel ? 'text-[#1a1916]' : 'text-[#9b9890]'}>{triggerLabel || placeholder}</span>
        {triggerLabel && (
          <span onClick={clear} role="button" aria-label="Clear date range"
            className="ml-auto text-[#9b9890] hover:text-[#1a1916]"><X size={13} /></span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 left-0 w-max rounded-xl border border-[#e8e6e0] bg-white shadow-xl p-2 flex flex-col sm:flex-row gap-1"
          style={{ maxWidth: 'calc(100vw - 2rem)' }}>
          {/* Preset shortcuts */}
          <div className="flex sm:flex-col gap-0.5 flex-wrap sm:w-[132px] sm:border-r sm:border-[#f0ede8] sm:pr-1.5 pb-1 sm:pb-0">
            {presets.map(p => (
              <button key={p.label} type="button" onClick={() => setDraft(p.range())}
                className={`text-left text-xs px-2.5 py-1.5 rounded-lg cursor-pointer whitespace-nowrap transition-colors ${
                  isActivePreset(p) ? 'bg-[#d8f2e8] text-[#1a7a5a] font-semibold' : 'text-[#3d3b35] hover:bg-[#f7f6f2]'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {/* Two-month calendar */}
          <div className="px-1 w-max shrink-0">
            <DayPicker
              mode="range"
              numberOfMonths={2}
              defaultMonth={draft?.from ?? selected?.from ?? new Date()}
              selected={draft}
              onSelect={setDraft}
              weekStartsOn={1}
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2 border-t border-[#f0ede8]">
              <span className="text-xs text-[#6b6860]">
                {draft?.from
                  ? `${fmtLabel(draft.from)}${draft.to && !sameDay(draft.to, draft.from) ? ` – ${fmtLabel(draft.to)}` : ''}`
                  : 'Pick a start and end date'}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => setOpen(false)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-[#e8e6e0] text-[#6b6860] hover:bg-[#f7f6f2] cursor-pointer">Cancel</button>
                <button type="button" onClick={apply} disabled={!draft?.from}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#2e9f82] text-white hover:bg-[#267a65] disabled:opacity-50 cursor-pointer">Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
