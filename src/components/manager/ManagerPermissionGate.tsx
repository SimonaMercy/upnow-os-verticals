'use client';

/**
 * ManagerPermissionGate
 *
 * Wraps a manager route that reuses a rental-provider ACTION page (new/edit
 * contract, add property/units, …). Renders the page only when the acting
 * landlord (`?rp=`) has granted this manager the given permission; otherwise a
 * "permission required" card — so a view-only manager never lands on a fully
 * editable surface they can't use.
 *
 * The backend `actAsLandlord(rp, flag)` is the real guard (403); this is the FE
 * consistency layer. Use it for pure-action pages; for view+action pages gate
 * the individual buttons instead so the read-only view stays reachable.
 */

import { Suspense, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useManagerPermissions, type RpPermissions } from '@/contexts/ManagerPermissionsContext';

type Flag = keyof RpPermissions['permissions'];

function LockCard({ label }: { label: string }) {
  return (
    <div className="p-6">
      <div className="max-w-[460px] mx-auto text-center bg-white border border-[#e4e9e5] rounded-[18px] px-7 py-10 mt-12">
        <div className="w-12 h-12 rounded-xl grid place-items-center mx-auto mb-3.5 bg-[#ffedd5] text-[#9a3412]">
          <Lock size={20} />
        </div>
        <p className="text-base font-bold text-[#14201a]">Permission required</p>
        <p className="text-[13.5px] text-[#8a948d] mt-1.5 leading-relaxed">
          This landlord hasn’t granted you the <strong>{label}</strong> permission, so this action isn’t available.
        </p>
      </div>
    </div>
  );
}

function Inner({ flag, label, children }: { flag: Flag; label: string; children: ReactNode }) {
  const sp = useSearchParams();
  const rpRaw = sp.get('rp');
  const rp = rpRaw ? Number(rpRaw) : null;
  const { canForRp, loading } = useManagerPermissions();
  // Withhold the editable page until permissions are known (avoids a flash of
  // the action surface before we can lock it).
  if (loading) return null;
  if (rp == null || Number.isNaN(rp) || !canForRp(flag, rp)) return <LockCard label={label} />;
  return <>{children}</>;
}

export function ManagerPermissionGate({ flag, label, children }: { flag: Flag; label: string; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Inner flag={flag} label={label}>{children}</Inner>
    </Suspense>
  );
}
