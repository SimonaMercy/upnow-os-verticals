'use client';

/**
 * PROTOTYPE ONLY — a listing as the customer sees it, with the MarketSpace
 * contact options: the subcategory's own action (enquiry form, e.g. "Request a
 * viewing"), Chat, WhatsApp and Call (upnow-marketspace js/pages/listing.js).
 *
 * Contacting creates a lead for the listing's business — it lands in that
 * business's Demand and Communications. Nothing is sent outside the demo.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BadgeCheck, MessageCircle, MessagesSquare, Phone, ShieldCheck, Lock } from 'lucide-react';
import { useProto } from '../../store';
import { MODEL_INFO, SUB, VERTICAL } from '../../registry';
import { TODAY } from '../../seed';
import { Badge, Button, Card, Empty, Field, Modal, ProtoNote, SectionTitle, Stepper, TextArea, TextInput, VerticalTag, fmtAed } from '../../ui';
import type { ContactChannel, OperatingModel } from '../../types';
import { ME, usePersona } from './MeShell';

const DATED: OperatingModel[] = ['lease', 'stay', 'venue', 'slot', 'charter', 'appointment', 'field_job', 'session', 'clinical', 'admission', 'enrolment', 'subscription'];
const PEOPLE: OperatingModel[] = ['stay', 'venue', 'slot', 'charter', 'session'];

function stampNow() {
  const d = new Date();
  return `${TODAY} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ListingDetailView({ id }: { id: string }) {
  const { listings, orgs, add, patch, nextId, customers, setPersona } = useProto();
  const router = useRouter();
  const person = usePersona();
  const [channel, setChannel] = useState<ContactChannel | null>(null);
  const [date, setDate] = useState('2026-10-24');
  const [people, setPeople] = useState(2);
  const [msg, setMsg] = useState('');

  const l = listings.find((x) => x.id === id && x.status === 'published');
  if (!l) return <Empty title="This listing is not available" body="It may have been unpublished or is still in review." action={<Link href={`${ME}/browse`}><Button size="sm">Back to the marketplace</Button></Link>} />;
  const s = SUB[l.subKey];
  const org = orgs.find((o) => o.id === l.orgId)!;
  const own = person.ownsBusinesses && org.members.some((m) => m.name === person.name);
  const phone = `+971 4 ${(300 + org.id.charCodeAt(1)).toString()} ${org.tradeLicence.slice(-4)}`;
  const Icon = VERTICAL[s.vertical].icon;
  const assignee = org.members.find((m) => m.role !== 'owner' && m.packs.includes(s.vertical))?.name ?? org.members[0].name;

  function send() {
    if (!channel) return;
    const details = [
      DATED.includes(s.model) && `Preferred date: ${date}`,
      PEOPLE.includes(s.model) && `People: ${people}`,
    ].filter(Boolean).join(' · ');
    const text = channel === 'Call' ? `Call requested${msg.trim() ? ` — ${msg.trim()}` : ''}` : [msg.trim() || `Interested in ${l!.title}.`, details].filter(Boolean).join(' — ');
    const leadId = nextId('Q');
    add('leads', {
      id: leadId, orgId: org.id, subKey: l!.subKey, customer: person.name, phone: person.phone,
      source: channel === 'WhatsApp' ? 'WhatsApp' : channel === 'Call' ? 'Phone' : 'UpNow', channel,
      listing: l!.title, listingId: l!.id, received: stampNow(), stage: 'new', assignee, message: text, messages: [],
    }, `Enquiry sent to ${org.name}`);
    // One customer record per business: create it on first contact, otherwise tag the new vertical.
    const existing = customers.find((c) => c.name === person.name);
    if (!existing) add('customers', { id: nextId('C'), name: person.name, email: person.email, phone: person.phone, since: TODAY, tags: [s.vertical], lifetimeValue: 0 });
    else if (!existing.tags.includes(s.vertical)) patch('customers', existing.id, { tags: [...existing.tags, s.vertical] });
    setChannel(null);
    router.push(`${ME}/enquiries?open=${leadId}`);
  }

  const channelTitle: Record<ContactChannel, string> = { Form: s.cta, Chat: 'Chat with the provider', WhatsApp: 'Message on WhatsApp', Call: 'Call the provider' };

  return (
    <div>
      <Link href={`${ME}/browse`} className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--g7)] hover:underline"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Marketplace</Link>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid h-56 place-items-center rounded-[var(--r)] bg-gradient-to-br from-[var(--g1)] to-[var(--g2)]"><Icon className="h-14 w-14 text-[var(--g7)] opacity-60" aria-hidden /></div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2"><VerticalTag v={s.vertical} /><Badge tone="neutral" dot={false}>{s.label}</Badge><span className="text-[12px] text-[var(--ink3)]">Ref {l.id}</span></div>
            <h1 className="ms-serif text-[32px] leading-tight text-[var(--g9)]">{l.title}</h1>
            <p className="mt-1 text-[14px] text-[var(--ink3)]">{l.asset}</p>
          </div>
          <Card>
            <SectionTitle>Details</SectionTitle>
            <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-[14px]">
              {s.fields.map((f) => <div key={f.id} className="contents"><dt className="text-[var(--ink3)]">{f.label}</dt><dd>{l.attributes[f.id] ?? '—'}</dd></div>)}
              <dt className="text-[var(--ink3)]">Pricing</dt><dd>{s.priceBasis}</dd>
            </dl>
          </Card>
          <Card>
            <SectionTitle>How it works</SectionTitle>
            <Stepper steps={s.flow} current={-1} />
            <p className="mt-3 text-[13px] text-[var(--ink3)]">{MODEL_INFO[s.model].label}. You deal with the provider directly; UpNow passes on your enquiry.</p>
          </Card>
        </div>

        <aside className="flex flex-col gap-3">
          <Card className="flex flex-col gap-3">
            <div className="text-[26px] font-extrabold tracking-[-0.02em]">{fmtAed(l.price)}<span className="text-[13px] font-medium text-[var(--ink3)]"> {s.priceUnit}</span></div>
            {own ? (
              <>
                <ProtoNote kind="info">This listing belongs to <strong>{org.name}</strong>, one of your own businesses. Browse as the demo customer to try contacting it.</ProtoNote>
                <Button variant="secondary" onClick={() => setPersona('guest')}>Browse as Sam Carter</Button>
              </>
            ) : (
              <>
                <Button onClick={() => setChannel('Form')}>{s.cta}</Button>
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setChannel('Chat')}><MessagesSquare className="h-4 w-4" aria-hidden />Chat</Button>
                  <Button variant="secondary" size="sm" className="border-[#bfe2cf] text-[#14853f] hover:border-[#14853f] hover:text-[#14853f]" onClick={() => setChannel('WhatsApp')}><MessageCircle className="h-4 w-4" aria-hidden />WhatsApp</Button>
                  <Button variant="secondary" size="sm" onClick={() => setChannel('Call')}><Phone className="h-4 w-4" aria-hidden />Call</Button>
                </div>
              </>
            )}
          </Card>
          <Card className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--g7)] text-[14px] font-extrabold text-white">{org.initials}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-bold">{org.name}{org.status === 'verified' && <BadgeCheck className="h-4 w-4 text-[var(--g7)]" aria-label="Verified" />}</div>
                <div className="text-[12.5px] text-[var(--ink3)]">{org.status === 'verified' ? 'Verified by UpNow' : 'Verification pending'}</div>
              </div>
            </div>
            {s.regulator && <div className="flex items-center gap-1.5 text-[13px] text-[var(--ink2)]"><ShieldCheck className="h-4 w-4 text-[var(--g7)]" aria-hidden />Regulated: {s.regulator}</div>}
          </Card>
          {s.model === 'clinical' && <ProtoNote kind="info"><Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden />Please don’t share medical details in your message — the clinic contacts you to take them securely.</ProtoNote>}
          {s.model === 'insurance_quote' && <ProtoNote kind="info">A licensed broker contacts you with quotes. The policy is issued by the insurer.</ProtoNote>}
        </aside>
      </div>

      <Modal open={!!channel} onClose={() => setChannel(null)} title={channel ? channelTitle[channel] : ''} subtitle={`${l.title} · ${org.name}`}
        footer={<><Button variant="secondary" onClick={() => setChannel(null)}>Cancel</Button><Button onClick={send}>{channel === 'Call' ? 'Log call request' : 'Send enquiry'}</Button></>}>
        <div className="flex flex-col gap-3">
          {channel === 'Call' && <div className="rounded-xl bg-[var(--g1)] p-3 text-[14px]"><span className="text-[var(--ink3)]">Provider phone</span><div className="text-[18px] font-extrabold text-[var(--g8)]">{phone}</div><span className="text-[12.5px] text-[var(--ink3)]">The call is logged as an enquiry so the provider can follow up.</span></div>}
          {channel === 'WhatsApp' && <ProtoNote kind="info">In production this opens WhatsApp with the listing reference. Here the message is logged on the provider’s WhatsApp line.</ProtoNote>}
          {channel !== 'Call' && DATED.includes(s.model) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={s.model === 'lease' ? 'Preferred move-in / viewing date' : 'Preferred date'}><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {PEOPLE.includes(s.model) && <Field label={s.model === 'session' ? 'Seats' : 'Guests'}><TextInput type="number" min={1} value={people} onChange={(e) => setPeople(Math.max(1, Number(e.target.value)))} /></Field>}
            </div>
          )}
          <Field label={channel === 'Call' ? 'Note (optional)' : 'Message'}>
            <TextArea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={s.model === 'clinical' ? 'e.g. Earliest appointment this week (no medical details)' : `Hi, I’m interested in ${l.title}.`} />
          </Field>
          <p className="text-[12.5px] text-[var(--ink3)]">Sent as {person.name} · {person.phone}. Simulated — nothing leaves the demo.</p>
        </div>
      </Modal>
    </div>
  );
}
