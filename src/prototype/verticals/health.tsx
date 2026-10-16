'use client';

import { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, FileLock2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto, useWork } from '../store';
import { PRACTITIONERS, TODAY } from '../seed';
import { dayDiff } from '../datasets';
import { Badge, Button, Card, Drawer, Field, Modal, ProtoNote, SelectInput, Stat, StatusBadge, fmtDate, hourLabel } from '../ui';
import { ModuleHeader } from './common';
import type { WorkItem } from '../types';

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const REASONS = ['Treating this patient today', 'Front-desk check-in', 'Insurance / billing query', 'Patient called the clinic'];

export function HealthAppointments() {
  const items = useWork('clinic').filter((w) => w.date === TODAY && w.stage !== 'cancelled');
  const { patch } = useProto();
  const [revealed, setRevealed] = useState<string[]>([]);
  const [asking, setAsking] = useState<WorkItem | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [ack, setAck] = useState(false);
  const [sel, setSel] = useState<WorkItem | null>(null);

  const isOpen = (w: WorkItem) => revealed.includes(w.id) && w.meta.patient !== 'Restricted';

  return (
    <div>
      <ModuleHeader v="health" title="Appointments" model="Clinical appointment"
        subtitle={`Marina Clinic · ${fmtDate(TODAY)}. Patient identity is hidden by default. Revealing it requires a reason and is written to the audit log.`} />
      <div className="mb-4"><ProtoNote kind="info"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />UpNow OS holds booking metadata only. Intake forms, consent and clinical notes live in the clinic&apos;s own medical record system (DHA rules); they are never copied into Customers, Documents or Reports.</ProtoNote></div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Appointments today" value={items.length} />
        <Stat label="Checked in" value={items.filter((w) => w.stage === 'checked_in').length} />
        <Stat label="Awaiting confirmation" value={items.filter((w) => w.stage === 'requested').length} tone="warn" />
        <Stat label="Identity reveals today" value={revealed.length} sub="Each one audited" />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-1 text-sm">
          <thead><tr><th className="w-16" />{PRACTITIONERS.map((p) => <th key={p.id} className="pb-1 text-left text-xs font-bold text-[var(--ink3)]">{p.name}<div className="font-normal">{p.specialty}</div></th>)}</tr></thead>
          <tbody>
            {HOURS.map((h) => (
              <tr key={h}>
                <td className="pr-2 text-right text-xs font-semibold tabular-nums text-[var(--ink3)]">{hourLabel(h)}</td>
                {PRACTITIONERS.map((p) => {
                  const a = items.find((w) => w.meta.practitioner === p.id && Number(w.meta.hour) === h);
                  return (
                    <td key={p.id}>
                      {a ? (
                        <button type="button" onClick={() => setSel(a)} className={cn('flex h-12 w-full flex-col justify-center rounded-lg px-2 text-left text-[12px]',
                          a.stage === 'requested' ? 'bg-[#fbf0dc] text-[#8a5a14]' : a.stage === 'completed' ? 'bg-[#eef0ef] text-[var(--ink3)]' : a.stage === 'checked_in' ? 'bg-[var(--g2)] text-[var(--g9)]' : 'bg-[var(--g1)] text-[var(--g8)]')}>
                          <span className="flex items-center gap-1 truncate font-semibold">{isOpen(a) ? <Eye className="h-3 w-3 shrink-0" aria-hidden /> : <Lock className="h-3 w-3 shrink-0" aria-hidden />}{isOpen(a) ? a.meta.patient : `Patient ${a.customer}`}</span>
                          <span className="truncate text-[11px] opacity-80">{a.title}</span>
                        </button>
                      ) : <div className="h-12 rounded-lg bg-[var(--bg)]" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel ? (isOpen(sel) ? String(sel.meta.patient) : `Patient ${sel.customer}`) : ''}
        subtitle={sel ? `${sel.title} · ${PRACTITIONERS.find((p) => p.id === sel.meta.practitioner)?.name} · ${hourLabel(Number(sel.meta.hour))}` : ''}
        footer={sel && <>
          {sel.stage === 'requested' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'confirmed' }, 'Appointment confirmed'); setSel(null); }}>Confirm</Button>}
          {sel.stage === 'confirmed' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'checked_in' }, 'Patient checked in'); setSel(null); }}>Check in</Button>}
          {sel.stage === 'checked_in' && <Button size="sm" onClick={() => { patch('work', sel.id, { stage: 'completed' }, 'Consultation completed'); setSel(null); }}>Mark completed</Button>}
          {['requested', 'confirmed'].includes(sel.stage) && <Button size="sm" variant="danger" onClick={() => { patch('work', sel.id, { stage: 'cancelled' }, 'Marked no-show'); setSel(null); }}>No-show</Button>}
        </>}>
        {sel && (
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center gap-2"><StatusBadge status={sel.stage} /><span className="text-[var(--ink3)]">Insurer: {sel.meta.insurer}</span></div>
            {sel.meta.patient === 'Restricted' ? (
              <ProtoNote kind="info">This is a mental-health appointment. Identity is restricted to the treating practitioner and cannot be revealed from the front desk.</ProtoNote>
            ) : isOpen(sel) ? (
              <div className="rounded-xl bg-[var(--bg)] p-3">
                <div className="font-semibold">{sel.meta.patient}</div>
                <div className="text-[var(--ink2)]">Reason for visit: {sel.meta.reason}</div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setRevealed(revealed.filter((x) => x !== sel.id))}><EyeOff className="h-3.5 w-3.5" aria-hidden />Hide again</Button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-[var(--line2)] bg-[var(--bg)] p-3">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--g8)]"><Lock className="h-4 w-4" aria-hidden />Patient details hidden</span>
                <span className="text-[var(--ink2)]">Name and reason for visit are visible only after you record why you need them.</span>
                <Button size="sm" variant="secondary" onClick={() => { setAck(false); setReason(REASONS[0]); setAsking(sel); }}><Eye className="h-3.5 w-3.5" aria-hidden />Reveal details</Button>
              </div>
            )}
            <div className="flex items-start gap-2 rounded-xl bg-[#eef0ef] p-3 text-[var(--ink2)]">
              <FileLock2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span><strong className="text-[var(--ink)]">Clinical notes</strong> — not stored in UpNow OS. Open the clinic EMR for the encounter record.</span>
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={!!asking} onClose={() => setAsking(null)} title="Reveal patient details" subtitle={asking ? `Patient ${asking.customer}` : ''}
        footer={<><Button variant="secondary" onClick={() => setAsking(null)}>Cancel</Button><Button disabled={!ack} onClick={() => {
          patch('work', asking!.id, {}, `Patient details revealed — ${reason}`);
          setRevealed([...revealed, asking!.id]); setAsking(null);
        }}>Reveal</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Reason"><SelectInput value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS} /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this access is logged with my name, the time and the reason, and may be reviewed.</label>
        </div>
      </Modal>
    </div>
  );
}

export function HealthPractitioners() {
  const items = useWork('clinic').filter((w) => w.date === TODAY);
  return (
    <div>
      <ModuleHeader v="health" title="Practitioners" model="Clinical appointment" subtitle="Each practitioner needs a valid DHA professional licence to be bookable. Expiring licences block new appointments after the expiry date." />
      <div className="grid gap-3 md:grid-cols-2">
        {PRACTITIONERS.map((p) => {
          const days = dayDiff(TODAY, p.expires);
          return (
            <Card key={p.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-bold">{p.name}</div><div className="text-sm text-[var(--ink3)]">{p.specialty}</div></div>
                {days < 90 ? <Badge tone="amber">Licence expires in {days} days</Badge> : <Badge tone="green">Licence valid</Badge>}
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
                <dt className="text-[var(--ink3)]">DHA licence</dt><dd className="font-mono text-xs">{p.licence}</dd>
                <dt className="text-[var(--ink3)]">Expires</dt><dd>{fmtDate(p.expires)}</dd>
                <dt className="text-[var(--ink3)]">Clinic days</dt><dd>{p.days}</dd>
                <dt className="text-[var(--ink3)]">Today</dt><dd>{items.filter((w) => w.meta.practitioner === p.id).length} appointments</dd>
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
