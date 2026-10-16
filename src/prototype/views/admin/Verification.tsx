'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { ADMIN_ACTOR, useProto } from '../../store';
import { Button, Chips, Drawer, Empty, Field, PageHeader, ProtoNote, StatusBadge, Table, Td, TextArea, VerticalTag, fmtDate } from '../../ui';
import type { ProviderApplication } from '../../types';

export function AdminVerification() {
  const { applications, orgs, patch, patchOrg } = useProto();
  const [f, setF] = useState<'pending_review' | 'changes_requested' | 'approved' | 'rejected' | 'all'>('pending_review');
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const rows = applications.filter((a) => f === 'all' || a.status === f);
  const a = applications.find((x) => x.id === sel) ?? null;

  function decide(app: ProviderApplication, status: ProviderApplication['status'], msg: string) {
    patch('applications', app.id, { status, note: status === 'approved' ? undefined : note || undefined }, msg, ADMIN_ACTOR);
    const org = orgs.find((o) => o.name === app.orgName);
    if (org) patchOrg(org.id, { status: status === 'approved' ? 'verified' : status === 'rejected' ? 'rejected' : 'changes_requested' });
    setSel(null); setNote('');
  }

  return (
    <div>
      <PageHeader title="Provider verification" subtitle="Gate 1 — the business itself: identity, trade licence and bank details. Approving here does not authorise any vertical." />
      <div className="mb-4"><Chips value={f} onChange={setF} items={[
        { id: 'pending_review', label: `Pending (${applications.filter((x) => x.status === 'pending_review').length})` },
        { id: 'changes_requested', label: 'Changes requested' }, { id: 'approved', label: 'Approved' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' },
      ]} /></div>
      {rows.length === 0 ? <Empty title="Queue is empty" body="Create a business from the provider OS (Start another business) to see it arrive here." /> : (
        <Table head={['Business', 'Type', 'First vertical', 'Emirate', 'Submitted', 'Documents', 'Status']}>
          {rows.map((x) => (
            <tr key={x.id} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => setSel(x.id)}>
              <Td><div className="font-semibold">{x.orgName}</div><div className="text-xs text-[var(--ink3)]">{x.id} · {x.contact}</div></Td>
              <Td className="capitalize">{x.entityType}<div className="text-xs text-[var(--ink3)] normal-case">{x.businessType}</div></Td>
              <Td><VerticalTag v={x.vertical} /></Td>
              <Td>{x.emirate}</Td>
              <Td className="whitespace-nowrap">{fmtDate(x.submitted)}</Td>
              <Td>{x.documents.filter((d) => d.ok).length}/{x.documents.length}</Td>
              <Td><StatusBadge status={x.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
      {a && (
        <Drawer open onClose={() => setSel(null)} title={a.orgName} subtitle={`${a.businessType} · ${a.emirate}`}
          footer={a.status === 'pending_review' || a.status === 'changes_requested' ? <>
            <Button variant="danger" size="sm" onClick={() => decide(a, 'rejected', `Rejected ${a.orgName}`)}>Reject</Button>
            <Button variant="secondary" size="sm" disabled={!note} onClick={() => decide(a, 'changes_requested', `Requested changes from ${a.orgName}`)}>Request changes</Button>
            <Button size="sm" onClick={() => decide(a, 'approved', `Verified ${a.orgName}`)}>Verify business</Button>
          </> : undefined}>
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex items-center gap-2"><StatusBadge status={a.status} /><VerticalTag v={a.vertical} /></div>
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Documents</h4>
              <ul className="flex flex-col gap-1.5">
                {a.documents.map((d) => (
                  <li key={d.name} className="flex items-center gap-2">
                    {d.ok ? <CheckCircle2 className="h-4 w-4 text-[var(--g6)]" aria-label="Provided" /> : <XCircle className="h-4 w-4 text-[var(--red)]" aria-label="Missing" />}
                    <span className={d.ok ? '' : 'text-[var(--red)]'}>{d.name}{!d.ok && ' — missing'}</span>
                  </li>
                ))}
              </ul>
            </section>
            {a.note && <div className="rounded-xl bg-[#fbf0dc] p-3 text-[#8a5a14]">{a.note}</div>}
            {(a.status === 'pending_review' || a.status === 'changes_requested') && (
              <Field label="Note to provider" hint="Required to request changes"><TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Upload the bank account letter in the company's name" /></Field>
            )}
            <ProtoNote kind="info">Next gate: the business&apos;s {a.vertical} access request is reviewed separately in Vertical access.</ProtoNote>
          </div>
        </Drawer>
      )}
    </div>
  );
}
