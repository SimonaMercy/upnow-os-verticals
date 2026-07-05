'use client';

/**
 * ManagerScopeSync — keeps the chosen landlord (?rp=) sticky across the whole
 * manager area. Mounted once in the manager layout.
 *
 * The LandlordSwitcher persists the selection to localStorage. Whenever a
 * manager page renders WITHOUT `?rp=` in the URL — a sidebar navigation, a
 * fresh reload, or a deep link — this restores the saved landlord into the URL
 * so the page scopes to it. The manager stays "Acting for <landlord>" on every
 * page until they pick another landlord (or explicitly "All landlords", which
 * is remembered as such and NOT overridden here).
 */

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { readMgrScope } from '@/lib/managerScope';

export function ManagerScopeSync() {
  const router   = useRouter();
  const pathname = usePathname();
  const params   = useSearchParams();

  useEffect(() => {
    // URL already carries an explicit scope → respect it, nothing to restore.
    if (params.get('rp')) return;

    const saved = readMgrScope();
    // Nothing chosen yet, or manager explicitly chose "All landlords".
    if (saved == null || saved === 'all') return;

    const next = new URLSearchParams(Array.from(params.entries()));
    next.set('rp', String(saved));
    // replace (not push) so the back button isn't polluted with redirects.
    router.replace(`${pathname}?${next.toString()}`);
  }, [pathname, params, router]);

  return null;
}
