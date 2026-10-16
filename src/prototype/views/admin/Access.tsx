'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ADMIN_ACTOR, useProto } from '../../store';
import { VERTICAL, subsOf } from '../../registry';
import { Button, Chips, Drawer, Empty, Field, PageHeader, ProtoNote, StatusBadge, Table, Td, TextArea, VerticalTag, fmtDate } from '../../ui';
import type { AuthStatus, VerticalId } from '../../types';

export function AdminAccess() {
  const { orgs, setVertical } = useProto();
  const [f, setF] = useState<AuthStatus | 'all'>('submitted');
  const [sel, setSel] = useState<{ orgId: string; v: VerticalId } | null>(null);
  const [subs, setSubs] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const rows = orgs.flatMap((o) => o.verticals.map((a) => ({ o, a }))).filter(({ a }) => f === 'all' || a.status === f);
  const cur = sel ? orgs.find((o) => o.id === sel.orgId) : null;
  const auth = cur?.verticals.find((a) => a.vertical === sel?.v);

  function close() { setSel(null); setNote(''); }

  return (
    <div>
      <PageHeader title="Vertical access" subtitle="Gate 2 — may this verified business operate in this vertical, and in which subcategories? Approval reveals the vertical pack in the provider's sidebar." />
      <div className="mb-4"><Chips value={f} onChange={setF} items={[
        { id: 'submitted', label: `Submitted (${orgs.flatMap((o) => o.verticals).filter((v) => v.status === 'submitted').length})` },
        { id: 'changes_requested', label: 'Changes requested' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' },
      ]} /></div>
      {rows.length === 0 ? <Empty title="No requests" body="Request a vertical from the provider OS (Settings › Verticals & licences) to see it here." /> : (
        <Table head={['Business', 'Vertical', 'Business type', 'Subcategories', 'Licences', 'Requested', 'Status']}>
          {rows.map(({ o, a }) => (
            <tr key={`${o.id}-${a.vertical}`} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => { setSel({ orgId: o.id, v: a.vertical }); setSubs(a.subcategories); }}>
              <Td><div className="font-semibold">{o.name}</div><div className="text-xs text-[var(--ink3)]">Business <StatusBadge status={o.status} /></div></Td>
              <Td><VerticalTag v={a.vertical} /></Td>
              <Td>{a.businessType}</Td>
              <Td>{a.subcategories.length}</Td>
              <Td><div className="flex flex-wrap gap-1">{a.licences.map((l) => <StatusBadge key={l.name} status={l.status} />)}</div></Td>
              <Td className="whitespace-nowrap">{fmtDate(a.requestedAt)}</Td>
              <Td><StatusBadge status={a.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      {cur && auth && sel && (
        <Drawer open onClose={close} title={`${cur.name} · ${VERTICAL[sel.v].label}`} subtitle={auth.businessType}
          footer={auth.status !== 'approved' ? <>
            <Button variant="danger" size="sm" onClick={() => { setVertical(cur.id, sel.v, { status: 'rejected', note: note || 'Not eligible for this vertical.' }, `Rejected ${VERTICAL[sel.v].label} access for ${cur.name}`, ADMIN_ACTOR); close(); }}>Reject</Button>
            <Button variant="secondary" size="sm" disabled={!note} onClick={() => { setVertical(cur.id, sel.v, { status: 'changes_requested', note }, `Requested changes on ${VERTICAL[sel.v].label} access`, ADMIN_ACTOR); close(); }}>Request changes</Button>
            <Button size="sm" disabled={cur.status !== 'verified' || subs.length === 0} onClick={() => { setVertical(cur.id, sel.v, { status: 'approved', subcategories: subs, note: undefined }, `Authorised ${cur.name} for ${VERTICAL[sel.v].label}`, ADMIN_ACTOR); close(); }}>Authorise</Button>
          </> : <Button variant="danger" size="sm" onClick={() => { setVertical(cur.id, sel.v, { status: 'rejected', note: 'Authorisation suspended by UpNow.' }, `Suspended ${VERTICAL[sel.v].label} for ${cur.name}`, ADMIN_ACTOR); close(); }}>Suspend authorisation</Button>}>
          <div className="flex flex-col gap-4 text-sm">
            {cur.status !== 'verified' && (
              <div className="flex items-start gap-2 rounded-xl bg-[#fbf0dc] p-3 text-[#8a5a14]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />The business is not verified yet ({cur.status.replace('_', ' ')}). Verify it in Provider verification before authorising a vertical.</div>
            )}
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Subcategories to authorise</h4>
              <div className="grid gap-1.5">
                {subsOf(sel.v).map((s) => (
                  <label key={s.key} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                    <input type="checkbox" disabled={auth.status === 'approved'} checked={subs.includes(s.key)} onChange={() => setSubs(subs.includes(s.key) ? subs.filter((x) => x !== s.key) : [...subs, s.key])} />
                    <span className="flex-1">{s.label}</span>
                    {!auth.subcategories.includes(s.key) && <span className="text-[11px] text-[#8a958e]">not requested</span>}
                    {s.licenceGate && <span className="text-[11px] text-[var(--ink3)]">gate: {s.licenceGate}</span>}
                  </label>
                ))}
              </div>
            </section>
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Licences</h4>
              <ul className="flex flex-col gap-1.5">
                {auth.licences.map((l) => (
                  <li key={l.name} className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">{l.name}{l.number && <span className="text-[var(--ink3)]"> · {l.number}</span>}</span>
                    {l.expires && <span className="text-xs text-[var(--ink3)]">{fmtDate(l.expires)}</span>}
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            </section>
            {auth.status !== 'approved' && <Field label="Note to provider" hint="Required to request changes"><TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Upload the REPs registration for your trainers" /></Field>}
            <ProtoNote kind="info">Authorising a vertical does not publish anything. Each listing in it is still reviewed in Listing review.</ProtoNote>
          </div>
        </Drawer>
      )}
    </div>
  );
}
