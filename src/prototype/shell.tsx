'use client';

/**
 * PROTOTYPE ONLY — shells for the multi-vertical OS demo.
 *
 *  - PrototypeBanner: persistent strip that labels every screen as mock data.
 *  - OsShell: target provider sidebar = Shared UpNow OS + one pack per
 *    authorised vertical, filtered by the member's role preset.
 *  - AdminShell: platform admin console.
 *
 * Layout follows the MarketSpace provider dashboard (pw/app.css + pw/site.css):
 * 264px light sidebar with a white 64px logo strip, a profile card, one white
 * menu card with a solid-green active item, a separated pack section, and a
 * 64px white top bar. The MarketSpace admin console reuses the same shell.
 */
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import {
  FlaskConical, RotateCcw, ChevronDown, ChevronRight, Lock, Plus, Menu, X, UserRound, ShieldCheck,
  LayoutDashboard, ListChecks, KeyRound, Store, ArrowLeft, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from './store';
import { VERTICALS, VERTICAL } from './registry';
import { BASE, BRIDGE, BUSINESS_VIEWS, ROLE_PRESETS, SHARED_MODULES, href, matchBridge, packHref, visibleItems, type PackItem, type Perm } from './nav';
import { DEMO_PERSON } from './seed';
import { Avatar, Badge, Button, Card } from './ui';
import type { RolePreset, VerticalId } from './types';
import { PROTO_TOASTER } from './toast';

/**
 * Prototype-only toaster. Bottom-left keeps confirmations clear of right-hand
 * drawers (header + footer actions) and the top bar; on phones it floats above
 * a drawer's footer buttons. The production root toaster is untouched.
 */
export function PrototypeToaster() {
  return (
    <Toaster
      id={PROTO_TOASTER}
      position="bottom-left"
      offset={{ bottom: 24, left: 24 }}
      mobileOffset={{ bottom: 84, left: 12, right: 12 }}
      richColors
      closeButton
      duration={4000}
    />
  );
}

export function PrototypeBanner() {
  const { reset } = useProto();
  const path = usePathname();
  const link = (to: string, label: string, active: boolean) => (
    <Link href={to} className={cn('whitespace-nowrap rounded-full px-2 py-0.5 font-semibold sm:px-2.5 text-white/80 hover:bg-white/10 hover:text-white', active && 'bg-white/15 text-white')}>{label}</Link>
  );
  return (
    <div className="z-[60] flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--g9)] px-4 py-1.5 text-[12px] text-white md:sticky md:top-0">
      <span className="inline-flex items-center gap-1.5 font-extrabold text-[#ffcf8a]">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Prototype · mock data
      </span>
      <span className="hidden text-[#a9cdb9] md:inline">No API calls, payments or bookings are made. Production modules are untouched.</span>
      <nav className="ml-auto flex flex-wrap items-center gap-0.5 sm:gap-1">
        {link('/prototype', 'Overview', path === '/prototype')}
        {link(BASE, 'Provider OS', path.startsWith(BASE))}
        {link('/prototype/admin', 'Admin', path.startsWith('/prototype/admin'))}
        {link('/prototype/me', 'Personal', path.startsWith('/prototype/me'))}
        <button type="button" onClick={reset} className="ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-semibold text-white/80 hover:bg-white/10 hover:text-white" title="Reset demo data">
          <RotateCcw className="h-3 w-3" aria-hidden /> Reset
        </button>
      </nav>
    </div>
  );
}

/** Which permission a path needs (null = always allowed / checked by the page). */
function permForPath(path: string): Perm | null {
  const rest = path.slice(BASE.length).split('/').filter(Boolean);
  if (rest.length === 0) return 'overview';
  if (rest[0] === 'onboarding') return null;
  // Pack pages check the group's and tab's permission themselves (with authorisation).
  if (rest[0] === 'v') return null;
  // Hosted production screens follow the permission of the group they belong to.
  if (path.startsWith(BRIDGE)) { const m = matchBridge(path); return m?.pack ? m.pack.item.perm : m?.shared ? m.shared.perm : 'operate'; }
  if (rest[0] === 'listings') return 'listings';
  const shared = SHARED_MODULES.find((m) => m.slug === rest[0]);
  if (shared) return shared.perm;
  return BUSINESS_VIEWS.find((b) => b.slug === rest[0])?.perm ?? null;
}

/** Sidebar badge for a pack group: planned, added by this work, or the production module. */
function groupBadge(i: PackItem) {
  const cls = 'rounded-[5px] px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.04em]';
  if (i.soon) return <span className={cn(cls, 'bg-[#eef0ef] text-[var(--ink3)]')}>Soon</span>;
  if (i.isNew) return <span className={cn(cls, 'bg-[#e3eef8] text-[#1f5a8c]')}>New</span>;
  if (i.tabs.length > 0 && i.tabs.every((t) => t.live)) return <span className={cn(cls, 'bg-[var(--g7)] text-white')} title="Production module">Live</span>;
  if (i.tabs.some((t) => t.live)) return <span className={cn(cls, 'border border-[var(--g7)] text-[var(--g7)]')} title="Production pages plus new prototype screens">Live+</span>;
  return undefined;
}

/** `.app>.sb>.logo` — white strip at the top bar's height. */
function Logo({ to, tag }: { to: string; tag: string }) {
  return (
    <Link href={to} className="sticky top-0 z-[2] -mx-3.5 mb-1 flex h-16 shrink-0 items-center gap-2 border-b border-[var(--line)] bg-white px-[22px]">
      <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--g7)] text-[15px] font-extrabold text-white">U</span>
      <span className="text-[18px] font-extrabold tracking-[-0.02em] text-[var(--g9)]">UpNow</span>
      <span className="rounded-[5px] bg-[var(--g1)] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-[var(--g7)]">{tag}</span>
    </Link>
  );
}

/** `.bxh` group heading with the small square marker. */
function GroupHead({ label, kind }: { label: string; kind: 'os' | 'pack' | 'muted' }) {
  return (
    <div className={cn('flex items-center gap-[7px] px-2.5 pb-1.5 pt-2 text-[11.5px] font-extrabold uppercase tracking-[0.08em]',
      kind === 'os' ? 'text-[var(--g9)]' : kind === 'pack' ? 'text-[var(--g6)]' : 'text-[var(--ink3)]')}>
      <span className={cn('h-2 w-2 rounded-[2px]', kind === 'os' ? 'bg-[var(--g9)]' : kind === 'pack' ? 'border border-[var(--g5)] bg-[var(--g2)]' : 'bg-[var(--line2)]')} aria-hidden />
      {label}
    </div>
  );
}

function ContextSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { orgs, org, setContext, approvedVerticals } = useProto();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const n = org ? approvedVerticals(org).length : 0;
  return (
    <div className="relative">
      {/* `.sb .biz` — the account's profile card */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3.5 text-left transition-colors hover:border-[var(--g5)]"
      >
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[var(--g7)] text-[14px] font-extrabold text-white">
          {org?.initials ?? 'ME'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[14px] font-bold leading-tight text-[var(--ink)]">{org?.name ?? 'Personal'}</span>
          <span className="mt-0.5 block truncate text-[12px] font-bold text-[var(--g5)]">
            {org ? `${n} vertical${n === 1 ? '' : 's'}` : 'Customer context'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-[var(--ink3)] transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-[var(--r)] border border-[var(--line)] bg-white p-2 shadow-[var(--sh-lg)]">
          <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink3)]">Switch context</div>
          <button
            type="button"
            onClick={() => { setContext('personal'); setOpen(false); onNavigate?.(); router.push('/prototype/me'); }}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] font-semibold hover:bg-[var(--bg)]"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--bg)] text-[var(--ink3)]"><UserRound className="h-4 w-4" aria-hidden /></span>
            Personal (as a customer)
          </button>
          <div className="my-1 border-t border-[var(--line)]" />
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { setContext(o.id); setOpen(false); onNavigate?.(); router.push(BASE); }}
              className={cn('flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] font-semibold hover:bg-[var(--bg)]', org?.id === o.id && 'bg-[var(--g1)]')}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[var(--g1)] text-[11px] font-extrabold text-[var(--g7)]">{o.initials}</span>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              {o.status !== 'verified' && <Badge tone="blue">Pending</Badge>}
              {org?.id === o.id && <Check className="h-4 w-4 text-[var(--g7)]" aria-hidden />}
            </button>
          ))}
          <div className="my-1 border-t border-[var(--line)]" />
          <Link
            href={`${BASE}/onboarding`}
            onClick={() => { setOpen(false); onNavigate?.(); }}
            className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13.5px] font-bold text-[var(--g7)] hover:bg-[var(--g1)]"
          >
            <Plus className="h-4 w-4" aria-hidden /> Start another business
          </Link>
        </div>
      )}
    </div>
  );
}

/** `.sb .osbox a.ni` — 40px item, solid brand green when active. */
function NavLink({ to, icon: Icon, label, active, onClick, badge, tone = 'os', muted }: {
  to: string; icon: React.ComponentType<{ className?: string }>; label: string; active: boolean; onClick?: () => void; badge?: ReactNode; tone?: 'os' | 'pack'; muted?: boolean;
}) {
  return (
    <Link
      href={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex min-h-10 items-center gap-[11px] rounded-[10px] px-3 py-2 text-[14px] font-semibold leading-tight transition-colors',
        tone === 'os'
          ? active ? 'bg-[var(--g7)] font-bold text-white' : 'text-[var(--ink2)] hover:bg-[var(--g1)] hover:text-[var(--ink)]'
          : active ? 'bg-[var(--g2)] font-bold text-[var(--g9)]' : muted ? 'text-[var(--ink3)] hover:bg-[var(--bg)]' : 'text-[var(--ink2)] hover:bg-[var(--bg)] hover:text-[var(--ink)]',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', tone === 'pack' && active && 'text-[var(--g7)]')} />
      {/* wraps to a second line instead of truncating; the badge never shrinks */}
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {badge && <span className="shrink-0">{badge}</span>}
    </Link>
  );
}

function CountBadge({ n, active }: { n: number; active: boolean }) {
  return (
    <span className={cn('grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-[11px] font-extrabold', active ? 'bg-white/20 text-white' : 'bg-[var(--g1)] text-[var(--g7)]')}>{n}</span>
  );
}

function OsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { org, role, approvedVerticals, authStatus, leads, context } = useProto();
  const path = usePathname();
  const perms = ROLE_PRESETS[role].perms;
  const approved = approvedVerticals(org);
  const member = org?.members.find((m) => m.name === DEMO_PERSON.name);
  // Owner sees every approved pack; other presets see only the packs their membership grants.
  const packs = approved.filter((v) => (role === 'owner' || (member?.packs ?? []).includes(v)) && visibleItems(v, perms).length > 0);
  const shared = SHARED_MODULES.filter((m) => perms.includes(m.perm));
  const onBusinessOverview = path === BASE || BUSINESS_VIEWS.some((b) => path.startsWith(href(b.slug)));
  const openLeads = leads.filter((l) => l.orgId === context && l.stage === 'new').length;
  const search = useSearchParams().toString();
  const bridged = matchBridge(path, search ? `?${search}` : '');
  const activePack = path.startsWith(`${BASE}/v/`) ? (path.split('/')[4] as VerticalId) : bridged?.pack ? 'spaces' : null;

  return (
    <div className="ms-noscroll flex h-full flex-col gap-3 overflow-y-auto bg-[var(--bg)] px-3.5 pb-4">
      <Logo to="/prototype" tag="OS" />
      <ContextSwitcher onNavigate={onNavigate} />
      {org && perms.includes('overview') && (
        <div className="-mt-1.5">
          <NavLink tone="pack" to={BASE} icon={LayoutDashboard} label="Business overview" active={onBusinessOverview} onClick={onNavigate} />
        </div>
      )}

      {shared.length > 0 && (
      <nav className="flex flex-col gap-0.5 rounded-xl border border-[var(--line)] bg-white p-1.5" aria-label="Shared UpNow OS">
        <GroupHead label="Shared UpNow OS" kind="os" />
        {shared.map((m) => {
          const to = href(m.slug);
          const active = (m.slug ? path.startsWith(to) : path === BASE) || bridged?.shared?.slug === m.slug;
          return (
            <NavLink key={m.slug} to={to} icon={m.icon} label={m.label} active={active} onClick={onNavigate}
              badge={m.slug === 'demand' && openLeads > 0 ? <CountBadge n={openLeads} active={active} /> : undefined} />
          );
        })}
      </nav>
      )}

      {packs.length > 0 && (
        <nav className="flex flex-col gap-1 border-t border-[var(--line)] pt-3" aria-label="Vertical packs">
          <GroupHead label="Vertical packs" kind="pack" />
          {packs.map((v) => {
            const d = VERTICAL[v];
            const Icon = d.icon;
            const open = activePack === v;
            return (
              <div key={v}>
                {/* `.pkbox .pksw` — pack switch row */}
                <Link
                  href={packHref(v)}
                  onClick={onNavigate}
                  className={cn('flex h-11 items-center gap-2.5 rounded-[10px] border bg-white px-2.5 text-[14px] font-bold transition-colors hover:border-[var(--g5)]',
                    open ? 'border-[var(--g5)] text-[var(--g9)]' : 'border-[var(--line2)] text-[var(--ink)]')}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--g1)] text-[var(--g7)]"><Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="flex-1">{d.label}</span>
                  <ChevronRight className={cn('h-4 w-4 text-[var(--g7)] transition-transform', open && 'rotate-90')} aria-hidden />
                </Link>
                {open && (
                  <div className="mt-1 flex flex-col gap-0.5 pl-2">
                    {visibleItems(v, perms).map((i) => {
                      const to = packHref(v, i.slug);
                      const active = (path.startsWith(to) && !(to === BRIDGE && path !== BRIDGE)) || (i.slug === 'overview' && path === packHref(v)) || (v === 'spaces' && bridged?.pack?.item.slug === i.slug);
                      return <NavLink key={i.slug} tone="pack" to={to} icon={i.icon} label={i.label} onClick={onNavigate} active={active} muted={i.soon} badge={groupBadge(i)} />;
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      )}

      {org && perms.includes('business') && (
        <div className="flex flex-col gap-0.5 border-t border-[var(--line)] pt-3">
          <GroupHead label="Not yet authorised" kind="muted" />
          {VERTICALS.filter((v) => !approved.includes(v.id)).map((v) => {
            const st = authStatus(org, v.id);
            return (
              <Link
                key={v.id}
                href={`${BASE}/settings/verticals`}
                onClick={onNavigate}
                className="flex h-9 items-center gap-2.5 rounded-[10px] px-3 text-[13.5px] font-semibold text-[var(--ink3)] hover:bg-white hover:text-[var(--ink2)]"
              >
                <Lock className="h-4 w-4" aria-hidden />
                <span className="flex-1">{v.label}</span>
                {st === 'submitted' && <Badge tone="blue">Pending</Badge>}
                {st === 'changes_requested' && <Badge tone="amber">Changes</Badge>}
              </Link>
            );
          })}
        </div>
      )}

      <span className="flex-1" />
      {/* `.sb .explore` — dashed link back out of the workspace */}
      <Link href="/prototype" onClick={onNavigate} className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-[var(--g7)] text-[14px] font-bold text-[var(--g7)] hover:bg-[var(--g1)]">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Prototype overview
      </Link>
    </div>
  );
}

/** `.tsel` header select. */
function RoleSwitcher() {
  const { role, setRole } = useProto();
  return (
    <label className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink3)]">
      <span className="hidden sm:inline">View as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as RolePreset)}
        className="h-9 rounded-[10px] border border-[var(--line2)] bg-white pl-3 text-[14px] font-bold text-[var(--ink)] outline-none focus:border-[var(--g6)]"
        aria-label="View as role"
      >
        {(Object.keys(ROLE_PRESETS) as RolePreset[]).map((r) => <option key={r} value={r}>{ROLE_PRESETS[r].label}</option>)}
      </select>
    </label>
  );
}

export function OsShell({ children }: { children: ReactNode }) {
  const { org, role } = useProto();
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const need = permForPath(path);
  const allowed = need === null || ROLE_PRESETS[role].perms.includes(need);

  return (
    <div className="flex min-h-[calc(100vh-30px)] bg-[var(--bg)]">
      <aside className="sticky top-[30px] hidden h-[calc(100vh-30px)] w-[264px] shrink-0 md:block">
        <Suspense fallback={null}><OsSidebar /></Suspense>
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-[70] bg-[rgba(12,24,18,0.35)] md:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="relative h-full w-[288px] shadow-[var(--sh-lg)]" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute right-3 top-3.5 z-10 grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] bg-white"><X className="h-4 w-4" /></button>
            <Suspense fallback={null}><OsSidebar onNavigate={() => setMobileOpen(false)} /></Suspense>
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col border-[var(--line)] md:border-l">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-[var(--line)] bg-white px-4 md:top-[30px] md:px-6">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line)] md:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 truncate text-[14px] text-[var(--ink3)]">
            <span className="font-bold text-[var(--ink)]">{org?.name ?? 'Personal'}</span>
            {org && <span className="hidden sm:inline"> · {org.branches.length} branches · {org.members.length} team members</span>}
          </div>
          {/* `.live` pill */}
          <span className="hidden items-center gap-1.5 rounded-full bg-[var(--g1)] px-2.5 py-[5px] text-[12px] font-bold text-[var(--g7)] lg:inline-flex">
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--wa)] shadow-[0_0_0_3px_rgba(31,170,89,0.2)]" aria-hidden />Demo data
          </span>
          <RoleSwitcher />
          <div className="hidden items-center gap-2.5 border-l border-[var(--line)] pl-3 sm:flex">
            <Avatar name={DEMO_PERSON.name} size={34} />
            <span className="leading-tight">
              <span className="block text-[13.5px] font-bold text-[var(--ink)]">{DEMO_PERSON.name}</span>
              <span className="block text-[12px] text-[var(--ink3)]">{ROLE_PRESETS[role].label}</span>
            </span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 pb-16 pt-6 md:px-7">
          {allowed ? children : (
            <Card className="mx-auto mt-10 max-w-lg text-center">
              <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[var(--g1)] text-[var(--g7)]"><Lock className="h-5 w-5" aria-hidden /></span>
              <h2 className="text-[18px] font-bold text-[var(--ink)]">Not available for {ROLE_PRESETS[role].label}</h2>
              <p className="mt-1 text-[14px] text-[var(--ink3)]">{ROLE_PRESETS[role].description} The sidebar already hides this module; this card is what a deep link shows.</p>
              <div className="mt-4"><Link href={BASE}><Button variant="secondary">Back to overview</Button></Link></div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}

const ADMIN_NAV = [
  { to: '/prototype/admin', label: 'Overview', icon: LayoutDashboard },
  { to: '/prototype/admin/verification', label: 'Verification', icon: ShieldCheck },
  { to: '/prototype/admin/access', label: 'Vertical access', icon: KeyRound },
  { to: '/prototype/admin/listings', label: 'Listing review', icon: Store },
  { to: '/prototype/admin/registry', label: 'Category registry', icon: ListChecks },
];

/** MarketSpace admin reuses the provider shell; its profile avatar is the darkest green and carries an "Admin" tag. */
export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { applications, orgs, listings } = useProto();
  const counts: Record<string, number> = {
    '/prototype/admin/verification': applications.filter((a) => a.status === 'pending_review').length,
    '/prototype/admin/access': orgs.flatMap((o) => o.verticals).filter((v) => v.status === 'submitted').length,
    '/prototype/admin/listings': listings.filter((l) => l.status === 'in_review').length,
  };
  return (
    <div className="flex min-h-[calc(100vh-30px)] flex-col bg-[var(--bg)] md:flex-row">
      <aside className="ms-noscroll flex flex-col gap-3 bg-[var(--bg)] px-3.5 pb-4 md:sticky md:top-[30px] md:h-[calc(100vh-30px)] md:w-[264px] md:shrink-0 md:overflow-y-auto">
        <Logo to="/prototype" tag="Admin" />
        <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3.5">
          <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[var(--g9)] text-[14px] font-extrabold text-white">UA</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold leading-tight text-[var(--ink)]">UpNow Admin</span>
            <span className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-[var(--g5)]">
              <span className="rounded-md bg-[var(--g9)] px-[7px] py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-white">Admin</span>Sara
            </span>
          </span>
        </div>
        <nav className="flex gap-0.5 overflow-x-auto rounded-xl border border-[var(--line)] bg-white p-1.5 md:flex-col md:overflow-visible" aria-label="Admin">
          <div className="hidden md:block"><GroupHead label="Admin console" kind="os" /></div>
          {ADMIN_NAV.map((n) => {
            const active = n.to === '/prototype/admin' ? path === n.to : path.startsWith(n.to);
            return (
              <div key={n.to} className="shrink-0">
                <NavLink to={n.to} icon={n.icon} label={n.label} active={active}
                  badge={counts[n.to] ? <span className={cn('grid h-5 min-w-[22px] place-items-center rounded-full px-1.5 text-[11px] font-extrabold', active ? 'bg-white/20 text-white' : 'bg-[#fbf0dc] text-[#8a5a14]')}>{counts[n.to]}</span> : undefined} />
              </div>
            );
          })}
        </nav>
        <p className="hidden px-2 text-[12.5px] leading-relaxed text-[var(--ink3)] md:block">
          Admin is a separate account type. It never acts inside a provider organisation.
        </p>
      </aside>
      <main className="mx-auto w-full max-w-[1360px] flex-1 border-[var(--line)] px-4 pb-16 pt-6 md:border-l md:px-8">{children}</main>
    </div>
  );
}

/** `.mods .md` module card. */
export function PresentationLinkCard({ to, title, body, icon: Icon }: { to: string; title: string; body: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Link href={to} className="group flex gap-3.5 rounded-[var(--r)] border border-[var(--line)] bg-white p-4 transition-all hover:border-[var(--g5)] hover:shadow-[var(--sh)]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--g1)] text-[var(--g7)]"><Icon className="h-5 w-5" /></span>
      <span className="flex flex-col gap-1">
        <span className="text-[15px] font-bold text-[var(--ink)] group-hover:text-[var(--g7)]">{title}</span>
        <span className="text-[13px] leading-snug text-[var(--ink3)]">{body}</span>
      </span>
    </Link>
  );
}
