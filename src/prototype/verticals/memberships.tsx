'use client';

import { useState } from 'react';
import { toast } from '../toast';
import { Check, Plus, Minus } from 'lucide-react';
import { useProto, useWork } from '../store';
import { MEMBERSHIP_PLANS, TODAY } from '../seed';
import { addDays } from '../datasets';
import { Button, Card, Chips, Field, Meter, Modal, ProtoNote, Stat, StatusBadge, Table, Td, TextInput, fmtAed, fmtDate } from '../ui';
import { ModuleHeader } from './common';
import type { WorkItem } from '../types';

export function MembershipPlans() {
  const [plans, setPlans] = useState(MEMBERSHIP_PLANS);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(350);
  const [benefit, setBenefit] = useState('Off-peak access (06:00–16:00)');
  return (
    <div>
      <ModuleHeader v="memberships" title="Plans" model="Subscription · credits"
        subtitle="Recurring plans grant access; credit packages grant a number of sessions. Both renew or expire — they are entitlements, not bookings."
        actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />New plan</Button>} />
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between"><span className="text-lg font-bold">{p.name}</span><span className="text-sm text-[var(--ink3)]">{p.members} members</span></div>
            <div className="text-2xl font-extrabold">{fmtAed(p.price)}<span className="text-sm font-normal text-[var(--ink3)]">{p.unit}</span></div>
            <ul className="flex flex-col gap-1.5 text-sm">{p.benefits.map((b) => <li key={b} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g9)]" aria-hidden />{b}</li>)}</ul>
          </Card>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New plan"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!name} onClick={() => {
          setPlans([...plans, { id: `pl${plans.length + 1}`, name, price, unit: '/month', benefits: [benefit], members: 0 }]);
          toast.success(`Plan “${name}” created`, { description: 'Simulated — prototype data only' }); setOpen(false); setName('');
        }}>Create plan</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan name"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Off-peak" /></Field>
          <Field label="Price (AED / month)"><TextInput type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field>
          <Field label="Main benefit"><TextInput value={benefit} onChange={(e) => setBenefit(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}

export function MembershipMembers() {
  const members = useWork('members');
  const { patch } = useProto();
  const [f, setF] = useState<'all' | string>('all');
  const rows = members.filter((m) => f === 'all' || m.stage === f);

  function renew(m: WorkItem) {
    const months = m.meta.plan === 'Annual' ? 12 : m.meta.plan === 'Monthly' ? 1 : 4;
    const base = String(m.meta.renews) !== '—' && String(m.meta.renews) > TODAY ? String(m.meta.renews) : TODAY;
    patch('work', m.id, { stage: 'active', meta: { ...m.meta, renews: addDays(base, months * 30) } }, `Membership renewed (${m.meta.plan})`);
  }

  return (
    <div>
      <ModuleHeader v="memberships" title="Members" model="Subscription"
        subtitle="Subscriptions with their lifecycle: free visit → active → frozen → renewal due → renewed or expired. Check-ins record usage." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={members.filter((m) => m.stage === 'active').length} />
        <Stat label="Free visits booked" value={members.filter((m) => m.stage === 'trial').length} sub="Convert after the visit" />
        <Stat label="Renewals due" value={members.filter((m) => m.stage === 'renewal_due').length} tone="warn" sub="Within 7 days" />
        <Stat label="Frozen" value={members.filter((m) => m.stage === 'frozen').length} sub="Billing paused" />
      </div>
      <div className="mb-4"><Chips value={f} onChange={setF} items={['all', 'trial', 'active', 'frozen', 'renewal_due', 'expired'].map((s) => ({ id: s, label: s === 'all' ? 'All' : <StatusBadge status={s} /> }))} /></div>
      <Table head={['Member', 'Plan', 'Since', 'Renews', 'Check-ins', 'Status', '']}>
        {rows.map((m) => (
          <tr key={m.id}>
            <Td className="font-semibold">{m.customer}</Td>
            <Td>{m.meta.plan}</Td>
            <Td className="whitespace-nowrap">{fmtDate(m.date)}</Td>
            <Td className="whitespace-nowrap">{fmtDate(String(m.meta.renews))}</Td>
            <Td>{m.meta.checkins}</Td>
            <Td><StatusBadge status={m.stage} /></Td>
            <Td>
              <div className="flex justify-end gap-1.5">
                {m.stage === 'trial' && <Button size="sm" variant="subtle" onClick={() => patch('work', m.id, { stage: 'active', date: TODAY, meta: { ...m.meta, renews: addDays(TODAY, 30) } }, 'Free visit converted — terms signed')}>Convert to member</Button>}
                {m.stage === 'active' && <Button size="sm" variant="secondary" onClick={() => patch('work', m.id, { meta: { ...m.meta, checkins: Number(m.meta.checkins) + 1 } }, 'Check-in recorded')}>Check in</Button>}
                {m.stage === 'active' && <Button size="sm" variant="ghost" onClick={() => patch('work', m.id, { stage: 'frozen' }, 'Membership frozen')}>Freeze</Button>}
                {m.stage === 'frozen' && <Button size="sm" variant="subtle" onClick={() => patch('work', m.id, { stage: 'active' }, 'Membership unfrozen')}>Unfreeze</Button>}
                {(m.stage === 'renewal_due' || m.stage === 'expired') && <Button size="sm" variant="subtle" onClick={() => renew(m)}>Renew</Button>}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <div className="mt-4"><ProtoNote>Recurring card billing, proration and freeze rules are not simulated; the prototype only shows the membership states.</ProtoNote></div>
    </div>
  );
}

export function MembershipCredits() {
  const holders = useWork('members').filter((m) => m.meta.plan === '20-class pack');
  const { patch } = useProto();
  const [ledger, setLedger] = useState<{ at: string; who: string; delta: number; note: string }[]>([
    { at: '14 Oct, 18:00', who: 'Elena Petrova', delta: -1, note: 'Yoga flow · Studio B' },
    { at: '13 Oct, 07:00', who: 'Sophie Laurent', delta: -1, note: 'Pilates reformer' },
    { at: '2 Sep, 10:12', who: 'Sophie Laurent', delta: 20, note: 'Package purchased' },
  ]);
  function move(m: WorkItem, delta: number, note: string) {
    const next = Number(m.meta.credits) + delta;
    if (next < 0) { toast.error('No credits left', { description: 'Offer a top-up package.' }); return; }
    patch('work', m.id, { meta: { ...m.meta, credits: next } }, delta < 0 ? 'Credit used — session booked' : 'Credits topped up');
    setLedger([{ at: 'Just now', who: m.customer, delta, note }, ...ledger]);
  }
  return (
    <div>
      <ModuleHeader v="memberships" title="Credits ledger" model="Credit entitlement"
        subtitle="Credit packages are a ledger: credits are issued on purchase, debited per session, and expire after the validity period." />
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        {holders.map((m) => (
          <Card key={m.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between"><span className="font-bold">{m.customer}</span><span className="text-xs text-[var(--ink3)]">Expires {fmtDate(String(m.meta.renews))}</span></div>
            <Meter value={Number(m.meta.credits)} max={20} label={`${m.meta.credits} of 20 left`} />
            <div className="flex gap-1.5">
              <Button size="sm" variant="subtle" onClick={() => move(m, -1, 'Class booked')}><Minus className="h-3.5 w-3.5" aria-hidden />Use 1 credit</Button>
              <Button size="sm" variant="secondary" onClick={() => move(m, 20, 'Top-up package')}><Plus className="h-3.5 w-3.5" aria-hidden />Top up 20</Button>
            </div>
          </Card>
        ))}
      </div>
      <Table head={['When', 'Member', 'Change', 'Note']}>
        {ledger.map((l, i) => (
          <tr key={i}>
            <Td className="text-xs">{l.at}</Td>
            <Td>{l.who}</Td>
            <Td className={l.delta < 0 ? 'font-semibold text-[var(--red)]' : 'font-semibold text-[var(--g7)]'}>{l.delta > 0 ? `+${l.delta}` : l.delta}</Td>
            <Td>{l.note}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
