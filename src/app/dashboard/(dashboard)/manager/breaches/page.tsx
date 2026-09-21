'use client';

/**
 * Manager — Breaches (mirrors the RP Breaches page). Data is fetched for the
 * landlord chosen in the LandlordSwitcher via /manager/legal/*?rp=<id>, gated
 * on the per-landlord canManageLegal flag.
 */
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { BreachesListView } from '@/components/legal/BreachesListView';

export default function ManagerBreachesPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageLegal');

  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        {needsLandlord ? (
          <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
            <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#eef3f1] text-[#2e6f5e]"><Building2 size={20} /></div>
            <p className="text-base font-bold text-[#1a1916]">Select a landlord</p>
            <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">Breaches are managed per landlord. Choose a landlord from the switcher above to view them.</p>
          </div>
        ) : (
          <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
            <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]"><Lock size={20} /></div>
            <p className="text-base font-bold text-[#1a1916]">Permission required</p>
            <p className="text-[13.5px] text-[#9b9890] mt-1.5 leading-relaxed">This landlord hasn’t granted you the <strong>Manage Legal</strong> permission, so their breaches aren’t available.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {effectiveRp != null && (
        <BreachesListView
          base="/manager/legal" rp={effectiveRp}
          leaseHrefOf={(leaseId) => `/dashboard/manager/operations/${leaseId}?rp=${effectiveRp}`}
          legalHref={`/dashboard/manager/legal?rp=${effectiveRp}`}
          caseHrefOf={(id) => `/dashboard/manager/legal/${id}?rp=${effectiveRp}`}
          breachHrefOf={(id) => `/dashboard/manager/breaches/${id}?rp=${effectiveRp}`}
        />
      )}
    </div>
  );
}
