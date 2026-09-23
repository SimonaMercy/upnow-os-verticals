'use client';

/**
 * Manager landlord-scope helpers.
 *
 * The manager area is scoped to one landlord via the LandlordSwitcher (?rp=).
 * Most manager pages reuse a single-landlord RP workspace or fetch a single
 * landlord's data, so they need an EXPLICIT landlord — they can't aggregate
 * across landlords the way the manager home dashboard can.
 *
 * `useManagerLandlordScope(flag)` resolves the effective landlord WITHOUT
 * silently defaulting to the first one (the old behaviour, which showed an
 * arbitrary landlord's data under "All landlords"). It:
 *   - honours ?rp= when present,
 *   - auto-scopes when the manager has exactly one landlord that granted this
 *     permission (no LandlordSwitcher is shown in that case, so there's nothing
 *     to pick), and
 *   - otherwise reports `needsLandlord`, so the page can prompt for a selection.
 *
 * Pair it with <SelectLandlordNotice> for that prompt.
 */

import { useSearchParams } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useManagerPermissions, type RpPermissions } from '@/contexts/ManagerPermissionsContext';

type Flag = keyof RpPermissions['permissions'];

export interface ManagerLandlordScope {
  /** The landlord to act on, or null when one must be chosen / none is eligible. */
  effectiveRp: number | null;
  /** effectiveRp is set AND the manager holds `flag` for it. */
  allowed: boolean;
  permsLoading: boolean;
  /** No landlord is scoped and several are eligible — prompt for a choice. */
  needsLandlord: boolean;
  /** Passed through for pages that gate secondary actions on other flags. */
  canForRp: (flag: Flag, rpId: number) => boolean;
}

/** `flag` may be a list — the page opens when the landlord granted ANY of them
 *  (the AMC pages: coordinator OR finance manager, 0319). */
export function useManagerLandlordScope(flag: Flag | Flag[]): ManagerLandlordScope {
  const flags = Array.isArray(flag) ? flag : [flag];
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const raw = useSearchParams().get('rp');
  const selectedRp = raw ? Number(raw) : null;

  // Landlords that granted THIS permission. A manager with a single such
  // landlord has no LandlordSwitcher, so auto-scope to it; with several,
  // require an explicit ?rp= rather than picking one arbitrarily.
  const eligible = rps.filter(r => flags.some(f => r.permissions[f]));
  const soleRp = eligible.length === 1 ? eligible[0].rentalProviderId : null;
  const effectiveRp = selectedRp ?? soleRp;
  const allowed = effectiveRp != null && flags.some(f => canForRp(f, effectiveRp));
  const needsLandlord = effectiveRp == null && eligible.length > 1;

  return { effectiveRp, allowed, permsLoading, needsLandlord, canForRp };
}

/**
 * Shown when a manager must pick a landlord (switcher on "All landlords" while
 * viewing a per-landlord page). `resource` names what's being scoped, e.g.
 * "Units", "Receivables".
 */
export function SelectLandlordNotice({ resource }: { resource: string }) {
  return (
    <div className="p-6">
      <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
        <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#eef3f1] text-[#2e6f5e]">
          <Building2 size={20} />
        </div>
        <p className="text-base font-bold text-[#1a1916]">Select a landlord</p>
        <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
          {resource} are managed per landlord. Choose a landlord from the switcher
          at the top to view them.
        </p>
      </div>
    </div>
  );
}
