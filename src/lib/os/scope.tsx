'use client';

/**
 * Active vertical scope for the provider OS (Genspark: "a vertical is a scope, not a place").
 * The URL wins when it names a vertical (/rental-provider/dashboard/v/<vertical>/…); otherwise
 * the last vertical the user picked (sessionStorage), defaulting to Spaces.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { verticalOf, type MsVerticalId } from '@/lib/catalog';

export const RP_BASE = '/rental-provider/dashboard';
const KEY = 'upnow.os.vertical';

/** Home page of a vertical's Operations workspace. */
export function verticalHome(v: MsVerticalId): string {
  return v === 'spaces' ? `${RP_BASE}/orders` : `${RP_BASE}/v/${v}`;
}

function verticalFromPath(pathname: string): MsVerticalId | null {
  const m = pathname.match(/\/rental-provider\/dashboard\/v\/([a-z]+)/);
  return m && verticalOf(m[1]) ? (m[1] as MsVerticalId) : null;
}

/** `go`: open that vertical's pack Overview (the rail's pack selector). Without it the page
 *  only moves when it is vertical-scoped (to the same workspace of the new vertical). */
interface Scope { vertical: MsVerticalId; setVertical: (v: MsVerticalId, opts?: { go?: boolean }) => void }
const Ctx = createContext<Scope>({ vertical: 'spaces', setVertical: () => {} });

export function OsScopeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [picked, setPicked] = useState<MsVerticalId>('spaces');
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore tab-local scope after hydration
      if (v && verticalOf(v)) setPicked(v as MsVerticalId);
    } catch { /* ignore */ }
  }, []);
  const fromUrl = verticalFromPath(pathname);
  const vertical = fromUrl ?? picked;

  const setVertical = useCallback((v: MsVerticalId, opts?: { go?: boolean }) => {
    setPicked(v);
    try { sessionStorage.setItem(KEY, v); } catch { /* ignore */ }
    if (opts?.go) { router.push(`${RP_BASE}/v/${v}`); return; }
    // Inside a vertical-scoped page → go to the same workspace of the new vertical.
    const inVerticalPage = !!verticalFromPath(pathname)
      || /\/rental-provider\/dashboard\/(orders|ended-leases|operations|portfolio|units|maintenance|building-inspections|amc|breaches|legal|contracts|listings)/.test(pathname);
    if (inVerticalPage) router.push(verticalHome(v));
  }, [pathname, router]);

  const value = useMemo(() => ({ vertical, setVertical }), [vertical, setVertical]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useOsScope = () => useContext(Ctx);
