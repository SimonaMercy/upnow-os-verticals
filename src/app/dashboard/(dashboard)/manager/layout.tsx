'use client';

import { ManagerPermissionsProvider } from '@/contexts/ManagerPermissionsContext';
import { LandlordSwitcher } from '@/components/dashboard/LandlordSwitcher';
import { ManagerScopeSync } from '@/components/dashboard/ManagerScopeSync';
import type { ReactNode } from 'react';

/**
 * Manager area layout. A single global scope bar carries the LandlordSwitcher so
 * EVERY manager page shows (and controls) which landlord's data is in view — the
 * `?rp=` it sets is read by each page to scope its data + permission gate.
 * Putting it here (once) avoids the previous state where only some pages had it.
 */
export default function ManagerLayout({ children }: { children: ReactNode }) {
  return (
    <ManagerPermissionsProvider>
      <ManagerScopeSync />
      <div className="mgr-scopebar">
        <span className="mgr-scopebar__lbl">Acting for</span>
        <LandlordSwitcher />
      </div>
      {children}
      <style>{`
        .mgr-scopebar {
          position: sticky; top: 0; z-index: 40;
          display: flex; align-items: center; justify-content: flex-end; gap: 10px;
          padding: 10px 22px;
          background: rgba(255,255,255,0.88);
          backdrop-filter: saturate(180%) blur(8px);
          border-bottom: 1px solid var(--color-base-200, #ececec);
        }
        .mgr-scopebar__lbl {
          font-size: 12px; font-weight: 600; letter-spacing: .01em;
          color: var(--color-neutral-400, #8a8a8a);
        }
      `}</style>
    </ManagerPermissionsProvider>
  );
}
