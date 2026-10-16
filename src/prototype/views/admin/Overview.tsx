'use client';

import Link from 'next/link';
import { ShieldCheck, KeyRound, Store, ArrowRight } from 'lucide-react';
import { useProto } from '../../store';
import { VERTICALS } from '../../registry';
import { Card, PageHeader, SectionTitle, Stat, Table, Td, VerticalTag, fmtDate } from '../../ui';

export function AdminOverview() {
  const { applications, orgs, listings, audit } = useProto();
  const pendingApps = applications.filter((a) => a.status === 'pending_review').length;
  const pendingAccess = orgs.flatMap((o) => o.verticals).filter((v) => v.status === 'submitted').length;
  const pendingListings = listings.filter((l) => l.status === 'in_review').length;
  const queues = [
    { to: '/prototype/admin/verification', label: 'Provider verification', n: pendingApps, icon: ShieldCheck, body: 'Is this a real, licensed business?' },
    { to: '/prototype/admin/access', label: 'Vertical access', n: pendingAccess, icon: KeyRound, body: 'May this business operate in this vertical?' },
    { to: '/prototype/admin/listings', label: 'Listing review', n: pendingListings, icon: Store, body: 'Is this specific listing accurate and compliant?' },
  ];
  return (
    <div>
      <PageHeader title="Admin overview" subtitle="Three independent gates: the business, its verticals, and each listing. Passing one never implies the next." />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {queues.map((q) => {
          const Icon = q.icon;
          return (
            <Link key={q.to} href={q.to} className="group flex flex-col gap-2 rounded-[var(--r)] border border-[var(--line)] bg-white p-5 hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
              <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-[var(--g7)]" aria-hidden /><span className="text-2xl font-extrabold">{q.n}</span></div>
              <div className="font-bold group-hover:text-[var(--g7)]">{q.label}</div>
              <div className="text-sm text-[var(--ink3)]">{q.body}</div>
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--g7)]">Open queue <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
            </Link>
          );
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <SectionTitle>Authorised providers by vertical</SectionTitle>
          <ul className="flex flex-col gap-2">
            {VERTICALS.map((v) => {
              const n = orgs.filter((o) => o.verticals.some((a) => a.vertical === v.id && a.status === 'approved')).length;
              const live = listings.filter((l) => l.subKey.startsWith(`${v.id}.`) && l.status === 'published').length;
              return (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <VerticalTag v={v.id} />
                  <span className="text-[var(--ink3)]">{n} provider{n === 1 ? '' : 's'} · {live} live listings</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <div>
          <SectionTitle>Recent decisions</SectionTitle>
          <Table head={['When', 'Actor', 'Action', 'Record']}>
            {audit.filter((a) => a.context === 'Admin').slice(0, 8).map((a) => (
              <tr key={a.id}><Td className="whitespace-nowrap text-xs">{fmtDate(a.at)}</Td><Td>{a.actor}</Td><Td>{a.action}</Td><Td className="font-mono text-xs">{a.entity}</Td></tr>
            ))}
          </Table>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Businesses on platform" value={orgs.length} />
        <Stat label="Live listings" value={listings.filter((l) => l.status === 'published').length} />
        <Stat label="Changes requested" value={listings.filter((l) => l.status === 'changes_requested').length} />
        <Stat label="Awaiting licence" value={listings.filter((l) => l.status === 'awaiting_licence').length} />
      </div>
    </div>
  );
}
