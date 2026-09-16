/** The landlord's Settings the lead / contract forms enforce (move-in days,
 *  instalment counts, fee rules). The RP endpoints `/profiles/rental-provider/me`
 *  and `/fee-rules` resolve the landlord from the caller's JWT, so a manager must
 *  ask the manager-aware mirrors for the landlord they act for (`?rp=`) — otherwise
 *  the rules silently fall back to "open" (any day, any instalment count). */
export function rpSettingsUrl(
  path: '/api/profiles/rental-provider/me' | '/api/fee-rules',
  manager?: { rp: number } | null,
): string {
  if (!manager) return path;
  const mirror = path === '/api/fee-rules' ? '/api/manager/fee-rules' : '/api/manager/landlord-profile';
  return `${mirror}?rp=${manager.rp}`;
}
