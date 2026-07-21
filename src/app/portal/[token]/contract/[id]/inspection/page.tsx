// Inspector magic-link: reuses the full RP v2 inspection workspace. The component
// detects the /portal/<token> path and swaps every API call to the token-scoped
// inspector endpoints (full/save/photo upload/counter-sign) — no login. The dated
// move-out field and counter-sign pad appear in place of the dashboard chrome.
export { default } from '@/app/rental-provider/dashboard/contracts/[id]/inspection/v2/page';
