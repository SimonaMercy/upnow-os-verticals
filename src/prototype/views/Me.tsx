'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search, MessagesSquare } from 'lucide-react';
import { useProto } from '../store';
import { SUB, VERTICAL } from '../registry';
import { BASE } from '../nav';
import { MY_ACTIVITY } from '../seed';
import { Button, Card, Empty, PageHeader, ProtoNote, SectionTitle, VerticalTag, fmtDate } from '../ui';
import { ME, usePersona } from './customer/MeShell';

/** Personal context home: the person's own activity as a customer, and the businesses they can switch into. */
export function MeView() {
  const { orgs, setContext, leads } = useProto();
  const router = useRouter();
  const person = usePersona();
  const enquiries = leads.filter((l) => l.customer === person.name).sort((a, b) => b.received.localeCompare(a.received)).slice(0, 4);

  return (
    <div>
      <PageHeader
        title={`Hi ${person.name.split(' ')[0]}`}
        subtitle={person.ownsBusinesses
          ? 'Your own leases, bookings, memberships and policies as a customer. The same login also runs the businesses you work for.'
          : 'A customer account with no business. Browse the marketplace and contact providers — your enquiries arrive in their OS.'}
        actions={<Link href={`${ME}/browse`}><Button><Search className="h-4 w-4" aria-hidden />Browse the marketplace</Button></Link>}
      />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          {person.ownsBusinesses && (
            <div>
              <SectionTitle>My activity</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {MY_ACTIVITY.map((a) => (
                  <Card key={a.title} className="flex flex-col gap-2">
                    <VerticalTag v={a.vertical} />
                    <div className="font-bold text-[var(--ink)]">{a.title}</div>
                    <div className="text-xs text-[var(--ink3)]">{a.provider}</div>
                    <div className="text-sm font-semibold text-[var(--g7)]">{a.status}</div>
                    <div className="text-xs text-[var(--ink3)]">{a.detail}</div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <div>
            <SectionTitle right={enquiries.length ? <Link href={`${ME}/enquiries`} className="text-[13.5px] font-bold text-[var(--g7)]">All enquiries</Link> : undefined}>Recent enquiries</SectionTitle>
            {enquiries.length === 0 ? (
              <Empty icon={<MessagesSquare className="h-6 w-6" />} title="No enquiries yet" body="Contact a provider from any listing; the conversation appears here." />
            ) : (
              <Card pad={false} className="divide-y divide-[var(--line)]">
                {enquiries.map((l) => (
                  <Link key={l.id} href={`${ME}/enquiries?open=${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg)]">
                    <span className="min-w-0 flex-1"><span className="block truncate font-bold">{l.listing}</span><span className="block text-[12.5px] text-[var(--ink3)]">{orgs.find((o) => o.id === l.orgId)?.name} · {fmtDate(l.received)}</span></span>
                    <VerticalTag v={SUB[l.subKey].vertical} />
                  </Link>
                ))}
              </Card>
            )}
          </div>
        </div>
        <div>
          {person.ownsBusinesses ? (
            <>
              <SectionTitle>Your businesses</SectionTitle>
              <Card className="flex flex-col gap-1 p-2">
                {orgs.map((o) => (
                  <button key={o.id} type="button" onClick={() => { setContext(o.id); router.push(BASE); }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--bg)]">
                    <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-[var(--g1)] text-[12px] font-extrabold text-[var(--g7)]">{o.initials}</span>
                    <span className="flex-1"><span className="block text-sm font-bold">{o.name}</span><span className="block text-xs text-[var(--ink3)]">{o.verticals.filter((v) => v.status === 'approved').map((v) => VERTICAL[v.vertical].label).join(', ') || 'Awaiting approval'}</span></span>
                    <ArrowRight className="h-4 w-4 text-[#8a958e]" aria-hidden />
                  </button>
                ))}
              </Card>
              <div className="mt-3"><ProtoNote kind="info">Today a production user has exactly one role, so this dual customer + provider context needs an identity change in the backend (person → business memberships).</ProtoNote></div>
            </>
          ) : (
            <Card className="flex flex-col gap-2">
              <SectionTitle>Want to sell on UpNow?</SectionTitle>
              <p className="text-[14px] text-[var(--ink3)]">Customers can open a business from the same account — no second registration. The demo&apos;s onboarding runs as Layla.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
