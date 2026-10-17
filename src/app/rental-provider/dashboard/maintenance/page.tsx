'use client';

/**
 * RP → Maintenance requests: the full history (Completed · Open · Ended).
 * Open work is WORKED on Operations → Maintenance; a request leaves that
 * board when closed out and is found here. Detail pages live at ./[id].
 *
 * Parity with previous page: renders <MaintenanceRequestsIndex> unchanged with
 * the same props; adds OsPage + PageHead only.
 * Duplicate title: the component renders its own "Maintenance requests" h1 and
 * has no prop to hide it, so PageHead is kept minimal (eyebrow + title).
 */
import { MaintenanceRequestsIndex } from '@/components/upnow/MaintenanceRequestsIndex';
import { OsPage, PageHead } from '@/components/os/kit';

export default function RpMaintenanceRequestsPage() {
  return (
    <OsPage>
      <PageHead eyebrow="Operations" title="Maintenance" />
      <MaintenanceRequestsIndex
        base="/maintenance"
        detailHref={(id) => `/rental-provider/dashboard/maintenance/${id}`}
        boardHref="/rental-provider/dashboard/operations?tab=maintenance&view=kanban"
      />
    </OsPage>
  );
}
