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
import { Lock } from 'lucide-react';
import { useManagerLandlordScope, SelectLandlordNotice } from '@/components/dashboard/managerLandlordScope';
import { TemplatesWorkspace } from '@/app/rental-provider/dashboard/templates/page';

export default function ManagerTemplatesPage() {
  const { effectiveRp, allowed, permsLoading, needsLandlord } = useManagerLandlordScope('canManageTemplates');

  if (permsLoading) {
    return <div className="p-6 text-sm text-[#8a948d]">Loading…</div>;
  }
  if (needsLandlord) {
    return <SelectLandlordNotice resource="Addendum templates" />;
  }
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-2xl px-7 py-10 mt-12">
          <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
            <Lock size={20} />
          </div>
          <p className="text-base font-bold text-[#14201a]">Permission required</p>
          <p className="text-sm text-[#5f6b63] mt-1.5 leading-relaxed">
            This landlord hasn&rsquo;t granted you the <strong>Manage Templates</strong> permission, so their addendum templates aren&rsquo;t available.
          </p>
        </div>
      </div>
    );
  }
  return <TemplatesWorkspace manager={{ rp: effectiveRp! }} />;
}
