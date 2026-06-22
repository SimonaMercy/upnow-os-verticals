// Manager: reuses the landlord edit-contract page. It detects the /manager path
// + ?rp=<landlord> and scopes the customer picker (tenant list/search/create) to
// that landlord via /manager/tenants/*?rp=. The contract load + PATCH save are
// already manager-capable on the backend (resolveContractActor), so no extra
// scoping is needed there.
export { default } from '@/app/rental-provider/dashboard/contracts/[id]/edit/page';
