'use client';

/**
 * PROTOTYPE ONLY — the frame around every production screen hosted at
 * /prototype/os/rp/**: the group's tab strip (same as the prototype screens),
 * the live-data status, and the navigation bridge.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { SHARED_MODULES, matchBridge, toBridge, type SharedModule } from './nav';
import { LiveBridge, LiveStatus } from './liveBridge';
import { GroupTabs } from './verticals/Pack';

const LIVE_BADGE = <span className="rounded-[5px] bg-[var(--g7)] px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.04em] text-white">Live</span>;

/** Tab strip for a shared group (Demand, Calendar, Communications, Settings): prototype view + live Spaces screens. */
export function SharedTabs({ slug, active }: { slug: string; active: string }) {
  const m = SHARED_MODULES.find((x) => x.slug === slug) as SharedModule;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] pb-3">
      <span className="mr-1 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[var(--ink3)]">{m.label}</span>
      {m.tabs.map((t) => {
        const to = t.live ? toBridge(t.href) : t.href;
        const on = to === active;
        return (
          <Link key={t.href} href={to} aria-current={on ? 'page' : undefined}
            className={cn('inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[13px] text-[13.5px] font-semibold transition-colors',
              on ? 'border-[var(--g8)] bg-[var(--g8)] text-white' : 'border-[var(--line2)] bg-white text-[var(--ink)] hover:border-[var(--g5)]')}>
            {t.label}{t.live && LIVE_BADGE}
          </Link>
        );
      })}
    </div>
  );
}

export function BridgeFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const search = useSearchParams().toString();
  const m = matchBridge(path, search ? `?${search}` : '');
  const current = path + (search ? `?${search}` : '');
  return (
    <div>
      {m?.pack && m.pack.item.tabs.length > 1 && <GroupTabs v="spaces" item={m.pack.item} tabs={m.pack.item.tabs} active={m.pack.tab?.slug ?? ''} />}
      {m?.shared && <SharedTabs slug={m.shared.slug} active={m.shared.tabs.some((t) => t.live && toBridge(t.href) === current) ? current : toBridge(m.shared.tabs.find((t) => t.live && current.startsWith(toBridge(t.href).split('?')[0]))?.href ?? '')} />}
      <LiveStatus />
      {/* .ms-bridge: scoped MarketSpace palette for the hosted production screen (theme.css) */}
      <div className="ms-bridge"><LiveBridge>{children}</LiveBridge></div>
    </div>
  );
}
