'use client';

import { useState } from 'react';
import { toast } from '../toast';
import { Plus, Users } from 'lucide-react';
import { useProto, useWork } from '../store';
import { TODAY } from '../seed';
import {
  Badge, Button, Drawer, Field, Meter, Modal, ProtoNote, SelectInput, Stat, StatusBadge, Table, Td, TextInput, fmtAed, fmtDate,
} from '../ui';
import { ModuleHeader } from './common';
import type { WorkItem } from '../types';

const PRODUCTS = [
  { title: 'Evening desert safari', sub: 'Desert safari', price: 295, cap: 40, host: 'Guide: Saeed', place: 'Desert Camp' },
  { title: 'Overnight desert safari', sub: 'Desert safari', price: 650, cap: 20, host: 'Guide: Saeed', place: 'Desert Camp' },
  { title: 'Old Dubai walking tour', sub: 'Tour', price: 150, cap: 15, host: 'Guide: Mona', place: 'Al Fahidi' },
  { title: 'Perfume-making workshop', sub: 'Workshop', price: 380, cap: 12, host: 'Host: Leila', place: 'Al Quoz Studio' },
];

export function ExperiencesSessions() {
  const sessions = useWork('sessions');
  const reservations = useWork('reservations');
  const { add, patch, nextId, context } = useProto();
  const [adding, setAdding] = useState(false);
  const [prod, setProd] = useState(PRODUCTS[0].title);
  const [date, setDate] = useState('2026-10-18');
  const [time, setTime] = useState('15:30');
  const [cancelFor, setCancelFor] = useState<WorkItem | null>(null);
  const [manifest, setManifest] = useState<WorkItem | null>(null);

  const upcoming = sessions.filter((s) => s.stage === 'scheduled');
  const seats = upcoming.reduce((a, s) => a + Number(s.meta.booked), 0);
  const cap = upcoming.reduce((a, s) => a + Number(s.meta.capacity), 0);

  return (
    <div>
      <ModuleHeader v="experiences" title="Sessions & capacity" model="Scheduled session"
        subtitle="Experiences are sold as seats on a scheduled session. Many guests share one departure; when the provider cancels a session, every reservation on it is refunded."
        actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden />Add session</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming sessions" value={upcoming.length} />
        <Stat label="Seats sold" value={`${seats}/${cap}`} sub={`${cap ? Math.round((seats / cap) * 100) : 0}% fill rate`} />
        <Stat label="Sold out" value={upcoming.filter((s) => Number(s.meta.booked) >= Number(s.meta.capacity)).length} sub="Waitlist candidates" />
        <Stat label="Pending reservations" value={reservations.filter((r) => r.stage === 'pending').length} sub="Awaiting payment" tone="warn" />
      </div>
      <Table head={['Session', 'Date & time', 'Host', 'Capacity', 'Price', 'Status', '']}>
        {sessions.map((s) => {
          const full = Number(s.meta.booked) >= Number(s.meta.capacity);
          return (
            <tr key={s.id}>
              <Td><div className="font-semibold">{s.title}</div><div className="text-xs text-[var(--ink3)]">{s.customer} · {s.meta.sub}</div></Td>
              <Td className="whitespace-nowrap">{fmtDate(s.date)} · {s.time}{s.date === TODAY && <Badge tone="blue" className="ml-1">Today</Badge>}</Td>
              <Td>{s.assignee}</Td>
              <Td className="min-w-[180px]"><Meter value={Number(s.meta.booked)} max={Number(s.meta.capacity)} label={`${s.meta.booked}/${s.meta.capacity} seats`} /></Td>
              <Td>{fmtAed(s.amount ?? 0)}<span className="text-xs text-[var(--ink3)]"> /person</span></Td>
              <Td>{s.stage === 'scheduled' && full ? <StatusBadge status="full" /> : <StatusBadge status={s.stage} />}</Td>
              <Td>
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setManifest(s)}><Users className="h-3.5 w-3.5" aria-hidden />Guests</Button>
                  {s.stage === 'scheduled' && <Button size="sm" variant="danger" onClick={() => setCancelFor(s)}>Cancel</Button>}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add session"
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={() => {
          const p = PRODUCTS.find((x) => x.title === prod)!;
          add('work', { id: nextId('SE'), orgId: context, dataset: 'sessions', title: p.title, customer: p.place, stage: 'scheduled', date, time, amount: p.price, assignee: p.host, meta: { capacity: p.cap, booked: 0, sub: p.sub } }, 'Session scheduled');
          setAdding(false);
        }}>Add session</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Product"><SelectInput value={prod} onChange={(e) => setProd(e.target.value)} options={PRODUCTS.map((p) => p.title)} /></Field>
          <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Start"><TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-sm text-[var(--ink3)]">Capacity: {PRODUCTS.find((p) => p.title === prod)?.cap} seats (from the product). Guide availability would be checked against the roster.</p>
      </Modal>

      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title="Cancel session" subtitle={cancelFor ? `${cancelFor.title} · ${fmtDate(cancelFor.date)}` : ''}
        footer={cancelFor && <><Button variant="secondary" onClick={() => setCancelFor(null)}>Keep session</Button><Button variant="danger" onClick={() => {
          patch('work', cancelFor.id, { stage: 'cancelled' }, 'Session cancelled');
          reservations.filter((r) => r.meta.session === cancelFor.id && r.stage !== 'cancelled').forEach((r) => patch('work', r.id, { stage: 'cancelled' }));
          setCancelFor(null);
        }}>Cancel and refund all</Button></>}>
        {cancelFor && <ProtoNote>{cancelFor.meta.booked} guests will be notified and fully refunded (simulated). Provider-cancelled sessions always refund in full, unlike customer cancellations.</ProtoNote>}
      </Modal>

      <Drawer open={!!manifest} onClose={() => setManifest(null)} title={manifest ? `Guests · ${manifest.title}` : ''} subtitle={manifest ? `${fmtDate(manifest.date)} · ${manifest.time}` : ''}>
        {manifest && (
          <ul className="flex flex-col gap-2 text-sm">
            {reservations.filter((r) => r.meta.session === manifest.id).map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl border border-[var(--line)] p-2.5">
                <div><div className="font-semibold">{r.customer}</div><div className="text-xs text-[var(--ink3)]">{r.meta.seats} seats · pickup {r.meta.pickup}</div></div>
                <StatusBadge status={r.stage} />
              </li>
            ))}
            <li className="text-xs text-[var(--ink3)]">Plus {Math.max(0, Number(manifest.meta.booked) - reservations.filter((r) => r.meta.session === manifest.id && r.stage !== 'pending').reduce((a, r) => a + Number(r.meta.seats), 0))} seats sold through other channels.</li>
          </ul>
        )}
      </Drawer>
    </div>
  );
}

export function ExperiencesReservations() {
  const reservations = useWork('reservations');
  const sessions = useWork('sessions');
  const { patch } = useProto();

  function confirm(r: WorkItem) {
    const s = sessions.find((x) => x.id === r.meta.session);
    if (!s) return;
    const after = Number(s.meta.booked) + Number(r.meta.seats);
    if (after > Number(s.meta.capacity)) {
      toast.error('Not enough seats left', { description: `${s.title} has ${Number(s.meta.capacity) - Number(s.meta.booked)} seats free. Offer another session.` });
      return;
    }
    patch('work', s.id, { meta: { ...s.meta, booked: after } });
    patch('work', r.id, { stage: 'confirmed' }, 'Reservation confirmed — seats allocated');
  }

  return (
    <div>
      <ModuleHeader v="experiences" title="Reservations" model="Scheduled session"
        subtitle="Seat reservations against sessions. Confirming checks remaining capacity (simulated) so a session is never oversold." />
      <Table head={['Reservation', 'Guest', 'Session', 'Seats', 'Pickup', 'Total', 'Status', '']}>
        {reservations.map((r) => {
          const s = sessions.find((x) => x.id === r.meta.session);
          return (
            <tr key={r.id}>
              <Td className="font-semibold">{r.id}</Td>
              <Td>{r.customer}</Td>
              <Td><div>{s?.title ?? r.title}</div><div className="text-xs text-[var(--ink3)]">{fmtDate(s?.date)} · {s?.time}</div></Td>
              <Td>{r.meta.seats}</Td>
              <Td className="text-[13px]">{r.meta.pickup}</Td>
              <Td className="font-semibold">{r.amount ? fmtAed(r.amount) : '—'}</Td>
              <Td><StatusBadge status={r.stage} /></Td>
              <Td>
                <div className="flex justify-end gap-1.5">
                  {r.stage === 'pending' && <Button size="sm" variant="subtle" onClick={() => confirm(r)}>Confirm</Button>}
                  {r.stage === 'confirmed' && <Button size="sm" variant="subtle" onClick={() => patch('work', r.id, { stage: 'checked_in' }, 'Guests checked in')}>Check in</Button>}
                  {(r.stage === 'pending' || r.stage === 'confirmed') && <Button size="sm" variant="ghost" onClick={() => {
                    if (r.stage === 'confirmed' && s) patch('work', s.id, { meta: { ...s.meta, booked: Number(s.meta.booked) - Number(r.meta.seats) } });
                    patch('work', r.id, { stage: 'cancelled' }, 'Reservation cancelled — seats released');
                  }}>Cancel</Button>}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-4"><ProtoNote kind="info">Waivers and guest details (age, pickup hotel) are collected per reservation; the pickup list for drivers is generated per session.</ProtoNote></div>
    </div>
  );
}
