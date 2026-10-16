'use client';

import Link from 'next/link';
import { Briefcase, ShieldCheck, UserRound, ArrowRight, CheckCircle2, Layers, Lock } from 'lucide-react';
import { MODEL_INFO, VERTICALS, subsOf } from '../registry';
import { PresentationLinkCard } from '../shell';
import { Badge, Card, ProtoNote, SectionTitle } from '../ui';
import type { FlowKind } from '../types';

const FLOW_TONE: Record<FlowKind, 'blue' | 'green' | 'violet'> = { lead: 'blue', booking: 'green', operational: 'violet' };
const FLOW_LABEL: Record<FlowKind, string> = { lead: 'Lead-led', booking: 'Booking', operational: 'Operational' };

const TOUR = [
  { to: '/prototype/os', label: 'Provider overview — one business, three authorised verticals' },
  { to: '/prototype/os/demand', label: 'Shared Demand inbox — convert an enquiry into the right transaction' },
  { to: '/prototype/os/v/spaces', label: 'Spaces pack — the production menu, every group Live, plus Bookings' },
  { to: '/prototype/os/v/spaces/bookings/courts', label: 'Spaces › Bookings › Courts — hourly slots, a different model from leases' },
  { to: '/prototype/os/listings/new', label: 'Create a listing — only in authorised subcategories' },
  { to: '/prototype/os/settings/verticals', label: 'Settings · request access to another vertical' },
  { to: '/prototype/admin/access', label: 'Admin approves vertical access — the sidebar updates' },
  { to: '/prototype/admin/listings', label: 'Admin reviews listings — approve or request changes' },
  { to: '/prototype/me', label: 'Same person, personal (customer) context' },
  { to: '/prototype/me/browse', label: 'Browse as Sam Carter (customer) and contact a provider by chat, WhatsApp, call or form' },
  { to: '/prototype/os/communications', label: 'Provider replies in Communications — the customer sees it in My enquiries' },
  { to: '/prototype/os/onboarding', label: 'Start a business with several verticals; prepare listings while verification is pending' },
  { to: '/prototype/os/listings', label: 'Edit a live listing — it goes back to review; unpublish it' },
];

const PRESERVED = [
  'Properties & units, listing submission', 'Leads, viewings & payment plans', 'Contracts v2: issue, sign, Ejari, move-in',
  'Renewals, termination, settlement', 'Cheques/PDC, receivables & deposits', 'Maintenance, vendors, AMC, inspections',
  'Breaches & legal cases', 'Manager permissions (41 flags) & landlord scope', '29 Spaces reports',
];

export function HomeView() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 md:px-6">
      <div className="mb-8 rounded-3xl bg-gradient-to-br from-[var(--g9)] to-[var(--g8)] p-7 text-white md:p-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-[#bfe2cf]">
          <Layers className="h-3.5 w-3.5" aria-hidden /> UpNow OS · multi-vertical prototype
        </div>
        <h1 className="ms-serif max-w-3xl text-[34px] leading-[1.08] md:text-[46px]">
          One operating system for seven verticals, without bending a lease into a booking.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/75">
          A shared layer (demand, calendar, customers, finance, reports, business) plus a workspace per vertical,
          shown only when the business is authorised for it. The existing Spaces leasing engine stays exactly as it is.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/prototype/os" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-[var(--g9)] hover:bg-[var(--g1)]">
            Open the provider OS <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/prototype/admin" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold text-white ring-1 ring-white/25 hover:bg-white/15">
            Open the admin console
          </Link>
        </div>
      </div>

      <div className="mb-8 grid gap-3 md:grid-cols-3">
        <PresentationLinkCard to="/prototype/os" icon={Briefcase} title="Provider OS" body="Switch between four demo businesses and four role presets. The sidebar shows only authorised verticals and permitted modules." />
        <PresentationLinkCard to="/prototype/admin" icon={ShieldCheck} title="Admin console" body="Verify providers, authorise verticals and review listings. Decisions update the provider view immediately." />
        <PresentationLinkCard to="/prototype/me" icon={UserRound} title="Personal context" body="The same person as a customer: a lease, a service booking, a membership, an enrolment and a policy." />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <SectionTitle>Suggested walkthrough</SectionTitle>
          <ol className="flex flex-col gap-1">
            {TOUR.map((t, i) => (
              <li key={t.to}>
                <Link href={t.to} className="group flex items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-[var(--bg)]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--g1)] text-xs font-bold text-[var(--g7)]">{i + 1}</span>
                  <span className="flex-1 text-[var(--ink)] group-hover:text-[var(--g7)]">{t.label}</span>
                  <ArrowRight className="h-4 w-4 text-[var(--line2)] group-hover:text-[var(--g7)]" aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <SectionTitle>Preserved from production</SectionTitle>
          <p className="mb-3 text-sm text-[var(--ink3)]">These Spaces modules are not modified. In the target navigation the Spaces pack keeps the production menu as is — Overview, Portfolio, Customers, Leases, Transactions, Operations, Performance & Economics, Maintenance, Cases, Reports — and adds one group, Bookings.</p>
          <ul className="flex flex-col gap-1.5">
            {PRESERVED.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-[var(--ink)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g6)]" aria-hidden /> {p}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <SectionTitle right={
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(Object.keys(FLOW_LABEL) as FlowKind[]).map((k) => <Badge key={k} tone={FLOW_TONE[k]}>{FLOW_LABEL[k]}</Badge>)}
        </div>
      }>
        Seven verticals, 35 subcategories, different operating models
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {VERTICALS.map((v) => {
          const Icon = v.icon;
          return (
            <Card key={v.id} className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: v.tint, color: v.accent }}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <div className="font-bold text-[var(--ink)]">{v.label}</div>
                  <div className="text-xs text-[var(--ink3)]">{v.regulators}</div>
                </div>
              </div>
              <ul className="flex flex-col divide-y divide-[#eef0ef]">
                {subsOf(v.id).map((s) => {
                  const m = MODEL_INFO[s.model];
                  return (
                    <li key={s.key} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                      <span className="flex items-center gap-1.5 text-[var(--ink)]">
                        {s.label}
                        {s.licenceGate && <span title={`Listing gate: ${s.licenceGate}`}><Lock className="h-3 w-3 text-[#8a958e]" aria-label={`Licence gate: ${s.licenceGate}`} /></span>}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="hidden text-[11.5px] text-[var(--ink3)] sm:inline">{m.label}</span>
                        <Badge tone={FLOW_TONE[m.flow]}>{FLOW_LABEL[m.flow]}</Badge>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>

      <div className="mt-8">
        <ProtoNote>
          Everything under <code>/prototype</code> is a clickable demonstration built on dummy data held in the browser tab.
          It makes no API calls and does not modify any production route, component or data. Taxonomy source: upnow-marketspace <code>data/listings.js</code>.
        </ProtoNote>
      </div>
    </div>
  );
}
