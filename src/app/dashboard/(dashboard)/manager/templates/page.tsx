'use client';

/**
 * Manager — Addendum Templates. Reuses the RP `TemplatesWorkspace` (in-app
 * bilingual TERMS editor + category/sub-category defaults + in-use versioning),
 * scoped to the landlord chosen in the LandlordSwitcher (?rp=) and gated by
 * canManageTemplates. Data comes from the landlord-scoped /manager/templates
 * endpoints.
 *
 * Previously this was a hand-maintained file-upload-only copy that had drifted a
 * generation behind — now it shares the RP component so the two stay in sync.
 */
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions } from '@/contexts/ManagerPermissionsContext';
import { TemplatesWorkspace } from '@/app/rental-provider/dashboard/templates/page';

export default function ManagerTemplatesPage() {
  const { canForRp, rps, loading: permsLoading } = useManagerPermissions();
  const searchParams = useSearchParams();
  const selectedRp = searchParams.get('rp');
  const effectiveRp = selectedRp
    ? Number(selectedRp)
    : (rps.find(r => r.permissions.canManageTemplates)?.rentalProviderId ?? rps[0]?.rentalProviderId ?? null);
  const allowed = effectiveRp != null && canForRp('canManageTemplates', effectiveRp);

  if (!permsLoading && !allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e8e6e0] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#1a1916]">Permission required</p>
          <p className="text-sm text-[#6b6860] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Templates</strong> permission, so their addendum templates aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  if (permsLoading || effectiveRp == null) {
    return <div className="p-6 text-sm text-[#9b9890]">Loading…</div>;
  }
  return <TemplatesWorkspace manager={{ rp: effectiveRp }} />;
}
