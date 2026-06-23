/**
 * Manager Operations contract detail — full working view (setup pipeline +
 * record). Re-exports the RP Operations detail page; ContractV2View is
 * manager-aware at runtime (it switches its nav base when the path is under
 * /dashboard/manager and the backend endpoints are role-scoped).
 */
export { default } from '@/app/rental-provider/dashboard/operations/[id]/page';
