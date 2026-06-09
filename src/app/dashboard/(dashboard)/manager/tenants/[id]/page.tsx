// Manager: reuses the landlord customer-detail page. It detects the /manager
// path + ?rp=<landlord> and loads via the manager-aware endpoint.
export { default } from '@/app/rental-provider/dashboard/tenants/[id]/page';
