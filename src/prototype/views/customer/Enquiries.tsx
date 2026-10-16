'use client';

/**
 * PROTOTYPE ONLY — the customer's enquiries and conversations. The same lead
 * records the provider works in Demand and Communications, seen from the
 * customer's side.
 */
import { useState } from 'react';
import Link from 'next/link';
import { MessagesSquare, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../../store';
import { toast } from '../../toast';
import { SUB } from '../../registry';
import { TODAY } from '../../seed';
import { Badge, Button, Empty, PageHeader, VerticalTag, fmtDate } from '../../ui';
import type { Lead } from '../../types';
import { ME, usePersona } from './MeShell';

/** Lead stage in the customer's words. */
function customerStatus(l: Lead): [string, 'blue' | 'green' | 'amber' | 'neutral' | 'violet'] {
  const replied = (l.messages ?? []).some((m) => m.from === 'provider');
  switch (l.stage) {
    case 'new': return replied ? ['Provider replied', 'violet'] : ['Sent', 'blue'];
    case 'contacted': return ['Provider replied', 'violet'];
    case 'qualified': return ['In discussion', 'amber'];
    case 'converted': return ['Confirmed', 'green'];
    default: return ['Closed', 'neutral'];
  }
}

export function EnquiriesView({ openId }: { openId?: string }) {
  const { leads, orgs, patch } = useProto();
  const person = usePersona();
  const [sel, setSel] = useState<string | undefined>(openId);
  const [draft, setDraft] = useState('');
  const mine = leads.filter((l) => l.customer === person.name).sort((a, b) => b.received.localeCompare(a.received));
  const cur = mine.find((l) => l.id === sel) ?? mine[0];

  if (mine.length === 0) {
    return (
      <div>
        <PageHeader title="My enquiries" subtitle="Everything you have asked providers, and their replies." />
        <Empty icon={<MessagesSquare className="h-6 w-6" />} title="No enquiries yet" body="Find a listing in the marketplace and contact the provider." action={<Link href={`${ME}/browse`}><Button size="sm">Browse the marketplace</Button></Link>} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My enquiries" subtitle="Everything you have asked providers, and their replies. Providers see the same conversation in their Demand and Communications." />
      <div className="grid overflow-hidden rounded-[var(--r)] border border-[var(--line)] bg-white md:grid-cols-[320px_1fr]">
        <ul className="max-h-[560px] overflow-y-auto border-b border-[var(--line)] md:border-b-0 md:border-r">
          {mine.map((l) => {
            const [label, tone] = customerStatus(l);
            const org = orgs.find((o) => o.id === l.orgId);
            return (
              <li key={l.id}>
                <button type="button" onClick={() => setSel(l.id)} className={cn('flex w-full flex-col gap-1 border-b border-[var(--line)] px-3.5 py-3 text-left hover:bg-[var(--bg)]', cur?.id === l.id && 'bg-[var(--g1)]')}>
                  <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[14px] font-bold">{l.listing}</span><Badge tone={tone}>{label}</Badge></span>
                  <span className="text-[12.5px] text-[var(--ink3)]">{org?.name} · via {l.channel ?? l.source} · {fmtDate(l.received)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {cur && (
          <div className="flex min-h-[420px] flex-col bg-[var(--bg)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-white px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{cur.listing}</div>
                <div className="truncate text-[12.5px] text-[var(--ink3)]">{orgs.find((o) => o.id === cur.orgId)?.name} · {SUB[cur.subKey].label}</div>
              </div>
              <VerticalTag v={SUB[cur.subKey].vertical} />
              {cur.listingId && <Link href={`${ME}/browse/${cur.listingId}`} className="text-[13px] font-bold text-[var(--g7)] hover:underline">View listing</Link>}
            </div>
            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
              <Bubble mine text={cur.message} at={cur.received} />
              {(cur.messages ?? []).map((m, i) => <Bubble key={i} mine={m.from === 'customer'} text={m.text} at={m.at} />)}
              {cur.stage === 'converted' && <div className="self-center rounded-full border border-dashed border-[var(--line2)] px-3 py-1 text-[12px] font-semibold text-[var(--ink2)]">Confirmed by the provider{cur.convertedTo ? ` — ${cur.convertedTo.split(' (')[0]}` : ''}</div>}
            </div>
            {cur.stage !== 'lost' && cur.channel !== 'Call' && (
              <div className="flex items-end gap-2 border-t border-[var(--line)] bg-white p-3">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} placeholder="Write a message…" aria-label="Message"
                  className="h-11 min-w-0 flex-1 resize-none rounded-xl border-[1.5px] border-[var(--line2)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--g6)]" />
                <Button disabled={!draft.trim()} onClick={() => {
                  patch('leads', cur.id, { messages: [...(cur.messages ?? []), { from: 'customer', text: draft.trim(), at: `${TODAY} ${new Date().toTimeString().slice(0, 5)}` }] });
                  setDraft('');
                  toast.success('Message sent', { description: 'Simulated — visible to the provider in Communications' });
                }}><Send className="h-4 w-4" aria-hidden />Send</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ mine, text, at }: { mine: boolean; text: string; at: string }) {
  return (
    <div className={cn('max-w-[78%] rounded-[14px] px-3.5 py-2.5 text-[14px]', mine ? 'self-end bg-[var(--g8)] text-white' : 'self-start border border-[var(--line)] bg-white')}>
      {text}
      <span className={cn('mt-1 block text-[11px]', mine ? 'text-[#b6dcc8]' : 'text-[var(--ink3)]')}>{fmtDate(at)}{mine ? ' · you' : ' · provider'}</span>
    </div>
  );
}
