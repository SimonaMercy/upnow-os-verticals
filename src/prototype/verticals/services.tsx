'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto, useWork } from '../store';
import { MODEL_INFO, SUB, subsOf } from '../registry';
import { BASE } from '../nav';
import { SERVICE_STAFF, TECHNICIANS, TODAY } from '../seed';
import {
  Badge, Button, Card, Drawer, Field, Modal, ProtoNote, SelectInput, StatusBadge, Table, Td, TextInput, fmtAed, fmtDate, hourLabel,
} from '../ui';
import { ModuleHeader, PipelineBoard } from './common';
import type { WorkItem } from '../types';

export function ServicesJobs() {
  const { patch } = useProto();
  const [quoteFor, setQuoteFor] = useState<WorkItem | null>(null);
  const [assignFor, setAssignFor] = useState<WorkItem | null>(null);
  const [doneFor, setDoneFor] = useState<WorkItem | null>(null);
  const [amount, setAmount] = useState(450);
  const [tech, setTech] = useState(TECHNICIANS[0]);
  const [date, setDate] = useState('2026-10-16');
  const [time, setTime] = useState('10:00');
  const [photos, setPhotos] = useState(false);

  return (
    <div>
      <ModuleHeader v="services" title="Jobs board" model="Field-service job"
        subtitle="Cleaning, AC and handyman work at the customer's address: request → quote (when needed) → scheduled with a technician → on site → completed with photo evidence." />
      <PipelineBoard
        dataset="jobs"
        stages={[{ id: 'request', label: 'Requests' }, { id: 'quoted', label: 'Quoted' }, { id: 'scheduled', label: 'Scheduled' }, { id: 'in_progress', label: 'On site' }, { id: 'completed', label: 'Completed' }]}
        next={{ scheduled: { to: 'in_progress', label: 'Start job', msg: 'Technician on site' } }}
        custom={(w) => {
          if (w.stage === 'request') return <Button size="sm" variant="subtle" onClick={() => { setAmount(450); setQuoteFor(w); }}>Send quote</Button>;
          if (w.stage === 'quoted') return <Button size="sm" variant="subtle" onClick={() => { setDate(w.date ?? '2026-10-16'); setAssignFor(w); }}>Schedule & assign</Button>;
          if (w.stage === 'in_progress') return <Button size="sm" variant="subtle" onClick={() => { setPhotos(false); setDoneFor(w); }}>Complete</Button>;
          return null;
        }}
        exit={{ from: ['request', 'quoted'], to: 'cancelled', label: 'Decline', msg: 'Job declined' }}
        body={(w) => <div className="mt-1 flex items-center gap-1 text-xs text-[var(--ink3)]"><MapPin className="h-3 w-3" aria-hidden />{w.meta.area} · {w.meta.sub}</div>}
      />
      <Modal open={!!quoteFor} onClose={() => setQuoteFor(null)} title="Send quote" subtitle={quoteFor?.title}
        footer={<><Button variant="secondary" onClick={() => setQuoteFor(null)}>Cancel</Button><Button onClick={() => { patch('work', quoteFor!.id, { stage: 'quoted', amount }, `Quote sent · ${fmtAed(amount)}`); setQuoteFor(null); }}>Send quote</Button></>}>
        <Field label="Quote amount (AED, VAT inclusive)"><TextInput type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <div className="mt-3"><ProtoNote>The customer accepts the quote in their app; the prototype treats it as accepted when you schedule.</ProtoNote></div>
      </Modal>
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title="Schedule & assign technician" subtitle={assignFor?.title}
        footer={<><Button variant="secondary" onClick={() => setAssignFor(null)}>Cancel</Button><Button onClick={() => { patch('work', assignFor!.id, { stage: 'scheduled', assignee: tech, date, time }, `Scheduled with ${tech}`); setAssignFor(null); }}>Schedule</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Technician"><SelectInput value={tech} onChange={(e) => setTech(e.target.value)} options={TECHNICIANS} /></Field>
          <Field label="Date"><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Time"><TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <p className="mt-3 text-xs text-[var(--ink3)]">Production equivalent: SP Operations → job detail → assign technician (skills, coverage and shifts).</p>
      </Modal>
      <Modal open={!!doneFor} onClose={() => setDoneFor(null)} title="Complete job" subtitle={doneFor?.title}
        footer={<><Button variant="secondary" onClick={() => setDoneFor(null)}>Cancel</Button><Button disabled={!photos} onClick={() => { patch('work', doneFor!.id, { stage: 'completed' }, 'Job completed — awaiting customer sign-off'); setDoneFor(null); }}>Mark complete</Button></>}>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />Before / after photos attached (required)</label>
      </Modal>
    </div>
  );
}

const APPT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export function ServicesAppointments() {
  const items = useWork('appointments').filter((w) => w.date === TODAY && w.stage !== 'cancelled');
  const { add, patch, nextId, context } = useProto();
  const [slot, setSlot] = useState<{ staff: string; hour: number } | null>(null);
  const [sel, setSel] = useState<WorkItem | null>(null);
  const [name, setName] = useState('');
  const [svc, setSvc] = useState("Men's cut");

  return (
    <div>
      <ModuleHeader v="services" title="Appointments" model="Appointment"
        subtitle={`Marina Barbers · ${fmtDate(TODAY)}. Appointments are booked against a staff member at your branch — unlike field jobs, nobody is dispatched.`} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-sm">
          <thead><tr><th className="w-16" />{SERVICE_STAFF.map((s) => <th key={s} className="pb-1 text-left text-xs font-bold text-[var(--ink3)]">{s}</th>)}</tr></thead>
          <tbody>
            {APPT_HOURS.map((h) => (
              <tr key={h}>
                <td className="pr-2 text-right text-xs font-semibold tabular-nums text-[var(--ink3)]">{hourLabel(h)}</td>
                {SERVICE_STAFF.map((s) => {
                  const a = items.find((w) => w.meta.staff === s && Number(w.meta.hour) === h);
                  return (
                    <td key={s}>
                      {a ? (
                        <button type="button" onClick={() => setSel(a)} className={cn('flex h-12 w-full flex-col justify-center rounded-lg px-2 text-left text-[12px]',
                          a.stage === 'requested' ? 'bg-[#fbf0dc] text-[#8a5a14]' : a.stage === 'completed' ? 'bg-[#eef0ef] text-[var(--ink3)]' : 'bg-[#e3eef8] text-[#1f5a8c]')}>
                          <span className="truncate font-semibold">{a.customer}</span>
                          <span className="truncate text-[11px] opacity-80">{a.title} · {a.meta.duration} min</span>
                        </button>
                      ) : (
                        <button type="button" aria-label={`Book ${s} at ${hourLabel(h)}`} onClick={() => { setName(''); setSlot({ staff: s, hour: h }); }}
                          className="h-12 w-full rounded-lg border border-dashed border-[var(--line2)] text-xs text-[#8a958e] hover:border-[#1f5a8c] hover:bg-[#eef4fa] hover:text-[#1f5a8c]">+</button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Modal open={!!slot} onClose={() => setSlot(null)} title="New appointment" subtitle={slot ? `${slot.staff} · ${hourLabel(slot.hour)}` : ''}
        footer={<><Button variant="secondary" onClick={() => setSlot(null)}>Cancel</Button><Button disabled={!name} onClick={() => {
          add('work', { id: nextId('AP'), orgId: context, dataset: 'appointments', title: svc, customer: name, stage: 'confirmed', date: TODAY, meta: { staff: slot!.staff, hour: slot!.hour, duration: 45 } }, 'Appointment booked');
          setSlot(null);
        }}>Book</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Service"><SelectInput value={svc} onChange={(e) => setSvc(e.target.value)} options={SUB['services.haircut'].fields[0].options!} /></Field>
        </div>
      </Modal>
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.customer ?? ''} subtitle={sel ? `${sel.title} · ${sel.meta.staff} · ${hourLabel(Number(sel.meta.hour))}` : ''}
        footer={sel && <>
          {sel.stage !== 'completed' && <Button variant="danger" size="sm" onClick={() => { patch('work', sel.id, { stage: 'cancelled' }, 'Marked no-show'); setSel(null); }}>No-show</Button>}
          {sel.stage === 'requested' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'confirmed' }, 'Appointment confirmed'); setSel(null); }}>Confirm</Button>}
          {sel.stage === 'confirmed' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'completed' }, 'Appointment completed — paid at salon'); setSel(null); }}>Complete & take payment</Button>}
        </>}>
        {sel && <div className="flex items-center gap-2 text-sm"><StatusBadge status={sel.stage} /><span className="text-[var(--ink3)]">{sel.meta.duration} minutes</span></div>}
      </Drawer>
    </div>
  );
}

export function ServicesQuotes() {
  const { patch } = useProto();
  const [quoteFor, setQuoteFor] = useState<WorkItem | null>(null);
  const [amount, setAmount] = useState(3500);
  return (
    <div>
      <ModuleHeader v="services" title="Quoted projects" model="Quoted project"
        subtitle="Photography and design work is scoped and quoted first; delivery happens later against agreed deliverables." />
      <PipelineBoard
        dataset="projects"
        stages={[{ id: 'brief', label: 'Brief' }, { id: 'quote_sent', label: 'Quote sent' }, { id: 'accepted', label: 'Accepted' }, { id: 'delivered', label: 'Delivered' }]}
        next={{ quote_sent: { to: 'accepted', label: 'Mark accepted', msg: 'Quote accepted' }, accepted: { to: 'delivered', label: 'Mark delivered', msg: 'Deliverables sent' } }}
        custom={(w) => w.stage === 'brief' ? <Button size="sm" variant="subtle" onClick={() => setQuoteFor(w)}>Send quote</Button> : null}
        exit={{ from: ['brief', 'quote_sent'], to: 'cancelled', label: 'Lost', msg: 'Project lost' }}
        body={(w) => <div className="mt-1 text-xs text-[var(--ink3)]">{w.meta.sub}</div>}
      />
      <Modal open={!!quoteFor} onClose={() => setQuoteFor(null)} title="Project quote" subtitle={quoteFor?.title}
        footer={<><Button variant="secondary" onClick={() => setQuoteFor(null)}>Cancel</Button><Button onClick={() => { patch('work', quoteFor!.id, { stage: 'quote_sent', amount }, `Quote sent · ${fmtAed(amount)}`); setQuoteFor(null); }}>Send</Button></>}>
        <Field label="Total (AED)"><TextInput type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        <p className="mt-3 text-sm text-[var(--ink3)]">Deposit 50% on acceptance, balance on delivery.</p>
      </Modal>
    </div>
  );
}

export function ServicesOfferings() {
  const { org, listings, context } = useProto();
  const auth = org?.verticals.find((v) => v.vertical === 'services');
  return (
    <div>
      <ModuleHeader v="services" title="Offerings" subtitle="What this business sells in Services, by subcategory. Each offering can have one or more listings." actions={<Link href={`${BASE}/listings/new`}><Button>Create listing</Button></Link>} />
      <Table head={['Subcategory', 'Operating model', 'Pricing basis', 'Listings', 'Authorised']}>
        {subsOf('services').map((s) => {
          const ls = listings.filter((l) => l.orgId === context && l.subKey === s.key);
          const ok = auth?.subcategories.includes(s.key);
          return (
            <tr key={s.key} className={ok ? '' : 'opacity-60'}>
              <Td className="font-semibold">{s.label}</Td>
              <Td>{MODEL_INFO[s.model].label}</Td>
              <Td className="text-[13px]">{s.priceBasis}</Td>
              <Td><div className="flex flex-wrap gap-1">{ls.length ? ls.map((l) => <StatusBadge key={l.id} status={l.status} />) : <span className="text-xs text-[#8a958e]">None</span>}</div></Td>
              <Td>{ok ? <Badge tone="green">Yes</Badge> : <Badge tone="neutral">No</Badge>}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
