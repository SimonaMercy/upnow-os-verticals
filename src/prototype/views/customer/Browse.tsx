'use client';

/**
 * PROTOTYPE ONLY — the marketplace as a customer sees it: published listings
 * from every vertical (MarketSpace search / listing cards, `.lcard`).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Store } from 'lucide-react';
import { useProto } from '../../store';
import { SUB, VERTICAL, subsOf } from '../../registry';
import { Badge, Chips, Empty, PageHeader, SearchBox, SelectInput, fmtAed } from '../../ui';
import type { VerticalId } from '../../types';
import { ME, usePersona } from './MeShell';

export function BrowseView() {
  const { listings, orgs } = useProto();
  const person = usePersona();
  const [vf, setVf] = useState<'all' | VerticalId>('all');
  const [sub, setSub] = useState('all');
  const [q, setQ] = useState('');

  const live = listings.filter((l) => l.status === 'published');
  const rows = useMemo(() => live
    .filter((l) => vf === 'all' || SUB[l.subKey].vertical === vf)
    .filter((l) => sub === 'all' || l.subKey === sub)
    .filter((l) => !q || `${l.title} ${orgs.find((o) => o.id === l.orgId)?.name}`.toLowerCase().includes(q.toLowerCase())), [live, vf, sub, q, orgs]);
  const verticals = [...new Set(live.map((l) => SUB[l.subKey].vertical))];

  return (
    <div>
      <PageHeader title="Browse the marketplace" subtitle="Published listings only — a listing appears here after the provider is verified, authorised for the vertical, and the listing itself is approved." />
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips value={vf} onChange={(v) => { setVf(v); setSub('all'); }} items={[{ id: 'all', label: `All (${live.length})` }, ...verticals.map((v) => ({ id: v, label: VERTICAL[v].label }))]} />
        <div className="flex flex-wrap items-center gap-2">
          {vf !== 'all' && (
            <div className="w-52"><SelectInput aria-label="Subcategory" value={sub} onChange={(e) => setSub(e.target.value)} options={[{ value: 'all', label: 'All subcategories' }, ...subsOf(vf).map((s) => ({ value: s.key, label: s.label }))]} /></div>
          )}
          <SearchBox value={q} onChange={setQ} placeholder="Search listings or providers" />
        </div>
      </div>
      {rows.length === 0 ? <Empty icon={<Store className="h-6 w-6" />} title="No listings match" /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((l) => {
            const s = SUB[l.subKey];
            const org = orgs.find((o) => o.id === l.orgId)!;
            const Icon = VERTICAL[s.vertical].icon;
            const own = person.ownsBusinesses && org.members.some((m) => m.name === person.name);
            return (
              <Link key={l.id} href={`${ME}/browse/${l.id}`} className="group flex flex-col overflow-hidden rounded-[var(--r)] border border-[var(--line)] bg-white transition-all hover:-translate-y-0.5 hover:shadow-[var(--sh-lg)]">
                <div className="relative grid h-36 place-items-center bg-gradient-to-br from-[var(--g1)] to-[var(--g2)]">
                  <Icon className="h-10 w-10 text-[var(--g7)] opacity-60" aria-hidden />
                  <span className="absolute bottom-2.5 left-2.5 rounded-md bg-[rgba(11,61,42,0.75)] px-2 py-0.5 text-[11px] font-bold text-white">{s.label}</span>
                  {own && <span className="absolute right-2.5 top-2.5"><Badge tone="blue">Your business</Badge></span>}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                  <b className="text-[15px] leading-snug group-hover:text-[var(--g7)]">{l.title}</b>
                  <span className="flex items-center gap-1 text-[12.5px] text-[var(--ink3)]">{org.name}{org.status === 'verified' && <BadgeCheck className="h-3.5 w-3.5 text-[var(--g7)]" aria-label="Verified provider" />}</span>
                  <span className="mt-auto text-[16px] font-extrabold">{fmtAed(l.price)}<span className="text-[12px] font-medium text-[var(--ink3)]"> {s.priceUnit}</span></span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
