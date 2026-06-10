// Inspector magic-link: reuses the full RP inspection workspace. The component
// detects the /portal/<token> path and swaps every API call to the token-scoped
// inspector endpoints (fill, photo upload, save, counter-sign) — no login.
export { default } from '@/app/rental-provider/dashboard/contracts/[id]/inspection/page';
