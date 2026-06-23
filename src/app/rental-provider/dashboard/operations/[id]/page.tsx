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

import { ContractV2View } from '@/app/rental-provider/dashboard/contracts/[id]/v2/page';

export default function OperationsContractDetailPage() {
  return <ContractV2View view="full" />;
}
