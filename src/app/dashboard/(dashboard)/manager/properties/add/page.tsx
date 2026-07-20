/**
 * Manager — Add property. Reuses the landlord's full add-property wizard
 * (property + units + bulk CSV) verbatim. The wizard already reads `?rp=<id>`
 * as the acting landlord, posts `rentalProviderId` on their behalf, shows the
 * "acting on behalf" banner, and returns to the manager portal when scoped.
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
