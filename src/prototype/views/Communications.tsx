'use client';

/**
 * PROTOTYPE ONLY — shared Communications: one inbox across verticals.
 * Production equivalent today (Spaces only): /rental-provider/dashboard/communications (Emails)
 * and /whatsapp. Threads here are built from the demo enquiries; replies are simulated.
 */
import { useState } from 'react';
import { Lock, Mail, MessageCircle, MessagesSquare, Phone, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../store';
import { SharedTabs } from '../bridgeFrame';

import { toast } from '../toast';
import { SUB, VERTICAL } from '../registry';
import { TODAY } from '../seed';
import { Avatar, Badge, Button, Chips, Empty, PageHeader, ProtoNote, VerticalTag, fmtDate } from '../ui';
import type { VerticalId } from '../types';

const CHANNEL: Record<string, { label: string; icon: typeof Mail }> = {
  WhatsApp: { label: 'WhatsApp', icon: MessageCircle },
  Email: { label: 'Email', icon: Mail },
  Phone: { label: 'Call log', icon: Phone },
  Call: { label: 'Call log', icon: Phone },
  Chat: { label: 'UpNow chat', icon: MessagesSquare },
  Form: { label: 'Enquiry form', icon: Mail },
};

export function CommunicationsView() {
  const { leads, context, org, approvedVerticals, patch } = useProto();
  const [vf, setVf] = useState<'all' | VerticalId>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const verticals = approvedVerticals(org);

  const threads = leads
    .filter((l) => l.orgId === context && (vf === 'all' || SUB[l.subKey].vertical === vf))
    .sort((a, b) => b.received.localeCompare(a.received));
  const cur = threads.find((t) => t.id === sel) ?? threads[0];
  const restricted = cur && SUB[cur.subKey].model === 'clinical';

  return (
    <div>
      {approvedVerticals(org).includes('spaces') && <SharedTabs slug="communications" active="/prototype/os/communications" />}
      <PageHeader
        eyebrow={<Badge tone="green">Shared module</Badge>}
        title="Communications"
        subtitle="Every customer conversation for this business in one inbox, whatever the vertical. Replies go out on the channel the customer used."
      />
      <div className="mb-4"><Chips value={vf} onChange={setVf} items={[{ id: 'all', label: 'All verticals' }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} /></div>
      {threads.length === 0 ? <Empty icon={<Mail className="h-6 w-6" />} title="No conversations" /> : (
        <div className="grid overflow-hidden rounded-[var(--r)] border border-[var(--line)] bg-white md:grid-cols-[340px_1fr]">
          <ul className="max-h-[560px] overflow-y-auto border-b border-[var(--line)] md:border-b-0 md:border-r">
            {threads.map((t) => {
              const s = SUB[t.subKey];
              const ch = CHANNEL[t.channel ?? t.source] ?? { label: t.source, icon: MessageCircle };
              const unread = t.stage === 'new' || (t.messages ?? []).at(-1)?.from === 'customer';
              const Icon = ch.icon;
              const isClinical = s.model === 'clinical';
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setSel(t.id)}
                    className={cn('flex w-full gap-2.5 border-b border-[var(--line)] px-3.5 py-3 text-left hover:bg-[var(--bg)]', cur?.id === t.id && 'bg-[var(--g1)]')}>
                    <Avatar name={isClinical ? 'Patient' : t.customer} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--g6)]" aria-label="Awaiting reply" />}
                        <span className="min-w-0 flex-1 truncate text-[14px] font-bold">{isClinical ? 'Patient (restricted)' : t.customer}</span>
                        <span className="shrink-0 text-[11.5px] font-semibold text-[var(--ink3)]">{fmtDate(t.received).replace(' 2026', '')}</span>
                      </span>
                      <span className="flex items-center gap-1 text-[12px] text-[var(--ink3)]"><Icon className="h-3 w-3" aria-hidden />{ch.label} · {VERTICAL[s.vertical].label}</span>
                      <span className="block truncate text-[13px] text-[var(--ink2)]">{isClinical ? 'Message visible to clinical staff only' : t.message}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {cur && (
            <div className="flex min-h-[420px] flex-col bg-[var(--bg)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-white px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{restricted ? 'Patient (restricted)' : cur.customer}</div>
                  <div className="truncate text-[12.5px] text-[var(--ink3)]">{cur.listing} · assigned to {cur.assignee}</div>
                </div>
                <VerticalTag v={SUB[cur.subKey].vertical} />
              </div>
              {restricted ? (
                <div className="m-4"><ProtoNote kind="info"><Lock className="mr-1 inline h-3.5 w-3.5" aria-hidden />Health conversations are restricted to clinical staff and are not shown in the shared inbox.</ProtoNote></div>
              ) : (
                <>
                  <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                    <div className="max-w-[78%] self-start rounded-[14px] border border-[var(--line)] bg-white px-3.5 py-2.5 text-[14px]">
                      {cur.message}
                      <span className="mt-1 block text-[11px] text-[var(--ink3)]">{fmtDate(cur.received)} · via {cur.source}</span>
                    </div>
                    {(cur.messages ?? []).map((m, i) => (
                      <div key={i} className={cn('max-w-[78%] rounded-[14px] px-3.5 py-2.5 text-[14px]', m.from === 'provider' ? 'self-end bg-[var(--g8)] text-white' : 'self-start border border-[var(--line)] bg-white')}>
                        {m.text}<span className={cn('mt-1 block text-[11px]', m.from === 'provider' ? 'text-[#b6dcc8]' : 'text-[var(--ink3)]')}>{fmtDate(m.at)} · {m.from === 'provider' ? 'you' : 'customer'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end gap-2 border-t border-[var(--line)] bg-white p-3">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Reply on ${cur.source}…`} rows={1}
                      className="h-11 min-w-0 flex-1 resize-none rounded-xl border-[1.5px] border-[var(--line2)] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--g6)]" />
                    <Button disabled={!draft.trim()} onClick={() => {
                      // The reply is stored on the lead, so the customer sees it in My enquiries; a first reply marks the enquiry contacted.
                      patch('leads', cur.id, {
                        messages: [...(cur.messages ?? []), { from: 'provider', text: draft.trim(), at: `${TODAY} ${new Date().toTimeString().slice(0, 5)}` }],
                        stage: cur.stage === 'new' ? 'contacted' : cur.stage,
                      });
                      setDraft('');
                      toast.success('Reply sent', { description: 'Simulated — visible to the customer in My enquiries' });
                    }}><Send className="h-4 w-4" aria-hidden />Send</Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
