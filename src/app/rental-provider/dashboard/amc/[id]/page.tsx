'use client';

import { useParams } from 'next/navigation';
import { AmcContractDetail } from '@/components/amc/AmcContractDetail';

export default function AmcDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AmcContractDetail
      contractId={Number(id)}
      base="/amc"
      listHref="/rental-provider/dashboard/amc"
      detailHrefOf={(cid) => `/rental-provider/dashboard/amc/${cid}`}
      vendorHrefOf={(spId) => `/rental-provider/dashboard/vendors/${spId}`}
    />
  );
}
