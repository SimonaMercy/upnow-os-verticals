'use client';

/**
 * RP → Maintenance requests: the full history (Completed · Open · Ended).
 * Open work is WORKED on Operations → Maintenance; a request leaves that
 * board when closed out and is found here. Detail pages live at ./[id].
 */
import { MaintenanceRequestsIndex } from '@/components/upnow/MaintenanceRequestsIndex';

export default function RpMaintenanceRequestsPage() {
  return (
    <MaintenanceRequestsIndex
      base="/maintenance"
      detailHref={(id) => `/rental-provider/dashboard/maintenance/${id}`}
      boardHref="/rental-provider/dashboard/operations?tab=maintenance&view=kanban"
    />
  );
}
