/**
 * Operations contract detail — the FULL working view (setup pipeline + summary
 * + payments + documents). This is the "clone of the contract detail in
 * Operations": it reuses the same ContractV2View component in view="full", so
 * the entire setup workflow (Sign / Ejari / Utility / Move-in / Activate +
 * renew / terminate / move-out / settlement) lives here. The standalone Leases
 * contract page renders the trimmed read-only "record" view of the same
 * component. Contract id comes from this route's [id] param.
 */
'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ContractV2View } from '@/app/rental-provider/dashboard/contracts/[id]/v2/page';

export default function OperationsContractDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  return (
    <>
      <div className="flex justify-end px-4 pt-3 md:px-6">
        <Link
          href={`/rental-provider/dashboard/operations/${id}/lifecycle`}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
        >
          🕑 View full lifecycle
        </Link>
      </div>
      <ContractV2View view="full" />
    </>
  );
}
