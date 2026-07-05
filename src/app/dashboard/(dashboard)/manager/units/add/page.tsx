/**
 * Manager — Add units. Reuses the landlord's full add-units wizard (pick an
 * existing property or create a new one + bulk unit rows). The wizard reads
 * `?rp=<id>` as the acting landlord, lists that landlord's properties, posts
 * `rentalProviderId` on their behalf, uploads photos / floor-plans through the
 * landlord-scoped /manager routes, and returns to the manager portal on finish.
 */
export { default } from '@/app/rental-provider/dashboard/units/add/page';
