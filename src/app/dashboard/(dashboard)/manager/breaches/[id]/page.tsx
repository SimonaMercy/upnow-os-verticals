'use client';

/** Manager — one breach for one managed landlord (canManageLegal), mirroring the RP breach page. */
import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { BreachDetailView } from '@/components/legal/BreachDetailView';

function Page() {
  const { id } = useParams<{ id: string }>();
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageLegal');
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#14201a]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      {effectiveRp != null && (
        <BreachDetailView
          breachId={Number(id)}
          base="/manager/legal" rp={effectiveRp}
          listHref={`/dashboard/manager/breaches?rp=${effectiveRp}`}
          leaseHrefOf={(leaseId) => `/dashboard/manager/operations/${leaseId}?rp=${effectiveRp}`}
          caseHrefOf={(caseId) => `/dashboard/manager/legal/${caseId}?rp=${effectiveRp}`}
        />
      )}
    </div>
  );
}

export default function ManagerBreachPage() {
  return <Suspense fallback={null}><Page /></Suspense>;
}
