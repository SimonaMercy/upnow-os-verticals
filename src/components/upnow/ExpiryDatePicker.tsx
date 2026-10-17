'use client';

/**
 * Compact single-date picker for document expiry dates.
 *
 * A native <input type="date"> makes these painful: an Emirates ID or trade
 * licence expires years out, and the native picker only walks month by month.
 * This one is built on react-day-picker v9 (already themed brand-green in
 * globals.css, same as DateRangePicker) with month + year DROPDOWNS, so any year
 * in range is one click away.
 *
 * Values are exchanged as 'YYYY-MM-DD' strings; '' means no expiry recorded.
 * Nothing is selected by default — a blank value opens on today's month with no
 * day highlighted, so the calendar never suggests a date the RP didn't choose.
 */

import { useEffect, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { format, parseISO, isValid } from 'date-fns';
import { CalendarClock, X } from 'lucide-react';

const parse = (s: string): Date | undefined => {
  if (!s) return undefined;
  const d = parseISO(s);
  return isValid(d) ? d : undefined;
};

export interface ExpiryDatePickerProps {
  value: string;                       // 'YYYY-MM-DD' or ''
  onChange: (value: string) => void;   // '' when cleared
  label?: string;                      // accessible name, e.g. "Passport expiry date"
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ExpiryDatePicker({
  value, onChange, label = 'Expiry date', placeholder = 'DD-MM-YYYY', disabled, className = '',
}: ExpiryDatePickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = parse(value);

  // Documents expire forward, but a copy already on file can be past its date —
  // both directions stay reachable from the year dropdown.
  const thisYear = new Date().getFullYear();
  const startMonth = new Date(thisYear - 15, 0);
  const endMonth = new Date(thisYear + 25, 11);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={wrapRef} className={`exp-pick ${className}`}>
      <button
        type="button" className="exp-trigger" disabled={disabled}
        aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <CalendarClock size={13} />
        <span className={selected ? 'exp-val' : 'exp-ph'}>{selected ? format(selected, 'dd-MM-yyyy') : placeholder}</span>
      </button>
      {/* Clearing is its own control — picking a day should never be the only
          way out of a date typed by mistake. */}
      {selected && !disabled && (
        <button type="button" className="exp-clear" aria-label={`Clear ${label}`}
          onClick={() => onChange('')}><X size={11} /></button>
      )}
      {open && (
        <div className="exp-pop" role="dialog" aria-label={label}>
          <DayPicker
            mode="single"
            required={false}
            selected={selected}
            defaultMonth={selected ?? new Date()}
            captionLayout="dropdown"
            startMonth={startMonth}
            endMonth={endMonth}
            onSelect={d => { onChange(d ? format(d, 'yyyy-MM-dd') : ''); setOpen(false); }}
          />
        </div>
      )}
      <style jsx>{`
        .exp-pick { position: relative; display: inline-flex; align-items: center; gap: 2px; }
        .exp-trigger {
          display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
          font-family: inherit; font-size: 12px; font-weight: 800;
          padding: 5px 9px; border-radius: 8px;
          border: 1px solid #cfcbc2; background: #fff; color: #14201a;
        }
        .exp-trigger:hover:not(:disabled) { border-color: #047246; }
        .exp-trigger:disabled { opacity: .55; cursor: not-allowed; }
        .exp-ph { color: #8a877f; font-weight: 700; }
        .exp-clear {
          display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
          width: 18px; height: 18px; border-radius: 6px; border: 0; background: transparent; color: #8a948d;
        }
        .exp-clear:hover { background: #eef1ef; color: #b91c1c; }
        .exp-pop {
          position: absolute; top: calc(100% + 6px); right: 0; z-index: 60;
          background: #fff; border: 1px solid #e4e9e5; border-radius: 12px;
          box-shadow: 0 12px 32px rgba(26,25,22,.16); padding: 6px;
        }
      `}</style>
    </div>
  );
}
