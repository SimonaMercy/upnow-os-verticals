'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Wallet, ExternalLink } from 'lucide-react';
import { useProto } from '../store';
import { VERTICAL } from '../registry';
import {
  Badge, Button, Chips, Empty, Field, Modal, PageHeader, ProtoNote, SelectInput, Stat, StatusBadge, Table, Tabs, Td, TextArea,
  VerticalTag, fmtAed, fmtDate,
} from '../ui';
import type { Invoice, VerticalId } from '../types';

type Tab = 'invoices' | 'payments' | 'deposits' | 'refunds' | 'payouts';

/** `vertical` scopes the view to one pack (Performance & Economics → Money, Spaces → Booking payments). */
export function FinanceView({ vertical, title }: { vertical?: VerticalId; title?: string } = {}) {
  const { invoices, deposits, payouts, context, org, approvedVerticals, patch } = useProto();
  const [tab, setTab] = useState<Tab>('invoices');
  const [vf, setVf] = useState<'all' | VerticalId>(vertical ?? 'all');
  const [payId, setPayId] = useState<string | null>(null);
  const [refundId, setRefundId] = useState<string | null>(null);
  const [method, setMethod] = useState<NonNullable<Invoice['method']>>('Card');
  const [reason, setReason] = useState('Customer cancelled within policy');

  const verticals = approvedVerticals(org);
  const inv = invoices.filter((i) => i.orgId === context && (vf === 'all' || i.vertical === vf));
  const deps = deposits.filter((d) => d.orgId === context && (vf === 'all' || d.vertical === vf));
  const pos = payouts.filter((p) => p.orgId === context);

  const open = inv.filter((i) => i.status === 'issued' || i.status === 'overdue');
  const paid = inv.filter((i) => i.status === 'paid');
  const refunded = inv.filter((i) => i.status === 'refunded');
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);

  const list = tab === 'invoices' ? inv.filter((i) => i.status !== 'refunded') : tab === 'payments' ? paid : refunded;

  return (
    <div>
      <PageHeader
        eyebrow={vertical ? <VerticalTag v={vertical} /> : <Badge tone="green">Business-wide</Badge>}
        title={vertical ? title ?? `${VERTICAL[vertical].label} money` : 'Money across verticals'}
        subtitle="Invoices, payments, deposits, refunds and payouts in one place. Agreements, invoices and payments stay distinct records, linked to the transaction that created them."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding" value={fmtAed(sum(open))} sub={`${open.length} invoices`} />
        <Stat label="Overdue" value={fmtAed(sum(inv.filter((i) => i.status === 'overdue')))} sub="Needs follow-up" tone={inv.some((i) => i.status === 'overdue') ? 'bad' : undefined} />
        <Stat label="Collected (Oct)" value={fmtAed(sum(paid))} sub={`${paid.length} payments`} />
        <Stat label="Deposits held" value={fmtAed(sum(deps.filter((d) => d.status === 'held')))} sub={`${deps.filter((d) => d.status === 'held').length} deposits`} />
      </div>
      {!vertical && <div className="mb-4"><Chips value={vf} onChange={setVf} items={[{ id: 'all', label: 'All verticals' }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} /></div>}
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'invoices', label: 'Invoices', count: inv.filter((i) => i.status !== 'refunded').length },
        { id: 'payments', label: 'Payments', count: paid.length },
        { id: 'deposits', label: 'Deposits', count: deps.length },
        { id: 'refunds', label: 'Refunds', count: refunded.length },
        { id: 'payouts', label: 'Payouts', count: pos.length },
      ]} />

      {(vf === 'all' || vf === 'spaces') && verticals.includes('spaces') && tab !== 'payouts' && (
        <div className="mb-4">
          <ProtoNote kind="info">
            Lease rent cheques (PDC), bounced-cheque replacement and custody keep running in the production lease engine. This view lists them alongside other verticals for a single picture.
            <Link href="/prototype/os/rp/payments" className="ml-1 inline-flex items-center gap-1 font-semibold underline">Spaces › Transactions › Payments (live) <ExternalLink className="h-3 w-3" aria-hidden /></Link>
          </ProtoNote>
        </div>
      )}

      {(tab === 'invoices' || tab === 'payments' || tab === 'refunds') && (list.length === 0 ? <Empty icon={<Wallet className="h-6 w-6" />} title="Nothing here yet" /> : (
        <Table head={['Invoice', 'Customer', 'Vertical', 'Due', 'Method', 'Amount', 'Status', '']}>
          {list.map((i) => (
            <tr key={i.id} className="hover:bg-[var(--bg)]">
              <Td><div className="font-semibold">{i.description}</div><div className="text-xs text-[var(--ink3)]">{i.id}</div></Td>
              <Td>{i.customer}</Td>
              <Td><VerticalTag v={i.vertical} /></Td>
              <Td className="whitespace-nowrap">{fmtDate(i.due)}</Td>
              <Td className="text-xs">{i.method ?? '—'}</Td>
              <Td className="font-semibold tabular-nums">{fmtAed(i.amount)}</Td>
              <Td><StatusBadge status={i.status} /></Td>
              <Td>
                <div className="flex justify-end gap-1.5">
                  {i.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => patch('invoices', i.id, { status: 'issued' }, 'Invoice issued')}>Issue</Button>}
                  {(i.status === 'issued' || i.status === 'overdue') && <Button size="sm" variant="subtle" onClick={() => { setMethod(i.method ?? 'Card'); setPayId(i.id); }}>Record payment</Button>}
                  {i.status === 'paid' && i.vertical !== 'spaces' && <Button size="sm" variant="danger" onClick={() => setRefundId(i.id)}>Refund</Button>}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      ))}

      {tab === 'deposits' && (deps.length === 0 ? <Empty title="No deposits" /> : (
        <Table head={['Deposit', 'Customer', 'Vertical', 'Amount', 'Status', '']}>
          {deps.map((d) => (
            <tr key={d.id}>
              <Td><div className="font-semibold">{d.reference}</div><div className="text-xs text-[var(--ink3)]">{d.id}</div></Td>
              <Td>{d.customer}</Td>
              <Td><VerticalTag v={d.vertical} /></Td>
              <Td className="font-semibold tabular-nums">{fmtAed(d.amount)}</Td>
              <Td><StatusBadge status={d.status} /></Td>
              <Td>
                {d.status === 'held' && !d.reference.startsWith('Lease') && (
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="subtle" onClick={() => patch('deposits', d.id, { status: 'released' }, 'Deposit released')}>Release</Button>
                    <Button size="sm" variant="danger" onClick={() => patch('deposits', d.id, { status: 'forfeited' }, 'Deposit forfeited')}>Forfeit</Button>
                  </div>
                )}
                {d.status === 'held' && d.reference.startsWith('Lease') && <span className="text-xs text-[var(--ink3)]">Settled at lease end (production)</span>}
              </Td>
            </tr>
          ))}
        </Table>
      ))}

      {tab === 'payouts' && (
        <Table head={['Payout', 'Period', 'Gross', 'Platform fees', 'Net', 'Status']}>
          {pos.map((p) => (
            <tr key={p.id}>
              <Td className="font-semibold">{p.id}</Td>
              <Td>{p.period}</Td>
              <Td className="tabular-nums">{fmtAed(p.gross)}</Td>
              <Td className="tabular-nums text-[var(--ink3)]">−{fmtAed(p.fees)}</Td>
              <Td className="font-semibold tabular-nums">{fmtAed(p.gross - p.fees)}</Td>
              <Td><StatusBadge status={p.status} /></Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={!!payId} onClose={() => setPayId(null)} title="Record payment" subtitle={payId ?? ''}
        footer={<><Button variant="secondary" onClick={() => setPayId(null)}>Cancel</Button><Button onClick={() => { patch('invoices', payId!, { status: 'paid', method }, `Payment recorded (${method})`); setPayId(null); }}>Mark as paid</Button></>}>
        <Field label="Method"><SelectInput value={method} onChange={(e) => setMethod(e.target.value as NonNullable<Invoice['method']>)} options={['Card', 'Bank transfer', 'Cheque (PDC)', 'Cash']} /></Field>
        <div className="mt-3"><ProtoNote>No payment is processed. This only changes the invoice status in the prototype.</ProtoNote></div>
      </Modal>

      <Modal open={!!refundId} onClose={() => setRefundId(null)} title="Issue refund" subtitle={refundId ?? ''}
        footer={<><Button variant="secondary" onClick={() => setRefundId(null)}>Cancel</Button><Button variant="danger" onClick={() => { patch('invoices', refundId!, { status: 'refunded' }, 'Refund issued'); setRefundId(null); }}>Refund in full</Button></>}>
        <Field label="Reason"><TextArea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-3"><ProtoNote>Refund rules differ per model (stay cancellation tiers, session cancelled by provider, membership proration). The prototype shows a full refund only.</ProtoNote></div>
      </Modal>
    </div>
  );
}
