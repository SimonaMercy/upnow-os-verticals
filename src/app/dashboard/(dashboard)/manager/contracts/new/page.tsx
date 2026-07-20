// Manager: reuses the landlord new-contract wizard. It detects the /manager path
// + ?rp=<landlord> and scopes every fetch (properties, tenants, create, submit) to
// that landlord via the manager-aware endpoints. Gated so only a manager granted
// "Create Contracts" on this landlord reaches the editable wizard.
import NewContractPage from '@/app/rental-provider/dashboard/contracts/new/page';
import { ManagerPermissionGate } from '@/components/manager/ManagerPermissionGate';

export default function Page() {
  return (
    <ManagerPermissionGate flag="canCreateContracts" label="Create Contracts">
      <NewContractPage />
    </ManagerPermissionGate>
  );
}
