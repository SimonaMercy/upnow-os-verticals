/**
 * RP maintenance request detail — the "Open" target of the Operations →
 * Maintenance board. All rendering + actions live in the shared
 * MaintenanceRequestView (the manager mirror uses the same component with the
 * /manager base), matching the AmcView pattern.
 */
'use client';

import { useParams } from 'next/navigation';
import { MaintenanceRequestView } from '@/components/upnow/MaintenanceRequestView';

export default function RpMaintenanceRequestPage() {
  const params = useParams<{ id: string }>();
  return (
    <MaintenanceRequestView
      base="/maintenance"
      id={Number(params.id)}
      backHref="/rental-provider/dashboard/maintenance"
    />
  );
}
