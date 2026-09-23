'use client';

/**
 * Manager — Units (floor-plan pricing). Reuses the RP `UnitsWorkspace`, scoped
 * to the landlord chosen in the LandlordSwitcher (?rp=) and gated by
 * canListProperties. Price/image edits additionally require canEditProperties,
 * enforced server-side on the /manager/units/* endpoints.
 *
 * Units is inherently a SINGLE-landlord workspace — it can't aggregate
 * floor-plan pricing across landlords — so it needs an explicit landlord scope.
 * Under "All landlords" (no ?rp=) with several landlords to choose from, we
 * prompt for a selection rather than silently defaulting to the first one
 * (see useManagerLandlordScope).
 */
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { UnitsWorkspace } from '@/app/rental-provider/dashboard/units/page';

export default function ManagerUnitsPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord, canForRp } = useManagerLandlordScope('canListProperties');
  // The workspace IS the pricing tool (asking rent per layout). A finance-only
  // manager — properties opened, no lease / listing / editing authority — is
  // kept off it (owner, 23 Sep 2026: "pricing figures, market value and these
  // things I don't want to show to the accountant"); the sidebar hides the
  // entry for them too.
  const pricing = effectiveRp != null && (canForRp('canEditProperties', effectiveRp) || canForRp('canManageAgreements', effectiveRp) || canForRp('canManageViewings', effectiveRp));

  if (permsLoading) {
    return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;
  }
  if (needsLandlord) {
    return <SelectLandlordNotice resource="Units" />;
  }
  if (allowed && !pricing) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Not part of your access</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            Units carry the pricing of each layout. Your access covers the properties and their payments — open <strong>Properties</strong> instead.
          </p>
        </div>
      </div>
    );
  }
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>List Properties</strong> permission, so their units aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  return <UnitsWorkspace manager={{ rp: effectiveRp! }} />;
}
