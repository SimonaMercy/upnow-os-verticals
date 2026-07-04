// Manager: reuses the landlord lead-detail quest-page. It detects the ?rp=<landlord>
// query param and routes every call to the manager-aware /api/manager/leads/* endpoints
// (see leadUrl() in the shared page), rendered under the manager layout (LandlordSwitcher).
export { default } from '@/app/rental-provider/dashboard/leads/[id]/page';
