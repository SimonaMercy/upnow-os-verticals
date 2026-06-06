'use client';

/**
 * LandlordSwitcher — the ONE difference between the manager and RP experience.
 *
 * A manager works for multiple landlords. This dropdown lets them either scope
 * the whole dashboard to a single landlord (so it behaves exactly like that
 * landlord's own RP view) or pick "All landlords" to see everything aggregated.
 *
 * The selection is held in the URL (?rp=<id> or absent = All) so it survives
 * navigation between manager pages and deep links.
 */

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, Layers } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';

export function LandlordSwitcher() {
  const { rps, loading } = useManagerPermissions();
  const router      = useRouter();
  const pathname    = usePathname();
  const params      = useSearchParams();
  const activeRp    = params.get('rp') ? Number(params.get('rp')) : null;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Single-landlord managers don't need a switcher
  if (loading || rps.length <= 1) return null;

  const current = activeRp ? rps.find(r => r.rentalProviderId === activeRp)?.rpName ?? 'Landlord' : 'All landlords';

  const select = (rpId: number | null) => {
    const next = new URLSearchParams(Array.from(params.entries()));
    if (rpId == null) next.delete('rp'); else next.set('rp', String(rpId));
    router.push(`${pathname}${next.toString() ? `?${next}` : ''}`);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm bg-white transition-colors"
        style={{ boxShadow: 'var(--shadow-sm)', color: 'var(--color-neutral-900)' }}
      >
        {activeRp
          ? <Building2 size={15} style={{ color: 'var(--color-primary)' }} />
          : <Layers size={15} style={{ color: 'var(--color-primary)' }} />}
        <span className="font-medium max-w-[160px] truncate">{current}</span>
        <ChevronDown size={14} style={{ color: 'var(--color-neutral-400)' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl bg-white py-1.5 min-w-[220px]"
          style={{ boxShadow: '0 12px 40px -8px rgba(15,30,25,.18)', border: '1px solid var(--color-base-200)' }}
        >
          <button
            type="button"
            onClick={() => select(null)}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-base-100)] transition-colors"
            style={{ color: 'var(--color-neutral-900)' }}
          >
            <Layers size={14} style={{ color: 'var(--color-primary)' }} />
            <span className="flex-1">All landlords</span>
            {!activeRp && <Check size={14} style={{ color: 'var(--color-primary)' }} />}
          </button>
          <div className="my-1 h-px" style={{ background: 'var(--color-base-200)' }} />
          {rps.map(r => (
            <button
              key={r.rentalProviderId}
              type="button"
              onClick={() => select(r.rentalProviderId)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--color-base-100)] transition-colors"
              style={{ color: 'var(--color-neutral-900)' }}
            >
              <Building2 size={14} style={{ color: 'var(--color-neutral-400)' }} />
              <span className="flex-1 truncate">{r.rpName}</span>
              {activeRp === r.rentalProviderId && <Check size={14} style={{ color: 'var(--color-primary)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
