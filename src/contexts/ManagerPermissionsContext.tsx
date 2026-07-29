'use client';

/**
 * ManagerPermissionsContext
 *
 * Loads every (RP, permissions) pair this manager has access to from
 * GET /manager/my-rps. Exposed via useManagerPermissions() so all
 * manager pages can read which landlords they manage and what they're
 * allowed to do without redundant fetches.
 */

import {
  createContext, useContext, useEffect, useState, type ReactNode,
} from 'react';
import { apiGet } from '@/lib/api';

export interface RpPermissions {
  rentalProviderId: number;
  rpName:           string;
  grantedByUserId:  number;
  permissions: {
    // Properties
    canListProperties:    boolean;
    canEditProperties:    boolean;
    canPublishListings:   boolean;
    // Leads & viewings
    canManageViewings:    boolean;
    canCreateLeads:       boolean;
    // Contracts & signing
    canManageAgreements:  boolean;
    canCreateContracts:   boolean;
    canManageContractLifecycle: boolean;
    canManageRenewals:    boolean;
    canManageTermination: boolean;
    canManageInspections: boolean;
    canManageTemplates:   boolean;
    canManageEjari:       boolean;
    canSignDocuments:     boolean;
    canSignAddenda:       boolean;
    canActAsPoa:          boolean;
    // Finance
    canManageDeposits:    boolean;
    canSettleDeposits:    boolean;
    canRecordPayments:    boolean;
    canClearCheques:      boolean;
    canManageCollections: boolean;
    canViewFinancials:    boolean;
    canViewReports:       boolean;
    // Operations
    canManageDocuments:   boolean;
    canManageMaintenance: boolean;
    // Communication & admin
    canCommunicateTenants:boolean;
    canEscalateToAdmin:   boolean;
    canInviteManager:     boolean;
  };
}

interface ManagerPermissionsState {
  rps:     RpPermissions[];
  loading: boolean;
  /** Returns true if the manager has a given perm for ANY of their RPs. */
  can:     (flag: keyof RpPermissions['permissions']) => boolean;
  /** Returns true if the manager has a given perm for a specific RP. */
  canForRp:(flag: keyof RpPermissions['permissions'], rpId: number) => boolean;
}

const Ctx = createContext<ManagerPermissionsState>({
  rps: [], loading: true,
  can: () => false,
  canForRp: () => false,
});

export function ManagerPermissionsProvider({ children }: { children: ReactNode }) {
  const [rps, setRps]       = useState<RpPermissions[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<RpPermissions[]>('/manager/my-rps')
      .then(setRps)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const can = (flag: keyof RpPermissions['permissions']) =>
    rps.some(r => r.permissions[flag]);

  const canForRp = (flag: keyof RpPermissions['permissions'], rpId: number) =>
    rps.find(r => r.rentalProviderId === rpId)?.permissions[flag] ?? false;

  return (
    <Ctx.Provider value={{ rps, loading, can, canForRp }}>
      {children}
    </Ctx.Provider>
  );
}

export const useManagerPermissions = () => useContext(Ctx);
