'use client';

import { useMemo, useState } from 'react';
import { Mail, Phone, Users } from 'lucide-react';
import { useProto } from '../store';
import { SUB, VERTICAL } from '../registry';
import { DATASETS } from '../datasets';
import { ROLE_PRESETS } from '../nav';
import {
  Avatar, Badge, Chips, Drawer, Empty, PageHeader, ProtoNote, SearchBox, StatusBadge, Table, Td, VerticalTag, fmtAed, fmtDate,
} from '../ui';
import type { VerticalId } from '../types';

export function CustomersView() {
  const { customers, invoices, work, leads, context, org, approvedVerticals, role } = useProto();
  const [vf, setVf] = useState<'all' | VerticalId>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const verticals = approvedVerticals(org);
  const showMoney = ROLE_PRESETS[role].perms.includes('finance');

  // Customers "belong" to this org when they have any activity with it.
  const mine = useMemo(() => customers.filter((c) =>
    leads.some((l) => l.orgId === context && l.customer === c.name)
    || invoices.some((i) => i.orgId === context && i.customer === c.name)
    || work.some((w) => w.orgId === context && w.customer === c.name)), [customers, leads, invoices, work, context]);

  const rows = mine
    .filter((c) => vf === 'all' || c.tags.includes(vf))
    .filter((c) => !q || `${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase()));
  const c = mine.find((x) => x.id === sel) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow={<Badge tone="green">Shared module</Badge>}
        title="Customers"
        subtitle="One record per customer for this business, whether they lease, book, subscribe or enrol. Today the production OS only knows customers through lease contracts."
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips value={vf} onChange={setVf} items={[{ id: 'all', label: `All (${mine.length})` }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} />
        <SearchBox value={q} onChange={setQ} placeholder="Search name or email" />
      </div>
      {org?.verticals.some((v) => v.vertical === 'health' && v.status === 'approved') && (
        <div className="mb-4"><ProtoNote kind="info">Patients are not listed here. Health records are segregated and only reachable from the Health pack by clinical staff.</ProtoNote></div>
      )}
      {rows.length === 0 ? <Empty icon={<Users className="h-6 w-6" />} title="No customers match" /> : (
        <Table head={['Customer', 'Contact', 'Verticals', 'Customer since', showMoney ? 'Lifetime value' : '']}>
          {rows.map((x) => (
            <tr key={x.id} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => setSel(x.id)}>
              <Td><div className="flex items-center gap-2.5"><Avatar name={x.name} size={30} /><span className="font-semibold">{x.name}</span></div></Td>
              <Td><div className="text-xs text-[var(--ink3)]">{x.email}</div><div className="text-xs text-[var(--ink3)]">{x.phone}</div></Td>
              <Td><div className="flex flex-wrap gap-1">{x.tags.map((t) => <VerticalTag key={t} v={t} />)}</div></Td>
              <Td>{fmtDate(x.since)}</Td>
              <Td className="font-semibold">{showMoney ? fmtAed(x.lifetimeValue) : ''}</Td>
            </tr>
          ))}
        </Table>
      )}

      {c && (
        <Drawer open onClose={() => setSel(null)} title={c.name} subtitle={`Customer since ${fmtDate(c.since)}`}>
          <div className="flex flex-col gap-5 text-sm">
            <div className="flex flex-col gap-1.5 rounded-xl bg-[var(--bg)] p-3">
              <span className="inline-flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-[#8a958e]" aria-hidden />{c.email}</span>
              <span className="inline-flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-[#8a958e]" aria-hidden />{c.phone}</span>
            </div>
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Activity across verticals</h4>
              <ul className="flex flex-col gap-2">
                {work.filter((w) => w.orgId === context && w.customer === c.name).map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-2.5">
                    <div><div className="font-semibold">{w.title}</div><div className="text-xs text-[var(--ink3)]">{DATASETS[w.dataset].noun} · {fmtDate(w.date)}</div></div>
                    <div className="flex flex-col items-end gap-1"><VerticalTag v={DATASETS[w.dataset].vertical} /><StatusBadge status={w.stage} /></div>
                  </li>
                ))}
                {leads.filter((l) => l.orgId === context && l.customer === c.name).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-2.5">
                    <div><div className="font-semibold">Enquiry · {l.listing}</div><div className="text-xs text-[var(--ink3)]">{SUB[l.subKey].label} · {fmtDate(l.received)}</div></div>
                    <StatusBadge status={l.stage} />
                  </li>
                ))}
              </ul>
            </section>
            {showMoney && (
              <section>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Invoices</h4>
                <ul className="flex flex-col gap-2">
                  {invoices.filter((i) => i.orgId === context && i.customer === c.name).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{i.description}</span>
                      <span className="font-semibold">{fmtAed(i.amount)}</span>
                      <StatusBadge status={i.status} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
