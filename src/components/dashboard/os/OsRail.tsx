'use client';

/**
 * UpNow OS rail, context bar and breadcrumb (Genspark Stage 2 shell) for the rental-provider,
 * manager and admin dashboards. Pure presentation over `workspaces.ts`; DashboardShell keeps
 * the auth guard, badge counts, manager permissions, collapse and mobile drawer.
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Award, BarChart2, Box, Briefcase, Building2, CalendarCheck, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList,
  Compass, Gauge, GraduationCap, Home, Layers, ListChecks, Lock, LogOut, MessageSquare, Scale, Settings, Shield, Stethoscope,
  TrendingUp, UserCog, Users, Wallet, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { buildDisplayName, cn } from '@/lib/utils';
import { useAuth, dashboardPath, type UserRole } from '@/contexts/AuthContext';
import { VERTICALS, isOfferLive, type MsVerticalId } from '@/lib/catalog';
import {
  activeChild, isAdminRole, visibleChildren, workspacesFor, type NavBadgeKey, type OsGroup,
} from './workspaces';
import { RP_BASE, useOsScope } from '@/lib/os/scope';
import { usePreview } from '@/lib/os/preview';
import s from './os.module.css';

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge, trending: TrendingUp, calendar: CalendarCheck, box: Box, wallet: Wallet, building: Building2,
  chart: BarChart2, settings: Settings, shield: Shield, lock: Lock, check: Check, users: Users, wrench: Wrench,
  layers: Layers, home: Home, message: MessageSquare, account: UserCog, clipboard: ClipboardList, tasks: ListChecks,
  briefcase: Briefcase, scale: Scale, calendarDays: CalendarDays,
};
const VICON: Record<MsVerticalId, LucideIcon> = {
  spaces: Building2, services: Wrench, experiences: Compass, memberships: Award,
  programs: GraduationCap, health: Stethoscope, insurance: Shield,
};

/** Managers always work in Spaces (they act for landlords), service providers always in
 *  Services; rental providers can switch. */
function useVertical(role: UserRole): MsVerticalId | null {
  const { vertical } = useOsScope();
  if (role === 'rental_provider') return vertical;
  if (role === 'manager') return 'spaces';
  if (role === 'service_provider') return 'services';
  return null;
}

type Counts = Partial<Record<NavBadgeKey, number>>;

// ---------------------------------------------------------------------------- business context

interface BusinessCtx { name: string; initials: string; gate1: string | null; licence: string | null }
const _bizCache: Partial<Record<UserRole, BusinessCtx>> = {};

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'U';
}

type BizProfile = {
  companyName?: string | null; poaPersonName?: string | null; businessName?: string | null; ownerName?: string | null;
  complianceStatus?: string | null; tradeLicenseNumber?: string | null;
};
const BIZ_ENDPOINT: Partial<Record<UserRole, string>> = {
  rental_provider: '/profiles/rental-provider/me',
  service_provider: '/profiles/service-provider/me',
};

/** The signed-in business (rental or service provider) — real profile, fetched once per session. */
function useBusiness(role: UserRole): BusinessCtx | null {
  const [b, setB] = useState<BusinessCtx | null>(_bizCache[role] ?? null);
  useEffect(() => {
    const path = BIZ_ENDPOINT[role];
    if (!path || _bizCache[role]) return;
    apiGet<{ profile?: BizProfile }>(path)
      .then(({ profile: p }) => {
        if (!p) return;
        const name = p.companyName || p.businessName || p.poaPersonName || p.ownerName || 'My business';
        const ctx = { name, initials: initialsOf(name), gate1: p.complianceStatus ?? null, licence: p.tradeLicenseNumber ?? null };
        _bizCache[role] = ctx;
        setB(ctx);
      })
      .catch(() => { /* chip falls back to the user's name */ });
  }, [role]);
  return b;
}

/** Gate 1 status from the real compliance vocabulary (compliant | pending_review | action_required | expired | paused). */
function gate1Pill(status: string | null) {
  switch (status) {
    case 'compliant': return { cls: s.pillOk, label: 'Verified' };
    case 'pending_review': return { cls: s.pillWarn, label: 'In review' };
    case 'action_required': return { cls: s.pillWarn, label: 'Action required' };
    case 'expired': return { cls: s.pillBad, label: 'Expired' };
    case 'paused': return { cls: s.pillBad, label: 'Paused' };
    default: return null;
  }
}

// ---------------------------------------------------------------------------- rail

export function OsRail({
  role, pathname, counts, perms, waOn, collapsed = false, onClose, withScope = (h) => h,
}: {
  role: UserRole;
  pathname: string;
  counts: Counts;
  perms: Record<string, boolean>;
  waOn: boolean;
  collapsed?: boolean;
  onClose?: () => void;
  withScope?: (href: string) => string;
}) {
  const { user, signOut } = useAuth();
  const search = useSearchParams();
  const vertical = useVertical(role);
  const all = useMemo(() => workspacesFor(role, vertical ?? 'spaces'), [role, vertical]);
  const groups = useMemo(
    () => all
      .map((g) => ({ g, kids: visibleChildren(g, role, perms, waOn) }))
      .filter(({ kids }) => kids.length > 0),
    [all, role, perms, waOn],
  );
  const active = activeChild(all, pathname, new URLSearchParams(search.toString()));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The workspace you are in is always open; others follow the user's toggles.
  const isOpen = (id: string) => open[id] ?? active?.group.id === id;

  const admin = isAdminRole(role);
  const v = vertical ? VERTICALS.find((x) => x.id === vertical) : null;
  const liveSubs = v ? v.offers.filter((o) => isOfferLive(v.id, o.id)).length : 0;
  const displayName = buildDisplayName(user, 'User');
  const badgeOf = (k?: NavBadgeKey) => (k ? counts[k] ?? 0 : 0);
  const groupBadge = (g: OsGroup) => (g.badgeKey ? badgeOf(g.badgeKey) : 0);
  const fmt = (n: number) => (n > 999 ? '999+' : String(n));

  // Providers (rental provider, manager, service provider): the two-section rail —
  // SHARED UPNOW OS + <VERTICAL> PACK (owner sketch). Admin keeps the layered rail below.
  if (!admin) {
    return (
      <ProviderRail
        role={role} groups={groups} active={active} isOpen={isOpen} toggle={(id, now) => setOpen((o) => ({ ...o, [id]: !now }))}
        vertical={vertical ?? 'spaces'} badgeOf={badgeOf} groupBadge={groupBadge} fmt={fmt} collapsed={collapsed}
        onClose={onClose} withScope={withScope} displayName={displayName} email={user?.email ?? ''} signOut={() => signOut()}
      />
    );
  }

  if (collapsed) {
    return (
      <aside className={s.rail} aria-label="Workspace navigation">
        <Link href={withScope(dashboardPath(role))} className={s.brand} style={{ justifyContent: 'center', padding: 0 }} title="UpNow">
          <span className={s.mark}>U</span>
        </Link>
        <nav className={s.nav} style={{ paddingTop: 8 }}>
          {groups.map(({ g, kids }) => {
            const Ic = ICONS[g.icon] ?? Gauge;
            const first = kids.find((k) => k.href);
            const on = active?.group.id === g.id;
            if (!first?.href) {
              return <span key={g.id} className={s.iconItem} style={{ opacity: .45 }} title={`${g.label} — coming soon`}><Ic size={17} /></span>;
            }
            return (
              <Link key={g.id} href={withScope(first.href)} className={cn(s.iconItem, on && s.iconItemOn)} title={g.label} aria-current={on ? 'page' : undefined}>
                <Ic size={17} />
                {groupBadge(g) > 0 && <span className={s.dot} />}
              </Link>
            );
          })}
        </nav>
        <div className={s.foot} style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <span className={s.av} title={`${displayName} · ${user?.email ?? ''}`}>{displayName.charAt(0).toUpperCase()}</span>
          <button type="button" className={s.signOut} style={{ justifyContent: 'center', marginTop: 0 }} onClick={() => signOut()} title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    );
  }

  // A layer header ("Shared" / "<Vertical> workspace") goes above each group whose tone
  // differs from the group before it (Overview sits above the layers).
  const headerAt = new Set<string>();
  groups.reduce<string | null>((prev, { g }) => {
    if (g.id === 'overview') return prev;
    if (g.tone !== prev) headerAt.add(g.id);
    return g.tone;
  }, null);
  return (
    <aside className={s.rail} aria-label="Workspace navigation">
      <Link href={withScope(dashboardPath(role))} className={s.brand}>
        <span className={s.mark}>U</span>
        <span className={s.brandName}>UpNow</span>
        <span className={s.brandTag}>{admin ? 'Admin' : 'OS'}</span>
        {onClose && (
          <button type="button" className={s.closeBtn} aria-label="Close menu" onClick={(e) => { e.preventDefault(); onClose(); }}>
            <X size={18} />
          </button>
        )}
      </Link>

      <div className={s.scope}>
        {admin ? (
          <>
            <div className={s.scopeK} style={{ color: 'var(--ms-ink-3)' }}>Role</div>
            <div className={s.scopeV}>Platform Admin</div>
            <div className={s.scopeD}>Verifies · authorises · reviews</div>
          </>
        ) : (
          <>
            <div className={s.scopeK}>Active vertical</div>
            <div className={s.scopeV}>{(() => { const Ic = VICON[v?.id ?? 'spaces']; return <Ic size={13} aria-hidden />; })()} {v?.label ?? 'Spaces'}</div>
            <div className={s.scopeD}>{liveSubs} of {v?.offers.length ?? 0} subcategories live{role === 'manager' ? ' · asset manager' : role === 'service_provider' ? ' · service provider' : ''}</div>
          </>
        )}
      </div>

      <nav className={s.nav}>
        {groups.map(({ g, kids }) => {
          const Ic = ICONS[g.icon] ?? Gauge;
          const groupOn = active?.group.id === g.id;
          const layerHeader = !admin && headerAt.has(g.id)
            ? (
              <div className={s.layer}>
                <i style={g.tone === 'vertical' ? { background: 'var(--ms-primary)' } : { background: 'var(--ms-tint)', border: '1px solid var(--ms-primary-lighter)' }} />
                {g.tone === 'vertical' ? `${v?.label ?? 'Spaces'} workspace` : 'Shared'}
              </div>
            )
            : null;
          const b = groupBadge(g);

          // A one-page workspace is a direct link — nothing to expand.
          if (kids.length === 1 && kids[0].href) {
            return (
              <div key={g.id}>
                {layerHeader}
                <div className={cn(s.group, groupOn && s.groupActive, groupOn && s.groupOpen)}>
                  <Link href={withScope(kids[0].href)} onClick={onClose} className={s.groupBtn} aria-current={groupOn ? 'page' : undefined}>
                    <span className={s.groupIc}><Ic size={15} /></span>
                    <span className={s.groupLabel}>{g.label}</span>
                    {b > 0 && <span className={s.badge}>{fmt(b)}</span>}
                  </Link>
                </div>
              </div>
            );
          }

          const expanded = isOpen(g.id);
          return (
            <div key={g.id}>
              {layerHeader}
              <div className={cn(s.group, expanded && s.groupOpen, groupOn && s.groupActive)}>
                <button type="button" className={s.groupBtn} aria-expanded={expanded}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}>
                  <span className={s.groupIc}><Ic size={15} /></span>
                  <span className={s.groupLabel}>{g.label}</span>
                  {b > 0 && !expanded && <span className={s.badge}>{fmt(b)}</span>}
                  <ChevronRight size={14} className={s.chev} aria-hidden />
                </button>
                {expanded && (
                  <div className={s.kids}>
                    {kids.map((k) => {
                      if (k.heading) {
                        return <div key={`h-${k.label}`} className={s.subhead} role="presentation">{k.label}</div>;
                      }
                      if (k.soon || !k.href) {
                        return (
                          <span key={k.label} className={cn(s.kid, s.kidSoon)} title="Designed — waiting on backend support">
                            {k.label}<span className={s.soonChip}>Soon</span>
                          </span>
                        );
                      }
                      const on = active?.child === k;
                      const n = badgeOf(k.badgeKey);
                      return (
                        <Link key={k.href} href={withScope(k.href)} onClick={onClose}
                          className={cn(s.kid, on && s.kidOn)} aria-current={on ? 'page' : undefined}>
                          {k.label}
                          {n > 0 && <span className={s.badge}>{fmt(n)}</span>}
                          {k.preview && !n && <span className={s.previewChip} title="Runs on preview data — no backend yet">Preview</span>}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={s.foot}>
        <div className={s.user}>
          <span className={s.av}>{displayName.charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className={s.userName} title={displayName}>{displayName}</div>
            <div className={s.userEmail} title={user?.email ?? ''}>{user?.email}</div>
          </div>
        </div>
        <button type="button" className={s.signOut} onClick={() => signOut()}>
          <LogOut size={15} aria-hidden /> Sign out
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------- provider rail

type Kid = ReturnType<typeof visibleChildren>[number];
type ActiveHit = ReturnType<typeof activeChild>;

const WORKSPACE_LABEL: Partial<Record<UserRole, string>> = {
  rental_provider: 'Provider workspace',
  manager: 'Asset manager workspace',
  service_provider: 'Service provider workspace',
};

const AUTH_LABEL: Record<string, string> = { granted: 'Authorised', pending: 'Pending', refused: 'Refused', none: 'Not requested' };

/** "<VERTICAL> PACK" section label. A rental provider can switch pack here: authorised
 *  verticals switch (and open the pack Overview); the rest are listed locked with their Gate 2
 *  state and open the existing lock page. Managers (Spaces) and service providers (Services)
 *  have a fixed pack. */
function PackSelector({ role, vertical, onClose }: { role: UserRole; vertical: MsVerticalId; onClose?: () => void }) {
  const { setVertical } = useOsScope();
  const { authOf } = usePreview();
  const [open, setOpen] = useState(false);
  const label = VERTICALS.find((x) => x.id === vertical)?.label ?? 'Spaces';
  const dot = <i className={s.secDotPack} aria-hidden />;
  if (role !== 'rental_provider') {
    return <div className={s.sec}>{dot}{label} pack</div>;
  }
  return (
    <div>
      <button type="button" className={cn(s.sec, s.packSel)} aria-expanded={open} aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)} title="Switch pack (vertical)">
        {dot}{label} pack
        <ChevronDown size={12} className={cn(s.packChev, open && s.packChevOpen)} aria-hidden />
      </button>
      {open && (
        <div className={s.packMenu} role="listbox" aria-label="Switch pack">
          {VERTICALS.map((vx) => {
            const Ic = VICON[vx.id];
            const st = authOf(vx.id).state;
            const on = vx.id === vertical;
            if (st === 'granted') {
              return (
                <button key={vx.id} type="button" role="option" aria-selected={on} className={cn(s.packOpt, on && s.packOptOn)}
                  onClick={() => { setOpen(false); setVertical(vx.id, { go: true }); onClose?.(); }}>
                  <Ic size={13} aria-hidden /> <span className={s.packOptName}>{vx.label}</span>
                  {on ? <Check size={13} aria-hidden /> : <span className={s.packState}>{AUTH_LABEL[st]}</span>}
                </button>
              );
            }
            return (
              <Link key={vx.id} href={`${RP_BASE}/v/${vx.id}`} role="option" aria-selected={on}
                className={cn(s.packOpt, s.packOptLocked, on && s.packOptOn)} title={`${vx.label} — ${AUTH_LABEL[st].toLowerCase()} (Gate 2)`}
                onClick={() => { setOpen(false); onClose?.(); }}>
                <Ic size={13} aria-hidden /> <span className={s.packOptName}>{vx.label}</span>
                <span className={cn(s.packState, st === 'pending' && s.packStatePending, st === 'refused' && s.packStateRefused)}>
                  <Lock size={10} aria-hidden /> {AUTH_LABEL[st]}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProviderRail({
  role, groups, active, isOpen, toggle, vertical, badgeOf, groupBadge, fmt, collapsed, onClose, withScope, displayName, email, signOut,
}: {
  role: UserRole;
  groups: { g: OsGroup; kids: Kid[] }[];
  active: ActiveHit;
  isOpen: (id: string) => boolean;
  toggle: (id: string, now: boolean) => void;
  vertical: MsVerticalId;
  badgeOf: (k?: NavBadgeKey) => number;
  groupBadge: (g: OsGroup) => number;
  fmt: (n: number) => string;
  collapsed: boolean;
  onClose?: () => void;
  withScope: (href: string) => string;
  displayName: string;
  email: string;
  signOut: () => void;
}) {
  const shared = groups.filter(({ g }) => g.tone === 'shared');
  const pack = groups.filter(({ g }) => g.tone === 'vertical');
  const packLabel = VERTICALS.find((x) => x.id === vertical)?.label ?? 'Spaces';

  if (collapsed) {
    const icon = ({ g, kids }: { g: OsGroup; kids: Kid[] }, tone: 'shared' | 'pack') => {
      const Ic = ICONS[g.icon] ?? Gauge;
      const first = kids.find((k) => k.href);
      const on = active?.group.id === g.id;
      if (!first?.href) return null;
      return (
        <Link key={g.id} href={withScope(first.href)} className={cn(s.iconItem, tone === 'shared' ? s.iconShared : s.iconPack, on && s.iconOn)}
          title={g.label} aria-label={g.label} aria-current={on ? 'page' : undefined}>
          <Ic size={16} />
          {groupBadge(g) > 0 && <span className={s.dot} />}
        </Link>
      );
    };
    return (
      <aside className={s.rail} aria-label="Workspace navigation">
        <Link href={withScope(dashboardPath(role))} className={s.brand} style={{ justifyContent: 'center', padding: 0 }} title="UpNow">
          <span className={s.mark}>U</span>
        </Link>
        <nav className={s.nav} style={{ paddingTop: 8 }}>
          <div className={s.iconSec} title="Shared UpNow OS"><i className={s.secDotShared} /></div>
          {shared.map((x) => icon(x, 'shared'))}
          <div className={s.iconSec} title={`${packLabel} pack`}><i className={s.secDotPack} /></div>
          {pack.map((x) => icon(x, 'pack'))}
        </nav>
        <div className={s.foot} style={{ display: 'grid', placeItems: 'center', gap: 8 }}>
          <span className={s.av} title={`${displayName} · ${email}`}>{displayName.charAt(0).toUpperCase()}</span>
          <button type="button" className={s.signOut} style={{ justifyContent: 'center', marginTop: 0 }} onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    );
  }

  // Same look as the previous rail (plain rows, icon, light-green active) — only the order,
  // names and the two sections changed (owner, 17 Oct 2026).
  const renderGroup = ({ g, kids }: { g: OsGroup; kids: Kid[] }) => {
    const on = active?.group.id === g.id;
    const b = groupBadge(g);
    const Ic = ICONS[g.icon] ?? Gauge;
    // A one-page workspace is a direct link — nothing to expand.
    if (kids.length === 1 && kids[0].href) {
      return (
        <div key={g.id} className={cn(s.group, on && s.groupActive, on && s.groupOpen)}>
          <Link href={withScope(kids[0].href)} onClick={onClose} className={s.groupBtn} aria-current={on ? 'page' : undefined}>
            <span className={s.groupIc}><Ic size={15} /></span>
            <span className={s.groupLabel}>{g.label}</span>
            {b > 0 && <span className={s.badge}>{fmt(b)}</span>}
            {kids[0].preview && <span className={s.previewChip} title="Runs on preview data — no backend yet">Preview</span>}
          </Link>
        </div>
      );
    }
    const expanded = isOpen(g.id);
    return (
      <div key={g.id} className={cn(s.group, expanded && s.groupOpen, on && s.groupActive)}>
        <button type="button" className={s.groupBtn} aria-expanded={expanded} onClick={() => toggle(g.id, expanded)}>
          <span className={s.groupIc}><Ic size={15} /></span>
          <span className={s.groupLabel}>{g.label}</span>
          {b > 0 && !expanded && <span className={s.badge}>{fmt(b)}</span>}
          <ChevronRight size={14} className={s.chev} aria-hidden />
        </button>
        {expanded && (
          <div className={s.kids}>
            {kids.map((k) => {
              if (k.heading) return <div key={`h-${k.label}`} className={s.subHead} role="presentation">{k.label}</div>;
              if (k.soon || !k.href) {
                return (
                  <span key={k.label} className={cn(s.kid, s.kidSoon)} title="Designed — waiting on backend support">
                    {k.label}<span className={s.soonChip}>Soon</span>
                  </span>
                );
              }
              const kon = active?.child === k;
              const n = badgeOf(k.badgeKey);
              return (
                <Link key={k.href} href={withScope(k.href)} onClick={onClose}
                  className={cn(s.kid, kon && s.kidOn)} aria-current={kon ? 'page' : undefined}>
                  {k.label}
                  {n > 0 && <span className={s.badge}>{fmt(n)}</span>}
                  {k.preview && !n && <span className={s.previewChip} title="Runs on preview data — no backend yet">Preview</span>}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={s.rail} aria-label="Workspace navigation">
      <Link href={withScope(dashboardPath(role))} className={s.brand}>
        <span className={s.mark}>U</span>
        <span className={s.brandName}>UpNow</span>
        <span className={s.brandTag}>OS</span>
        {onClose && (
          <button type="button" className={s.closeBtn} aria-label="Close menu" onClick={(e) => { e.preventDefault(); onClose(); }}>
            <X size={18} />
          </button>
        )}
      </Link>
      <nav className={s.nav}>
        <div className={s.layer}><i style={{ background: 'var(--ms-primary-dark)' }} aria-hidden />Shared UpNow OS</div>
        {shared.map(renderGroup)}
        <PackSelector role={role} vertical={vertical} onClose={onClose} />
        {pack.map(renderGroup)}
      </nav>
      <div className={s.foot}>
        <div className={s.user}>
          <span className={s.av}>{displayName.charAt(0).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div className={s.userName} title={displayName}>{displayName}</div>
            <div className={s.userEmail} title={email}>{email}</div>
          </div>
        </div>
        <button type="button" className={s.signOut} onClick={signOut}>
          <LogOut size={15} aria-hidden /> Sign out
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------- context bar

/** Topbar: the business you are working as (with its real Gate 1 status). Verticals are switched
 *  from the rail's pack selector, so the topbar carries no vertical tabs. */
export function OsContextBar({ role }: { role: UserRole }) {
  const { user } = useAuth();
  const biz = useBusiness(role);
  if (isAdminRole(role)) {
    return (
      <div className={s.ctx}>
        <div className={s.ws}>
          <span className={s.wsAv}>PA</span>
          <span className={s.wsTx}>
            <span className={s.wsA}>Platform Admin</span>
            <span className={s.wsB}>Separate portal · {VERTICALS.length} verticals</span>
          </span>
        </div>
      </div>
    );
  }

  const name = biz?.name ?? buildDisplayName(user, 'My business');
  const pill = role === 'rental_provider' || role === 'service_provider' ? gate1Pill(biz?.gate1 ?? null) : null;
  const sp = role === 'service_provider';
  return (
    <div className={s.ctx}>
      <div className={s.ws} title={biz?.licence ? `Trade licence ${biz.licence}` : undefined}>
        <span className={s.wsAv}>{biz?.initials ?? initialsOf(name)}</span>
        <span className={s.wsTx}>
          <span className={s.wsA}>{role === 'manager' ? 'Asset manager' : name}</span>
          <span className={s.wsB}>
            {pill ? <span className={cn(s.pill, pill.cls)}>{pill.label}</span> : role === 'manager' ? 'Managing for landlords' : sp ? 'Service provider' : null}
          </span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- breadcrumb

/** "Operations › Long-term leases" under the topbar, so the workspace is always visible. */
export function OsCrumb({ role, pathname }: { role: UserRole; pathname: string }) {
  const search = useSearchParams();
  const vertical = useVertical(role);
  const a = activeChild(workspacesFor(role, vertical ?? 'spaces'), pathname, new URLSearchParams(search.toString()));
  if (!a) return null;
  return (
    <div className={s.crumb}>
      <span className={s.crumbTone}>{isAdminRole(role) ? 'Admin' : a.group.tone === 'vertical' ? `${VERTICALS.find((x) => x.id === vertical)?.label ?? 'Spaces'} pack` : 'UpNow OS'}</span>
      <ChevronRight size={12} aria-hidden />
      <span>{a.group.label}</span>
      {a.group.children.filter((c) => !c.hidden).length > 1 && (
        <>
          <ChevronRight size={12} aria-hidden />
          <b>{a.child.label}</b>
        </>
      )}
    </div>
  );
}
