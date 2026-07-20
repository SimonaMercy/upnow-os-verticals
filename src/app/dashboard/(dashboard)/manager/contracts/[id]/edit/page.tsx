// Manager: reuses the landlord edit-contract page. It detects the /manager path
// + ?rp=<landlord> and scopes the customer picker (tenant list/search/create) to
// that landlord via /manager/tenants/*?rp=. The contract load + PATCH save are
// already manager-capable on the backend (resolveContractActor). Gated so only a
// manager granted "Manage Agreements" on this landlord reaches the editable form.
import EditContractPage from '@/app/rental-provider/dashboard/contracts/[id]/edit/page';
import { ManagerPermissionGate } from '@/components/manager/ManagerPermissionGate';

export default function Page() {
  return (
    <ManagerPermissionGate flag="canManageAgreements" label="Manage Agreements">
      <EditContractPage />
    </ManagerPermissionGate>
  );
}
