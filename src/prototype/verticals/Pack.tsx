'use client';

/**
 * PROTOTYPE ONLY — a vertical pack: group page with an in-page tab strip
 * (production's OsGroupTabs pattern). Prototype tabs render mock-data screens;
 * Live tabs open the real production page in a new browser tab.
 */
import Link from 'next/link';
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, ArrowRight, ExternalLink, Hammer, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../store';
import { MODEL_INFO, VERTICAL, subsOf } from '../registry';
import { BASE, PACKS, ROLE_PRESETS, findPackItem, isBridged, packHref, tabPerm, toBridge, type PackItem, type PackTab } from '../nav';
import { DEMO_PERSON } from '../seed';
import { Badge, Button, Card, Empty, ProtoNote, SectionTitle, StatusBadge } from '../ui';
import { ModuleHeader } from './common';
import { SpacesLeasing, SpacesPortfolio, SpacesStays, SpacesVenues, SpacesCourts, SpacesCharters } from './spaces';
import { ServicesJobs, ServicesAppointments, ServicesQuotes, ServicesOfferings } from './services';
import { ExperiencesSessions, ExperiencesReservations } from './experiences';
import { MembershipPlans, MembershipMembers, MembershipCredits } from './memberships';
import { ProgramApplications, ProgramEnrolments, ProgramAttendance } from './programs';
import { HealthAppointments, HealthPractitioners } from './health';
import { InsuranceQuotes, InsurancePolicies } from './insurance';
import { ListingsView } from '../views/Listings';
import { FinanceView } from '../views/Finance';
import { ReportsView } from '../views/Reports';
import type { VerticalId } from '../types';

/** Vertical-specific prototype screens, keyed `${vertical}/${tabSlug}`. */
const SCREENS: Record<string, ComponentType> = {
  'spaces/assets': SpacesPortfolio, 'spaces/leasing': SpacesLeasing, 'spaces/stays': SpacesStays,
  'spaces/venues': SpacesVenues, 'spaces/courts': SpacesCourts, 'spaces/charters': SpacesCharters,
  'services/offerings': ServicesOfferings, 'services/jobs-board': ServicesJobs, 'services/quotes': ServicesQuotes, 'services/appointments': ServicesAppointments,
  'experiences/sessions': ExperiencesSessions, 'experiences/reservations': ExperiencesReservations,
  'memberships/plans': MembershipPlans, 'memberships/members': MembershipMembers, 'memberships/credits': MembershipCredits,
  'programs/applications': ProgramApplications, 'programs/enrolments': ProgramEnrolments, 'programs/attendance': ProgramAttendance,
  'health/appointments': HealthAppointments, 'health/practitioners': HealthPractitioners,
  'insurance/quotes': InsuranceQuotes, 'insurance/policies': InsurancePolicies,
};

/** Screens every pack shares, scoped to the pack's vertical. */
function genericScreen(v: VerticalId, slug: string): ReactNode | null {
  switch (slug) {
    case 'overview': return <PackLanding v={v} />;
    case 'listings': return <ListingsView vertical={v} />;
    case 'money': return <FinanceView vertical={v} />;
    case 'booking-payments': return <FinanceView vertical={v} title="Booking payments" />;
    case 'pack-reports': return <ReportsView vertical={v} />;
    default: return null;
  }
}

export function PackView({ vertical, module, tab }: { vertical: string; module?: string; tab?: string }) {
  const { org, authStatus, role } = useProto();
  if (!(vertical in VERTICAL)) return <Empty title="Unknown vertical" />;
  const v = vertical as VerticalId;
  const d = VERTICAL[v];
  const status = authStatus(org, v);
  const member = org?.members.find((m) => m.name === DEMO_PERSON.name);
  const roleBlocked = role !== 'owner' && !(member?.packs ?? []).includes(v);
  const perms = ROLE_PRESETS[role].perms;

  if (!org || status !== 'approved' || roleBlocked) {
    return (
      <Card className="mx-auto mt-8 max-w-xl text-center">
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[var(--g1)] text-[var(--g7)]"><Lock className="h-5 w-5" aria-hidden /></span>
        <h2 className="text-lg font-bold">{d.label} is not available here</h2>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          {roleBlocked && status === 'approved'
            ? `Your membership does not include the ${d.label} pack (${ROLE_PRESETS[role].label}).`
            : <>This business&apos;s {d.label} authorisation is <StatusBadge status={status} />. Packs appear only after UpNow approves the vertical.</>}
        </p>
        {!roleBlocked && <div className="mt-4"><Link href={`${BASE}/settings/verticals`}><Button>{status === 'not_requested' ? 'Request access' : 'View request'}</Button></Link></div>}
      </Card>
    );
  }

  // Resolve group + tab. Old-style links (/v/spaces/courts) name a tab directly.
  const hit = findPackItem(v, module ?? 'overview');
  if (!hit) return <Empty title="Unknown module" />;
  const item = hit.item;
  if (!perms.includes(item.perm)) return <RoleLocked label={item.label} />;
  if (item.soon) return <SoonView v={v} item={item} />;

  const allowedTabs = item.tabs.filter((t) => perms.includes(tabPerm(item, t)));
  const protoTabs = allowedTabs.filter((t) => !t.live);
  const active = hit.tab ?? allowedTabs.find((t) => t.slug === tab) ?? allowedTabs[0] ?? protoTabs[0];
  // Spaces production screens are hosted inside the shell (/prototype/os/rp/**); other live tabs need another login.
  if (active && isBridged(active.live)) return <GoTo href={toBridge(active.live!)} />;
  if (!active || active.live) return <LiveGroupView v={v} item={item} tabs={allowedTabs} />;
  if (!perms.includes(tabPerm(item, active))) return <RoleLocked label={active.label} />;

  const Screen = SCREENS[`${v}/${active.slug}`];
  const body = Screen ? <Screen /> : genericScreen(v, active.slug) ?? <Empty title="Unknown module" />;
  return (
    <div>
      {allowedTabs.length > 1 && <GroupTabs v={v} item={item} tabs={allowedTabs} active={active.slug} />}
      {body}
    </div>
  );
}

/** Production's OsGroupTabs: the group's tabs as a strip above the page. */
function GoTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(href); }, [router, href]);
  return <p className="text-[14px] text-[var(--ink3)]">Opening…</p>;
}

const tabCls = (on: boolean) => cn('inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[13px] text-[13.5px] font-semibold transition-colors',
  on ? 'border-[var(--g8)] bg-[var(--g8)] text-white' : 'border-[var(--line2)] bg-white text-[var(--ink)] hover:border-[var(--g5)]');
const liveBadge = (on: boolean) => <span className={cn('rounded-[5px] px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.04em]', on ? 'bg-white/20 text-white' : 'bg-[var(--g7)] text-white')}>Live</span>;

/** Group tab strip. Spaces Live tabs are production screens hosted in the shell; other Live tabs open externally. */
export function GroupTabs({ v, item, tabs, active }: { v: VerticalId; item: PackItem; tabs: PackTab[]; active: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] pb-3">
      <span className="mr-1 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink3)]">{item.label}</span>
      {tabs.map((t) => isBridged(t.live) ? (
        <Link key={t.slug} href={toBridge(t.live!)} aria-current={t.slug === active ? 'page' : undefined} className={tabCls(t.slug === active)}>
          {t.label}{liveBadge(t.slug === active)}
        </Link>
      ) : t.live ? (
        <a key={t.slug} href={t.live} target="_blank" rel="noreferrer"
          className="inline-flex h-[34px] items-center gap-1.5 rounded-full border border-[var(--line2)] bg-white px-[13px] text-[13.5px] font-semibold text-[var(--ink)] hover:border-[var(--g5)]">
          {t.label}{liveBadge(false)}
          <ExternalLink className="h-3.5 w-3.5 text-[var(--ink3)]" aria-hidden />
        </a>
      ) : (
        <Link key={t.slug} href={`${BASE}/v/${v}/${item.slug}/${t.slug}`} aria-current={t.slug === active ? 'page' : undefined} className={tabCls(t.slug === active)}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

/** A group made only of production pages (e.g. Spaces → Customers, Operations, Cases). */
function LiveGroupView({ v, item, tabs }: { v: VerticalId; item: PackItem; tabs: PackTab[] }) {
  const Icon = item.icon;
  return (
    <div>
      <ModuleHeader v={v} title={item.label} model="Production module" subtitle={`${item.hint}. This group is the existing, working production module — the prototype links to it unchanged.`} />
      <div className="mb-5"><ProtoNote kind="info">These production pages belong to the service-provider portal and need a service-provider login, so they open in a new tab. (Spaces production screens run inside this shell.)</ProtoNote></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tabs.filter((t) => t.live).map((t) => (
          <a key={t.slug} href={t.live} target="_blank" rel="noreferrer"
            className="group flex flex-col gap-2 rounded-[var(--r)] border border-[var(--g2)] bg-[var(--g1)] p-4 transition-all hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
            <span className="flex items-center justify-between"><Icon className="h-5 w-5 text-[var(--g7)]" aria-hidden /><Badge tone="green">Live</Badge></span>
            <span className="text-[15px] font-bold text-[var(--ink)] group-hover:text-[var(--g7)]">{t.label}</span>
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--g7)]">{t.live} <ExternalLink className="h-3 w-3" aria-hidden /></span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** Production's `soon` groups render an "In development" placeholder. */
function SoonView({ v, item }: { v: VerticalId; item: PackItem }) {
  return (
    <div>
      <ModuleHeader v={v} title={item.label} model="In development" subtitle={item.hint} />
      <div className="flex flex-col items-center gap-2 rounded-[var(--r)] border-[1.5px] border-dashed border-[var(--line2)] bg-white px-6 py-14 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--g1)] text-[var(--g7)]"><Hammer className="h-5 w-5" aria-hidden /></span>
        <div className="font-bold">In development</div>
        <p className="max-w-md text-[14px] text-[var(--ink3)]">This group is part of the {VERTICAL[v].label} pack menu defined in MarketSpace. It is shown so the pack structure is complete; the screens are a later phase.</p>
      </div>
    </div>
  );
}

function RoleLocked({ label }: { label: string }) {
  const { role } = useProto();
  return (
    <Card className="mx-auto mt-8 max-w-lg text-center">
      <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[var(--g1)] text-[var(--g7)]"><Lock className="h-5 w-5" aria-hidden /></span>
      <h2 className="text-[18px] font-bold">{label} is not available for {ROLE_PRESETS[role].label}</h2>
      <p className="mt-1 text-[14px] text-[var(--ink3)]">{ROLE_PRESETS[role].description}</p>
    </Card>
  );
}

/** Pack overview: the pack's groups (same as the sidebar) and its subcategories. */
function PackLanding({ v }: { v: VerticalId }) {
  const { org, role } = useProto();
  const d = VERTICAL[v];
  const perms = ROLE_PRESETS[role].perms;
  const auth = org!.verticals.find((a) => a.vertical === v)!;
  return (
    <div>
      <ModuleHeader v={v} title={`${d.label} pack`} subtitle={d.blurb} />
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PACKS[v].filter((i) => i.slug !== 'overview' && perms.includes(i.perm)).map((i) => {
          const Icon = i.icon;
          const allLive = i.tabs.length > 0 && i.tabs.every((t) => t.live);
          const someLive = i.tabs.some((t) => t.live);
          return (
            <Link key={i.slug} href={packHref(v, i.slug)}
              className={cn('group flex flex-col gap-2 rounded-[var(--r)] border p-4 transition-all hover:border-[var(--g5)] hover:shadow-[var(--sh)]', i.soon ? 'border-dashed border-[var(--line2)] bg-[#fcfdfc]' : 'border-[var(--line)] bg-white')}>
              <div className="flex items-center justify-between gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-[9px] bg-[var(--g1)] text-[var(--g7)]"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                {i.soon ? <Badge tone="neutral">In development</Badge> : i.isNew ? <Badge tone="blue">New</Badge> : allLive ? <Badge tone="green">Live</Badge> : someLive ? <Badge tone="green">Live + new</Badge> : <Badge tone="violet">Prototype</Badge>}
              </div>
              <div className="font-bold text-[var(--ink)] group-hover:text-[var(--g7)]">{i.label}</div>
              <div className="text-[13px] text-[var(--ink3)]">{i.hint}</div>
              {i.tabs.length > 1 && <div className="text-[12px] font-semibold text-[var(--ink2)]">{i.tabs.map((t) => t.label).join(' · ')}</div>}
              <span className="mt-auto inline-flex items-center gap-1 text-[13px] font-bold text-[var(--g7)]">Open <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
            </Link>
          );
        })}
      </div>
      <SectionTitle>Authorised subcategories and how each operates</SectionTitle>
      <p className="-mt-2 mb-3 text-[13.5px] text-[var(--ink3)]">Subcategories are not menu items: they are asset, listing and booking types inside the groups above.</p>
      <div className="grid gap-2 md:grid-cols-2">
        {subsOf(v).map((s) => {
          const ok = auth.subcategories.includes(s.key);
          return (
            <Card key={s.key} className={ok ? '' : 'opacity-60'}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.label}</span>
                {ok ? <Badge tone="green">Authorised</Badge> : <Badge tone="neutral">Not authorised</Badge>}
              </div>
              <div className="mt-1 text-xs text-[var(--ink3)]">{MODEL_INFO[s.model].label} · {s.priceBasis}{s.regulator ? ` · ${s.regulator}` : ''}</div>
              <div className="mt-2 text-[12.5px] text-[var(--ink2)]">{s.flow.join(' → ')}</div>
            </Card>
          );
        })}
      </div>
      {v === 'spaces' && <div className="mt-6"><ProtoNote kind="info"><Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden />Every Spaces group except <strong>Bookings</strong> is the production module, unchanged. Bookings adds holiday stays, venues, courts and charters beside Leases.</ProtoNote></div>}
    </div>
  );
}
