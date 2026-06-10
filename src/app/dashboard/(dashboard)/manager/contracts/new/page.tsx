// Manager: reuses the landlord new-contract wizard. It detects the /manager path
// + ?rp=<landlord> and scopes every fetch (properties, tenants, create, submit) to
// that landlord via the manager-aware endpoints.
export { default } from '@/app/rental-provider/dashboard/contracts/new/page';
