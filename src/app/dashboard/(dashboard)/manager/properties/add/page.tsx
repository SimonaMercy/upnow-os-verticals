/**
 * Manager — Add property. Reuses the landlord's full add-property wizard
 * (property + units + bulk CSV) verbatim. The wizard already reads `?rp=<id>`
 * as the acting landlord, posts `rentalProviderId` on their behalf, shows the
 * "acting on behalf" banner, and returns to the manager portal when scoped.
 */
export { default } from '@/app/rental-provider/dashboard/portfolio/add/page';
