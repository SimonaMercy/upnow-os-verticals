'use client';

/**
 * useDeals — fetches /api/leads + /api/contracts and merges them into a
 * single deduplicated Deal[] sorted by recency.
 *
 * Dedup rule: when a Contract exists for a lead (matched via leadId on
 * either side), the Contract wins and the lead row is suppressed. This is
 * what keeps the pipeline from showing the same customer twice once their
 * deal converts.
 */

import { useCallback, useEffect, useState } from 'react';
import { tenantDisplayName } from '@/lib/tenantName';
import {
  Deal,
  contractStatusToPipeline,
  leadStageToPipeline,
} from './types';

interface ApiLeadShape {
  id: number;
  stage: string;
  customerName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  createdAt: string;
  updatedAt: string;
  viewings?: Array<{
    id: number;
    scheduledAt: string;
    status: string;
    desiredMoveIn?: string | null;
  }>;
  convertedTenant?: {
    id: number; user?: { name?: string; email?: string; phone?: string };
    entityType?: string | null; companyName?: string | null;
  } | null;
  unit?: {
    id: number; unitNumber: string; unitName: string | null;
    rentalPrice: number | null;
    property?: { id: number; buildingName: string };
  } | null;
  docStats?: { total: number; pending: number } | null;
  paymentPlan?: { chequeCount: number; totalAmountFils: number; rentFils: number } | null;
}

interface ApiContractShape {
  id: number;
  ref: string;
  contractType: string | null;
  startDate: string;
  endDate: string;
  annualRent: number;
  status: string;
  ejariStatus: string;
  contractActive: boolean;
  createdAt: string;
  leadId?: number | null;
  tenant: { id: number | null; name: string | null; email: string | null; phone?: string | null };
  unit: { id: number | null; number: string | null; name: string | null };
  property: { id: number | null; buildingName: string | null };
}

function unitLabel(u: { number?: string | null; unitNumber?: string; name?: string | null; unitName?: string | null } | null): string {
  if (!u) return '—';
  const num = u.unitNumber ?? u.number ?? '';
  const name = u.unitName ?? u.name ?? '';
  return [name, num].filter(Boolean).join(' · ') || 'Unit';
}

function mapLead(l: ApiLeadShape): Deal {
  const latestViewing = (l.viewings ?? [])
    .slice()
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];

  return {
    id: `lead-${l.id}`,
    kind: 'lead',
    pipelineStage: leadStageToPipeline(l.stage),
    // The company is the customer; the person on the user record signs for it.
    customerName: tenantDisplayName({
      name: l.convertedTenant?.user?.name ?? l.customerName,
      entityType: l.convertedTenant?.entityType,
      companyName: l.convertedTenant?.companyName,
    }) ?? l.customerName,
    customerPhone: l.leadPhone ?? l.convertedTenant?.user?.phone ?? null,
    customerEmail: l.leadEmail ?? l.convertedTenant?.user?.email ?? null,
    unitLabel: unitLabel(l.unit ?? null),
    unitId: l.unit?.id ?? null,
    buildingName: l.unit?.property?.buildingName ?? null,
    rentFils: l.paymentPlan?.rentFils ?? (l.unit?.rentalPrice ? l.unit.rentalPrice * 100 : null),

    viewingAt: latestViewing ? new Date(latestViewing.scheduledAt) : null,
    viewingStatus: latestViewing?.status ?? null,
    docsPending: l.docStats?.pending ?? null,
    docsTotal: l.docStats?.total ?? null,
    planChequeCount: l.paymentPlan?.chequeCount ?? null,
    chequesCollected: null,
    chequesTotal: l.paymentPlan?.chequeCount ?? null,

    contractRef: null,
    contractId: null,
    contractStart: null,
    contractEnd: null,
    ejariStatus: null,

    leadId: l.id,
    rawLead: l,
    rawContract: null,
    updatedAt: new Date(l.updatedAt),
  };
}

function mapContract(c: ApiContractShape, linkedLead?: ApiLeadShape): Deal {
  return {
    id: `contract-${c.id}`,
    kind: 'contract',
    pipelineStage: contractStatusToPipeline(c.status),
    customerName: c.tenant.name ?? '—',
    customerPhone: c.tenant.phone ?? linkedLead?.leadPhone ?? null,
    customerEmail: c.tenant.email ?? linkedLead?.leadEmail ?? null,
    unitLabel: unitLabel(c.unit),
    unitId: c.unit.id,
    buildingName: c.property.buildingName,
    rentFils: c.annualRent ? c.annualRent * 100 : null,

    viewingAt: null,
    viewingStatus: null,
    docsPending: null,
    docsTotal: null,
    planChequeCount: null,
    chequesCollected: null,
    chequesTotal: null,

    contractRef: c.ref,
    contractId: c.id,
    contractStart: c.startDate,
    contractEnd: c.endDate,
    ejariStatus: c.ejariStatus,

    leadId: c.leadId ?? linkedLead?.id ?? null,
    rawLead: linkedLead ?? null,
    rawContract: c,
    updatedAt: new Date(c.createdAt),
  };
}

interface UseDealsResult {
  deals: Deal[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDeals(): UseDealsResult {
  const [deals, setDeals]     = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [leadsRes, contractsRes] = await Promise.all([
        fetch('/api/leads',     { credentials: 'include' }),
        fetch('/api/contracts', { credentials: 'include' }),
      ]);
      if (!leadsRes.ok)     throw new Error(`Leads (${leadsRes.status})`);
      if (!contractsRes.ok) throw new Error(`Contracts (${contractsRes.status})`);

      const leadsRaw: ApiLeadShape[]         = await leadsRes.json();
      const contractsRaw: ApiContractShape[] = await contractsRes.json();

      const leads     = Array.isArray(leadsRaw)     ? leadsRaw     : [];
      const contracts = Array.isArray(contractsRaw) ? contractsRaw : [];

      // Group contracts by leadId for the suppression check below
      const contractsByLeadId = new Map<number, ApiContractShape>();
      const leadsById         = new Map<number, ApiLeadShape>();
      leads.forEach(l => leadsById.set(l.id, l));
      contracts.forEach(c => {
        if (c.leadId != null) contractsByLeadId.set(c.leadId, c);
      });

      // Map contracts first (they win over the linked lead)
      const contractDeals = contracts.map(c => mapContract(c, c.leadId ? leadsById.get(c.leadId) : undefined));

      // Map leads that don't have a linked contract
      const leadDeals = leads
        .filter(l => !contractsByLeadId.has(l.id))
        .map(mapLead);

      const merged = [...contractDeals, ...leadDeals]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      setDeals(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pipeline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { deals, loading, error, refetch: fetchAll };
}
