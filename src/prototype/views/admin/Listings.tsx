'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { ADMIN_ACTOR, useProto } from '../../store';
import { MODEL_INFO, SUB, VERTICAL, VERTICALS } from '../../registry';
import {
  Button, Chips, Drawer, Empty, Field, PageHeader, StatusBadge, Table, Td, TextArea, VerticalTag, fmtAed, fmtDate,
} from '../../ui';
import type { Listing, ListingStatus, VerticalId } from '../../types';

export function AdminListings() {
  const { listings, orgs, patch } = useProto();
  const [sf, setSf] = useState<ListingStatus | 'all'>('in_review');
  const [vf, setVf] = useState<VerticalId | 'all'>('all');
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const rows = listings.filter((l) => (sf === 'all' || l.status === sf) && (vf === 'all' || SUB[l.subKey].vertical === vf));
  const l = listings.find((x) => x.id === sel) ?? null;

  function checks(x: Listing) {
    const s = SUB[x.subKey];
    const org = orgs.find((o) => o.id === x.orgId)!;
    const auth = org.verticals.find((a) => a.vertical === s.vertical);
    const lic = s.licenceGate ? org.verticals.flatMap((v) => v.licences).find((k) => k.name === s.licenceGate) : null;
    return [
      { ok: org.status === 'verified', label: 'Business verified' },
      { ok: auth?.status === 'approved', label: `Authorised for ${VERTICAL[s.vertical].label}` },
      { ok: !!auth?.subcategories.includes(x.subKey), label: `Authorised for subcategory “${s.label}”` },
      ...(s.licenceGate ? [{ ok: !!lic && lic.status !== 'missing', label: `${s.licenceGate} on file${lic?.status === 'expiring' ? ' (expiring soon)' : ''}` }] : []),
      { ok: x.photos >= s.minPhotos, label: `Photos ${x.photos}/${s.minPhotos} minimum` },
      { ok: x.price > 0, label: 'Price set' },
      { ok: s.fields.every((f) => x.attributes[f.id]), label: 'All required attributes filled' },
    ];
  }

  function decide(x: Listing, status: ListingStatus, msg: string) {
    patch('listings', x.id, { status, reviewNote: status === 'published' ? undefined : note || undefined, updated: '2026-10-15' }, msg, ADMIN_ACTOR);
    setSel(null); setNote('');
  }

  return (
    <div>
      <PageHeader title="Listing review" subtitle="Gate 3 — every listing is reviewed on its own, even for authorised providers. Admin reviews, requests changes, rejects or takes down; it never authors listings for a provider." />
      <div className="mb-3"><Chips value={sf} onChange={setSf} items={[
        { id: 'in_review', label: `In review (${listings.filter((x) => x.status === 'in_review').length})` }, { id: 'awaiting_verification', label: 'Waiting for verification' }, { id: 'awaiting_licence', label: 'Awaiting licence' },
        { id: 'changes_requested', label: 'Changes requested' }, { id: 'published', label: 'Published' }, { id: 'rejected', label: 'Rejected' }, { id: 'all', label: 'All' },
      ]} /></div>
      <div className="mb-4"><Chips value={vf} onChange={setVf} items={[{ id: 'all', label: 'All verticals' }, ...VERTICALS.map((v) => ({ id: v.id, label: v.label }))]} /></div>
      {rows.length === 0 ? <Empty title="Nothing to review" body="Submit a listing from the provider OS to see it here." /> : (
        <Table head={['Listing', 'Provider', 'Subcategory', 'Price', 'Checks', 'Submitted', 'Status']}>
          {rows.map((x) => {
            const c = checks(x);
            const passed = c.filter((k) => k.ok).length;
            return (
              <tr key={x.id} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => setSel(x.id)}>
                <Td><div className="font-semibold">{x.title}</div><div className="text-xs text-[var(--ink3)]">{x.id}</div></Td>
                <Td>{orgs.find((o) => o.id === x.orgId)?.name}</Td>
                <Td><div className="flex flex-col items-start gap-1"><VerticalTag v={SUB[x.subKey].vertical} /><span className="text-xs text-[var(--ink3)]">{SUB[x.subKey].label}</span></div></Td>
                <Td className="whitespace-nowrap">{fmtAed(x.price)}<span className="text-xs text-[var(--ink3)]">{SUB[x.subKey].priceUnit}</span></Td>
                <Td className="whitespace-nowrap"><span className={passed === c.length ? 'font-semibold text-[var(--g7)]' : 'font-semibold text-[#8a5a14]'}>{passed}/{c.length} passed</span></Td>
                <Td className="whitespace-nowrap">{fmtDate(x.updated)}</Td>
                <Td><StatusBadge status={x.status} /></Td>
              </tr>
            );
          })}
        </Table>
      )}
      {l && (() => {
        const s = SUB[l.subKey];
        return (
          <Drawer open onClose={() => setSel(null)} title={l.title} subtitle={<span className="flex items-center gap-2"><VerticalTag v={s.vertical} /> {s.label} · {orgs.find((o) => o.id === l.orgId)?.name}</span>}
            footer={l.status === 'in_review' || l.status === 'awaiting_licence' ? <>
              <Button variant="danger" size="sm" onClick={() => decide(l, 'rejected', `Listing rejected: ${l.title}`)}>Reject</Button>
              <Button variant="secondary" size="sm" disabled={!note} onClick={() => decide(l, 'changes_requested', `Changes requested: ${l.title}`)}>Request changes</Button>
              <Button size="sm" disabled={!checks(l).slice(0, 3).every((k) => k.ok)} onClick={() => decide(l, 'published', `Listing published: ${l.title}`)}>Approve & publish</Button>
            </> : l.status === 'published' ? <Button variant="danger" size="sm" onClick={() => decide(l, 'withdrawn', `Listing taken down: ${l.title}`)}>Take down</Button> : undefined}>
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-2"><StatusBadge status={l.status} /><span className="text-[var(--ink3)]">{MODEL_INFO[s.model].label}</span></div>
              <section>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink3)]">Automated checks</h4>
                <ul className="flex flex-col gap-1.5">
                  {checks(l).map((k) => (
                    <li key={k.label} className="flex items-center gap-2">
                      {k.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--g6)]" aria-label="Passed" /> : <XCircle className="h-4 w-4 shrink-0 text-[var(--red)]" aria-label="Failed" />}
                      <span className={k.ok ? '' : 'text-[var(--red)]'}>{k.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--ink3)]">The first three checks are hard requirements: a listing cannot be published without provider verification and vertical + subcategory authorisation.</p>
              </section>
              <dl className="grid grid-cols-[130px_1fr] gap-y-1.5">
                <dt className="text-[var(--ink3)]">Asset / offering</dt><dd>{l.asset}</dd>
                <dt className="text-[var(--ink3)]">Price</dt><dd>{fmtAed(l.price)} {s.priceBasis}</dd>
                {s.fields.map((f) => <div key={f.id} className="contents"><dt className="text-[var(--ink3)]">{f.label}</dt><dd>{l.attributes[f.id] ?? '—'}</dd></div>)}
              </dl>
              {l.reviewNote && <div className="rounded-xl bg-[#fbf0dc] p-3 text-[#8a5a14]">{l.reviewNote}</div>}
              {(l.status === 'in_review' || l.status === 'awaiting_licence') && <Field label="Note to provider" hint="Required to request changes"><TextArea value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
}
