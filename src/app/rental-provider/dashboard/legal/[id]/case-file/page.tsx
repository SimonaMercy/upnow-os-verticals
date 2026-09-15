'use client';

/** Rental provider — Export case file (print-ready, spec §7.3). */
import { useParams } from 'next/navigation';
import { CaseFilePrint } from '@/components/legal/CaseFilePrint';

export default function LegalCaseFilePage() {
  const { id } = useParams<{ id: string }>();
  return <CaseFilePrint disputeId={Number(id)} base="/legal" backHref={`/rental-provider/dashboard/legal/${id}`} />;
}
