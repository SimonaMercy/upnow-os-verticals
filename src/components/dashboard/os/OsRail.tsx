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
  Award, BarChart2, Box, Building2, CalendarCheck, Check, ChevronRight, Compass, Gauge, GraduationCap,
  Layers, Lock, LogOut, Settings, Shield, Stethoscope, TrendingUp, Users, Wallet, Wrench, X,
  type LucideIcon,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { buildDisplayName, cn } from '@/lib/utils';
import { useAuth, dashboardPath, type UserRole } from '@/contexts/AuthContext';
import { VERTICALS, isOfferLive, type MsVerticalId } from '@/lib/catalog';
import {
  activeChild, isAdminRole, visibleChildren, workspacesFor, type NavBadgeKey, type OsGroup,
} from './workspaces';
import { useOsScope } from '@/lib/os/scope';
import { usePreview } from '@/lib/os/preview';
import s from './os.module.css';

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge, trending: TrendingUp, calendar: CalendarCheck, box: Box, wallet: Wallet, building: Building2,
  chart: BarChart2, settings: Settings, shield: Shield, lock: Lock, check: Check, users: Users, wrench: Wrench,
  layers: Layers,
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

// ---------------------------------------------------------------------------- context bar

/** Topbar: the business you are working as (with its real Gate 1 status) and the vertical scope. */
export function OsContextBar({ role }: { role: UserRole }) {
  const { user } = useAuth();
  const biz = useBusiness(role);
  // All hooks before any early return (rules of hooks).
  const current = useVertical(role) ?? 'spaces';
  const { setVertical } = useOsScope();
  const { authOf } = usePreview();

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
  const canSwitch = role === 'rental_provider';
  const sp = role === 'service_provider';
  // Gate 2 per vertical. A service provider's own vertical is Services (operable once its
  // Gate 1 is through); Spaces is never authorised on a service-provider account — letting
  // property runs on a rental-provider account. Other verticals read the preview store.
  const stateOf = (id: MsVerticalId) => {
    if (sp && id === 'services') return biz?.gate1 === 'compliant' ? 'granted' : 'pending';
    if (sp && id === 'spaces') return 'none';
    return authOf(id).state;
  };
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
      <div className={s.vtabs} role="list" aria-label="Verticals">
        {VERTICALS.map((vx) => {
          const Ic = VICON[vx.id];
          const on = vx.id === current;
          const st = stateOf(vx.id);
          const tip = sp && vx.id === 'spaces'
            ? 'Spaces — not authorised: letting property runs on a rental-provider account'
            : `${vx.label} — ${st === 'granted' ? 'authorised' : st === 'pending' ? sp && vx.id === 'services' ? 'opens once your profile is verified' : 'authorisation pending' : st === 'refused' ? 'authorisation refused' : 'not requested'}`;
          const inner = <><Ic size={12} aria-hidden /> {vx.label}{st !== 'granted' && <Lock size={10} className={cn(s.lk, st === 'pending' && s.lkPending, st === 'refused' && s.lkRefused)} aria-hidden />}</>;
          return canSwitch ? (
            <button key={vx.id} type="button" role="listitem" className={cn(s.vtab, s.vtabBtn, on && s.vtabOn)} aria-current={on ? 'true' : undefined}
              title={tip} onClick={() => setVertical(vx.id)}>{inner}</button>
          ) : (
            <span key={vx.id} role="listitem" className={cn(s.vtab, on && s.vtabOn)} aria-current={on ? 'true' : undefined}
              title={sp ? (on ? `${vx.label} — your active vertical · ${tip.split(' — ')[1]}` : tip) : on ? `${vx.label} — active` : `${vx.label} — managed by the landlord`}>{inner}</span>
          );
        })}
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
      <span className={s.crumbTone}>{a.group.tone === 'vertical' && vertical ? VERTICALS.find((x) => x.id === vertical)?.label : isAdminRole(role) ? 'Admin' : 'Shared'}</span>
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
