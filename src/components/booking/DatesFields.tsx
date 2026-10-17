'use client';

/**
 * Controlled dates / slot / guests editor for the PREVIEW booking engine — one set of fields per
 * model (stay: check-in / check-out; venue: date, start, hours, layout; court: date, start,
 * duration, court; yacht: date, departure, hours). Used by the provider drawer (confirm a lead,
 * offer, counter-offer, change dates) and the customer booking page (request new dates).
 * Style-neutral: the caller passes its own input / label classes. Times are Asia/Dubai.
 */
import { DAY_MS, HOUR_MS, MIN_MS, ms } from '@/lib/os/bookings/engine';
import type { Booking, PreviewListing, VenueLayout } from '@/lib/os/bookings/types';
import { addDays, dubaiDateStr, dubaiInstant, hm, timeOptions } from './format';

export interface DatesValue { start: string; end: string; guests: number; details: Booking['details'] }
export interface DatesCls { input: string; label: string; row?: string; field?: string }

const LAYOUT_LABEL: Record<VenueLayout, string> = { standing: 'Standing', theatre: 'Theatre', banquet: 'Banquet', classroom: 'Classroom', boardroom: 'Boardroom' };
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: number) => { const d = new Date(t + 4 * HOUR_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const safe = (t: number) => (Number.isFinite(t) ? new Date(t).toISOString() : '');

/** Sensible starting values: the booking's own dates, or (open-dates enquiry) a week from now. */
export function defaultDates(l: PreviewListing, b: Pick<Booking, 'start' | 'end' | 'guests' | 'details'>, now: number): DatesValue {
  if (Number.isFinite(ms(b.start)) && Number.isFinite(ms(b.end))) return { start: b.start, end: b.end, guests: b.guests, details: { ...b.details } };
  const day = dubaiDateStr(now + 7 * DAY_MS);
  switch (l.model) {
    case 'shortstay': {
      const [ih, im] = hm(l.checkInTime);
      const [oh, om] = hm(l.checkOutTime);
      return { start: safe(dubaiInstant(day, ih, im)), end: safe(dubaiInstant(addDays(day, Math.max(l.minNights, 2)), oh, om)), guests: Math.min(b.guests, l.maxGuests), details: { ...b.details } };
    }
    case 'venue': {
      const s = dubaiInstant(day, 19);
      return { start: safe(s), end: safe(s + Math.max(l.minHours, 4) * HOUR_MS), guests: b.guests, details: { ...b.details, layout: b.details.layout ?? (Object.keys(l.capacity)[0] as VenueLayout) } };
    }
    case 'court': {
      const s = dubaiInstant(day, Math.max(l.openHour, 18) >= l.closeHour ? l.openHour : 18);
      return { start: safe(s), end: safe(s + l.durations[0] * MIN_MS), guests: Math.min(b.guests, l.maxPlayers), details: { ...b.details, courtId: b.details.courtId ?? l.courts[0].id, players: Math.min(b.guests, l.maxPlayers) } };
    }
    case 'charter': {
      const s = dubaiInstant(day, 16);
      return { start: safe(s), end: safe(s + l.minHours * HOUR_MS), guests: Math.min(b.guests, l.capacity), details: { ...b.details } };
    }
  }
}

export function DatesFields({ listing: l, value, onChange, idPrefix, cls, now }: {
  listing: PreviewListing; value: DatesValue; onChange: (v: DatesValue) => void; idPrefix: string; cls: DatesCls; now: number;
}) {
  const s = ms(value.start);
  const e = ms(value.end);
  const date = Number.isFinite(s) ? dubaiDateStr(s) : dubaiDateStr(now);
  const time = Number.isFinite(s) ? hhmm(s) : '19:00';
  const today = dubaiDateStr(now);
  const set = (patch: Partial<DatesValue>) => onChange({ ...value, ...patch, details: { ...value.details, ...(patch.details ?? {}) } });
  const field = (id: string, label: string, input: React.ReactNode) => (
    <div className={cls.field} style={cls.field ? undefined : { display: 'grid', gap: 4, minWidth: 0 }}>
      <label className={cls.label} htmlFor={`${idPrefix}-${id}`}>{label}</label>
      {input}
    </div>
  );
  const row = (children: React.ReactNode) => (
    <div className={cls.row} style={cls.row ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>{children}</div>
  );
  const guests = (max: number, label = 'Guests') => field('guests', `${label} (max ${max})`, (
    <input id={`${idPrefix}-guests`} type="number" min={1} max={max} className={cls.input} value={value.guests}
      onChange={(ev) => { const g = Math.max(1, Math.floor(Number(ev.target.value) || 1)); set({ guests: g, details: l.model === 'court' ? { players: g } : {} }); }} />
  ));

  switch (l.model) {
    case 'shortstay': {
      const [ih, im] = hm(l.checkInTime);
      const [oh, om] = hm(l.checkOutTime);
      const out = Number.isFinite(e) ? dubaiDateStr(e) : addDays(date, l.minNights);
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {row(<>
            {field('in', 'Check-in', <input id={`${idPrefix}-in`} type="date" className={cls.input} min={today} value={date}
              onChange={(ev) => {
                const v = ev.target.value;
                const ns = dubaiInstant(v, ih, im);
                const keepOut = out > v ? out : addDays(v, l.minNights);
                set({ start: safe(ns), end: safe(dubaiInstant(keepOut, oh, om)) });
              }} />)}
            {field('out', 'Check-out', <input id={`${idPrefix}-out`} type="date" className={cls.input} min={addDays(date, 1)} value={out}
              onChange={(ev) => set({ end: safe(dubaiInstant(ev.target.value, oh, om)) })} />)}
            {guests(l.maxGuests)}
          </>)}
        </div>
      );
    }
    case 'venue': {
      const hours = Number.isFinite(e) && Number.isFinite(s) ? Math.round((e - s) / HOUR_MS) : Math.max(l.minHours, 4);
      const layouts = Object.keys(l.capacity) as VenueLayout[];
      const at = (d: string, t: string, h: number) => { const ns = dubaiInstant(d, ...hm(t)); return { start: safe(ns), end: safe(ns + h * HOUR_MS) }; };
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {row(<>
            {field('date', 'Event date', <input id={`${idPrefix}-date`} type="date" className={cls.input} min={today} value={date} onChange={(ev) => set(at(ev.target.value, time, hours))} />)}
            {field('time', 'Start (Dubai)', <select id={`${idPrefix}-time`} className={cls.input} value={time} onChange={(ev) => set(at(date, ev.target.value, hours))}>
              {timeOptions(8, 24).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>)}
            {field('hours', 'Hours', <select id={`${idPrefix}-hours`} className={cls.input} value={hours} onChange={(ev) => set(at(date, time, Number(ev.target.value)))}>
              {Array.from({ length: 13 - l.minHours }, (_, i) => l.minHours + i).map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>)}
          </>)}
          {row(<>
            {field('layout', 'Layout', <select id={`${idPrefix}-layout`} className={cls.input} value={value.details.layout ?? layouts[0]} onChange={(ev) => set({ details: { layout: ev.target.value as VenueLayout } })}>
              {layouts.map((k) => <option key={k} value={k}>{LAYOUT_LABEL[k]} · up to {l.capacity[k]}</option>)}
            </select>)}
            {guests(l.capacity[value.details.layout ?? layouts[0]] ?? 1)}
          </>)}
        </div>
      );
    }
    case 'court': {
      const dur = Number.isFinite(e) && Number.isFinite(s) ? Math.round((e - s) / MIN_MS) : l.durations[0];
      const close = l.openHour === 0 && l.closeHour >= 24 ? 24 : l.closeHour;
      const times = timeOptions(l.openHour, close, l.slotMinutes).filter((t) => { const [h, m] = hm(t); return h * 60 + m + dur <= close * 60; });
      const at = (d: string, t: string, mins: number) => { const ns = dubaiInstant(d, ...hm(t)); return { start: safe(ns), end: safe(ns + mins * MIN_MS), details: { durationMin: mins } }; };
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {row(<>
            {field('date', 'Date', <input id={`${idPrefix}-date`} type="date" className={cls.input} min={today} value={date} onChange={(ev) => set(at(ev.target.value, time, dur))} />)}
            {field('time', 'Start (Dubai)', <select id={`${idPrefix}-time`} className={cls.input} value={times.includes(time) ? time : ''} onChange={(ev) => set(at(date, ev.target.value, dur))}>
              {!times.includes(time) && <option value="">Choose a time</option>}
              {times.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>)}
            {field('dur', 'Duration', <select id={`${idPrefix}-dur`} className={cls.input} value={dur} onChange={(ev) => set(at(date, time, Number(ev.target.value)))}>
              {l.durations.map((d) => <option key={d} value={d}>{d} min</option>)}
            </select>)}
          </>)}
          {row(<>
            {field('court', 'Court', <select id={`${idPrefix}-court`} className={cls.input} value={value.details.courtId ?? l.courts[0].id} onChange={(ev) => set({ details: { courtId: ev.target.value } })}>
              {l.courts.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.indoor ? 'Indoor' : 'Outdoor'}</option>)}
            </select>)}
            {guests(l.maxPlayers, 'Players')}
          </>)}
        </div>
      );
    }
    case 'charter': {
      const hours = Number.isFinite(e) && Number.isFinite(s) ? Math.round((e - s) / HOUR_MS) : l.minHours;
      const at = (d: string, t: string, h: number) => { const ns = dubaiInstant(d, ...hm(t)); return { start: safe(ns), end: safe(ns + h * HOUR_MS) }; };
      return (
        <div style={{ display: 'grid', gap: 8 }}>
          {row(<>
            {field('date', 'Date', <input id={`${idPrefix}-date`} type="date" className={cls.input} min={today} value={date} onChange={(ev) => set(at(ev.target.value, time, hours))} />)}
            {field('time', 'Departure (Dubai)', <select id={`${idPrefix}-time`} className={cls.input} value={time} onChange={(ev) => set(at(date, ev.target.value, hours))}>
              {timeOptions(6, 23).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>)}
            {field('hours', 'Hours', <select id={`${idPrefix}-hours`} className={cls.input} value={hours} onChange={(ev) => set(at(date, time, Number(ev.target.value)))}>
              {Array.from({ length: 11 - l.minHours }, (_, i) => l.minHours + i).map((h) => <option key={h} value={h}>{h} hours</option>)}
            </select>)}
            {guests(l.capacity)}
          </>)}
        </div>
      );
    }
  }
}
