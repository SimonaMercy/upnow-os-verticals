'use client';

/**
 * PROTOTYPE ONLY — the Personal (customer) context.
 *
 * One person can be a customer and a provider. This shell is what the demo
 * person sees as a customer: their activity, the marketplace and their
 * enquiries. A persona switch lets the presenter browse as a second customer
 * (Sam Carter) who has no business, so an enquiry visibly reaches one of
 * Layla's businesses in the provider OS.
 *
 * Production customer dashboard today: /dashboard/customer (My Spaces, My Services).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Briefcase, ExternalLink, Home, MessagesSquare, Search, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProto } from '../../store';
import { BASE } from '../../nav';
import { DEMO_CUSTOMER, DEMO_PERSON } from '../../seed';
import { Avatar } from '../../ui';

export const ME = '/prototype/me';

/** The person currently browsing in the Personal context. */
export function usePersona() {
  const { persona } = useProto();
  return persona === 'guest'
    ? { key: 'guest' as const, name: DEMO_CUSTOMER.name, email: DEMO_CUSTOMER.email, phone: DEMO_CUSTOMER.phone, ownsBusinesses: false }
    : { key: 'self' as const, name: DEMO_PERSON.name, email: DEMO_PERSON.email, phone: '+971 50 555 0142', ownsBusinesses: true };
}

const TABS = [
  { to: ME, label: 'My activity', icon: Home },
  { to: `${ME}/browse`, label: 'Browse marketplace', icon: Search },
  { to: `${ME}/enquiries`, label: 'My enquiries', icon: MessagesSquare },
];
const LIVE = [
  { href: '/dashboard/customer/spaces', label: 'My Spaces' },
  { href: '/dashboard/customer/services', label: 'My Services' },
];

export function MeShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { setPersona, leads, setContext, orgs } = useProto();
  const person = usePersona();
  const open = leads.filter((l) => l.customer === person.name && (l.messages ?? []).some((m) => m.from === 'provider')).length;

  return (
    <div className="min-h-[calc(100vh-30px)] bg-[var(--bg)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
          <Link href={ME} className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--g7)] text-[15px] font-extrabold text-white">U</span>
            <span className="text-[18px] font-extrabold tracking-[-0.02em] text-[var(--g9)]">UpNow</span>
            <span className="rounded-[5px] bg-[var(--g1)] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.04em] text-[var(--g7)]">Personal</span>
          </Link>
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink3)]">
            <UserRound className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Browsing as</span>
            <select value={person.key} onChange={(e) => setPersona(e.target.value as 'self' | 'guest')} aria-label="Browsing as"
              className="h-9 rounded-[10px] border border-[var(--line2)] bg-white pl-3 text-[14px] font-bold text-[var(--ink)] outline-none focus:border-[var(--g6)]">
              <option value="self">{DEMO_PERSON.name} (you — also a provider)</option>
              <option value="guest">{DEMO_CUSTOMER.name} (demo customer)</option>
            </select>
          </label>
          {person.ownsBusinesses && (
            <button type="button" onClick={() => { setContext(orgs[0].id); router.push(BASE); }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border-[1.5px] border-[var(--line2)] bg-white px-3 text-[13px] font-bold hover:border-[var(--g6)] hover:text-[var(--g8)]">
              <Briefcase className="h-4 w-4" aria-hidden />Switch to my business
            </button>
          )}
          <Avatar name={person.name} size={34} />
        </div>
        <nav className="mx-auto flex max-w-[1180px] gap-1 overflow-x-auto px-4 md:px-6" aria-label="Personal">
          {TABS.map((t) => {
            const active = t.to === ME ? path === ME : path.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link key={t.to} href={t.to} aria-current={active ? 'page' : undefined}
                className={cn('-mb-px flex h-[42px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] font-bold',
                  active ? 'border-[var(--g7)] text-[var(--g8)]' : 'border-transparent text-[var(--ink3)] hover:text-[var(--ink)]')}>
                <Icon className="h-4 w-4" aria-hidden />{t.label}
                {t.to.endsWith('enquiries') && open > 0 && <span className="rounded-full bg-[var(--g7)] px-1.5 text-[11px] text-white">{open}</span>}
              </Link>
            );
          })}
          {person.key === 'self' && LIVE.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="-mb-px flex h-[42px] items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-[14px] font-bold text-[var(--ink3)] hover:text-[var(--ink)]">
              {l.label}<span className="rounded-[5px] bg-[var(--g7)] px-1.5 py-px text-[9.5px] font-extrabold uppercase tracking-[0.04em] text-white">Live</span><ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1180px] px-4 pb-16 pt-6 md:px-6">{children}</main>
    </div>
  );
}
