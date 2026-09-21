'use client';

/** Rental provider — one breach, on its own page under Breaches (the same shape as a legal case). */
import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { BreachDetailView } from '@/components/legal/BreachDetailView';

function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <BreachDetailView
      breachId={Number(id)}
      base="/legal"
      listHref="/rental-provider/dashboard/breaches"
      leaseHrefOf={(leaseId) => `/rental-provider/dashboard/operations/${leaseId}`}
      caseHrefOf={(caseId) => `/rental-provider/dashboard/legal/${caseId}`}
    />
  );
}

export default function BreachPage() {
  return <Suspense fallback={null}><Page /></Suspense>;
}
