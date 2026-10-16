'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Store, Image as ImageIcon, MessageSquareWarning } from 'lucide-react';
import { useProto } from '../store';
import { MODEL_INFO, SUB, VERTICAL } from '../registry';
import { BASE } from '../nav';
import { listingTarget } from '../rules';
import {
  Badge, Button, Chips, Drawer, Empty, PageHeader, ProtoNote, SearchBox, Stepper, StatusBadge, Table, Td, VerticalTag, fmtAed, fmtDate,
} from '../ui';
import type { Listing, ListingStatus, VerticalId } from '../types';

const SUBMIT_MSG: Partial<Record<ListingStatus, string>> = {
  in_review: 'Listing submitted for review',
  awaiting_licence: 'Listing waiting for licence',
  awaiting_verification: 'Listing waiting for verification — it moves to review once UpNow approves your business and vertical',
};
/** Statuses a provider can still edit. */
const EDITABLE: ListingStatus[] = ['draft', 'changes_requested', 'withdrawn', 'published', 'awaiting_licence', 'awaiting_verification'];

/** `vertical` scopes the view to one pack (Portfolio / catalogue → Listings tab). */
export function ListingsView({ vertical }: { vertical?: VerticalId } = {}) {
  const { listings, context, org, approvedVerticals, patch } = useProto();
  const [vf, setVf] = useState<'all' | VerticalId>(vertical ?? 'all');
  const [sf, setSf] = useState<'all' | ListingStatus>('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const verticals = approvedVerticals(org);
  const mine = listings.filter((l) => l.orgId === context);
  const rows = mine
    .filter((l) => vf === 'all' || SUB[l.subKey].vertical === vf)
    .filter((l) => sf === 'all' || l.status === sf)
    .filter((l) => !q || l.title.toLowerCase().includes(q.toLowerCase()));
  const l = mine.find((x) => x.id === sel) ?? null;

  function submit(x: Listing) {
    const to = listingTarget(org, x.subKey);
    patch('listings', x.id, { status: to, updated: '2026-10-15', reviewNote: to === 'awaiting_licence' ? `Waiting for ${SUB[x.subKey].licenceGate}.` : undefined }, SUBMIT_MSG[to]);
  }
  const editHref = (x: Listing) => `${BASE}/listings/${x.id}/edit`;

  return (
    <div>
      <PageHeader
        eyebrow={vertical ? <VerticalTag v={vertical} /> : <Badge tone="green">Business-wide</Badge>}
        title={vertical ? `${VERTICAL[vertical].label} listings` : 'Listings across verticals'}
        subtitle="A provider must be authorised for a vertical before listing in it; each listing then passes its own review. Listings point at an asset (unit, court, vessel) or an offering (service, plan, program)."
        actions={<Link href={`${BASE}/listings/new`}><Button><Plus className="h-4 w-4" aria-hidden />Create listing</Button></Link>}
      />
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {vertical ? <span /> : <Chips value={vf} onChange={setVf} items={[{ id: 'all', label: `All (${mine.length})` }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} />}
        <SearchBox value={q} onChange={setQ} placeholder="Search listings" />
      </div>
      <div className="mb-4">
        <Chips value={sf} onChange={setSf} items={[
          { id: 'all', label: 'Any status' }, { id: 'draft', label: 'Draft' }, { id: 'awaiting_verification', label: 'Waiting for verification' }, { id: 'awaiting_licence', label: 'Awaiting licence' },
          { id: 'in_review', label: 'In review' }, { id: 'changes_requested', label: 'Changes requested' }, { id: 'published', label: 'Published' },
          { id: 'rejected', label: 'Rejected' }, { id: 'withdrawn', label: 'Withdrawn' },
        ]} />
      </div>
      {rows.length === 0 ? <Empty icon={<Store className="h-6 w-6" />} title="No listings" action={<Link href={`${BASE}/listings/new`}><Button size="sm">Create listing</Button></Link>} /> : (
        <Table head={['Listing', 'Subcategory', 'Asset / offering', 'Price', 'Updated', 'Status', '']}>
          {rows.map((x) => {
            const s = SUB[x.subKey];
            return (
              <tr key={x.id} className="cursor-pointer hover:bg-[var(--bg)]" onClick={() => setSel(x.id)}>
                <Td><div className="font-semibold">{x.title}</div><div className="text-xs text-[var(--ink3)]">{x.id}</div></Td>
                <Td><div className="flex flex-col items-start gap-1"><VerticalTag v={s.vertical} /><span className="text-xs text-[var(--ink3)]">{s.label}</span></div></Td>
                <Td className="text-xs text-[var(--ink2)]">{x.asset}</Td>
                <Td className="whitespace-nowrap font-semibold">{fmtAed(x.price)}<span className="text-xs font-normal text-[var(--ink3)]">{s.priceUnit}</span></Td>
                <Td className="whitespace-nowrap">{fmtDate(x.updated)}</Td>
                <Td><StatusBadge status={x.status} /></Td>
                <Td>
                  <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {EDITABLE.includes(x.status) && <Link href={editHref(x)}><Button size="sm" variant="secondary">Edit</Button></Link>}
                    {(x.status === 'draft' || x.status === 'changes_requested' || x.status === 'withdrawn') && (
                      <Button size="sm" variant="subtle" onClick={() => submit(x)}>{x.status === 'changes_requested' ? 'Resubmit' : 'Submit'}</Button>
                    )}
                    {x.status === 'in_review' && <Button size="sm" variant="secondary" onClick={() => patch('listings', x.id, { status: 'withdrawn' }, 'Listing withdrawn from review')}>Withdraw</Button>}
                    {x.status === 'published' && <Button size="sm" variant="ghost" onClick={() => patch('listings', x.id, { status: 'withdrawn' }, 'Listing unpublished — hidden from the marketplace')}>Unpublish</Button>}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {l && (() => {
        const s = SUB[l.subKey];
        const stepIdx = l.status === 'published' ? 3 : l.status === 'in_review' || l.status === 'changes_requested' ? 2 : l.status === 'awaiting_licence' || l.status === 'awaiting_verification' ? 1 : 0;
        return (
          <Drawer open onClose={() => setSel(null)} title={l.title} subtitle={<span className="flex items-center gap-2"><VerticalTag v={s.vertical} /> {s.label} · {l.id}</span>}
            footer={<>
              {EDITABLE.includes(l.status) && <Link href={editHref(l)}><Button variant="secondary">Edit listing</Button></Link>}
              {(l.status === 'draft' || l.status === 'changes_requested') && <Button onClick={() => submit(l)}>{l.status === 'draft' ? 'Submit for review' : 'Resubmit'}</Button>}
            </>}>
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex items-center gap-2"><StatusBadge status={l.status} /><span className="text-[var(--ink3)]">Updated {fmtDate(l.updated)}</span></div>
              <Stepper steps={['Draft', 'Verification & licence', 'Review', 'Published']} current={stepIdx} />
              {l.reviewNote && <div className="flex items-start gap-2 rounded-xl bg-[#fbf0dc] p-3 text-[#8a5a14]"><MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><div><div className="font-semibold">Note from review</div>{l.reviewNote}</div></div>}
              <dl className="grid grid-cols-[130px_1fr] gap-y-2">
                <dt className="text-[var(--ink3)]">Operating model</dt><dd>{MODEL_INFO[s.model].label}</dd>
                <dt className="text-[var(--ink3)]">Price</dt><dd>{fmtAed(l.price)} <span className="text-[var(--ink3)]">{s.priceBasis}</span></dd>
                <dt className="text-[var(--ink3)]">Asset / offering</dt><dd>{l.asset}</dd>
                <dt className="text-[var(--ink3)]">Photos</dt><dd className="inline-flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5 text-[#8a958e]" aria-hidden />{l.photos} (minimum {s.minPhotos})</dd>
                {s.licenceGate && <><dt className="text-[var(--ink3)]">Licence gate</dt><dd>{s.licenceGate}</dd></>}
                {s.fields.map((f) => <div key={f.id} className="contents"><dt className="text-[var(--ink3)]">{f.label}</dt><dd>{l.attributes[f.id] ?? '—'}</dd></div>)}
              </dl>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--ink3)]">Customer journey once live</div>
                <Stepper steps={s.flow} current={-1} />
              </div>
              {s.vertical === 'spaces' && s.model === 'lease' && <ProtoNote kind="info">For long-term leases the listing is the unit itself in production (<code>submit-listing</code> on the unit). The prototype shows it in the same list so all verticals share one review experience.</ProtoNote>}
            </div>
          </Drawer>
        );
      })()}
    </div>
  );
}
