'use client';

/** Rental provider — one legal case (spec §7.3). */
import { useParams } from 'next/navigation';
import { DisputeDetailView } from '@/components/legal/DisputeDetailView';

export default function LegalCasePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <DisputeDetailView
      disputeId={Number(id)}
      base="/legal"
      listHref="/rental-provider/dashboard/legal"
      caseFileHref={`/rental-provider/dashboard/legal/${id}/case-file`}
      leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
      breachHrefOf={(_leaseId, breachId) => `/rental-provider/dashboard/breaches/${breachId}`}
    />
  );
}
