'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Inbox, Phone, MessageCircle, ArrowRightLeft, ExternalLink, Lock } from 'lucide-react';
import { useProto } from '../store';
import { SharedTabs } from '../bridgeFrame';

import { MODEL_INFO, SUB, VERTICAL } from '../registry';
import { DATASETS } from '../datasets';
import { packHref } from '../nav';
import { COURTS, COURT_HOURS, MEMBERSHIP_PLANS, PRACTITIONERS, SERVICE_STAFF, STAY_UNITS, TODAY, VESSELS } from '../seed';
import {
  Badge, Button, Chips, Drawer, Empty, Field, Modal, PageHeader, ProtoNote, SearchBox, SelectInput, Stepper,
  StatusBadge, Table, Td, TextInput, VerticalTag, fmtDate, hourLabel,
} from '../ui';
import type { Lead, OperatingModel, VerticalId, WorkItem } from '../types';

const STAGES: Lead['stage'][] = ['new', 'contacted', 'qualified', 'converted', 'lost'];

/** What "convert" produces for each operating model. */
const CONVERT: Record<OperatingModel, { cta: string; dataset?: string; stage?: string; result: string }> = {
  lease: { cta: 'Schedule viewing', result: 'Handed to the production lease pipeline (Leads › Viewing)' },
  stay: { cta: 'Hold dates', dataset: 'stays', stage: 'requested', result: 'Stay reservation (dates held, host to confirm)' },
  venue: { cta: 'Create quote', dataset: 'venue_events', stage: 'quote_sent', result: 'Event quote sent' },
  slot: { cta: 'Book slot', dataset: 'courts', stage: 'confirmed', result: 'Court slot booked' },
  charter: { cta: 'Create charter', dataset: 'charters', stage: 'enquiry', result: 'Charter awaiting deposit' },
  field_job: { cta: 'Create job', dataset: 'jobs', stage: 'request', result: 'Field-service job request' },
  appointment: { cta: 'Book appointment', dataset: 'appointments', stage: 'confirmed', result: 'Appointment confirmed' },
  project_quote: { cta: 'Start project quote', dataset: 'projects', stage: 'brief', result: 'Project brief created' },
  session: { cta: 'Reserve seats', dataset: 'reservations', stage: 'pending', result: 'Seat reservation pending payment' },
  subscription: { cta: 'Book free visit', dataset: 'members', stage: 'trial', result: 'Trial member created' },
  credits: { cta: 'Sell package', dataset: 'members', stage: 'active', result: 'Credit package issued' },
  admission: { cta: 'Open application', dataset: 'applications', stage: 'submitted', result: 'Admission application opened' },
  enrolment: { cta: 'Open application', dataset: 'applications', stage: 'submitted', result: 'Enrolment application opened' },
  clinical: { cta: 'Offer appointment', dataset: 'clinic', stage: 'requested', result: 'Clinic appointment requested' },
  insurance_quote: { cta: 'Open quote request', dataset: 'quote_requests', stage: 'new', result: 'Quote request routed to insurers' },
};

export function DemandView() {
  const { org, leads, context, approvedVerticals, patch } = useProto();
  const [vf, setVf] = useState<'all' | VerticalId>('all');
  const [sf, setSf] = useState<'open' | Lead['stage']>('open');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);

  const mine = leads.filter((l) => l.orgId === context);
  const rows = useMemo(() => mine
    .filter((l) => vf === 'all' || SUB[l.subKey].vertical === vf)
    .filter((l) => (sf === 'open' ? ['new', 'contacted', 'qualified'].includes(l.stage) : l.stage === sf))
    .filter((l) => !q || `${l.customer} ${l.listing} ${l.id}`.toLowerCase().includes(q.toLowerCase())), [mine, vf, sf, q]);

  const lead = mine.find((l) => l.id === openId) ?? null;
  const convertLead = mine.find((l) => l.id === convertId) ?? null;
  const verticals = approvedVerticals(org);

  return (
    <div>
      {approvedVerticals(org).includes('spaces') && <SharedTabs slug="demand" active="/prototype/os/demand" />}
      <PageHeader
        eyebrow={<Badge tone="green">Shared module</Badge>}
        title="Demand"
        subtitle="One enquiry inbox for every vertical. Qualification is the same everywhere; conversion hands the enquiry to the workspace that runs that operating model."
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          value={vf}
          onChange={setVf}
          items={[{ id: 'all', label: `All verticals (${mine.length})` }, ...verticals.map((v) => ({ id: v, label: `${VERTICAL[v].label} (${mine.filter((l) => SUB[l.subKey].vertical === v).length})` }))]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Search customer or listing" />
      </div>
      <div className="mb-4">
        <Chips value={sf} onChange={setSf} items={[{ id: 'open', label: 'Open' }, ...STAGES.map((s) => ({ id: s, label: <span className="capitalize">{s}</span> }))]} />
      </div>

      {rows.length === 0 ? <Empty icon={<Inbox className="h-6 w-6" />} title="No enquiries match" body="Try another vertical or stage filter." /> : (
        <Table head={['Enquiry', 'Customer', 'Subcategory', 'Source', 'Received', 'Stage', 'Assignee', '']}>
          {rows.map((l) => {
            const s = SUB[l.subKey];
            return (
              <tr key={l.id} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => setOpenId(l.id)}>
                <Td><div className="font-semibold">{l.listing}</div><div className="text-xs text-[var(--ink3)]">{l.id}</div></Td>
                <Td>{s.model === 'clinical' ? <span className="inline-flex items-center gap-1 text-[var(--ink3)]"><Lock className="h-3.5 w-3.5" aria-hidden /> Restricted</span> : l.customer}</Td>
                <Td><div className="flex flex-col items-start gap-1"><VerticalTag v={s.vertical} /><span className="text-xs text-[var(--ink3)]">{s.label} · {MODEL_INFO[s.model].label}</span></div></Td>
                <Td>{l.source}</Td>
                <Td className="whitespace-nowrap">{fmtDate(l.received)}</Td>
                <Td><StatusBadge status={l.stage} /></Td>
                <Td>{l.assignee}</Td>
                <Td>
                  {['new', 'contacted', 'qualified'].includes(l.stage) && (
                    <Button size="sm" variant="subtle" onClick={(e) => { e.stopPropagation(); setConvertId(l.id); }}>{CONVERT[s.model].cta}</Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {lead && (() => {
        const s = SUB[lead.subKey];
        const stepIdx = lead.stage === 'new' ? 0 : lead.stage === 'converted' ? 2 : 1;
        return (
          <Drawer
            open
            onClose={() => setOpenId(null)}
            title={lead.listing}
            subtitle={<span className="flex flex-wrap items-center gap-2"><VerticalTag v={s.vertical} /> {s.label} · {lead.id}</span>}
            footer={['new', 'contacted', 'qualified'].includes(lead.stage) ? (
              <>
                <Button variant="danger" size="sm" onClick={() => patch('leads', lead.id, { stage: 'lost' }, 'Enquiry marked lost')}>Mark lost</Button>
                {lead.stage === 'new' && <Button variant="secondary" size="sm" onClick={() => patch('leads', lead.id, { stage: 'contacted' }, 'Enquiry marked contacted')}>Mark contacted</Button>}
                {lead.stage !== 'qualified' && <Button variant="secondary" size="sm" onClick={() => patch('leads', lead.id, { stage: 'qualified' }, 'Enquiry qualified')}>Qualify</Button>}
                <Button size="sm" onClick={() => setConvertId(lead.id)}><ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />{CONVERT[s.model].cta}</Button>
              </>
            ) : undefined}
          >
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-2"><StatusBadge status={lead.stage} /><span className="text-[var(--ink3)]">via {lead.source} · {fmtDate(lead.received)}</span></div>
              {s.model === 'clinical' ? (
                <ProtoNote kind="info">Health enquiries are restricted. Patient identity and the message are visible to clinical staff only; this inbox shows that a request exists and who owns it.</ProtoNote>
              ) : (
                <div className="rounded-xl bg-[var(--bg)] p-3">
                  <div className="font-semibold text-[var(--ink)]">{lead.customer}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--ink3)]"><span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" aria-hidden />{lead.phone}</span><span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" aria-hidden />{lead.source}</span></div>
                  <p className="mt-2 text-[var(--ink2)]">“{lead.message}”</p>
                </div>
              )}
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">Shared qualification</div>
                <Stepper steps={['New', 'Contacted / qualified', 'Converted']} current={stepIdx} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">After conversion · {MODEL_INFO[s.model].label}</div>
                <Stepper steps={s.flow} current={lead.stage === 'converted' ? 1 : 0} />
                <p className="mt-2 text-xs text-[var(--ink3)]">This part of the journey is owned by the {VERTICAL[s.vertical].label} pack, not by Demand.</p>
              </div>
              {lead.channel && <div className="text-xs text-[var(--ink3)]">Customer contacted you by <strong className="text-[var(--ink)]">{lead.channel === 'Form' ? `the “${s.cta}” form` : lead.channel}</strong> from the marketplace listing.</div>}
              {(lead.messages ?? []).length > 0 && s.model !== 'clinical' && (
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">Conversation</div>
                  <ul className="flex flex-col gap-1.5">
                    {(lead.messages ?? []).map((m, i) => (
                      <li key={i} className={m.from === 'provider' ? 'self-end rounded-xl bg-[var(--g1)] px-3 py-2 text-[13px]' : 'rounded-xl border border-[var(--line)] px-3 py-2 text-[13px]'}>
                        <span className="font-semibold">{m.from === 'provider' ? 'You' : lead.customer}:</span> {m.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link href="/prototype/os/communications" className="text-[13px] font-bold text-[var(--g7)] hover:underline">Reply in Communications →</Link>
              {lead.convertedTo && <ProtoNote kind="info">Converted → {lead.convertedTo}</ProtoNote>}
              <div className="text-xs text-[var(--ink3)]">Assigned to <strong className="text-[var(--ink)]">{lead.assignee}</strong></div>
            </div>
          </Drawer>
        );
      })()}

      {convertLead && <ConvertModal lead={convertLead} onClose={() => { setConvertId(null); setOpenId(null); }} />}
    </div>
  );
}

function ConvertModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { add, patch, nextId, context, work } = useProto();
  const s = SUB[lead.subKey];
  const c = CONVERT[s.model];
  const [date, setDate] = useState(TODAY);
  const [time, setTime] = useState('18:00');
  const [choice, setChoice] = useState('');
  const [num, setNum] = useState(2);

  const sessions = work.filter((w) => w.dataset === 'sessions' && w.orgId === context && w.stage === 'scheduled');
  const options: Record<string, string[]> = {
    stay: STAY_UNITS.map((u) => u.name),
    slot: COURTS,
    charter: VESSELS.map((v) => v.name),
    appointment: SERVICE_STAFF,
    session: sessions.map((x) => `${x.id} · ${x.title} · ${fmtDate(x.date)}`),
    subscription: MEMBERSHIP_PLANS.map((p) => p.name),
    credits: MEMBERSHIP_PLANS.map((p) => p.name),
    clinical: PRACTITIONERS.map((p) => p.name),
  };
  const opts = options[s.model];
  const picked = choice || opts?.[0] || '';
  const ds = c.dataset ? DATASETS[c.dataset] : null;

  function submit() {
    if (!c.dataset) {
      patch('leads', lead.id, { stage: 'converted', convertedTo: `Viewing ${fmtDate(date)} ${time} — production lease pipeline` }, 'Viewing scheduled (handed to lease pipeline)');
      onClose();
      return;
    }
    const meta: WorkItem['meta'] = {};
    let title = lead.listing;
    switch (s.model) {
      case 'stay': Object.assign(meta, { unit: STAY_UNITS.find((u) => u.name === picked)?.id ?? 'su1', nights: num, guests: 2 }); title = `${num} nights`; break;
      case 'slot': Object.assign(meta, { court: picked, hour: Number(time.slice(0, 2)), recurring: 'One-off' }); title = 'Padel · booking'; break;
      case 'charter': Object.assign(meta, { vessel: picked, guests: num, manifest: 0 }); title = `Charter · ${num} guests`; break;
      case 'appointment': Object.assign(meta, { staff: picked, hour: Number(time.slice(0, 2)), duration: 45 }); title = SUB[lead.subKey].label; break;
      case 'session': Object.assign(meta, { session: picked.split(' · ')[0], seats: num, pickup: '—' }); title = `${picked.split(' · ')[1] ?? 'Session'} · ${num} seats`; break;
      case 'subscription': case 'credits': Object.assign(meta, { plan: picked, credits: s.model === 'credits' ? 20 : 0, renews: '—', checkins: 0 }); title = picked; break;
      case 'clinical': Object.assign(meta, { practitioner: PRACTITIONERS.find((p) => p.name === picked)?.id ?? 'p1', hour: Number(time.slice(0, 2)), patient: 'Restricted', reason: 'Restricted', insurer: '—' }); title = 'Consultation'; break;
      case 'admission': case 'enrolment': Object.assign(meta, { child: '—', program: lead.listing }); break;
      case 'insurance_quote': Object.assign(meta, { product: s.label, quotes: 0, best: 0 }); break;
      default: Object.assign(meta, { sub: s.label, area: '—' });
    }
    const id = nextId(ds!.noun.slice(0, 2).toUpperCase());
    add('work', { id, orgId: context, dataset: c.dataset, title, customer: s.model === 'clinical' ? 'P-NEW' : lead.customer, stage: c.stage!, date, time, meta, amount: 0 });
    patch('leads', lead.id, { stage: 'converted', convertedTo: `${c.result} (${id})` }, `Converted ${lead.id} → ${c.result}`);
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={c.cta}
      subtitle={<span className="flex flex-wrap items-center gap-2"><VerticalTag v={s.vertical} /> {s.label} · {MODEL_INFO[s.model].label}</span>}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>{c.cta}</Button></>}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--ink3)]">Creates: <strong className="text-[var(--ink)]">{c.result}</strong>{ds && <> in <Link className="font-semibold text-[var(--g7)] underline" href={packHref(ds.vertical, ds.module)}>{VERTICAL[ds.vertical].label} › {ds.noun}s</Link></>}.</p>
        {s.model === 'lease' && (
          <ProtoNote kind="info">
            Long-term leases are not booked here. Conversion schedules a viewing in the existing lease engine (production route <code>/rental-provider/dashboard/leads</code>), which then runs documents, cheque plan, contract, Ejari and move-in unchanged.
            <Link href="/prototype/os/rp/leads" className="mt-1 inline-flex items-center gap-1 font-semibold underline">Open the live Spaces lease pipeline <ExternalLink className="h-3 w-3" aria-hidden /></Link>
          </ProtoNote>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {opts && (
            <Field label={{ stay: 'Unit', slot: 'Court', charter: 'Vessel', appointment: 'Staff member', session: 'Session', subscription: 'Plan', credits: 'Package', clinical: 'Practitioner' }[s.model as string] ?? 'Option'}>
              <SelectInput value={picked} onChange={(e) => setChoice(e.target.value)} options={opts.length ? opts : ['No scheduled sessions']} />
            </Field>
          )}
          {s.model !== 'session' && <Field label={s.model === 'stay' ? 'Check-in' : 'Date'}><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
          {['lease', 'slot', 'appointment', 'clinical', 'charter', 'field_job'].includes(s.model) && (
            <Field label="Time">
              {['slot', 'appointment', 'clinical'].includes(s.model)
                ? <SelectInput value={time} onChange={(e) => setTime(e.target.value)} options={(s.model === 'slot' ? COURT_HOURS : [9, 10, 11, 12, 13, 14, 15, 16, 17]).map((h) => hourLabel(h))} />
                : <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          )}
          {['stay', 'charter', 'session'].includes(s.model) && (
            <Field label={s.model === 'stay' ? 'Nights' : s.model === 'charter' ? 'Guests' : 'Seats'}>
              <TextInput type="number" min={1} value={num} onChange={(e) => setNum(Math.max(1, Number(e.target.value)))} />
            </Field>
          )}
        </div>
        {s.model === 'clinical' && <ProtoNote kind="info">Only booking metadata is stored in UpNow OS. Intake, consent and clinical notes stay in the clinic’s own records system.</ProtoNote>}
        {s.model === 'insurance_quote' && <ProtoNote kind="info">Regulated activity: the request is routed to licensed insurers on your panel. Policies are issued by the insurer, not by UpNow.</ProtoNote>}
      </div>
    </Modal>
  );
}
