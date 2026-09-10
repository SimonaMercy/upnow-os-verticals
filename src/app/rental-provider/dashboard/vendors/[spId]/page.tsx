'use client';

import { useParams } from 'next/navigation';
import { VendorDetailView } from '@/components/vendors/VendorDetailView';

export default function VendorDetailPage() {
  const { spId } = useParams<{ spId: string }>();
  return (
    <VendorDetailView spId={Number(spId)} base="/maintenance" amcBase="/amc"
      listHref="/rental-provider/dashboard/vendors" amcHref="/rental-provider/dashboard/amc"
      amcDetailHrefOf={(id) => `/rental-provider/dashboard/amc/${id}`}
      requestHrefOf={(id) => `/rental-provider/dashboard/maintenance/${id}`} />
  );
}
