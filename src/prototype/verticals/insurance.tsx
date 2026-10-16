'use client';

import { useState } from 'react';
import { Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto, useWork } from '../store';
import { TODAY } from '../seed';
import { addDays, dayDiff } from '../datasets';
import { Badge, Button, Modal, ProtoNote, Stat, StatusBadge, Table, Td, fmtAed, fmtDate } from '../ui';
import { ModuleHeader, PipelineBoard } from './common';
import type { WorkItem } from '../types';

const INSURERS = ['Gulf Insurance Co.', 'Oasis Health', 'Falcon General', 'Al Waha Takaful', 'Emirates Shield'];

/** Deterministic mock quotes per request so the comparison is stable. */
function quotesFor(w: WorkItem) {
  const base = w.meta.product === 'Health' ? 3800 : w.meta.product === 'Property' ? 820 : 1900;
  return INSURERS.map((name, i) => ({
    name,
    premium: Math.round(base * (1 + ((w.id.charCodeAt(w.id.length - 1) + i * 7) % 9) / 20)),
    excess: w.meta.product === 'Health' ? `${10 + (i % 3) * 5}% co-pay` : fmtAed(500 + (i % 3) * 250),
    feature: ['Agency repair', 'Roadside assistance', 'Enhanced network', 'Takaful (Sharia)', 'Fast-track claims'][i],
  })).sort((a, b) => a.premium - b.premium);
}

export function InsuranceQuotes() {
  const { patch } = useProto();
  const [cmp, setCmp] = useState<WorkItem | null>(null);
  const [pick, setPick] = useState<string>('');

  return (
    <div>
      <ModuleHeader v="insurance" title="Quote requests" model="Quote & policy"
        subtitle="Requests are routed to licensed insurers on your panel. The customer compares quotes and applies; the policy is issued by the insurer and tracked here." />
      <div className="mb-4"><ProtoNote kind="info"><Scale className="mr-1 inline h-3.5 w-3.5" aria-hidden />Regulated activity (CBUAE). Advice and comparisons come from the licensed broker; UpNow does not underwrite, price or issue policies. Health questionnaires are restricted data.</ProtoNote></div>
      <PipelineBoard
        dataset="quote_requests"
        stages={[{ id: 'new', label: 'New request' }, { id: 'details_collected', label: 'Details collected' }, { id: 'quotes_received', label: 'Quotes received' }, { id: 'application', label: 'Application' }, { id: 'policy_issued', label: 'Policy issued' }]}
        next={{
          new: { to: 'details_collected', label: 'Collect details', msg: 'Eligibility / risk details collected' },
          details_collected: { to: 'quotes_received', label: 'Request quotes', msg: 'Quotes received from 5 insurers (simulated)', patch: (w) => ({ meta: { ...w.meta, quotes: 5, best: quotesFor(w)[0].premium } }) },
          application: { to: 'policy_issued', label: 'Insurer issued policy', msg: 'Policy issued by insurer' },
        }}
        custom={(w) => w.stage === 'quotes_received' ? <Button size="sm" variant="subtle" onClick={() => { setPick(''); setCmp(w); }}>Compare quotes</Button> : null}
        exit={{ from: ['new', 'details_collected', 'quotes_received'], to: 'cancelled', label: 'Close', msg: 'Quote request closed' }}
        body={(w) => (
          <div className="mt-1 text-xs text-[var(--ink3)]">
            {w.meta.product}{Number(w.meta.quotes) > 0 && <> · {w.meta.quotes} quotes · best {fmtAed(Number(w.meta.best))}</>}
          </div>
        )}
      />
      <Modal open={!!cmp} onClose={() => setCmp(null)} title="Compare quotes" subtitle={cmp ? `${cmp.title} · ${cmp.customer}` : ''} wide
        footer={<><Button variant="secondary" onClick={() => setCmp(null)}>Close</Button><Button disabled={!pick} onClick={() => {
          patch('work', cmp!.id, { stage: 'application', meta: { ...cmp!.meta, insurer: pick } }, `Application sent to ${pick}`); setCmp(null);
        }}>Proceed with selected</Button></>}>
        {cmp && (
          <div className="flex flex-col gap-2">
            {quotesFor(cmp).map((q, i) => (
              <label key={q.name} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3', pick === q.name ? 'border-[#1f5a8c] bg-[#eef4fa]' : 'border-[var(--line)]')}>
                <input type="radio" name="quote" checked={pick === q.name} onChange={() => setPick(q.name)} />
                <span className="flex-1"><span className="block font-semibold">{q.name}</span><span className="block text-xs text-[var(--ink3)]">{q.feature} · excess {q.excess}</span></span>
                {i === 0 && <Badge tone="green">Lowest</Badge>}
                <span className="text-right font-bold">{fmtAed(q.premium)}<span className="block text-xs font-normal text-[var(--ink3)]">/year</span></span>
              </label>
            ))}
            <p className="text-xs text-[var(--ink3)]">Quotes are illustrative and generated for the prototype.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function InsurancePolicies() {
  const items = useWork('policies');
  const { patch } = useProto();
  const due = items.filter((p) => p.stage === 'renewal_due' || (p.stage === 'active' && dayDiff(TODAY, p.date!) <= 60));
  return (
    <div>
      <ModuleHeader v="insurance" title="Policies" model="Quote & policy"
        subtitle="Policies placed through this broker. The insurer is the policy owner; this view tracks term, premium and renewal." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active policies" value={items.filter((p) => p.stage === 'active').length} />
        <Stat label="Renewals in 60 days" value={due.length} tone="warn" />
        <Stat label="Lapsed" value={items.filter((p) => p.stage === 'lapsed').length} tone="bad" />
        <Stat label="Annual premium placed" value={fmtAed(items.filter((p) => p.stage !== 'lapsed').reduce((a, p) => a + (p.amount ?? 0), 0))} />
      </div>
      <Table head={['Policy', 'Holder', 'Insurer', 'Policy number', 'Premium', 'Renews / expired', 'Status', '']}>
        {items.map((p) => (
          <tr key={p.id}>
            <Td className="font-semibold">{p.title}</Td>
            <Td>{p.customer}</Td>
            <Td>{p.meta.insurer}</Td>
            <Td className="font-mono text-xs">{p.meta.number}</Td>
            <Td className="font-semibold">{fmtAed(p.amount ?? 0)}</Td>
            <Td className="whitespace-nowrap">{fmtDate(p.date)}</Td>
            <Td><StatusBadge status={p.stage} /></Td>
            <Td>
              {(p.stage === 'renewal_due' || p.stage === 'lapsed') && (
                <Button size="sm" variant="subtle" onClick={() => patch('work', p.id, { stage: 'active', date: addDays(p.date! > TODAY ? p.date! : TODAY, 365) }, 'Renewal placed with insurer (simulated)')}>
                  {p.stage === 'lapsed' ? 'Reinstate' : 'Renew'}
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
