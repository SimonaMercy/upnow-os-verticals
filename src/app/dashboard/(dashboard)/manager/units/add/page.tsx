/**
 * Manager — Add units. Reuses the landlord's full add-units wizard (pick an
 * existing property or create a new one + bulk unit rows). The wizard reads
 * `?rp=<id>` as the acting landlord, lists that landlord's properties, posts
 * `rentalProviderId` on their behalf, uploads photos / floor-plans through the
 * landlord-scoped /manager routes, and returns to the manager portal on finish.
 * Gated so only a manager granted "Edit Properties" on this landlord reaches it.
 */
import AddUnitsWizard from '@/app/rental-provider/dashboard/units/add/page';
import { ManagerPermissionGate } from '@/components/manager/ManagerPermissionGate';

export default function Page() {
  return (
    <ManagerPermissionGate flag="canEditProperties" label="Edit Properties">
      <AddUnitsWizard />
    </ManagerPermissionGate>
  );
}
