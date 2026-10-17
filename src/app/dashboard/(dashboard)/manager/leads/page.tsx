'use client';

/**
 * Manager — Leads. Reuses the full RP `LeadsWorkspace` pipeline (record/collect
 * cheques, issue plan, approve docs, share plan, reopen, etc.), scoped to the
 * landlord chosen in the LandlordSwitcher (?rp=) and gated by canManageViewings.
 * Every action calls the landlord-scoped /api/manager/leads/* endpoints.
 */
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { LeadsWorkspace } from '@/app/rental-provider/dashboard/leads/page';

export default function ManagerLeadsPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageViewings)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageViewings', effectiveRp);

  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#14201a]">Permission required</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Viewings</strong> permission, so their leads aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (permsLoading || effectiveRp == null) {
    return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;
  }
  // "Add new leads" is granted separately from working the pipeline — creating a
  // lead also creates the customer's portal account (migration 0165). Per-landlord,
  // never an ANY-landlord `can`.
  return (
    <LeadsWorkspace
      manager={{ rp: effectiveRp }}
      canCreateLeads={canForRp('canCreateLeads', effectiveRp)}
    />
  );
}
