'use client';

import { VendorsListView } from '@/components/vendors/VendorsListView';

export default function VendorsPage() {
  return <VendorsListView base="/maintenance" detailHrefOf={(spId) => `/rental-provider/dashboard/vendors/${spId}`} />;
}
