'use client';

/** Manager — one legal case for one managed landlord (canManageLegal). */
import { useParams } from 'next/navigation';
import { Lock, Building2 } from 'lucide-react';
import { useManagerLandlordScope } from '@/components/dashboard/managerLandlordScope';
import { DisputeDetailView } from '@/components/legal/DisputeDetailView';

export default function ManagerLegalCasePage() {
  const { id } = useParams<{ id: string }>();
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageLegal');
  if (!permsLoading && (needsLandlord || !allowed)) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-[18px] px-7 py-10 mt-12">
          <div className={`w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 ${needsLandlord ? 'bg-[#eef3f1] text-[#2e6f5e]' : 'bg-[#ffedd5] text-[#9a3412]'}`}>
            {needsLandlord ? <Building2 size={20} /> : <Lock size={20} />}
          </div>
          <p className="text-base font-bold text-[#1a1916]">{needsLandlord ? 'Select a landlord' : 'Permission required'}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      {effectiveRp != null && (
        <DisputeDetailView
          disputeId={Number(id)}
          base="/manager/legal" rp={effectiveRp}
          listHref={`/dashboard/manager/legal?rp=${effectiveRp}`}
          caseFileHref={`/dashboard/manager/legal/${id}/case-file?rp=${effectiveRp}`}
          leaseHrefOf={(leaseId) => `/dashboard/manager/operations/${leaseId}?rp=${effectiveRp}`}
          breachHrefOf={(leaseId) => `/dashboard/manager/operations/${leaseId}?rp=${effectiveRp}#sec-breaches`}
        />
      )}
    </div>
  );
}
