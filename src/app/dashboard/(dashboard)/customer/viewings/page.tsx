/**
 * Customer — My Viewings calendar (dashboard/customer/viewings)
 *
 * Shows all upcoming and past property viewings for the tenant, grouped by
 * month. Tenant can cancel viewings up to 1 hour before scheduled time.
 *
 * Data: GET /leads/tenant/viewings — returns viewings with embedded unit/property.
 * Cancellation: DELETE /leads/tenant/viewings/:id (blocked <1hr before, by backend).
 */
'use client';
import { APP_TIME_ZONE } from '@/lib/datetime';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Clock, MapPin, X, CheckCircle2, Ban,
  ChevronLeft, ChevronRight, Home, ThumbsDown, Pencil,
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ViewingUnit {
  id: number;
  unitNumber: string;
  unitName: string | null;
  property?: { id: number; buildingName: string; fullAddress: string | null };
}

interface Lead {
  id: number;
  stage: string;
}

interface Viewing {
  id: number;
  scheduledAt: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled';
  notes: string | null;
  outcome: string | null;
  unit: ViewingUnit | null;
  lead: Lead | null;
}

/* ── Group by lead ───────────────────────────────────────────────────────── */

interface LeadGroup {
  leadId: number;
  leadStage: string;
  unit: ViewingUnit | null;
  primary: Viewing;
  others: Viewing[];
}

function groupByLead(viewings: Viewing[]): LeadGroup[] {
  const map = new Map<number, Viewing[]>();
  for (const v of viewings) {
    const key = v.lead?.id ?? -v.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(v);
  }
  const groups: LeadGroup[] = [];
  for (const [, list] of map) {
    const sorted = [...list].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    const primary = sorted.find(v => v.status === 'scheduled' || v.status === 'confirmed' || v.status === 'completed') ?? sorted[0];
    const others = sorted.filter(v => v.id !== primary.id);
    groups.push({
      leadId: primary.lead?.id ?? -primary.id,
      leadStage: primary.lead?.stage ?? 'new',
      unit: primary.unit,
      primary,
      others,
    });
  }
  groups.sort((a, b) => new Date(a.primary.scheduledAt).getTime() - new Date(b.primary.scheduledAt).getTime());
  return groups;
}

/* ── Journey step: 0 = Booked, 1 = Visited ─────────────────────────────── */

function getJourneyStep(viewing: Viewing): number {
  if (viewing.status === 'completed' || viewing.status === 'no_show') return 1;
  return 0;
}

/* ── Mini Calendar ──────────────────────────────────────────────────────── */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function MiniCalendar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  const selected = value ? new Date(value + 'T00:00:00') : null;
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="rounded-2xl border border-[#e8e6e0] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-[#f9f8f6]">
        <button type="button" onClick={() => setCursor(c => { const m = c.month === 0 ? 11 : c.month - 1; return { year: c.month === 0 ? c.year - 1 : c.year, month: m }; })} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronLeft size={16} className="text-[#6b6860]" />
        </button>
        <span className="text-sm font-semibold text-[#1a1916]">{MONTHS[cursor.month]} {cursor.year}</span>
        <button type="button" onClick={() => setCursor(c => { const m = c.month === 11 ? 0 : c.month + 1; return { year: c.month === 11 ? c.year + 1 : c.year, month: m }; })} className="p-1.5 rounded-lg hover:bg-[#e8e6e0] transition-colors cursor-pointer">
          <ChevronRight size={16} className="text-[#6b6860]" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-b border-[#e8e6e0]">
        {DAYS.map(d => <div key={d} className="text-center text-xs font-medium py-2 text-[#9b9890]">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 p-2 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const cellDate = new Date(cursor.year, cursor.month, day);
          const isPast = cellDate < todayDate;
          const iso = `${cursor.year}-${pad(cursor.month + 1)}-${pad(day)}`;
          const isSelected = selected ? selected.getFullYear() === cursor.year && selected.getMonth() === cursor.month && selected.getDate() === day : false;
          const isToday = cellDate.getTime() === todayDate.getTime();
          return (
            <button key={i} type="button" disabled={isPast} onClick={() => onChange(iso)}
              className="text-xs rounded-lg py-1.5 w-full text-center transition-all cursor-pointer"
              style={{ backgroundColor: isSelected ? '#2e9f82' : isToday && !isSelected ? '#edf7f3' : 'transparent', color: isSelected ? '#fff' : isPast ? '#c8c6c0' : '#1a1916', fontWeight: isSelected || isToday ? 600 : 400, cursor: isPast ? 'not-allowed' : 'pointer' }}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TIME_SLOTS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
function fmtSlot(t: string) {
  const [h] = t.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `${h12}:00 ${suffix}`;
}

/* ── Reschedule Modal ────────────────────────────────────────────────────── */

function RescheduleModal({ viewing, onClose, onSuccess }: { viewing: Viewing; onClose: () => void; onSuccess: () => void }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!date) { setError('Please pick a date.'); return; }
    setSaving(true); setError(null);
    try {
      const scheduledAt = new Date(`${date}T${time || '10:00'}:00`).toISOString();
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/reschedule`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message ?? 'Failed to reschedule'); return; }
      onSuccess();
    } finally { setSaving(false); }
  }

  const unitLabel = viewing.unit?.unitNumber ? `Unit ${viewing.unit.unitNumber}` : (viewing.unit?.unitName ?? 'Property');
  const building = viewing.unit?.property?.buildingName ?? '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-7 w-full max-w-md shadow-xl overflow-y-auto max-h-[90vh]">
        <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916] cursor-pointer" onClick={onClose}><X size={20} /></button>
        <h3 className="font-bold text-xl text-[#1a1916] mb-0.5">Reschedule Viewing</h3>
        <p className="text-sm text-[#9b9890] mb-5">{unitLabel}{building ? ` · ${building}` : ''}</p>
        {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        <label className="block text-sm font-medium text-[#3d3b35] mb-2">
          <Calendar size={14} className="inline mr-1.5" />Pick a new date
        </label>
        <div className="mb-4">
          <MiniCalendar value={date} onChange={setDate} />
          {date && (
            <p className="mt-2 text-xs text-center font-medium text-[#2e9f82]">
              {new Date(date + 'T00:00:00').toLocaleDateString('en-AE', { timeZone: APP_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        <label className="block text-sm font-medium text-[#3d3b35] mb-2">
          Preferred time <span className="text-[#9b9890] font-normal">(optional)</span>
        </label>
        <div className="grid grid-cols-5 gap-2 mb-6">
          {TIME_SLOTS.filter(slot => {
            const today = new Date().toISOString().split('T')[0];
            if (date !== today) return true;
            const [h] = slot.split(':').map(Number);
            return h > new Date().getHours();
          }).map(slot => (
            <button key={slot} type="button" onClick={() => setTime(time === slot ? '' : slot)}
              className="py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer"
              style={{ borderColor: time === slot ? '#2e9f82' : '#e8e6e0', backgroundColor: time === slot ? '#edf7f3' : '#fff', color: time === slot ? '#2e9f82' : '#3d3b35' }}>
              {fmtSlot(slot)}
            </button>
          ))}
        </div>
        <button disabled={!date || saving} onClick={handleSave}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90 cursor-pointer"
          style={{ backgroundColor: '#2e9f82' }}>
          {saving ? 'Saving…' : 'Confirm New Time'}
        </button>
      </div>
    </div>
  );
}

/* ── Not Interested Modal ────────────────────────────────────────────────── */

function NotInterestedModal({ viewing, onClose, onSuccess }: { viewing: Viewing; onClose: () => void; onSuccess: () => void }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/not-interested`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.message ?? 'Something went wrong'); return; }
      onSuccess();
    } finally { setSaving(false); }
  }

  const unitLabel = viewing.unit?.unitNumber ? `Unit ${viewing.unit.unitNumber}` : (viewing.unit?.unitName ?? 'this property');
  const building = viewing.unit?.property?.buildingName ?? '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl p-7 w-full max-w-sm shadow-xl">
        <button className="absolute top-4 right-4 text-[#9b9890] hover:text-[#1a1916] cursor-pointer" onClick={onClose}><X size={20} /></button>
        <div className="w-11 h-11 rounded-full bg-[#fee2e2] flex items-center justify-center mb-4">
          <ThumbsDown size={18} className="text-[#b91c1c]" />
        </div>
        <h3 className="font-bold text-lg text-[#1a1916] mb-1">Not interested?</h3>
        <p className="text-sm text-[#6b6860] mb-4">
          {unitLabel}{building ? ` · ${building}` : ''} will be removed from your active viewings.
        </p>
        {error && <div className="mb-4 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        <label className="block text-sm font-medium text-[#3d3b35] mb-1.5">
          Notes <span className="text-[#9b9890] font-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. Too far from work, price too high…"
          className="w-full text-sm mb-5 border border-[#e8e6e0] rounded-xl px-3 py-2.5 text-[#1a1916] resize-none focus:outline-none focus:ring-2 focus:ring-[#e8e6e0]"
        />
        <button disabled={saving} onClick={handleSubmit}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-[#b91c1c] hover:bg-red-700 disabled:opacity-50 transition-colors cursor-pointer">
          {saving ? 'Saving…' : 'Mark as Not Interested'}
        </button>
      </div>
    </div>
  );
}

/* ── Journey Card ────────────────────────────────────────────────────────── */

function JourneyCard({ group, onRefresh }: { group: LeadGroup; onRefresh: () => void }) {
  const viewing = group.primary;
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [notInterestedOpen, setNotInterestedOpen] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const dt = new Date(viewing.scheduledAt);
  const dateStr = dt.toLocaleDateString('en-AE', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: APP_TIME_ZONE });
  const timeStr = dt.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });

  const unitLabel = group.unit?.unitNumber ? `Unit ${group.unit.unitNumber}` : (group.unit?.unitName ?? 'Property');
  const building = group.unit?.property?.buildingName ?? '';
  const address = group.unit?.property?.fullAddress ?? '';

  const hourMs = 60 * 60 * 1000;
  const canModify = viewing.status === 'scheduled' && (dt.getTime() - Date.now() > hourMs);
  const currentStep = getJourneyStep(viewing);
  const hasVisited = viewing.status === 'completed' && !['applied','offer_made','approved','converted'].includes(group.leadStage);
  const hasReserved = ['applied','offer_made','approved','converted'].includes(group.leadStage);

  async function handleReserve() {
    setReserving(true); setActionError(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}/apply`, { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setActionError(body.message ?? 'Failed'); return; }
      onRefresh();
    } finally { setReserving(false); }
  }

  async function handleCancel() {
    setCancelling(true); setActionError(null);
    try {
      const res = await fetch(`/api/leads/my-viewings/${viewing.id}`, { method: 'DELETE', credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setActionError(body.message ?? 'Failed to cancel'); return; }
      onRefresh();
    } finally { setCancelling(false); }
  }

  const STEPS = [
    { key: 'booked',  label: 'Booked',  icon: Calendar },
    { key: 'visited', label: 'Visited', icon: Home },
  ];

  return (
    <>
      {rescheduleOpen && (
        <RescheduleModal viewing={viewing} onClose={() => setRescheduleOpen(false)} onSuccess={() => { setRescheduleOpen(false); onRefresh(); }} />
      )}
      {notInterestedOpen && (
        <NotInterestedModal viewing={viewing} onClose={() => setNotInterestedOpen(false)} onSuccess={() => { setNotInterestedOpen(false); onRefresh(); }} />
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#e8e6e0] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#f0faf6] flex items-center justify-center flex-shrink-0 mt-0.5">
            <Home size={15} className="text-[#2e9f82]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[#1a1916] leading-tight">{unitLabel}</p>
            <p className="text-xs text-[#9b9890]">{building}</p>
          </div>
          <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 ${
            viewing.status === 'confirmed' ? 'bg-[#d8f2e8] text-[#1a7a5a]' :
            viewing.status === 'completed' ? 'bg-[#dbeafe] text-[#1e40af]' :
                                             'bg-[#fef3c7] text-[#92400e]'
          }`}>
            {viewing.status === 'confirmed' ? 'Confirmed' : viewing.status === 'completed' ? 'Visited' : 'Scheduled'}
          </span>
        </div>

        {/* Date / time / address */}
        <div className="px-5 pb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5 text-xs text-[#3d3b35]">
            <Calendar size={12} className="text-[#2e9f82]" />{dateStr}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-[#3d3b35]">
            <Clock size={12} className="text-[#2e9f82]" />{timeStr}
          </span>
          {address && (
            <span className="flex items-center gap-1 text-xs text-[#9b9890]">
              <MapPin size={11} />{address}
            </span>
          )}
        </div>

        {/* 2-step timeline */}
        <div className="px-5 pb-4">
          <div className="flex items-center">
            {STEPS.map((step, i) => {
              const done = i <= currentStep;
              const isActive = i === currentStep;
              const Icon = step.icon;
              return (
                <div key={step.key} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center gap-1 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${
                      done ? 'bg-[#2e9f82] text-white' : 'bg-[#f4f3ef] text-[#c5c2bb]'
                    } ${isActive ? 'ring-2 ring-[#2e9f82] ring-offset-1' : ''}`}>
                      <Icon size={14} />
                    </div>
                    <span className={`text-[9px] font-semibold uppercase tracking-wide whitespace-nowrap ${done ? 'text-[#2e9f82]' : 'text-[#c5c2bb]'}`}>
                      {step.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mb-4 mx-1 ${i < currentStep ? 'bg-[#2e9f82]' : 'bg-[#e8e6e0]'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* POST-VISIT CTAs — Urgency reservation prompt */}
        {hasVisited && (
          <div className="mx-4 mb-4 rounded-2xl overflow-hidden border border-[#f59e0b]/40 shadow-sm">
            {/* Urgency header */}
            <div className="px-4 py-3 flex items-start gap-3" style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)' }}>
              <div className="w-8 h-8 rounded-full bg-[#f59e0b] flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-white text-sm font-bold">!</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#92400e] leading-snug">
                  You&apos;re 1 step away from securing this apartment!
                </p>
                <p className="text-xs text-[#b45309] mt-0.5 leading-relaxed">
                  Other viewings are already scheduled — confirm your reservation before someone else does.
                </p>
              </div>
            </div>

            {/* CTA */}
            <div className="px-4 py-4 bg-white">
              <button
                disabled={reserving}
                onClick={handleReserve}
                className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-all active:scale-[0.98] cursor-pointer"
                style={{ background: reserving ? '#9b9890' : 'linear-gradient(135deg, #2e9f82 0%, #1f6655 100%)', boxShadow: reserving ? 'none' : '0 4px 14px rgba(46,159,130,0.35)' }}
              >
                <CheckCircle2 size={16} />
                {reserving ? 'Confirming…' : 'Book & Confirm My Reservation'}
              </button>
              <button
                onClick={() => setNotInterestedOpen(true)}
                className="w-full mt-2.5 text-xs text-[#9b9890] hover:text-[#b91c1c] transition-colors py-1.5 cursor-pointer"
              >
                Not interested in this apartment
              </button>
            </div>
          </div>
        )}

        {/* Reserved banner */}
        {hasReserved && (
          <div className="mx-4 mb-4 rounded-xl bg-[#d8f2e8] border border-[#a7f3d0] px-4 py-2.5 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-[#1a7a5a] flex-shrink-0" />
            <p className="text-xs font-medium text-[#1a7a5a]">
              {group.leadStage === 'approved' || group.leadStage === 'converted'
                ? 'Approved! The rental provider will contact you to finalise your contract.'
                : 'Reserved — the rental provider will be in touch shortly.'}
            </p>
          </div>
        )}

        {actionError && (
          <div className="mx-4 mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
        )}

        {/* Previous slots */}
        {group.others.length > 0 && (
          <div className="mx-4 mb-3 rounded-xl bg-[#f9f8f6] border border-[#e8e6e0] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9b9890] mb-2">Previous slots</p>
            <div className="space-y-1">
              {group.others.map(v => {
                const d = new Date(v.scheduledAt);
                const ds = d.toLocaleDateString('en-AE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: APP_TIME_ZONE });
                const ts = d.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: APP_TIME_ZONE });
                return (
                  <div key={v.id} className="flex items-center gap-3 text-xs text-[#9b9890]">
                    <span className="flex items-center gap-1"><Calendar size={10} />{ds} · {ts}</span>
                    <span className={`text-[9px] font-semibold uppercase rounded-full px-2 py-0.5 ${
                      v.status === 'cancelled' ? 'bg-[#f4f3ef] text-[#9b9890]' :
                      v.status === 'no_show'   ? 'bg-[#fee2e2] text-[#b91c1c]' :
                                                 'bg-[#fef3c7] text-[#92400e]'
                    }`}>{v.status === 'no_show' ? 'No show' : v.status}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reschedule / cancel (before visit) */}
        {canModify && (
          <div className="border-t border-[#f0ede8] px-5 py-3 flex items-center gap-4">
            <button onClick={() => setRescheduleOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-[#3d3b35] hover:text-[#1a1916] transition-colors cursor-pointer">
              <Pencil size={12} /> Reschedule
            </button>
            <span className="text-[#e0ddd7]">|</span>
            <button disabled={cancelling} onClick={handleCancel}
              className="flex items-center gap-1.5 text-xs font-medium text-[#b91c1c] hover:text-red-700 disabled:opacity-50 transition-colors cursor-pointer">
              <X size={12} /> {cancelling ? 'Cancelling…' : 'Cancel viewing'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Past / Inactive Card ────────────────────────────────────────────────── */

function InactiveCard({ viewing }: { viewing: Viewing }) {
  const dt = new Date(viewing.scheduledAt);
  const dateStr = dt.toLocaleDateString('en-AE', { weekday: 'short', month: 'short', day: 'numeric', timeZone: APP_TIME_ZONE });
  const unitLabel = viewing.unit?.unitNumber ? `Unit ${viewing.unit.unitNumber}` : (viewing.unit?.unitName ?? 'Property');
  const building = viewing.unit?.property?.buildingName ?? '';
  const isNotInterested = viewing.outcome === 'not_interested';

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-[#e8e6e0] flex items-center gap-3 opacity-60">
      <div className="w-8 h-8 rounded-full bg-[#f4f3ef] flex items-center justify-center flex-shrink-0">
        <Ban size={14} className="text-[#9b9890]" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#3d3b35] truncate">{unitLabel}</p>
        {building && <p className="text-xs text-[#9b9890]">{building}</p>}
        <p className="text-xs text-[#9b9890]">{dateStr} · {isNotInterested ? 'Not interested' : viewing.status === 'no_show' ? 'No show' : 'Cancelled'}</p>
        {viewing.notes && isNotInterested && (
          <p className="text-xs text-[#9b9890] italic mt-0.5">&ldquo;{viewing.notes}&rdquo;</p>
        )}
      </div>
      <a href="/listings" className="ml-auto flex-shrink-0 text-xs text-[#2e9f82] hover:underline font-medium">Find another →</a>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function MyViewingsPage() {
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchViewings = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/leads/my-viewings', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load viewings (${res.status})`);
      const data = await res.json();
      setViewings(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load viewings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchViewings(); }, [fetchViewings]);

  const groups = groupByLead(viewings);
  const activeGroups = groups.filter(g =>
    g.primary.status !== 'cancelled' && g.primary.status !== 'no_show'
  );
  const inactiveGroups = groups.filter(g =>
    g.primary.status === 'cancelled' || g.primary.status === 'no_show'
  );

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1916]">My Viewings</h1>
        <p className="text-sm text-[#6b6860] mt-0.5">Track your property visits and express interest.</p>
      </div>

      {error && (
        <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {loading && (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="bg-white rounded-2xl h-40 animate-pulse shadow-sm" />)}
        </div>
      )}

      {!loading && viewings.length === 0 && (
        <div className="bg-white rounded-2xl p-16 shadow-sm flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 rounded-full bg-[#d8f2e8] flex items-center justify-center mb-4">
            <Home size={24} className="text-[#2e9f82]" />
          </div>
          <h3 className="font-semibold text-[#1a1916] mb-1">No viewings yet</h3>
          <p className="text-sm text-[#6b6860] max-w-xs">Browse listings and click &ldquo;Book a Viewing&rdquo; to get started.</p>
          <a href="/listings" className="mt-4 text-sm font-medium text-[#2e9f82] hover:underline">Browse listings →</a>
        </div>
      )}

      {!loading && activeGroups.length > 0 && (
        <div className="space-y-5 mb-8">
          {activeGroups.map(g => (
            <JourneyCard key={g.leadId} group={g} onRefresh={fetchViewings} />
          ))}
        </div>
      )}

      {!loading && inactiveGroups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[#3d3b35] uppercase tracking-wide mb-3">Past</h2>
          <div className="space-y-3">
            {inactiveGroups.map(g => <InactiveCard key={g.leadId} viewing={g.primary} />)}
          </div>
        </section>
      )}
    </div>
  );
}
