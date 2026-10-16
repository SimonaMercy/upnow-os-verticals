'use client';

import Link from 'next/link';
import { Inbox, CalendarCheck, Wallet, Store, AlertTriangle, ArrowRight, Clock, ShieldAlert, CheckCircle2, Circle } from 'lucide-react';
import { useProto } from '../store';
import { SUB, VERTICAL } from '../registry';
import { DATASETS } from '../datasets';
import { BUSINESS_VIEWS, ROLE_PRESETS, packHref, href, visibleItems, BASE } from '../nav';
import { TODAY, DEMO_PERSON } from '../seed';
import type { Org, Listing, WorkItem } from '../types';
import { draftableSubs } from '../rules';
import { Badge, Button, Card, PageHeader, ProtoNote, SectionTitle, Stat, StatusBadge, VerticalTag, fmtAed, fmtDate, hourLabel } from '../ui';

export function OverviewView() {
  const { org, leads, work, invoices, listings, role, approvedVerticals, context } = useProto();
  if (!org) {
    return <ProtoNote>Switch to a business context from the sidebar to see the provider overview.</ProtoNote>;
  }
  const perms = ROLE_PRESETS[role].perms;
  const approved = approvedVerticals(org);
  const myLeads = leads.filter((l) => l.orgId === context);
  const myWork = work.filter((w) => w.orgId === context);
  const myInv = invoices.filter((i) => i.orgId === context);
  const myListings = listings.filter((l) => l.orgId === context);

  const timeOf = (w: WorkItem) => w.time
    ?? (w.meta.hour !== undefined ? hourLabel(Number(w.meta.hour)) : undefined)
    ?? (w.dataset === 'reservations' ? myWork.find((s) => s.id === w.meta.session)?.time : undefined)
    ?? 'Any time';
  const today = myWork
    .filter((w) => w.date === TODAY && !['completed', 'cancelled', 'checked_out', 'blocked'].includes(w.stage))
    .map((w) => ({ w, sortKey: timeOf(w) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const outstanding = myInv.filter((i) => i.status === 'issued' || i.status === 'overdue');
  const overdue = myInv.filter((i) => i.status === 'overdue');
  const pendingVerticals = org.verticals.filter((v) => v.status === 'submitted' || v.status === 'changes_requested');
  const expiring = org.verticals.flatMap((v) => v.licences.filter((l) => l.status !== 'valid').map((l) => ({ ...l, vertical: v.vertical })));
  const changes = myListings.filter((l) => l.status === 'changes_requested' || l.status === 'awaiting_licence');

  return (
    <div>
      <PageHeader
        eyebrow={<>Good morning, {DEMO_PERSON.name.split(' ')[0]} · {fmtDate(TODAY)} · viewing as <strong className="text-[var(--ink)]">{ROLE_PRESETS[role].label}</strong></>}
        title={`${org.name} — business overview`}
        subtitle={approved.length ? <>Authorised for {approved.map((v) => VERTICAL[v].label).join(', ')}. Shared modules work across all of them; each pack holds that vertical&apos;s own operations.</> : 'No vertical is authorised yet. Verification and vertical access are pending.'}
        actions={perms.includes('listings') && draftableSubs(org).length > 0 ? <Link href={`${BASE}/listings/new`}><Button>Create listing</Button></Link> : undefined}
      />

      {org.status !== 'verified' && (
        <div className="mb-5">
          <ProtoNote kind="info">This business is <strong>pending verification</strong>. Packs appear only after UpNow Admin approves the organisation and at least one vertical. Try it in <Link className="font-semibold underline" href="/prototype/admin/verification">Admin → Provider verification</Link>.</ProtoNote>
        </div>
      )}

      {perms.includes('business') && <SetupChecklist org={org} listings={myListings} />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New enquiries" value={myLeads.filter((l) => l.stage === 'new').length} sub={`${myLeads.filter((l) => l.stage === 'qualified').length} qualified, awaiting conversion`} icon={<Inbox className="h-4 w-4" />} />
        <Stat label="On today's schedule" value={today.length} sub="Bookings, sessions, jobs and appointments" icon={<CalendarCheck className="h-4 w-4" />} />
        {perms.includes('finance')
          ? <Stat label="Outstanding" value={fmtAed(outstanding.reduce((a, i) => a + i.amount, 0))} sub={overdue.length ? `${overdue.length} overdue` : 'Nothing overdue'} tone={overdue.length ? 'bad' : undefined} icon={<Wallet className="h-4 w-4" />} />
          : <Stat label="Outstanding" value="—" sub="Finance is hidden for this role" icon={<Wallet className="h-4 w-4" />} />}
        <Stat label="Listings live" value={myListings.filter((l) => l.status === 'published').length} sub={`${myListings.filter((l) => l.status === 'in_review').length} in review`} icon={<Store className="h-4 w-4" />} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card className="min-w-0">
          <SectionTitle right={perms.includes('calendar') ? <Link href={href('calendar')} className="text-[13px] font-semibold text-[var(--g7)]">Open calendar</Link> : undefined}>Today across verticals</SectionTitle>
          {today.length === 0 && <p className="text-sm text-[var(--ink3)]">Nothing scheduled today.</p>}
          <ul className="flex flex-col divide-y divide-[#eef0ef]">
            {today.map(({ w, sortKey }) => {
              const ds = DATASETS[w.dataset];
              return (
                <li key={w.id}>
                  <Link href={packHref(ds.vertical, ds.module)} className="flex items-center gap-3 py-2.5 hover:bg-[var(--bg)]">
                    <span className="flex w-[74px] shrink-0 items-center gap-1 whitespace-nowrap text-[12.5px] font-bold tabular-nums text-[var(--ink)]"><Clock className="h-3.5 w-3.5 text-[#8a958e]" aria-hidden />{sortKey}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[var(--ink)]">{w.title}</span>
                      <span className="block truncate text-xs text-[var(--ink3)]">{ds.noun} · {w.dataset === 'clinic' ? 'Patient details restricted' : w.customer}</span>
                    </span>
                    <span className="hidden sm:inline-flex"><VerticalTag v={ds.vertical} /></span>
                    <StatusBadge status={w.stage} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="min-w-0">
          <SectionTitle>Action centre</SectionTitle>
          <ul className="flex flex-col gap-2.5 text-sm">
            {changes.map((l) => (
              <li key={l.id} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--amber)]" aria-hidden />
                <span className="flex-1"><Link href={href('listings')} className="font-semibold hover:underline">{l.title}</Link> — {l.status === 'awaiting_licence' ? 'waiting for a licence upload' : 'admin requested changes'}</span>
              </li>
            ))}
            {expiring.map((l) => (
              <li key={l.name} className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" aria-hidden />
                <span className="flex-1"><span className="font-semibold">{l.name}</span> — {l.status === 'missing' ? 'not uploaded' : `expires ${fmtDate(l.expires)}`} <span className="text-[var(--ink3)]">({VERTICAL[l.vertical].label})</span></span>
              </li>
            ))}
            {perms.includes('finance') && overdue.map((i) => (
              <li key={i.id} className="flex items-start gap-2">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-[var(--red)]" aria-hidden />
                <span className="flex-1"><Link href={href('finance')} className="font-semibold hover:underline">{i.id}</Link> overdue — {i.customer}, {fmtAed(i.amount)}</span>
              </li>
            ))}
            {pendingVerticals.map((v) => (
              <li key={v.vertical} className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#1f5a8c]" aria-hidden />
                <span className="flex-1"><span className="font-semibold">{VERTICAL[v.vertical].label}</span> access {v.status === 'submitted' ? 'awaiting admin review' : 'needs changes'}</span>
              </li>
            ))}
            {changes.length + expiring.length + pendingVerticals.length === 0 && <li className="text-[var(--ink3)]">All clear.</li>}
          </ul>
        </Card>
      </div>

      {BUSINESS_VIEWS.some((b) => perms.includes(b.perm)) && (
        <div className="mb-6">
          <SectionTitle>Across all verticals</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {BUSINESS_VIEWS.filter((b) => perms.includes(b.perm)).map((b) => (
              <Link key={b.slug} href={href(b.slug)} className="group flex flex-col gap-1 rounded-[var(--r)] border border-[var(--line)] bg-white p-4 transition-all hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
                <span className="font-bold text-[var(--ink)] group-hover:text-[var(--g7)]">{b.label}</span>
                <span className="text-[13px] text-[var(--ink3)]">{b.hint}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {approved.some((v) => visibleItems(v, perms).length > 0) && (
        <>
          <SectionTitle>Vertical packs</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {approved.filter((v) => visibleItems(v, perms).length > 0).map((v) => {
              const d = VERTICAL[v];
              const Icon = d.icon;
              const items = myWork.filter((w) => DATASETS[w.dataset]?.vertical === v);
              const open = items.filter((w) => !['completed', 'cancelled', 'checked_out', 'settled', 'delivered', 'expired', 'lapsed'].includes(w.stage)).length;
              const auth = org.verticals.find((a) => a.vertical === v);
              return (
                <Card key={v} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: d.tint, color: d.accent }}><Icon className="h-5 w-5" aria-hidden /></span>
                    <div className="flex-1">
                      <div className="font-bold text-[var(--ink)]">{d.label}</div>
                      <div className="text-xs text-[var(--ink3)]">{auth?.subcategories.length ?? 0} subcategories · {open} open items</div>
                    </div>
                    <Badge tone="green">Authorised</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {visibleItems(v, perms).filter((i) => i.slug !== 'overview' && !i.soon).map((i) => (
                      <Link key={i.slug} href={packHref(v, i.slug)} className="rounded-lg bg-[var(--bg)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--ink2)] hover:bg-[var(--g1)] hover:text-[var(--g7)]">{i.label}</Link>
                    ))}
                  </div>
                  <Link href={packHref(v)} className="mt-auto inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--g7)]">Open {d.label} pack <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Provider setup journey, computed from the demo data; hidden once every step is done. */
function SetupChecklist({ org, listings }: { org: Org; listings: Listing[] }) {
  const missing = org.verticals.filter((v) => v.status !== 'rejected').flatMap((v) => {
    const gates = v.subcategories.map((k) => SUB[k]?.licenceGate).filter((g): g is string => !!g && !v.licences.some((l) => l.name === g));
    return [...v.licences.filter((l) => l.status === 'missing'), ...[...new Set(gates)].map((name) => ({ name }))];
  });
  const steps = [
    { done: org.status === 'verified', label: 'Business verified by UpNow', hint: org.status === 'changes_requested' ? 'Changes requested — update and resubmit' : 'Identity, trade licence and bank details', to: `${BASE}/settings/verification` },
    { done: org.verticals.some((v) => v.status === 'approved'), label: 'At least one vertical authorised', hint: 'Each vertical is approved separately', to: `${BASE}/settings/verticals` },
    { done: missing.length === 0, label: 'Licences on file', hint: missing.length ? `Missing: ${missing.map((l) => l.name).join(', ')}` : 'All required licences uploaded', to: `${BASE}/settings/verticals` },
    { done: listings.some((l) => l.status !== 'draft'), label: 'First listing submitted', hint: 'Create it in an authorised subcategory', to: `${BASE}/listings/new` },
    { done: listings.some((l) => l.status === 'published'), label: 'First listing live', hint: 'Approved by UpNow and visible in the marketplace', to: `${BASE}/listings` },
    { done: org.members.length > 1, label: 'Team invited', hint: 'Managers, front desk, accountant', to: `${BASE}/settings/team` },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  if (doneCount === steps.length) return null;
  return (
    <Card className="mb-6">
      <SectionTitle right={<span className="text-[13px] font-bold text-[var(--g7)]">{doneCount} of {steps.length} done</span>}>Getting started</SectionTitle>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full rounded-full bg-[var(--g6)]" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((x) => (
          <li key={x.label}>
            <Link href={x.to} className="flex items-start gap-2 rounded-[10px] px-2 py-2 hover:bg-[var(--bg)]">
              {x.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g6)]" aria-label="Done" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--line2)]" aria-label="To do" />}
              <span><span className={x.done ? 'block text-[14px] font-semibold text-[var(--ink3)] line-through' : 'block text-[14px] font-bold'}>{x.label}</span><span className="block text-[12.5px] text-[var(--ink3)]">{x.hint}</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
