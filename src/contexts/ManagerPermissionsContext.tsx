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
    /** 0292 — view + request the customer documents attached to a lead. */
    canReviewLeadDocuments: boolean;
    /** 0294 — upload / replace / approve / reject / date a lead customer's documents. */
    canManageLeadDocuments: boolean;
    /** 0294 — contract, customer-on-lease and deposit documents. */
    canManageLeaseDocuments: boolean;
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
    /** Soft-delete a document. NOT implied by canManageDocuments — a manager who
     *  may attach a file is not thereby allowed to destroy one (migration 0247). */
    canDeleteDocuments:   boolean;
    canManageMaintenance: boolean;
    /** 0275 — the vendor roster. */
    canManageVendors:     boolean;
    /** 0275 — AMC contracts, visits, payables. */
    canManageAmc:         boolean;
    /** 0319 — record vendor payments (AMC bills, spends, installments paid /
     *  unpaid, payables due, expenses report) without contract-editing power. */
    canRecordVendorPayments: boolean;
    /** 0326 — hands cheques / cash to head office and back; sees the custody trail. */
    canHandOverCheques: boolean;
    /** Legal & breach — breaches, notices, disputes (spec 2026-09-14). */
    canManageLegal:       boolean;
    // Communication & admin
    canCommunicateTenants:boolean;
    /** Email and WhatsApp — read and send granted apart, per channel. Send already counts only with read. */
    canReadEmails:boolean;
    canSendEmails:boolean;
    canReadWhatsapp:boolean;
    canSendWhatsapp:boolean;
    canEscalateToAdmin:   boolean;
    canInviteManager:     boolean;
  };
  /** Report slugs this landlord opened to the manager; empty = every report. */
  reportAccess?: string[];
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
